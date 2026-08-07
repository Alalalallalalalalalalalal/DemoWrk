# backend/postgres/analytics_villa_fees.py
"""
Villa Fees tab — annual Maintenance + Capital Expenditure per villa, plus
the DUES HISTORY endpoints for the historical dues synopsis.

REQUIRES: the two database views created by HISTORICAL_DUES_SYNOPSIS.sql
(run its SETUP section once in Supabase):
  * villa_owner_map_mv  — materialised copy of villa_owner_map
                       (member_number -> villa_name, bedroom_count, basis)
                       (manual overrides > villa named in the member record >
                        stays/bookings; constant full-capacity bedrooms)
  * villa_dues_lines_mv — materialised copy of villa_dues_lines:Are you 
                       classified dues lines from statement_details
                       (Maintenance / Capital Expenditure / Family Membership
                        / GCT), reversals excluded

Coverage note the frontend surfaces: broad multi-member statement history
starts Dec 2024; 2025 is the only complete year; earlier years contain a
single member (1A). The 20-year trend comes from the accounting GL.
READS THE MATERIALISED COPIES (*_mv), not the plain views. The plain
villa_owner_map has 13 dependants (synthetic_villa_income_lines ->
folios_unified -> the Overview tab) and is left alone; only this module
uses the _mv names. Both are rebuilt by the SETUP section and refreshed
by SELECT refresh_dues_views() — which must run after every scraper load
or this tab serves stale dues with no error.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .analytics_shared import get_db, rows, one

router = APIRouter()


# ═════════════════════════════════════════════════════════════════════════
# ORIGINAL TEST-TAB ENDPOINTS (single-year villa fee overview)
# Now also read the shared views, so the tab and the SQL pack always agree.
# ═════════════════════════════════════════════════════════════════════════

@router.get("/villa-fees/years")
def villa_fee_years(db: Session = Depends(get_db)):
    return rows(db, """
        SELECT DISTINCT year FROM villa_dues_lines_mv ORDER BY year DESC
    """)


@router.get("/villa-fees/summary")
def villa_fee_summary(year: int = Query(...), db: Session = Depends(get_db)):
    return one(db, """
        SELECT
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type = 'Maintenance Fees'), 0)::numeric, 2)
                                                        AS maintenance_total,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type = 'Capital Expenditure Fees'), 0)::numeric, 2)
                                                        AS capex_total,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type IN ('Annual Fees - Family Membership',
                                      'Annual Fees - Family Membership Deferred')), 0)::numeric, 2)
                                                        AS family_total,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type IN ('Maintenance Fees',
                                      'Capital Expenditure Fees',
                                      'Annual Fees - Family Membership',
                                      'Annual Fees - Family Membership Deferred')), 0)::numeric, 2)
                                                        AS grand_total,
            COUNT(*) FILTER (
                WHERE dl.fee_type IN ('Maintenance Fees',
                                      'Capital Expenditure Fees',
                                      'Annual Fees - Family Membership',
                                      'Annual Fees - Family Membership Deferred'))::int
                                                        AS fee_lines,
            COUNT(DISTINCT dl.member_number)::int       AS owners_billed,
            COUNT(DISTINCT om.villa_name)::int          AS villas_mapped,
            COUNT(DISTINCT dl.member_number) FILTER (
                WHERE om.villa_name IS NULL)::int       AS owners_unmapped
        FROM villa_dues_lines_mv dl
        LEFT JOIN villa_owner_map_mv om ON om.member_number = dl.member_number
        WHERE dl.year = :year
    """, {"year": year})


@router.get("/villa-fees/by-villa")
def villa_fees_by_villa(year: int = Query(...), db: Session = Depends(get_db)):
    return rows(db, """
        SELECT
            COALESCE(om.villa_name, 'Unmapped')         AS villa_name,
            MAX(om.bedroom_count)                       AS bedroom_count,
            COUNT(DISTINCT dl.member_number)::int       AS owner_count,
            STRING_AGG(DISTINCT dl.member_number, ', ') AS member_numbers,
            STRING_AGG(DISTINCT COALESCE(
                NULLIF(TRIM(m.member_full_name), ''),
                NULLIF(TRIM(m.member_name), ''),
                dl.member_number), ', ')                AS owner_names,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type = 'Maintenance Fees'), 0)::numeric, 2)
                                                        AS maintenance_annual,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type = 'Capital Expenditure Fees'), 0)::numeric, 2)
                                                        AS capex_annual,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type IN ('Annual Fees - Family Membership',
                                      'Annual Fees - Family Membership Deferred')), 0)::numeric, 2)
                                                        AS family_annual,
            ROUND(COALESCE(SUM(dl.billed_amount) FILTER (
                WHERE dl.fee_type IN ('Maintenance Fees',
                                      'Capital Expenditure Fees',
                                      'Annual Fees - Family Membership',
                                      'Annual Fees - Family Membership Deferred')), 0)::numeric, 2)
                                                        AS total_annual,
            COUNT(*)::int                               AS fee_lines
        FROM villa_dues_lines_mv dl
        LEFT JOIN villa_owner_map_mv om ON om.member_number = dl.member_number
        LEFT JOIN members m          ON m.member_number  = dl.member_number
        WHERE dl.year = :year
          AND dl.fee_type IN ('Maintenance Fees', 'Capital Expenditure Fees',
                              'Annual Fees - Family Membership',
                              'Annual Fees - Family Membership Deferred')
        GROUP BY COALESCE(om.villa_name, 'Unmapped')
        ORDER BY total_annual DESC
    """, {"year": year})


@router.get("/villa-fees/report")
def villa_fees_report(year: int = Query(...), db: Session = Depends(get_db)):
    return rows(db, """
        SELECT
            COALESCE(om.villa_name, 'Unmapped')         AS villa_name,
            om.bedroom_count                            AS bedroom_count,
            dl.member_number                            AS member_number,
            COALESCE(
                NULLIF(TRIM(m.member_full_name), ''),
                NULLIF(TRIM(m.member_name), ''))        AS member_name,
            NULLIF(TRIM(m.email), '')                   AS email,
            dl.fee_type                                 AS fee_type,
            dl.charge_name                              AS charge_name,
            COUNT(*)::int                               AS times_billed,
            ROUND(SUM(dl.billed_amount)::numeric, 2)    AS annual_amount,
            MIN(dl.transaction_date)                    AS first_billed,
            MAX(dl.transaction_date)                    AS last_billed
        FROM villa_dues_lines_mv dl
        LEFT JOIN villa_owner_map_mv om ON om.member_number = dl.member_number
        LEFT JOIN members m          ON m.member_number  = dl.member_number
        WHERE dl.year = :year
        GROUP BY 1, 2, 3, 4, 5, 6, 7
        ORDER BY villa_name, dl.member_number, dl.fee_type, dl.charge_name
    """, {"year": year})


# ═════════════════════════════════════════════════════════════════════════
# DUES HISTORY (all years — powers the "Dues history" section + exports)
# ═════════════════════════════════════════════════════════════════════════

@router.get("/villa-fees/history-by-year")
def dues_history_by_year(db: Session = Depends(get_db)):
    """Query 1 of the SQL pack: year × fee type totals."""
    return rows(db, """
        SELECT
            dl.year,
            dl.fee_type,
            ROUND(SUM(dl.billed_amount)::numeric, 2)    AS total_billed,
            COUNT(DISTINCT dl.member_number)::int       AS members_billed,
            ROUND((SUM(dl.billed_amount)
                / NULLIF(COUNT(DISTINCT dl.member_number), 0))::numeric, 2)
                                                        AS avg_per_member
        FROM villa_dues_lines_mv dl
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)


@router.get("/villa-fees/history-by-size")
def dues_history_by_size(db: Session = Depends(get_db)):
    """Query 2 of the SQL pack: year × fee type × villa size."""
    return rows(db, """
        SELECT
            dl.year,
            dl.fee_type,
            om.bedroom_count,
            COUNT(DISTINCT om.villa_name)               AS villas,
            COUNT(DISTINCT dl.member_number)::int       AS members_billed,
            ROUND(SUM(dl.billed_amount)::numeric, 2)    AS total_billed,
            ROUND((SUM(dl.billed_amount)
                / NULLIF(COUNT(DISTINCT dl.member_number), 0))::numeric, 2)
                                                        AS avg_per_member
        FROM villa_dues_lines_mv dl
        LEFT JOIN villa_owner_map_mv om ON om.member_number = dl.member_number
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3 NULLS LAST
    """)


@router.get("/villa-fees/history-villas-per-year")
def dues_history_villas_per_year(db: Session = Depends(get_db)):
    """Query 3 of the SQL pack: villas + members billed per year."""
    return rows(db, """
        SELECT
            dl.year,
            COUNT(DISTINCT om.villa_name)               AS villas_billed,
            COUNT(DISTINCT dl.member_number)::int       AS members_billed,
            COUNT(DISTINCT dl.member_number) FILTER (
                WHERE om.villa_name IS NULL)::int       AS unmapped_members
        FROM villa_dues_lines_mv dl
        LEFT JOIN villa_owner_map_mv om ON om.member_number = dl.member_number
        GROUP BY 1
        ORDER BY 1
    """)