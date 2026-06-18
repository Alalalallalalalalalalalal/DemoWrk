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
# To wire this into the app later (not done yet, per your request to keep
# it isolated until you're ready to integrate):
#
#   from postgres.overview_analytics import router as overview_router
#   app.include_router(overview_router, prefix="/overview", tags=["Overview"])
# ════════════════════════════════════════════════════════════════════════

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from postgres.database import SessionLocal

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


# ─────────────────────────────────────────────────────────────────────────
# /overview/villa-amenity-revenue
#
# Ranks villas by AMENITY revenue (commissary, golf, wine, transportation,
# etc. — everything that is NOT the villa rental charge itself) generated
# during stays at that villa. This is intentionally different from
# /overview/villa-stats, which ranks villas by RENTAL revenue.
#
# Sourced from overview_transaction_lines (overview_line_category =
# 'Amenity', overview_line_status = 'Paid' only — Free/comped amenity
# lines net to $0 by definition, so they'd contribute nothing to a
# revenue ranking regardless). Each row carries villa_payment_type — the
# BOOKING-level Paid/Free villa-stay type — alongside it, the same way
# /overview/villa-stats does, so the frontend can either use the combined
# rows directly (client-side filtering, consistent with every other card
# on the Overview tab) or call this endpoint with ?overview_payment_type=
# to have the server filter instead.
#
# Query params:
#   overview_payment_type — 'Paid' or 'Free' to filter by booking-level
#                            villa payment type server-side; omit for both
#                            combined (each row still carries its own
#                            villa_payment_type for client-side filtering).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/villa-amenity-revenue")
def overview_villa_amenity_revenue(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    return overview_rows(db, """
        SELECT
            overview_villa_name                                AS villa_name,
            overview_booking_payment_type                       AS villa_payment_type,
            COALESCE(SUM(overview_net_amount), 0)              AS amenity_revenue,
            COUNT(*)                                            AS amenity_transactions,
            COUNT(DISTINCT overview_conf_code)                   AS bookings
        FROM overview_transaction_lines
        WHERE overview_line_category = 'Amenity'
          AND overview_line_status = 'Paid'
          AND overview_villa_name IS NOT NULL
          AND (
            :overview_payment_type IS NULL
            OR overview_booking_payment_type = :overview_payment_type
          )
        GROUP BY overview_villa_name, overview_booking_payment_type
        ORDER BY amenity_revenue DESC
    """, {"overview_payment_type": overview_payment_type})


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
    db: Session = Depends(overview_get_db),
):
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
        GROUP BY overview_villa_name, overview_bedroom_count, overview_payment_type
        ORDER BY bookings DESC, overview_villa_name, overview_bedroom_count NULLS LAST
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/bookings-by-bedroom
#
# Bookings + avg stay grouped by bedroom count and payment type.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/bookings-by-bedroom")
def overview_bookings_by_bedroom(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
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
        GROUP BY overview_bedroom_count, overview_payment_type
        ORDER BY overview_bedroom_count
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/monthly-revenue
#
# Revenue + bookings grouped by check-in month and payment type.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/monthly-revenue")
def overview_monthly_revenue(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
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
        GROUP BY month, month_num, overview_payment_type
        ORDER BY month_num
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/monthly-revenue-by-category
#
# Like /overview/monthly-revenue, but TRANSACTION-level and split by
# Villa vs Amenity (overview_line_category), instead of booking-level
# villa-rental-only revenue. Powers the stacked Villa/Amenity bars on the
# "Revenue by month" card.
#
# Month is attributed from the booking's check-in date (joined from
# overview_villa_bookings), the same convention /overview/monthly-revenue
# already uses — overview_transaction_lines itself has no date column,
# since individual amenity charges can land on any day of a multi-day
# stay and there's no single "transaction date" that's more meaningful
# than check-in month for a monthly rollup.
#
# Only Paid lines are summed (Free/comped lines are $0 by definition, see
# overview_transaction_lines's docstring; Anomaly lines are excluded the
# same way they are everywhere else on the Overview tab).
#
# Query params:
#   overview_payment_type — 'Paid' or 'Free' to filter by booking-level
#                            villa payment type; omit for both combined
#                            (each row still carries villa_payment_type
#                            for client-side filtering, same pattern as
#                            /overview/villa-amenity-revenue).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/monthly-revenue-by-category")
def overview_monthly_revenue_by_category(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
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
        JOIN overview_villa_bookings ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status = 'Paid'
          AND ovb.overview_check_in_date IS NOT NULL
          {overview_payment_type_filter_sql("ovb")}
        GROUP BY month, month_num, ovb.overview_payment_type, otl.overview_line_category
        ORDER BY month_num
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/visits-summary
#
# Single rollup of booking counts, stay length, party size, and revenue.
# Pass overview_payment_type to get the Paid-only or Free-only slice;
# omit it (or pass nothing) to get the overall, unfiltered totals.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary")
def overview_visits_summary(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    return overview_one(db, f"""
        SELECT
            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,

            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,

            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings ovb
        WHERE 1=1
          {overview_payment_type_filter_sql("ovb")}
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/visits-summary-by-payment-type
#
# Convenience endpoint: returns the overall totals AND the Paid/Free/Unknown
# breakdown in one call, so the frontend doesn't need 3 separate requests
# just to populate the "Overall / Paid Villa / Free Villa" toggle.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary-by-payment-type")
def overview_visits_summary_by_payment_type(db: Session = Depends(overview_get_db)):
    overview_overall_summary = overview_one(db, """
        SELECT
            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,
            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,
            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings
    """)

    overview_summary_by_type = overview_rows(db, """
        SELECT
            overview_payment_type AS villa_payment_type,
            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Member'
                   OR overview_member_or_guest IS NULL
            )                                                    AS total_members_booked,
            COUNT(DISTINCT overview_member_number) FILTER (
                WHERE overview_member_or_guest = 'Guest'
            )                                                    AS total_guests_booked,
            ROUND(AVG(overview_nights)::numeric, 1)              AS avg_length_of_stay,
            ROUND(AVG(overview_persons)::numeric, 1)             AS avg_party_size,
            COALESCE(SUM(overview_nights), 0)                    AS total_room_nights,
            COALESCE(SUM(overview_villa_revenue), 0)             AS villa_rental_revenue
        FROM overview_villa_bookings
        GROUP BY overview_payment_type
    """)

    return {
        **overview_overall_summary,
        "by_payment_type": overview_summary_by_type,
    }


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-status
#
# Active/Inactive (etc) account counts, split by member vs guest.
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
# Single-row rollup of total outstanding dues across all members.
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
# Outstanding dues grouped by statement period.
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
# Single-row rollup of total dependents on file.
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
#
# NOTE: customerType is deliberately 'Guests' (plural) for the guest row to
# match the exact string OverviewTab.jsx checks for
# (r.customerType === "Guests"), even though the underlying members table
# stores the singular 'Guest' in member_or_guest. This was a pre-existing
# mismatch in the frontend; aliasing it here avoids a silent broken card.
#
# "transactions" = number of bookings (conf_codes) attributed to that
# customer type. "uniqueAccounts" = distinct member_numbers.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-vs-guest-revenue")
def overview_member_vs_guest_revenue(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
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
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            overview_payment_type
    """, {"overview_payment_type": overview_payment_type})


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-vs-guest-revenue-by-payment-type
#
# Convenience endpoint: returns member-vs-guest revenue for ALL payment
# types in one call, pre-grouped by overview_payment_type, so the frontend
# can switch the Paid/Free/Overall toggle without refetching.
#
# Shape:
# {
#   "overall": [ {customerType, revenue, transactions, uniqueAccounts}, ... ],
#   "by_payment_type": {
#       "Paid": [ {customerType, revenue, transactions, uniqueAccounts}, ... ],
#       "Free": [ ... ]
#   }
# }
# ─────────────────────────────────────────────────────────────────────────
@router.get("/member-vs-guest-revenue-by-payment-type")
def overview_member_vs_guest_revenue_by_payment_type(db: Session = Depends(overview_get_db)):
    overview_overall_rows = overview_rows(db, """
        SELECT
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                  AS "customerType",
            COALESCE(SUM(overview_villa_revenue), 0)             AS revenue,
            COUNT(*)                                              AS transactions,
            COUNT(DISTINCT overview_member_number)                AS "uniqueAccounts"
        FROM overview_villa_bookings
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END
    """)

    overview_rows_with_type = overview_rows(db, """
        SELECT
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                  AS "customerType",
            overview_payment_type AS villa_payment_type,
            COALESCE(SUM(overview_villa_revenue), 0)             AS revenue,
            COUNT(*)                                              AS transactions,
            COUNT(DISTINCT overview_member_number)                AS "uniqueAccounts"
        FROM overview_villa_bookings
        GROUP BY
            CASE
                WHEN overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            overview_payment_type
    """)

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
# overview_transaction_lines (NOT overview_villa_bookings). This answers
# "how much was actually paid vs. comped, across both villa rental AND
# amenities, per transaction" — a different and more granular question
# than overview_villa_bookings' booking-level Paid/Free split.
#
# Returns one row per (overview_line_category, overview_line_status)
# combination, e.g.:
#   Villa   / Paid  -> revenue, transaction count
#   Villa   / Free  -> revenue (always 0 by definition), transaction count
#   Amenity / Paid  -> revenue, transaction count
#   Amenity / Free  -> revenue (always 0), transaction count
#   (Anomaly rows are EXCLUDED here on purpose — see the docstring below
#    for why)
#
# Query params:
#   overview_line_status   — 'Paid' or 'Free' to filter server-side;
#                             omit for both combined.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-finance-summary")
def overview_transaction_finance_summary(
    overview_line_status: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    # Anomaly rows are deliberately excluded from this summary. They
    # represent refunds/credits/adjustments that don't cleanly resolve to
    # "guest paid" or "guest didn't pay" (see overview_views.sql for the
    # full reasoning) — including them in a Paid/Free toggle would force
    # them into a bucket they don't actually belong to. They remain queryable
    # directly from overview_transaction_lines for anyone who wants to
    # audit them, just not folded into this summary.
    return overview_rows(db, """
        SELECT
            overview_line_category                          AS line_category,
            overview_line_status                             AS line_status,
            COUNT(*)                                          AS transaction_count,
            COALESCE(SUM(overview_net_amount), 0)             AS total_amount
        FROM overview_transaction_lines
        WHERE overview_line_status IN ('Paid', 'Free')
          AND (
            :overview_line_status IS NULL
            OR overview_line_status = :overview_line_status
          )
        GROUP BY overview_line_category, overview_line_status
        ORDER BY overview_line_category, overview_line_status
    """, {"overview_line_status": overview_line_status})


# ─────────────────────────────────────────────────────────────────────────
# /overview/transaction-member-vs-guest-revenue
#
# TRANSACTION-LEVEL Paid/Free revenue, split by customerType ('Member' /
# 'Guests') — the transaction-level companion to
# /overview/member-vs-guest-revenue (which is booking-level). Joins
# overview_transaction_lines back to overview_villa_bookings on conf_code
# to get overview_member_or_guest, since that field lives on the booking,
# not the individual transaction line.
#
# Anomaly rows excluded — same reasoning as transaction-finance-summary.
#
# Query params:
#   overview_line_status — 'Paid' or 'Free' to filter server-side;
#                           omit for both combined.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-member-vs-guest-revenue")
def overview_transaction_member_vs_guest_revenue(
    overview_line_status: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    return overview_rows(db, """
        SELECT
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                AS "customerType",
            otl.overview_line_status                           AS line_status,
            COALESCE(SUM(otl.overview_net_amount), 0)          AS revenue,
            COUNT(*)                                            AS transactions,
            COUNT(DISTINCT otl.overview_conf_code)               AS "uniqueAccounts"
        FROM overview_transaction_lines otl
        LEFT JOIN overview_villa_bookings ovb
          ON ovb.overview_conf_code = otl.overview_conf_code
        WHERE otl.overview_line_status IN ('Paid', 'Free')
          AND (
            :overview_line_status IS NULL
            OR otl.overview_line_status = :overview_line_status
          )
        GROUP BY
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END,
            otl.overview_line_status
    """, {"overview_line_status": overview_line_status})


# ─────────────────────────────────────────────────────────────────────────
# /overview/summary
#
# One-call bundle of everything the Overview tab needs, so the frontend
# only needs a single fetch on page load. Mirrors the shape of the old
# /analytics/dashboard-summary response but is fully independent of it.
#
# overviewVillaStats / overviewBookingsByBedroom / overviewMonthlyRevenue /
# overviewMemberVsGuestRevenue are returned UNFILTERED here (every payment
# type combined) plus a parallel *ByPaymentType bundle, so the frontend can
# either use the combined rows directly (each row already carries
# overview_payment_type for client-side filtering) or call the dedicated
# ?overview_payment_type=... endpoints if it wants the server to do the
# filtering instead.
#
# overviewTransactionFinanceSummary / overviewTransactionMemberVsGuestRevenue
# are the TRANSACTION-LEVEL (Finance at a glance / Member vs guest revenue
# card) equivalents — these use overview_transaction_lines, not
# overview_villa_bookings, and answer a different question (see their
# endpoint docstrings above).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/summary")
def overview_summary(db: Session = Depends(overview_get_db)):
    return {
        "overviewMemberStatus": overview_member_status(db=db),
        "overviewMemberType": overview_member_type(db=db),
        "overviewAmountDue": overview_amount_due(db=db),
        "overviewAmountDueByPeriod": overview_amount_due_by_period(db=db),
        "overviewDependents": overview_dependents(db=db),
        "overviewVillaStats": overview_villa_stats(overview_payment_type=None, db=db),
        "overviewBookingsByBedroom": overview_bookings_by_bedroom(overview_payment_type=None, db=db),
        "overviewMonthlyRevenue": overview_monthly_revenue(overview_payment_type=None, db=db),
        "overviewVisitsSummary": overview_visits_summary_by_payment_type(db=db),
        "overviewMemberVsGuestRevenue": overview_member_vs_guest_revenue(overview_payment_type=None, db=db),
        "overviewTransactionFinanceSummary": overview_transaction_finance_summary(overview_line_status=None, db=db),
        "overviewTransactionMemberVsGuestRevenue": overview_transaction_member_vs_guest_revenue(overview_line_status=None, db=db),
        "overviewVillaAmenityRevenue": overview_villa_amenity_revenue(overview_payment_type=None, db=db),
        "overviewMonthlyRevenueByCategory": overview_monthly_revenue_by_category(overview_payment_type=None, db=db),
    }