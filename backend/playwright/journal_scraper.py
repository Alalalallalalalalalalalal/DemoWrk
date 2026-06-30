"""
journal_scraper.py — Build per-member journal folders.
Scrapes the Rooms tab for each member, opens each reservation popup
to extract contact info, and saves:
  - rooms CSV per member
  - enriched profile CSV (contact/address fields filled from popup)
"""
import os
import csv
import argparse
import math
import time
import signal
import re
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
NAV_TIMEOUT     = 6000
TAB_TIMEOUT     = 4000
FRAME_TIMEOUT   = 4000
CLICK_TIMEOUT   = 2000
POPUP_TIMEOUT   = 8000
TAB_MAX_RETRIES = 3

GENERIC_LABELS = {"Guests", "Dependent", "Guest", "Staff"}

TAB_HREF_FALLBACKS = {"rooms": "roomsInfo.do"}

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
# ROOMS TAB
# ─────────────────────────────────────────────
def scrape_rooms_with_popups(page, folder_name, prefix=""):
    """
    1. Scrape the rooms table rows.
    2. For each row, click the confirmation code link to open the popup.
    3. Extract contact info from the popup.
    4. Close the popup and move to the next row.
    Returns (success, room_rows, merged_contact_data)
    success=True:
        Rooms page loaded correctly, even if it contains no records.
    success=False:
        Frame/table/page failed to load or an unexpected error occurred.
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}Rooms page failed: landing frame not found")
        return False, [], {}

    room_rows      = []
    merged_contact = {}

    try:
        tables = frame.query_selector_all("table")
        if not tables:
            print(f"    {prefix}No tables found in rooms tab")
            return True, [], {}

        for table in tables:
            for row in extract_table(table):
                row["_folder"]  = folder_name
                row["_section"] = "Member_Info"
                row["_tab"]     = "Rooms"
                room_rows.append(row)

        if not room_rows:
            print(f"    {prefix}Rooms table is empty")
            return True, [], {}

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
                return False, room_rows, merged_contact

            # Click the confirmation code link
            clicked = False
            try:
                for link in frame.query_selector_all("a"):
                    try:
                        if strip_val(link.inner_text()) == conf_code:
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

            close_reservation_popup(page, prefix)
            page.wait_for_timeout(800)

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Rooms page failed: " "Landing frame lost after closing popup — stopping")
                return False, room_rows, merged_contact

    except Exception as e:
        print(f"    {prefix}Rooms+popup scrape error: {e}")
        return False, room_rows, merged_contact

    return True, room_rows, merged_contact

# ─────────────────────────────────────────────
# PER-MEMBER SCRAPE
# ─────────────────────────────────────────────
def scrape_member(page, member_number, member_id, prefix=""):
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

        rooms_success, room_rows, merged_contact = scrape_rooms_with_popups(page, folder_name, prefix)
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
        else:
            print(f"    {prefix}Rooms: no data — processed successfully")

        tab_done = True
        break

    if not tab_done:
        print(f"    {prefix}Rooms: exhausted retries")
        return False, saved

    return True, saved

# ─────────────────────────────────────────────
# WORKER
# ─────────────────────────────────────────────
def _worker_init():
    signal.signal(signal.SIGINT, signal.SIG_IGN)

def scrape_chunk(args):
    members_chunk, worker_id = args
    time.sleep(worker_id * 3)
    prefix   = f"[W{worker_id}] "
    results  = {"success": [], "failed": [], "skipped": []}
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

                if member_id in done_set:
                    print(f"  {prefix}Already done — skipping")
                    results["skipped"].append(folder_name)
                    continue

                success, saved = scrape_member(page, member_number, member_id, prefix)
                if not success:
                    if ensure_session(page, worker_id):
                        print(f"  {prefix}Retrying {member_number} after re-login...")
                        success, saved = scrape_member(page, member_number, member_id, prefix)

                if success:
                    mark_done(member_id)
                    done_set.add(member_id)

                    if saved:
                        print(f"  {prefix}✓ {member_number}: {len(saved)} file(s) saved")
                    else:
                        print(f"  {prefix}✓ {member_number}: processed successfully — no room records")
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
        members = all_members[:args.limit] if args.limit else all_members

    print("=" * 60)
    print("Journal Scraper")
    print("=" * 60)
    print(f"Members to process : {len(members)}")
    print(f"Output             : {JOURNAL_FOLDER}")

    if len(members) == 1 or args.workers == 1:
        print("Mode               : single worker\n")
        all_results = [scrape_chunk((members, 1))]
    else:
        num_workers = min(args.workers, len(members))
        chunk_size  = math.ceil(len(members) / num_workers)
        chunks = [
            (members[i: i + chunk_size], wid)
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