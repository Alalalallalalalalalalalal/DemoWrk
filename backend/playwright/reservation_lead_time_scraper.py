"""
reservation_lead_time_scraper.py — Entry point. Orchestrates login, menu
navigation, and reservation lead-time scraping.

Mirrors member_scraper.py's structure: login -> switch module -> navigate ->
process each item -> save -> summary. The difference is we're switching to
the Membership module (not Reporting) and looping over member numbers
(not report types).

What this script does, per member number:
    1. Switch top module tab to Membership (open_membership_menu, login.py)
    2. Fill/submit the quick-search form (member_utils.py)
    3. Open the member record from search results
    4. Click the member-name tab beside "Membership" -> Member Info panel
    5. Click "Rooms" -> lists that member's reservations w/ confirmation codes
    6. Click each confirmation code -> read "Created On" (booking creation date)
    7. Compute lead_time_days = arrival_date - created_on

Output:
    reports/reservation_lead_time.csv
      Columns: member_number, confirmation_code, room_number, arrival_date,
               departure_date, status, created_on, lead_time_days

Also see lead_time_report.py for the trend / average / export layer.

Setup:
    pip install playwright python-dateutil pandas openpyxl
    playwright install chromium

Usage:
    python reservation_lead_time_scraper.py --member 12345
    python reservation_lead_time_scraper.py --members-csv reports/member_map.csv
    python reservation_lead_time_scraper.py --members-csv reports/member_map.csv --limit 25
"""

import os
import csv
import sys
import argparse
from datetime import datetime

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from dateutil import parser as dateparser

from config import OUTPUT_FOLDER, REPORTS_FOLDER
from login import login, open_membership_menu
from member_utils import (
    navigate_to_search_member,
    search_member_by_number,
    open_member_record,
    click_member_name_tab,
    click_rooms_subtab,
    get_content_context,
)

SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
LEAD_TIME_CSV     = os.path.join(REPORTS_FOLDER, "reservation_lead_time.csv")


def pr(msg):
    print(f"  {msg}")


def screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"lead_time_{name}_{ts}.png")
        page.screenshot(path=path)
        pr(f"Screenshot: {path}")
    except Exception:
        pass


# ─────────────────────────────────────────────
# SCRAPE: reservations list + reservation detail (Created On)
# ─────────────────────────────────────────────
def scrape_reservations_list(lf):
    """
    Scrape the reservations table under Member Info > Rooms.
    Returns list of dicts with an extra "_conf_link" ElementHandle to click into.
    """
    rows = []
    try:
        lf.wait_for_selector("tbody tr", timeout=8000)
    except PWTimeout:
        pr("WARNING: no reservation rows found on Rooms tab.")
        return rows

    table_rows = lf.query_selector_all("tbody tr")
    pr(f"  Found {len(table_rows)} reservation row(s)")

    for tr in table_rows:
        try:
            cells = tr.query_selector_all("td")
            if not cells:
                continue

            def cell_text(i):
                return cells[i].inner_text().strip() if len(cells) > i else ""

            # ADJUST: column order — confirmation code is assumed col 0,
            # room col 1, arrival col 2, departure col 3, status col 4.
            conf_cell = cells[0]
            conf_link = conf_cell.query_selector("a")
            confirmation_code = (
                conf_link.inner_text().strip() if conf_link else cell_text(0)
            )

            rows.append({
                "confirmation_code": confirmation_code,
                "room_number":       cell_text(1),
                "arrival_date":      cell_text(2),
                "departure_date":    cell_text(3),
                "status":            cell_text(4),
                "_conf_link":        conf_link,
            })
        except Exception as e:
            pr(f"  Reservation row error: {e}")
            continue

    return rows


def scrape_created_on(page, conf_link):
    """
    Click a confirmation-code link to open the reservation detail, read the
    'Created On' field, then navigate back to the reservations list.
    """
    if not conf_link:
        return ""
    try:
        conf_link.click()
        page.wait_for_timeout(1800)

        lf = get_content_context(page)

        created_on = ""
        # ADJUST: "Created On" is usually a label with the value in a sibling
        # cell/span — try a couple of common layouts before giving up.
        label = lf.query_selector("text=Created On")
        if label:
            created_on = lf.evaluate(
                """(el) => {
                    let sib = el.nextElementSibling;
                    if (sib && sib.innerText.trim()) return sib.innerText.trim();
                    let row = el.closest('tr');
                    if (row) {
                        const tds = row.querySelectorAll('td');
                        if (tds.length > 1) return tds[1].innerText.trim();
                    }
                    let parent = el.parentElement;
                    return parent ? parent.innerText.replace('Created On', '').trim() : '';
                }""",
                label,
            )
        else:
            pr("  WARNING: 'Created On' label not found on detail page.")
            screenshot(page, "no_created_on")

        page.go_back()
        page.wait_for_timeout(1500)
        return created_on.strip()
    except Exception as e:
        pr(f"  Error scraping Created On: {e}")
        try:
            page.go_back()
            page.wait_for_timeout(1000)
        except Exception:
            pass
        return ""


# ─────────────────────────────────────────────
# LEAD TIME CALC
# ─────────────────────────────────────────────
def parse_date_safe(text):
    if not text or text.strip() in ("-", ""):
        return None
    try:
        return dateparser.parse(text.strip(), fuzzy=True).date()
    except Exception:
        return None


def compute_lead_time(created_on_text, arrival_text):
    created = parse_date_safe(created_on_text)
    arrival = parse_date_safe(arrival_text)
    if created and arrival:
        return (arrival - created).days
    return None


# ─────────────────────────────────────────────
# PER-MEMBER PROCESS
# ─────────────────────────────────────────────
def process_member(page, member_number):
    pr(f"── Member {member_number} ──────────────────")

    open_membership_menu(page)
    navigate_to_search_member(page)
    search_member_by_number(page, member_number)

    lf = get_content_context(page)
    lf = open_member_record(page, lf, member_number)
    click_member_name_tab(page)
    lf = click_rooms_subtab(page, member_number=member_number)

    reservations = scrape_reservations_list(lf)
    if not reservations:
        return []

    results = []
    for res in reservations:
        conf_link  = res.pop("_conf_link", None)
        created_on = scrape_created_on(page, conf_link)
        lead_time  = compute_lead_time(created_on, res["arrival_date"])

        results.append({
            "member_number":     member_number,
            "confirmation_code": res["confirmation_code"],
            "room_number":       res["room_number"],
            "arrival_date":      res["arrival_date"],
            "departure_date":    res["departure_date"],
            "status":            res["status"],
            "created_on":        created_on,
            "lead_time_days":    lead_time,
        })

        # Rooms list frame may be stale after go_back(); refresh reference.
        lf = click_rooms_subtab(page, member_number=member_number) or lf

    return results


# ─────────────────────────────────────────────
# SAVE / LOAD
# ─────────────────────────────────────────────
def save_lead_time_rows(rows, append=False):
    if not rows:
        pr("No lead-time rows to save.")
        return None

    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    fieldnames = [
        "member_number", "confirmation_code", "room_number",
        "arrival_date", "departure_date", "status",
        "created_on", "lead_time_days",
    ]

    file_exists = os.path.exists(LEAD_TIME_CSV)
    mode = "a" if (append and file_exists) else "w"
    with open(LEAD_TIME_CSV, mode, newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        if mode == "w" or not file_exists:
            w.writeheader()
        w.writerows(rows)

    pr(f"Saved {len(rows)} row(s) → {LEAD_TIME_CSV}")
    return LEAD_TIME_CSV


def load_member_numbers(csv_path, limit=None):
    numbers = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # ADJUST: change "member_number" if your member map CSV uses a
        # different column name (e.g. "memberNo", "MemberID").
        col = "member_number"
        if reader.fieldnames and col not in reader.fieldnames:
            for candidate in reader.fieldnames:
                if "member" in candidate.lower():
                    col = candidate
                    break
        for row in reader:
            val = row.get(col, "").strip()
            if val:
                numbers.append(val)
    if limit:
        numbers = numbers[:limit]
    return numbers


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Scrape reservation 'Created On' dates for booking lead time."
    )
    parser.add_argument("--member", help="Single member number to scrape")
    parser.add_argument("--members-csv", help="CSV file with a member_number column")
    parser.add_argument("--limit", type=int, help="Max number of members to process")
    args = parser.parse_args()

    if not args.member and not args.members_csv:
        parser.error("Provide --member or --members-csv")

    member_numbers = [args.member] if args.member else load_member_numbers(
        args.members_csv, limit=args.limit
    )

    print("=" * 60)
    print("Reservation Lead Time Scraper")
    print("=" * 60)
    print(f"Processing {len(member_numbers)} member(s).\n")

    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        try:
            login(page)

            all_rows = []
            for i, member_number in enumerate(member_numbers, 1):
                print(f"{'=' * 40}")
                print(f"Member {i} of {len(member_numbers)}: {member_number}")
                print(f"{'=' * 40}")
                try:
                    rows = process_member(page, member_number)
                    all_rows.extend(rows)
                    save_lead_time_rows(rows, append=(i > 1))
                    results[member_number] = len(rows)
                except Exception as e:
                    print(f"  Failed: {e}\n")
                    screenshot(page, f"member_{member_number}_error")
                    results[member_number] = False

            print("\n" + "=" * 60)
            print("Scrape Summary")
            print("=" * 60)
            for member_number, outcome in results.items():
                status = f"{outcome} reservation(s)" if outcome is not False else "Failed — check screenshot"
                print(f"  Member {member_number}: {status}")
            print(f"\nTotal reservations scraped: {len(all_rows)}")

        except Exception as e:
            print(f"\nError: {e}")
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
            screenshot_path = os.path.join(SCREENSHOT_FOLDER, f"error_screenshot_{timestamp}.png")
            page.screenshot(path=screenshot_path)
            print(f"Error screenshot saved: {screenshot_path}")

        finally:
            print("\nEnding session...")
            browser.close()
            sys.exit()


if __name__ == "__main__":
    main()