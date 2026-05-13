"""
login.py — Handles portal login.
"""
from config import USERNAME, PASSWORD, PORTAL_URL


def get_frame_by_url(page, keyword):
    """Find a frame by a keyword in its URL."""
    for frame in page.frames:
        if keyword in frame.url:
            return frame
    return None

def login(page):
    """Log into the portal."""
    print("Step 1: Navigating to portal...")
    page.goto(PORTAL_URL)
    page.wait_for_timeout(2000)

    print("Step 2: Finding login frame...")
    login_frame = get_frame_by_url(page, "login.jsp")
    if not login_frame:
        for frame in page.frames:
            try:
                if frame.query_selector("#userID"):
                    login_frame = frame
                    break
            except Exception:
                continue

    if not login_frame:
        raise Exception("Could not find login frame.")

    print("Step 3: Entering credentials...")
    login_frame.wait_for_selector("#userID", state="visible", timeout=10000)
    login_frame.fill("#userID", USERNAME)
    login_frame.fill("#password", PASSWORD)
    login_frame.click("#Login")

    print("Step 4: Waiting for portal to load...")
    page.wait_for_timeout(4000)

    # Handle preferences screen if it appears
    prefs_frame = get_frame_by_url(page, "userPreferences.jsp")
    if prefs_frame:
        try:
            prefs_frame.wait_for_selector("#Continue", state="visible", timeout=5000)
            prefs_frame.click("#Continue")
            page.wait_for_timeout(3000)
            print("Step 5: Passed preferences screen.")
        except Exception:
            pass

    print("Login successful.\n")


def open_reporting_menu(page):
    """Open the Reporting menu via JavaScript."""
    print("Opening Reporting menu...")
    page.wait_for_timeout(4000)

    main_frame = get_frame_by_url(page, "default.jsp")
    if not main_frame:
        raise Exception("Could not find main navigation frame.")

    main_frame.evaluate("changeSelModule(16,1,1,'#003565','Reporting')")
    page.wait_for_timeout(4000)
    print("Reporting menu opened.")