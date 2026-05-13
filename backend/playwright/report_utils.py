"""
report_utils.py — Shared utilities for report navigation and frame finding.
                Used by each individual report module.
"""
import os
from datetime import datetime

from login import get_frame_by_url
from config import OUTPUT_FOLDER, SEARCH_REPORT_URL

SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")


def navigate_to_search_reports(page):
    """
    Navigate to the Search Report page.
    Uses the onclick from the Search Report button:
    changeButtonSelection('search', 609)
    which loads tabs.jsp?g=27&m=Inquiry&s=search into the landing frame.
    """
    print("Navigating to Search Report page...")

    landing_frame = get_frame_by_url(page, "landingPage")
    if landing_frame:
        landing_frame.goto(SEARCH_REPORT_URL)
    else:
        for frame in page.frames:
            try:
                frame.evaluate("changeButtonSelection('search', 609)")
                break
            except Exception:
                continue

    page.wait_for_timeout(3000)

    # Click the Search button to load all reports
    for frame in page.frames:
        try:
            btn = frame.query_selector("input[value='Search']")
            if btn:
                btn.click()
                print("  Clicked Search button.")
                page.wait_for_timeout(3000)
                break
        except Exception:
            continue

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
    screenshot_path = os.path.join(SCREENSHOT_FOLDER, f"search_reports_page_{timestamp}.png")
    page.screenshot(path=screenshot_path)
    print(f"Search Report page loaded. Screenshot: {screenshot_path}\n")


def find_reports_frame(page):
    """Find the frame that contains the report radio buttons."""
    for frame in page.frames:
        try:
            radio = frame.query_selector("input[name='reportId']")
            if radio:
                return frame
        except Exception:
            continue
    return None