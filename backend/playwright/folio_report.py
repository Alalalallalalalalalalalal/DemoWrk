"""
folio_report.py — Phase 1: Login, search all folios, save folio_report.csv.

Run this when you want a fresh listing. The output CSV is used by folio_scraper.py.

Usage:
    python folio_report.py
"""
import os
import csv
import time
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
REPORTS_FOLDER   = os.path.join(OUTPUT_FOLDER, "reports")
SCREENSHOT_FOLDER= os.path.join(OUTPUT_FOLDER, "screenshots")
FOLIO_REPORT_CSV = os.path.join(REPORTS_FOLDER, "folio_report.csv")

NAV_TIMEOUT    = 15000
FRAME_TIMEOUT  = 8000
SEARCH_TIMEOUT = 45000
FOLIO_TIMEOUT  = 12000

EXPECTED_RESULT_COLUMNS = {
    "conf", "group", "member", "check", "room", "folio",
    "reservation", "status", "balance"
}

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"report_{name}_{ts}.png")
        page.screenshot(path=path)
        print(f"  Screenshot: {path}")
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

def get_main_screen_frame(page, timeout_ms=FRAME_TIMEOUT):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == "MainScreen":
                    _ = frame.url
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(200)
    return None

def dismiss_popup(page):
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    except Exception:
        pass

def is_results_table(headers):
    non_empty = [h for h in headers if h]
    if len(non_empty) < 4:
        return False
    combined = " ".join(h.lower() for h in non_empty)
    matches  = sum(1 for kw in EXPECTED_RESULT_COLUMNS if kw in combined)
    return matches >= 5

# ─────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────
def navigate_to_folios(page):
    print("  Loading Rooms module...")
    main_frame = get_main_screen_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not main_frame:
        main_frame = get_frame_by_url(page, "default.jsp") or page
    try:
        main_frame.evaluate("changeSelModule(2,1,1,'#003565','Rooms')")
        page.wait_for_timeout(3000)
    except Exception:
        try:
            btn = main_frame.query_selector("#btnTab0")
            if btn:
                btn.click()
                page.wait_for_timeout(3000)
        except Exception as e:
            print(f"  Could not load Rooms: {e}")
            return False

    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        print("  landingFrame not found after Rooms load")
        return False

    try:
        landing.goto(
            f"{BASE_URL}/PMS/viewUnbalancedFolios.do?tabGrpModuleID=13",
            timeout=NAV_TIMEOUT
        )
        page.wait_for_timeout(2000)
    except Exception as e:
        print(f"  Nav error: {e}")
        return False

    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return False
    try:
        landing.wait_for_selector(
            'select[name="reservationStatus"], input[name="search"]',
            timeout=FOLIO_TIMEOUT
        )
        print("  Folios search page ready.")
        return True
    except PWTimeout:
        print("  Search form not found.")
        screenshot(page, "search_not_found")
        return False

# ─────────────────────────────────────────────
# SEARCH + SCRAPE
# ─────────────────────────────────────────────
def run_search(page):
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return []

    print("  Selecting all statuses...")
    try:
        landing.evaluate("""
            () => {
                const sel = document.querySelector('select[name="reservationStatus"]');
                if (sel) { for (let o of sel.options) o.selected = true; }
            }
        """)
    except Exception as e:
        print(f"  Status select error: {e}")
        return []

    print("  Clicking Search (up to 45s)...")
    try:
        btn = (landing.query_selector("input[name='search']") or
               landing.query_selector("input[value='Search']"))
        if not btn:
            print("  Search button not found.")
            return []
        btn.click()
    except Exception as e:
        print(f"  Search click error: {e}")
        return []

    deadline     = time.time() + SEARCH_TIMEOUT / 1000
    results_rows = []

    while time.time() < deadline:
        page.wait_for_timeout(2000)
        landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
        if not landing:
            continue
        try:
            tables = landing.query_selector_all("table")
            print(f"  {len(tables)} table(s) — scanning...")
            for table in tables:
                ths     = table.query_selector_all("th")
                headers = [th.inner_text().strip() for th in ths]
                if not headers:
                    first_tr = table.query_selector("tr")
                    if first_tr:
                        headers = [td.inner_text().strip()
                                   for td in first_tr.query_selector_all("td")]
                if not headers or not is_results_table(headers):
                    continue

                # Strip the leading empty index columns from headers
                clean_headers = [h for h in headers if h]
                print(f"  Results table found: {clean_headers[:5]}...")

                real_rows = []
                discard   = False
                all_trs   = table.query_selector_all("tr")

                for tr in all_trs[1:]:
                    cells = [td.inner_text().strip()
                             for td in tr.query_selector_all("td")]
                    if not any(cells):
                        continue
                    cell_text = " ".join(cells).lower()
                    if "no matching" in cell_text or "no record" in cell_text:
                        discard = True
                        break

                    # Conf code href from id='confCode' anchor
                    conf_link = tr.query_selector("a#confCode")
                    conf_href = conf_link.get_attribute("href") if conf_link else ""

                    # Member name from hidden input memberName_{resId}
                    member_name = ""
                    try:
                        member_inp = tr.query_selector("input[id^='memberName_']")
                        if member_inp:
                            member_name = member_inp.get_attribute("value") or ""
                    except Exception:
                        pass

                    # Map cells to headers, skipping empty-header columns
                    row = {}
                    header_idx = 0
                    for cell_idx, cell_val in enumerate(cells):
                        # Skip columns whose header is empty (e.g. checkbox/icon cols)
                        while header_idx < len(headers) and not headers[header_idx]:
                            header_idx += 1
                        if header_idx < len(headers):
                            row[headers[header_idx]] = cell_val
                            header_idx += 1

                    row["_conf_href"]   = conf_href
                    row["_member_name"] = member_name
                    real_rows.append(row)

                if discard or not real_rows:
                    continue

                results_rows = real_rows
                break
        except Exception as e:
            print(f"  Scan error: {e}")

        if results_rows:
            break

    if not results_rows:
        print("  No results found.")
        screenshot(page, "no_results")
    else:
        print(f"  Found {len(results_rows)} row(s).")
    return results_rows

# ─────────────────────────────────────────────
# SAVE
# ─────────────────────────────────────────────
def save_report(rows):
    if not rows:
        return
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    all_keys = []
    seen = set()
    for row in rows:
        for k in row:
            if k not in seen:
                all_keys.append(k)
                seen.add(k)
    with open(FOLIO_REPORT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n  Saved: {FOLIO_REPORT_CSV} ({len(rows)} rows)")
    print(f"  Columns: {all_keys}")

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Folio Report — Phase 1: Collect reservation listing")
    print("=" * 60)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        page    = browser.new_page()
        try:
            login(page)
            dismiss_popup(page)

            if not navigate_to_folios(page):
                print("ERROR: Could not reach Folios search page.")
                return

            rows = run_search(page)
            if not rows:
                print("ERROR: No results.")
                return

            save_report(rows)

        except Exception as e:
            print(f"Fatal: {e}")
            screenshot(page, "fatal")
            raise
        finally:
            browser.close()

    print("\nDone. Run folio_scraper.py to scrape folio details.")

if __name__ == "__main__":
    main()