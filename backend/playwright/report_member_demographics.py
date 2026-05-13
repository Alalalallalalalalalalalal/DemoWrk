"""
report_member_demographics.py — Downloads the Member Demographics report (ID 5).
"""
import os
from datetime import datetime

from config import OUTPUT_FOLDER, REPORTS_FOLDER
from report_utils import find_reports_frame

REPORT_ID   = 5
REPORT_NAME = "member_demographics"
SCREENSHOT_FOLDER = os.path.join(OUTPUT_FOLDER, "screenshots")


def download(page):
    """Select radio button, click Run, click Generate Report, save CSV."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    print(f"  Selecting radio button for reportId={REPORT_ID}...")

    reports_frame = find_reports_frame(page)
    if not reports_frame:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        screenshot_path = os.path.join(SCREENSHOT_FOLDER, f"{REPORT_NAME}_error_{timestamp}.png")
        page.screenshot(path=screenshot_path)
        raise Exception(f"Could not find reports frame. Screenshot: {screenshot_path}")

    radio = reports_frame.query_selector(f"input[name='reportId'][value='{REPORT_ID}']")
    if not radio:
        raise Exception(f"Could not find radio button for reportId={REPORT_ID}")
    radio.click()
    print("  Radio button selected.")
    page.wait_for_timeout(1000)

    # Click Run
    run_btn = reports_frame.query_selector("input[value='Run']")
    if not run_btn:
        for frame in page.frames:
            try:
                btn = frame.query_selector("input[value='Run']")
                if btn:
                    run_btn = btn
                    break
            except Exception:
                continue

    if not run_btn:
        raise Exception("Could not find Run button.")
    run_btn.click()
    print("  Clicked Run.")
    page.wait_for_timeout(4000)

    # Find Generate Report button
    generate_frame = None
    for frame in page.frames:
        try:
            btn = frame.query_selector("input[value='Generate Report']")
            if btn:
                generate_frame = frame
                print("  Found Generate Report button.")
                break
        except Exception:
            continue

    if not generate_frame:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        screenshot_path = os.path.join(SCREENSHOT_FOLDER, f"{REPORT_NAME}_generate_error_{timestamp}.png")
        page.screenshot(path=screenshot_path)
        raise Exception(f"Could not find Generate Report button. Screenshot: {screenshot_path}")

    # Download
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    download_path = os.path.join(REPORTS_FOLDER, f"{REPORT_NAME}_{timestamp}.csv")
    with page.expect_download(timeout=60000) as download_info:
        generate_frame.evaluate("validate()")
        print("  Downloading...")
    download_info.value.save_as(download_path)
    print(f"  Saved: {download_path}\n")

    return True