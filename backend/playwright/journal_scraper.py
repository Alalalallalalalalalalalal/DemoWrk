"""
journal_scraper.py — Build per-member journal folders.

Reads member_id_map.csv, navigates to each member's folio via
retrieve.jsp?memberid=X, scrapes 4 specific tabs, and saves
one CSV per tab under journal/{folder_name}/.

Folder naming:
    - Unique member numbers (1C, 22A)    → journal/1C/
    - Generic labels (Guests, Dependent) → journal/Guests_35849/

Output structure:
    journal/
        1C/
            1C_rooms.csv
            1C_recent_activity.csv
            1C_statements.csv
            1C_services.csv
        Guests_35849/
            Guests_35849_rooms.csv
            ...

Usage:
    python journal_scraper.py                        # First 10 members (test)
    python journal_scraper.py --all                  # All members, 4 workers
    python journal_scraper.py --limit 50             # Custom limit
    python journal_scraper.py --workers 8            # Custom worker count
    python journal_scraper.py --member 1C            # Single member by number
    python journal_scraper.py --id 32845             # Single member by portal ID
"""
import os
import csv
import argparse
import math
from datetime import datetime
from multiprocessing import Pool
import sys
from playwright.sync_api import sync_playwright

from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
MAP_FILE          = os.path.join(OUTPUT_FOLDER, "member_id_map.csv")
JOURNAL_FOLDER    = os.path.join(OUTPUT_FOLDER, "journal")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
LIST_MEMBERS_URL  = f"{BASE_URL}/Membership/middlePage.jsp?listView&tabId=437&tabGrpModuleID=1"
DEFAULT_LIMIT     = 10
DEFAULT_WORKERS   = 4

# Generic labels that need member_id appended to folder name
GENERIC_LABELS = {"Guests", "Dependent", "Guest", "Staff"}

# Interests tab removed — not populating
# Early exit: if Rooms has no data, remaining tabs are skipped
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
# UTILITIES
# ─────────────────────────────────────────────

def get_folder_name(member_number, member_id):
    """
    Return the folder name for a member.
    Generic labels get member_id appended to avoid collisions.
    e.g. Guests → Guests_35849, 1C → 1C
    """
    if member_number in GENERIC_LABELS:
        return f"{member_number}_{member_id}"
    return member_number


def screenshot(page, name):
    os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(SCREENSHOT_FOLDER, f"journal_{name}_{ts}.png")
    page.screenshot(path=path)
    print(f"    Screenshot: {path}")
    return path


def load_member_map(filepath):
    """Load member_id_map.csv → list of (member_number, member_id)."""
    members = []
    with open(filepath, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            members.append((row["member_number"], row["member_id"]))
    return members


def already_scraped(folder_name):
    """Skip only if the folio tab CSVs already exist."""
    folder = os.path.join(JOURNAL_FOLDER, folder_name)
    if not os.path.isdir(folder):
        return False
    tab_suffixes = ["_rooms.csv", "_recent_activity.csv",
                    "_statements.csv", "_services.csv"]
    files = os.listdir(folder)
    return any(
        any(f.endswith(suffix) for f in files)
        for suffix in tab_suffixes
    )


def save_tab_csv(folder_name, suffix, rows):
    """Save rows to journal/{folder_name}/{folder_name}_{suffix}.csv"""
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


def scrape_member_info_fields(page):
    """
    Scrape additional member info fields from Member Info page.
    Returns: dict
    """
    frame = find_landing_frame(page)
    if not frame:
        return {}

    data = {
        "Deactivation Date": "",
        "Date of Death": "",
        "Billing Cycle": "",
        "Bill To Member": "",
        "FICO Score": "",
    }

    try:
        # Deactivation Date
        el = frame.query_selector('input[name="DeactivationDate"]')
        if el:
            value = el.get_attribute("value") or el.inner_text()
            if value:
                data["Deactivation Date"] = value.strip()

        # Date of Death
        el = frame.query_selector('input[name="deathDate"]')
        if el:
            value = el.get_attribute("value") or el.inner_text()
            if value:
                data["Date of Death"] = value.strip()

        # Billing Cycle
        el = frame.query_selector('input[name="BillingCycleIdDisplay"]')
        if el:
            value = el.get_attribute("value") or el.inner_text()
            if value:
                data["Billing Cycle"] = value.strip()

        # Bill To Member
        el = frame.query_selector('input[name="BillTo"]')
        if el:
            value = el.get_attribute("value") or el.inner_text()
            if value:
                data["Bill To Member"] = value.strip()

        # FICO Score
        el = frame.query_selector('input[name="FICOScore"]')
        if el:
            value = el.get_attribute("value") or el.inner_text()
            if value:
                data["FICO Score"] = value.strip()

    except Exception as e:
        print(f"    Failed scraping member info fields: {e}")
        screenshot(page, "member_info_error")

    return data


def append_member_info_to_profile(folder_name, info_data):
    """Append/update member info columns inside existing profile CSV."""
    profile_csv = os.path.join(
        JOURNAL_FOLDER,
        folder_name,
        f"{folder_name}_profile.csv"
    )

    if not os.path.exists(profile_csv):
        print(f"    Profile CSV not found: {profile_csv}")
        return False

    try:
        with open(profile_csv, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))

        if not rows:
            return False

        for row in rows:
            for key, value in info_data.items():
                row[key] = value or ""

        fieldnames = list(rows[0].keys())
        for key in info_data.keys():
            if key not in fieldnames:
                fieldnames.append(key)

        with open(profile_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        print("    Added member info fields to profile CSV")
        return True

    except Exception as e:
        print(f"    Failed updating profile CSV: {e}")
        return False


# ─────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────

def dismiss_notification_popup(page):
    try:
        for frame in page.frames:
            try:
                btn = frame.query_selector(
                    "a[onclick*='close'], button[onclick*='close'], "
                    ".ui-dialog-titlebar-close, button.close, .close"
                )
                if btn:
                    btn.click()
                    page.wait_for_timeout(1000)
                    return
            except Exception:
                continue
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    except Exception:
        pass


def navigate_to_member(page, member_id):
    """
    Navigate landingFrame to retrieve.jsp?memberid=X.
    """
    url = f"{BASE_URL}/Membership/retrieve.jsp?memberid={member_id}"

    # Strategy 1: Find by frame name "landingFrame"
    for frame in page.frames:
        try:
            if frame.name == "landingFrame":
                frame.goto(url)
                page.wait_for_timeout(2000)
                print(f"  Navigated landingFrame to member {member_id}")
                return True
        except Exception as e:
            print(f"  landingFrame navigation failed: {e}")
            continue

    # Strategy 2: Find by frame name containing "landing"
    for frame in page.frames:
        try:
            if "landing" in frame.name.lower():
                frame.goto(url)
                page.wait_for_timeout(2000)
                print(f"  Navigated '{frame.name}' to member {member_id}")
                return True
        except Exception:
            continue

    # Strategy 3: Debug then try every non-default frame
    print(f"  landingFrame not found. All frames:")
    for frame in page.frames:
        try:
            print(f"    name='{frame.name}' url='{frame.url[:80]}'")
        except Exception:
            continue

    for frame in page.frames:
        try:
            if any(kw in frame.url for kw in ["default.jsp", "login", "about:blank"]):
                continue
            if frame.name in ["", "default"]:
                continue
            frame.goto(url)
            page.wait_for_timeout(2000)
            print(f"  Navigated fallback frame '{frame.name}' to member {member_id}")
            return True
        except Exception:
            continue

    return False


def find_folio_shell_frame(page):
    """Find the frame with #btnTab1 and a.subtablink — the folio nav shell."""
    for frame in page.frames:
        try:
            if frame.query_selector("#btnTab1"):
                return frame
        except Exception:
            continue

    for frame in page.frames:
        try:
            if "retrieve.jsp" in frame.url:
                return frame
            if frame.query_selector("a.subtablink"):
                return frame
        except Exception:
            continue
    return None


def find_landing_frame(page):
    """Find landingFrame where tab content loads."""
    for frame in page.frames:
        try:
            if frame.name == "landingFrame":
                return frame
        except Exception:
            continue

    tab_keywords = [
        "roomsInfo", "classAttributeList", "recentCharges",
        "memberStatements", "members_enrolled_services",
    ]
    for frame in page.frames:
        try:
            if any(kw in frame.url for kw in tab_keywords):
                return frame
        except Exception:
            continue

    # Fallback: largest non-shell frame
    best, best_len = None, 0
    for frame in page.frames:
        try:
            if any(kw in frame.url for kw in ["default.jsp", "login", "about:blank"]):
                continue
            if frame.query_selector("#btnTab1"):
                continue
            c = len(frame.content())
            if c > best_len:
                best_len = c
                best = frame
        except Exception:
            continue
    return best


# ─────────────────────────────────────────────
# TAB CLICKING
# ─────────────────────────────────────────────

def open_member_dropdown(shell_frame, page):
    try:
        btn = shell_frame.query_selector("#btnTab1")
        if btn:
            btn.click()
            page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False


def click_section(shell_frame, page, tabname):
    try:
        div = shell_frame.query_selector(f'div[tabname="{tabname}"]')
        if div:
            div.click()
            page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False


def click_subtab(shell_frame, page, tab_id, href_fallback):
    # Try by id
    try:
        link = shell_frame.query_selector(f'a#{tab_id}')
        if link:
            link.click()
            page.wait_for_timeout(1000)
            return True
    except Exception:
        pass

    # Try by href
    try:
        link = shell_frame.query_selector(f'a[href*="{href_fallback}"]')
        if link:
            link.click()
            page.wait_for_timeout(1000)
            return True
    except Exception:
        pass

    # Try all frames
    for frame in page.frames:
        try:
            link = (frame.query_selector(f'a#{tab_id}') or
                    frame.query_selector(f'a[href*="{href_fallback}"]'))
            if link:
                link.click()
                page.wait_for_timeout(2000)
                return True
        except Exception:
            continue

    return False


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


def scrape_current_tab(page, folder_name, section, tab_label):
    rows = []
    frame = find_landing_frame(page)
    if not frame:
        return rows

    try:
        tables = frame.query_selector_all("table")
        for table in tables:
            table_rows = extract_table(table)
            for row in table_rows:
                row["_folder"]  = folder_name
                row["_section"] = section
                row["_tab"]     = tab_label
                rows.append(row)
    except Exception:
        pass

    return rows


# ─────────────────────────────────────────────
# PER-MEMBER SCRAPE
# ─────────────────────────────────────────────

def scrape_member(page, member_number, member_id):
    """Scrape all tabs for one member. Returns dict of {suffix: filepath}."""
    folder_name = get_folder_name(member_number, member_id)
    saved = {}

    ok = navigate_to_member(page, member_id)
    if not ok:
        print(f"  Could not navigate to member {member_number}")
        return saved

    # Scrape member info fields from default landing page
    member_info = scrape_member_info_fields(page)
    append_member_info_to_profile(folder_name, member_info)

    shell = find_folio_shell_frame(page)
    if not shell:
        print(f"  Could not find folio shell for {member_number}")
        screenshot(page, f"no_shell_{folder_name}")
        return saved

    current_tabname = None

    for tab in TABS:
        tabname   = tab["tabname"]
        tab_id    = tab["tab_id"]
        tab_label = tab["tab_label"]
        suffix    = tab["suffix"]
        href_fb   = TAB_HREF_FALLBACKS.get(tab_id, "")

        try:
            # Re-open the member dropdown before every tab
            open_member_dropdown(shell, page)

            # Click section if switching
            if tabname != current_tabname:
                ok = click_section(shell, page, tabname)
                if not ok:
                    print(f"    Could not open section: {tabname}")
                current_tabname = tabname
            else:
                page.wait_for_timeout(500)

            # Click subtab
            clicked = click_subtab(shell, page, tab_id, href_fb)
            if not clicked:
                print(f"    Could not find tab: {tab_label}")
                screenshot(page, f"no_tab_{folder_name}_{suffix}")
                continue

            # Scrape
            rows = scrape_current_tab(page, folder_name, tabname, tab_label)

            # Early exit: no rooms data means nothing useful to scrape
            if suffix == "rooms" and not rows:
                print(f"    No room info — skipping remaining tabs.")
                break

            if rows:
                fp = save_tab_csv(folder_name, suffix, rows)
                if fp:
                    saved[suffix] = fp
                    print(f"    {tab_label}: {len(rows)} rows → {os.path.basename(fp)}")
                else:
                    print(f"    {tab_label}: no data saved")
            else:
                print(f"    {tab_label}: no data found")

        except Exception as e:
            print(f"    Error on {tabname} > {tab_label}: {e}")
            continue

    return saved


# ─────────────────────────────────────────────
# PARALLEL WORKER
# ─────────────────────────────────────────────

def scrape_chunk(args):
    """Worker: scrape a subset of members in its own browser instance."""
    members_chunk, worker_id = args
    results = {"success": [], "failed": [], "skipped": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_page()

        try:
            login(page)
            dismiss_notification_popup(page)

            # Load Membership module
            main_frame = get_frame_by_url(page, "default.jsp") or page
            try:
                main_frame.evaluate("changeSelModule(1,1,1,'#003565','Membership')")
            except Exception:
                pass
            page.wait_for_timeout(6000)

            # Prime landingFrame with member list
            landing = next((f for f in page.frames if f.name == "landingFrame"), None)
            if landing:
                landing.goto(LIST_MEMBERS_URL)
                page.wait_for_timeout(4000)

            for i, (member_number, member_id) in enumerate(members_chunk, 1):
                folder_name = get_folder_name(member_number, member_id)
                print(f"  [W{worker_id} | {i}/{len(members_chunk)}] {member_number} (id={member_id})")

                if already_scraped(folder_name):
                    print(f"    [W{worker_id}] Already scraped — skipping.")
                    results["skipped"].append(folder_name)
                    continue

                saved = scrape_member(page, member_number, member_id)

                if saved:
                    print(f"    [W{worker_id}] Saved {len(saved)} file(s).")
                    results["success"].append(folder_name)
                else:
                    print(f"    [W{worker_id}] Nothing saved.")
                    screenshot(page, f"failed_{folder_name}")
                    results["failed"].append(folder_name)

        except Exception as e:
            print(f"  [W{worker_id}] Fatal error: {e}")
            screenshot(page, f"worker_{worker_id}_fatal")

        finally:
            browser.close()

    return results


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build per-member journal folders.")
    parser.add_argument("--all",     action="store_true", help="Scrape all members in map")
    parser.add_argument("--limit",   type=int, default=DEFAULT_LIMIT,
                        help=f"Max members (default: {DEFAULT_LIMIT})")
    parser.add_argument("--member",  type=str, default=None,
                        help="Single member by member_number e.g. 1C")
    parser.add_argument("--id",      type=str, default=None,
                        help="Single member by portal ID e.g. 32845")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Parallel browser workers (default: {DEFAULT_WORKERS})")
    args = parser.parse_args()

    if not os.path.exists(MAP_FILE):
        print(f"ERROR: {MAP_FILE} not found. Run build_member_map.py first.")
        return

    all_members = load_member_map(MAP_FILE)
    print(f"Loaded {len(all_members)} members from map.")

    # Filter to target members
    if args.member:
        members = [(n, i) for n, i in all_members if n == args.member]
        if not members:
            print(f"Member '{args.member}' not found in map.")
            return
    elif args.id:
        members = [(n, i) for n, i in all_members if i == args.id]
        if not members:
            print(f"ID '{args.id}' not found in map.")
            return
    elif args.all:
        members = all_members
    else:
        members = all_members[:args.limit]

    print("=" * 60)
    print("Journal Scraper")
    print("=" * 60)
    print(f"Members to process: {len(members)}")
    print(f"Output: {JOURNAL_FOLDER}")

    # Single member or single worker — skip multiprocessing overhead
    if len(members) == 1 or args.workers == 1:
        print("Running in single-worker mode...")
        print()
        result = scrape_chunk((members, 1))
        all_results = [result]

    else:
        num_workers = min(args.workers, len(members))
        chunk_size  = math.ceil(len(members) / num_workers)
        chunks      = [
            (members[i : i + chunk_size], worker_id)
            for worker_id, i in enumerate(range(0, len(members), chunk_size), 1)
        ]

        print(f"Workers:    {num_workers}")
        print(f"Per worker: ~{chunk_size} members")
        print()

        with Pool(processes=num_workers) as pool:
            all_results = pool.map(scrape_chunk, chunks)

    # Merge and print summary
    success = sum(len(r["success"]) for r in all_results)
    failed  = sum(len(r["failed"])  for r in all_results)
    skipped = sum(len(r["skipped"]) for r in all_results)

    failed_names = [n for r in all_results for n in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Success: {success}")
    print(f"  Failed:  {failed}")
    print(f"  Skipped: {skipped}")
    if failed_names:
        print(f"  Failed members: {failed_names}")
    print("=" * 60)


if __name__ == "__main__":
    main()