"""
member_utils.py — Membership-module navigation helpers, mirroring
report_utils.py's role for the Reporting module.

Flow this supports:
    open_membership_menu(page)        # in login.py — switches top module tab
    navigate_to_search_member(page)   # here — waits for the quick-search form
    search_member_by_number(page, n)  # here — fills the box, submits, returns results frame

CONFIRMED via debug_quicksearch.py: the Membership dashboard loads directly
onto Membership/quickSearch.jsp inside a frame named 'contantPanel1'. There
is NO separate 'Search Member' tile to click — the form (#MemberNumber,
#SearchBttn, etc.) is already present as soon as the module opens.

Every field in that frame reports is_visible()=False to Playwright (the
whole panel appears to sit in a zero-size/hidden container in this JSP UI
even though it works fine for a human), so normal .fill()/.click() calls
— which require visibility — silently fail here. All interaction with this
frame is therefore done via frame.evaluate() JS instead of the normal
actionability-checked Playwright calls.
"""

import os
import time
from datetime import datetime

from login import get_frame_by_url

SCREENSHOT_FOLDER = os.path.join("reports", "screenshots")

# Kept as a fallback path only, in case a different portal view/role
# doesn't pre-load the quick-search form the way ours does.
SEARCH_MEMBER_SELECTORS = [
    "a:has-text('Search Member')",
    "button:has-text('Search Member')",
    "*[onclick]:has-text('Search Member')",
    "*[title*='Search Member']",
    "a:has-text('Search')",
]


def _screenshot(page, name):
    try:
        os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SCREENSHOT_FOLDER, f"{name}_{ts}.png")
        page.screenshot(path=path)
        print(f"  Screenshot: {path}")
    except Exception:
        pass


def get_landing_frame(page, timeout_ms=10000):
    """Same convention used in room_inquiry_scraper.py — the module's
    content renders inside a frame named 'landingFrame'."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == "landingFrame":
                    _ = frame.url
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(200)
    return None


def get_content_context(page, timeout_ms=10000):
    landing = get_landing_frame(page, timeout_ms=timeout_ms)
    return landing if landing else page


def js_click(frame, element):
    """
    Click via JS (element.click() in-page) instead of Playwright's normal
    .click(), which blocks waiting for the element to be 'visible, enabled
    and stable'. Confirmed via the quickSearch.jsp frame dump and the
    ElementHandle.click timeout: elements in this portal's panels routinely
    report is_visible()=False to Playwright even though they render and
    work fine for a real user (a container-sizing quirk in this JSP UI),
    so any actionability-checked click on them just hangs for 30s. A raw
    JS .click() sidesteps that check entirely.
    """
    frame.evaluate("(el) => el.click()", element)


def get_frame_by_name(page, name, timeout_ms=10000):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.name == name:
                    _ = frame.url
                    return frame
            except Exception:
                continue
        page.wait_for_timeout(200)
    return None


def get_quick_search_frame(page, timeout_ms=10000):
    """
    Locate the frame holding the quick-search form. Tries the confirmed
    frame name first ('contantPanel1'), then falls back to scanning all
    frames for the quickSearch.jsp / search_processing.jsp URL, in case the
    portal reassigns frame names on some path.
    """
    frame = get_frame_by_name(page, "contantPanel1", timeout_ms=timeout_ms)
    if frame:
        return frame

    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for f in page.frames:
            try:
                if "quickSearch.jsp" in f.url or "search_processing.jsp" in f.url:
                    return f
            except Exception:
                continue
        page.wait_for_timeout(200)
    return None


def find_element_in_any_frame(page, selectors, timeout_ms=10000):
    """
    Scan EVERY frame on the page (not just landingFrame) for the first
    selector that matches — same pattern build_member_map.py uses in
    extract_members_from_page() / go_to_next_page(). Kept as a fallback
    for navigate_to_search_member() in case the dashboard ever doesn't
    pre-load the quick-search form.

    Returns (frame, element) or (None, None).
    """
    if isinstance(selectors, str):
        selectors = [selectors]

    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        landing = get_landing_frame(page, timeout_ms=500)
        frames_to_check = ([landing] if landing else []) + [
            f for f in page.frames if f is not landing
        ]

        for frame in frames_to_check:
            if frame is None:
                continue
            for sel in selectors:
                try:
                    el = frame.query_selector(sel)
                    # NOTE: deliberately NOT requiring el.is_visible() here —
                    # elements in this portal routinely report invisible
                    # even when they're real, working elements (see
                    # js_click() docstring). Presence in the DOM is enough;
                    # callers should use js_click() rather than .click().
                    if el:
                        return frame, el
                except Exception:
                    continue
        page.wait_for_timeout(300)

    return None, None


def navigate_to_search_member(page):
    """
    The Membership dashboard opens directly onto quickSearch.jsp — there's
    no 'Search Member' tile to click. This just waits for that frame
    (contantPanel1) to be ready and returns it. Falls back to the old
    click-a-tile search only if the quick-search frame never shows up.
    """
    page.wait_for_timeout(1500)

    frame = get_quick_search_frame(page, timeout_ms=8000)
    if frame:
        return frame

    frame, option = find_element_in_any_frame(
        page, SEARCH_MEMBER_SELECTORS, timeout_ms=8000
    )
    if not option:
        print("  Frames on page:")
        for f in page.frames:
            try:
                print(f"    name={f.name!r} url={f.url[:80]}")
            except Exception:
                pass
        _screenshot(page, "search_member_not_found")
        raise Exception(
            "Could not find the quick-search form (contantPanel1) or a "
            "'Search Member' tile in any frame. Screenshot + frame list "
            "printed above."
        )

    js_click(frame, option)
    page.wait_for_timeout(2000)
    return get_quick_search_frame(page, timeout_ms=5000) or get_content_context(page)


def search_member_by_number(page, member_number):
    """
    Fill #MemberNumber and trigger the search.

    Interacts entirely via frame.evaluate() JS (set .value + dispatch
    input/change events, then call the button's own onclick handler)
    instead of .fill()/.click(), since every field in this frame reports
    is_visible()=False to Playwright and would otherwise time out waiting
    for actionability that never resolves.
    """
    frame = get_quick_search_frame(page, timeout_ms=8000)
    if not frame:
        _screenshot(page, f"search_frame_not_found_{member_number}")
        raise Exception(f"Quick-search frame not found (member {member_number}).")

    filled = frame.evaluate(
        """
        (val) => {
            const el = document.getElementById('MemberNumber');
            if (!el) return false;
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        """,
        str(member_number),
    )
    if not filled:
        _screenshot(page, f"member_number_input_missing_{member_number}")
        raise Exception(f"#MemberNumber input not found (member {member_number}).")

    search_btn = frame.query_selector("#SearchBttn")
    onclick = search_btn.get_attribute("onclick") if search_btn else None

    if onclick:
        frame.evaluate(onclick)
    else:
        # Fallback: submit the form directly if the button/onclick ever
        # changes shape.
        frame.evaluate(
            """
            () => {
                const el = document.getElementById('MemberNumber');
                const form = el ? el.closest('form') : null;
                if (form) form.submit();
            }
            """
        )

    page.wait_for_timeout(2500)
    return get_quick_search_frame(page, timeout_ms=5000) or get_content_context(page)


def open_member_record(page, lf, member_number):
    """Click the member-number link in the search results row."""
    link_frame = lf
    link = lf.query_selector(f"a:has-text('{member_number}')")
    if not link:
        # Fall back to scanning all frames in case results rendered
        # outside the frame `lf` pointed to.
        link_frame, link = find_element_in_any_frame(
            page, f"a:has-text('{member_number}')", timeout_ms=5000
        )
    if not link:
        _screenshot(page, f"member_link_not_found_{member_number}")
        raise Exception(f"Member-number link not found for {member_number}.")

    js_click(link_frame, link)
    page.wait_for_timeout(2000)
    return get_content_context(page)


def click_member_name_tab(page):
    """Click the tab bearing the member's name, next to the Membership tab."""
    lf = get_content_context(page)
    tab = lf.query_selector(
        "li.ui-tabs-tab a, .tab-member-name, a[href*='memberInfo']"
    )
    tab_frame = lf
    if not tab:
        tab_frame, tab = find_element_in_any_frame(
            page,
            "li.ui-tabs-tab a, .tab-member-name, a[href*='memberInfo']",
            timeout_ms=5000,
        )
    if tab and tab_frame:
        js_click(tab_frame, tab)
        page.wait_for_timeout(1500)
    return get_content_context(page)


def click_rooms_subtab(page, member_number=None, retries=2):
    """
    From Member Info, click the 'Rooms' sub-tab.

    CONFIRMED via debug_rooms_tab.py: there are two 'Rooms' elements on the
    page — the top-nav module tab (onclick="changeSelModule(...,'Rooms')",
    no id) and the actual Member Info sub-tab we want
    (id='rooms', class='subTab subtablink1'). A plain
    "a:has-text('Rooms')" grabs the top-nav one since it comes first in the
    DOM. Both live in the 'MainScreen' frame, not landingFrame/contantPanel1.

    CONFIRMED via debug_reservations_table.py: even with the id='rooms'
    selector, clicking too soon after click_member_name_tab() can land on
    the generic Rooms MODULE (landingPage.jsp?moduleId=13,
    searchReservation.do) instead of the member's own record
    (roomsInfo.do?...&memberId=...). The sub-tab's href appears to get
    populated with the member-specific URL slightly after the tab becomes
    visible (a follow-up AJAX call), so a fixed wait isn't reliable. This
    polls the element's href until it actually contains 'roomsInfo.do'
    before clicking, then verifies landingFrame landed there too —
    retrying the whole click once if it didn't.
    """
    rooms_frame = get_frame_by_name(page, "MainScreen", timeout_ms=8000) or get_content_context(page)

    for attempt in range(1, retries + 2):  # e.g. retries=2 -> up to 3 attempts
        rooms_tab = rooms_frame.query_selector("a#rooms.subTab, a.subTab:has-text('Rooms')")
        if not rooms_tab:
            rooms_frame, rooms_tab = find_element_in_any_frame(
                page, "a#rooms.subTab, a.subTab:has-text('Rooms')", timeout_ms=5000
            )
        if not rooms_tab:
            _screenshot(page, "rooms_subtab_not_found")
            raise Exception("'Rooms' sub-tab (id='rooms', class='subTab') not found.")

        # Poll up to ~5s for the href to be populated with the
        # member-specific roomsInfo.do target rather than clicking blind.
        href = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            href = rooms_tab.get_attribute("href") or ""
            if "roomsInfo.do" in href:
                break
            page.wait_for_timeout(250)
            # Re-fetch in case the node itself got replaced, not just its href.
            rooms_tab = rooms_frame.query_selector("a#rooms.subTab, a.subTab:has-text('Rooms')") or rooms_tab

        print(f"  Rooms sub-tab href before click (attempt {attempt}): {href}")

        js_click(rooms_frame, rooms_tab)
        page.wait_for_timeout(2000)

        result_frame = get_content_context(page)
        if "roomsInfo.do" in (result_frame.url or ""):
            return result_frame

        print(
            f"  WARNING: after clicking Rooms sub-tab, landingFrame is "
            f"'{result_frame.url[:100]}' (expected roomsInfo.do). "
            f"Retrying..." if attempt <= retries else "Giving up."
        )
        page.wait_for_timeout(1000)

    _screenshot(page, f"rooms_subtab_wrong_target_{member_number or ''}")
    raise Exception(
        "Clicked the Rooms sub-tab but never landed on roomsInfo.do "
        f"after {retries + 1} attempts — landed on "
        f"'{get_content_context(page).url[:120]}' instead."
    )