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
# total_bookings (added 2026-06-25) is COUNT(*) — actual reservations,
# one per row of overview_villa_bookings. total_members_booked +
# total_guests_booked deliberately does NOT equal this: those are
# COUNT(DISTINCT member_number), so a member/guest with more than one
# booking is counted once there but contributes one row each here. The
# "Bookings at a glance" card's "Total bookings" stat was incorrectly
# using the members+guests sum before this fix, undercounting whenever
# someone had repeat bookings (confirmed: 112 actual bookings showing as
# 110, because two people had booked twice each).
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary")
def overview_visits_summary(
    overview_payment_type: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    return overview_one(db, f"""
        SELECT
            COUNT(*)                                              AS total_bookings,
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
# ─────────────────────────────────────────────────────────────────────────
@router.get("/visits-summary-by-payment-type")
def overview_visits_summary_by_payment_type(db: Session = Depends(overview_get_db)):
    overview_overall_summary = overview_one(db, """
        SELECT
            COUNT(*)                                              AS total_bookings,
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
            COUNT(*)                                              AS total_bookings,
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
# ─────────────────────────────────────────────────────────────────────────
@router.get("/amount-due")
def overview_amount_due(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT overview_total_amount_due AS total_amount_due
        FROM overview_statements_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/amount-due-by-period
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
# ─────────────────────────────────────────────────────────────────────────
@router.get("/dependents")
def overview_dependents(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT overview_total_dependents AS total_dependents
        FROM overview_dependents_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/member-vs-guest-revenue
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
# overview_transaction_lines (NOT overview_villa_bookings).
#
# Returns one row per (overview_line_category, overview_line_status)
# combination, e.g.:
#   Villa   / Paid  -> revenue, transaction count
#   Villa   / Free  -> revenue (always 0 by definition), transaction count
#   Amenity / Paid  -> revenue, transaction count
#   Amenity / Free  -> revenue (always 0), transaction count
#   (Anomaly, Reversed, AND CashAdvance rows are EXCLUDED here on purpose
#    — Anomaly because they don't cleanly resolve to "guest paid" or
#    "guest didn't pay"; Reversed because their net effect on the guest
#    is already $0; CashAdvance because cash handed to a guest isn't
#    product/service revenue at all, regardless of its net amount.
#    Folding any of these in here would just re-add the noise this
#    summary is supposed to avoid. The gross reversed amount and the net
#    cash-advance amount are each reported on their own via
#    /overview/reversals-summary and /overview/cash-advance-summary —
#    see those endpoints and overview_views.sql's docstring on the
#    'Reversed'/'CashAdvance' statuses.)
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
# /overview/reversals-summary
#
# Single-row rollup of charges that were fully charged-then-reversed in a
# clean, mutually-unique pair (see overview_views.sql's docstring on the
# 'Reversed' status in overview_transaction_lines for exactly what
# qualifies and why). These are excluded from every Paid/Free total
# elsewhere on the Overview tab — net cost to the guest was $0 — so this
# is the one place the gross reversed amount is still visible.
#
# Added 2026-06-25: reversed charges shouldn't count toward any revenue
# figure, but the fact that reversals happened (and how much) should
# still be visible — this powers a line on the "Finance at a glance" card.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/reversals-summary")
def overview_reversals_summary(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT
            overview_reversed_count AS reversed_count,
            overview_reversed_total AS reversed_total
        FROM overview_reversals_summary
    """)


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
# Added 2026-06-25 per request, following the same pattern as
# /overview/reversals-summary: pulled out of revenue, surfaced on its own
# line on the "Finance at a glance" card instead.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/cash-advance-summary")
def overview_cash_advance_summary(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT
            overview_cash_advance_count AS cash_advance_count,
            overview_cash_advance_total AS cash_advance_total
        FROM overview_cash_advance_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/anomalies-summary
#
# Single-row rollup of the 'Anomaly' lines — credits/refunds that
# couldn't be matched to a charge cleanly enough to call them 'Reversed'
# (either ambiguous: multiple same-amount candidates in the booking, or no
# match at all). See overview_views.sql's docstring on
# overview_anomalies_summary for the full breakdown. Already excluded
# from every Paid/Free revenue total elsewhere on the Overview tab; this
# is the one place the total is visible, the same pattern as
# /overview/reversals-summary and /overview/cash-advance-summary.
#
# Added 2026-06-25 per request.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/anomalies-summary")
def overview_anomalies_summary(db: Session = Depends(overview_get_db)):
    return overview_one(db, """
        SELECT
            overview_anomaly_count AS anomaly_count,
            overview_anomaly_total AS anomaly_total
        FROM overview_anomalies_summary
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/anomalies
#
# The individual 'Anomaly' lines themselves — one row per line-item, for
# a reviewable table (not just the rolled-up total from
# /overview/anomalies-summary above). Sorted most-negative first, since
# the biggest unexplained credits are the most worth a human's attention.
#
# Added 2026-06-25 per request, alongside /overview/anomalies-summary.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/anomalies")
def overview_anomalies(db: Session = Depends(overview_get_db)):
    return overview_rows(db, """
        SELECT
            overview_conf_code      AS conf_code,
            overview_villa_name     AS villa_name,
            overview_line_description AS description,
            overview_line_category  AS line_category,
            overview_net_amount     AS net_amount
        FROM overview_transaction_lines
        WHERE overview_line_status = 'Anomaly'
        ORDER BY overview_net_amount ASC
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/transaction-member-vs-guest-revenue
#
# revenue (net_amount summed) is unchanged — still $0 for every Free row,
# as it should be: that's the actual cost to the guest. valueGivenAway
# (added 2026-06-25) is the gross pre-reversal amount summed instead —
# the only place that "what was given away" survives for Free rows, since
# net_amount can't show it. The frontend uses valueGivenAway (negated) as
# the displayed figure specifically when the Free pill is selected, and
# leaves the Overall/Paid views reading from revenue as before — see
# applyLineStatusFilter in OverviewTab.jsx.
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
            COALESCE(SUM(otl.overview_gross_charged_amount), 0) AS "valueGivenAway",
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
# /overview/transaction-member-vs-guest-revenue-by-category
#
# Same shape as /overview/transaction-member-vs-guest-revenue, but also
# split by overview_line_category (Villa/Amenity) — added 2026-06-25 to
# power a stacked Villa/Amenity bar on the "Member vs guest revenue" card
# (matching the convention already used by "Revenue by month").
#
# Deliberately kept as a SEPARATE endpoint rather than adding
# line_category to the existing one's GROUP BY: the existing endpoint's
# transactions/uniqueAccounts feed the card's headline numbers, and
# summing uniqueAccounts across Villa+Amenity rows for the same
# customerType would double-count anyone with both kinds of charges — the
# same caveat already documented for Paid+Free in OverviewTab.jsx's
# applyLineStatusFilter. This endpoint exists only to drive the bar's
# Villa/Amenity proportions; the headline totals keep coming from the
# original endpoint unchanged.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/transaction-member-vs-guest-revenue-by-category")
def overview_transaction_member_vs_guest_revenue_by_category(
    overview_line_status: str | None = Query(default=None),
    db: Session = Depends(overview_get_db),
):
    return overview_rows(db, """
        SELECT
            CASE
                WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                                                AS "customerType",
            otl.overview_line_category                         AS line_category,
            otl.overview_line_status                           AS line_status,
            COALESCE(SUM(otl.overview_net_amount), 0)          AS revenue,
            COALESCE(SUM(otl.overview_gross_charged_amount), 0) AS "valueGivenAway"
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
            otl.overview_line_category,
            otl.overview_line_status
    """, {"overview_line_status": overview_line_status})


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
# Powers a negative "value given away" number on the Villa rental revenue
# metric of "Top villas by revenue", shown only for the Free-filtered
# slice of that card.
#
# Added 2026-06-25.
# ─────────────────────────────────────────────────────────────────────────
@router.get("/villa-rack-rate-free")
def overview_villa_rack_rate_free(db: Session = Depends(overview_get_db)):
    return overview_rows(db, """
        SELECT
            overview_villa_name      AS villa_name,
            overview_rack_rate_total AS rack_rate_total,
            overview_free_bookings   AS free_bookings
        FROM overview_villa_rack_rate_free
        ORDER BY rack_rate_total DESC
    """)


# ─────────────────────────────────────────────────────────────────────────
# /overview/summary
#
# One-call bundle of everything the Overview tab needs, so the frontend
# only needs a single fetch on page load.
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
        "overviewTransactionMemberVsGuestRevenueByCategory": overview_transaction_member_vs_guest_revenue_by_category(overview_line_status=None, db=db),
        "overviewVillaAmenityRevenue": overview_villa_amenity_revenue(overview_payment_type=None, db=db),
        "overviewMonthlyRevenueByCategory": overview_monthly_revenue_by_category(overview_payment_type=None, db=db),
        "overviewReversalsSummary": overview_reversals_summary(db=db),
        "overviewCashAdvanceSummary": overview_cash_advance_summary(db=db),
        "overviewAnomaliesSummary": overview_anomalies_summary(db=db),
        "overviewAnomalies": overview_anomalies(db=db),
        "overviewVillaRackRateFree": overview_villa_rack_rate_free(db=db),
    }