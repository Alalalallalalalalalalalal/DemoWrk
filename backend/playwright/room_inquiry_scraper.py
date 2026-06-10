"""
room_inquiry_scraper.py — Scrape the Room Inquiry table (Rooms > Inquiry > Room Inquiry).
Saves a master rooms lookup CSV:  reports/room_lookup.csv

Output columns:
  room_number     — unit code          e.g. V52, 312B
  villa_name      — room type name     e.g. Little Hill
  display_name    — full display name  e.g. Little Hill -V52
  max_persons     — integer            e.g. 10
  bedroom_count   — integer            e.g. 5  (blank for ZZ Comp / no BR listed)
  room_id         — internal PMS id from the href  e.g. 38
  room_type_id    — internal type id   e.g. 38

Usage:
    python room_inquiry_scraper.py
"""
import os
import re
import csv
import sys
import time
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from config import OUTPUT_FOLDER, BASE_URL
from login import login

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
REPORTS_FOLDER    = os.path.join(OUTPUT_FOLDER, "reports")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
ROOM_LOOKUP_CSV   = os.path.join(REPORTS_FOLDER, "room_lookup.csv")

NAV_TIMEOUT   = 15000
FRAME_TIMEOUT = 10000

ROOM_INQUIRY_URL = "PMS/roomInquiry.do?tabGrpModuleID=13"

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def pr(msg):
    print(f"  {msg}")

def screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"room_inquiry_{name}_{ts}.png")
        page.screenshot(path=path)
        pr(f"Screenshot: {path}")
    except Exception:
        pass

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
        page.wait_for_timeout(200)
    return None


def get_frame_by_url(page, keyword):
    for frame in page.frames:
        try:
            if keyword in (frame.url or ""):
                return frame
        except Exception:
            continue
    return None


def get_content_context(page, timeout_ms=FRAME_TIMEOUT):
    landing = get_landing_frame(page, timeout_ms=timeout_ms)
    return landing if landing else page


def dismiss_popup(page):
    try:
        for frame in page.frames:
            try:
                btn = frame.query_selector(
                    "a[onclick*='close'], button[onclick*='close'], "
                    ".ui-dialog-titlebar-close, button.close, .close"
                )
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

def session_alive(page):
    return get_landing_frame(page, timeout_ms=1000) is not None

def ensure_session(page):
    if session_alive(page):
        return False
    pr("Session lost — re-logging in...")
    try:
        login(page)
        try:
            page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT)
        except Exception:
            pass
        page.wait_for_timeout(3000)
        if not get_landing_frame(page, timeout_ms=FRAME_TIMEOUT):
            pr("No landingFrame found after login; will navigate directly to the room inquiry page.")
        pr("Re-login complete.")
        return True
    except Exception as e:
        pr(f"Re-login failed: {e}")
        return False

def parse_bedroom_count(br_text):
    """
    '5BR' → 5,  '10BR' → 10,  '' or '-' → None (caller decides default)
    """
    if not br_text or br_text.strip() in ("-", ""):
        return None
    m = re.search(r'(\d+)\s*BR', br_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None

def extract_id_from_href(href, param):
    """Extract numeric id from href like './roomDetail.do?roomId=38'"""
    if not href:
        return ""
    m = re.search(rf'{param}=(\d+)', href)
    return m.group(1) if m else ""

# ─────────────────────────────────────────────
# SCRAPE
# ─────────────────────────────────────────────
def scrape_room_inquiry(page):
    """
    Navigate to Room Inquiry, click Search, scrape the results table.
    Returns list of dicts.
    """
    landing = get_content_context(page, timeout_ms=FRAME_TIMEOUT)

    url = f"{BASE_URL}/{ROOM_INQUIRY_URL}"

    def _navigate_and_search():
        """Navigate to Room Inquiry and click Search. Returns landingFrame or None."""
        ensure_session(page)
        lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
        if not lf:
            pr("ERROR: content context not found before navigation.")
            return None

        # Navigate
        pr(f"Navigating to Room Inquiry: {url}")
        try:
            lf.goto(url, timeout=NAV_TIMEOUT)
            lf.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            dismiss_popup(page)
            lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
            if not lf:
                pr("ERROR: no content context after navigation.")
                return None
        except Exception as e:
            pr(f"Navigation error: {e}")
            screenshot(page, "nav_error")
            return None

        # Click Search
        pr("Clicking Search...")
        try:
            search_btn = lf.query_selector("input#Search, input[name='Search'][value='Search']")
            if not search_btn:
                search_btn = lf.query_selector("input[type='submit'].btn-success")
            if not search_btn:
                pr("ERROR: Search button not found.")
                screenshot(page, "no_search_btn")
                return None
            search_btn.click()
            page.wait_for_timeout(5000)
            dismiss_popup(page)
            lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
            if not lf:
                pr("ERROR: no content context after Search click.")
                return None
        except Exception as e:
            pr(f"Search click error: {e}")
            screenshot(page, "search_click_error")
            return None

        # Confirm results loaded — expect at least one tbody tr
        try:
            lf.wait_for_selector("tbody tr", timeout=8000)
        except PWTimeout:
            pr("WARNING: tbody rows not found after Search — page may not have loaded.")
            screenshot(page, "no_results")
            return None

        return lf

    # First attempt
    landing = _navigate_and_search()

    # Retry once if first attempt failed
    if not landing:
        pr("Retrying after session recovery...")
        ensure_session(page)
        page.wait_for_timeout(2000)
        landing = _navigate_and_search()

    if not landing:
        pr("ERROR: Could not load Room Inquiry after retry.")
        return []

    # Scrape table
    pr("Scraping results table...")
    rows = []
    try:
        # Find tbody rows — use position-based column extraction matching the HTML structure:
        # col0: Room #  col1: Villa Name  col2: Status  col3: Display Name
        # col4: Max Persons  col5: (dash)  col6: Notes  col7: (dash)  col8: Bedroom Count
        table_rows = landing.query_selector_all("tbody tr")
        pr(f"  Found {len(table_rows)} row(s)")

        for tr in table_rows:
            try:
                cells = tr.query_selector_all("td")
                if len(cells) < 5:
                    continue

                # col 0 — Room # + room_id from href
                room_cell   = cells[0]
                room_link   = room_cell.query_selector("a")
                room_number = room_link.inner_text().strip() if room_link else room_cell.inner_text().strip()
                room_id     = extract_id_from_href(
                    room_link.get_attribute("href") if room_link else "", "roomId"
                )

                # col 1 — Villa Name + room_type_id from href
                type_cell    = cells[1]
                type_link    = type_cell.query_selector("a")
                villa_name   = type_link.inner_text().strip() if type_link else type_cell.inner_text().strip()
                room_type_id = extract_id_from_href(
                    type_link.get_attribute("href") if type_link else "", "roomTypeId"
                )

                # col 3 — Display Name
                display_cell = cells[3]
                display_link = display_cell.query_selector("a")
                display_name = (display_link.inner_text().strip()
                                if display_link else display_cell.inner_text().strip())
                # Normalise extra whitespace in display names like "Following  Seas-V20"
                display_name = " ".join(display_name.split())

                # col 4 — Max Persons
                max_persons_raw = cells[4].inner_text().strip()
                try:
                    max_persons = int(max_persons_raw)
                except ValueError:
                    max_persons = 0

                # col 8 — Bedroom Count
                br_raw = cells[8].inner_text().strip() if len(cells) > 8 else ""
                br_count = parse_bedroom_count(br_raw)
                if br_count is None:
                    # ZZ Comp or any room with no BR text — use 0 to signal "unknown/N/A"
                    # (folio_scraper already defaults to 1 for real villas from the rate name;
                    #  this lookup is the authoritative source so we store None as empty string)
                    bedroom_count = ""
                else:
                    bedroom_count = br_count

                row = {
                    "room_number":   room_number,
                    "villa_name":    villa_name,
                    "display_name":  display_name,
                    "max_persons":   max_persons,
                    "bedroom_count": bedroom_count,
                    "room_id":       room_id,
                    "room_type_id":  room_type_id,
                }
                rows.append(row)

            except Exception as e:
                pr(f"  Row parse error: {e}")
                continue

    except Exception as e:
        pr(f"Table scrape error: {e}")
        screenshot(page, "table_error")

    return rows

# ─────────────────────────────────────────────
# SAVE
# ─────────────────────────────────────────────
def save_room_lookup(rows):
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    if not rows:
        pr("No rows to save.")
        return None
    fieldnames = [
        "room_number", "villa_name", "display_name",
        "max_persons", "bedroom_count",
        "room_id", "room_type_id",
    ]
    with open(ROOM_LOOKUP_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    pr(f"Saved {len(rows)} rooms → {ROOM_LOOKUP_CSV}")
    return ROOM_LOOKUP_CSV

# ─────────────────────────────────────────────
# LOOKUP HELPER  (importable by folio_scraper)
# ─────────────────────────────────────────────
_room_lookup_cache = None

def load_room_lookup():
    """
    Returns a dict keyed by room_number (upper-cased) → row dict.
    Loads from room_lookup.csv; result is cached in-process.
    Returns {} if the file doesn't exist (folio_scraper degrades gracefully).
    """
    global _room_lookup_cache
    if _room_lookup_cache is not None:
        return _room_lookup_cache
    if not os.path.exists(ROOM_LOOKUP_CSV):
        return {}
    lookup = {}
    with open(ROOM_LOOKUP_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = row.get("room_number", "").strip().upper()
            if key:
                lookup[key] = row
    _room_lookup_cache = lookup
    return lookup

def get_bedroom_count_from_lookup(room_number, fallback=1):
    """
    Look up bedroom_count for a room unit like 'V52'.
    Returns int. Falls back to `fallback` (default 1) if not found or blank.
    """
    lookup = load_room_lookup()
    row    = lookup.get(str(room_number).strip().upper())
    if not row:
        return fallback
    bc = row.get("bedroom_count", "")
    if bc == "" or bc is None:
        return fallback
    try:
        return int(bc)
    except (ValueError, TypeError):
        return fallback

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Room Inquiry Scraper")
    print("=" * 60)
    print(f"  Output: {ROOM_LOOKUP_CSV}")
    print()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        page    = browser.new_page()
        try:
            pr("Logging in...")
            login(page)
            try:
                page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT)
            except Exception:
                pass
            page.wait_for_timeout(3000)
            if not get_landing_frame(page, timeout_ms=FRAME_TIMEOUT):
                pr("No landingFrame found after login; continuing with current page context.")
            dismiss_popup(page)

            rooms = scrape_room_inquiry(page)
            if rooms:
                save_room_lookup(rooms)
                print()
                print("=" * 60)
                print(f"  Done: {len(rooms)} rooms scraped.")
                print("=" * 60)
            else:
                print()
                print("ERROR: No rooms scraped. Check screenshots.")
                screenshot(page, "final_empty")
                sys.exit(1)

        except Exception as e:
            pr(f"Fatal: {e}")
            screenshot(page, "fatal")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    main()