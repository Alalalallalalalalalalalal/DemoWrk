"""
reservation_lead_time_scraper.py — Booking Lead Time scraper.

Portal flow this automates:
  Accounts Receivable tab -> switch to Membership
  -> search member -> click the member number
  -> click the member-name tab (Member_Info) -> Rooms
  -> click each reservation's Confirmation Code (opens the reservation
     popup — the same DialogWindowFrame_0 dialog journal_scraper.py
     already drives for contact info / rate details)
  -> inside that popup, click "Created On" (javascript:viewAuditLog())
     to open the nested Audit Log dialog
  -> scrape the "Created On" timestamp from the audit log
  -> Lead Time (days) = Check-In Date (arrival) - Created On (booked)

Reuses login/frame/popup/retry plumbing from journal_scraper.py instead
of duplicating it — only the audit-log step and the lead-time math are
new here.

Output: one CSV per member, journal/{folder}/{folder}_lead_time.csv,
in the same shape save_tab_csv() writes for every other tab. Run
lead_time_report.py afterwards to get full/trend/average views across
all members, filterable by year or a custom date range.

NOTE ON SELECTORS: the exact field name the Audit Log dialog uses for
"Created On" wasn't available to write this against, so
scrape_created_on() tries a couple of common input patterns and then
falls back to scanning the dialog's own table rows for a label match
("Created On", "Create Date", "Booked On", ...). If neither finds
anything, it dumps every table row in the dialog to stdout so the
correct label/selector can be read off that dump and slotted into
CREATED_ON_LABELS / the input selector list below.

Usage:
    python reservation_lead_time_scraper.py --all
    python reservation_lead_time_scraper.py --member 17A
    python reservation_lead_time_scraper.py --members 67,67A,23B
    python reservation_lead_time_scraper.py --limit 50 --workers 5
    python reservation_lead_time_scraper.py --reset      # clear done log
"""
import os
import re
import csv
import time
import math
import argparse
import signal
import sys
from datetime import datetime
from multiprocessing import Pool

from playwright.sync_api import sync_playwright

from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url

from journal_scraper import (
    MAP_FILE, JOURNAL_FOLDER,
    FRAME_TIMEOUT, POPUP_TIMEOUT, TAB_MAX_RETRIES, TAB_HREF_FALLBACKS,
    LIST_MEMBERS_URL,
    load_member_map, get_folder_name, save_tab_csv, strip_val,
    parse_statement_date, extract_table,
    dismiss_popup, ensure_session, navigate_to_member, take_screenshot,
    get_landing_frame, get_shell_frame, open_member_dropdown, click_section,
    click_subtab, get_popup_frame, close_reservation_popup,
    reservation_dialog_open, get_input_val,
)

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
DONE_LOG = os.path.join(OUTPUT_FOLDER, "lead_time_done.txt")
DEFAULT_LIMIT = None
DEFAULT_WORKERS = 5

# Labels the Audit Log dialog might use for the booking-created field.
# Checked lowercase, substring match, in this order.
CREATED_ON_LABELS = (
    "created on", "create date", "creation date",
    "booked on", "booking date", "date created",
)


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
# AUDIT LOG DIALOG
# ─────────────────────────────────────────────
def _dump_dialog_rows(frame, conf_code, prefix=""):
    print(f"    {prefix}[DEBUG] Audit log row dump for conf {conf_code}:")
    try:
        rows = frame.evaluate("""
            () => Array.from(document.querySelectorAll('tr')).map(tr =>
                Array.from(tr.querySelectorAll('td,th')).map(c => (c.innerText || '').trim())
            ).filter(r => r.length)
        """)
        for r in rows:
            print(f"      {r}")
    except Exception as e:
        print(f"    {prefix}[DEBUG] dump failed: {e}")


def click_created_on_audit_log(popup_frame, page, prefix=""):
    """
    Click the "Created On" link inside the open reservation popup
    (fires javascript:viewAuditLog()), which opens a nested Audit Log
    dialog. Returns the frame for that dialog, or None.
    """
    link = None
    try:
        for a in popup_frame.query_selector_all("a"):
            try:
                blob = (a.get_attribute("onclick") or "") + (a.get_attribute("href") or "")
                if "viewAuditLog" in blob:
                    link = a
                    break
            except Exception:
                continue
    except Exception:
        pass

    if not link:
        print(f"    {prefix}Audit log link (viewAuditLog) not found in popup")
        return None

    try:
        link.click()
    except Exception as e:
        print(f"    {prefix}Audit log click failed: {e}")
        return None

    # Nested dialog — same jQuery dialog mechanism as the reservation
    # popup itself, one level deeper. Wait for a NEW dialog frame that
    # isn't the reservation popup, with content in it.
    deadline = time.time() + 6
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame == popup_frame:
                    continue
                if frame.name and "DialogWindowFrame" in frame.name:
                    if frame.query_selector("table, div, span, input"):
                        return frame
            except Exception:
                continue
        page.wait_for_timeout(300)

    print(f"    {prefix}Audit log dialog frame not found")
    return None

def scrape_created_on(audit_frame, conf_code, prefix=""):
    """
    Find the Created Reservation row in the Audit Log
    and return ONLY its Date value.
    """

    try:
        result = audit_frame.evaluate("""
            () => {
                const rows = Array.from(document.querySelectorAll('tr'));

                for (const row of rows) {

                    // IMPORTANT:
                    // Only get cells that are DIRECT children of this row.
                    // This prevents nested audit tables from being included.
                    const cells = Array.from(row.children)
                        .filter(el =>
                            el.tagName === 'TD' ||
                            el.tagName === 'TH'
                        )
                        .map(el =>
                            (el.innerText || '')
                                .replace(/\\u00a0/g, ' ')
                                .replace(/Â/g, '')
                                .trim()
                        );

                    if (cells.length < 3) {
                        continue;
                    }

                    const activity = cells[0]
                        .replace(/^\\+/, '')
                        .trim()
                        .toLowerCase();

                    if (activity === 'created reservation') {
                        return {
                            activity: cells[0],
                            changedBy: cells[1],
                            date: cells[2]
                        };
                    }
                }

                return null;
            }
        """)

    except Exception as e:
        print(f"    {prefix}Could not read audit log: {e}")
        return ""

    if result:
        created_date = result.get("date", "").strip()
        changed_by = result.get("changedBy", "").strip()

        print(
            f"    {prefix}SCRAPED | "
            f"Created Reservation | "
            f"Changed By: {changed_by} | "
            f"Created On: {created_date}"
        )

        return created_date

    print(
        f"    {prefix}Created Reservation row not found "
        f"for conf {conf_code}"
    )

    _dump_dialog_rows(audit_frame, conf_code, prefix)

    return ""

def close_top_dialog(page, prefix=""):
    """
    Close whichever dialog is currently on top (the nested Audit Log
    dialog). Same strategy ladder as journal_scraper.close_reservation_popup,
    generalized to any DialogWindowFrame rather than just _0.
    """
    def top_dialog_open():
        for frame in page.frames:
            try:
                if frame.name and "DialogWindowFrame" in frame.name:
                    _ = frame.url
                    return True
            except Exception:
                continue
        return False

    def wait_gone(timeout_ms=2000):
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            if not top_dialog_open():
                return True
            page.wait_for_timeout(200)
        return not top_dialog_open()

    if not top_dialog_open():
        return True

    for frame in page.frames:
        try:
            for sel in ("[id^='closeButtonId_']",
                        "button[onclick='closeJQueryDialog()']",
                        ".ui-dialog-titlebar-close"):
                for btn in frame.query_selector_all(sel):
                    try:
                        if not btn.is_visible():
                            continue
                        btn.click(timeout=2000)
                        if wait_gone():
                            return True
                    except Exception:
                        continue
        except Exception:
            continue

    for frame in page.frames:
        try:
            frame.evaluate(
                "() => { if (typeof closeJQueryDialog === 'function') closeJQueryDialog(); }"
            )
            if wait_gone(1500):
                return True
        except Exception:
            continue

    try:
        page.keyboard.press("Escape")
        if wait_gone(1500):
            return True
    except Exception:
        pass

    print(f"    {prefix}WARNING: audit log dialog would not close")
    return False


# ─────────────────────────────────────────────
# LEAD TIME MATH
# ─────────────────────────────────────────────
def compute_lead_time_days(created_on_raw, check_in_raw):
    if not created_on_raw or not check_in_raw:
        return None

    created = None
    check_in = None

    # Audit Log format:
    # 08/12/2026 13:51:09
    for fmt in (
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y",
    ):
        try:
            created = datetime.strptime(created_on_raw.strip(), fmt)
            break
        except ValueError:
            continue

    # Check-in is usually date only
    for fmt in (
        "%m/%d/%Y",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M:%S %p",
    ):
        try:
            check_in = datetime.strptime(check_in_raw.strip(), fmt)
            break
        except ValueError:
            continue

    if created is None or check_in is None:
        print(
            f"    DATE PARSE FAILED | "
            f"Created='{created_on_raw}' | "
            f"Check-In='{check_in_raw}'"
        )
        return None

    return (check_in.date() - created.date()).days


# ─────────────────────────────────────────────
# ROOMS TAB — capture created-on + lead time per reservation
# ─────────────────────────────────────────────
def scrape_rooms_lead_time(page, folder_name, prefix=""):
    """
    Same rooms-table + confirmation-code-popup pattern as
    journal_scraper.scrape_rooms_with_popups(), but instead of pulling
    contact info, opens the Audit Log for each reservation and records
    Created On + computed Lead Time.

    Returns (success, lead_time_rows).
    """
    frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
    if not frame:
        print(f"    {prefix}Rooms page failed: landing frame not found")
        return False, []

    lead_rows = []

    try:
        tables = frame.query_selector_all("table")
        if not tables:
            print(f"    {prefix}No tables found in rooms tab")
            return True, []

        room_rows = []
        for table in tables:
            for row in extract_table(table):
                room_rows.append(row)

        if not room_rows:
            print(f"    {prefix}Rooms table is empty")
            return True, []

        print(f"    {prefix}Found {len(room_rows)} room row(s) — opening popups for audit log...")

        for i, room_row in enumerate(room_rows, 1):
            conf_code = (
                room_row.get("Confirmation Code") or
                room_row.get("Conf. Code") or
                room_row.get("col_0") or
                ""
            ).strip()

            if not conf_code:
                print(f"    {prefix}Row {i}: no conf code — skipping")
                continue

            print(f"    {prefix}Row {i}/{len(room_rows)}: conf {conf_code}")

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Rooms page failed: lost landing frame at row {i}")
                return False, lead_rows

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
            except Exception as e:
                print(f"    {prefix}Click error for conf {conf_code}: {e}")

            if not clicked:
                print(f"    {prefix}Could not click conf code {conf_code} — skipping")
                continue

            popup_frame = get_popup_frame(page, timeout_ms=POPUP_TIMEOUT)
            created_on = ""
            if popup_frame:
                max_created_retries = 3

                for attempt in range(1, max_created_retries + 1):

                    audit_frame = click_created_on_audit_log(
                        popup_frame,
                        page,
                        prefix
                    )

                    if audit_frame:

                        # Give the audit log table time to fully populate
                        page.wait_for_timeout(800)

                        created_on = scrape_created_on(
                            audit_frame,
                            conf_code,
                            prefix
                        )

                        close_top_dialog(page, prefix)
                        page.wait_for_timeout(500)

                    if created_on:
                        print(
                            f"    {prefix}Created On found "
                            f"for conf {conf_code}: {created_on}"
                        )
                        break

                    print(
                        f"    {prefix}Created On blank for conf {conf_code} "
                        f"— retry {attempt}/{max_created_retries}"
                    )

                    # Small pause before trying again
                    page.wait_for_timeout(1000)

                if not created_on:
                    print(
                        f"    {prefix}WARNING: Created On still blank "
                        f"for conf {conf_code} after "
                        f"{max_created_retries} attempts"
                    )
            else:
                print(f"    {prefix}Popup frame not found for conf {conf_code}")

            check_in = strip_val(
                room_row.get("Check-In Date") or
                room_row.get("Check In Date") or
                room_row.get("Check-In") or
                ""
            )

            check_out = strip_val(
                room_row.get("Check-Out Date") or
                room_row.get("Check Out Date") or
                room_row.get("Check-Out") or
                ""
            )

            # Reservation status comes directly from the Rooms table
            reservation_status = strip_val(
                room_row.get("status") or
                room_row.get("Status") or
                room_row.get("Reservation Status") or
                ""
            )

            lead_days = compute_lead_time_days(created_on, check_in)

            print(
                f"    {prefix}LEAD TIME RESULT | "
                f"Conf: {conf_code} | "
                f"Status: {reservation_status} | "
                f"Created: {created_on} | "
                f"Check-In: {check_in} | "
                f"Check-Out: {check_out} | "
                f"Lead Time: {lead_days if lead_days is not None else 'COULD NOT CALCULATE'} days"
            )

            lead_rows.append({
                "Member #":           folder_name,
                "Conf. Code":         conf_code,
                "Reservation ID":     reservation_id,
                "Guest Name":         strip_val(room_row.get("Guest Name", "")),
                "Room #":             strip_val(room_row.get("Room #", "") or room_row.get("Room Number", "")),
                "Check-In Date":      check_in,
                "Check-Out Date":     check_out,
                "Created On":         created_on,
                "Lead Time (days)":   lead_days if lead_days is not None else "",
                "Reservation Status": reservation_status,
            })

            close_reservation_popup(page, prefix)
            page.wait_for_timeout(600)

            frame = get_landing_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not frame:
                print(f"    {prefix}Rooms page failed: landing frame lost after closing popup")
                return False, lead_rows

    except Exception as e:
        print(f"    {prefix}Rooms lead-time scrape error: {e}")
        return False, lead_rows

    return True, lead_rows


# ─────────────────────────────────────────────
# PER-MEMBER SCRAPE
# ─────────────────────────────────────────────
def scrape_member_lead_time(page, member_number, member_id, prefix=""):
    folder_name = get_folder_name(member_number, member_id)
    saved = {}

    dismiss_popup(page)
    if not navigate_to_member(page, member_id, prefix):
        print(f"  {prefix}Navigation failed for {member_number}")
        return False, saved

    tab_done = False
    for attempt in range(1, TAB_MAX_RETRIES + 1):
        note = f" (attempt {attempt}/{TAB_MAX_RETRIES})" if attempt > 1 else ""
        print(f"    {prefix}Rooms (lead time){note}")

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
            take_screenshot(page, f"no_tab_{folder_name}_leadtime")
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
            continue

        success, lead_rows = scrape_rooms_lead_time(page, folder_name, prefix)
        if not success:
            print(f"    {prefix}Rooms (lead time) scraping failed")
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(1000 * attempt)
                continue
            return False, saved

        if lead_rows:
            fp = save_tab_csv(folder_name, "lead_time", lead_rows)
            if fp:
                saved["lead_time"] = fp
                print(f"    {prefix}Lead time: {len(lead_rows)} row(s) -> {os.path.basename(fp)}")
        else:
            print(f"    {prefix}Lead time: no data — processed successfully")

        tab_done = True
        break

    if not tab_done:
        print(f"    {prefix}Rooms (lead time): exhausted retries")
        return False, saved

    return True, saved


# ─────────────────────────────────────────────
# WORKER
# ─────────────────────────────────────────────
def _worker_init():
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def scrape_chunk(args):
    members_chunk, worker_id, force = args
    time.sleep(worker_id * 3)
    prefix = f"[W{worker_id}] "
    results = {"success": [], "failed": [], "skipped": []}
    done_set = load_done_set()

    with sync_playwright() as p:
        headless = os.environ.get("HEADFUL", "").lower() not in ("1", "true", "yes")
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
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

                success, saved = scrape_member_lead_time(page, member_number, member_id, prefix)
                if not success:
                    if ensure_session(page, worker_id):
                        print(f"  {prefix}Retrying {member_number} after re-login...")
                        success, saved = scrape_member_lead_time(page, member_number, member_id, prefix)

                if success:
                    mark_done(member_id)
                    done_set.add(member_id)
                    if saved:
                        print(f"  {prefix}OK {member_number}: {len(saved)} file(s) saved")
                    else:
                        print(f"  {prefix}OK {member_number}: processed — no records")
                    results["success"].append(folder_name)
                else:
                    print(f"  {prefix}FAILED {member_number}: rooms/lead-time tab did not load")
                    results["failed"].append(folder_name)

        except Exception as e:
            print(f"  {prefix}Fatal error: {e}")
            take_screenshot(page, f"worker_{worker_id}_fatal_leadtime")
        finally:
            browser.close()

    return results


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Scrape booking lead time (Created On vs Check-In).")
    parser.add_argument("--all", action="store_true", help="Scrape all members")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max members (default: all)")
    parser.add_argument("--member", type=str, default=None, help="Single member by number e.g. 1C")
    parser.add_argument("--id", type=str, default=None, help="Single member by portal ID")
    parser.add_argument("--members", type=str, default=None, help="Comma-separated member numbers")
    parser.add_argument("--force", action="store_true", help="Ignore lead_time_done.txt for selected members")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"Parallel workers (default: {DEFAULT_WORKERS})")
    parser.add_argument("--reset", action="store_true", help="Clear done log and rescrape everything")
    args = parser.parse_args()

    if not os.path.exists(MAP_FILE):
        print(f"ERROR: {MAP_FILE} not found. Run build_member_map.py first.")
        return

    if args.reset and os.path.exists(DONE_LOG):
        os.remove(DONE_LOG)
        print("Done log cleared.")

    all_members = load_member_map(MAP_FILE)
    print(f"Loaded {len(all_members)} members from map.")

    force = args.force or bool(args.member or args.id or args.members)

    if args.members:
        wanted = {m.strip() for m in args.members.split(",") if m.strip()}
        members = [(n, i) for n, i in all_members if n in wanted]
    elif args.member:
        members = [(n, i) for n, i in all_members if n == args.member]
    elif args.id:
        members = [(n, i) for n, i in all_members if i == args.id]
    elif args.all:
        members = all_members
    else:
        members = all_members[:args.limit] if args.limit else all_members

    if not members:
        print("No matching members found.")
        return

    print("=" * 60)
    print("Booking Lead Time Scraper")
    print("=" * 60)
    print(f"Members to process : {len(members)}")
    print(f"Output             : {JOURNAL_FOLDER}/<member>/<member>_lead_time.csv")

    if len(members) == 1 or args.workers == 1:
        all_results = [scrape_chunk((members, 1, force))]
    else:
        num_workers = min(args.workers, len(members))
        chunk_size = math.ceil(len(members) / num_workers)
        chunks = [
            (members[i:i + chunk_size], wid, force)
            for wid, i in enumerate(range(0, len(members), chunk_size), 1)
        ]
        pool = Pool(processes=num_workers, initializer=_worker_init)
        try:
            all_results = pool.map(scrape_chunk, chunks)
        except KeyboardInterrupt:
            print("\nInterrupted — shutting down...")
            pool.terminate()
            pool.join()
            sys.exit(0)
        else:
            pool.close()
            pool.join()

    success = sum(len(r["success"]) for r in all_results)
    failed = sum(len(r["failed"]) for r in all_results)
    skipped = sum(len(r["skipped"]) for r in all_results)
    failed_names = [n for r in all_results for n in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Success : {success}")
    print(f"  Failed  : {failed}")
    print(f"  Skipped : {skipped}")
    if failed_names:
        print(f"  Failed members: {failed_names}")


if __name__ == "__main__":
    main()