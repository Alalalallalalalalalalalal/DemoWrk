# backend/postgres/finance/villas.py
# ─────────────────────────────────────────────────────────────────
# Finance Villa endpoints — category/forgone breakdown, forgone
# coverage, gross/net reconciliation, statement totals, per-villa
# revenue table, and reservation-level drill-in.
# Split out of what used to be a single finance/routes.py (see
# finance/__init__.py for the aggregator that replaces it).
# ─────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Query
from typing import Optional
from datetime import date
from sqlalchemy import text
from ..database import engine   # same engine your analytics.py uses
from ..analytics_shared import date_filter_sql, filter_params
from ._shared import (
    AMENITY_CATS,
    _rows_to_dicts,
    _section_case_sql,
    _bucket_case_sql,
    _villa_bookings_date_filter_sql,
    _villa_forgone_revenue_row,
    _villa_revenue_date_filter_sql,
    _villa_gross_revenue_cte_sql,
    _statement_period_filter_sql,
)

router = APIRouter()


def _villa_collected_revenue_row(params: dict, villa: Optional[str] = None) -> dict:
    """
    Villa 'collected' bucket for category-comp-breakdown — SOURCE OF
    TRUTH IS rate_details (the same reservation-deduped Gross Revenue
    CTE that backs /overview and /villa-revenue), NOT folios.

    Replaces the previously-folios-sourced Villa 'collected' figure,
    which was found to disagree badly with rate_details for the same
    scope (~$2.8M via folios vs. ~$36M via a raw, undeduped
    SUM(original_amount) sanity check on rate_details) — the same
    class of undercounting problem that originally motivated moving
    Villas Revenue off folios for /overview in the first place. Villa
    'reversed' is NOT changed by this — it remains folios-sourced,
    since only 'collected' was reported as disagreeing.

    Uses the SAME date semantics as Gross Revenue elsewhere
    (_villa_revenue_date_filter_sql — check_in_date bucketing, not
    stay-overlap), so this figure matches /villa-revenue's per-villa
    gross total and /finance/villa-revenue-reconciliation's "gross"
    column for the same filters — those three ARE the same query,
    wrapped differently, and should be kept in sync if any of them
    changes.

    [2026-08-13] This is NOT the same figure as /finance/overview's
    `villasRevenue` field, Overview's hero tile, or analytics_villas.py's
    Villa tab Paid $ total — those three are intentionally scoped to
    rental-programme payouts only (statement_details "Villa Income",
    ~$109.98M all-time). This `collected` bucket uses a different,
    smaller-scope definition (reservation-deduped rate_details,
    payment_type='Paid' AND status='Posted', ~$96.10M all-time) that is
    legitimately not expected to reconcile with the headline number.
    Do not "fix" a mismatch here.

    Returns grossRevenue, reservationCount, uniqueAccounts (distinct
    member_number over the deduped rows).

    `params` must already contain the standard filter_params() bind
    set. Adds :flt_villa on a COPY of params if `villa` is given —
    never mutates the caller's dict (same convention as
    _villa_forgone_revenue_row()).
    """
    q_params = dict(params)
    villa_filter = ""
    if villa:
        villa_filter = "AND vr.villa_name = :flt_villa"
        q_params["flt_villa"] = villa

    sql = text(f"""
        {_villa_gross_revenue_cte_sql()}
        SELECT
            COALESCE(SUM(vr.total_rental), 0) AS gross_revenue,
            COUNT(*)                          AS reservation_count,
            COUNT(DISTINCT vr.member_number)  AS unique_accounts
        FROM villa_reservations vr
        WHERE 1=1
        {_villa_revenue_date_filter_sql(alias="vr")}
        {villa_filter}
    """)

    with engine.connect() as conn:
        row = conn.execute(sql, q_params).mappings().fetchone()

    return {
        "grossRevenue":     float(row["gross_revenue"] or 0) if row else 0.0,
        "reservationCount": int(row["reservation_count"] or 0) if row else 0,
        "uniqueAccounts":   int(row["unique_accounts"] or 0) if row else 0,
    }


# ══════════════════════════════════════════════════════════════════
# 1b. CATEGORY / FORGONE-REVENUE BREAKDOWN
#
# Returns one row per (section, category, payment_type, bucket) with
# an `amount`, used by the frontend's Collected vs. Forgone Revenue
# cards.
#
# Villa section: BOTH 'forgone_revenue' and 'collected' are NOT
# computed from folios anymore. Both are single synthetic rows sourced
# from rate_details:
#   forgone_revenue — see _villa_forgone_revenue_row() — SUM(original_amount)
#                     where payment_type = 'Free', excluding Villa
#                     Lolita / Wonderland.
#   collected       — see _villa_collected_revenue_row() — the same
#                     reservation-deduped Gross Revenue CTE used by
#                     /overview and /villa-revenue (SUM(total_rental),
#                     payment_type = 'Paid', status = 'Posted').
#                     Replaced because the folios-sourced figure
#                     disagreed badly with rate_details (~$2.8M vs.
#                     ~$36M for the same scope) — see chat history.
# Villa's 'reversed' bucket is the only one still folios-sourced,
# unchanged.
#
# Amenities / Services: unchanged calculation, bucket value renamed
# 'given_away' -> 'forgone_revenue'.
#
# An optional `villa` filter narrows both the Villa forgone-revenue
# AND Villa collected-revenue figures (and, like every other Finance
# filter, doesn't affect Amenities / Services, which have no villa
# dimension).
# ══════════════════════════════════════════════════════════════════
@router.get("/category-comp-breakdown")
def category_comp_breakdown(
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
    villa:      Optional[str]  = Query(None, description="Optional villa_name filter; narrows the Villa Forgone Revenue figure"),
):
    params = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )
    params["amenity_cats"] = list(AMENITY_CATS)
    date_sql = date_filter_sql()

    sql = text(f"""
        SELECT
            {_section_case_sql()} AS section,
            COALESCE(NULLIF(TRIM(f.transaction_category), ''), 'Uncategorized') AS category,
            COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown') AS payment_type,
            {_bucket_case_sql()} AS bucket,
            SUM(f.amount) AS amount,
            COUNT(*) AS transactions,
            COUNT(DISTINCT f.member_number) AS unique_accounts
        FROM folios f
        LEFT JOIN business_source bs ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
        WHERE f.transaction_category IS NOT NULL
          AND f.transaction_category <> 'Laundry'
        {date_sql}
        GROUP BY 1,2,3,4
        ORDER BY 1,2,3,4
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    out = []
    for r in rows:
        # Villa's forgone_revenue AND collected buckets are no longer
        # sourced from folios — both dropped here, replaced below with
        # rate_details figures. Villa 'reversed' rows pass through
        # unchanged, as does everything in Amenities/Services.
        if r["section"] == "Villa" and r["bucket"] in ("forgone_revenue", "collected"):
            continue
        out.append({
            "section": r["section"],
            "category": r["category"],
            "PaymentType": r["payment_type"],
            "bucket": r["bucket"],
            "amount": float(r["amount"] or 0),
            "transactions": r["transactions"],
            "uniqueAccounts": r["unique_accounts"],
        })

    # Villa Forgone Revenue — from rate_details, not folios. Excludes
    # Villa Lolita / Wonderland. If `villa` is one of the excluded
    # names, this correctly produces 0 revenue / 0 rows rather than
    # silently ignoring the exclusion.
    villa_forgone = _villa_forgone_revenue_row(params, villa=villa)
    out.append({
        "section": "Villa",
        "category": "Villa",
        "PaymentType": "Free",
        "bucket": "forgone_revenue",
        "amount": villa_forgone["forgoneRevenue"],
        "transactions": villa_forgone["totalFreeRows"],
        "uniqueAccounts": villa_forgone["uniqueAccounts"],
        # Extra fields, present only on this synthetic row — data-
        # quality companions to the figure, not part of the original
        # contract. See /villa-forgone-coverage for a dedicated,
        # always-available version of these same numbers.
        "missingRateCount": villa_forgone["missingRateCount"],
        "calculationCoverage": villa_forgone["calculationCoverage"],
    })

    # Villa Collected Revenue — from rate_details (Gross Revenue CTE),
    # not folios. NOT subject to the Villa Lolita / Wonderland
    # exclusion (that exclusion is specific to Forgone Revenue's
    # free-comp accounting; Gross/Collected Revenue has never excluded
    # those villas, same as /overview and /villa-revenue).
    villa_collected = _villa_collected_revenue_row(params, villa=villa)
    out.append({
        "section": "Villa",
        "category": "Villa",
        "PaymentType": "Paid",
        "bucket": "collected",
        "amount": villa_collected["grossRevenue"],
        "transactions": villa_collected["reservationCount"],
        "uniqueAccounts": villa_collected["uniqueAccounts"],
    })

    return out


# ══════════════════════════════════════════════════════════════════
# 1c. VILLA FORGONE REVENUE — DATA QUALITY / COVERAGE
#
# Dedicated companion to the Villa Forgone Revenue figure in
# category-comp-breakdown: how many free-villa rate_details rows had
# no original_amount to sum, and what fraction of in-scope free rows
# were actually counted in the total. Same filters as every other
# Finance endpoint, plus an optional villa filter.
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-forgone-coverage")
def finance_villa_forgone_coverage(
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
    villa:      Optional[str]  = Query(None),
):
    params = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )
    return _villa_forgone_revenue_row(params, villa=villa)


# ══════════════════════════════════════════════════════════════════
# 1d. VILLA REVENUE RECONCILIATION — Gross (rate_details) vs.
#     Net (statement_details, via villa_owner_map)
#
# NEW endpoint, additive only — does not change /overview or
# /villa-revenue's response shape. Built to satisfy the "gross / net /
# reconciliation" requirement without touching an existing contract.
#
# GROSS: reservation-deduped rate_details total_rental, same source
# and same dedup as /villa-revenue (_villa_gross_revenue_cte_sql()).
#
# NET: statement_details rows where description ILIKE '%Villa Income%'
# for the requested statement_period, summed as ABS(amount) (statement
# values may be negative by accounting convention). statement_period
# is matched by parsing statement_period as "March, 2025" style text
# — see _statement_period_filter_sql().
#
# OWNER MAPPING (rate_details.villa_name has no direct FK to
# statement_details — it's bridged through villa_owner_map):
#   rate_details.villa_name -> villa_owner_map.villa_name
#     -> villa_owner_map.member_number -> statement_details.member_number
# A villa can therefore appear in the gross list with no matching net
# figure for two distinct reasons, which this endpoint reports
# separately rather than collapsing into a single "no data" state:
#   hasOwnerMapping=false  — villa_owner_map has no row for this villa
#                            at all (the bridge itself is broken/missing)
#   hasStatementEntry=false — the mapping exists, but statement_details
#                            has no matching 'Villa Income' row for this
#                            member_number in this period (e.g. posted
#                            late, or genuinely zero for the period)
#
# statementGrossRevenue = netRevenue / 0.85 (see module-level business
# rule: statement amount ≈ 85% of gross villa income after deduction/
# tax treatment). variance = grossRevenue - statementGrossRevenue,
# null whenever statementGrossRevenue is null (nothing to compare against).
#
# year and month are BOTH OPTIONAL (unlike the first version of this
# endpoint, which required both): year+month -> single month,
# year only -> that year's total, neither -> all-time total. See
# _statement_period_filter_sql().
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-revenue-reconciliation")
def finance_villa_revenue_reconciliation(
    year:  Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    villa: Optional[str] = Query(None),
):
    params = filter_params(year=year, month=month, date=None, start_date=None, end_date=None)
    params["year"] = year
    params["month"] = month

    villa_filter_gross = ""
    if villa:
        villa_filter_gross = "AND vr.villa_name = :flt_villa"
        params["flt_villa"] = villa

    sql = text(f"""
        {_villa_gross_revenue_cte_sql()},
        gross AS (
            SELECT
                vr.villa_name,
                COALESCE(SUM(vr.total_rental), 0) AS gross_revenue,
                COUNT(*)                          AS reservation_count
            FROM villa_reservations vr
            WHERE 1=1
            {_villa_revenue_date_filter_sql(alias="vr")}
            {villa_filter_gross}
            GROUP BY vr.villa_name
        ),
        statement_net AS (
            SELECT
                vom.villa_name,
                COALESCE(SUM(ABS(sd.amount)), 0) AS net_revenue,
                COUNT(*)                          AS statement_line_count
            FROM statement_details sd
            JOIN villa_owner_map vom ON vom.member_number = sd.member_number
            WHERE sd.description ILIKE '%Villa Income%'
            {_statement_period_filter_sql(alias="sd")}
            GROUP BY vom.villa_name
        ),
        owner_map_counts AS (
            SELECT villa_name, COUNT(*) AS mapped_rows
            FROM villa_owner_map
            GROUP BY villa_name
        )
        SELECT
            g.villa_name,
            g.gross_revenue,
            g.reservation_count,
            sn.net_revenue,
            sn.statement_line_count,
            COALESCE(omc.mapped_rows, 0) AS mapped_rows
        FROM gross g
        LEFT JOIN statement_net sn     ON sn.villa_name = g.villa_name
        LEFT JOIN owner_map_counts omc ON omc.villa_name = g.villa_name
        ORDER BY g.gross_revenue DESC NULLS LAST
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    out = []
    for r in rows:
        gross_revenue = float(r["gross_revenue"] or 0)
        has_owner_mapping = int(r["mapped_rows"] or 0) > 0
        has_statement_entry = r["net_revenue"] is not None
        net_revenue = float(r["net_revenue"]) if has_statement_entry else None
        statement_gross_revenue = (net_revenue / 0.85) if net_revenue is not None else None
        variance = (gross_revenue - statement_gross_revenue) if statement_gross_revenue is not None else None

        out.append({
            "villaName":              r["villa_name"],
            "grossRevenue":           gross_revenue,
            "reservationCount":       int(r["reservation_count"] or 0),
            "netRevenue":             net_revenue,
            "statementGrossRevenue":  statement_gross_revenue,
            "variance":               variance,
            "hasOwnerMapping":        has_owner_mapping,
            "hasStatementEntry":      has_statement_entry,
        })

    return out


# ══════════════════════════════════════════════════════════════════
# 1e. VILLA STATEMENT TOTALS — portfolio-wide (no per-villa split)
#
# Mirrors, field-for-field, three validated queries: statement_details
# joined to villa_owner_map on member_number, filtered to 'Villa
# Income' rows, net = SUM(ABS(amount)), gross = net / 0.85 — with NO
# grouping by villa_name (unlike /villa-revenue-reconciliation above).
#
# ⚠️ IMPORTANT — this intentionally does NOT dedupe by villa. If any
# member_number in villa_owner_map is mapped to more than one villa,
# a single statement_details row joins to multiple villa_owner_map
# rows and gets counted once per villa it fans out to. That is exactly
# how the validated queries this endpoint mirrors are written (a
# plain JOIN, no per-villa grouping), so the totals here match those
# reference figures precisely — but it also means this endpoint's
# total is NOT guaranteed to equal the sum of per-villa netRevenue
# values from /villa-revenue-reconciliation if that fan-out exists.
# Flagging this rather than silently reconciling it, since "correct"
# here is defined as "matches the validated queries," not as
# "internally consistent with the per-villa endpoint."
#
# years: optional comma-separated list, e.g. "2025,2026" -> one row
# per year, EXTRACT(YEAR FROM TO_DATE(statement_period, 'Month, YYYY')).
# Omit entirely for a single all-time total row (year: null).
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-statement-totals")
def finance_villa_statement_totals(
    years: Optional[str] = Query(
        None,
        description="Comma-separated years, e.g. '2025,2026'. Omit for one all-time total.",
    ),
):
    if years:
        try:
            year_list = [int(y.strip()) for y in years.split(",") if y.strip()]
        except ValueError:
            year_list = []

        sql = text("""
            SELECT
                EXTRACT(YEAR FROM TO_DATE(sd.statement_period, 'Month, YYYY'))::int AS year,
                ROUND(SUM(sd.amount) * -1, 2)        AS net_revenue,
                ROUND(SUM(sd.amount) * -1 / 0.85, 2) AS statement_gross_revenue
            FROM statement_details sd
            WHERE sd.description ILIKE '%Villa Income%'
              AND EXTRACT(YEAR FROM TO_DATE(sd.statement_period, 'Month, YYYY')) = ANY(:years)
            GROUP BY 1
            ORDER BY 1
        """)
        with engine.connect() as conn:
            rows = conn.execute(sql, {"years": year_list}).mappings().all()

        return [
            {
                "year":                  int(r["year"]),
                "netRevenue":            float(r["net_revenue"] or 0),
                "statementGrossRevenue": float(r["statement_gross_revenue"] or 0),
            }
            for r in rows
        ]

    sql = text("""
        SELECT
            ROUND(SUM(sd.amount) * -1, 2)        AS net_revenue,
            ROUND(SUM(sd.amount) * -1 / 0.85, 2) AS statement_gross_revenue
        FROM statement_details sd
        WHERE sd.description ILIKE '%Villa Income%'
    """)
    with engine.connect() as conn:
        row = conn.execute(sql).mappings().fetchone()

    return {
        "year":                  None,
        "netRevenue":            float(row["net_revenue"] or 0) if row else 0.0,
        "statementGrossRevenue": float(row["statement_gross_revenue"] or 0) if row else 0.0,
    }


# ══════════════════════════════════════════════════════════════════
# 4. VILLA REVENUE (breakdown table, by villa name)
#
# [2026-08-20 SOURCE OF TRUTH CHANGE] Was rate_details gross booking
# value via _villa_gross_revenue_cte_sql() (~$96.1M all-time) — this
# endpoint's own prior comment claimed that source "still always sums
# to" /overview's villasRevenue card total, which stopped being true
# the moment that card moved to the statement-based $109,979,584
# rental-programme-payout basis (2026-08-13 correction, see the
# top-of-file note) without this endpoint following along. Per explicit
# direction that Finance and Overview must match, this now reads
# revenue from overview_transaction_lines the same way Overview's own
# "Top villas by revenue" card does (overview_analytics.py's
# overview_villa_stats(): Villa category, Paid status, conf_code
# >= 9,000,000 — see that function's comment for why rental-programme
# payouts and real guest bookings are two disjoint conf_code universes,
# joined only by villa name, never by conf_code).
#
# Booking counts / room nights / avg stay / member-vs-guest split still
# come from real guest stays (overview_villa_bookings — payouts aren't
# bookings), same shape as before, just via the unified ledger instead
# of rate_details. A villa with payout revenue in the period but no
# recorded stays in overview_villa_bookings won't appear here (LEFT
# JOIN direction matches overview_villa_stats()); in practice every
# paying villa has stays.
#
# NOTE: this table has no payment-type (paid/free) breakdown, same as
# before — rental-programme payouts are effectively always "Paid" by
# construction. For a payment-aware per-villa breakdown, use
# GET /finance/drilldown-breakdown?group_by=villa&payment=free
# (folios-sourced, unaffected by this change). For Villa Net Revenue
# and gross/net reconciliation against the rate_details gross figure,
# see GET /finance/villa-revenue-reconciliation below — that endpoint's
# "gross" column is the one still intentionally on the rate_details
# basis.
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-revenue")
def finance_villa_revenue(
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
):
    params = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )

    sql = text(f"""
        WITH villa_bookings AS (
            SELECT
                ovb.overview_villa_name                             AS villa_name,
                COUNT(*)                                             AS total_bookings,
                COALESCE(SUM(ovb.overview_nights), 0)                AS room_nights,
                COALESCE(ROUND(AVG(ovb.overview_nights)::numeric, 1), 0) AS avg_stay,
                COUNT(*) FILTER (
                    WHERE ovb.overview_member_or_guest = 'Guest' OR ovb.overview_member_number IS NULL
                )                                                     AS guest_bookings,
                COUNT(*) FILTER (
                    WHERE ovb.overview_member_number IS NOT NULL
                      AND (ovb.overview_member_or_guest IS NULL OR ovb.overview_member_or_guest != 'Guest')
                )                                                     AS member_bookings
            FROM overview_villa_bookings ovb
            WHERE 1=1
            {_villa_bookings_date_filter_sql()}
            GROUP BY ovb.overview_villa_name
        ),
        villa_revenue AS (
            SELECT
                otl.overview_villa_name  AS villa_name,
                SUM(otl.overview_net_amount) AS revenue
            FROM overview_transaction_lines otl
            JOIN overview_booking_meta ovb ON ovb.overview_conf_code = otl.overview_conf_code
            WHERE otl.overview_line_category = 'Villa'
              AND otl.overview_line_status   = 'Paid'
              AND otl.overview_conf_code::text ~ '^[0-9]+$'
              AND otl.overview_conf_code::text::bigint >= 9000000
            {_villa_bookings_date_filter_sql()}
            GROUP BY otl.overview_villa_name
        )
        SELECT
            vb.villa_name,
            COALESCE(vr.revenue, 0) AS revenue,
            vb.total_bookings,
            vb.room_nights,
            vb.avg_stay,
            vb.guest_bookings,
            vb.member_bookings
        FROM villa_bookings vb
        LEFT JOIN villa_revenue vr ON vr.villa_name = vb.villa_name
        ORDER BY revenue DESC NULLS LAST
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql, params))

    return [
        {
            "villaName":      r["villa_name"],
            "revenue":        float(r["revenue"] or 0),
            "totalBookings":  int(r["total_bookings"] or 0),
            "roomNights":     int(r["room_nights"] or 0),
            "avgStay":        float(r["avg_stay"] or 0),
            "memberBookings": int(r["member_bookings"] or 0),
            "guestBookings":  int(r["guest_bookings"] or 0),
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# 4b. VILLA RESERVATIONS — record-level drill-in, one villa OR the
#     whole portfolio
#
# NEW endpoint. Was missing: clicking a villa row in /villa-revenue's
# table opened the drawer's record list via /drilldown, which is
# folios-sourced — a completely different table from the one that
# produced the number being drilled into. This endpoint gives that
# drill-in a source that actually agrees with /villa-revenue: same
# dedup, same filters, same check-in-month date bucketing, just at
# reservation grain instead of aggregated.
#
# Does NOT reuse _villa_gross_revenue_cte_sql() as-is — that CTE only
# selects the columns the aggregate calculations need (villa_name,
# member_number, total_rental, check_in_date, check_out_date). This
# endpoint needs the fuller reservation record (guest_name, room_number,
# source, rate_name, reservation_status, conf_code/reservation_id), so
# it has its own dedup query rather than widening the shared CTE's
# column set for every other caller.
#
# `villa` is now OPTIONAL — every Villa-scoped click on the dashboard
# (the top-level Villas Revenue card, the Total -> Villas Revenue mid-
# item, category-comp-breakdown's Villa card, a specific villa row
# from /villa-revenue OR from a "Browse by Villa" breakdown) now routes
# here for consistency. Omitted = every villa, portfolio-wide; set =
# scoped to that one villa. See RevenueBreakdownDrawer.jsx's
# isVillaScopedFilters()/loadRecords() for how the frontend decides
# which case it's in.
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-reservations")
def finance_villa_reservations(
    villa:      Optional[str] = Query(None, description="Villa name — omit for every villa (portfolio-wide)"),
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
):
    params = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )

    villa_filter = ""
    if villa:
        villa_filter = "AND rd.villa_name = :flt_villa"
        params["flt_villa"] = villa

    sql = text(f"""
        WITH rd_keyed AS (
            SELECT
                rd.reservation_id, rd.conf_code, rd.villa_name, rd.member_number,
                rd.guest_name, rd.room_number, rd.source, rd.rate_name,
                rd.reservation_status, rd.total_rental, rd.check_in_date,
                rd.check_out_date, rd.rate_date,
                COALESCE(NULLIF(TRIM(rd.reservation_id), ''), NULLIF(TRIM(rd.conf_code), '')) AS res_key
            FROM rate_details rd
            WHERE rd.payment_type = 'Paid' AND rd.villa_name <> 'ZZ Comp'
              AND rd.status = 'Posted'
              AND rd.villa_name IS NOT NULL
            {villa_filter}
        ),
        villa_reservations AS (
            SELECT DISTINCT ON (res_key)
                res_key, reservation_id, conf_code, villa_name, member_number,
                guest_name, room_number, source, rate_name, reservation_status,
                total_rental, check_in_date, check_out_date
            FROM rd_keyed
            WHERE res_key IS NOT NULL
            ORDER BY res_key, rate_date
        )
        SELECT
            vr.res_key, vr.reservation_id, vr.conf_code, vr.villa_name,
            vr.member_number, vr.guest_name, vr.room_number, vr.source,
            vr.rate_name, vr.reservation_status, vr.total_rental,
            vr.check_in_date, vr.check_out_date,
            (vr.check_out_date - vr.check_in_date) AS nights,
            m.email          AS member_email,
            mp.phone_number  AS member_phone,
            ma.city          AS member_city,
            ma.country       AS member_country
        FROM villa_reservations vr
        LEFT JOIN members m ON m.member_number = vr.member_number
        LEFT JOIN LATERAL (
            SELECT phone_number
            FROM member_phones
            WHERE member_number = vr.member_number
            ORDER BY id
            LIMIT 1
        ) mp ON true
        LEFT JOIN member_addresses ma ON ma.member_number = vr.member_number
        WHERE 1=1
        {_villa_revenue_date_filter_sql(alias="vr")}
        ORDER BY vr.check_in_date DESC NULLS LAST
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql, params))

    return [
        {
            "reservationId":     r["reservation_id"] or r["conf_code"],
            "confCode":          r["conf_code"],
            "villaName":         r["villa_name"],
            "guestName":         r["guest_name"],
            "memberNumber":      r["member_number"],
            "roomNumber":        r["room_number"],
            "source":            r["source"],
            "rateName":          r["rate_name"],
            "reservationStatus": r["reservation_status"],
            "totalRental":       float(r["total_rental"] or 0),
            "checkInDate":       str(r["check_in_date"])  if r["check_in_date"]  else None,
            "checkOutDate":      str(r["check_out_date"]) if r["check_out_date"] else None,
            "nights":            int(r["nights"]) if r["nights"] is not None else None,
            "memberEmail":       r["member_email"],
            "memberPhone":       r["member_phone"],
            "memberCity":        r["member_city"],
            "memberCountry":     r["member_country"],
        }
        for r in rows
    ]
