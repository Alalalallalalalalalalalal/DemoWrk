"""
login.py — Handles portal login.
"""
from .config import USERNAME, PASSWORD, PORTAL_URL
import time

def get_frame_by_url(page, keyword):
    """Find a frame by a keyword in its URL."""
    for frame in page.frames:
        if keyword in frame.url:
            return frame
    return None

def close_notification_popup(page, timeout_ms=8000):
    """Find the User Notification close button in ANY frame and
    real-click it, same as closing it by hand."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                btn = frame.query_selector("[id^='closeButtonId_']")
                if btn and btn.is_visible():
                    print(f"  Found popup close button in frame: {frame.url[:70]}")
                    btn.click()
                    page.wait_for_timeout(1000)
                    print("  Closed notification popup.")
                    return True
            except Exception:
                continue
        page.wait_for_timeout(300)
    print("  No notification popup found in any frame.")
    return False

def login(page):
    """Log into the portal."""
    print("Step 1: Navigating to portal...")
    page.goto(PORTAL_URL)
    page.wait_for_timeout(1000)

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
    page.wait_for_timeout(2500)
    close_notification_popup(page, timeout_ms=5000)          # ← popup 1

    # Handle preferences screen if it appears
    prefs_frame = get_frame_by_url(page, "userPreferences.jsp")
    if prefs_frame:
        try:
            prefs_frame.wait_for_selector("#Continue", state="visible", timeout=5000)
            prefs_frame.click("#Continue")
            page.wait_for_timeout(1500)
            print("Step 5: Passed preferences screen.")
        except Exception:
            pass

    close_notification_popup(page, timeout_ms=3000)          # ← popup 2

    print("Login successful.\n")


def open_reporting_menu(page):
    """Open the Reporting menu via JavaScript."""
    print("Opening Reporting menu...")
    page.wait_for_timeout(2500)

    main_frame = get_frame_by_url(page, "default.jsp")
    if not main_frame:
        raise Exception("Could not find main navigation frame.")

    main_frame.evaluate("changeSelModule(16,1,1,'#003565','Reporting')")
    page.wait_for_timeout(2500)
    print("Reporting menu opened.")
