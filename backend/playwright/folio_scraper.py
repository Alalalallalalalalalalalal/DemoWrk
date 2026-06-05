"""
folio_scraper.py — Phase 2: Read folio_report.csv, scrape each reservation's
folio detail pages, save per-guest CSVs to journal folder.

Run folio_report.py first to generate folio_report.csv.

Output CSV columns per row:
  Date, Description, Amount,
  _folio_num, _folio_name, _balance_due, _reservation_folio_id,
  Conf. Code, Main Member #, Member #, Guest Name,
  Check-In Date, Check-Out Date, Room #, Room Rate,
  Reservation Status

Folder naming:
  - Guests from Guests tab  → journal/{guest_number}/
  - All other folios        → journal/{main_member_number}/ (first token of Member/Guest Name)

Guest table saved per reservation:
  journal/{main_member_num}/{main_member_num}_guests.csv
  Columns: Conf. Code, Member #, Guest Name, Folio, Is Owner,
           Check-In Date, Check-Out Date, Room #

Usage:
    python folio_scraper.py                  # First 10 reservations
    python folio_scraper.py --all            # All reservations
    python folio_scraper.py --limit 5        # Custom limit
    python folio_scraper.py --workers 4      # Parallel workers
    python folio_scraper.py --reset          # Clear done log
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
from login import login

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
JOURNAL_FOLDER    = os.path.join(OUTPUT_FOLDER, "journal")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
REPORTS_FOLDER    = os.path.join(OUTPUT_FOLDER, "reports")
DONE_LOG          = os.path.join(OUTPUT_FOLDER, "folio_done.txt")
FOLIO_REPORT_CSV  = os.path.join(REPORTS_FOLDER, "folio_report.csv")

DEFAULT_LIMIT   = 10    # only used if --limit is explicitly passed
DEFAULT_WORKERS = 4

NAV_TIMEOUT   = 15000
FRAME_TIMEOUT = 8000
FOLIO_TIMEOUT = 12000

# Listing columns to carry into every scraped folio row
LISTING_COLUMNS = [
    "Conf. Code",
    "Main Member #",   # member number of the reservation holder
    "Member #",        # derived: first token of Member/Guest Name (folio owner)
    "Guest Name",      # derived: remainder of Member/Guest Name
    "Check-In Date",
    "Check-Out Date",
    "Room #",
    "Villa Name",
    "Bedroom Count",
    "Reservation Status",
]

# ─────────────────────────────────────────────
# DONE LOG
# ─────────────────────────────────────────────
def load_done_set():
    if not os.path.exists(DONE_LOG):
        return set()
    with open(DONE_LOG, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())

def mark_done(conf_code):
    with open(DONE_LOG, "a", encoding="utf-8") as f:
        f.write(f"{conf_code}\n")

# ─────────────────────────────────────────────
# LOAD REPORT
# ─────────────────────────────────────────────
def split_member_guest(raw):
    """
    'TTC1G371, Southwest P G A, .' → ('TTC1G371', 'Southwest P G A, .')
    '86, Keith, Shelley'           → ('86', 'Keith, Shelley')
    """
    if not raw:
        return "", ""
    parts = raw.split(",", 1)
    member_num  = parts[0].strip()
    guest_name  = parts[1].strip() if len(parts) > 1 else ""
    return member_num, guest_name

def load_folio_report():
    if not os.path.exists(FOLIO_REPORT_CSV):
        print(f"ERROR: {FOLIO_REPORT_CSV} not found.")
        print("Run folio_report.py first.")
        sys.exit(1)
    rows = []
    with open(FOLIO_REPORT_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            d = dict(row)
            # Split Member/Guest Name into Member # and Guest Name
            raw = d.get("Member/Guest Name", "") or d.get("_member_name", "")
            d["Member #"],  d["Guest Name"] = split_member_guest(raw)
            rows.append(d)
    print(f"  Loaded {len(rows)} row(s) from folio_report.csv")
    return rows

# ─────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────
def pr(prefix, msg):
    print(f"  {prefix}{msg}")

def screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"scraper_{name}_{ts}.png")
        page.screenshot(path=path)
        pr("", f"Screenshot: {path}")
        return path
    except Exception:
        return None

def get_conf_code(row):
    for key in ("Conf. Code", "col_2", "col_0"):
        v = row.get(key, "").strip()
        if v:
            return v
    return "UNKNOWN"

def parse_room_rate(room_rate):
    if not room_rate:
        return "", None
    match = re.search(r'(\d+)\s*BR', room_rate, re.IGNORECASE)
    if match:
        bedroom_count = int(match.group(1))
        room_name = re.sub(r'\s*\d+\s*BR', '', room_rate, flags=re.IGNORECASE).strip()
        return room_name, bedroom_count
    return room_rate.strip(), 1

def extract_room_unit(room_no):
    if not room_no:
        return ""
    parts = room_no.split("-", 1)
    if len(parts) == 2:
        room = parts[0].strip()
        unit = parts[1].strip()
        return unit, room
    return "", room_no.strip()

def save_csv(filepath, rows):
    """Write rows to filepath, always overwriting any existing file."""
    if not rows:
        return None
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    all_keys  = []
    seen_keys = set()
    for row in rows:
        for k in row:
            if k not in seen_keys:
                all_keys.append(k)
                seen_keys.add(k)

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return filepath

def folio_csv_path(folder_name, folio_num):
    folder = os.path.join(JOURNAL_FOLDER, folder_name)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{folder_name}_folio_{folio_num}.csv")

def guests_csv_path(member_num):
    folder = os.path.join(JOURNAL_FOLDER, member_num)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{member_num}_guests.csv")

# ─────────────────────────────────────────────
# FRAME HELPERS
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
        page.wait_for_timeout(200)
    return None

def session_alive(page):
    return get_landing_frame(page, timeout_ms=1000) is not None

def ensure_session(page, worker_id=0):
    if session_alive(page):
        return False
    prefix = f"[W{worker_id}] "
    pr(prefix, "Session lost — re-logging in...")
    try:
        login(page)
        page.wait_for_timeout(2000)
        get_landing_frame(page, timeout_ms=10000)
        pr(prefix, "Re-login complete.")
        return True
    except Exception as e:
        pr(prefix, f"Re-login failed: {e}")
        return False

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
                    page.wait_for_timeout(1000)
                    return

            except Exception:
                continue

        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

    except Exception:
        pass

# ─────────────────────────────────────────────
# RESERVATION NAVIGATION
# ─────────────────────────────────────────────
def navigate_to_reservation(page, conf_href, conf_code, prefix=""):
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        pr(prefix, f"No landingFrame for {conf_code}")
        return False
    url = (conf_href if conf_href.startswith("http")
           else f"{BASE_URL}/PMS/{conf_href.lstrip('/')}")
    pr(prefix, f"Navigating to reservation {conf_code}...")
    try:
        landing.goto(url, timeout=NAV_TIMEOUT)
        try:
            landing.wait_for_selector(
                "input[name='folio'], input[value='Folio Management'], #guestSectionTab",
                timeout=FOLIO_TIMEOUT
            )
        except PWTimeout:
            page.wait_for_timeout(3000)
        pr(prefix, "Reservation page loaded.")
        dismiss_popup(page)
        return True
    except Exception as e:
        pr(prefix, f"Navigation error: {e}")
        return False

# ─────────────────────────────────────────────
# GUESTS TAB
# ─────────────────────────────────────────────
def scrape_guests_tab(page, conf_code, listing_row, prefix=""):
    """
    Read Guests tab.
    Returns:
      folio_to_guest  — {folio_label/num: guest_number}
      guest_rows      — list of dicts for the guests CSV
    """
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return {}, []

    try:
        for selector in ["#guestSectionTab a", "a[href='#guestSection']", "#ui-id-2"]:
            tab = landing.query_selector(selector)
            if tab:
                tab.click()
                page.wait_for_timeout(800)
                break
    except Exception:
        pass

    folio_to_guest = {}
    guest_rows     = []

    try:
        table = landing.query_selector("#guestsForDisplay")
        if not table:
            for t in landing.query_selector_all("table"):
                header_text = " ".join(
                    th.inner_text().lower() for th in t.query_selector_all("th")
                )
                if "folio" in header_text and "guest" in header_text:
                    table = t
                    break

        if not table:
            pr(prefix, "Guests table not found")
            return {}, []

        rows = table.query_selector_all("tr")
        pr(prefix, f"  Guests tab: {len(rows)-1} guest row(s)")

        for tr in rows[1:]:
            cells = tr.query_selector_all("td")
            if len(cells) < 3:
                continue
            guest_num = " ".join(cells[0].inner_text().split())
            name      = cells[1].inner_text().strip() if len(cells) > 1 else ""
            folio     = cells[2].inner_text().strip() if len(cells) > 2 else ""
            is_owner  = cells[3].inner_text().strip() if len(cells) > 3 else ""

            if guest_num and folio:
                parts = folio.split()
                num   = parts[-1] if parts and parts[-1].isdigit() else None
                folio_to_guest[folio] = guest_num
                if num:
                    folio_to_guest[num] = guest_num
                pr(prefix, f"    {guest_num} → {folio} (owner: {is_owner})")

            # Build guest CSV row
            g_member, g_name = split_member_guest(guest_num)
            guest_rows.append({
                "Conf. Code":    conf_code,
                "Member #":      g_member,
                "Guest Name":    g_name or name,
                "Folio":         folio,
                "Is Owner":      is_owner,
                "Check-In Date": listing_row.get("Check-In Date", ""),
                "Check-Out Date":listing_row.get("Check-Out Date", ""),
                "Room #":        listing_row.get("Room #", ""),
            })

    except Exception as e:
        pr(prefix, f"Guests tab error: {e}")

    return folio_to_guest, guest_rows

# ─────────────────────────────────────────────
# FOLIO MANAGEMENT
# ─────────────────────────────────────────────
def open_folio_management(page, conf_code, prefix=""):
    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return None

    res_id = None
    try:
        el = landing.query_selector('input[name="reservationId"], input[id="reservationId"]')
        if el:
            res_id = el.get_attribute("value")
    except Exception:
        pass
    if not res_id:
        try:
            m = re.search(r'reservationId=(\d+)', landing.url)
            if m:
                res_id = m.group(1)
        except Exception:
            pass
    if not res_id:
        res_id = conf_code

    pr(prefix, f"Opening Folio Management (res_id={res_id})...")

    try:
        btn = landing.query_selector("input[name='folio'], input[value='Folio Management']")
        if btn:
            btn.click()
            page.wait_for_timeout(3000)
            dismiss_popup(page)
            landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if landing and "folio" in landing.url.lower():
                pr(prefix, f"  Folio page via button: {landing.url[:80]}")
                return landing
    except Exception as e:
        pr(prefix, f"  Button click error: {e}")

    landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not landing:
        return None
    try:
        url = f"{BASE_URL}/PMS/openFolios.do?reservationId={res_id}"
        pr(prefix, f"  Direct nav: {url}")
        landing.goto(url, timeout=NAV_TIMEOUT)
        page.wait_for_timeout(2000)
        dismiss_popup(page)
        landing = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
        if landing and "folio" in landing.url.lower():
            pr(prefix, "  Folio page via direct URL.")
            return landing
    except Exception as e:
        pr(prefix, f"  Direct nav error: {e}")

    pr(prefix, "Could not open Folio Management.")
    return None

# ─────────────────────────────────────────────
# FOLIO TAB SCRAPING
# ─────────────────────────────────────────────
def count_tab_groups(folio_frame, prefix=""):
    try:
        count = folio_frame.evaluate("""
            () => {
                let max = 0;
                document.querySelectorAll('a[onclick]').forEach(a => {
                    const m = a.getAttribute('onclick').match(/getTab\\('(\\d+)'\\)/);
                    if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
                });
                return max;
            }
        """)
        pr(prefix, f"  Tab groups found: {count}")
        return count or 1
    except Exception as e:
        pr(prefix, f"  Tab count error: {e}")
        return 1

def call_get_tab(folio_frame, tab_num, prefix=""):
    try:
        folio_frame.evaluate(f"getTab('{tab_num}')")
        folio_frame.wait_for_timeout(2000)
        return True
    except Exception as e:
        pr(prefix, f"  getTab({tab_num}) error: {e}")
        return False

def scrape_tab_folios(folio_frame, conf_code, folio_to_guest,
                      main_member_num, listing_meta, prefix=""):
    """
    Scrape all folios visible on the current tab.
    Returns {folder_name: {folio_num: [rows]}}

    Each row contains:
      Date, Description, Amount  (from the folio table)
      _folio_num, _folio_name, _balance_due, _reservation_folio_id
      + all LISTING_COLUMNS (Conf. Code, Member #, Guest Name, dates, etc.)
    """
    results = {}
    try:
        spans = folio_frame.query_selector_all("span.boldWhite")
        pr(prefix, f"    {len(spans)} folio header(s) on this tab")

        for span in spans:
            try:
                raw_text = span.inner_text().strip()
                lines    = [l.strip() for l in raw_text.split("\n") if l.strip()]
                header_line  = lines[0] if lines else ""
                balance_line = lines[1] if len(lines) > 1 else ""

                m = re.match(r'Folio\s+(\d+)\s*[-–]\s*(.*)', header_line, re.IGNORECASE)
                if not m:
                    continue
                folio_num  = m.group(1)
                folio_name = m.group(2).strip()

                balance = ""
                bm = re.search(r'balance due:\s*(.+)', balance_line, re.IGNORECASE)
                if bm:
                    balance = bm.group(1).strip()

                pr(prefix, f"    Folio {folio_num} — {folio_name[:30]} | balance: {balance}")

                # Find sibling table via JS DOM walk
                table_el = folio_frame.evaluate_handle("""
                    (span) => {
                        let el = span;
                        for (let i = 0; i < 15; i++) {
                            if (!el) break;
                            let sib = el.nextElementSibling;
                            while (sib) {
                                if (sib.tagName === 'TABLE') return sib;
                                const t = sib.querySelector('table[id^="folioId_"]');
                                if (t) return t;
                                sib = sib.nextElementSibling;
                            }
                            el = el.parentElement;
                        }
                        return null;
                    }
                """, span)

                if not table_el:
                    pr(prefix, f"      No table for Folio {folio_num} — skipping")
                    continue

                table_id     = folio_frame.evaluate("(t) => t.id", table_el)
                res_folio_id = table_id.replace("folioId_", "") if table_id else ""

                # Scrape tbody rows — only Date, Description, Amount
                rows = folio_frame.evaluate("""
                    (table) => {
                        const ths  = table.querySelectorAll('thead th');
                        const hdrs = Array.from(ths).map(th =>
                            th.innerText.replace(/[▲▼↑↓]/g, '').trim()
                        );
                        const rows = [];
                        table.querySelectorAll('tbody tr').forEach(tr => {
                            const cells = Array.from(tr.querySelectorAll('td'))
                                              .map(td => td.innerText.trim());
                            if (!cells.some(c => c)) return;
                            const row = {};
                            cells.forEach((c, i) => {
                                row[hdrs[i] || ('col_' + i)] = c;
                            });
                            rows.push(row);
                        });
                        return rows;
                    }
                """, table_el)

                if not rows:
                    pr(prefix, f"      Folio {folio_num}: empty — skipping")
                    continue

                # Determine folder name
                # Guest map takes priority, then always fall back to the
                # main reservation holder — never use conf_code as a folder.
                folio_label = f"Folio {folio_num}"
                if folio_label in folio_to_guest:
                    folder_name = folio_to_guest[folio_label]
                elif folio_num in folio_to_guest:
                    folder_name = folio_to_guest[folio_num]
                else:
                    folder_name = main_member_num

                # Add metadata — in the exact final column order
                for row in rows:
                    row["_folio_num"]            = folio_num
                    row["_folio_name"]           = folio_name
                    row["_balance_due"]          = balance
                    row["_reservation_folio_id"] = res_folio_id
                    for col in LISTING_COLUMNS:
                        row[col] = listing_meta.get(col, "")

                pr(prefix, f"      Folio {folio_num}: {len(rows)} row(s) → folder '{folder_name}'")
                results.setdefault(folder_name, {})[folio_num] = rows

            except Exception as e:
                pr(prefix, f"    Span error: {e}")
                continue

    except Exception as e:
        pr(prefix, f"    Tab scrape error: {e}")

    return results

def scrape_all_folio_tabs(folio_frame, conf_code, folio_to_guest,
                            main_member_num, listing_meta, prefix=""):
    """Iterate all tab groups via getTab('N'). Returns {folder: {folio_num: [rows]}}"""
    results    = {}
    num_groups = count_tab_groups(folio_frame, prefix)

    for tab_num in range(1, num_groups + 1):
        pr(prefix, f"  Tab group {tab_num}/{num_groups} (getTab('{tab_num}'))...")
        if not call_get_tab(folio_frame, tab_num, prefix):
            continue
        tab_data = scrape_tab_folios(
            folio_frame, conf_code, folio_to_guest,
            main_member_num, listing_meta, prefix
        )
        for folder, folio_dict in tab_data.items():
            results.setdefault(folder, {}).update(folio_dict)

    return results

# ─────────────────────────────────────────────
# PER-RESERVATION PIPELINE
# ─────────────────────────────────────────────
def scrape_reservation(page, reservation_row, prefix=""):
    """Full pipeline for one reservation. Returns {folder: [filepaths]}"""
    conf_code      = get_conf_code(reservation_row)
    conf_href      = reservation_row.get("_conf_href", "")
    main_member_num = reservation_row.get("Member #", "")
    room_rate = reservation_row.get("Room Rate", "")
    room_name, bedroom_count = parse_room_rate(room_rate)
    room_no = reservation_row.get("Room #", "")
    room_unit, room = extract_room_unit(room_no)
    if not main_member_num:
        raw = reservation_row.get("Member/Guest Name", "") or reservation_row.get("_member_name", "")
        main_member_num, _ = split_member_guest(raw)

    # fallback if extract_room_unit didn't actually split properly
    if "-" not in room_no:
        room = room_name
        room_unit = ""

    # Listing metadata to attach to every folio row
    listing_meta = {col: reservation_row.get(col, "") for col in LISTING_COLUMNS}
    listing_meta["Main Member #"] = main_member_num
    listing_meta["Villa Name"] = room
    listing_meta["Bedroom Count"] = bedroom_count
    listing_meta["Room #"] = room_unit

    saved_files = {}
    pr(prefix, f"=== Reservation: {conf_code} | {reservation_row.get('Member/Guest Name', '')} ===")

    if not conf_href:
        pr(prefix, "No URL — skipping")
        return saved_files

    if not navigate_to_reservation(page, conf_href, conf_code, prefix):
        return saved_files

    # Guests tab
    pr(prefix, "Reading Guests tab...")
    folio_to_guest, guest_rows = scrape_guests_tab(
        page, conf_code, reservation_row, prefix
    )
    pr(prefix, f"Folio→Guest map: {folio_to_guest}")

    # Save guests CSV in main member's folder
    if main_member_num and guest_rows:
        gp = guests_csv_path(main_member_num)
        save_csv(gp, guest_rows)
        pr(prefix, f"Saved guests: {os.path.basename(gp)} ({len(guest_rows)} row(s))")

    # Open Folio Management
    folio_frame = open_folio_management(page, conf_code, prefix)
    if not folio_frame:
        screenshot(page, f"no_folio_{conf_code}")
        return saved_files

    # Scrape all tab groups
    pr(prefix, "Scraping folio tabs...")
    folio_data = scrape_all_folio_tabs(
        folio_frame, conf_code, folio_to_guest,
        main_member_num, listing_meta, prefix
    )

    if not folio_data:
        pr(prefix, "No folio data scraped.")
        screenshot(page, f"empty_{conf_code}")
        return saved_files

    for folder_name, folio_dict in folio_data.items():
        for folio_num, rows in folio_dict.items():
            fp = folio_csv_path(folder_name, folio_num)
            saved = save_csv(fp, rows)
            if saved:
                saved_files.setdefault(folder_name, []).append(saved)
                pr(prefix, f"Saved: {os.path.basename(saved)} ({len(rows)} rows)")

    return saved_files

# ─────────────────────────────────────────────
# WORKER
# ─────────────────────────────────────────────
def _worker_init():
    signal.signal(signal.SIGINT, signal.SIG_IGN)

def scrape_chunk(args):
    reservations_chunk, worker_id = args
    time.sleep(worker_id * 5)

    prefix   = f"[W{worker_id}] "
    results  = {"success": [], "failed": [], "skipped": []}
    done_set = load_done_set()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        page    = browser.new_page()
        try:
            pr(prefix, "Logging in...")
            login(page)
            try:
                page.wait_for_selector("body", timeout=5000)
            except PWTimeout:
                pass
            dismiss_popup(page)

            # Prime iframe hierarchy
            try:
                page.goto(f"{BASE_URL}/PMS/default.jsp", timeout=NAV_TIMEOUT)
                page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
                get_landing_frame(page, timeout_ms=8000)
            except Exception as e:
                pr(prefix, f"Prime warning: {e}")

            pr(prefix, f"Ready. Processing {len(reservations_chunk)} reservation(s)...")

            for i, row in enumerate(reservations_chunk, 1):
                conf_code = get_conf_code(row)
                pr(prefix, f"[{i}/{len(reservations_chunk)}] {conf_code}")

                ensure_session(page, worker_id)

                if conf_code in done_set:
                    pr(prefix, "Already done — skipping.")
                    results["skipped"].append(conf_code)
                    continue

                saved = scrape_reservation(page, row, prefix)

                if not saved:
                    if ensure_session(page, worker_id):
                        pr(prefix, f"Retrying {conf_code}...")
                        saved = scrape_reservation(page, row, prefix)

                if saved:
                    mark_done(conf_code)
                    done_set.add(conf_code)
                    count = sum(len(v) for v in saved.values())
                    pr(prefix, f"Done: {count} file(s) saved.")
                    results["success"].append(conf_code)
                else:
                    pr(prefix, "Nothing saved — not marking done, will retry next run.")
                    results["failed"].append(conf_code)

        except Exception as e:
            pr(prefix, f"Fatal: {e}")
            screenshot(page, f"worker_{worker_id}_fatal")
        finally:
            browser.close()

    return results

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Scrape reservation folio details.")
    parser.add_argument("--all",     action="store_true", default=True,
                        help="Process all reservations (default)")
    parser.add_argument("--limit",   type=int, default=None,
                        help="Limit to N reservations (overrides --all)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Parallel browser workers (default: {DEFAULT_WORKERS})")
    parser.add_argument("--reset",   action="store_true",
                        help="Clear done log — reprocess everything")
    args = parser.parse_args()

    if args.reset:
        if os.path.exists(DONE_LOG):
            os.remove(DONE_LOG)
            print("Done log cleared.")

    done_count = len(load_done_set())
    if done_count:
        print(f"Already done: {done_count} reservation(s) (use --reset to reprocess)")

    print("=" * 60)
    print("Folio Scraper — Phase 2: Scrape folio detail pages")
    print("=" * 60)

    all_reservations = load_folio_report()
    if not all_reservations:
        return

    reservations = all_reservations if args.limit is None else all_reservations[:args.limit]
    print(f"  Reservations to process: {len(reservations)}")
    print(f"  Output folder:           {JOURNAL_FOLDER}")
    print()

    if len(reservations) == 1 or args.workers == 1:
        print("Single-worker mode...")
        result      = scrape_chunk((reservations, 1))
        all_results = [result]
    else:
        num_workers = min(args.workers, len(reservations))
        chunk_size  = math.ceil(len(reservations) / num_workers)
        chunks = [
            (reservations[i: i + chunk_size], wid)
            for wid, i in enumerate(range(0, len(reservations), chunk_size), 1)
        ]
        print(f"  Workers:    {num_workers}")
        print(f"  Per worker: ~{chunk_size}")
        print()

        pool = Pool(processes=num_workers, initializer=_worker_init)
        try:
            all_results = pool.map(scrape_chunk, chunks)
        except KeyboardInterrupt:
            print("\nInterrupted — stopping workers...")
            pool.terminate()
            pool.join()
            sys.exit(0)
        else:
            pool.close()
            pool.join()

    success      = sum(len(r["success"]) for r in all_results)
    failed       = sum(len(r["failed"])  for r in all_results)
    skipped      = sum(len(r["skipped"]) for r in all_results)
    failed_codes = [c for r in all_results for c in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Success: {success}")
    print(f"  Failed:  {failed}")
    print(f"  Skipped: {skipped}")
    if failed_codes:
        print(f"  Failed codes: {failed_codes}")
    print(f"  Journal: {JOURNAL_FOLDER}")
    print("=" * 60)

    # Auto-rerun failed reservations
    if failed_codes:
        print(f"\n  Retrying {len(failed_codes)} failed reservation(s)...")
        retry_rows = [r for r in all_reservations if get_conf_code(r) in set(failed_codes)]

        if len(retry_rows) == 1 or args.workers == 1:
            retry_result = scrape_chunk((retry_rows, 1))
            retry_results = [retry_result]
        else:
            num_workers = min(args.workers, len(retry_rows))
            chunk_size  = math.ceil(len(retry_rows) / num_workers)
            chunks = [
                (retry_rows[i : i + chunk_size], wid)
                for wid, i in enumerate(range(0, len(retry_rows), chunk_size), 1)
            ]
            pool = Pool(processes=num_workers, initializer=_worker_init)
            try:
                retry_results = pool.map(scrape_chunk, chunks)
            except KeyboardInterrupt:
                pool.terminate()
                pool.join()
                sys.exit(0)
            else:
                pool.close()
                pool.join()

        retry_success = sum(len(r["success"]) for r in retry_results)
        retry_failed  = sum(len(r["failed"])  for r in retry_results)
        still_failed  = [c for r in retry_results for c in r["failed"]]

        print("\n" + "=" * 60)
        print("Retry Summary")
        print("=" * 60)
        print(f"  Retry success: {retry_success}")
        print(f"  Still failed:  {retry_failed}")
        if still_failed:
            print(f"  Still failing: {still_failed}")
        print("=" * 60)

if __name__ == "__main__":
    main()