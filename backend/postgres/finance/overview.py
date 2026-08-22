# backend/postgres/finance/overview.py
# ─────────────────────────────────────────────────────────────────
# Finance /overview endpoint — Total / Villas / Amenities / Services.
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
    _statement_period_filter_sql,
)

router = APIRouter()


def _villa_statement_net_revenue(params: dict) -> float:
    """
    Net villa revenue from statement_details, matching the spend-breakdown
    definition used for the Villa collected card.
    """
    q_params = dict(params)
    sql = text(f"""
        SELECT
            COALESCE(ROUND(SUM(sd.amount) * -1, 2), 0) AS net_revenue
        FROM statement_details sd
        WHERE sd.description ILIKE '%Villa Income%'
        {_statement_period_filter_sql(alias="sd")}
    """)

    with engine.connect() as conn:
        row = conn.execute(sql, q_params).mappings().fetchone()

    return float(row["net_revenue"] or 0) if row else 0.0


# ══════════════════════════════════════════════════════════════════
# 1. OVERVIEW — Total / Villas / Amenities / Services
#
# Villas Revenue is intentionally NOT derived from folios. It comes
# straight from overview_villa_bookings.overview_villa_revenue — the
# same trusted, booking-level source the Overview tab uses (see
# postgres/overview_analytics.py). This is the one query in this file
# that does NOT use date_filter_sql() / the `f` folios alias, because
# that table has its own column names — see
# _villa_bookings_date_filter_sql() above.
#
# Amenities and Services Revenue reuse the exact same section-bucketing
# CASE statement (_section_case_sql()) that category-comp-breakdown
# already uses, summed off folios. No new categorization logic.
#
# Total Revenue = Villas + Amenities + Services. There is no separate
# "total revenue" SQL query — it's derived in Python from the other
# three so there's exactly one revenue calculation path.
#
# Forgone Revenue is NOT part of this endpoint's response — it never
# was. This endpoint is unaffected by the Forgone Revenue rename or
# the Villa methodology change.
# ══════════════════════════════════════════════════════════════════
@router.get("/overview")
def finance_overview(
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
    date_sql = date_filter_sql()  # alias="f", column="check_in_date"

    # ── Amenities + Services (folios, shared section bucketing) ─────
    #
    # IMPORTANT: only the 'collected' bucket counts as revenue (see
    # _bucket_case_sql()). Without this filter, payments, adjustments,
    # and reversed/refunded charges (none of which are revenue) get
    # summed in too — and since they have no amenity-specific
    # transaction_category, they fall into the 'Services' catch-all.
    # That's exactly what produced the ~-$3M figure: real Services
    # revenue was being netted against unrelated negative payment rows.
    section_params = dict(params)
    section_params["amenity_cats"] = list(AMENITY_CATS)

    section_sql = text(f"""
        SELECT
            {_section_case_sql()} AS section,
            SUM(f.amount)         AS revenue,
            COUNT(*)              AS transactions
        FROM folios f
        LEFT JOIN business_source bs ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
        WHERE f.transaction_category IS NOT NULL
          AND f.transaction_category <> 'Laundry'
          AND ({_bucket_case_sql()}) = 'collected'
        {date_sql}
        GROUP BY 1
    """)

    with engine.connect() as conn:
        section_rows = _rows_to_dicts(conn.execute(section_sql, section_params))

    amenities_revenue      = 0.0
    services_revenue       = 0.0
    collected_transactions = 0
    for r in section_rows:
        collected_transactions += int(r["transactions"] or 0)
        if r["section"] == "Amenities":
            amenities_revenue = float(r["revenue"] or 0)
        elif r["section"] == "Services":
            services_revenue = float(r["revenue"] or 0)
    # (the 'Villa' bucket from this query is intentionally discarded —
    # Villas Revenue below is the trusted source, not this folio sum)

    # Separate, UNFILTERED transaction count for the "X transactions"
    # subtitle — deliberately not restricted to the 'collected' bucket,
    # since it's meant to reflect overall folio activity for the period,
    # not just revenue-generating rows.
    count_sql = text(f"""
        SELECT COUNT(*) AS transactions
        FROM folios f
        WHERE f.amount IS NOT NULL
          AND f.transaction_category IS NOT NULL
          AND f.transaction_category <> 'Laundry'
        {date_sql}
    """)
    with engine.connect() as conn:
        total_transactions = int(conn.execute(count_sql, params).scalar() or 0)

    # ── Villas (statement-based net revenue, matching the spend breakdown) ─────
    # The Villa card in the spend breakdown is already sourced from
    # statement_details and reflects the net figure after the tax/owner
    # deduction treatment. Use that same definition here so the Revenue
    # Overview card matches the spend breakdown rather than showing the
    # pre-tax gross booking total.
    villas_revenue = _villa_statement_net_revenue(params)

    total_revenue = villas_revenue + amenities_revenue + services_revenue

    return {
        "totalRevenue":      total_revenue,
        "villasRevenue":     villas_revenue,
        "amenitiesRevenue":  amenities_revenue,
        "servicesRevenue":   services_revenue,
        "totalTransactions": total_transactions,
    }
