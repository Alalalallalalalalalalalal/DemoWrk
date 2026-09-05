"""
rates_backfill.py — Rooms + rate details for every account. Nothing else.

Standalone. Imports from journal_scraper.py and does NOT modify it.
Skips Services and Statements, so the statements work already completed
is left completely alone.

Calls journal_scraper.scrape_rooms_with_popups() directly — the exact
code path that just pulled 35/35 reservations and 330 night rows for
17A. No reimplementation, so any future fix to that function applies
here automatically.

Guests are INCLUDED. Services and Statements are Members-only, but
guests hold reservations, and 37,905 of the 38,559 accounts are guests.

Own done log (rates_done.txt), so journal_done.txt is never touched and
--resume works across a multi-hour run without disturbing anything.

    python rates_backfill.py --all --workers 10
    python rates_backfill.py --all --resume --workers 10     # after a stop
    python rates_backfill.py --members 17A,4B                # spot check

Output (same shape journal_scraper writes, so cleaner.py reads it as-is):
    journal/{member}/{member}_rooms.csv
    journal/{member}/{member}_rate_details.csv

Then:
    python cleaner.py --rooms-only
    python cleaner.py --rate-details-only
    python overview_sql.py      # REQUIRED - fills payment_type/bedroom_count
"""
import os
import sys
import time
import math
import signal
import argparse
from datetime import datetime
from multiprocessing import Pool

from playwright.sync_api import sync_playwright

from config import OUTPUT_FOLDER
from login import login, get_frame_by_url

import journal_scraper as js
from journal_scraper import (
    MAP_FILE,
    JOURNAL_FOLDER,
    LIST_MEMBERS_URL,
    FRAME_TIMEOUT,
    TAB_MAX_RETRIES,
    TAB_HREF_FALLBACKS,
    RATE_DETAIL_MIN_DATE,
    load_member_map,
    get_folder_name,
    save_tab_csv,
    take_screenshot,
    dismiss_popup,
    ensure_session,
    navigate_to_member,
    get_landing_frame,
    get_shell_frame,
    open_member_dropdown,
    click_section,
    click_subtab,
    scrape_rooms_with_popups,
)

DONE_LOG = os.path.join(OUTPUT_FOLDER, "rates_done.txt")
FAIL_LOG = os.path.join(OUTPUT_FOLDER, "rates_incomplete.txt")


def load_done_set():
    if not os.path.exists(DONE_LOG):
        return set()
    with open(DONE_LOG, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())


def mark_done(member_id):
    with open(DONE_LOG, "a", encoding="utf-8") as f:
        f.write(f"{member_id}\n")


def log_fail(member_number, member_id, reason):
    try:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(FAIL_LOG, "a", encoding="utf-8") as f:
            f.write(f"{stamp}\t{member_number}\t{member_id}\t{reason}\n")
    except Exception:
        pass


def scrape_rooms_and_rates(page, member_number, member_id, prefix=""):
    """Returns (success, n_rooms, n_rates)."""
    folder_name = get_folder_name(member_number, member_id)

    dismiss_popup(page)
    if not navigate_to_member(page, member_id, prefix):
        return False, 0, 0

    for attempt in range(1, TAB_MAX_RETRIES + 1):
        shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
        if not shell:
            if not navigate_to_member(page, member_id, prefix):
                return False, 0, 0
            shell = get_shell_frame(page, timeout_ms=FRAME_TIMEOUT)
            if not shell:
                return False, 0, 0

        open_member_dropdown(shell, page)
        click_section(shell, page, "Member_Info")
        if not click_subtab(shell, page, "rooms",
                            TAB_HREF_FALLBACKS["rooms"], prefix):
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(800 * attempt)
                continue
            take_screenshot(page, f"rates_no_tab_{folder_name}")
            return False, 0, 0

        # lead_time_rows is discarded here — this script deliberately stays
        # narrow (rooms + rate details only, see module docstring); lead
        # time is now collected by journal_scraper.py's own normal run.
        ok, room_rows, merged_contact, rate_rows, _lead_time_rows = \
            scrape_rooms_with_popups(page, folder_name, prefix)

        if not ok:
            if attempt < TAB_MAX_RETRIES:
                page.wait_for_timeout(800 * attempt)
                continue
            return False, 0, 0

        if not room_rows:
            # No reservations. True of most accounts — a success, and
            # no CSV is written.
            return True, 0, 0

        fp = save_tab_csv(folder_name, "rooms", room_rows)
        if fp:
            print(f"    {prefix}Rooms: {len(room_rows)} row(s) -> "
                  f"{os.path.basename(fp)}")

        # merged_contact is deliberately unused. enrich_profile_csv()
        # would rewrite profile CSVs across 44k accounts, and this run
        # is meant to add rooms/rate_details only. The full scraper
        # still does the enrichment on its own passes.

        if rate_rows:
            fp = save_tab_csv(folder_name, "rate_details", rate_rows)
            if fp:
                print(f"    {prefix}Rate details: {len(rate_rows)} night "
                      f"row(s) -> {os.path.basename(fp)}")
        else:
            # Reservations but no rates. Legitimate when every stay is
            # older than RATE_DETAIL_MIN_DATE, or for non-villa
            # bookings — but also what a stuck dialog looks like, so it
            # is logged rather than passed over in silence.
            print(f"    {prefix}Rate details: NONE from {len(room_rows)} "
                  f"reservation(s)")
            log_fail(member_number, member_id,
                     f"{len(room_rows)} rooms, 0 rate rows")

        return True, len(room_rows), len(rate_rows)

    return False, 0, 0


def _worker_init():
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def scrape_chunk(args):
    members_chunk, worker_id, force = args
    time.sleep(worker_id * 3)
    prefix = f"[W{worker_id}] "
    results = {"ok": 0, "failed": [], "skipped": 0, "rooms": 0, "rates": 0}
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
            print(f"  {prefix}Ready — {len(members_chunk)} members")

            for i, (member_number, member_id) in enumerate(members_chunk, 1):
                if member_id in done_set and not force:
                    results["skipped"] += 1
                    continue

                if i % 50 == 0 or i == 1:
                    print(f"  {prefix}[{i}/{len(members_chunk)}] {member_number}")

                ensure_session(page, worker_id)

                try:
                    ok, n_rooms, n_rates = scrape_rooms_and_rates(
                        page, member_number, member_id, prefix)
                except Exception as e:
                    print(f"    {prefix}{member_number} error: {e}")
                    ok, n_rooms, n_rates = False, 0, 0

                if not ok and ensure_session(page, worker_id):
                    try:
                        ok, n_rooms, n_rates = scrape_rooms_and_rates(
                            page, member_number, member_id, prefix)
                    except Exception:
                        pass

                results["rooms"] += n_rooms
                results["rates"] += n_rates

                if ok:
                    mark_done(member_id)
                    done_set.add(member_id)
                    results["ok"] += 1
                else:
                    results["failed"].append(member_number)
                    log_fail(member_number, member_id, "tab/page failed")

        except Exception as e:
            print(f"  {prefix}Fatal: {e}")
            take_screenshot(page, f"rates_worker_{worker_id}_fatal")
        finally:
            try:
                browser.close()
            except Exception:
                pass

    return results


def main():
    ap = argparse.ArgumentParser(
        description="Backfill Rooms + rate details for every account.")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--member", type=str)
    ap.add_argument("--members", type=str, help="Comma-separated e.g. 17A,4B")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--resume", action="store_true",
                    help="Skip accounts already in rates_done.txt")
    ap.add_argument("--reset", action="store_true",
                    help="Clear rates_done.txt (does NOT touch journal_done.txt)")
    args = ap.parse_args()

    if args.reset and os.path.exists(DONE_LOG):
        os.remove(DONE_LOG)
        print("rates_done.txt cleared.")

    if not os.path.exists(MAP_FILE):
        print(f"ERROR: {MAP_FILE} not found. Run build_member_map.py first.")
        return

    all_members = load_member_map(MAP_FILE)
    print(f"Loaded {len(all_members)} members from map.")

    if args.members:
        wanted = {m.strip() for m in args.members.split(",") if m.strip()}
        members = [(n, i) for n, i in all_members if n in wanted]
        missing = wanted - {n for n, _ in members}
        if missing:
            print(f"WARNING: not in member map: {sorted(missing)}")
    elif args.member:
        members = [(n, i) for n, i in all_members if n == args.member]
    elif args.all:
        members = all_members
    else:
        members = all_members[:args.limit] if args.limit else all_members

    if not members:
        print("No members selected.")
        return

    force = bool(args.member or args.members)

    if args.resume:
        done = load_done_set()
        before = len(members)
        members = [(n, i) for n, i in members if i not in done]
        print(f"Resuming — {before - len(members)} done, {len(members)} left.")
        force = False

    print("=" * 60)
    print("Rates Backfill (rooms + rate details only)")
    print("=" * 60)
    print(f"Accounts to process : {len(members)}")
    print(f"RATE_DETAIL_MIN_DATE: {RATE_DETAIL_MIN_DATE}  "
          f"{'(no floor - full history)' if RATE_DETAIL_MIN_DATE is None else '(FLOOR SET!)'}")
    print(f"Output              : {JOURNAL_FOLDER}")
    print(f"Done log            : {DONE_LOG}")
    print()

    if RATE_DETAIL_MIN_DATE is not None:
        print("!! RATE_DETAIL_MIN_DATE is not None — stays ending before it")
        print("!! will be skipped. Set it to None in journal_scraper.py for")
        print("!! a full-history backfill. Continuing in 5s, Ctrl+C to stop.")
        time.sleep(5)

    started = time.time()

    if len(members) == 1 or args.workers == 1:
        all_results = [scrape_chunk((members, 1, force))]
    else:
        num_workers = min(args.workers, len(members))
        chunk_size = math.ceil(len(members) / num_workers)
        chunks = [
            (members[i: i + chunk_size], wid, force)
            for wid, i in enumerate(range(0, len(members), chunk_size), 1)
        ]
        print(f"Workers             : {num_workers}")
        print(f"Per worker          : ~{chunk_size}\n")
        pool = Pool(processes=num_workers, initializer=_worker_init)
        try:
            all_results = pool.map(scrape_chunk, chunks)
        except KeyboardInterrupt:
            print("\nInterrupted — shutting down...")
            pool.terminate()
            pool.join()
            print(f"Progress saved. Resume with:  "
                  f"python rates_backfill.py --all --resume --workers "
                  f"{args.workers}")
            sys.exit(0)
        else:
            pool.close()
            pool.join()

    ok = sum(r["ok"] for r in all_results)
    skipped = sum(r["skipped"] for r in all_results)
    rooms = sum(r["rooms"] for r in all_results)
    rates = sum(r["rates"] for r in all_results)
    failed_names = [n for r in all_results for n in r["failed"]]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Accounts OK      : {ok}")
    print(f"  Reservations     : {rooms}")
    print(f"  Rate night rows  : {rates}")
    print(f"  Failed           : {len(failed_names)}")
    print(f"  Skipped (done)   : {skipped}")
    if failed_names[:20]:
        print(f"  Failed sample    : {failed_names[:20]}")
    print(f"  Elapsed          : {(time.time() - started) / 60:.1f} min")
    print(f"  Issues logged to : {FAIL_LOG}")
    print("=" * 60)
    print("\nNext:")
    print("  python cleaner.py --rooms-only")
    print("  python cleaner.py --rate-details-only")
    print("  python overview_sql.py     # REQUIRED - payment_type/bedroom_count")


if __name__ == "__main__":
    main()