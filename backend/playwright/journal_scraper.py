"""
journal_scraper.py — Build per-member journal folders.
For each member: scrapes Rooms (Member_Info tab, opening each
reservation popup for contact info), then Services and Statements
(Billing tab, both skipped for Guest accounts — see is_guest_folder()),
before moving to the next member. Saves:
  - rooms CSV per member
  - services CSV per member (Members only)
  - statements CSV per member (Members only — both the Homeowner and
    House and Dues Charges receivable types; see RECEIVABLE_TYPES and
    STATEMENT_MIN_DATE_BY_TYPE)
  - statement details CSV per member (itemized line items drilled from
    each kept statement period's detail page)
  - rate_details CSV per member (per-night Room Rates for each
    reservation, fetched from reservationRateDetail.do while the
    reservation popup is open — stays overlapping 2025-01-01 onward)
  - enriched profile CSV (contact/address fields filled from popup)
"""
import os
import csv
import argparse
import math
import time
import signal
import re
from datetime import datetime, date
from multiprocessing import Pool
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url


STATEMENT_MIN_DATE   = None
RATE_DETAIL_MIN_DATE = None

def parse_statement_date(val):
    """Parse the Due Date cell into a date. Returns None if unparseable."""
    val = (val or "").strip()
    if not val:
        return None
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d", "%m-%d-%Y", "%b %d, %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
MAP_FILE          = os.path.join(OUTPUT_FOLDER, "member_id_map.csv")
JOURNAL_FOLDER    = os.path.join(OUTPUT_FOLDER, "journal")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
DONE_LOG          = os.path.join(OUTPUT_FOLDER, "journal_done.txt")
# [2026-07-18] Accounts that finished with an unresolved tab — they
# are deliberately NOT written to DONE_LOG, so the next run retries
# them. This file is the audit trail of what is still outstanding.
INCOMPLETE_LOG    = os.path.join(OUTPUT_FOLDER, "journal_incomplete.txt")
LIST_MEMBERS_URL  = f"{BASE_URL}/Membership/middlePage.jsp?listView&tabId=437&tabGrpModuleID=1"

DEFAULT_LIMIT   = None
DEFAULT_WORKERS = 10

# Timeouts (ms)
NAV_TIMEOUT     = 6000
TAB_TIMEOUT     = 4000
FRAME_TIMEOUT   = 4000
CLICK_TIMEOUT   = 2000
POPUP_TIMEOUT   = 8000
TAB_MAX_RETRIES = 3

GENERIC_LABELS = {"Guests", "Dependent", "Guest", "Staff"}

# Rooms, Services, and Statements tab identifiers — all three are
# scraped in scrape_member() below, one after another, for every
# member (Services/Statements skipped for Guests — see
# is_guest_folder()).
TAB_HREF_FALLBACKS = {
    "rooms": "roomsInfo.do",
    "services": "members_enrolled_services.jsp",
    "statements": "memberStatements.jsp",
}

# Profile CSV fields to fill only if currently empty
PROFILE_CONTACT_FIELDS = {
    "Email":            "Email",
    "Home Phone":       "Home Phone",
    "Cell Phone":       "Cell Phone",
    "Address Line1":    "Address Line1",
    "Address Line2":    "Address Line2",
    "City":             "City",
    "State":            "State",
    "Postal Code":      "Postal Code",
    "Country":          "Country",
    "Complete Address": "Complete Address",
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

def log_incomplete(member_number, member_id, status):
    """
    Record an account that finished with an unresolved tab. Written
    instead of mark_done() so the account stays eligible for the
    next run — see the module note in patch_journal_scraper_2.py.
    """
    try:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        detail = ",".join(f"{k}={v}" for k, v in sorted(status.items()))
        with open(INCOMPLETE_LOG, "a", encoding="utf-8") as f:
            f.write(f"{stamp}\t{member_number}\t{member_id}\t{detail}\n")
    except Exception:
        pass

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

def strip_val(val):
    if val is None:
        return ""
    return str(val).strip()

# ─────────────────────────────────────────────
# PROFILE CSV ENRICHMENT
# ─────────────────────────────────────────────
def load_profile_csv(folder_name):
    profile_path = os.path.join(JOURNAL_FOLDER, folder_name, f"{folder_name}_profile.csv")
    if not os.path.exists(profile_path):
        return None, None, None
    try:
        with open(profile_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []
            rows = list(reader)
        return profile_path, fieldnames, rows
    except Exception as e:
        print(f"    Could not load profile CSV: {e}")
        return None, None, None

def is_guest_folder(folder_name):
    """
    True if the profile CSV says this account is a Guest, not a Member.
    Services (dues/fees) only apply to actual members — added 2026-07-02
    to skip attempting the Services tab entirely for guests, since it
    would never have anything to find there.

    Defaults to False (attempt Services) if the profile CSV is missing
    or the field is blank/unrecognized — unsure means "try it" rather
    than silently skipping someone who might actually be a member.
    """
    _, _, rows = load_profile_csv(folder_name)
    if not rows:
        return False
    value = (rows[0].get("Member / Guest") or "").strip().lower()
    return value == "guest"

def enrich_profile_csv(folder_name, contact_data, prefix=""):
    """Write contact_data into profile CSV, only filling empty/null fields."""
    profile_path, fieldnames, rows = load_profile_csv(folder_name)
    if profile_path is None or not rows:
        return False
    updated = False
    new_fieldnames = list(fieldnames)
    for col in PROFILE_CONTACT_FIELDS.values():
        if col not in new_fieldnames:
            new_fieldnames.append(col)
    for row in rows:
        for label, col in PROFILE_CONTACT_FIELDS.items():
            new_val = contact_data.get(col, "").strip()
            if not new_val:
                continue
            if not row.get(col, "").strip():
                row[col] = new_val
                updated = True
    if not updated:
        print(f"    {prefix}Profile already complete — no enrichment needed")
        return False
    try:
        with open(profile_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=new_fieldnames, extrasaction="ignore", restval=""
            )
            writer.writeheader()
            writer.writerows(rows)
        print(f"    {prefix}Profile enriched with contact/address data")
        return True
    except Exception as e:
        print(f"    {prefix}Profile CSV write failed: {e}")
        return False

# ─────────────────────────────────────────────
# MEMBER INFO FIELDS
# ─────────────────────────────────────────────
def scrape_member_info_fields(page, prefix=""):
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        return {}

    try:
        frame.wait_for_function(
            """() => {
                const el = document.querySelector('input[name="FirstName"]');
                return el && el.value && el.value.trim().length > 0;
            }""",
            timeout=4000
        )
    except Exception:
        page.wait_for_timeout(1000)

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
# FRAME FINDERS
# ─────────────────────────────────────────────
def get_landing_frame(page, timeout_ms=FRAME_TIMEOUT):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == "landingFrame":
                    _ = frame.url
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(300)
    for frame in page.frames:
        try:
            if "landing" in frame.name.lower():
                return frame
        except Exception:
            continue
    return None

def get_shell_frame(page, timeout_ms=FRAME_TIMEOUT):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.query_selector("#btnTab1"):
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(300)
    for frame in page.frames:
        try:
            if "retrieve.jsp" in frame.url:
                return frame
        except Exception:
            continue
    return None

def get_popup_frame(page, timeout_ms=POPUP_TIMEOUT):
    """Wait for the reservation popup iframe to load content."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == "DialogWindowFrame_0":
                    _ = frame.url
                    if frame.query_selector("input, select, textarea, table"):
                        return frame
            except Exception:
                continue
        page.wait_for_timeout(400)
    return None

# ─────────────────────────────────────────────
# CONTENT CHANGE DETECTION
# ─────────────────────────────────────────────
def get_landing_fingerprint(page):
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
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception:
        pass

def close_reservation_popup(page, prefix=""):
    try:
        for frame in page.frames:
            try:
                btn = frame.query_selector(
                    "#closeButtonId_0, "
                    "button[onclick='closeJQueryDialog()'], "
                    "button[data-dismiss='modal']"
                )
                if btn:
                    btn.click()
                    page.wait_for_timeout(600)
                    return True
            except Exception:
                continue
        try:
            page.evaluate("closeJQueryDialog()")
            page.wait_for_timeout(600)
            return True
        except Exception:
            pass
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        return True
    except Exception as e:
        print(f"    {prefix}Popup close error: {e}")
        return False

# ─────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────
def navigate_to_member(page, member_id, prefix=""):
    url = f"{BASE_URL}/Membership/retrieve.jsp?memberid={member_id}"
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        print(f"  {prefix}landingFrame not found")
        return False
    try:
        landing.goto(url)
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
# TAB NAVIGATION
# ─────────────────────────────────────────────
def open_member_dropdown(shell_frame, page):
    try:
        btn = shell_frame.query_selector("#btnTab1")
        if btn:
            btn.click()
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
    try:
        div = shell_frame.query_selector(f'div[tabname="{tabname}"]')
        if div:
            div.click()
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
    fingerprint_before = get_landing_fingerprint(page)
    try:
        link.click()
    except Exception as e:
        print(f"    {prefix}Click failed on {tab_id}: {e}")
        return False
    changed = wait_for_content_change(page, fingerprint_before, timeout_ms=TAB_TIMEOUT)
    if not changed:
        print(f"    {prefix}Content did not change after clicking {tab_id}")
    return True

# ─────────────────────────────────────────────
# EXTRACTION HELPERS
# ─────────────────────────────────────────────
def get_input_val(frame, selector):
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = frame.query_selector(sel)
            if el:
                val = strip_val(el.evaluate("el => el.value || el.innerText || ''"))
                if val:
                    return val
        except Exception:
            continue
    return ""

def get_select_text(frame, selector):
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = frame.query_selector(sel)
            if el:
                val = strip_val(el.evaluate(
                    "(el) => el.options[el.selectedIndex] "
                    "? el.options[el.selectedIndex].text : ''"
                ))
                if val:
                    return val
        except Exception:
            continue
    return ""

def get_textarea_val(frame, selector):
    for sel in [s.strip() for s in selector.split(",")]:
        try:
            el = frame.query_selector(sel)
            if el:
                val = strip_val(el.evaluate("el => el.value || el.innerText || ''"))
                if val:
                    return val
        except Exception:
            continue
    return ""

def dump_popup_fields(frame, conf_code, prefix=""):
    """Debug: print every input/select/textarea name+value in the popup."""
    print(f"    {prefix}[DEBUG] Popup field dump for conf {conf_code}:")
    try:
        elements = frame.query_selector_all("input, select, textarea")
        for el in elements:
            try:
                tag  = el.evaluate("el => el.tagName.toLowerCase()")
                name = el.get_attribute("name") or el.get_attribute("id") or "(no name)"
                if tag == "select":
                    val = strip_val(el.evaluate(
                        "(el) => el.options[el.selectedIndex] "
                        "? el.options[el.selectedIndex].text : ''"
                    ))
                else:
                    val = strip_val(el.get_attribute("value") or el.inner_text() or "")
                print(f"      [{tag}] name={name!r:30s}  val={val!r}")
            except Exception:
                continue
    except Exception as e:
        print(f"    {prefix}[DEBUG] dump failed: {e}")

def extract_table(table_el):
    """
    Extract a <table> into a list of row dicts — same output shape as
    before (keyed by header text, or col_0/col_1/... when headers don't
    line up with the row's cell count).

    Rewritten 2026-07-03 to do the whole extraction in ONE JavaScript
    evaluate() call instead of looping in Python with .inner_text() on
    every individual <th>/<td> — each of those was a separate
    synchronous round-trip to the browser, so a 40-row x 8-column table
    was 300+ round-trips. This does the equivalent logic natively
    in-page and returns the finished result in a single call. Same
    logic as the original Python loop, just executed where the DOM
    already lives instead of round-tripping cell-by-cell.
    """
    try:
        return table_el.evaluate("""
            (table) => {
                const clean = (el) => (el.innerText || '').trim();
                let headers = Array.from(table.querySelectorAll('th')).map(clean);
                if (headers.length === 0) {
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        headers = Array.from(firstRow.querySelectorAll('td')).map(clean);
                    }
                }
                const allRows = Array.from(table.querySelectorAll('tr'));
                const start = headers.length > 0 ? 1 : 0;
                const out = [];
                for (let i = start; i < allRows.length; i++) {
                    const cells = Array.from(allRows[i].querySelectorAll('td')).map(clean);
                    if (!cells.some(c => c)) continue;
                    const obj = {};
                    if (headers.length > 0 && cells.length === headers.length) {
                        headers.forEach((h, idx) => { obj[h] = cells[idx]; });
                    } else {
                        cells.forEach((c, idx) => { obj['col_' + idx] = c; });
                    }
                    out.push(obj);
                }
                return out;
            }
        """)
    except Exception as e:
        return [{"error": str(e)}]

# ─────────────────────────────────────────────
# RESERVATION POPUP — contact data only
# ─────────────────────────────────────────────
def scrape_reservation_popup(page, conf_code, prefix=""):
    """
    Scrape contact/address data from the reservation popup.
    Returns contact_data dict, or None on failure.
    """
    popup_frame = get_popup_frame(page, timeout_ms=POPUP_TIMEOUT)
    if not popup_frame:
        print(f"    {prefix}Popup frame not found for conf {conf_code}")
        return None

    # Wait for JS to finish populating fields before reading anything
    try:
        popup_frame.wait_for_function(
            """() => {
                const el = document.querySelector(
                    '#memberName, input[name="memberName"], #guestName'
                );
                return el && el.value && el.value.trim().length > 0;
            }""",
            timeout=6000
        )
    except Exception:
        page.wait_for_timeout(1500)

    print(f"    {prefix}Scraping popup for conf {conf_code}...")

    try:
        # ── Contact fields ─────────────────────────────────────────
        home_phone = get_input_val(popup_frame,
            "input[name='homePhone'], input[id='homePhone'], "
            "input[name='phone'],     input[id='phone']"
        )
        cell_phone = get_input_val(popup_frame,
            "input[name='cellPhone'],   input[id='cellPhone'], "
            "input[name='mobilePhone'], input[id='mobilePhone']"
        )
        email = get_input_val(popup_frame,
            "input[name='emailAddress'], input[id='primaryEmail'], "
            "input[name='email'],        input[id='email'], "
            "input[type='email']"
        )

        # ── Address ────────────────────────────────────────────────
        address_raw = get_textarea_val(popup_frame,
            "textarea[id='contactInfo'], textarea[name='contactInfo'], "
            "textarea[name='addressInfo'], #addressInfo, .addressDisplay, "
            "textarea[name='address'],     #address"
        )
        addr1 = addr2 = city = state = zip_ = country = ""
        if address_raw:
            lines = [l.strip() for l in address_raw.replace("\r", "\n").split("\n") if l.strip()]
            addr1 = lines[0] if lines else ""
            if len(lines) > 1:
                m = re.match(
                    r'^(.+?),\s*([A-Z]{2,3})\.?\s+([\w\s\-]+?)\s+([\w\s]+)$',
                    lines[1]
                )
                if m:
                    city    = m.group(1).strip()
                    state   = m.group(2).strip()
                    zip_    = m.group(3).strip()
                    country = m.group(4).strip()
                else:
                    city = lines[1]
        else:
            addr1   = get_input_val(popup_frame, "input[name='addr1'], input[id='addr1'], input[name='address1']")
            addr2   = get_input_val(popup_frame, "input[name='addr2'], input[id='addr2'], input[name='address2']")
            city    = get_input_val(popup_frame, "input[name='city'],  input[id='city']")
            state   = get_input_val(popup_frame, "input[name='state'], input[id='state']")
            zip_    = get_input_val(popup_frame, "input[name='zip'],   input[name='postalCode'], input[id='postalCode']")
            country = get_input_val(popup_frame, "input[name='country'], input[id='country']")

        # ── Debug dump when contact fields are all empty ───────────
        if not any([home_phone, cell_phone, email, addr1]):
            dump_popup_fields(popup_frame, conf_code, prefix)

        return {
            "Email":            email,
            "Home Phone":       home_phone,
            "Cell Phone":       cell_phone,
            "Address Line1":    addr1,
            "Address Line2":    addr2,
            "City":             city,
            "State":            state,
            "Postal Code":      zip_,
            "Country":          country,
            "Complete Address": address_raw,
        }

    except Exception as e:
        print(f"    {prefix}Popup scrape error for conf {conf_code}: {e}")
        return None

# ─────────────────────────────────────────────
# RESERVATION POPUP — per-night rate details
# ─────────────────────────────────────────────
# Added 2026-07-12, per request. While the reservation popup
# (updateReservation.do) is open, its hidden fields hold everything
# needed to build the Rate Details URL that the "Rate Range" button
# opens (reservationRateDetail.do?operation=fetchForPopUp&...). Rather
# than clicking through a nested dialog, we fetch that page directly
# in-browser (same session cookies) and parse tbody#rateTable with
# DOMParser — one fetch per reservation, no extra dialog juggling.
# Output shape mirrors scrape_rate_revenue.py's parse_rate_html():
#   Conf. Code, Reservation ID, Member #, Guest Name, Room #,
#   Villa Name, Bedroom Count, Source, Payment Type, Check-In Date,
#   Check-Out Date, Reservation Status, Date, Rate Name,
#   Original Amount, Modified Amount, Addon Amount, Discounted Amount,
#   Total Amount, Status, Total Rental
# Stays whose Check-Out Date is entirely before RATE_DETAIL_MIN_DATE
# are skipped; within kept stays, nightly rows are not date-filtered
# (a stay overlapping the window keeps all its nights so totals still
# reconcile against Total Rental).

_RATE_FETCH_JS = """
async (url) => {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return { error: 'HTTP ' + resp.status };
    const text = await resp.text();
    const doc  = new DOMParser().parseFromString(text, 'text/html');
    const tbody = doc.querySelector('tbody#rateTable');
    if (!tbody) return { error: 'no rateTable' };
    const totalEl = doc.querySelector('td#totalRental');
    const total   = totalEl ? (totalEl.textContent || '').trim() : '';
    const rows = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        const dateInput = tr.querySelector("input[name='resRateDate']");
        if (!dateInput) return;
        const cells = tr.querySelectorAll('td');
        const cellText = (i) => {
            if (i >= cells.length) return '';
            const inp = cells[i].querySelector("input[type='text']");
            if (inp) return (inp.value || '').trim();
            return (cells[i].textContent || '').trim();
        };
        // Cell indices (hidden cells still present in HTML):
        // 0=Date, 1=RateName, 2=CurrOcc%(hidden), 3=OriginalAmt,
        // 4=ModifiedAmt(input), 5=PackageAmt(hidden), 6=Qty(hidden),
        // 7=AddonAmt, 8=DiscountedAmt, 9=TotalAmt, 10=Status
        rows.push({
            date:        (dateInput.value || '').trim(),
            rate_name:   cellText(1),
            original:    cellText(3),
            modified:    cellText(4),
            addon:       cellText(7),
            discounted:  cellText(8),
            total:       cellText(9),
            status:      cellText(10),
        });
    });
    return { rows: rows, total_rental: total };
}
"""

def scrape_reservation_rate_details(page, conf_code, reservation_id,
                                    room_row, folder_name, prefix=""):
    """
    Fetch and parse the per-night Rate Details for the reservation whose
    popup is currently open. Returns a list of row dicts (one per night)
    in the folio-report style, or [] on any failure / out-of-window stay.
    """
    popup_frame = get_popup_frame(page, timeout_ms=3000)
    if not popup_frame:
        return []

    def hidden(*names):
        for n in names:
            try:
                el = popup_frame.query_selector(
                    f"input[name='{n}'], input[id='{n}']"
                )
                if el:
                    v = strip_val(el.get_attribute("value"))
                    if v and v != "0":
                        return v
            except Exception:
                continue
        return ""

    res_id      = reservation_id or hidden("reservationId")
    member_id   = hidden("memberId", "savedMemberId")
    room_type   = hidden("roomTypeId", "roomTypeIdTemp",
                         "parentWindowRoomTypeId", "parentWindowRateId")
    from_date   = hidden("checkInDate", "fromDate")
    to_date     = hidden("checkOutDate", "toDate")
    tax_exempt  = hidden("isTaxExempt") or "false"
    # memberType must be the NUMERIC id (e.g. 2) — memberTypeString
    # holds display text like "Proprietary Members" which 500s the
    # endpoint. Prefer memberTypeId; fall back through the others but
    # only accept a numeric value.
    member_type = ""
    for cand in (hidden("memberTypeId"), hidden("savedMemberType"),
                 hidden("memberTypeString")):
        if cand and cand.isdigit():
            member_type = cand
            break
    if not member_type:
        member_type = "1"
    is_perm     = hidden("isPermanent") or "false"
    age_group   = hidden("ageGroupPersonCount") or "1_1,2_0"
    # The endpoint expects a count pair for EVERY age group
    # (e.g. "1_5,2_0"); the popup sometimes exposes only the adult
    # group ("1_5"), which 500s the endpoint — pad the child group.
    if "," not in age_group:
        age_group = f"{age_group},2_0"

    # Fall back to the rooms-table row for dates the popup doesn't expose
    if not from_date:
        from_date = strip_val(room_row.get("Check-In Date", "") or
                              room_row.get("Check In Date", "") or
                              room_row.get("Check-In", ""))
    if not to_date:
        to_date = strip_val(room_row.get("Check-Out Date", "") or
                            room_row.get("Check Out Date", "") or
                            room_row.get("Check-Out", ""))

    if not res_id or not room_type:
        print(f"    {prefix}Rate details: missing reservationId/roomTypeId "
              f"for conf {conf_code} — skipping")
        return []

    # Skip stays that ended entirely before the window
    co = parse_statement_date(to_date)
    if RATE_DETAIL_MIN_DATE is not None and co is not None and co < RATE_DETAIL_MIN_DATE:
        return []

    villa_name = ""
    try:
        el = popup_frame.query_selector("input[name='roomTypeName']")
        if el:
            villa_name = strip_val(el.get_attribute("value"))
    except Exception:
        pass
    source_txt = get_select_text(
        popup_frame, "select[name='businessSource'], #businessSource"
    )
    guest_name = get_input_val(
        popup_frame,
        "input[name='guestName'], #guestName, "
        "input[name='memberName'], #memberName"
    )

    qs = (
        f"operation=fetchForPopUp"
        f"&RateId={room_type}&RoomTypeId={room_type}"
        f"&fromDate={from_date}&toDate={to_date}"
        f"&reservationId={res_id}&memberId={member_id}"
        f"&isTaxExempt={tax_exempt}&isWalkIn=false&showGroupRates=false"
        f"&memberType={member_type}&fromOtherModule=true"
        f"&isPermanent={is_perm}&rateType=null&isGuestCard=false"
        f"&ageGroupPersonCount={age_group}"
    )
    rate_url = f"{BASE_URL}/PMS/reservationRateDetail.do?{qs}"

    try:
        result = popup_frame.evaluate(_RATE_FETCH_JS, rate_url)
    except Exception as e:
        print(f"    {prefix}Rate details fetch failed for conf {conf_code}: {e}")
        return []

    if not result or result.get("error"):
        err = (result or {}).get("error", "empty response")
        print(f"    {prefix}Rate details: {err} for conf {conf_code}")
        print(f"    {prefix}  URL was: {rate_url}")
        return []

    total_rental = result.get("total_rental", "")
    out = []
    for r in result.get("rows", []):
        out.append({
            "Conf. Code":         conf_code,
            "Reservation ID":     res_id,
            "Member #":           folder_name,
            "Guest Name":         guest_name or strip_val(room_row.get("Guest Name", "")),
            "Room #":             strip_val(room_row.get("Room #", "") or
                                            room_row.get("Room Number", "") or
                                            room_row.get("Room", "")),
            "Villa Name":         villa_name,
            "Bedroom Count":      "",
            "Source":             source_txt,
            "Payment Type":       "",
            "Check-In Date":      from_date or strip_val(room_row.get("Check-In Date", "")),
            "Check-Out Date":     to_date or strip_val(room_row.get("Check-Out Date", "")),
            "Reservation Status": strip_val(room_row.get("Status", "") or
                                            room_row.get("Reservation Status", "")),
            "Date":               r["date"],
            "Rate Name":          r["rate_name"],
            "Original Amount":    r["original"],
            "Modified Amount":    r["modified"],
            "Addon Amount":       r["addon"],
            "Discounted Amount":  r["discounted"],
            "Total Amount":       r["total"],
            "Status":             r["status"],
            "Total Rental":       total_rental,
        })

    if out:
        print(f"    {prefix}Rate details: {len(out)} night(s) for conf {conf_code}")
    return out

# ─────────────────────────────────────────────
# ROOMS TAB
# ─────────────────────────────────────────────
def scrape_rooms_with_popups(page, folder_name, prefix=""):
    """
    1. Scrape the rooms table rows.
    2. For each row, click the confirmation code link to open the popup.
    3. Extract contact info AND per-night rate details from the popup.
    4. Close the popup and move to the next row.
    Returns (success, room_rows, merged_contact_data, rate_rows)
    success=True:
        Rooms page loaded correctly, even if it contains no records.
    success=False:
        Frame/table/page failed to load or an unexpected error occurred.
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}Rooms page failed: landing frame not found")
        return False, [], {}, []

    room_rows      = []
    merged_contact = {}
    rate_rows      = []

    try:
        tables = frame.query_selector_all("table")
        if not tables:
            print(f"    {prefix}No tables found in rooms tab")
            return True, [], {}, []

        for table in tables:
            for row in extract_table(table):
                row["_folder"]  = folder_name
                row["_section"] = "Member_Info"
                row["_tab"]     = "Rooms"
                room_rows.append(row)

        if not room_rows:
            print(f"    {prefix}Rooms table is empty")
            return True, [], {}, []

        print(f"    {prefix}Found {len(room_rows)} room row(s) — opening popups...")

        for i, room_row in enumerate(room_rows, 1):
            conf_code = (
                room_row.get("Confirmation Code") or
                room_row.get("Conf. Code") or
                room_row.get("col_0") or
                ""
            ).strip()

            if not conf_code:
                print(f"    {prefix}Row {i}: no conf code — skipping popup")
                continue

            print(f"    {prefix}Row {i}/{len(room_rows)}: conf {conf_code}")

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Rooms page failed: Lost landing frame at row {i}")
                return False, room_rows, merged_contact, rate_rows

            # Click the confirmation code link — the link's
            # openReservation(N) argument is the reservationId, capture
            # it for the rate-details fetch.
            clicked = False
            reservation_id = ""
            try:
                for link in frame.query_selector_all("a"):
                    try:
                        if strip_val(link.inner_text()) == conf_code:
                            blob = ((link.get_attribute("href") or "") +
                                    (link.get_attribute("onclick") or ""))
                            m = re.search(r"openReservation\((\d+)\)", blob)
                            if m:
                                reservation_id = m.group(1)
                            link.click()
                            clicked = True
                            break
                    except Exception:
                        continue
                if not clicked:
                    link = frame.query_selector(
                        f"a[href*='reservationId={conf_code}'], "
                        f"a[onclick*='{conf_code}']"
                    )
                    if link:
                        blob = ((link.get_attribute("href") or "") +
                                (link.get_attribute("onclick") or ""))
                        m = re.search(r"openReservation\((\d+)\)", blob)
                        if m:
                            reservation_id = m.group(1)
                        link.click()
                        clicked = True
            except Exception as e:
                print(f"    {prefix}Click error for conf {conf_code}: {e}")

            if not clicked:
                print(f"    {prefix}Could not click conf code {conf_code} — skipping popup")
                continue

            contact_data = scrape_reservation_popup(page, conf_code, prefix)
            if contact_data:
                for col, val in contact_data.items():
                    if val and not merged_contact.get(col):
                        merged_contact[col] = val

            # Per-night rate details — fetched while the popup is still
            # open (its hidden fields supply the fetch parameters).
            try:
                res_rates = scrape_reservation_rate_details(
                    page, conf_code, reservation_id, room_row,
                    folder_name, prefix
                )
                if res_rates:
                    rate_rows.extend(res_rates)
            except Exception as e:
                print(f"    {prefix}Rate details error for conf {conf_code}: {e}")

            close_reservation_popup(page, prefix)
            page.wait_for_timeout(800)

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Rooms page failed: " "Landing frame lost after closing popup — stopping")
                return False, room_rows, merged_contact, rate_rows

    except Exception as e:
        print(f"    {prefix}Rooms+popup scrape error: {e}")
        return False, room_rows, merged_contact, rate_rows

    return True, room_rows, merged_contact, rate_rows

# ─────────────────────────────────────────────
# SERVICES TAB (Billing > Services)
# ─────────────────────────────────────────────
# Integrated into the main scraper 2026-07-02 — previously a separate
# interim script (services_scraper.py) that ran independently, now folded
# directly into scrape_member() below so Rooms and Services both happen
# before moving to the next member, sharing one done-log/one browser
# session per member instead of two full separate passes over everyone.

# The real Services table's column headers, per the actual page. A table
# is only trusted as "the Services table" if its headers overlap enough
# with this set, or it's explicitly the "No matching records found"
# empty state — guards against unrelated tables (address widgets, hidden
# dialog-framework <script> blobs) that can also be present on the page
# getting scraped as if they were service data, which happened before
# this check existed.
EXPECTED_SERVICES_HEADERS = {
    "Name", "Type", "Frequency", "Start Date", "Billed Upto", "End Date", "Amount"
}

def scrape_services(page, folder_name, prefix=""):
    """
    Extract the Billing > Services table: Name, Type, Frequency,
    Start Date, Billed Upto, End Date, Amount. No popups needed here,
    unlike Rooms — every column we want is already in the table itself.

    Returns (success, service_rows).
      success=True:  Services page loaded correctly, even with 0 records.
      success=False: frame/table/page failed to load, no recognizable
                      Services table was found, or an unexpected error
                      occurred.
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}Services page failed: landing frame not found")
        return False, []

    try:
        tables = frame.query_selector_all("table")
        if not tables:
            # The real Services table always renders something, even
            # just the "No matching records found" empty state — zero
            # tables on the page means we're not actually on Services.
            print(f"    {prefix}No tables found — likely didn't land on the Services tab")
            return False, []

        matched_rows = None
        for table in tables:
            table_rows = extract_table(table)
            if not table_rows:
                continue

            headers = set(table_rows[0].keys())
            overlap = headers & EXPECTED_SERVICES_HEADERS
            if len(overlap) >= 4:
                matched_rows = table_rows
                break

            cell_values = {str(v).strip().lower() for row in table_rows for v in row.values()}

            # Confirmed empty state — the page loaded fine and told us
            # there's genuinely nothing there. Safe to record as [].
            if "no matching records found" in cell_values:
                matched_rows = []
                break

            # Error state (added 2026-07-02) — the page failed to load,
            # NOT a confirmation of "no services". Must NOT be recorded
            # as an empty result — that would wrongly mark a member as
            # "checked, has nothing" when we actually don't know. Fall
            # through to the retry path instead.
            if "unable to process this request" in cell_values:
                print(f"    {prefix}Page showed an error state ('Unable to process this request') — will retry")
                return False, []

        if matched_rows is None:
            print(f"    {prefix}No recognizable Services table found on page")
            return False, []

        service_rows = []
        for row in matched_rows:
            row["_folder"]  = folder_name
            row["_section"] = "Billing"
            row["_tab"]     = "Services"
            service_rows.append(row)

        if not service_rows:
            print(f"    {prefix}Services table is empty")
        else:
            print(f"    {prefix}Found {len(service_rows)} service row(s)")

    except Exception as e:
        print(f"    {prefix}Services scrape error: {e}")
        return False, []

    return True, service_rows

# ─────────────────────────────────────────────
# STATEMENTS TAB (Billing > Statements)
# ─────────────────────────────────────────────
# Changed 2026-07-12, per request:
#   - HOMEOWNER receivable type only (value=2). House and Dues Charges
#     (value=1) is no longer pulled. The page defaults to Homeowner, so
#     the dropdown is only touched if it isn't already on value=2.
#
# SUPERSEDED — House and Dues Charges (value=1) IS pulled again. It is a
# separate AR account whose history often runs years either side of the
# member's Homeowner history (4B: Homeowner from May 2021, House & Dues
# Oct 2019 - Oct 2022). Where both cover the same statement MONTH the
# portal repeats the charges, so Homeowner wins and the House & Dues
# period is dropped before its detail page is ever opened — see the
# overlap suppression block in scrape_statements(). House & Dues is
# there to EXTEND the history, never to restate it.
#
# Two consequences worth knowing:
#   - Ordering matters. Homeowner must stay first in RECEIVABLE_TYPES;
#     a type can only defer to one already scraped.
#   - Accounts with no receivable-type dropdown can only ever show the
#     default type, so House & Dues is skipped there rather than
#     scraped and mislabelled.
#   - Only statement periods with Due Date >= 2025-01-01 are kept
#     (STATEMENT_MIN_DATE). Rows with unparseable dates are kept rather
#     than silently dropped.
#   - Statement DETAILS are pulled again: for every kept summary row,
#     the period's detail page is opened and its itemized line-item
#     table (DATE, REF. / TRANSACTION ID, DESCRIPTION, CHARGE,
#     Surcharge, Service Charge, SALES TAX, AMOUNT) is extracted,
#     tagged with _receivable_type / _statement_period /
#     _statement_due_date, and saved to {folder}_statement_details.csv
#     — the exact shape cleaner.py's load_statement_details() expects.
#     The per-period page cost is acceptable now that scope is limited
#     to Homeowner + 2025-onward + non-guest + services-nonempty
#     accounts.

EXPECTED_STATEMENTS_HEADERS = {"Statement Periods", "Due Date", "Amount Due"}

# Homeowner FIRST: the statements page loads on it, so it costs no
# dropdown interaction and the existing scrape path is unchanged. House
# and Dues Charges (value 1) is a separate AR account with its own, often
# much longer, history — for some members it predates Homeowner by years
# (e.g. 4B: Homeowner from May 2021, House & Dues from Oct 2019).
RECEIVABLE_TYPES = [
    ("2", "Homeowner"),
    ("1", "House and Dues Charges"),
]

# The value the statements page loads on with no dropdown interaction.
# Accounts that render without the dropdown at all (e.g. 35A) show THIS
# type — which is why any other type must be skipped on those pages
# rather than scraped and mislabelled. See scrape_statements().
DEFAULT_RECEIVABLE_VALUE = "2"

# Per-type statement floor, falling back to STATEMENT_MIN_DATE. Two
# receivable types means roughly twice the per-period detail page loads;
# this bounds that. None = no floor.
STATEMENT_MIN_DATE_BY_TYPE = {
    "Homeowner":              STATEMENT_MIN_DATE,
    "House and Dues Charges": None,
}

# Overlap resolution. A type listed as a key yields to the types in its
# value: for any statement MONTH both cover, only the higher-priority one
# is kept. House & Dues and Homeowner are separate AR accounts that
# genuinely repeat the same charges where their histories overlap, so
# without this the same fee is stored twice and every SUM double-counts.
#
# Homeowner wins because it is the account the dues tabs were built
# against. House & Dues is pulled to EXTEND history either side of it,
# not to restate it.
#
# Depends on RECEIVABLE_TYPES putting Homeowner first — a type can only
# yield to one already scraped. Reordering that list disables this
# silently, which is why the check below refuses to run when the type
# being deferred to has not succeeded.
RECEIVABLE_PRIORITY = {
    "House and Dues Charges": ("Homeowner",),
}

EXPECTED_DETAIL_HEADER_WORDS = {"DATE", "DESCRIPTION", "AMOUNT", "CHARGE"}

# ─────────────────────────────────────────────
# STATEMENTS PAGE IDENTITY  [patch]
# ─────────────────────────────────────────────
# The receivable-type dropdown cannot answer "am I on the summary page?".
# Dropdown-less accounts (35A) are legitimate, and a dead or navigated
# frame looks identical to one — which is why drilling 62 periods made
# the next receivable type report "no dropdown" when the dropdown was
# there all along. Check for the summary grid itself instead.

def on_statements_summary(frame):
    """True only if `frame` is alive AND showing the statements summary."""
    if frame is None:
        return False
    try:
        if frame.query_selector('select[name="arAccountTypeId"]'):
            return True
        return bool(frame.evaluate(
            "() => { const t = document.body ? document.body.innerText : '';"
            "  return t.includes('Statement Period')"
            "      || t.includes('Statement Periods')"
            "      || t.includes('No matching records found'); }"
        ))
    except Exception:
        return False        # dead frame — definitively not on the page


def reopen_statements_tab(page, prefix=""):
    """
    Re-navigate to Billing > Statements and return a live landing frame on
    the summary grid, or None. Called between receivable types, because
    drilling leaves the page somewhere else entirely.
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if on_statements_summary(frame):
        return frame
    shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not shell:
        print(f"    {prefix}Statements: shell frame lost — cannot reopen tab")
        return None
    open_member_dropdown(shell, page)
    click_section(shell, page, "Billing")
    if not click_subtab(shell, page, "memberStatements",
                        TAB_HREF_FALLBACKS["statements"], prefix):
        return None
    deadline = time.time() + 6
    while time.time() < deadline:
        frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
        if on_statements_summary(frame):
            return frame
        page.wait_for_timeout(400)
    return None


def scrape_statement_detail_table(frame):
    """
    Extract the itemized detail table from a statement period's detail
    page (statementNonPrintable.jsp). Returns:
      rows  — the line items (list of dicts keyed by header text)
      []    — confirmed-empty state
      None  — no recognizable detail table on the page (not loaded yet,
              or we're not on the detail page at all)
    The small header tables on that page (MEMBER NO./DATE/PAGE and
    BALANCE DUE/DUE DATE) don't overlap enough with
    EXPECTED_DETAIL_HEADER_WORDS to false-match.
    """
    for table in frame.query_selector_all("table"):
        table_rows = extract_table(table)
        if not table_rows:
            continue
        headers = {str(h).strip().upper() for h in table_rows[0].keys()}
        if len(headers & EXPECTED_DETAIL_HEADER_WORDS) >= 3:
            return table_rows
        cell_values = {str(v).strip().lower() for row in table_rows for v in row.values()}
        if "no matching records found" in cell_values:
            return []
    return None


def drill_statement_details(page, folder_name, label, summary_rows, prefix="",
                            receivable_value=None):
    """
    Returns (detail_rows, completed).

    completed=False means the drill stopped early — dead frame, lost
    summary page, or an unexpected error. detail_rows still holds every
    line collected up to that point; they are NOT discarded (they were,
    before this patch: an exception here escaped to the caller's except
    block and threw away the whole drill). The caller must treat
    completed=False as a failed tab so the member is retried, rather
    than banking a partial statement history as though it were whole.
    """
    detail_rows = []
    completed = True
    try:
        for srow in summary_rows:
            period = (strip_val(srow.get("Statement Periods", "")) or
                      strip_val(srow.get("Statement Period", "")))
            due_date = strip_val(srow.get("Due Date", ""))
            if not period:
                continue

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Details: landing frame lost before {period}")
                completed = False
                break

            # Re-assert the receivable type before every period click:
            # history.back() can land on a page reverted to the Homeowner
            # default, and both types carry identically labelled periods
            # where their histories overlap.
            if receivable_value is not None:
                try:
                    dd = frame.query_selector('select[name="arAccountTypeId"]')
                    if dd:
                        current = (dd.evaluate("el => el.value") or "").strip()
                        if current != receivable_value:
                            dd.select_option(value=receivable_value)
                            page.wait_for_timeout(1500)
                            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
                            if not frame:
                                print(f"    {prefix}Details: frame lost re-selecting {label}")
                                completed = False
                                break
                except Exception as e:
                    print(f"    {prefix}Details: could not re-select {label}: {e}")
                    completed = False
                    break

            link = None
            try:
                for a in frame.query_selector_all("a"):
                    try:
                        if strip_val(a.inner_text()) == period:
                            link = a
                            break
                    except Exception:
                        continue
            except Exception as e:
                # Frame died mid-scan. Previously this fell through to
                # "no link found for period X — skipping", which reads
                # like a missing statement rather than a lost session.
                print(f"    {prefix}Details: frame lost scanning for {period}: {e}")
                completed = False
                break

            if not link:
                print(f"    {prefix}Details: no link found for period {period} — skipping")
                continue

            try:
                link.click()
            except Exception as e:
                print(f"    {prefix}Details: click failed for {period}: {e}")
                continue

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            rows = None
            deadline = time.time() + 6
            while time.time() < deadline:
                if frame:
                    try:
                        rows = scrape_statement_detail_table(frame)
                    except Exception:
                        rows = None
                    if rows is not None:
                        break
                page.wait_for_timeout(400)
                frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)

            if rows is None:
                print(f"    {prefix}Details: no detail table for {period}")
            else:
                for r in rows:
                    r["_folder"]             = folder_name
                    r["_section"]            = "Billing"
                    r["_tab"]                = "StatementDetails"
                    r["_receivable_type"]    = label
                    r["_statement_period"]   = period
                    r["_statement_due_date"] = due_date
                    detail_rows.append(r)
                print(f"    {prefix}Details ({period}): {len(rows)} line(s)")

            try:
                frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
                if frame:
                    frame.evaluate("history.back()")
            except Exception:
                pass

            back_ok = False
            deadline = time.time() + 5
            while time.time() < deadline:
                frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
                if on_statements_summary(frame):
                    back_ok = True
                    break
                page.wait_for_timeout(400)

            if not back_ok:
                print(f"    {prefix}Details: could not return to summary after "
                      f"{period} — stopping drill")
                completed = False
                break

    except Exception as e:
        print(f"    {prefix}Details: drill aborted ({e}) — "
              f"keeping {len(detail_rows)} line(s) already collected")
        completed = False

    return detail_rows, completed


def scrape_statements(page, folder_name, prefix=""):
    """
    Extract the Billing > Statements summary table for the Homeowner
    receivable type only (see RECEIVABLE_TYPES), keeping periods with
    Due Date >= STATEMENT_MIN_DATE, then drill each kept period's
    detail page for itemized line items.

    Returns (success, statement_rows, statement_detail_rows).
      success=True:  the summary table loaded correctly (even with 0
                      records). Detail drilling failures do not flip
                      success — summary rows already captured are kept.
      success=False: frame/dropdown failed entirely, or no recognizable
                      summary table was found.
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}Statements page failed: landing frame not found")
        return False, [], []

    all_rows        = []
    all_detail_rows = []
    any_type_succeeded = False
    # [patch] False if any drill stopped early — returned as the
    # success flag so a partial statement history fails the tab.
    all_details_complete = True
    # Types that produced a usable table this pass. Overlap suppression
    # reads this to confirm the type it defers to actually loaded —
    # an empty result and a failed page load must not look the same.
    types_succeeded = set()

    for value, label in RECEIVABLE_TYPES:
        # [patch] Drilling the previous type navigated away and can
        # destroy this frame's execution context. Without this, the
        # dropdown check below runs against a dead frame and reports
        # "no dropdown" for an account that has one.
        frame = reopen_statements_tab(page, prefix)
        if frame is None:
            print(f"    {prefix}Statements: could not return to the "
                  f"summary page for {label} — skipping this type")
            continue
        try:
            # Explicitly wait for the dropdown itself before touching it
            # — the generic "did content change" check in click_subtab()
            # only confirms SOME content changed, not that this specific
            # element has finished rendering yet.
            try:
                frame.wait_for_selector('select[name="arAccountTypeId"]', timeout=2500)
            except Exception:
                pass

            dropdown = frame.query_selector('select[name="arAccountTypeId"]')
            if dropdown:
                current = (dropdown.evaluate("el => el.value") or "").strip()
                if current != value:
                    dropdown.select_option(value=value)
                    page.wait_for_timeout(1500)

                    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
                    if not frame:
                        print(f"    {prefix}Statements: landing frame lost after switching to {label}")
                        continue

                    # Confirm the switch survived the reload. A page that
                    # silently reverted to the default would otherwise be
                    # scraped as though it were this type.
                    check = frame.query_selector('select[name="arAccountTypeId"]')
                    if check:
                        now = (check.evaluate("el => el.value") or "").strip()
                        if now != value:
                            print(f"    {prefix}Statements: {label} did not stick (value is '{now}') — skipping this type")
                            continue
                # else: already on Homeowner (its default) — table is
                # ready as-is, no reload needed
            else:
                # [2026-07-18] Dropdown is OPTIONAL: some accounts'
                # statements pages render without it (e.g. 35A) and the
                # page defaults to Homeowner anyway — proceed straight
                # to the table instead of failing the whole tab.
                #
                # [House & Dues] That reasoning only holds for the type
                # the page actually defaults to. For any other type there
                # is no way to reach its table, and scraping the default
                # one here would write Homeowner rows tagged as House and
                # Dues Charges — indistinguishable from real data
                # downstream. Skip this type; the other still runs.
                if value != DEFAULT_RECEIVABLE_VALUE:
                    print(f"    {prefix}Statements: no dropdown — cannot reach {label}, skipping this type")
                    continue
                print(f"    {prefix}Statements: no receivable-type dropdown — page defaults to {label}, proceeding")

            tables = frame.query_selector_all("table")
            # [patch3] Zero tables is only a FAILURE if we are not on the
            # statements summary page. Accounts exist whose Homeowner view
            # renders with the receivable-type dropdown but no table at all
            # — that is an empty type, not a broken page. Falling through
            # with an empty list lets the loop below leave matched_rows as
            # None, which patch 2 records as a confirmed-empty success, so
            # the overlap guard stops blocking House and Dues Charges.
            if not tables and not on_statements_summary(frame):
                print(f"    {prefix}Statements: no tables found for {label}")
                continue

            # Header-validation pattern also used for Services — only
            # trust a table that plausibly matches the real Statements
            # shape, or is explicitly a confirmed-empty/error state,
            # rather than grabbing whatever table happens to be on the
            # page.
            matched_rows = None
            for table in tables:
                table_rows = extract_table(table)
                if not table_rows:
                    continue

                headers = set(table_rows[0].keys())
                overlap = headers & EXPECTED_STATEMENTS_HEADERS
                if len(overlap) >= 2:
                    matched_rows = table_rows
                    break

                cell_values = {str(v).strip().lower() for row in table_rows for v in row.values()}
                if "no matching records found" in cell_values:
                    matched_rows = []
                    break
                if "unable to process this request" in cell_values:
                    print(f"    {prefix}Statements: page showed an error state for {label}")
                    continue

            if matched_rows is None:
                # [patch2] "Page loaded, nothing here" vs "page did not
                # load" are different outcomes and were indistinguishable.
                # An empty Homeowner page satisfies neither the header
                # check nor the exact "no matching records found" cell, so
                # it fell through as a failure — which made the overlap
                # guard below refuse to run House and Dues Charges on
                # accounts whose entire history lives in that type.
                # on_statements_summary() confirms we are genuinely on the
                # summary page, so no table means no periods.
                if on_statements_summary(frame):
                    print(f"    {prefix}Statements: {label} has no periods "
                          f"(page loaded, empty)")
                    matched_rows = []
                else:
                    print(f"    {prefix}Statements: no recognizable table found for {label}")
                    continue

            # [patch2] A header-matched table can still carry the empty-state
            # placeholder as its only row. Left in, it counts as a kept
            # period and gets drilled as though it were a real statement.
            matched_rows = [
                r for r in matched_rows
                if "no matching records found" not in
                   " ".join(str(v).lower() for v in r.values())
            ]

            # ── Overlap suppression ───────────────────────────────
            # Statement months already claimed for THIS member by a
            # higher-priority receivable type, taken from the rows just
            # scraped off the live page.
            #
            # Deliberately not read from the database: in a full run the
            # Homeowner rows for this member are being written by this
            # same pass, so the DB is always a run behind. The in-memory
            # rows are current by construction.
            defers_to = RECEIVABLE_PRIORITY.get(label, ())
            if defers_to and not all(t in types_succeeded for t in defers_to):
                # Cannot tell what would overlap. Skipping is the safe
                # failure: any_type_succeeded stays False if the primary
                # type also failed, which fails the tab and lets the
                # existing retry loop handle it, rather than banking a
                # duplicate-laden result and marking the member done.
                absent = [t for t in defers_to if t not in types_succeeded]
                # This now means the deferred-to type genuinely FAILED —
                # an empty one is recorded as succeeded above, so this no
                # longer fires for accounts with no Homeowner history.
                print(f"    {prefix}Statements: {label} skipped — "
                      f"{', '.join(absent)} failed to load (not merely empty), "
                      f"cannot identify overlap")
                continue

            # Built from KEPT rows, not from everything on the page: a
            # month the higher-priority type dropped at its own floor is
            # not in the output, so it is not an overlap and this type
            # should supply it.
            claimed = {
                (d.year, d.month)
                for r in all_rows
                if r["_receivable_type"] in defers_to
                for d in (parse_statement_date(r.get("Due Date", "")),)
                if d is not None
            }

            kept = 0
            overlapped = 0
            for row in matched_rows:
                due = parse_statement_date(row.get("Due Date", ""))
                # Keep rows from this type's floor onward; keep
                # unparseable dates too rather than silently dropping
                # data
                min_date = STATEMENT_MIN_DATE_BY_TYPE.get(label, STATEMENT_MIN_DATE)
                if min_date is not None and due is not None and due < min_date:
                    continue
                # Already covered by a higher-priority type. Skipped
                # here, before the drill, so the duplicate never reaches
                # the CSV AND its detail page is never opened — this is
                # also where most of the added run time comes back.
                if due is not None and (due.year, due.month) in claimed:
                    overlapped += 1
                    continue
                row["_folder"]          = folder_name
                row["_section"]         = "Billing"
                row["_tab"]             = "Statements"
                row["_receivable_type"] = label
                all_rows.append(row)
                kept += 1

            types_succeeded.add(label)
            any_type_succeeded = True
            if overlapped:
                print(f"    {prefix}Statements ({label}): {overlapped} period(s) "
                      f"skipped, already covered by {', '.join(defers_to)}")
            print(f"    {prefix}Statements ({label}): {kept} row(s) kept (of {len(matched_rows)})")

            # ── Drill each kept period's detail page ────────────────
            if kept:
                period_rows = [r for r in all_rows if r["_receivable_type"] == label]
                details, drill_ok = drill_statement_details(
                    page, folder_name, label, period_rows, prefix,
                    receivable_value=value)
                all_detail_rows.extend(details)   # [patch] ALWAYS extend
                if not drill_ok:
                    all_details_complete = False
                    print(f"    {prefix}Statements ({label}): drill incomplete "
                          f"— {len(details)} line(s) kept, will retry")

        except Exception as e:
            print(f"    {prefix}Statements scrape error for {label}: {e}")
            continue

    if not any_type_succeeded:
        return False, [], []
    # [patch] Rows are still returned and still written; returning
    # False only leaves status['statements'] failed so the member is
    # retried instead of frozen as a partial success.
    return all_details_complete, all_rows, all_detail_rows


# ─────────────────────────────────────────────
# PER-MEMBER SCRAPE
# ─────────────────────────────────────────────
def scrape_member(page, member_number, member_id, prefix="", status=None):
    """
    status: optional dict the caller supplies to receive per-tab
    outcomes — "ok" (data saved or confirmed empty), "skipped"
    (legitimately not applicable, e.g. guest accounts), or "failed"
    (tab did not load / retries exhausted). Any tab left "failed"
    means the caller must NOT mark this account done, so it gets
    retried on the next run. Passed in rather than returned so the
    existing return statements below stay untouched.
    """
    if status is None:
        status = {}
    status.setdefault("rooms", "failed")
    status.setdefault("services", "failed")
    status.setdefault("statements", "failed")

    folder_name = get_folder_name(member_number, member_id)
    saved = {}

    dismiss_popup(page)
    if not navigate_to_member(page, member_id, prefix):
        print(f"  {prefix}Navigation failed for {member_number}")
        return False, saved

    member_info = scrape_member_info_fields(page, prefix)
    append_member_info_to_profile(folder_name, member_info, prefix)

    shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not shell:
        print(f"  {prefix}Shell frame not found for {member_number}")
        take_screenshot(page, f"no_shell_{folder_name}")
        return False, saved

    tab_done = False
    for attempt in range(1, TAB_MAX_RETRIES + 1):
        note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
        print(f"    {prefix}Rooms{note}")

        shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
        if not shell:
            print(f"    {prefix}Shell lost — re-navigating to member")
            if not navigate_to_member(page, member_id, prefix):
                break
            shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not shell:
                break

        open_member_dropdown(shell, page)
        click_section(shell, page, "Member_Info")
        if not click_subtab(shell, page, "rooms", TAB_HREF_FALLBACKS["rooms"], prefix):
            take_screenshot(page, f"no_tab_{folder_name}_rooms")
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
            continue

        rooms_success, room_rows, merged_contact, rate_rows = \
            scrape_rooms_with_popups(page, folder_name, prefix)
        if not rooms_success:
            print(f"    {prefix}Rooms scraping failed")

            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
                continue

            return False, saved

        if room_rows:
            fp = save_tab_csv(folder_name, "rooms", room_rows)
            if fp:
                saved["rooms"] = fp
                print(f"    {prefix}Rooms: {len(room_rows)} row(s) → {os.path.basename(fp)}")
            else:
                print(f"    {prefix}Rooms CSV could not be saved")
                return False, saved
            if merged_contact:
                enrich_profile_csv(folder_name, merged_contact, prefix)
            if rate_rows:
                fp = save_tab_csv(folder_name, "rate_details", rate_rows)
                if fp:
                    saved["rate_details"] = fp
                    print(f"    {prefix}Rate details: {len(rate_rows)} night row(s) → {os.path.basename(fp)}")
                else:
                    print(f"    {prefix}Rate details CSV could not be saved")
        else:
            print(f"    {prefix}Rooms: no data — processed successfully")

        status["rooms"] = "ok"
        tab_done = True
        break

    if not tab_done:
        print(f"    {prefix}Rooms: exhausted retries")
        return False, saved

    # ── Billing > Services (integrated 2026-07-02) ─────────────────
    # Runs after Rooms, before moving to the next member — folded in
    # from the interim services_scraper.py script so both happen in one
    # pass per member instead of two separate full runs. Skipped
    # entirely for Guest accounts, since services/dues only apply to
    # actual Members (see is_guest_folder()). A Services failure does
    # NOT fail the whole member — Rooms is the primary, load-bearing
    # data and has already succeeded by this point; Services failures
    # are just logged, and this member stays eligible for a later
    # targeted re-run without losing the Rooms data already captured.
    if is_guest_folder(folder_name):
        print(f"    {prefix}Services: skipped (guest account)")
        status["services"] = "skipped"   # guests have no services — resolved, not a failure
        services_confirmed_empty = False
    else:
        services_done = False
        services_confirmed_empty = False
        for attempt in range(1, TAB_MAX_RETRIES + 1):
            note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
            print(f"    {prefix}Services{note}")

            shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not shell:
                print(f"    {prefix}Shell lost — re-navigating to member")
                if not navigate_to_member(page, member_id, prefix):
                    break
                shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
                if not shell:
                    break

            open_member_dropdown(shell, page)
            click_section(shell, page, "Billing")
            if not click_subtab(shell, page, "members_enrolled_services", TAB_HREF_FALLBACKS["services"], prefix):
                take_screenshot(page, f"no_tab_{folder_name}_services")
                if attempt < TAB_MAX_RETRIES:
                    page.wait_for_timeout(1000 * attempt)
                continue

            services_success, service_rows = scrape_services(page, folder_name, prefix)
            if not services_success:
                print(f"    {prefix}Services scraping failed")
                if attempt < TAB_MAX_RETRIES:
                    page.wait_for_timeout(1000 * attempt)
                    continue
                print(f"    {prefix}Services: exhausted retries — continuing anyway (Rooms already saved)")
                break

            if service_rows:
                fp = save_tab_csv(folder_name, "services", service_rows)
                if fp:
                    saved["services"] = fp
                    print(f"    {prefix}Services: {len(service_rows)} row(s) → {os.path.basename(fp)}")
                else:
                    print(f"    {prefix}Services CSV could not be saved")
            else:
                # Confirmed empty (Services genuinely loaded and had
                # nothing) — NOT the same as a failed/uncertain attempt.
                # Confirmed with club 2026-07-12: every homeowner with
                # statements is also enrolled in at least one Service,
                # so confirmed-empty Services safely implies no
                # Statements — this skips the much more expensive
                # Statements attempt below for accounts we already have
                # real evidence about. A FAILED Services attempt does
                # NOT set this — "we don't know" still means "try
                # Statements anyway."
                services_confirmed_empty = True
                print(f"    {prefix}Services: no data — processed successfully")

            status["services"] = "ok"
            services_done = True
            break

        if not services_done:
            print(f"    {prefix}Services: not completed this run — account will be retried next run")

    # ── Billing > Statements ────────────────────────────────────────
    # Runs after Services, before moving to the next member. Same
    # guest-skip and non-fatal-failure treatment as Services above.
    # Homeowner receivable type only, 2025+ periods, with per-period
    # detail drilling — see the STATEMENTS TAB section comments.
    if is_guest_folder(folder_name):
        print(f"    {prefix}Statements: skipped (guest account)")
        status["statements"] = "skipped"   # guests have no statements
    else:
        # [2026-07-18] The "Services confirmed empty => no statements"
        # shortcut was REMOVED: member 35 (Vista Del Mar's owner
        # account) has an empty Services tab but real Homeowner
        # statements, disproving the 2026-07-12 assumption. Statements
        # are now always attempted for every non-guest account.
        # (services_confirmed_empty is still computed above but no
        # longer gates anything.)
        statements_done = False
        for attempt in range(1, TAB_MAX_RETRIES + 1):
            note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
            print(f"    {prefix}Statements{note}")

            shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not shell:
                print(f"    {prefix}Shell lost — re-navigating to member")
                if not navigate_to_member(page, member_id, prefix):
                    break
                shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
                if not shell:
                    break

            open_member_dropdown(shell, page)
            click_section(shell, page, "Billing")
            if not click_subtab(shell, page, "memberStatements", TAB_HREF_FALLBACKS["statements"], prefix):
                take_screenshot(page, f"no_tab_{folder_name}_statements")
                if attempt < TAB_MAX_RETRIES:
                    page.wait_for_timeout(1000 * attempt)
                continue

            statements_success, statement_rows, statement_detail_rows = \
                scrape_statements(page, folder_name, prefix)
            if not statements_success:
                print(f"    {prefix}Statements scraping failed")
                if attempt < TAB_MAX_RETRIES:
                    page.wait_for_timeout(1000 * attempt)
                    continue
                print(f"    {prefix}Statements: exhausted retries — continuing anyway (Rooms/Services already saved)")
                break

            if statement_rows:
                fp = save_tab_csv(folder_name, "statements", statement_rows)
                if fp:
                    saved["statements"] = fp
                    print(f"    {prefix}Statements: {len(statement_rows)} row(s) → {os.path.basename(fp)}")
                else:
                    print(f"    {prefix}Statements CSV could not be saved")
            else:
                print(f"    {prefix}Statements: no data — processed successfully")

            if statement_detail_rows:
                fp = save_tab_csv(folder_name, "statement_details", statement_detail_rows)
                if fp:
                    saved["statement_details"] = fp
                    print(f"    {prefix}Statement details: {len(statement_detail_rows)} line(s) → {os.path.basename(fp)}")
                else:
                    print(f"    {prefix}Statement details CSV could not be saved")

            status["statements"] = "ok"
            statements_done = True
            break

        if not statements_done:
            print(f"    {prefix}Statements: not completed this run — account will be retried next run")

    return True, saved

# ─────────────────────────────────────────────
# STATEMENTS-ONLY MEMBER SCRAPE  [2026-07-18]
# ─────────────────────────────────────────────
def scrape_member_statements_only(page, member_number, member_id,
                                  prefix="", status=None):
    """
    Targeted mode: navigate to the member and pull ONLY
    Billing > Statements (+ per-period details). Skips Rooms popups and
    Services entirely, so a statements backfill over a list of owner
    accounts takes minutes instead of hours. Guest accounts are still
    skipped (correct behavior — e.g. 57 is a guest; 57A is the member).
    """
    if status is None:
        status = {}
    # Rooms/Services are intentionally not attempted in this mode.
    status.setdefault("statements", "failed")

    folder_name = get_folder_name(member_number, member_id)
    saved = {}

    dismiss_popup(page)
    if not navigate_to_member(page, member_id, prefix):
        print(f"  {prefix}Navigation failed for {member_number}")
        return False, saved

    if is_guest_folder(folder_name):
        print(f"    {prefix}Statements: skipped (guest account)")
        status["statements"] = "skipped"
        return True, saved

    for attempt in range(1, TAB_MAX_RETRIES + 1):
        note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
        print(f"    {prefix}Statements{note}")

        shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
        if not shell:
            print(f"    {prefix}Shell lost — re-navigating to member")
            if not navigate_to_member(page, member_id, prefix):
                return False, saved
            shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not shell:
                return False, saved

        open_member_dropdown(shell, page)
        click_section(shell, page, "Billing")
        if not click_subtab(shell, page, "memberStatements",
                            TAB_HREF_FALLBACKS["statements"], prefix):
            take_screenshot(page, f"no_tab_{folder_name}_statements")
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
            continue

        statements_success, statement_rows, statement_detail_rows = \
            scrape_statements(page, folder_name, prefix)
        if not statements_success:
            print(f"    {prefix}Statements scraping failed")
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
                continue
            return False, saved

        if statement_rows:
            fp = save_tab_csv(folder_name, "statements", statement_rows)
            if fp:
                saved["statements"] = fp
                print(f"    {prefix}Statements: {len(statement_rows)} row(s) → {os.path.basename(fp)}")
        else:
            print(f"    {prefix}Statements: no data — processed successfully")

        if statement_detail_rows:
            fp = save_tab_csv(folder_name, "statement_details", statement_detail_rows)
            if fp:
                saved["statement_details"] = fp
                print(f"    {prefix}Statement details: {len(statement_detail_rows)} line(s) → {os.path.basename(fp)}")

        status["statements"] = "ok"
        return True, saved

    return False, saved

# ─────────────────────────────────────────────
# WORKER
# ─────────────────────────────────────────────
def _worker_init():
    signal.signal(signal.SIGINT, signal.SIG_IGN)

def scrape_chunk(args):
    members_chunk, worker_id, force, statements_only = args
    time.sleep(worker_id * 3)
    prefix   = f"[W{worker_id}] "
    results  = {"success": [], "failed": [], "skipped": [], "incomplete": []}
    done_set = load_done_set()

    with sync_playwright() as p:
        headless = os.environ.get("HEADFUL", "").lower() not in ("1", "true", "yes")
        browser  = p.chromium.launch(headless=headless)
        page     = browser.new_page()
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

                if member_id in done_set and not force:
                    print(f"  {prefix}Already done — skipping")
                    results["skipped"].append(folder_name)
                    continue

                scrape_fn = (scrape_member_statements_only
                             if statements_only else scrape_member)
                status = {}
                success, saved = scrape_fn(page, member_number, member_id,
                                           prefix, status)
                if not success:
                    if ensure_session(page, worker_id):
                        print(f"  {prefix}Retrying {member_number} after re-login...")
                        status = {}   # fresh slate for the retry
                        success, saved = scrape_fn(page, member_number, member_id,
                                                   prefix, status)

                if success:
                    # [2026-07-18] An account is only marked done when
                    # EVERY tab resolved — "ok" (data saved or
                    # confirmed empty) or "skipped" (not applicable,
                    # e.g. guest). A tab left "failed" keeps the
                    # account off the done log so the next run retries
                    # it, instead of silently freezing a partial
                    # result forever (the bug that lost statements for
                    # ~80 villa-owner accounts in July 2026).
                    unresolved = sorted(
                        k for k, v in status.items()
                        if v not in ("ok", "skipped")
                    )

                    # statements-only runs never mark done: a member
                    # first touched in this mode still needs a full
                    # Rooms/Services pass in a future normal run.
                    if statements_only:
                        pass
                    elif unresolved:
                        log_incomplete(member_number, member_id, status)
                        results["incomplete"].append(folder_name)
                        print(f"  {prefix}! {member_number}: incomplete "
                              f"({', '.join(unresolved)}) — not marked done, "
                              f"will retry next run")
                    else:
                        mark_done(member_id)
                        done_set.add(member_id)

                    if saved:
                        print(f"  {prefix}✓ {member_number}: {len(saved)} file(s) saved")
                    else:
                        print(f"  {prefix}✓ {member_number}: processed successfully — no records")
                    results["success"].append(folder_name)
                else:
                    print(f"  {prefix}✗ {member_number}: page or Rooms tab failed to load")
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
    parser.add_argument("--members", type=str, default=None,
                        help="Comma-separated member numbers e.g. 67,67A,23B")
    parser.add_argument("--force",   action="store_true",
                        help="Ignore journal_done.txt for the selected members "
                             "(auto-enabled for --member/--id/--members)")
    parser.add_argument("--statements-only", action="store_true",
                        help="Skip Rooms and Services; scrape only "
                             "Billing > Statements (+ details)")
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

    force = args.force or bool(args.member or args.id or args.members)

    if args.members:
        wanted = {m.strip() for m in args.members.split(",") if m.strip()}
        members = [(n, i) for n, i in all_members if n in wanted]
        found = {n for n, _ in members}
        missing = wanted - found
        if missing:
            print(f"WARNING: not found in member map: {sorted(missing)}")
        if not members:
            print("None of the listed members were found in the map.")
            return
    elif args.member:
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
        members = all_members[:args.limit] if args.limit else all_members

    print("=" * 60)
    print("Journal Scraper")
    print("=" * 60)
    print(f"Members to process : {len(members)}")
    print(f"Output             : {JOURNAL_FOLDER}")

    if len(members) == 1 or args.workers == 1:
        print("Mode               : single worker\n")
        all_results = [scrape_chunk((members, 1, force, args.statements_only))]
    else:
        num_workers = min(args.workers, len(members))
        chunk_size  = math.ceil(len(members) / num_workers)
        chunks = [
            (members[i: i + chunk_size], wid, force, args.statements_only)
            for wid, i in enumerate(range(0, len(members), chunk_size), 1)
        ]
        print(f"Workers            : {num_workers}")
        print(f"Per worker         : ~{chunk_size} members\n")
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

    incomplete       = sum(len(r.get("incomplete", [])) for r in all_results)
    incomplete_names = [n for r in all_results for n in r.get("incomplete", [])]
    success      = sum(len(r["success"]) for r in all_results)
    failed       = sum(len(r["failed"])  for r in all_results)
    skipped      = sum(len(r["skipped"]) for r in all_results)
    failed_names = [n for r in all_results for n in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Success : {success}")
    if incomplete:
        print(f"  Incomplete (will retry next run) : {incomplete}")
        print(f"    {incomplete_names}")
        print(f"    Details logged to: {INCOMPLETE_LOG}")
    print(f"  Failed  : {failed}")
    print(f"  Skipped : {skipped}")
    if failed_names:
        print(f"  Failed  : {failed_names}")
    print("=" * 60)

if __name__ == "__main__":
    main()