"""
build_member_map.py — Build a lookup table of member_number → memberid.

Navigates the List Members page, reads all member links
(retrieve.jsp?memberid=X) across all pages, and saves member_id_map.csv.

This only needs to run ONCE (or when you want a fresh map).
The map is used by journal_scraper.py and build_journal_profiles.py.

Usage:
    python build_member_map.py              # All members
    python build_member_map.py --limit 500  # Test with first 500

Output:
    member_id_map.csv — columns: member_number, member_id
"""
import os
import re
import csv
import argparse
from datetime import datetime
import sys
from playwright.sync_api import sync_playwright

from config import OUTPUT_FOLDER, BASE_URL
from login import login, get_frame_by_url

# ─────────────────────────────────────────────
LIST_MEMBERS_URL  = f"{BASE_URL}/Membership/middlePage.jsp?listView&tabId=437&tabGrpModuleID=1"
MAP_FILE          = os.path.join(OUTPUT_FOLDER, "member_id_map.csv")
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")
# ─────────────────────────────────────────────


def screenshot(page, name):
    os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(SCREENSHOT_FOLDER, f"map_{name}_{timestamp}.png")
    page.screenshot(path=path)
    print(f"  Screenshot: {path}")


def dismiss_notification_popup(page):
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


def navigate_to_list_members(page):
    """
    Navigate to the member list by:
    1. Loading Membership module (creates frame structure)
    2. Navigating landingFrame directly to LIST_MEMBERS_URL
    """
    print("  Loading Membership module...")
    main_frame = get_frame_by_url(page, "default.jsp") or page
    try:
        main_frame.evaluate("changeSelModule(1,1,1,'#003565','Membership')")
    except Exception:
        pass
    page.wait_for_timeout(6000)

    print("  Navigating landingFrame to member list...")
    landing = next((f for f in page.frames if f.name == "landingFrame"), None)
    if landing:
        landing.goto(LIST_MEMBERS_URL)
        page.wait_for_timeout(5000)
        print(f"  Loaded: {landing.url[:80]}")
        return True

    # Fallback: any non-default frame
    print(f"  landingFrame not found. Frames: {[f.name for f in page.frames]}")
    for frame in page.frames:
        try:
            if frame.name in ["", "MainScreen"]:
                continue
            frame.goto(LIST_MEMBERS_URL)
            page.wait_for_timeout(5000)
            print(f"  Loaded via '{frame.name}': {frame.url[:80]}")
            return True
        except Exception:
            continue

    return False


def set_rows_per_page(page):
    """Click the 1000 rows per page option from the dropdown."""
    for frame in page.frames:
        try:
            # Click the current page size to open the dropdown
            size_span = frame.query_selector("span.page-size")
            if size_span:
                size_span.click()
                page.wait_for_timeout(1000)
                # Click the 1000 option
                for link in frame.query_selector_all("a"):
                    if link.inner_text().strip() == "1000":
                        link.click()
                        page.wait_for_timeout(3000)
                        print("  Set rows per page to 1000.")
                        return True
        except Exception:
            continue
    print("  Could not set rows per page to 1000.")
    return False


def get_total_pages(page):
    """Read total pages from pagination area."""
    for frame in page.frames:
        try:
            content = frame.content()
            match = re.search(r'Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+rows', content)
            if match:
                total = int(match.group(1).replace(",", ""))
                per_page_match = re.search(r'Showing\s+\d+\s+to\s+(\d+)\s+of', content)
                per_page = int(per_page_match.group(1)) if per_page_match else 100
                pages = (total + per_page - 1) // per_page
                print(f"  Total rows: {total}, per page: {per_page}, pages: {pages}")
                return pages, total
        except Exception:
            continue
    return None, None


def extract_members_from_page(page):
    """
    Extract (member_number, member_id) pairs from the current page.
    Uses a#memberNumber selector — confirmed from portal HTML.
    Reads member/guest number from title attribute.
    """
    members = []
    seen_ids = set()

    for frame in page.frames:
        try:
            links = frame.query_selector_all("a#memberNumber[href*='retrieve.jsp']")
            if not links:
                continue

            for link in links:
                try:
                    href = link.get_attribute("href") or ""
                    match = re.search(r'memberid=(\d+)', href)
                    if not match:
                        continue
                    member_id = match.group(1)

                    if member_id in seen_ids:
                        continue

                    # Read number from title: "Member Number : 1C" or "Guest Number : 7G10"
                    title = link.get_attribute("title") or ""
                    number_match = re.search(r'(?:Member|Guest) Number\s*:\s*(\S+)', title)
                    if number_match:
                        full_text = number_match.group(1).strip()
                    else:
                        full_text = link.inner_text().strip()

                    if not full_text or len(full_text) > 20:
                        continue
                    if " " in full_text and len(full_text) > 10:
                        continue

                    seen_ids.add(member_id)
                    members.append({
                        "member_number": full_text,
                        "member_id":     member_id,
                    })
                except Exception:
                    continue

            if members:
                break

        except Exception:
            continue

    return members


def go_to_next_page(page):
    """Click the Next page button."""
    for frame in page.frames:
        try:
            next_btn = frame.query_selector(
                "li.next:not(.disabled) a, "
                "a[aria-label='next'], "
                ".pagination .next a, "
                "li:not(.disabled) > a[data-page='next']"
            )
            if next_btn:
                next_btn.click()
                page.wait_for_timeout(3000)
                return True
        except Exception:
            continue

    for frame in page.frames:
        try:
            buttons = frame.query_selector_all(".pagination li a, .pagination a")
            for btn in buttons:
                text = btn.inner_text().strip()
                if text in [">", "›", "Next", "next"]:
                    btn.click()
                    page.wait_for_timeout(3000)
                    return True
        except Exception:
            continue

    return False


def save_map(members, filepath):
    """Save member_number → member_id map to CSV."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["member_number", "member_id"])
        writer.writeheader()
        writer.writerows(members)
    print(f"\nSaved {len(members)} members to: {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Build member number → ID map.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit total members scraped (for testing)")
    args = parser.parse_args()

    print("=" * 60)
    print("Member ID Map Builder")
    print("=" * 60)
    print(f"Limit:  {args.limit if args.limit else 'None (all members)'}")
    print(f"Output: {MAP_FILE}")
    print()

    all_members = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        try:
            login(page)
            dismiss_notification_popup(page)

            # Navigate directly — no manual clicks needed
            ok = navigate_to_list_members(page)
            if not ok:
                print("Could not navigate to member list.")
                screenshot(page, "nav_failed")
                return

            # Try to get more rows per page
            set_rows_per_page(page)

            # Get total pages
            total_pages, total_rows = get_total_pages(page)
            if total_pages:
                print(f"\nStarting map build — {total_pages} pages to process...")
            else:
                print("\nCould not determine total pages — paginating until end.")

            page_num = 1
            while True:
                print(f"\nPage {page_num}" + (f"/{total_pages}" if total_pages else "") + "...")

                members = extract_members_from_page(page)


                print(f"  Found {len(members)} members.")
                all_members.extend(members)

                if args.limit and len(all_members) >= args.limit:
                    all_members = all_members[:args.limit]
                    print(f"  Reached limit of {args.limit}.")
                    break

                # Stop if we've hit the total pages
                if total_pages and page_num == total_pages:
                    print("  Reached last page.")
                    break

                has_next = go_to_next_page(page)
                if not has_next:
                    print("  No more pages.")
                    break

                page_num += 1

            if all_members:
                save_map(all_members, MAP_FILE)
            else:
                print("No members found — check screenshots.")
                screenshot(page, "no_members")

            print(f"\nTotal mapped: {len(all_members)}")

        except Exception as e:
            print(f"\nFatal error: {e}")
            screenshot(page, "fatal_error")

        finally:
            print("Ending session...")
            browser.close()
            sys.exit()


if __name__ == "__main__":
    main()