"""
journal_scraper.py — Build per-member journal folders.
Reads member_id_map.csv, navigates to each member's folio via
retrieve.jsp?memberid=X, scrapes 5 specific tabs, and saves
one CSV per tab under journal/{folder_name}/.
Folder naming:
    - Unique member numbers (1C, 22A)    → journal/1C/
    - Generic labels (Guests, Dependent) → journal/Guests_35849/
Output structure:
    journal/
        1C/
            1C_rooms.csv
            1C_interests.csv
            1C_recent_activity.csv
            1C_statements.csv
            1C_services.csv
Usage:
    python journal_scraper.py                        # First 10 members (test)
    python journal_scraper.py --all                  # All members, 8 workers
    python journal_scraper.py --limit 50             # Custom limit
    python journal_scraper.py --workers 8            # Custom worker count
    python journal_scraper.py --member 1C            # Single member by number
    python journal_scraper.py --id 32845             # Single member by portal ID
    python journal_scraper.py --reset                # Clear done log, rescrape all
"""
import os
import csv
import argparse
import math
import time
import signal
from datetime import datetime
from multiprocessing import Pool
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
MAP_FILE          = os.path.join(OUTPUT_FOLDER, "member_id_map.csv")
JOURNAL_FOLDER    = os.path.join(OUTPUT_FOLDER, "journal")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
DONE_LOG          = os.path.join(OUTPUT_FOLDER, "journal_done.txt")
LIST_MEMBERS_URL  = f"{BASE_URL}/Membership/middlePage.jsp?listView&tabId=437&tabGrpModuleID=1"

DEFAULT_LIMIT   = None
DEFAULT_WORKERS = 10

# Timeouts (ms)
NAV_TIMEOUT   = 6000
TAB_TIMEOUT   = 4000
FRAME_TIMEOUT = 4000
CLICK_TIMEOUT = 2000

TAB_MAX_RETRIES = 3

GENERIC_LABELS = {"Guests", "Dependent", "Guest", "Staff"}

TABS = [
    {"tabname": "Member_Info", "tab_id": "rooms",          "tab_label": "Rooms",           "suffix": "rooms"},
    {"tabname": "Billing",     "tab_id": "recentActivity", "tab_label": "Recent Activity", "suffix": "recent_activity"},
    {"tabname": "Billing",     "tab_id": "statements",     "tab_label": "Statements",      "suffix": "statements"},
    {"tabname": "Billing",     "tab_id": "services",       "tab_label": "Services",        "suffix": "services"},
]

TAB_HREF_FALLBACKS = {
    "rooms":          "roomsInfo.do",
    "recentActivity": "recentCharges.jsp",
    "statements":     "memberStatements.jsp",
    "services":       "members_enrolled_services.jsp",
}

# ─────────────────────────────────────────────
# DONE LOG
# ─────────────────────────────────────────────
def load_done_set():
    if not os.path.exists(DONE_LOG):
        return set()
    with open(DONE_LOG, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())

def mark_done(member_id):
    with open(DONE_LOG, "a", encoding="utf-8") as f:
        f.write(f"{member_id}\n")

# ─────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────
def get_folder_name(member_number, member_id):
    if member_number in GENERIC_LABELS:
        return f"{member_number}_{member_id}"
    return member_number

def take_screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"journal_{name}_{ts}.png")
        page.screenshot(path=path)
        print(f"    Screenshot: {path}")
    except Exception:
        pass

def load_member_map(filepath):
    members = []
    with open(filepath, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            members.append((row["member_number"], row["member_id"]))
    return members

def save_tab_csv(folder_name, suffix, rows):
    if not rows:
        return None
    folder = os.path.join(JOURNAL_FOLDER, folder_name)
    os.makedirs(folder, exist_ok=True)
    filepath = os.path.join(folder, f"{folder_name}_{suffix}.csv")
    all_keys = []
    seen = set()
    for row in rows:
        for k in row:
            if k not in seen:
                all_keys.append(k)
                seen.add(k)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return filepath

# ─────────────────────────────────────────────
# FRAME FINDERS — poll with timeout, never crash
# ─────────────────────────────────────────────
def get_landing_frame(page, timeout_ms=FRAME_TIMEOUT):
    """
    Find the landingFrame by name. Polls until timeout.
    This is the frame where ALL tab content loads — identified by
    name="landingFrame" in the portal's frameset.
    """
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == "landingFrame":
                    _ = frame.url  # probe — raises if detached
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(300)
    # Fallback: any frame with "landing" in the name
    for frame in page.frames:
        try:
            if "landing" in frame.name.lower():
                return frame
        except Exception:
            continue
    return None

def get_shell_frame(page, timeout_ms=FRAME_TIMEOUT):
    """
    Find the folio navigation shell — the frame that contains
    #btnTab1 and the subtab links. Polls until timeout.
    """
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.query_selector("#btnTab1"):
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(300)
    # Fallback: frame whose URL contains retrieve.jsp
    for frame in page.frames:
        try:
            if "retrieve.jsp" in frame.url:
                return frame
        except Exception:
            continue
    return None

# ─────────────────────────────────────────────
# CONTENT CHANGE DETECTION
# ─────────────────────────────────────────────
def get_landing_fingerprint(page):
    """
    Snapshot the first 3 table rows of landingFrame as a string.
    Changes whenever a different tab loads new content.
    Returns None if frame or tables aren't ready yet.
    """
    try:
        frame = get_landing_frame(page, timeout_ms=1000)
        if not frame:
            return None
        rows = frame.query_selector_all("table tr")
        if not rows:
            return None
        return "|".join(r.inner_text().strip() for r in rows[:3])
    except Exception:
        return None

def wait_for_content_change(page, previous_fingerprint, timeout_ms=TAB_TIMEOUT):
    """
    Wait until landingFrame has a table AND its content has changed
    from previous_fingerprint. Accepts immediately if no baseline given.
    Returns True when content is ready, False on timeout.
    """
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        current = get_landing_fingerprint(page)
        if current is not None:
            if previous_fingerprint is None or current != previous_fingerprint:
                return True
        page.wait_for_timeout(300)
    return False

# ─────────────────────────────────────────────
# SESSION MANAGEMENT
# ─────────────────────────────────────────────
def session_alive(page):
    return get_landing_frame(page, timeout_ms=2000) is not None

def ensure_session(page, worker_id=0):
    """Re-login and restore Membership module if session was lost."""
    if session_alive(page):
        return False
    prefix = f"[W{worker_id}] "
    print(f"  {prefix}Session lost — re-logging in...")
    try:
        login(page)
        dismiss_popup(page)
        main_frame = get_frame_by_url(page, "default.jsp") or page
        try:
            main_frame.evaluate("changeSelModule(1,1,1,'#003565','Membership')")
        except Exception:
            pass
        page.wait_for_timeout(4000)
        landing = get_landing_frame(page, timeout_ms=10000)
        if landing:
            landing.goto(LIST_MEMBERS_URL)
            page.wait_for_timeout(3000)
        print(f"  {prefix}Re-login complete.")
        return True
    except Exception as e:
        print(f"  {prefix}Re-login failed: {e}")
        return False

# ─────────────────────────────────────────────
# POPUP DISMISSAL
# ─────────────────────────────────────────────
def dismiss_popup(page):
    """
    Dismiss any notification or dialog popup.
    Tries close buttons in every frame, then falls back to Escape.
    Called after login and before each member scrape.
    """
    try:
        close_selectors = (
            "a[onclick*='close'], button[onclick*='close'], "
            ".ui-dialog-titlebar-close, button.close, .close, "
            "a.ui-dialog-titlebar-close, button[aria-label='Close']"
        )
        for frame in page.frames:
            try:
                btn = frame.query_selector(close_selectors)
                if btn:
                    btn.click()
                    page.wait_for_timeout(800)
                    return
            except Exception:
                continue
        # Fallback: Escape key closes most modal dialogs
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception:
        pass

# ─────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────
def navigate_to_member(page, member_id, prefix=""):
    """
    Navigate landingFrame to the member folio page.
    Returns True on success.
    """
    url = f"{BASE_URL}/Membership/retrieve.jsp?memberid={member_id}"
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        print(f"  {prefix}landingFrame not found. Frames present:")
        for frame in page.frames:
            try:
                print(f"    name='{frame.name}' url='{frame.url[:80]}'")
            except Exception:
                continue
        return False
    try:
        landing.goto(url)
        # Wait for the shell frame to appear — it only exists on member folio pages
        shell = get_shell_frame(page, timeout_ms=NAV_TIMEOUT)
        if shell:
            print(f"  {prefix}Loaded member {member_id}")
            return True
        print(f"  {prefix}Shell frame missing after loading member {member_id}")
        return False
    except Exception as e:
        print(f"  {prefix}Navigation error for {member_id}: {e}")
        return False

# ─────────────────────────────────────────────
# MEMBER INFO FIELDS
# ─────────────────────────────────────────────
def scrape_member_info_fields(page, prefix=""):
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        return {}
    data = {
        "Deactivation Date": "",
        "Date of Death":     "",
        "Billing Cycle":     "",
        "Bill To Member":    "",
        "FICO Score":        "",
    }
    field_map = {
        "Deactivation Date": 'input[name="DeactivationDate"]',
        "Date of Death":     'input[name="deathDate"]',
        "Billing Cycle":     'input[name="BillingCycleIdDisplay"]',
        "Bill To Member":    'input[name="BillTo"]',
        "FICO Score":        'input[name="FICOScore"]',
    }
    try:
        for key, selector in field_map.items():
            el = frame.query_selector(selector)
            if el:
                value = (el.get_attribute("value") or "").strip()
                if value:
                    data[key] = value
    except Exception as e:
        print(f"    {prefix}Member info fields error: {e}")
    return data

def append_member_info_to_profile(folder_name, info_data, prefix=""):
    profile_csv = os.path.join(JOURNAL_FOLDER, folder_name, f"{folder_name}_profile.csv")
    if not os.path.exists(profile_csv):
        return False
    try:
        with open(profile_csv, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        if not rows:
            return False
        fieldnames = list(rows[0].keys())
        for key in info_data:
            if key not in fieldnames:
                fieldnames.append(key)
        for row in rows:
            for key, value in info_data.items():
                row[key] = value or ""
        with open(profile_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"    {prefix}Member info fields added to profile CSV")
        return True
    except Exception as e:
        print(f"    {prefix}Profile CSV update failed: {e}")
        return False

# ─────────────────────────────────────────────
# TAB NAVIGATION
# ─────────────────────────────────────────────
def open_member_dropdown(shell_frame, page):
    """Click #btnTab1 to open the member nav dropdown."""
    try:
        btn = shell_frame.query_selector("#btnTab1")
        if btn:
            btn.click()
            # Wait for dropdown items to become visible
            try:
                shell_frame.wait_for_selector(
                    "div[tabname], a.subtablink",
                    state="visible",
                    timeout=CLICK_TIMEOUT,
                )
            except PWTimeout:
                page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False

def click_section(shell_frame, page, tabname):
    """Click the section header (e.g. Billing, Member_Info) to reveal its subtabs."""
    try:
        div = shell_frame.query_selector(f'div[tabname="{tabname}"]')
        if div:
            div.click()
            # Wait until at least one subtab link is visible
            try:
                shell_frame.wait_for_selector(
                    "a.subtablink",
                    state="visible",
                    timeout=CLICK_TIMEOUT,
                )
            except PWTimeout:
                page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False

def click_subtab(shell_frame, page, tab_id, href_fallback, prefix=""):
    """
    Click the subtab link. Snapshots landingFrame content before clicking
    and waits for it to change afterwards, so we never scrape stale data.
    """
    # Find the link
    link = None
    for frame in [shell_frame] + [f for f in page.frames if f != shell_frame]:
        try:
            link = (frame.query_selector(f"a#{tab_id}") or
                    frame.query_selector(f'a[href*="{href_fallback}"]'))
            if link:
                break
        except Exception:
            continue

    if not link:
        print(f"    {prefix}Tab link not found: {tab_id}")
        return False

    # Fingerprint current content before clicking
    fingerprint_before = get_landing_fingerprint(page)

    try:
        link.click()
    except Exception as e:
        print(f"    {prefix}Click failed on {tab_id}: {e}")
        return False

    # Wait for content to actually change in landingFrame
    changed = wait_for_content_change(page, fingerprint_before, timeout_ms=TAB_TIMEOUT)
    if not changed:
        print(f"    {prefix}Content did not change after clicking {tab_id} — may still be loading")

    return True

# ─────────────────────────────────────────────
# EXTRACTION
# ─────────────────────────────────────────────
def extract_table(table_el):
    rows_data = []
    try:
        headers = [th.inner_text().strip() for th in table_el.query_selector_all("th")]
        if not headers:
            first_row = table_el.query_selector("tr")
            if first_row:
                headers = [td.inner_text().strip() for td in first_row.query_selector_all("td")]
        all_rows = table_el.query_selector_all("tr")
        start = 1 if headers else 0
        for row in all_rows[start:]:
            cells = [td.inner_text().strip() for td in row.query_selector_all("td")]
            if not any(cells):
                continue
            if headers and len(cells) == len(headers):
                rows_data.append(dict(zip(headers, cells)))
            else:
                rows_data.append({f"col_{i}": v for i, v in enumerate(cells)})
    except Exception as e:
        rows_data.append({"error": str(e)})
    return rows_data

def scrape_landing_frame(page, folder_name, section, tab_label, prefix=""):
    """
    Scrape all tables from the landingFrame.
    Always re-acquires the frame fresh — never reuses a stale reference.
    """
    rows = []
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}landingFrame missing when scraping {tab_label}")
        return rows
    try:
        tables = frame.query_selector_all("table")
        if not tables:
            print(f"    {prefix}No tables in {tab_label}")
            return rows
        for table in tables:
            for row in extract_table(table):
                row["_folder"]  = folder_name
                row["_section"] = section
                row["_tab"]     = tab_label
                rows.append(row)
    except Exception as e:
        print(f"    {prefix}Scrape error on {tab_label}: {e}")
    return rows

# ─────────────────────────────────────────────
# PER-MEMBER SCRAPE
# ─────────────────────────────────────────────
def scrape_member(page, member_number, member_id, prefix=""):
    """Scrape all tabs for one member. Returns dict of {suffix: filepath}."""
    folder_name = get_folder_name(member_number, member_id)
    saved = {}

    # Dismiss any popup that may have opened since last member
    dismiss_popup(page)

    if not navigate_to_member(page, member_id, prefix):
        print(f"  {prefix}Navigation failed for {member_number}")
        return saved

    # Scrape extra fields from the default member info landing page
    member_info = scrape_member_info_fields(page, prefix)
    append_member_info_to_profile(folder_name, member_info, prefix)

    shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not shell:
        print(f"  {prefix}Shell frame not found for {member_number}")
        take_screenshot(page, f"no_shell_{folder_name}")
        return saved

    current_tabname = None

    for tab in TABS:
        tabname   = tab["tabname"]
        tab_id    = tab["tab_id"]
        tab_label = tab["tab_label"]
        suffix    = tab["suffix"]
        href_fb   = TAB_HREF_FALLBACKS.get(tab_id, "")
        tab_done  = False

        for attempt in range(1, TAB_MAX_RETRIES + 1):
            try:
                note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
                print(f"    {prefix}{tab_label}{note}")

                # Re-acquire shell — it can be replaced on page transitions
                shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
                if not shell:
                    print(f"    {prefix}Shell lost — re-navigating to member")
                    if not navigate_to_member(page, member_id, prefix):
                        break
                    shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
                    if not shell:
                        break
                    current_tabname = None  # Reset — we're on a fresh page

                # Open dropdown before every single tab click
                open_member_dropdown(shell, page)

                # Switch section if needed
                if tabname != current_tabname:
                    if not click_section(shell, page, tabname):
                        print(f"    {prefix}Could not open section: {tabname}")
                    current_tabname = tabname

                # Click the subtab (waits for content change internally)
                if not click_subtab(shell, page, tab_id, href_fb, prefix):
                    take_screenshot(page, f"no_tab_{folder_name}_{suffix}")
                    if attempt < TAB_MAX_RETRIES:
                        page.wait_for_timeout(1000 * attempt)
                    continue

                # Scrape fresh content from landingFrame
                rows = scrape_landing_frame(page, folder_name, tabname, tab_label, prefix)

                if rows:
                    fp = save_tab_csv(folder_name, suffix, rows)
                    if fp:
                        saved[suffix] = fp
                        print(f"    {prefix}{tab_label}: {len(rows)} rows → {os.path.basename(fp)}")
                        tab_done = True
                        break
                else:
                    print(f"    {prefix}{tab_label}: no data")
                    if suffix == "rooms":
                        print(f"    {prefix}No room data — skipping remaining tabs")
                        return saved
                    tab_done = True  # Empty is valid — don't retry
                    break

            except Exception as e:
                print(f"    {prefix}{tab_label} error (attempt {attempt}): {e}")
                if attempt < TAB_MAX_RETRIES:
                    page.wait_for_timeout(1500 * attempt)

        if not tab_done:
            print(f"    {prefix}{tab_label}: exhausted retries — skipping")

    return saved

# ─────────────────────────────────────────────
# WORKER INIT
# ─────────────────────────────────────────────
def _worker_init():
    """Workers ignore Ctrl+C — main process handles shutdown."""
    signal.signal(signal.SIGINT, signal.SIG_IGN)

# ─────────────────────────────────────────────
# PARALLEL WORKER
# ─────────────────────────────────────────────
def scrape_chunk(args):
    members_chunk, worker_id = args
    time.sleep(worker_id * 3)  # Stagger logins
    prefix  = f"[W{worker_id}] "
    results = {"success": [], "failed": [], "skipped": []}
    done_set = load_done_set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_page()
        try:
            print(f"  {prefix}Logging in...")
            login(page)
            page.wait_for_timeout(2000)
            dismiss_popup(page)

            print(f"  {prefix}Loading Membership module...")
            main_frame = get_frame_by_url(page, "default.jsp") or page
            try:
                main_frame.evaluate("changeSelModule(1,1,1,'#003565','Membership')")
            except Exception:
                pass
            page.wait_for_timeout(3000)

            landing = get_landing_frame(page, timeout_ms=8000)
            if landing:
                landing.goto(LIST_MEMBERS_URL)
                page.wait_for_timeout(2000)
                print(f"  {prefix}Ready — {len(members_chunk)} members to process")
            else:
                print(f"  {prefix}WARNING: landingFrame not found after login")

            for i, (member_number, member_id) in enumerate(members_chunk, 1):
                folder_name = get_folder_name(member_number, member_id)
                print(f"\n  {prefix}[{i}/{len(members_chunk)}] {member_number} (id={member_id})")

                ensure_session(page, worker_id)

                if member_id in done_set:
                    print(f"  {prefix}Already done — skipping")
                    results["skipped"].append(folder_name)
                    continue

                saved = scrape_member(page, member_number, member_id, prefix)

                if not saved:
                    # One retry after session check
                    if ensure_session(page, worker_id):
                        print(f"  {prefix}Retrying {member_number} after re-login...")
                        saved = scrape_member(page, member_number, member_id, prefix)

                mark_done(member_id)
                done_set.add(member_id)

                if saved:
                    print(f"  {prefix}✓ {member_number}: {len(saved)} file(s) saved")
                    results["success"].append(folder_name)
                else:
                    print(f"  {prefix}✗ {member_number}: nothing saved")
                    results["failed"].append(folder_name)

        except Exception as e:
            print(f"  {prefix}Fatal error: {e}")
            take_screenshot(page, f"worker_{worker_id}_fatal")
        finally:
            browser.close()

    return results

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Build per-member journal folders.")
    parser.add_argument("--all",     action="store_true", help="Scrape all members")
    parser.add_argument("--limit",   type=int, default=DEFAULT_LIMIT,
                        help="Max members (default: all)")
    parser.add_argument("--member",  type=str, default=None,
                        help="Single member by number e.g. 1C")
    parser.add_argument("--id",      type=str, default=None,
                        help="Single member by portal ID e.g. 32845")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Parallel workers (default: {DEFAULT_WORKERS})")
    parser.add_argument("--reset",   action="store_true",
                        help="Clear done log and rescrape everything")
    args = parser.parse_args()

    if not os.path.exists(MAP_FILE):
        print(f"ERROR: {MAP_FILE} not found. Run build_member_map.py first.")
        return

    if args.reset and os.path.exists(DONE_LOG):
        os.remove(DONE_LOG)
        print("Done log cleared.")

    all_members = load_member_map(MAP_FILE)
    print(f"Loaded {len(all_members)} members from map.")
    done_count = len(load_done_set())
    if done_count:
        print(f"Already done: {done_count} (use --reset to rescrape)")

    if args.member:
        members = [(n, i) for n, i in all_members if n == args.member]
        if not members:
            print(f"Member '{args.member}' not found.")
            return
    elif args.id:
        members = [(n, i) for n, i in all_members if i == args.id]
        if not members:
            print(f"ID '{args.id}' not found.")
            return
    elif args.all:
        members = all_members
    else:
        members = all_members[:args.limit]

    print("=" * 60)
    print("Journal Scraper")
    print("=" * 60)
    print(f"Members to process : {len(members)}")
    print(f"Output             : {JOURNAL_FOLDER}")

    if len(members) == 1 or args.workers == 1:
        print("Mode               : single worker")
        print()
        all_results = [scrape_chunk((members, 1))]
    else:
        num_workers = min(args.workers, len(members))
        chunk_size  = math.ceil(len(members) / num_workers)
        chunks = [
            (members[i : i + chunk_size], wid)
            for wid, i in enumerate(range(0, len(members), chunk_size), 1)
        ]
        print(f"Workers            : {num_workers}")
        print(f"Per worker         : ~{chunk_size} members")
        print()
        pool = Pool(processes=num_workers, initializer=_worker_init)
        try:
            all_results = pool.map(scrape_chunk, chunks)
        except KeyboardInterrupt:
            print("\nInterrupted — shutting down...")
            pool.terminate()
            pool.join()
            print("Stopped. Progress saved to journal_done.txt")
            sys.exit(0)
        else:
            pool.close()
            pool.join()

    success      = sum(len(r["success"]) for r in all_results)
    failed       = sum(len(r["failed"])  for r in all_results)
    skipped      = sum(len(r["skipped"]) for r in all_results)
    failed_names = [n for r in all_results for n in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Success : {success}")
    print(f"  Failed  : {failed}")
    print(f"  Skipped : {skipped}")
    if failed_names:
        print(f"  Failed  : {failed_names}")
    print("=" * 60)

if __name__ == "__main__":
    main()