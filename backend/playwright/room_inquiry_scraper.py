"""
room_inquiry_scraper.py — Two scrapers in one:

  1. Room Inquiry  (Rooms > Inquiry > Room Inquiry)
       → reports/room_lookup.csv
         Columns: room_number, villa_name, display_name,
                  max_persons, bedroom_count, room_id, room_type_id

  2. Business Source  (Admin > Business Source)
       → reports/business_source.csv
         Columns: Source Name, Payment Type   (Paid / Free)

Importable helpers for folio_scraper.py:
  load_room_lookup()              → {room_number: row_dict}
  get_bedroom_count_from_lookup(room_number)
  load_business_source_lookup()   → {source_name_lower: "Paid"|"Free"}
  get_payment_type(source_text)   → "Paid" | "Free" | ""

Usage:
    python room_inquiry_scraper.py           # run both scrapers
    python room_inquiry_scraper.py --rooms   # room lookup only
    python room_inquiry_scraper.py --sources # business sources only
"""

import os
import re
import csv
import sys
import time
import argparse
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from config import OUTPUT_FOLDER, BASE_URL
from login import login

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
REPORTS_FOLDER      = os.path.join(OUTPUT_FOLDER, "reports")
SCREENSHOT_FOLDER   = os.path.join(OUTPUT_FOLDER, "screenshots")

ROOM_LOOKUP_CSV     = os.path.join(REPORTS_FOLDER, "room_lookup.csv")
BUSINESS_SOURCE_CSV = os.path.join(REPORTS_FOLDER, "business_source.csv")

NAV_TIMEOUT   = 15000
FRAME_TIMEOUT = 10000

ROOM_INQUIRY_URL = "PMS/roomInquiry.do?tabGrpModuleID=13"
BUSINESS_SRC_URL = "PMS/businessSource.do?tabGrpModuleID=13"

# ─────────────────────────────────────────────
# PAID / FREE CLASSIFICATION
# ─────────────────────────────────────────────
FREE_KEYWORDS = [
    "tentative",
    "tenta",        # catches truncated "…Tentativ" / "…Tenta"
    "complimentary",
    "arrival",
    "homeowner family",
    "hf -",
    "ha -",
    "ho -",
    "free",
]

FREE_CODES = {
    "CU",   # CU - Complimentary
    "HA",   # HA - Homeowner Arrival
    "HF",   # HF - Homeowner Family
    "HO",   # HO - Homeowner
}

# End-of-string fragments that signal a truncated tentative name
FREE_SUFFIXES = (
    "tenta",
    "tentati",
    "tentative",
    " ten",     # e.g. "…Hello Summ Ten"
)

def classify_source(name: str) -> str:
    """
    Return "Free" or "Paid" for a business source name string.

    Free  — tentative (including truncated forms), complimentary,
             arrival, HF / HA / CU / HO short codes.
    Paid  — everything else.
    """
    if not name:
        return ""

    n_lower = name.lower().strip()

    for kw in FREE_KEYWORDS:
        if kw.lower() in n_lower:
            return "Free"

    for suffix in FREE_SUFFIXES:
        if n_lower.endswith(suffix.lower()):
            return "Free"

    short_code = name.split("-")[0].strip().upper()
    if short_code in FREE_CODES:
        return "Free"

    return "Paid"


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
        pr("Re-login complete.")
        return True
    except Exception as e:
        pr(f"Re-login failed: {e}")
        return False

def navigate_landing(page, path, wait_selector=None):
    ensure_session(page)
    lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
    if not lf:
        pr("ERROR: no content context.")
        return None

    url = f"{BASE_URL}/{path}"
    pr(f"Navigating to: {url}")
    try:
        lf.goto(url, timeout=NAV_TIMEOUT)
        lf.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(1500)
        dismiss_popup(page)
        lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
        if not lf:
            pr("ERROR: lost content context after navigation.")
            return None
        if wait_selector:
            try:
                lf.wait_for_selector(wait_selector, timeout=8000)
            except PWTimeout:
                pr(f"WARNING: selector '{wait_selector}' not found.")
        return lf
    except Exception as e:
        pr(f"Navigation error: {e}")
        screenshot(page, "nav_error")
        return None

def parse_bedroom_count(br_text):
    if not br_text or br_text.strip() in ("-", ""):
        return None
    m = re.search(r'(\d+)\s*BR', br_text, re.IGNORECASE)
    return int(m.group(1)) if m else None

def extract_id_from_href(href, param):
    if not href:
        return ""
    m = re.search(rf'{param}=(\d+)', href)
    return m.group(1) if m else ""

def save_csv(filepath, fieldnames, rows, label=""):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    pr(f"Saved {len(rows)} {label}rows → {filepath}")


# ─────────────────────────────────────────────
# 1. ROOM INQUIRY
# ─────────────────────────────────────────────
def scrape_room_inquiry(page):
    def _navigate_and_search():
        ensure_session(page)
        lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
        if not lf:
            return None

        url = f"{BASE_URL}/{ROOM_INQUIRY_URL}"
        pr(f"Navigating to Room Inquiry: {url}")
        try:
            lf.goto(url, timeout=NAV_TIMEOUT)
            lf.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            dismiss_popup(page)
            lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
        except Exception as e:
            pr(f"Navigation error: {e}")
            screenshot(page, "room_nav_error")
            return None

        pr("Clicking Search...")
        try:
            search_btn = lf.query_selector(
                "input#Search, input[name='Search'][value='Search'], "
                "input[type='submit'].btn-success"
            )
            if not search_btn:
                pr("ERROR: Search button not found.")
                screenshot(page, "no_search_btn")
                return None
            search_btn.click()
            page.wait_for_timeout(5000)
            dismiss_popup(page)
            lf = get_content_context(page, timeout_ms=FRAME_TIMEOUT)
        except Exception as e:
            pr(f"Search click error: {e}")
            return None

        try:
            lf.wait_for_selector("tbody tr", timeout=8000)
        except PWTimeout:
            pr("WARNING: no tbody rows after Search.")
            screenshot(page, "no_room_results")
            return None

        return lf

    landing = _navigate_and_search()
    if not landing:
        pr("Retrying Room Inquiry...")
        ensure_session(page)
        page.wait_for_timeout(2000)
        landing = _navigate_and_search()
    if not landing:
        pr("ERROR: Could not load Room Inquiry.")
        return []

    pr("Scraping Room Inquiry table...")
    rows = []
    try:
        table_rows = landing.query_selector_all("tbody tr")
        pr(f"  Found {len(table_rows)} row(s)")

        for tr in table_rows:
            try:
                cells = tr.query_selector_all("td")
                if len(cells) < 5:
                    continue

                room_cell   = cells[0]
                room_link   = room_cell.query_selector("a")
                room_number = (room_link.inner_text().strip()
                               if room_link else room_cell.inner_text().strip())
                room_id     = extract_id_from_href(
                    room_link.get_attribute("href") if room_link else "", "roomId"
                )

                type_cell    = cells[1]
                type_link    = type_cell.query_selector("a")
                villa_name   = (type_link.inner_text().strip()
                                if type_link else type_cell.inner_text().strip())
                room_type_id = extract_id_from_href(
                    type_link.get_attribute("href") if type_link else "", "roomTypeId"
                )

                display_cell = cells[3]
                display_link = display_cell.query_selector("a")
                display_name = (display_link.inner_text().strip()
                                if display_link else display_cell.inner_text().strip())
                display_name = " ".join(display_name.split())

                max_persons_raw = cells[4].inner_text().strip()
                try:
                    max_persons = int(max_persons_raw)
                except ValueError:
                    max_persons = 0

                br_raw        = cells[8].inner_text().strip() if len(cells) > 8 else ""
                br_count      = parse_bedroom_count(br_raw)
                bedroom_count = "" if br_count is None else br_count

                rows.append({
                    "room_number":   room_number,
                    "villa_name":    villa_name,
                    "display_name":  display_name,
                    "max_persons":   max_persons,
                    "bedroom_count": bedroom_count,
                    "room_id":       room_id,
                    "room_type_id":  room_type_id,
                })
            except Exception as e:
                pr(f"  Room row error: {e}")
                continue

    except Exception as e:
        pr(f"Room table error: {e}")
        screenshot(page, "room_table_error")

    return rows


# ─────────────────────────────────────────────
# 2. BUSINESS SOURCE
# ─────────────────────────────────────────────
def scrape_business_sources(page):
    """
    Navigate to Admin > Business Source, scrape source names,
    classify each as Paid or Free.
    Returns list of {"Source Name": ..., "Payment Type": ...}.
    """
    pr("── Business Source ─────────────────────────────")
    lf = navigate_landing(page, BUSINESS_SRC_URL, wait_selector="table")
    if not lf:
        pr("ERROR: Could not load Business Source page.")
        return []

    raw_rows = lf.evaluate("""
        () => {
            const rows = [];
            document.querySelectorAll('tbody tr').forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td'))
                                   .map(td => td.innerText.trim());
                if (cells.some(c => c)) rows.push(cells);
            });
            return rows;
        }
    """)

    pr(f"  Raw rows: {len(raw_rows)}")

    headers = lf.evaluate("""
        () => Array.from(
            document.querySelectorAll('thead th, table tr:first-child th')
        ).map(th => th.innerText.trim())
    """)
    pr(f"  Headers: {headers}")

    name_col = 0
    for i, h in enumerate(headers):
        if any(k in h.lower() for k in ("name", "source", "description")):
            name_col = i
            break

    rows = []
    for cells in raw_rows:
        if not cells:
            continue
        name = cells[name_col] if name_col < len(cells) else cells[0]
        name = name.strip()
        if not name or name.lower() in ("name", "source", "description"):
            continue
        ptype = classify_source(name)
        rows.append({"Source Name": name, "Payment Type": ptype})
        pr(f"    {name!r:45s} → {ptype}")

    return rows


# ─────────────────────────────────────────────
# SAVE HELPERS
# ─────────────────────────────────────────────
def save_room_lookup(rows):
    if not rows:
        pr("No room rows to save.")
        return None
    save_csv(
        ROOM_LOOKUP_CSV,
        ["room_number", "villa_name", "display_name",
         "max_persons", "bedroom_count", "room_id", "room_type_id"],
        rows, label="rooms ",
    )
    return ROOM_LOOKUP_CSV

def save_business_sources(rows):
    if not rows:
        pr("No source rows to save.")
        return None
    save_csv(
        BUSINESS_SOURCE_CSV,
        ["Source Name", "Payment Type"],
        rows, label="sources ",
    )
    return BUSINESS_SOURCE_CSV


# ─────────────────────────────────────────────
# LOOKUP HELPERS  (importable by folio_scraper)
# ─────────────────────────────────────────────
_room_lookup_cache     = None
_business_source_cache = None

def load_room_lookup():
    """Returns {room_number_upper: row_dict} from room_lookup.csv. Cached."""
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
    """Look up bedroom_count for a unit like 'V52'. Returns int."""
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

def load_business_source_lookup():
    """Returns {source_name_lower: "Paid"|"Free"} from business_source.csv. Cached."""
    global _business_source_cache
    if _business_source_cache is not None:
        return _business_source_cache
    if not os.path.exists(BUSINESS_SOURCE_CSV):
        _business_source_cache = {}
        return {}
    lookup = {}
    with open(BUSINESS_SOURCE_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name  = row.get("Source Name", "").strip()
            ptype = row.get("Payment Type", "").strip()
            if name:
                lookup[name.lower()] = ptype
    _business_source_cache = lookup
    return lookup

def get_payment_type(source_text: str) -> str:
    """
    Return "Paid" | "Free" | "" for a source label like "WS - Website Booking".
    Checks business_source.csv first, then falls back to classify_source().
    """
    if not source_text:
        return ""
    lookup = load_business_source_lookup()
    key    = source_text.strip().lower()
    if key in lookup:
        return lookup[key]
    return classify_source(source_text)


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Scrape Room Lookup and Business Sources."
    )
    parser.add_argument("--rooms",   action="store_true", help="Room Inquiry only")
    parser.add_argument("--sources", action="store_true", help="Business Sources only")
    args = parser.parse_args()

    run_rooms   = args.rooms   or not any([args.rooms, args.sources])
    run_sources = args.sources or not any([args.rooms, args.sources])

    print("=" * 60)
    print("Room Inquiry Scraper  (rooms + business sources)")
    print("=" * 60)

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
            dismiss_popup(page)

            totals = {}

            if run_rooms:
                print()
                print("── Room Inquiry ─────────────────────────────────")
                rooms = scrape_room_inquiry(page)
                save_room_lookup(rooms)
                totals["rooms"] = len(rooms)

            if run_sources:
                print()
                sources = scrape_business_sources(page)
                save_business_sources(sources)
                totals["sources"] = len(sources)

            print()
            print("=" * 60)
            print("Done.")
            for k, v in totals.items():
                print(f"  {k:10s}: {v} rows")
            print("=" * 60)

        except Exception as e:
            pr(f"Fatal: {e}")
            screenshot(page, "fatal")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    main()