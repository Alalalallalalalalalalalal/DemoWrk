"""
member_scraper.py — Entry point. Orchestrates login, menu navigation, and report downloads.

What this script does:
1. Logs into the portal
2. Opens the Reporting menu
3. Navigates to Search Report page
4. Selects the radio button for each report
5. Clicks Run then Generate Report
6. Downloads and saves each CSV to your project folder

Setup:
    pip install playwright pandas openpyxl
    playwright install chromium

Usage:
    python member_scraper.py
"""
import os
from datetime import datetime
from playwright.sync_api import sync_playwright

from config import OUTPUT_FOLDER, REPORTS_FOLDER
from login import login, open_reporting_menu
from report_utils import navigate_to_search_reports
import report_member_demographics
import report_member_dependents

SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")

REPORTS = [
    report_member_demographics,
    report_member_dependents,
]


def main():
    print("=" * 60)
    print("Member Report Downloader")
    print("=" * 60)
    print()

    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        try:
            login(page)

            for i, report_module in enumerate(REPORTS, 1):
                report_name = report_module.REPORT_NAME
                print(f"{'=' * 40}")
                print(f"Report {i} of {len(REPORTS)}: {report_name}")
                print(f"{'=' * 40}")

                open_reporting_menu(page)
                navigate_to_search_reports(page)

                try:
                    success = report_module.download(page)
                    results[report_name] = success
                except Exception as e:
                    print(f"  Failed: {e}\n")
                    results[report_name] = False

            print("\n" + "=" * 60)
            print("Download Summary")
            print("=" * 60)
            for report_name, success in results.items():
                status = "Success" if success else "Failed — check screenshot"
                print(f"  {report_name}: {status}")

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


if __name__ == "__main__":
    main()