# backend/postgres/analytics_guest_revenue.py
"""
New vs Repeat Guest Revenue — powers the "New vs Repeat guest revenue"
card from the report-builder email spec: trends by month/year (or a
custom date range) plus summary averages, exportable as JSON for the
frontend to turn into a table/chart or CSV/XLSX.

╔══════════════════════════════════════════════════════════════════════╗
║ THIS IS A DIFFERENT "NEW VS REPEAT" THAN                              ║
║ analytics_demographics.py's /new-vs-repeat-visitors.                  ║
║                                                                        ║
║ /new-vs-repeat-visitors classifies an ACCOUNT: "New" the moment it    ║
║ joins (members.since_date), "Repeat" on any booking after that join   ║
║ date. That's a membership-growth question — an account can be         ║
║ "New" there with zero stays and zero revenue.                         ║
║                                                                        ║
║ This module classifies a STAY: "New" if it's that guest's earliest    ║
║ check_in_date ever (in `rooms`), "Repeat" otherwise. That's the        ║
║ correct basis for a REVENUE question — since_date isn't a revenue      ║
║ event, so building this off /new-vs-repeat-visitors' definition would ║
║ structurally show $0 "New" revenue for every period.                  ║
║                                                                        ║
║ Do not merge these two endpoints or treat their New/Repeat labels as   ║
║ interchangeable — they answer different questions by design.          ║
╚══════════════════════════════════════════════════════════════════════╝

REVENUE SOURCES — deliberately split, mirroring finance_backend.py:
  Villa revenue      -> rate_details, same reservation-dedup CTE
                        finance_backend.py's _villa_gross_revenue_cte_sql()
                        uses (payment_type='Paid', status='Posted', ZZ Comp
                        excluded). NOT folios — folios' Villa figure was
                        found to undercount badly (~$2.8M vs ~$36M for the
                        same scope; see finance_backend.py's
                        _villa_collected_revenue_row() docstring).
  Amenity/Service     -> folios, restricted to the 'collected' bucket
  revenue                (real charges only — comps, reversals, and
                          payments are excluded), and to categories other
                          than 'Villa' so it can't double-count step one.

JOIN KEY: rooms.member_number and folios.member_number use two different
ID schemes in this data and do not match each other directly (verified
against a sample export: rooms had short codes like "101A", folios had
"TTC1G13326"-style codes for the same guest's stay). rooms and folios are
joined via rooms.confirmation_code = folios.conf_code instead, which had
~99% overlap in that same sample. rate_details already carries its own
conf_code, joined the same way.

DATE BUCKETING: every stay is attributed to the calendar month of its
check_in_date — never split across months, never counted by stay-overlap.
This mirrors the fix documented in finance_backend.py's
_villa_revenue_date_filter_sql() docstring: overlap-based bucketing was
found to double-count a stay that crosses a period boundary.

CLASSIFICATION SCOPE: a guest's first-ever check_in_date is computed over
ALL of `rooms`, regardless of what date range is requested — the
first/New determination must not change depending on which window you
happen to be viewing. The date filter only controls which check-ins are
included in the OUTPUT rows.

DRILLDOWN ENDPOINTS (accounts / account breakdown): both scope to the
SAME period params (year/month or start_date/end_date) the trend/summary
endpoints use, so clicking a bar for e.g. "Mar 2025 / New" and then a
guest in that list shows figures that foot back to that exact bar —
not that guest's lifetime totals.
"""
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta

from .analytics_shared import get_db, rows, one
from fastapi import Depends

router = APIRouter()


def _checkin_month_filter_sql(alias: str = "cs") -> str:
    """
    Check-in-month bucketing filter for this module's classified_stays
    CTE (alias "cs" by default, column check_in_date). Same "one stay,
    one period" semantics as overview_analytics.py's
    overview_date_filter_sql(mode="checkin") and finance_backend.py's
    _villa_revenue_date_filter_sql() — deliberately NOT
    analytics_shared.date_filter_sql(), whose overlap-based semantics
    are documented elsewhere in this codebase to double-count stays
    that cross a period boundary.

    Priority, matching filter_params()'s mutually-exclusive design:
    start_date/end_date range > year+month > year alone > no filter.
    Expects :year, :month, :start_date, :end_date bound in params
    (this module does not use the :date single-day param).
    """
    d = f"{alias}.check_in_date"
    return f"""
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    {d} >= COALESCE(:start_date, {d})
                    AND {d} <= COALESCE(:end_date, {d})
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    {d} >= MAKE_DATE(:year, :month, 1)
                    AND {d} <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                WHEN :year IS NOT NULL THEN
                    {d} >= MAKE_DATE(:year, 1, 1)
                    AND {d} <= MAKE_DATE(:year, 12, 31)
                ELSE TRUE
            END
        )
    """


def _guest_revenue_params(
    year: int | None,
    month: int | None,
    start_date: date | None,
    end_date: date | None,
) -> dict:
    """
    Same mutual-exclusivity validation /new-vs-repeat-visitors already
    applies, plus the standard bind-param shape _checkin_month_filter_sql()
    expects (:year, :month, :start_date, :end_date — no :date, this module
    doesn't support single-day granularity since "revenue for one day"
    isn't a meaningful trend point).
    """
    if month is not None and not 1 <= month <= 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")

    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=400,
            detail="start_date and end_date must be supplied together",
        )

    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")

    return {"year": year, "month": month, "start_date": start_date, "end_date": end_date}


def _validate_guest_status(guest_status: str) -> str:
    normalized = (guest_status or "").strip().capitalize()
    if normalized not in ("New", "Repeat"):
        raise HTTPException(status_code=400, detail="guest_status must be 'New' or 'Repeat'")
    return normalized


# ─────────────────────────────────────────────────────────────────────────
# Shared CTE block: classified stays + villa revenue + amenity revenue +
# a best-effort guest display name, joined into one row per reservation.
# Every endpoint below wraps this with its own outer SELECT/GROUP BY
# rather than duplicating it, so the revenue definition — and now the
# account-level breakdown — can't drift from the trend/summary numbers.
# ─────────────────────────────────────────────────────────────────────────
def _guest_revenue_cte_sql() -> str:
    return """
        WITH guest_first_stay AS (
            -- Computed over ALL history, unfiltered — a guest's first
            -- stay must not depend on which date range is requested.
            SELECT member_number, MIN(check_in_date) AS first_check_in
            FROM rooms
            WHERE check_in_date IS NOT NULL
              AND member_number IS NOT NULL
            GROUP BY member_number
        ),
        classified_stays AS (
            SELECT
                r.confirmation_code AS conf_code,
                r.member_number,
                r.check_in_date,
                CASE
                    WHEN r.check_in_date = gfs.first_check_in THEN 'New'
                    ELSE 'Repeat'
                END AS guest_status
            FROM rooms r
            JOIN guest_first_stay gfs ON gfs.member_number = r.member_number
            WHERE r.check_in_date IS NOT NULL
        ),
        rd_keyed AS (
            -- Same dedup as finance_backend.py's _villa_gross_revenue_cte_sql():
            -- rate_details is nightly-grain (one row per reservation per
            -- rate_date) and repeats total_rental on every night, so this
            -- collapses each reservation to one row before summing.
            SELECT
                rd.total_rental,
                rd.rate_date,
                COALESCE(NULLIF(TRIM(rd.reservation_id), ''), NULLIF(TRIM(rd.conf_code), '')) AS res_key,
                NULLIF(TRIM(rd.conf_code), '') AS conf_code
            FROM rate_details rd
            WHERE rd.payment_type = 'Paid'
              AND rd.status = 'Posted'
              AND rd.villa_name IS NOT NULL
              AND rd.villa_name <> 'ZZ Comp'
        ),
        villa_revenue AS (
            SELECT DISTINCT ON (res_key)
                conf_code,
                total_rental AS villa_revenue
            FROM rd_keyed
            WHERE res_key IS NOT NULL
              AND conf_code IS NOT NULL
            ORDER BY res_key, rate_date
        ),
        amenity_revenue AS (
            -- 'collected' only — real charges, excluding comps/free
            -- (payment_type match), reversals, and non-charge rows
            -- (payments, adjustments). Villa excluded from
            -- transaction_category so this can't double-count
            -- villa_revenue above.
            SELECT
                f.conf_code,
                SUM(f.amount) AS amenity_revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.transaction_category IS NOT NULL
              AND f.transaction_category NOT IN ('Villa', 'Laundry')
              AND f.transaction_flow = 'Charge'
              AND LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), '')) NOT SIMILAR TO
                  '%(comp|free|complimentary|gratis|no charge)%'
            GROUP BY f.conf_code
        ),
        guest_names AS (
            -- Per-reservation display name, sourced from folios (`rooms`
            -- has no guest_name column at all) — the most recent folio
            -- row for that conf_code. This can be blank/missing for a
            -- reservation with no matching folio row, or one whose folio
            -- rows never had guest_name populated.
            SELECT DISTINCT ON (conf_code)
                conf_code,
                guest_name
            FROM folios
            WHERE conf_code IS NOT NULL
              AND guest_name IS NOT NULL
              AND TRIM(guest_name) <> ''
            ORDER BY conf_code, transaction_date DESC NULLS LAST
        ),
        reservation_revenue AS (
            SELECT
                cs.conf_code,
                cs.member_number,
                cs.check_in_date,
                cs.guest_status,
                -- Prefer the folio's guest_name (can reflect the actual
                -- person who stayed — a spouse, dependent, etc.) and fall
                -- back to the account holder's name from `members` when
                -- that's blank. This join is safe on member_number
                -- directly: unlike folios.member_number (a different ID
                -- scheme — see JOIN KEY note above), members.member_number
                -- uses the SAME scheme as rooms.member_number, confirmed
                -- by analytics_demographics.py's new-vs-repeat-visitors
                -- endpoint already joining `members m ON m.member_number =
                -- r.member_number` directly against rooms — no bridging
                -- needed here either.
                COALESCE(
                    gn.guest_name,
                    NULLIF(TRIM(mem.member_full_name), ''),
                    NULLIF(TRIM(mem.member_name), '')
                ) AS guest_name,
                COALESCE(vr.villa_revenue, 0) + COALESCE(ar.amenity_revenue, 0) AS total_revenue
            FROM classified_stays cs
            LEFT JOIN villa_revenue   vr  ON vr.conf_code = cs.conf_code
            LEFT JOIN amenity_revenue ar  ON ar.conf_code = cs.conf_code
            LEFT JOIN guest_names     gn  ON gn.conf_code = cs.conf_code
            LEFT JOIN members         mem ON mem.member_number = cs.member_number
        )
    """


# ─────────────────────────────────────────────────────────────────────────
# GET /guest-revenue/new-vs-repeat
#
# Monthly trend: one row per (year, month) with New/Repeat revenue,
# stay counts, and each segment's average revenue per stay. Always
# bucketed by month (never year-only), per the "revenue by month"
# request — year/start_date/end_date only control which months are
# INCLUDED, not the bucket size.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/guest-revenue/new-vs-repeat")
def guest_revenue_new_vs_repeat(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    params = _guest_revenue_params(year, month, start_date, end_date)

    trend_rows = rows(
        db,
        f"""
        {_guest_revenue_cte_sql()}
        SELECT
            EXTRACT(YEAR FROM rr.check_in_date)::int  AS year,
            EXTRACT(MONTH FROM rr.check_in_date)::int AS month,
            TO_CHAR(rr.check_in_date, 'Mon YYYY')      AS period_label,

            COALESCE(SUM(rr.total_revenue) FILTER (WHERE rr.guest_status = 'New'), 0)
                AS new_revenue,
            COALESCE(SUM(rr.total_revenue) FILTER (WHERE rr.guest_status = 'Repeat'), 0)
                AS repeat_revenue,

            COUNT(*) FILTER (WHERE rr.guest_status = 'New')    AS new_stays,
            COUNT(*) FILTER (WHERE rr.guest_status = 'Repeat') AS repeat_stays,

            COUNT(DISTINCT rr.member_number) FILTER (WHERE rr.guest_status = 'New')
                AS new_guests,
            COUNT(DISTINCT rr.member_number) FILTER (WHERE rr.guest_status = 'Repeat')
                AS repeat_guests

        FROM reservation_revenue rr
        WHERE 1=1
        {_checkin_month_filter_sql(alias="rr")}
        GROUP BY 1, 2, 3
        ORDER BY 1, 2
        """,
        params,
    )

    out = []
    for r in trend_rows:
        new_rev = float(r["new_revenue"] or 0)
        rep_rev = float(r["repeat_revenue"] or 0)
        total_rev = new_rev + rep_rev
        new_stays = int(r["new_stays"] or 0)
        repeat_stays = int(r["repeat_stays"] or 0)

        out.append({
            "year": r["year"],
            "month": r["month"],
            "periodLabel": r["period_label"],
            "newRevenue": new_rev,
            "repeatRevenue": rep_rev,
            "totalRevenue": total_rev,
            "newStays": new_stays,
            "repeatStays": repeat_stays,
            "newGuests": int(r["new_guests"] or 0),
            "repeatGuests": int(r["repeat_guests"] or 0),
            "avgRevenuePerNewStay": round(new_rev / new_stays, 2) if new_stays else None,
            "avgRevenuePerRepeatStay": round(rep_rev / repeat_stays, 2) if repeat_stays else None,
            "repeatRevenueShare": round(rep_rev / total_rev, 4) if total_rev else None,
        })

    return out


# ─────────────────────────────────────────────────────────────────────────
# GET /guest-revenue/new-vs-repeat/summary
#
# Single-row rollup across the whole requested range — totals and
# averages, the "and averages" half of the email spec. Same filter
# contract as the trend endpoint above so a frontend can call both with
# identical query params.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/guest-revenue/new-vs-repeat/summary")
def guest_revenue_new_vs_repeat_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    params = _guest_revenue_params(year, month, start_date, end_date)

    r = one(
        db,
        f"""
        {_guest_revenue_cte_sql()}
        SELECT
            COALESCE(SUM(rr.total_revenue) FILTER (WHERE rr.guest_status = 'New'), 0)
                AS new_revenue,
            COALESCE(SUM(rr.total_revenue) FILTER (WHERE rr.guest_status = 'Repeat'), 0)
                AS repeat_revenue,

            COUNT(*) FILTER (WHERE rr.guest_status = 'New')    AS new_stays,
            COUNT(*) FILTER (WHERE rr.guest_status = 'Repeat') AS repeat_stays,

            COUNT(DISTINCT rr.member_number) FILTER (WHERE rr.guest_status = 'New')
                AS new_guests,
            COUNT(DISTINCT rr.member_number) FILTER (WHERE rr.guest_status = 'Repeat')
                AS repeat_guests,

            MIN(rr.check_in_date) AS earliest_check_in,
            MAX(rr.check_in_date) AS latest_check_in

        FROM reservation_revenue rr
        WHERE 1=1
        {_checkin_month_filter_sql(alias="rr")}
        """,
        params,
    )

    new_rev = float(r.get("new_revenue") or 0)
    rep_rev = float(r.get("repeat_revenue") or 0)
    total_rev = new_rev + rep_rev
    new_stays = int(r.get("new_stays") or 0)
    repeat_stays = int(r.get("repeat_stays") or 0)
    total_stays = new_stays + repeat_stays

    return {
        "newRevenue": new_rev,
        "repeatRevenue": rep_rev,
        "totalRevenue": total_rev,
        "newStays": new_stays,
        "repeatStays": repeat_stays,
        "totalStays": total_stays,
        "newGuests": int(r.get("new_guests") or 0),
        "repeatGuests": int(r.get("repeat_guests") or 0),
        "avgRevenuePerNewStay": round(new_rev / new_stays, 2) if new_stays else None,
        "avgRevenuePerRepeatStay": round(rep_rev / repeat_stays, 2) if repeat_stays else None,
        "avgRevenuePerStay": round(total_rev / total_stays, 2) if total_stays else None,
        "repeatRevenueShare": round(rep_rev / total_rev, 4) if total_rev else None,
        "repeatStayShare": round(repeat_stays / total_stays, 4) if total_stays else None,
        "earliestCheckIn": str(r["earliest_check_in"]) if r.get("earliest_check_in") else None,
        "latestCheckIn": str(r["latest_check_in"]) if r.get("latest_check_in") else None,
    }


# ─────────────────────────────────────────────────────────────────────────
# GET /guest-revenue/new-vs-repeat/accounts
#
# Drilldown from a single bar in the chart (or a single New/Repeat cell
# in the trend table): every guest with a stay in that exact period +
# guest_status, with their revenue for that period. This is what powers
# clicking a bar to see "who are these guests."
#
# guest_status is REQUIRED (there's no "both" option — a bar click is
# always for one segment). Period params work exactly like the trend/
# summary endpoints above (year+month for a specific bar, or
# start_date/end_date for a custom range).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/guest-revenue/new-vs-repeat/accounts")
def guest_revenue_accounts(
    guest_status: str = Query(..., description="'New' or 'Repeat'"),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    status = _validate_guest_status(guest_status)
    params = _guest_revenue_params(year, month, start_date, end_date)
    params["guest_status"] = status

    account_rows = rows(
        db,
        f"""
        {_guest_revenue_cte_sql()}
        SELECT
            rr.member_number,
            MAX(rr.guest_name)          AS guest_name,
            COUNT(*)                    AS stays,
            SUM(rr.total_revenue)       AS total_revenue,
            MIN(rr.check_in_date)       AS first_check_in,
            MAX(rr.check_in_date)       AS last_check_in
        FROM reservation_revenue rr
        WHERE rr.guest_status = :guest_status
        {_checkin_month_filter_sql(alias="rr")}
        GROUP BY rr.member_number
        ORDER BY total_revenue DESC
        """,
        params,
    )

    return [
        {
            "memberNumber": r["member_number"],
            "guestName": r["guest_name"],
            "stays": int(r["stays"] or 0),
            "totalRevenue": float(r["total_revenue"] or 0),
            "firstCheckIn": str(r["first_check_in"]) if r["first_check_in"] else None,
            "lastCheckIn": str(r["last_check_in"]) if r["last_check_in"] else None,
        }
        for r in account_rows
    ]


# ─────────────────────────────────────────────────────────────────────────
# GET /guest-revenue/new-vs-repeat/account/{member_number}/breakdown
#
# For one guest, scoped to the SAME period params used to reach them
# (not their lifetime totals) — where the money in their accounts-list
# row actually came from: Villa rental plus each amenity/service
# category, both as a summary (byCategory) and as individual line items
# (lineItems) for full transparency.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/guest-revenue/new-vs-repeat/account/{member_number}/breakdown")
def guest_revenue_account_breakdown(
    member_number: str,
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    params = _guest_revenue_params(year, month, start_date, end_date)
    params["member_number"] = member_number

    detail_cte = f"""
        {_guest_revenue_cte_sql()},
        villa_detail AS (
            SELECT
                cs.conf_code,
                cs.check_in_date,
                'Villa'::text AS category,
                vr.villa_revenue AS amount,
                'Villa rental for stay'::text AS description
            FROM classified_stays cs
            JOIN villa_revenue vr ON vr.conf_code = cs.conf_code
            WHERE cs.member_number = :member_number
            {_checkin_month_filter_sql(alias="cs")}
        ),
        amenity_detail AS (
            SELECT
                f.conf_code,
                cs.check_in_date,
                f.transaction_category AS category,
                f.amount,
                f.description
            FROM folios f
            JOIN classified_stays cs ON cs.conf_code = f.conf_code
            WHERE cs.member_number = :member_number
              AND f.transaction_category IS NOT NULL
              AND f.transaction_category NOT IN ('Villa', 'Laundry')
              AND f.transaction_flow = 'Charge'
              AND LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), '')) NOT SIMILAR TO
                  '%(comp|free|complimentary|gratis|no charge)%'
            {_checkin_month_filter_sql(alias="cs")}
        )
    """

    # Guest display name + total, scoped to the same period — so this
    # header always matches the row the user clicked in the accounts list.
    header = one(
        db,
        f"""
        {_guest_revenue_cte_sql()}
        SELECT
            MAX(rr.guest_name)    AS guest_name,
            SUM(rr.total_revenue) AS total_revenue,
            COUNT(*)              AS stays
        FROM reservation_revenue rr
        WHERE rr.member_number = :member_number
        {_checkin_month_filter_sql(alias="rr")}
        """,
        params,
    )

    category_rows = rows(
        db,
        f"""
        {detail_cte}
        SELECT category, SUM(amount) AS revenue, COUNT(*) AS line_count
        FROM (
            SELECT category, amount FROM villa_detail
            UNION ALL
            SELECT category, amount FROM amenity_detail
        ) combined
        GROUP BY category
        ORDER BY revenue DESC
        """,
        params,
    )

    line_item_rows = rows(
        db,
        f"""
        {detail_cte}
        SELECT check_in_date, category, description, amount
        FROM (
            SELECT check_in_date, category, description, amount FROM villa_detail
            UNION ALL
            SELECT check_in_date, category, description, amount FROM amenity_detail
        ) combined
        ORDER BY check_in_date DESC
        """,
        params,
    )

    return {
        "memberNumber": member_number,
        "guestName": header.get("guest_name"),
        "totalRevenue": float(header.get("total_revenue") or 0),
        "stays": int(header.get("stays") or 0),
        "byCategory": [
            {
                "category": r["category"],
                "revenue": float(r["revenue"] or 0),
                "lineCount": int(r["line_count"] or 0),
            }
            for r in category_rows
        ],
        "lineItems": [
            {
                "checkInDate": str(r["check_in_date"]) if r["check_in_date"] else None,
                "category": r["category"],
                "description": r["description"],
                "amount": float(r["amount"] or 0),
            }
            for r in line_item_rows
        ],
    }