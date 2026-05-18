'''
Find newest + previous CSV
Compare member numbers
Find only new members
Use Playwright to search portal
Append results to member_id_map.csv

usage: automatically runs when new demographics report is added to reports folder in member_scraper.py
'''

import os
import re
import csv
import glob
import sys
from playwright.sync_api import sync_playwright

from config import REPORTS_FOLDER, OUTPUT_FOLDER
from login import login
from build_member_map import navigate_to_list_members

# ---------------------------------------------------
MAP_FILE = os.path.join(OUTPUT_FOLDER, "member_id_map.csv")

DEMOGRAPHICS_FOLDER =REPORTS_FOLDER

# ---------------------------------------------------


def get_two_latest_csvs():
    """
    Returns:
        older_csv, newest_csv
    """

    csv_files = glob.glob(os.path.join(DEMOGRAPHICS_FOLDER, "*demographics*.csv"))

    if len(csv_files) < 2:
        print(
        "\nFirst run detected."
        "\nRequires at least two demographics reports to find new members."
        "\nSkipping new member detection.\n"
        )

        return None, None

    csv_files.sort(key=os.path.getmtime)

    older_csv = csv_files[-2]
    newest_csv = csv_files[-1]

    return older_csv, newest_csv


#---------------------------------------------------
# Compare two CSVs and find new members
#---------------------------------------------------

def load_member_numbers(csv_path):
    members = set()

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)

        for row in reader:
            member_number = row.get("Member Number", "").strip()

            if member_number:
                members.add(member_number)

    return members


def get_new_members():
    older_csv, newest_csv = get_two_latest_csvs()

    if not older_csv or not newest_csv:
        return []
    
    old_members = load_member_numbers(older_csv)
    new_members = load_member_numbers(newest_csv)

    added_members = new_members - old_members

    existing_map_members = set()

    if os.path.exists(MAP_FILE):

        with open(MAP_FILE, newline="", encoding="utf-8") as f:

            reader = csv.DictReader(f)

            for row in reader:

                existing_member = (
                    row.get("member_number", "")
                    .strip()
                    .upper()
                )

                if existing_member:
                    existing_map_members.add(existing_member)

    # Keep only members NOT already mapped
    added_members = [
        member for member in added_members
        if member.strip().upper() not in existing_map_members
    ]

    print(f"Old CSV members: {len(old_members)}")
    print(f"New CSV members: {len(new_members)}")
    print(f"Already mapped members: {len(existing_map_members)}")
    print(f"Number of new members found: {len(added_members)}")

    return list(added_members)

#---------------------------------------------------
#use playwright to search for id 
#---------------------------------------------------

def search_member_and_get_id(page, member_number):

    for frame in page.frames:

        try:
            search_input = frame.query_selector(
                "input[placeholder*='Search'], "
                "input[placeholder*='search']"
            )

            if not search_input:
                continue

            # Clear existing text
            search_input.click()
            search_input.press("Control+A")
            search_input.press("Backspace")

            page.wait_for_timeout(500)

            # REAL typing triggers JS events
            search_input.type(member_number, delay=100)

            # Trigger additional events
            search_input.press("Enter")

            # Wait for table reload/filter
            page.wait_for_timeout(6000)

            links = frame.query_selector_all(
                "a#memberNumber[href*='retrieve.jsp']"
            )

            for link in links:
                title = link.get_attribute("title") or ""
                number_match = re.search(
                    r'(?:Member|Guest) Number\s*:\s*(\S+)',
                    title
                )

                if not number_match:
                    continue

                found_member_number = number_match.group(1).strip()

                # EXACT MATCH
                if found_member_number == member_number:
                    href = link.get_attribute("href") or ""
                    match = re.search(
                        r'memberid=(\d+)',
                        href
                    )
                    if match:
                        return match.group(1)

        except Exception as e:
            print(f"Search error: {e}")
            continue

    return None


#---------------------------------------------------
#append to member_id_map.csv
#---------------------------------------------------

def append_to_member_map(member_number, member_id):

    #Add to CSV map file
    file_exists = os.path.exists(MAP_FILE)

    with open(MAP_FILE, "a", newline="", encoding="utf-8") as f:

        writer = csv.DictWriter(
            f,
            fieldnames=["member_number", "member_id"]
        )

        if not file_exists:
            writer.writeheader()

        writer.writerow({
            "member_number": member_number,
            "member_id": member_id
        })

    print(f"Added -> {member_number} : {member_id}")


def main():

    new_members = get_new_members()

    if not new_members:
        print("No new members found")
        return

    print(f"\nProcessing {len(new_members)} new members...\n")

    with sync_playwright() as p:

        browser = p.chromium.launch(headless=False)

        page = browser.new_page()

        try:

            login(page)

            navigate_to_list_members(page)

            for member_number in new_members:

                print(f"Searching: {member_number}")

                member_id = search_member_and_get_id(
                    page,
                    member_number
                )

                if member_id:

                    append_to_member_map(
                        member_number,
                        member_id
                    )

                else:
                    print(f"Could not find ID for {member_number}")

        finally:
            print("\nEnding session...")
            browser.close()
            sys.exit()


if __name__ == "__main__":
    main()