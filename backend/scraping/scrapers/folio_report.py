"""
new_folio_report.py — Phase 1: Login, search all folios, save folio_report.csv.

Run this when you want a fresh listing. The output CSV is used by folio_scraper.py.

Usage:
    python new_folio_report.py                        # default: every year, current year back to Nov 2019
    python new_folio_report.py --year 2025             # single year, Jan-Dec (or Jan-current month if it's the current year)
    python new_folio_report.py --year 2025 --month 3   # single month only, merged into the existing master file
"""
import os
import csv
import re
import time
import calendar
import argparse
from datetime import datetime, date
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from ..config import OUTPUT_FOLDER, BASE_URL, STATE_FOLDER, HEADLESS
from ..login import login, get_frame_by_url

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
REPORTS_FOLDER    = os.path.join(OUTPUT_FOLDER, "reports")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
FOLIO_REPORT_CSV  = os.path.join(REPORTS_FOLDER, "folio_report.csv")  # combined/master file
DONE_LOG          = os.path.join(STATE_FOLDER, "folio_report_done.txt")

NAV_TIMEOUT        = 15000
FRAME_TIMEOUT      = 8000
FOLIO_TIMEOUT       = 12000

SEARCH_TIMEOUT      = 600000   # 10 min
# After switching the page-size dropdown to "All", the full table
# can take up to ~2-3 min to finish
# rendering.
PAGINATION_TIMEOUT  = 180000   # 3 min
# How often to re-check the row count while waiting for the full table
POLL_INTERVAL_MS    = 10000
# Consecutive stable polls (no row-count change) before we treat the
# table as "done loading" when we can't read an expected total
STABLE_POLLS_NEEDED = 15

EARLIEST_YEAR  = 2019          # floor year for the default all-years mode
EARLIEST_MONTH = 11             # floor month within EARLIEST_YEAR — Nov 2019
DATE_FORMAT    = "%m/%d/%Y"    # matches the portal's checkInDateFrom/To fields

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
        page.wait_for_timeout(500)
    except Exception:
        pass

def is_results_table(headers):
    non_empty = [h for h in headers if h]
    if len(non_empty) < 4:
        return False
    combined = " ".join(h.lower() for h in non_empty)
    matches  = sum(1 for kw in EXPECTED_RESULT_COLUMNS if kw in combined)
    return matches >= 5

def find_results_table(landing):
    """
    Finds the target results table entirely inside the browser to avoid creating DOM handles
      for non-matching tables. Because this function runs repeatedly during polling, 
      this single-evaluation approach prevents handle accumulation and memory growth during long operations.
    """
    try:
        info = landing.evaluate("""
            (keywords) => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (let i = 0; i < tables.length; i++) {
                    const table = tables[i];
                    let headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
                    if (!headers.length) {
                        const firstTr = table.querySelector('tr');
                        if (firstTr) {
                            headers = Array.from(firstTr.querySelectorAll('td')).map(td => td.innerText.trim());
                        }
                    }
                    const nonEmpty = headers.filter(h => h);
                    if (nonEmpty.length < 4) continue;
                    const combined = nonEmpty.join(' ').toLowerCase();
                    let matches = 0;
                    for (const kw of keywords) {
                        if (combined.includes(kw)) matches++;
                    }
                    if (matches >= 5) {
                        return { index: i, headers };
                    }
                }
                return null;
            }
        """, list(EXPECTED_RESULT_COLUMNS))
    except Exception:
        return None, None

    if not info:
        return None, None

    try:
        all_tables = landing.query_selector_all("table")
    except Exception:
        return None, None

    idx = info["index"]
    if idx >= len(all_tables):
        return None, None

    table = all_tables[idx]
    # Dispose the handles for every OTHER table we're not using — we
    # only need the one match.
    for i, t in enumerate(all_tables):
        if i != idx:
            try:
                t.dispose()
            except Exception:
                pass

    return table, info["headers"]

def table_has_data(table):
    """
    Returns True if the given results table currently shows at least
    one real data row — not just headers, nor the "No matching
    records found" placeholder

    Runs entirely inside a single evaluate() call — no per-row/per-cell
    ElementHandles created, since this runs on every poll.
    """
    try:
        return bool(table.evaluate("""
            (table) => {
                const trs = Array.from(table.querySelectorAll('tr'));
                for (let i = 1; i < trs.length; i++) {
                    const cells = Array.from(trs[i].querySelectorAll('td')).map(td => td.innerText.trim());
                    if (!cells.some(c => c)) continue;
                    const text = cells.join(' ').toLowerCase();
                    if (text.includes('no matching') || text.includes('no record')) return false;
                    return true;
                }
                return false;
            }
        """))
    except Exception:
        return False

def extract_rows_from_table(table, headers):
    """
    Pulls data rows out of an already-located results table using a
    SINGLE evaluate() call, entirely in the browser.
    returns plain JSON data instead, so no handles ever accumulate.

    Returns (rows, discard) — discard is True if the table itself says
    "no matching"/"no record" (i.e. a legitimately empty result, not a
    scraping failure).
    """
    try:
        result = table.evaluate("""
            (table, headers) => {
                const rows = [];
                let discard = false;
                const trs = Array.from(table.querySelectorAll('tr'));
                for (let i = 1; i < trs.length; i++) {
                    const tr = trs[i];
                    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                    if (!cells.some(c => c)) continue;

                    const cellText = cells.join(' ').toLowerCase();
                    if (cellText.includes('no matching') || cellText.includes('no record')) {
                        discard = true;
                        break;
                    }

                    const confLink = tr.querySelector('a#confCode');
                    const confHref = confLink ? (confLink.getAttribute('href') || '') : '';

                    let memberName = '';
                    const memberInp = tr.querySelector("input[id^='memberName_']");
                    if (memberInp) memberName = memberInp.getAttribute('value') || '';

                    const row = {};
                    headers.forEach((h, idx) => {
                        if (h && h.trim() && idx < cells.length) {
                            row[h] = cells[idx];
                        }
                    });
                    row['_conf_href']   = confHref;
                    row['_member_name'] = memberName;
                    rows.push(row);
                }
                return { rows, discard };
            }
        """, headers)
    except Exception as e:
        print(f"  extract_rows_from_table error: {e}")
        return [], False

    return result["rows"], result["discard"]

# ─────────────────────────────────────────────
# PAGE-SIZE / PAGINATION ("show All rows")
# ─────────────────────────────────────────────
def click_all_rows_per_page(page):
    """
    Opens the "N rows per page" dropdown and clicks the "All" option.

    Returns True if it found and clicked "All", False otherwise (e.g.
    the dropdown isn't present because there's only one page of results).
    """
    toggle_frame = None
    toggle       = None

    for frame in page.frames:
        try:
            el = frame.query_selector("span.page-list button.dropdown-toggle")
            if el and el.is_visible():
                toggle_frame, toggle = frame, el
                break
        except Exception:
            pass
        try:
            handle = frame.evaluate_handle("""
                () => {
                    const candidates = Array.from(document.querySelectorAll('button, a, span, div'));
                    for (const c of candidates) {
                        const t = (c.textContent || '').trim();
                        if (/^(500|1000)$/.test(t)) {
                            let node = c;
                            for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
                                if (node.textContent && node.textContent.toLowerCase().includes('rows per page')) {
                                    return c;
                                }
                            }
                        }
                    }
                    return null;
                }
            """)
            el = handle.as_element()
            if el and el.is_visible():
                toggle_frame, toggle = frame, el
                break
        except Exception:
            continue

    if not toggle:
        print("  Page-size dropdown not found in any frame (probably a single page of results).")
        return False

    try:
        toggle.scroll_into_view_if_needed(timeout=3000)
    except Exception:
        pass

    try:
        toggle.click(timeout=5000)
    except Exception as e:
        print(f"  Page-size toggle click error: {e}")
        return False

    toggle_frame.wait_for_timeout(500)

    try:
        target_handle = toggle_frame.evaluate_handle("""
            () => {
                const menus = Array.from(document.querySelectorAll(
                    '.dropdown-menu, ul[role="menu"], div[role="menu"], .dropdown-menu li'
                ));
                for (const menu of menus) {
                    const style = window.getComputedStyle(menu);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;
                    const links = Array.from(menu.querySelectorAll('a, li, span'));
                    for (const l of links) {
                        if ((l.textContent || '').trim().toLowerCase() === 'all') {
                            return l;
                        }
                    }
                    if ((menu.textContent || '').trim().toLowerCase() === 'all') {
                        return menu;
                    }
                }
                return null;
            }
        """)
        target = target_handle.as_element()
    except Exception as e:
        print(f"  'All' option scan error: {e}")
        target = None

    if not target:
        print("  'All' page-size option not found in any open dropdown menu.")
        return False

    try:
        target.click(timeout=5000)
        print("  Selected 'All' rows per page.")
        return True
    except Exception as e:
        print(f"  'All' click error: {e}")
        return False
    finally:
        try:
            toggle.dispose()
        except Exception:
            pass
        try:
            target.dispose()
        except Exception:
            pass

def wait_for_results_ready(page, timeout_ms):
    """
    Polls the results table itself (not pagination text — that can lag
    behind or carry over stale text from the previous search) until it
    actually contains real data rows, up to timeout_ms. This is the
    gate before pagination is ever touched: clicking "All" is only
    attempted once this returns, never while still polling.

    Returns True if data rows appeared before timeout_ms elapsed,
    False if we hit the timeout without seeing any — the caller treats
    False as a failure for this period (see run_search).
    """
    start_time = time.time()
    deadline   = start_time + timeout_ms / 1000
    poll_num   = 0

    while time.time() < deadline:
        poll_num += 1
        elapsed = round(time.time() - start_time, 1)

        landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
        found_table = None
        if landing:
            try:
                found_table, _ = find_results_table(landing)
            except Exception as e:
                found_table = None
                print(f"  [ready-check {poll_num} @ {elapsed}s] scan error: {e}")

            if found_table and table_has_data(found_table):
                print(f"  [ready-check {poll_num} @ {elapsed}s] table has data rows — ready for pagination.")
                try:
                    found_table.dispose()
                except Exception:
                    pass
                return True
            elif found_table:
                print(f"  [ready-check {poll_num} @ {elapsed}s] table present but no data rows yet.")
                try:
                    found_table.dispose()
                except Exception:
                    pass
            else:
                print(f"  [ready-check {poll_num} @ {elapsed}s] results table not found yet.")
        else:
            print(f"  [ready-check {poll_num} @ {elapsed}s] landingFrame not found yet.")

        page.wait_for_timeout(POLL_INTERVAL_MS)

    print(f"  No populated table seen within {timeout_ms // 1000}s.")
    return False

def get_expected_row_total(page):
    """
    Reads the "Showing 1 to X of Y rows" text so we can wait for the
    table to actually reach that count rather than guessing. Checks
    every frame's span.pagination-info first, then falls back to a
    raw text search of each frame's body for the same "of N rows"
    pattern. Returns Y as an int, or None if it can't be found anywhere.
    """
    for frame in page.frames:
        try:
            raw_text = frame.evaluate("""
                () => {
                    const el = document.querySelector('span.pagination-info');
                    return el ? el.innerText : null;
                }
            """)
        except Exception:
            continue
        if raw_text:
            print(f"  pagination-info text: {raw_text!r}")
            m = re.search(r'of\s+([\d,]+)\s+rows', raw_text, re.IGNORECASE)
            if m:
                return int(m.group(1).replace(",", ""))

    for frame in page.frames:
        try:
            body_text = frame.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            continue
        m = re.search(r'of\s+([\d,]+)\s+rows', body_text, re.IGNORECASE)
        if m:
            print(f"  Found row total via body-text fallback: {m.group(0)!r}")
            return int(m.group(1).replace(",", ""))

    print("  pagination-info not found in any frame.")
    return None

def wait_for_full_table_load(page, landing, timeout_ms):
    """
    Polls the row count on the landing frame (where the results table
    lives) until it stops changing (or matches the expected total read
    from pagination text anywhere on the page), since selecting "All"
    can take up to ~2 minutes to fully render for a large result set.
    Returns the final row count observed.
    """
    expected = get_expected_row_total(page)
    if expected:
        print(f"  Waiting for all {expected} row(s) to load (up to {timeout_ms // 1000}s)...")
    else:
        print(f"  Waiting for row count to stabilize (up to {timeout_ms // 1000}s)...")

    start_time  = time.time()
    deadline    = start_time + timeout_ms / 1000
    last_count  = -1
    stable_hits = 0
    poll_num    = 0

    while time.time() < deadline:
        landing.wait_for_timeout(POLL_INTERVAL_MS)
        poll_num += 1
        elapsed = round(time.time() - start_time, 1)
        try:
            count = landing.evaluate("""
                () => {
                    let max = 0;
                    document.querySelectorAll('table').forEach(t => {
                        const n = t.querySelectorAll('tbody tr').length;
                        if (n > max) max = n;
                    });
                    return max;
                }
            """)
        except Exception as e:
            print(f"  [poll {poll_num} @ {elapsed}s] row-count read error: {e}")
            count = last_count

        print(f"  [poll {poll_num} @ {elapsed}s] row count = {count}"
            + (f" (expected {expected})" if expected else ""))

        if expected and count >= expected:
            print(f"  Row count reached expected total ({count}/{expected}) after {elapsed}s.")
            return count

        if count == last_count and count > 0:
            stable_hits += 1
            if stable_hits >= STABLE_POLLS_NEEDED:
                print(f"  Row count stable at {count} rows after {elapsed}s.")
                return count
        else:
            stable_hits = 0
        last_count = count

    print(f"  Timed out waiting for full table load (last observed: {last_count} rows).")
    return last_count

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
# SEARCH CRITERIA (dates + dropdowns)
# ─────────────────────────────────────────────
def set_date_field(landing, field_name, date_str):
    """
    Fills a date input (checkInDateFrom / checkInDateTo) and fires the
    field's native onblur handler (verifyDate) so the portal's own JS
    validates/reformats it the same way it would for a manual entry.
    """
    try:
        el = landing.query_selector(f"input[name='{field_name}']")
        if not el:
            print(f"  Date field not found: {field_name}")
            return False
        el.fill(date_str)
        landing.evaluate(f"""
            () => {{
                const el = document.getElementsByName('{field_name}')[0];
                if (el) el.blur();
            }}
        """)
        return True
    except Exception as e:
        print(f"  Date field error ({field_name}): {e}")
        return False

def set_search_criteria(landing):
    """
    Configures the search form before clicking Search.

    - reservationStatus: select ALL options (multi-select)
    - folioBalance: force to "All" (value="0")
    """
    try:
        landing.evaluate("""
            () => {
                // All reservation statuses
                const statusSel = document.querySelector('select[name="reservationStatus"]');
                if (statusSel) { for (let o of statusSel.options) o.selected = true; }

                // Folio Balance -> "All" (value="0")
                const folioSel = document.querySelector('select[name="folioBalance"]');
                if (folioSel) {
                    folioSel.value = '0';
                    folioSel.dispatchEvent(new Event('change'));
                }

                // Add further selects/checkboxes here following the
                // patterns documented in this function's docstring.
            }
        """)
        return True
    except Exception as e:
        print(f"  Criteria select error: {e}")
        return False

# ─────────────────────────────────────────────
# SEARCH + SCRAPE
# ─────────────────────────────────────────────
def run_search(page, date_from=None, date_to=None):
    """
    Returns (rows, success):
      success=True,  rows=[...]  -> found data, extracted normally
      success=True,  rows=[]     -> table explicitly said "no matching
                                     records" — a legitimate empty
                                     result, not a failure
      success=False, rows=[]     -> something went wrong (couldn't
                                     find the search page/button/table,
                                     a click errored out, extraction
                                     failed, etc.) — caller should
                                     count this period as FAILED
    """
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return [], False

    if date_from and date_to:
        print(f"  Setting date range {date_from} -> {date_to}...")
        set_date_field(landing, "checkInDateFrom", date_from)
        set_date_field(landing, "checkInDateTo", date_to)

    print("  Setting search criteria (statuses, folio balance)...")
    set_search_criteria(landing)

    print(f"  Clicking Search (initial page can take up to {SEARCH_TIMEOUT // 1000}s)...")
    try:
        btn = (landing.query_selector("input[name='search']") or
               landing.query_selector("input[value='Search']"))
        if not btn:
            print("  Search button not found.")
            return [], False
        btn.click()
    except Exception as e:
        print(f"  Search click error: {e}")
        return [], False

    # ── Phase 1: wait for the load-complete signal, capped at SEARCH_TIMEOUT ──
    # Polls the actual results table (see wait_for_results_ready) instead of
    # blindly sleeping the full ceiling every time. SEARCH_TIMEOUT is still the hard cap if it
    # never shows up. 
    print(f"  Waiting for results to finish loading (up to {SEARCH_TIMEOUT // 1000}s)...")
    ready = wait_for_results_ready(page, timeout_ms=SEARCH_TIMEOUT)
    if not ready:
        print(f"  Treating this period as FAILED — no populated table appeared "
              f"within {SEARCH_TIMEOUT // 1000}s.")
        screenshot(page, "no_data_within_timeout")
        return [], False

    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    table = headers = None
    if landing:
        try:
            table, headers = find_results_table(landing)
        except Exception as e:
            print(f"  Scan error: {e}")

    if not table:
        print("  No results table found after the wait.")
        screenshot(page, "no_results_table")
        return [], False

    clean_headers = [h for h in headers if h]
    print(f"  Results table found: {clean_headers[:5]}...")

    try:
        table.dispose()
    except Exception:
        pass

    # ── Phase 2: switch to "All" rows per page and wait for it to fill in ──
    if click_all_rows_per_page(page):
        wait_for_full_table_load(page, landing, timeout_ms=PAGINATION_TIMEOUT)
    else:
        # No dropdown found (single page already) — still give any
        # late-arriving rows a short moment to settle before we read
        # the table.
        wait_for_full_table_load(page, landing, timeout_ms=15000)

    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT) or landing
    table, headers = find_results_table(landing)
    if not table:
        print("  Results table not found after switching to 'All' rows per page.")
        screenshot(page, "no_results_after_pagination")
        return [], False

    results_rows, discard = extract_rows_from_table(table, headers)

    try:
        table.dispose()
    except Exception:
        pass

    if discard:
        print("  No matching records for this period (legitimate empty result).")
        return [], True

    if not results_rows:
        print("  No results extracted — treating as a failure for this period.")
        screenshot(page, "no_results")
        return [], False

    print(f"  Found {len(results_rows)} row(s).")
    return results_rows, True

# ─────────────────────────────────────────────
# SAVE
# ─────────────────────────────────────────────
def load_existing_master_rows():
    """
    Reads the current folio_report.csv (if it exists) into a list of
    dicts, so a run can merge new results into it
    """
    if not os.path.isfile(FOLIO_REPORT_CSV):
        return []
    try:
        with open(FOLIO_REPORT_CSV, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return [dict(row) for row in reader]
    except Exception as e:
        print(f"  Could not read existing {FOLIO_REPORT_CSV} to merge: {e}")
        return []

def merge_rows_for_save(new_rows, refreshed_period_labels):
    """
    Updates folio_report.csv by overwriting data only for the periods processed in the current run, 
    while preserving all previously scraped data for other periods.
    """
    existing = load_existing_master_rows()
    kept = [r for r in existing if r.get("_period") not in refreshed_period_labels]
    dropped = len(existing) - len(kept)
    if dropped:
        print(f"  Replacing {dropped} existing row(s) from period(s) re-scraped this run.")
    return kept + new_rows

def save_master_csv(all_rows):
    """
    Writes the combined folio_report.csv that folio_scraper.py reads
    from, in ONE pass with ONE fixed column order.
    """
    if not all_rows:
        print("  No rows to write — folio_report.csv not written.")
        return None
    os.makedirs(REPORTS_FOLDER, exist_ok=True)

    all_keys = []
    seen = set()
    for row in all_rows:
        for k in row:
            if k not in seen:
                all_keys.append(k)
                seen.add(k)

    with open(FOLIO_REPORT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"\n  Saved: {FOLIO_REPORT_CSV} ({len(all_rows)} rows total)")
    print(f"  Columns: {all_keys}")
    return FOLIO_REPORT_CSV

def mark_period_done(label):
    """Appends a successfully-scraped period (e.g. '2025_03') to DONE_LOG."""
    try:
        os.makedirs(OUTPUT_FOLDER, exist_ok=True)
        with open(DONE_LOG, "a", encoding="utf-8") as f:
            f.write(f"{label}\n")
    except Exception as e:
        print(f"  Could not update {DONE_LOG} for {label}: {e}")

def load_done_periods():
    """
    Reads DONE_LOG (folio_report_done.txt) into a set of period labels
    (e.g. {"2025_01", "2025_02"}) already successfully scraped by a
    previous run, so a rerun can skip them instead of re-scraping
    everything from scratch.
    """
    if not os.path.isfile(DONE_LOG):
        return set()
    try:
        with open(DONE_LOG, encoding="utf-8") as f:
            return {line.strip() for line in f if line.strip()}
    except Exception as e:
        print(f"  Could not read {DONE_LOG}: {e}")
        return set()

# ─────────────────────────────────────────────
# YEAR / MONTH RANGE LOGIC
# ─────────────────────────────────────────────
def get_periods(mode, year=None, month=None, today=None):
    """
    Returns a list of (year, month) tuples to process.

    mode == "month":  just the single (year, month) given.
    mode == "single": `year`, Jan through Dec, but capped at the
                       current month if `year` is the current year.
    mode == "all":     every year from the current year down to
                       EARLIEST_YEAR, each capped at the current month
                       for the current year, and starting at
                       November for EARLIEST_YEAR —
                       so the default run goes back to Nov 2019
    """
    if mode == "month":
        return [(year, month)]

    today = today or datetime.now()

    if mode == "single":
        years = [year]
    else:
        years = list(range(today.year, EARLIEST_YEAR - 1, -1))

    periods = []
    for y in years:
        last_month  = today.month if y == today.year else 12
        first_month = EARLIEST_MONTH if (mode == "all" and y == EARLIEST_YEAR) else 1
        for m in range(first_month, last_month + 1):
            periods.append((y, m))
    return periods

def month_bounds(year, month):
    first_day = date(year, month, 1)
    last_day  = date(year, month, calendar.monthrange(year, month)[1])
    return first_day.strftime(DATE_FORMAT), last_day.strftime(DATE_FORMAT)

# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="Folio report scraper")
    parser.add_argument(
        "--year", type=int,
        help=(f"Scrape a single year, e.g. 2025. If omitted (and --month "
              f"isn't given either), scrapes every year from the current "
              f"year back to {EARLIEST_MONTH:02d}/{EARLIEST_YEAR}.")
    )
    parser.add_argument(
        "--month", type=int, choices=range(1, 13), metavar="1-12",
        help="Combined with --year: scrape only that single month and "
             "merge it into the existing folio_report.csv instead of "
             "doing the whole year. Always runs even if that month is "
             "already recorded in folio_report_done.txt."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-scrape periods even if they're already recorded in "
             "folio_report_done.txt. Ignored for --month, which always runs."
    )
    args = parser.parse_args()
    if args.month is not None and not args.year:
        parser.error("--month requires --year (e.g. --year 2025 --month 3).")
    return args

def resolve_mode():
    args = parse_args()
    if args.month is not None:
        return "month", args.year, args.month, args.force
    if args.year:
        return "single", args.year, None, args.force
    return "all", None, None, args.force

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Folio Report — Phase 1: Collect reservation listing")
    print("=" * 60)

    mode, year, month, force = resolve_mode()
    periods = get_periods(mode, year=year, month=month)

    if mode == "month":
        print(f"\nMode: single month {year}-{month:02d} (merged into existing master file)")
    elif mode == "single":
        print(f"\nMode: single year {year} ({len(periods)} month(s))")
    else:
        first_y, first_m = min(periods)
        last_y, last_m   = max(periods)
        print(f"\nMode: all years {first_y}-{first_m:02d} through "
              f"{last_y}-{last_m:02d} ({len(periods)} month(s) total)")

    done_periods = load_done_periods()
    if done_periods and mode != "month" and not force:
        print(f"  {len(done_periods)} period(s) already in {DONE_LOG} — "
              f"these will be skipped (use --force to re-scrape them).")

    successes = []   # display strings, e.g. "2025-03"
    failures  = []   # display strings, e.g. "2025-04"
    skipped   = []   # display strings, e.g. "2025-02"
    refreshed_labels = set()   # "_period" values, e.g. "2025_03"
    all_rows  = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        page    = browser.new_page()
        try:
            login(page)
            dismiss_popup(page)

            for (y, m) in periods:
                label   = f"{y}_{m:02d}"
                display = f"{y}-{m:02d}"

                # --month always runs regardless of the done log — an
                # explicit single-month request is a deliberate ask for
                # that period. Otherwise, skip anything already recorded
                # unless --force was passed.
                if mode != "month" and not force and label in done_periods:
                    print(f"\n--- Period {display}: already in {os.path.basename(DONE_LOG)} — skipping ---")
                    skipped.append(display)
                    continue

                date_from, date_to = month_bounds(y, m)
                print(f"\n--- Period {display} ({date_from} to {date_to}) ---")

                try:
                    if not navigate_to_folios(page):
                        print(f"  ERROR: Could not reach Folios search page for {label}.")
                        failures.append(display)
                        continue

                    rows, success = run_search(page, date_from=date_from, date_to=date_to)
                except Exception as e:
                    print(f"  ERROR: unexpected exception while processing {label}: {e}")
                    screenshot(page, f"error_{label}")
                    failures.append(display)
                    continue

                if not success:
                    print(f"  Marking {display} as FAILED.")
                    failures.append(display)
                    continue

                for r in rows:
                    r["_period"] = label
                all_rows.extend(rows)
                successes.append(display)
                refreshed_labels.add(label)
                mark_period_done(label)
                print(f"  {len(rows)} row(s) collected for {label} "
                    f"(running total: {len(all_rows)}).")

            combined_rows = merge_rows_for_save(all_rows, refreshed_labels)
            save_master_csv(combined_rows)

        except Exception as e:
            print(f"Fatal: {e}")
            screenshot(page, "fatal")
            raise
        finally:
            browser.close()

    print("\n" + "=" * 60)
    print("Run Summary")
    print("=" * 60)
    print(f"  Details: failed: {len(failures)}, success: {len(successes)}, skipped: {len(skipped)}")
    if successes:
        print(f"  Successful months: {', '.join(successes)}")
    if failures:
        print(f"  Failed months: {', '.join(failures)}")
    if skipped:
        print(f"  Skipped months (already done): {', '.join(skipped)}")
    print("=" * 60)

    print("\nDone. Run folio_scraper.py to scrape folio details.")

if __name__ == "__main__":
    main()