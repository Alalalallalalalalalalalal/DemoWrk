# postgres/overview_analytics.py
#
# ════════════════════════════════════════════════════════════════════════
# OVERVIEW TAB ANALYTICS — standalone module, owned entirely by the
# Overview tab. Does NOT import from, modify, or depend on
# postgres/analytics.py or postgres/finance_backend.py.
#
# Every endpoint here is mounted under the /overview prefix, and every
# function/variable name is prefixed with `overview_` so it's always
# obvious — in logs, in stack traces, in this file — that it belongs to
# the Overview tab and not the shared analytics or finance code.
#
# Reads from the dedicated `overview_*` SQL views (see overview_views.sql).
# Run overview_views.sql against your Postgres database before using this
# router.
#
# DATE FILTERING (added 2026-06-26): every endpoint below that's tied to a
# booking now accepts the same year / month / date / start_date / end_date
# query params the Finance tab already uses, via filter_params() —
# imported from postgres.analytics_shared, since that module is genuinely
# shared plumbing (no business logic, no route ownership), not one of the
# two files this module promises independence from above. The date-range
# overlap logic itself (overview_date_filter_sql() below) is NOT imported
# from finance_backend.py, in keeping with that independence promise — it's
# a same-logic reimplementation, generalized so one function covers both
# overview_villa_bookings (overview_check_in_date/overview_check_out_date)
# and rate_details_with_discount (check_in_date/check_out_date) instead of
# needing two near-identical copies the way finance_backend.py currently
# does (_villa_bookings_date_filter_sql / _rate_details_date_filter_sql).
#
# NOT date-filtered, on purpose: /member-status, /member-type, /amount-due,
# /amount-due-by-period, /dependents. These describe CURRENT account/
# membership/balance state — there's no booking-stay date to filter them
# against, and "members active as of [date range]" isn't a question this
# data can answer. They stay as whole-portfolio snapshots regardless of
# the period picker.
# ════════════════════════════════════════════════════════════════════════

from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from postgres.database import SessionLocal
from postgres.analytics_shared import filter_params

router = APIRouter()


def overview_get_db():
    """DB session dependency, scoped to the Overview tab router."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def overview_rows(db: Session, sql: str, params: dict | None = None):
    """Run a query expected to return multiple rows, for Overview endpoints."""
    return [dict(row) for row in db.execute(text(sql), params or {}).mappings().all()]


def overview_one(db: Session, sql: str, params: dict | None = None):
    """Run a query expected to return a single row, for Overview endpoints."""
    return dict(db.execute(text(sql), params or {}).mappings().first() or {})


def overview_payment_type_filter_sql(alias: str = "ovb"):
    """
    Returns the SQL fragment that filters overview_villa_bookings (aliased
    as `alias`) by :overview_payment_type, when that bind param is provided.
    Pass NULL for :overview_payment_type to get all rows (Paid + Free + Unknown).
    """
    return f"""
      AND (
        :overview_payment_type IS NULL
        OR {alias}.overview_payment_type = :overview_payment_type
      )
    """


def overview_date_filter_sql(alias="ovb", column="overview_check_in_date", end_column="overview_check_out_date"):
    """
    Date-range OVERLAP filter — "does this booking's stay overlap the
    requested period" — same semantics and priority order as
    finance_backend.py's _villa_bookings_date_filter_sql() /
    _rate_details_date_filter_sql(), generalized into one function via
    alias/column params instead of two near-duplicate ones, since the
    only thing that differs between those two call sites is which
    table/columns they point at:
      - overview_villa_bookings: alias="ovb" (default), columns
        overview_check_in_date / overview_check_out_date (defaults)
      - rate_details_with_discount: alias="rd", column="check_in_date",
        end_column="check_out_date"

    Priority (first matching branch wins, mirrors filter_params()'s
    mutually-exclusive design): start_date/end_date range > exact date >
    year+month > year alone > no filter at all (TRUE, i.e. unrestricted).

    Expects the standard filter_params() bind set already in the params
    dict passed to execute(): :year, :month, :date, :start_date, :end_date.
    """
    d = f"{alias}.{column}"
    out = f"{alias}.{end_column}"
    return f"""
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    {d}   <= COALESCE(:end_date, {d})
                    AND {out} >= COALESCE(:start_date, {out})
                WHEN :date IS NOT NULL THEN
                    {d}   <= :date
                    AND {out} >= :date
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    {d}   <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                    AND {out} >= MAKE_DATE(:year, :month, 1)
                WHEN :year IS NOT NULL THEN
                    {d}   <= MAKE_DATE(:year, 12, 31)
                    AND {out} >= MAKE_DATE(:year, 1, 1)
                ELSE TRUE
            END
        )
    """


# ─────────────────────────────────────────────────────────────────────────
# /overview/available-years
#
# Real distinct years that have actual booking check-ins on file — powers
# the year dropdown in the period filter's Year/Month mode. Unlike the
# Finance tab's current placeholder (just "this year back 6 years",
# hardcoded, since no real endpoint existed yet), this reads the actual
# data, so a property with 10 years of history shows 10 years, and a
# brand-new one doesn't show 6 years of empty options.
#
# Added 2026-06-26.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/available-years")
def overview_available_years(db: Session = Depends(overview_get_db)):
    rows_ = overview_rows(db, """
        SELECT DISTINCT EXTRACT(YEAR FROM overview_check_in_date)::int AS year
        FROM overview_villa_bookings
        WHERE overview_check_in_date IS NOT NULL
        ORDER BY year DESC
    """)
    return [r["year"] for r in rows_]


# ─────────────────────────────────────────────────────────────────────────
# /overview/villa-amenity-revenue
#
# Ranks villas by AMENITY revenue (commissary, golf, wine, transportation,
# etc. — everything that is NOT the villa rental charge itself) generated
# during stays at that villa. This is intentionally different from
# /overview/villa-stats, which ranks villas by RENTAL revenue.
#
# Sourced from overview_transaction_lines (overview_line_category =
# 'Amenity', overview_line_status = 'Paid' only). Joined to
# overview_booking_meta (LEFT JOIN, so a transaction line whose booking
# is for some reason missing from overview_booking_meta still shows up
# rather than silently vanishing) purely to support the date-range filter
# below — overview_transaction_lines itself carries no date column.
# overview_booking_meta, not overview_villa_bookings, deliberately: the
# latter computes overview_villa_revenue internally by querying
# overview_transaction_lines AGAIN, so joining to it here would have
# silently doubled the cost of the single most expensive view in this
# file, just to read two date columns this endpoint never otherwise needs.
#
# Query params:
#   overview_payment_type — 'Paid' or 'Free' to filter by booking-level
#                            villa payment type server-side; omit for both
#                            combined.
#   year / month / date / start_date / end_date — standard date-range
#                            filter (added 2026-06-26), applied against
#                            the booking's check-in/check-out dates.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/villa-amenity-revenue")
def overview_villa_amenity_revenue(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            otl.overview_villa_name                                AS villa_name,
            otl.overview_booking_payment_type                       AS villa_payment_type,
            COALESCE(SUM(otl.overview_net_amount), 0)              AS amenity_revenue,
            COUNT(*)                                                AS amenity_transactions,
            COUNT(DISTINCT otl.overview_conf_code)                   AS bookings
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_category = 'Amenity'
          AND otl.overview_line_status = 'Paid'
          AND otl.overview_villa_name IS NOT NULL
          AND (
            :overview_payment_type IS NULL
            OR otl.overview_booking_payment_type = :overview_payment_type
          )
          {overview_date_filter_sql("ovb")}
        GROUP BY otl.overview_villa_name, otl.overview_booking_payment_type
        ORDER BY amenity_revenue DESC
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/villa-stats
#
# One row per villa + bedroom_count + payment_type. The frontend can filter
# client-side by overview_payment_type ('Paid' / 'Free' / 'Unknown') and
# re-aggregate across bedroom_count if it wants one row per villa.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/villa-stats")
def overview_villa_stats(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            overview_villa_name                                AS villa_name,
            overview_bedroom_count                              AS bedroom_count,
            overview_payment_type AS villa_payment_type,
            COUNT(*)                                            AS bookings,
            SUM(overview_nights)                                AS total_nights,
            ROUND(AVG(overview_nights)::numeric, 1)             AS avg_stay,
            COUNT(DISTINCT overview_member_number)               AS unique_members,
            SUM(overview_persons)                                AS total_guests,
            ROUND(AVG(overview_persons)::numeric, 1)            AS avg_party_size,
            SUM(overview_villa_revenue)                          AS revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
        GROUP BY overview_villa_name, overview_bedroom_count, overview_payment_type
        ORDER BY bookings DESC, overview_villa_name, overview_bedroom_count NULLS LAST
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/bookings-by-bedroom
#
# Bookings + avg stay grouped by bedroom count and payment type.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/bookings-by-bedroom")
def overview_bookings_by_bedroom(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            overview_bedroom_count                  AS beds,
            overview_payment_type AS villa_payment_type,
            COUNT(*)                                 AS bookings,
            SUM(overview_nights)                     AS total_nights,
            ROUND(AVG(overview_nights)::numeric, 1)  AS avg_stay
        FROM overview_villa_bookings ovb
        WHERE overview_bedroom_count IS NOT NULL
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
        GROUP BY overview_bedroom_count, overview_payment_type
        ORDER BY overview_bedroom_count
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/monthly-revenue
#
# Revenue + bookings grouped by check-in month and payment type. NOTE:
# this query's own month-grouping is unaffected by the year/month date
# filter below — that filter narrows WHICH bookings are included (e.g.
# "only 2025"), while the GROUP BY here still breaks the result into 12
# (or fewer) monthly rows, same as before.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/monthly-revenue")
def overview_monthly_revenue(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            TO_CHAR(overview_check_in_date, 'Mon')           AS month,
            EXTRACT(MONTH FROM overview_check_in_date)::int   AS month_num,
            overview_payment_type AS villa_payment_type,
            COUNT(*)                                           AS bookings,
            COALESCE(SUM(overview_villa_revenue), 0)           AS revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
        GROUP BY month, month_num, overview_payment_type
        ORDER BY month_num
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/monthly-revenue-by-category
#
# Like /overview/monthly-revenue, but TRANSACTION-level and split by
# Villa vs Amenity (overview_line_category), instead of booking-level
# villa-rental-only revenue. Powers the stacked Villa/Amenity bars on the
# "Revenue by month" card.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/monthly-revenue-by-category")
def overview_monthly_revenue_by_category(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            TO_CHAR(ovb.overview_check_in_date, 'Mon')        AS month,
            EXTRACT(MONTH FROM ovb.overview_check_in_date)::int AS month_num,
            ovb.overview_payment_type                          AS villa_payment_type,
            otl.overview_line_category                         AS line_category,
            COALESCE(SUM(otl.overview_net_amount), 0)          AS revenue,
            COUNT(*)                                            AS transactions,
            COUNT(DISTINCT otl.overview_conf_code)               AS bookings
        FROM overview_transaction_lines otl
        JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'Paid'
          AND ovb.overview_check_in_date IS NOT NULL
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
        GROUP BY month, month_num, ovb.overview_payment_type, otl.overview_line_category
        ORDER BY month_num
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/visits-summary
#
# total_bookings, total_members_booked, and total_guests_booked are ALL
# COUNT(*) — every one of them counts BOOKINGS (reservations), not
# distinct people. total_members_booked + total_guests_booked therefore
# always equals total_bookings exactly.
#
# (Changed 2026-06-26 from COUNT(DISTINCT member_number) — that version
# counted each person once even if they booked more than once, which
# meant the three numbers didn't visibly add up and needed a separate
# "repeat bookings" figure to reconcile them. Counting bookings instead
# of people removes the need for that entirely. If you need a distinct-
# person count specifically, see overview_villa_stats's unique_members or
# the member-vs-guest-revenue endpoints' uniqueAccounts — those are
# unaffected by this change.)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary")
def overview_visits_summary(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_one(db, f"""
        SELECT
            COUNT(*)                                              AS total_bookings,
            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,

            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,

            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/visits-summary-by-payment-type
#
# Convenience endpoint: returns the overall totals AND the Paid/Free/Unknown
# breakdown in one call, so the frontend doesn't need 3 separate requests
# just to populate the "Overall / Paid Villa / Free Villa" toggle.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary-by-payment-type")
def overview_visits_summary_by_payment_type(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)

    overview_overall_summary = overview_one(db, f"""
        SELECT
            COUNT(*)                                              AS total_bookings,
            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,
            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,
            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_date_filter_sql("ovb")}
    """, params)

    overview_summary_by_type = overview_rows(db, f"""
        SELECT
            overview_payment_type AS villa_payment_type,
            COUNT(*)                                              AS total_bookings,
            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,
            COUNT(*) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,
            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_date_filter_sql("ovb")}
        GROUP BY overview_payment_type
    """, params)

    return {
        **overview_overall_summary,
        "by_payment_type": overview_summary_by_type,
    }


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-status
#
# Active/Inactive (etc) account counts, split by member vs guest. NOT
# date-filtered — see module docstring at the top of this file for why.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-status")
def overview_member_status(db: Session = Depends(overview_get_db)):
    return overview_rows(db, """
        SELECT
            overview_status    AS status,
            overview_members   AS members,
            overview_guests    AS guests,
            overview_total     AS total
        FROM overview_member_status
        ORDER BY overview_total DESC
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-type
#
# Account counts grouped by member_type (Regular, Honorary, Guests, etc).
# NOT date-filtered — see module docstring at the top of this file.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-type")
def overview_member_type(db: Session = Depends(overview_get_db)):
    return overview_rows(db, """
        SELECT
            overview_member_type   AS member_type,
            overview_total         AS total
        FROM overview_member_type
        ORDER BY overview_total DESC
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/amount-due
#
# Single-row rollup of total outstanding dues across all members. NOT
# date-filtered — see module docstring at the top of this file.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/amount-due")
def overview_amount_due(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT overview_total_amount_due AS total_amount_due
        FROM overview_statements_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/amount-due-by-period
#
# Outstanding dues grouped by statement period. NOT date-filtered by the
# Overview period picker — see module docstring at the top of this file
# (this already has its OWN "period" dimension, statement_period, which
# is a different concept from the booking-date filter everything else
# here uses).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/amount-due-by-period")
def overview_amount_due_by_period(db: Session = Depends(overview_get_db)):
    return overview_rows(db, """
        SELECT
            overview_statement_period  AS statement_period,
            overview_total             AS total
        FROM overview_statements_by_period
        ORDER BY overview_statement_period
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/dependents
#
# Single-row rollup of total dependents on file. NOT date-filtered — see
# module docstring at the top of this file.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/dependents")
def overview_dependents(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT overview_total_dependents AS total_dependents
        FROM overview_dependents_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-vs-guest-revenue
#
# Villa revenue split by customerType ('Member' / 'Guests') AND by
# overview_payment_type ('Paid' / 'Free' / 'Unknown'), so the frontend's
# "Member vs guest revenue" card and its Paid/Free toggle both work off
# one endpoint.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-vs-guest-revenue")
def overview_member_vs_guest_revenue(
    overview_payment_type: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_payment_type"] = overview_payment_type
    return overview_rows(db, f"""
        SELECT
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                  AS "customerType",
            overview_payment_type AS villa_payment_type,
            COALESCE(SUM(overview_villa_revenue), 0)             AS revenue,
            COUNT(*)                                              AS transactions,
            COUNT(DISTINCT overview_member_number)                AS "uniqueAccounts"
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_payment_type_filter_sql("ovb")}
          {overview_date_filter_sql("ovb")}
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            overview_payment_type
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-vs-guest-revenue-by-payment-type
#
# Convenience endpoint: returns member-vs-guest revenue for ALL payment
# types in one call, pre-grouped by overview_payment_type, so the frontend
# can switch the Paid/Free/Overall toggle without refetching.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-vs-guest-revenue-by-payment-type")
def overview_member_vs_guest_revenue_by_payment_type(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)

    overview_overall_rows = overview_rows(db, f"""
        SELECT
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                  AS "customerType",
            COALESCE(SUM(overview_villa_revenue), 0)             AS revenue,
            COUNT(*)                                              AS transactions,
            COUNT(DISTINCT overview_member_number)                AS "uniqueAccounts"
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_date_filter_sql("ovb")}
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END
    """, params)

    overview_rows_with_type = overview_rows(db, f"""
        SELECT
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                  AS "customerType",
            overview_payment_type AS villa_payment_type,
            COALESCE(SUM(overview_villa_revenue), 0)             AS revenue,
            COUNT(*)                                              AS transactions,
            COUNT(DISTINCT overview_member_number)                AS "uniqueAccounts"
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_date_filter_sql("ovb")}
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            overview_payment_type
    """, params)

    overview_by_type: dict[str, list] = {}
    for row in overview_rows_with_type:
        key = row["villa_payment_type"]
        overview_by_type.setdefault(key, []).append(row)

    return {
        "overall": overview_overall_rows,
        "by_payment_type": overview_by_type,
    }


# ─────────────────────────────────────────────────────────────────────────
# /overview/transaction-finance-summary
#
# TRANSACTION-LEVEL Paid/Free finance summary, sourced from
# overview_transaction_lines (NOT overview_villa_bookings). LEFT JOINed to
# overview_booking_meta (the lightweight booking-dates view, not
# overview_villa_bookings — see /overview/villa-amenity-revenue's
# docstring for why) purely for the date-range filter.
#
# Returns one row per (overview_line_category, overview_line_status)
# combination, e.g.:
#   Villa   / Paid  -> revenue, transaction count
#   Villa   / Free  -> revenue (always 0 by definition), transaction count
#   Amenity / Paid  -> revenue, transaction count
#   Amenity / Free  -> revenue (always 0), transaction count
#   (Anomaly, Reversed, AND CashAdvance rows are EXCLUDED here on purpose
#    — see /overview/reversals-summary and /overview/cash-advance-summary
#    for where those are reported instead.)
#
# Query params:
#   overview_line_status   — 'Paid' or 'Free' to filter server-side;
#                             omit for both combined.
#   year / month / date / start_date / end_date — standard date-range
#                             filter (added 2026-06-26).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-finance-summary")
def overview_transaction_finance_summary(
    overview_line_status: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_line_status"] = overview_line_status
    return overview_rows(db, f"""
        SELECT
            otl.overview_line_category                          AS line_category,
            otl.overview_line_status                             AS line_status,
            COUNT(*)                                              AS transaction_count,
            COALESCE(SUM(otl.overview_net_amount), 0)             AS total_amount
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status IN ('Paid', 'Free')
          AND (
            :overview_line_status IS NULL
            OR otl.overview_line_status = :overview_line_status
          )
          {overview_date_filter_sql("ovb")}
        GROUP BY otl.overview_line_category, otl.overview_line_status
        ORDER BY otl.overview_line_category, otl.overview_line_status
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/reversals-summary
#
# Single-row rollup of charges that were fully charged-then-reversed in a
# clean, mutually-unique pair (see overview_views.sql's docstring on the
# 'Reversed' status in overview_transaction_lines for exactly what
# qualifies and why). These are excluded from every Paid/Free total
# elsewhere on the Overview tab — net cost to the guest was $0 — so this
# is the one place the gross reversed amount is still visible.
#
# Queries overview_transaction_lines directly (LEFT JOINed to the
# lightweight overview_booking_meta for the date filter, NOT
# overview_villa_bookings — see /overview/villa-amenity-revenue's
# docstring for why) rather than the overview_reversals_summary VIEW,
# since plain SQL views can't take bind parameters — date filtering
# needs to happen at query time, in Python, same as every other filtered
# endpoint in this file.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/reversals-summary")
def overview_reversals_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    return overview_one(db, f"""
        SELECT
            COUNT(*)                                  AS reversed_count,
            COALESCE(SUM(otl.overview_net_amount), 0) AS reversed_total
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'Reversed'
          AND otl.overview_net_amount > 0
          {overview_date_filter_sql("ovb")}
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/cash-advance-summary
#
# Single-row rollup of cash advance lines (any line whose description
# mentions "cash advance" — see overview_views.sql's docstring on the
# 'CashAdvance' status). Cash handed to a guest and billed to their folio
# isn't product/service revenue, so these are excluded from every
# Paid/Free/Amenity total elsewhere on the Overview tab — this is the one
# place the net cash-advance total is still visible.
#
# Queries overview_transaction_lines directly (see /overview/reversals-
# summary's docstring for why, same reasoning) rather than the
# overview_cash_advance_summary VIEW.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/cash-advance-summary")
def overview_cash_advance_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    return overview_one(db, f"""
        SELECT
            COUNT(*)                                  AS cash_advance_count,
            COALESCE(SUM(otl.overview_net_amount), 0) AS cash_advance_total
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'CashAdvance'
          {overview_date_filter_sql("ovb")}
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/anomalies-summary
#
# Single-row rollup of the 'Anomaly' lines — credits/refunds that
# couldn't be matched to a charge cleanly enough to call them 'Reversed'
# (either ambiguous: multiple same-amount candidates in the booking, or no
# match at all). Already excluded from every Paid/Free revenue total
# elsewhere on the Overview tab; this is the one place the total is
# visible, the same pattern as /overview/reversals-summary and
# /overview/cash-advance-summary — including querying
# overview_transaction_lines directly for the same reason (views can't
# take bind params).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/anomalies-summary")
def overview_anomalies_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    return overview_one(db, f"""
        SELECT
            COUNT(*)                                  AS anomaly_count,
            COALESCE(SUM(otl.overview_net_amount), 0) AS anomaly_total
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'Anomaly'
          {overview_date_filter_sql("ovb")}
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/anomalies
#
# The individual 'Anomaly' lines themselves — one row per line-item, for
# a reviewable table (not just the rolled-up total from
# /overview/anomalies-summary above). Sorted most-negative first, since
# the biggest unexplained credits are the most worth a human's attention.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/anomalies")
def overview_anomalies(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    return overview_rows(db, f"""
        SELECT
            otl.overview_conf_code        AS conf_code,
            otl.overview_villa_name       AS villa_name,
            otl.overview_line_description AS description,
            otl.overview_line_category    AS line_category,
            otl.overview_net_amount       AS net_amount
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'Anomaly'
          {overview_date_filter_sql("ovb")}
        ORDER BY otl.overview_net_amount ASC
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/transaction-member-vs-guest-revenue
#
# revenue (net_amount summed) is unchanged — still $0 for every Free row,
# as it should be: that's the actual cost to the guest. valueGivenAway is
# the gross pre-reversal amount summed instead — the only place that
# "what was given away" survives for Free rows, since net_amount can't
# show it. The frontend uses valueGivenAway (negated) as the displayed
# figure specifically when the Free pill is selected, and leaves the
# Overall/Paid views reading from revenue as before — see
# applyLineStatusFilter in OverviewTab.jsx.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-member-vs-guest-revenue")
def overview_transaction_member_vs_guest_revenue(
    overview_line_status: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_line_status"] = overview_line_status
    return overview_rows(db, f"""
        SELECT
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                AS "customerType",
            otl.overview_line_status                           AS line_status,
            COALESCE(SUM(otl.overview_net_amount), 0)          AS revenue,
            COALESCE(SUM(otl.overview_gross_charged_amount), 0) AS "valueGivenAway",
            COUNT(*)                                            AS transactions,
            COUNT(DISTINCT otl.overview_conf_code)               AS "uniqueAccounts"
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status IN ('Paid', 'Free')
          AND (
            :overview_line_status IS NULL
            OR otl.overview_line_status = :overview_line_status
          )
          {overview_date_filter_sql("ovb")}
        GROUP BY
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            otl.overview_line_status
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/transaction-member-vs-guest-revenue-by-category
#
# Same shape as /overview/transaction-member-vs-guest-revenue, but also
# split by category — powers the stacked Villa/Amenity/Membership bar on
# the "Member vs guest revenue" card (matching the convention already
# used by "Revenue by month").
#
# line_category here is a 3-way split (Villa / Amenity / Membership),
# NOT the same thing as overview_line_category on overview_transaction_lines
# (which only ever has Villa / Amenity). 'Membership' is carved out of
# what would otherwise be 'Amenity' specifically for this card — any line
# whose description starts with "Temp Membership Fee" (the per-stay fee
# charged to non-member guests for temporary club access during their
# visit; first surfaced during the amenity-categorization audit on
# 2026-06-25: 111 charges, $65,299). Added 2026-06-26 per request,
# deliberately scoped to ONLY this endpoint/card — overview_line_category
# itself, and every other card that reads it (Top villas by revenue,
# Finance at a glance, Revenue by month, etc.), is unchanged, so this
# doesn't shift any other number on the page.
#
# Deliberately kept as a SEPARATE endpoint rather than adding this
# breakdown to the existing one's GROUP BY: the existing endpoint's
# transactions/uniqueAccounts feed the card's headline numbers, and
# summing uniqueAccounts across categories for the same customerType
# would double-count anyone with more than one kind of charge. This
# endpoint exists only to drive the bar's category proportions; the
# headline totals keep coming from the original endpoint unchanged.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-member-vs-guest-revenue-by-category")
def overview_transaction_member_vs_guest_revenue_by_category(
    overview_line_status: str | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    params["overview_line_status"] = overview_line_status
    card_category_case = """
        CASE
            WHEN otl.overview_line_category = 'Villa' THEN 'Villa'
            WHEN otl.overview_line_description ILIKE 'Temp Membership Fee%' THEN 'Membership'
            ELSE 'Amenity'
        END
    """
    return overview_rows(db, f"""
        SELECT
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                AS "customerType",
            {card_category_case}                               AS line_category,
            otl.overview_line_status                           AS line_status,
            COALESCE(SUM(otl.overview_net_amount), 0)          AS revenue,
            COALESCE(SUM(otl.overview_gross_charged_amount), 0) AS "valueGivenAway"
        FROM overview_transaction_lines otl
        LEFT JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status IN ('Paid', 'Free')
          AND (
            :overview_line_status IS NULL
            OR otl.overview_line_status = :overview_line_status
          )
          {overview_date_filter_sql("ovb")}
        GROUP BY
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            {card_category_case},
            otl.overview_line_status
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/villa-rack-rate-free
#
# For FREE villa bookings only: total rack rate (full list price) of the
# nights given away, per villa, plus how many free bookings that covers.
# Not money collected — see overview_villa_rack_rate_free's docstring in
# overview_views.sql, including the note on the one Wonderland-style
# exception (a Free-tagged booking actually charged at or above rack
# rate) and why that's handled in OverviewTab.jsx rather than here.
#
# Reads rate_details_with_discount directly — that table carries its OWN
# check_in_date / check_out_date columns, so the date filter is applied
# right against this table (alias "rd", per overview_date_filter_sql()'s
# generalized alias/column params), with no join needed, unlike every
# other endpoint above.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/villa-rack-rate-free")
def overview_villa_rack_rate_free(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    params = filter_params(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    has_filter = any(v is not None for v in params.values())

    if not has_filter:
        # No date filter active — use the pre-built view as before (cheap,
        # and matches every prior behavior exactly).
        return overview_rows(db, """
            SELECT
                overview_villa_name      AS villa_name,
                overview_rack_rate_total AS rack_rate_total,
                overview_free_bookings   AS free_bookings
            FROM overview_villa_rack_rate_free
            ORDER BY rack_rate_total DESC
        """)

    return overview_rows(db, f"""
        SELECT
            rd.villa_name                       AS villa_name,
            COALESCE(SUM(rd.rack_rate), 0)       AS rack_rate_total,
            COUNT(DISTINCT rd.conf_code)         AS free_bookings
        FROM rate_details_with_discount rd
        WHERE rd.payment_type = 'Free'
          AND rd.villa_name IS NOT NULL
          {overview_date_filter_sql("rd", "check_in_date", "check_out_date")}
        GROUP BY rd.villa_name
        ORDER BY rack_rate_total DESC
    """, params)


# ─────────────────────────────────────────────────────────────────────────
# /overview/summary
#
# One-call bundle of everything the Overview tab needs, so the frontend
# only needs a single fetch on page load. Accepts the same year / month /
# date / start_date / end_date params as the individual endpoints and
# threads them through to every date-aware sub-call; the snapshot
# endpoints (member-status, member-type, amount-due, amount-due-by-
# period, dependents) ignore them, per the module docstring at the top of
# this file.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/summary")
def overview_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    date_kwargs = dict(year=year, month=month, date=date, start_date=start_date, end_date=end_date)
    return {
        "overviewMemberStatus": overview_member_status(db=db),
        "overviewMemberType": overview_member_type(db=db),
        "overviewAmountDue": overview_amount_due(db=db),
        "overviewAmountDueByPeriod": overview_amount_due_by_period(db=db),
        "overviewDependents": overview_dependents(db=db),
        "overviewVillaStats": overview_villa_stats(overview_payment_type=None, **date_kwargs, db=db),
        "overviewBookingsByBedroom": overview_bookings_by_bedroom(overview_payment_type=None, **date_kwargs, db=db),
        "overviewMonthlyRevenue": overview_monthly_revenue(overview_payment_type=None, **date_kwargs, db=db),
        "overviewVisitsSummary": overview_visits_summary_by_payment_type(**date_kwargs, db=db),
        "overviewMemberVsGuestRevenue": overview_member_vs_guest_revenue(overview_payment_type=None, **date_kwargs, db=db),
        "overviewTransactionFinanceSummary": overview_transaction_finance_summary(overview_line_status=None, **date_kwargs, db=db),
        "overviewTransactionMemberVsGuestRevenue": overview_transaction_member_vs_guest_revenue(overview_line_status=None, **date_kwargs, db=db),
        "overviewTransactionMemberVsGuestRevenueByCategory": overview_transaction_member_vs_guest_revenue_by_category(overview_line_status=None, **date_kwargs, db=db),
        "overviewVillaAmenityRevenue": overview_villa_amenity_revenue(overview_payment_type=None, **date_kwargs, db=db),
        "overviewMonthlyRevenueByCategory": overview_monthly_revenue_by_category(overview_payment_type=None, **date_kwargs, db=db),
        "overviewReversalsSummary": overview_reversals_summary(**date_kwargs, db=db),
        "overviewCashAdvanceSummary": overview_cash_advance_summary(**date_kwargs, db=db),
        "overviewAnomaliesSummary": overview_anomalies_summary(**date_kwargs, db=db),
        "overviewAnomalies": overview_anomalies(**date_kwargs, db=db),
        "overviewVillaRackRateFree": overview_villa_rack_rate_free(**date_kwargs, db=db),
    }