"""
scrape_rate_revenue.py
=======================
Scrapes the reservationRateDetail popup page for EVERY reservation in
folio_report.csv (Paid and Free alike), using Playwright (for auth
cookies) + requests (for fetching), and splits the results into
separate Paid / Free outputs based on each reservation's Payment Type.

Why scrape Paid reservations too: Payment Type is derived from booking
*channel* (business source), not from what was actually charged. A
Paid reservation can still carry a manual discount that has nothing to
do with the comp/homeowner channels — this is the only way to see that.

Outputs:
    rate_details_free.csv     — per-night detail, Free reservations
    rate_details_paid.csv     — per-night detail, Paid reservations
    free_revenue_summary.csv  — per-reservation rollup, Free
    paid_revenue_summary.csv  — per-reservation rollup, Paid

Each summary row has Total Original (Rack Rate), Total Charged, and
Discount Given = Total Original - Total Charged.

Usage:
    python scrape_rate_revenue.py
    python scrape_rate_revenue.py --limit 20
    python scrape_rate_revenue.py --reset
    python scrape_rate_revenue.py --summary-only   # rebuild both summaries
                                                    # from existing detail CSVs,
                                                    # no scraping / no login
"""

import csv
import re
import sys
import os
import argparse
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Installing requests...")
    os.system("pip install requests --break-system-packages -q")
    import requests

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing beautifulsoup4...")
    os.system("pip install beautifulsoup4 --break-system-packages -q")
    from bs4 import BeautifulSoup

from playwright.sync_api import sync_playwright

# ── CONFIG ────────────────────────────────────────────────────────────────────
from config import BASE_URL, HEADLESS

FOLIO_CSV            = Path(__file__).parent / "reports" / "folio_report.csv"
REPORTS_DIR          = Path(__file__).parent / "reports"
FREE_DETAIL_CSV      = REPORTS_DIR / "rate_details_free.csv"
PAID_DETAIL_CSV      = REPORTS_DIR / "rate_details_paid.csv"
FREE_SUMMARY_CSV     = REPORTS_DIR / "free_revenue_summary.csv"
PAID_SUMMARY_CSV     = REPORTS_DIR / "paid_revenue_summary.csv"
DONE_LOG             = REPORTS_DIR / "rate_details_done.txt"

# If folio_report.csv is in the same folder as this script, use:
# FOLIO_CSV = Path(__file__).parent / "folio_report.csv"
REQUEST_DELAY  = 2.0   # seconds between requests — gives page time to fully load

# room_lookup.csv — used to get room_type_id for Checked In reservations
ROOM_LOOKUP_CSV = Path(__file__).parent.parent / "playwright" / "room_lookup.csv"
# Also try same folder
if not ROOM_LOOKUP_CSV.exists():
    ROOM_LOOKUP_CSV = Path(__file__).parent / "room_lookup.csv"

# ── LOGIN (reuse from your login.py or paste credentials here) ───────────────
USERNAME = None   # set to string or leave None to import from login module
PASSWORD = None

def get_session_cookies(headless=HEADLESS):
    """
    Launch Playwright, log in, return cookies as a dict for requests.
    Tries to import your existing login.py; falls back to manual login.
    """
    print("Launching browser to get session cookies...")
    cookies = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        page    = browser.new_page()
        try:
            # Try importing your existing login module
            sys.path.insert(0, str(Path(__file__).parent))
            from login import login as do_login
            do_login(page)
            print("  Logged in via login.py")
        except Exception as e:
            print(f"  Could not use login.py ({e}), attempting manual login...")
            page.goto(f"{BASE_URL}/PMS/login.do", timeout=15000)
            page.wait_for_timeout(2000)
            if USERNAME and PASSWORD:
                for sel in ["#userName", "input[name='userName']", "input[type='text']"]:
                    el = page.query_selector(sel)
                    if el:
                        el.fill(USERNAME)
                        break
                for sel in ["#password", "input[name='password']", "input[type='password']"]:
                    el = page.query_selector(sel)
                    if el:
                        el.fill(PASSWORD)
                        break
                for sel in ["input[type='submit']", "button[type='submit']", "input[value='Login']"]:
                    el = page.query_selector(sel)
                    if el:
                        el.click()
                        break
                page.wait_for_timeout(3000)
            else:
                print("  No credentials — opening browser for manual login.")
                print("  Log in, then press Enter here to continue...")
                # Always visible: a human has to complete this login by hand.
                browser2 = pw.chromium.launch(headless=False)
                page2    = browser2.new_page()
                page2.goto(f"{BASE_URL}/PMS/login.do", timeout=15000)
                input("  Press Enter once logged in...")
                for c in page2.context.cookies():
                    cookies[c["name"]] = c["value"]
                browser2.close()
                browser.close()
                return cookies

        page.wait_for_timeout(2000)
        for c in page.context.cookies():
            cookies[c["name"]] = c["value"]
        browser.close()

    print(f"  Got {len(cookies)} cookie(s): {list(cookies.keys())}")
    return cookies


ROOM_TYPE_LOOKUP = {}  # populated in main() — room_number -> room_type_id


def load_room_lookup():
    """Return {room_number_upper: room_type_id} from room_lookup.csv."""
    lookup = {}
    candidates = [
        ROOM_LOOKUP_CSV,
        Path(__file__).parent / "reports" / "room_lookup.csv",  # same folder as folio_report.csv
        Path(__file__).parent / "room_lookup.csv",
        Path(__file__).parent.parent / "room_lookup.csv",
        Path(__file__).parent.parent / "playwright" / "room_lookup.csv",
    ]
    csv_path = next((c for c in candidates if c.exists()), None)
    if not csv_path:
        print("  WARNING: room_lookup.csv not found — Checked In reservations may fail")
        print("  Tried:")
        for c in candidates:
            print(f"    {c}")
        return lookup
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rnum = row.get("room_number", "").strip().upper()
            rtid = row.get("room_type_id", "").strip()
            if rnum and rtid:
                lookup[rnum] = rtid
    print(f"  Loaded {len(lookup)} room type entries from {csv_path}")
    return lookup


def get_room_type_id(room_str):
    """Extract room number from 'Villa Name - V52' and look up room_type_id."""
    if not room_str:
        return ""
    # Try to extract unit code like V52, V10, 308C etc
    cleaned = re.sub(r"\(.*?\)", "", room_str).strip()
    tokens = re.split(r"[\s\-]+", cleaned)
    for token in reversed(tokens):  # unit code usually at end
        token = token.strip().upper()
        if re.match(r"^[A-Z]{0,2}\d{1,4}[A-Z]?$", token):
            return ROOM_TYPE_LOOKUP.get(token, "")
    return ""


def parse_money(s):
    """'$1,234.56' -> 1234.56, '($500.00)' -> -500.0, '' -> 0.0"""
    if not s:
        return 0.0
    s = s.replace(",", "").replace("$", "").strip()
    if not s or s in ("-", "N/A"):
        return 0.0
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return -v if neg else v


def load_folio_report():
    """
    Load folio_report.csv — all reservations, Paid and Free alike.
    Payment Type / Villa Name / Bedroom Count / Source are read directly
    from the CSV — folio_scraper.py already resolved these from the live
    reservation page, no re-derivation here.
    """
    csv_path = FOLIO_CSV
    candidates = [
        FOLIO_CSV,
        Path(__file__).parent / "folio_report.csv",
        Path(__file__).parent / "reports" / "folio_report.csv",
    ]
    for c in candidates:
        if c.exists():
            csv_path = c
            break
    else:
        print(f"ERROR: folio_report.csv not found. Tried:")
        for c in candidates:
            print(f"  {c}")
        print("\nSet FOLIO_CSV at the top of this script to the correct path.")
        sys.exit(1)

    all_rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # Extract reservationId from _conf_href
            href = row.get("_conf_href", "")
            m    = re.search(r"reservationId=(\d+)", href)
            if not m:
                continue
            row["_reservation_id"] = m.group(1)

            # Member #/Guest Name — prefer columns already on the row
            # (folio_scraper.py / our enrichment add these), fall back to
            # splitting Member/Guest Name if they're missing.
            member_num = row.get("Member #", "").strip()
            guest_name = row.get("Guest Name", "").strip()
            if not member_num:
                raw   = row.get("Member/Guest Name", "") or row.get("_member_name", "")
                parts = raw.split(",", 1)
                member_num = parts[0].strip()
                guest_name = parts[1].strip() if len(parts) > 1 else guest_name
            row["_member_num"] = member_num
            row["_guest_name"] = guest_name

            all_rows.append(row)

    free_count = sum(1 for r in all_rows if r.get("Payment Type", "").strip().lower() == "free")
    paid_count = len(all_rows) - free_count
    print(f"Loaded {len(all_rows)} row(s) from {csv_path.name}")
    print(f"  Free: {free_count}   Paid/other: {paid_count}")
    return all_rows


def fetch_rate_page(session, reservation_id, folio_row=None):
    """
    Fetch the reservationRateDetail HTML for one reservation.
    Gets room_type_id (= RateId) from:
      - onclick URL on reservation page (best)
      - hidden fields on reservation page
      - room_lookup.csv via Room # (fallback for Checked In reservations)
    """
    res_url = f"{BASE_URL}/PMS/updateReservation.do?showBackButton=true&reservationId={reservation_id}"
    try:
        r = session.get(res_url, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"    Reservation page fetch error: {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")

    def hval(*names):
        """Get first non-empty value from hidden inputs by name or id."""
        for name in names:
            for el in soup.find_all("input", {"name": name}):
                v = el.get("value", "").strip()
                if v and v != "0":
                    return v
            for el in soup.find_all("input", {"id": name}):
                v = el.get("value", "").strip()
                if v and v != "0":
                    return v
        return ""

    # Always get these — they work for all reservation types
    member_id   = hval("memberId") or hval("savedMemberId")
    from_date   = hval("checkInDate", "fromDate") or (folio_row or {}).get("Check-In Date", "")
    to_date     = hval("checkOutDate", "toDate")  or (folio_row or {}).get("Check-Out Date", "")
    tax_exempt  = hval("isTaxExempt") or "false"
    member_type = hval("memberTypeString", "savedMemberType") or "1"
    is_perm     = hval("isPermanent") or "false"
    age_group   = hval("ageGroupPersonCount") or "1_1,2_0"

    # Get room_type_id — try page first, then room_lookup
    room_type_id = hval("roomTypeId", "roomTypeIdTemp", "parentWindowRoomTypeId")

    if not room_type_id and folio_row:
        room_str = folio_row.get("Room #", "")
        room_type_id = get_room_type_id(room_str)
        if room_type_id:
            print(f"    room_lookup: {room_str!r} -> room_type_id={room_type_id}")
        else:
            print(f"    Cannot resolve room_type_id for {room_str!r}")
            return None

    if not room_type_id:
        print(f"    No room_type_id found for reservation {reservation_id}")
        return None

    # Build the rate detail URL
    qs = (
        f"operation=fetchForPopUp"
        f"&RateId={room_type_id}&RoomTypeId={room_type_id}"
        f"&fromDate={from_date}&toDate={to_date}"
        f"&reservationId={reservation_id}&memberId={member_id}"
        f"&isTaxExempt={tax_exempt}&isWalkIn=false&showGroupRates=false"
        f"&memberType={member_type}&fromOtherModule=null"
        f"&isPermanent={is_perm}&rateType=Daily&isGuestCard=false"
        f"&ageGroupPersonCount={age_group}"
    )
    rate_url = f"{BASE_URL}/PMS/reservationRateDetail.do?{qs}"
    print(f"    room_type_id={room_type_id} member={member_id} from={from_date} to={to_date}")

    try:
        r2 = session.get(rate_url, timeout=15)
        r2.raise_for_status()
        return r2.text
    except Exception as e:
        print(f"    Rate detail fetch error: {e}")
        return None


def parse_rate_html(html, reservation_row):
    """
    Parse the reservationRateDetail HTML and return list of row dicts.
    No JS execution needed — all data is in the HTML as input values and td text.
    """
    soup   = BeautifulSoup(html, "html.parser")
    tbody  = soup.find("tbody", {"id": "rateTable"})
    if not tbody:
        return []

    # Total rental
    total_el = soup.find("td", {"id": "totalRental"})
    total_rental = total_el.get_text(strip=True) if total_el else ""

    rows = []
    for tr in tbody.find_all("tr"):
        date_input = tr.find("input", {"name": "resRateDate"})
        if not date_input:
            continue

        date = date_input.get("value", "").strip()

        # Rate name — from the text input's title attribute
        name_input = tr.find("input", id=re.compile(r"^resRateName_"))
        rate_name  = ""
        if name_input:
            rate_name = (name_input.get("title") or name_input.get("value") or "").strip()

        # Get all td cells (including hidden ones — they're still in the HTML)
        cells = tr.find_all("td")

        def cell_text(idx):
            if idx >= len(cells):
                return ""
            td  = cells[idx]
            inp = td.find("input", type="text")
            if inp:
                return (inp.get("value") or "").strip()
            return td.get_text(strip=True)

        # Cell indices (same as in live DOM):
        # 0=Date, 1=RateName, 2=CurrOcc%(hidden), 3=OriginalAmt,
        # 4=ModifiedAmt, 5=PackageAmt(hidden), 6=Qty(hidden),
        # 7=AddonAmt, 8=DiscountedAmt, 9=TotalAmt, 10=Status
        rows.append({
            "Conf. Code":        reservation_row.get("Conf. Code", ""),
            "Reservation ID":    reservation_row.get("_reservation_id", ""),
            "Member #":          reservation_row.get("_member_num", ""),
            "Guest Name":        reservation_row.get("_guest_name", ""),
            "Room #":            reservation_row.get("Room #", ""),
            "Villa Name":        reservation_row.get("Villa Name", ""),
            "Bedroom Count":     reservation_row.get("Bedroom Count", ""),
            "Source":            reservation_row.get("Source", ""),
            "Payment Type":      reservation_row.get("Payment Type", ""),
            "Check-In Date":     reservation_row.get("Check-In Date", ""),
            "Check-Out Date":    reservation_row.get("Check-Out Date", ""),
            "Reservation Status":reservation_row.get("Reservation Status", ""),
            "Date":              date,
            "Rate Name":         rate_name,
            "Original Amount":   cell_text(3),
            "Modified Amount":   cell_text(4),
            "Addon Amount":      cell_text(7),
            "Discounted Amount": cell_text(8),
            "Total Amount":      cell_text(9),
            "Status":            cell_text(10),
            "Total Rental":      total_rental,
        })

    return rows


def build_revenue_summary(detail_rows):
    """
    Collapse per-night detail rows into one row per reservation, summing
    Original Amount (rack rate) vs Total Amount (actually charged).
    Discount Given = Total Original - Total Charged. Works the same way
    whether detail_rows is the Free bucket or the Paid bucket.
    """
    by_conf = {}
    for r in detail_rows:
        by_conf.setdefault(r["Conf. Code"], []).append(r)

    summary = []
    for conf, rows in by_conf.items():
        first           = rows[0]
        total_original  = sum(parse_money(r["Original Amount"])   for r in rows)
        total_modified  = sum(parse_money(r["Modified Amount"])   for r in rows)
        total_addon     = sum(parse_money(r["Addon Amount"])      for r in rows)
        total_discounted= sum(parse_money(r["Discounted Amount"]) for r in rows)
        total_charged   = sum(parse_money(r["Total Amount"])      for r in rows)
        discount_given  = total_original - total_charged
        summary.append({
            "Conf. Code":                 conf,
            "Member #":                   first["Member #"],
            "Guest Name":                 first["Guest Name"],
            "Villa Name":                 first["Villa Name"],
            "Bedroom Count":              first["Bedroom Count"],
            "Check-In Date":              first["Check-In Date"],
            "Check-Out Date":             first["Check-Out Date"],
            "Nights Scraped":             len(rows),
            "Source":                     first["Source"],
            "Payment Type":               first["Payment Type"],
            "Total Original (Rack Rate)": round(total_original, 2),
            "Total Modified":             round(total_modified, 2),
            "Total Addon":                round(total_addon, 2),
            "Total Discounted":           round(total_discounted, 2),
            "Total Charged":              round(total_charged, 2),
            "Discount Given":             round(discount_given, 2),
        })
    summary.sort(key=lambda s: s["Discount Given"], reverse=True)
    return summary


def print_summary(summary, label):
    print(f"\n{'='*70}")
    print(f"DISCOUNT GIVEN — {label} Reservations")
    print(f"{'='*70}")
    grand_total = 0.0
    for s in summary:
        grand_total += s["Discount Given"]
        print(
            f"  {s['Conf. Code']:>6} | {s['Villa Name']:<22} | "
            f"{s['Check-In Date']} -> {s['Check-Out Date']} | "
            f"Rack=${s['Total Original (Rack Rate)']:>10,.2f} | "
            f"Charged=${s['Total Charged']:>9,.2f} | "
            f"Discount=${s['Discount Given']:>10,.2f}"
        )
    print(f"{'-'*70}")
    print(f"  TOTAL {label.upper()} DISCOUNT GIVEN: ${grand_total:,.2f}  ({len(summary)} reservation(s))")
    print(f"{'='*70}\n")
    return grand_total


def load_done():
    if not DONE_LOG.exists():
        return set()
    return set(DONE_LOG.read_text().splitlines())

def mark_done(res_id):
    with open(DONE_LOG, "a") as f:
        f.write(f"{res_id}\n")


def save_csv(all_rows, path, mode='w'):
    """Write rows to CSV. mode='a' to append, 'w' to overwrite."""
    if not all_rows:
        return
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = (mode == 'w' or not path.exists())
    headers = list(all_rows[0].keys())
    with open(path, mode, newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if write_header:
            writer.writeheader()
        writer.writerows(all_rows)
    print(f"  Saved {len(all_rows)} rows → {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--headed", action="store_true", help="Show browser window for login")
    parser.add_argument("--summary-only", action="store_true",
                         help="Rebuild free_revenue_summary.csv and paid_revenue_summary.csv "
                              "from the existing detail CSVs — no scraping, no login")
    args = parser.parse_args()

    if args.summary_only:
        if not FREE_DETAIL_CSV.exists() and not PAID_DETAIL_CSV.exists():
            print(f"ERROR: neither {FREE_DETAIL_CSV} nor {PAID_DETAIL_CSV} exist yet — run a scrape first.")
            sys.exit(1)
        grand_total = 0.0
        if FREE_DETAIL_CSV.exists():
            with open(FREE_DETAIL_CSV, newline="", encoding="utf-8") as f:
                free_existing = list(csv.DictReader(f))
            free_summary = build_revenue_summary(free_existing)
            save_csv(free_summary, FREE_SUMMARY_CSV)
            grand_total += print_summary(free_summary, "Free")
        if PAID_DETAIL_CSV.exists():
            with open(PAID_DETAIL_CSV, newline="", encoding="utf-8") as f:
                paid_existing = list(csv.DictReader(f))
            paid_summary = build_revenue_summary(paid_existing)
            save_csv(paid_summary, PAID_SUMMARY_CSV)
            grand_total += print_summary(paid_summary, "Paid")
        print(f"COMBINED DISCOUNT GIVEN (Free + Paid): ${grand_total:,.2f}\n")
        return

    if args.reset and DONE_LOG.exists():
        DONE_LOG.unlink()
        print("Done log cleared.")

    global ROOM_TYPE_LOOKUP
    ROOM_TYPE_LOOKUP = load_room_lookup()
    reservations = load_folio_report()
    if args.limit:
        reservations = reservations[:args.limit]

    done = load_done()
    # Deduplicate by reservation ID — folio_report has one row per folio,
    # so the same reservation can appear multiple times
    seen_ids = set()
    unique_reservations = []
    for r in reservations:
        rid = r["_reservation_id"]
        if rid not in seen_ids:
            seen_ids.add(rid)
            unique_reservations.append(r)
    print(f"  Unique reservations: {len(unique_reservations)} (from {len(reservations)} folio rows)")
    todo = [r for r in unique_reservations if r["_reservation_id"] not in done]
    print(f"  To scrape: {len(todo)}  Already done: {len(done)}")

    # Load existing rows if we're resuming — needed for the final summary
    # even if there's nothing new to scrape. Free and Paid are tracked as
    # two separate lists throughout.
    free_rows, paid_rows = [], []
    if done:
        if FREE_DETAIL_CSV.exists():
            try:
                with open(FREE_DETAIL_CSV, newline='', encoding='utf-8') as f:
                    free_rows = list(csv.DictReader(f))
                print(f"  Resuming — loaded {len(free_rows)} existing Free rows")
            except Exception as e:
                print(f"  Could not load existing Free CSV ({e}), starting fresh.")
        if PAID_DETAIL_CSV.exists():
            try:
                with open(PAID_DETAIL_CSV, newline='', encoding='utf-8') as f:
                    paid_rows = list(csv.DictReader(f))
                print(f"  Resuming — loaded {len(paid_rows)} existing Paid rows")
            except Exception as e:
                print(f"  Could not load existing Paid CSV ({e}), starting fresh.")

    if not todo:
        print("Nothing new to scrape.")
        grand_total = 0.0
        if free_rows:
            free_summary = build_revenue_summary(free_rows)
            save_csv(free_summary, FREE_SUMMARY_CSV)
            grand_total += print_summary(free_summary, "Free")
        if paid_rows:
            paid_summary = build_revenue_summary(paid_rows)
            save_csv(paid_summary, PAID_SUMMARY_CSV)
            grand_total += print_summary(paid_summary, "Paid")
        if free_rows or paid_rows:
            print(f"COMBINED DISCOUNT GIVEN (Free + Paid): ${grand_total:,.2f}\n")
        return

    # Get session cookies via Playwright login
    cookies = get_session_cookies(headless=HEADLESS and not args.headed)
    if not cookies:
        print("ERROR: Could not get session cookies.")
        sys.exit(1)

    # Build requests session
    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Referer":    BASE_URL,
    })

    # Scrape
    success = 0
    failed  = []
    for i, res in enumerate(todo, 1):
        res_id       = res["_reservation_id"]
        conf         = res.get("Conf. Code", res_id)
        member       = res.get("_member_num", "")
        payment_type = res.get("Payment Type", "").strip().lower()
        print(f"  [{i}/{len(todo)}] conf={conf} res_id={res_id} member={member} payment_type={payment_type or '?'}")

        html = fetch_rate_page(session, res_id, folio_row=res)
        if not html:
            print(f"    FAILED — no HTML")
            failed.append(conf)
            time.sleep(REQUEST_DELAY)
            continue

        parsed = parse_rate_html(html, res)
        if not parsed:
            # Could be a non-villa reservation with no rate rows — still mark done
            print(f"    No rate rows (non-villa or no rate set)")
        else:
            print(f"    {len(parsed)} day row(s), rate={parsed[0]['Rate Name'][:40]}")
            if payment_type == "free":
                free_rows.extend(parsed)
            else:
                paid_rows.extend(parsed)

        mark_done(res_id)
        success += 1
        time.sleep(REQUEST_DELAY)

        # Save incrementally every 20 reservations
        if i % 20 == 0:
            if free_rows:
                save_csv(free_rows, FREE_DETAIL_CSV)
            if paid_rows:
                save_csv(paid_rows, PAID_DETAIL_CSV)
            print(f"  [checkpoint] {len(free_rows)} Free rows, {len(paid_rows)} Paid rows saved so far")

    # Final save
    if free_rows:
        save_csv(free_rows, FREE_DETAIL_CSV)
    if paid_rows:
        save_csv(paid_rows, PAID_DETAIL_CSV)

    print(f"\n{'='*50}")
    print(f"Done.  Success={success}  Failed={len(failed)}")
    if failed:
        print(f"Failed conf codes: {failed}")
    print(f"Free output: {FREE_DETAIL_CSV}")
    print(f"Paid output: {PAID_DETAIL_CSV}")

    # ── Revenue summaries ───────────────────────────────────────────────────
    grand_total = 0.0
    if free_rows:
        free_summary = build_revenue_summary(free_rows)
        save_csv(free_summary, FREE_SUMMARY_CSV)
        grand_total += print_summary(free_summary, "Free")
    if paid_rows:
        paid_summary = build_revenue_summary(paid_rows)
        save_csv(paid_summary, PAID_SUMMARY_CSV)
        grand_total += print_summary(paid_summary, "Paid")
    if not free_rows and not paid_rows:
        print("\nNo rate rows scraped — nothing to summarize.")
    else:
        print(f"COMBINED DISCOUNT GIVEN (Free + Paid): ${grand_total:,.2f}\n")


if __name__ == "__main__":
    main()