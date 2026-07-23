# backend/postgres/finance_backend.py
# ─────────────────────────────────────────────────────────────────
# Finance endpoints — uses SQLAlchemy (same pattern as analytics.py)
#
# Date filtering: all endpoints below accept year / month / date /
# start_date / end_date and reuse the SAME date_filter_sql() +
# filter_params() helpers from analytics_shared.py that Visits & Rooms
# uses. No bespoke date-filtering SQL is defined in this file, EXCEPT
# _villa_bookings_date_filter_sql() and _rate_details_date_filter_sql()
# below — see their docstrings for why.
#
# date_filter_sql() defaults to alias="f", column="check_in_date" and
# always pairs it with "f.check_out_date" — i.e. it filters folio rows
# whose underlying STAY overlaps the requested period. Since `folios`
# is aliased `f` everywhere in this file already, the defaults apply
# unmodified everywhere except the pre-aggregated/alternate-source
# tables (villa-revenue, amenity-revenue, villa forgone revenue),
# which are addressed inline.
#
# DRILLDOWN FILTERS — composable, not exclusive
# ───────────────────────────────────────────────
# /drilldown (flat folio records) and /drilldown-breakdown (grouped
# totals) both accept the SAME set of independent filter dimensions:
#   source, villa, customer, payment, amenity, category, section
# Every dimension that's set is AND'ed together via _apply_common_filters()
# — e.g. payment='free'&villa='Solaria Villa' returns only the
# free-of-charge folio rows for that villa, not "whichever one came
# last." This lets the frontend drawer accumulate filters as the user
# drills deeper (e.g. click "Free" -> browse by Villa -> pick a villa)
# without losing what was already chosen.
#
# The legacy `type`/`value` pair from the original single-filter
# /drilldown is still accepted and folded into the same dict via
# _legacy_type_value_to_filters() — purely for backward compatibility
# with any caller that hasn't moved to the structured params.
#
# TERMINOLOGY: "Given Away" has been renamed "Forgone Revenue"
# throughout (bucket value 'given_away' -> 'forgone_revenue', all
# field/label names updated to match). Amenities and Services keep
# their original complimentary-charge logic — only the name changed.
# Villa's Forgone Revenue calculation methodology changed: it is no
# longer derived from folios. It is now sourced from rate_details
# (SUM(COALESCE(original_amount, 0)) where payment_type = 'Free'),
# excluding Villa Lolita / Wonderland. See _villa_forgone_revenue_sql().
#
# VILLA GROSS REVENUE SOURCE CHANGE: /overview's villasRevenue card and
# /villa-revenue's per-villa table are now sourced from rate_details
# (reservation-deduped, payment_type = 'Paid') instead of
# overview_villa_bookings. See _villa_gross_revenue_cte_sql() for why
# the dedup is required and what it assumes. New endpoint
# GET /finance/villa-revenue-reconciliation adds Net Revenue (from
# statement_details via villa_owner_map) and gross-vs-net comparison,
# additively — it does not change any existing response shape.
# ─────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Query
from typing import Optional
from datetime import date
from sqlalchemy import text
import math
from .database import engine   # same engine your analytics.py uses
from .analytics_shared import date_filter_sql, filter_params

router = APIRouter(tags=["finance"])

# ── amenity keyword map (folio description → amenity category) ────
AMENITY_KEYWORDS = {
    "Spa":         ["spa", "massage", "facial", "treatment"],
    "Golf":        ["golf", "caddie", "driving range", "green fee"],
    "Restaurant":  ["restaurant", "dining", "dinner", "lunch", "brunch", "breakfast"],
    "Bar":         ["bar", "cocktail", "beverage", "drinks", "wine", "beer"],
    "Grill":       ["grill", "bbq", "barbecue"],
    "Tennis":      ["tennis", "court"],
    "Boutique":    ["boutique", "shop", "retail", "gift"],
    "Commissary":  ["commissary", "grocery", "provision", "market"],
}

# Top-level Finance sections (Villa / Amenities / Services). A folio's
# transaction_category is bucketed into one of these three groups.
# Shared by category-comp-breakdown, the /overview cards, and
# /drilldown's `section` filter — see _section_case_sql(). This used
# to be defined locally inside category_comp_breakdown(); it now lives
# here so every consumer uses the exact same list.
AMENITY_CATS = (
    "F&B", "Golf", "Spa & Beauty", "Tennis", "Boutique",
    "Water Sports", "Equipment", "Cart Rental", "Events",
)

# Villas excluded from the free-villa Forgone Revenue calculation,
# regardless of payment_type — these are non-rentable / placeholder
# villa names, not real comped stays, and should never count toward
# Villa Forgone Revenue.
VILLA_FORGONE_EXCLUDED = ("Villa Lolita", "Wonderland")


def _rows_to_dicts(result):
    """Convert SQLAlchemy result rows to plain dicts."""
    keys = list(result.keys())
    return [dict(zip(keys, row)) for row in result.fetchall()]


def _amenity_case_sql() -> str:
    cases = []
    for amenity, kws in AMENITY_KEYWORDS.items():
        like_parts = " OR ".join(
            f"LOWER(f.description) LIKE '%{kw}%'" for kw in kws
        )
        cases.append(f"WHEN ({like_parts}) THEN '{amenity}'")
    return "CASE\n  " + "\n  ".join(cases) + "\n  ELSE 'Other'\nEND"


def _section_case_sql() -> str:
    """
    Buckets a folio row's transaction_category into one of the three
    top-level Finance sections: 'Villa', 'Amenities', or 'Services'.

    This is the single source of truth for that split — it backs
    category-comp-breakdown's `section` column, the Amenities/Services
    figures on the /overview cards, and /drilldown's `section` filter,
    so the bucketing logic is defined in exactly one place instead of
    being copy-pasted across endpoints.

    Requires :amenity_cats to be bound in the params dict passed to
    execute() — a list, see AMENITY_CATS above.
    """
    return """
        CASE
            WHEN f.transaction_category = 'Villa' THEN 'Villa'
            WHEN f.transaction_category = ANY(:amenity_cats) THEN 'Amenities'
            ELSE 'Services'
        END
    """


def _bucket_case_sql() -> str:
    """
    Classifies a folio row by transaction_flow / payment_type into the
    same four buckets category-comp-breakdown already shows separately:

      'collected'        — an actual paid charge. This is REVENUE.
      'forgone_revenue'  — a comped/free charge. $0 was actually
                            collected, even though the row carries a
                            face-value amount. (Renamed from
                            'given_away' — label/value only, logic
                            unchanged for Amenities/Services.)
      'reversed'          — a refunded/voided charge.
      'other'             — anything that isn't a Charge at all
                            (payments against balance, adjustments,
                            etc.) — NOT revenue.

    Only 'collected' rows should ever be summed into a revenue figure.

    IMPORTANT: For the Villa section, this bucket's 'forgone_revenue'
    classification is no longer used to compute the Villa Forgone
    Revenue figure shown to users — that now comes from rate_details
    via _villa_forgone_revenue_sql(). This CASE is still used for
    Villa's 'collected' / 'reversed' buckets (unchanged), and for the
    full Amenities/Services breakdown (unchanged other than the label
    rename), and for /overview's revenue filter (unchanged — revenue
    only ever summed the 'collected' bucket, never 'forgone_revenue').

    Requires a LEFT JOIN business_source bs ON
    LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name)) in the query
    that uses this (same join category_comp_breakdown uses).
    """
    return """
        CASE
            WHEN f.transaction_flow = 'Reversal' THEN 'reversed'
            WHEN f.transaction_flow != 'Charge' THEN 'other'
            WHEN LOWER(
                COALESCE(NULLIF(TRIM(f.payment_type), ''), NULLIF(TRIM(bs.payment_type), ''), '')
            ) ~ '(comp|free|complimentary|gratis|no charge)'
                THEN 'forgone_revenue'
            ELSE 'collected'
        END
    """


def _villa_bookings_date_filter_sql() -> str:
    """
    ⚠️ DEPRECATED / CURRENTLY UNUSED as of the rate_details Villa
    Revenue migration: /overview and /villa-revenue no longer read
    overview_villa_bookings — see _villa_gross_revenue_cte_sql() and
    _villa_revenue_date_filter_sql(). Left in place (not deleted) since
    removing dead code wasn't part of this change and something outside
    this file may still reference overview_villa_bookings directly.
    Safe to delete in a follow-up cleanup once confirmed unused
    project-wide.

    Date-range overlap filter for overview_villa_bookings (alias `ovb`),
    intended to match the semantics of analytics_shared.date_filter_sql()
    — "does this booking's stay overlap the requested period" — but
    written against overview_check_in_date / overview_check_out_date
    instead of folios' check_in_date / check_out_date, since
    date_filter_sql() is hard-wired to the `f` alias and folios' column
    names (per the module docstring above).

    Expects the same bind params filter_params() already produces:
    :year, :month, :date, :start_date, :end_date.

    ⚠️ REVIEW NOTE: analytics_shared.py wasn't available to me, so this
    re-derives the overlap logic from the comments documented elsewhere
    in this file rather than calling date_filter_sql() directly — please
    sanity-check it against the real implementation. If date_filter_sql()
    can be generalized to accept a custom alias + start/end column pair
    (e.g. date_filter_sql(alias="ovb", column="overview_check_in_date",
    end_column="overview_check_out_date")), delete this function and call
    that instead, so there's only one date-overlap implementation in the
    codebase rather than two that could drift apart.
    """
    return """
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    ovb.overview_check_in_date  <= COALESCE(:end_date, ovb.overview_check_in_date)
                    AND ovb.overview_check_out_date >= COALESCE(:start_date, ovb.overview_check_out_date)
                WHEN :date IS NOT NULL THEN
                    ovb.overview_check_in_date  <= :date
                    AND ovb.overview_check_out_date >= :date
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    ovb.overview_check_in_date  <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                    AND ovb.overview_check_out_date >= MAKE_DATE(:year, :month, 1)
                WHEN :year IS NOT NULL THEN
                    ovb.overview_check_in_date  <= MAKE_DATE(:year, 12, 31)
                    AND ovb.overview_check_out_date >= MAKE_DATE(:year, 1, 1)
                ELSE TRUE
            END
        )
    """


def _rate_details_date_filter_sql() -> str:
    """
    Date-range overlap filter for rate_details (alias `rd`), matching
    the same "does this stay overlap the requested period" semantics
    as date_filter_sql() / _villa_bookings_date_filter_sql(), but
    written against rate_details.check_in_date / rate_details.check_out_date.

    This backs the new rate_details-sourced Villa Forgone Revenue
    calculation (see _villa_forgone_revenue_sql()) so it honors the
    same year / month / date / start_date / end_date filters every
    other Finance endpoint does.

    Expects the same bind params filter_params() already produces:
    :year, :month, :date, :start_date, :end_date.
    """
    return """
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    rd.check_in_date  <= COALESCE(:end_date, rd.check_in_date)
                    AND rd.check_out_date >= COALESCE(:start_date, rd.check_out_date)
                WHEN :date IS NOT NULL THEN
                    rd.check_in_date  <= :date
                    AND rd.check_out_date >= :date
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    rd.check_in_date  <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                    AND rd.check_out_date >= MAKE_DATE(:year, :month, 1)
                WHEN :year IS NOT NULL THEN
                    rd.check_in_date  <= MAKE_DATE(:year, 12, 31)
                    AND rd.check_out_date >= MAKE_DATE(:year, 1, 1)
                ELSE TRUE
            END
        )
    """


def _villa_forgone_revenue_sql() -> str:
    """
    Villa Forgone Revenue — SOURCE OF TRUTH IS rate_details, not folios.

    Forgone Revenue = SUM(COALESCE(original_amount, 0)) over
    rate_details rows where payment_type = 'Free', excluding
    VILLA_FORGONE_EXCLUDED (Villa Lolita / Wonderland).

    ⚠️ OPEN QUESTION: this does NOT filter on status = 'Posted', unlike
    _villa_gross_revenue_cte_sql() (Paid rows), which does. Not changed
    yet since it wasn't part of the reported discrepancy — but if
    'Free' rows can also have a non-'Posted' status (e.g. pending/
    voided), this may be over-counting Forgone Revenue the same way
    Gross Revenue was found to need the filter for Paid rows. Worth
    the same kind of validation check before adding it here.

    Also returns:
      missing_rate_count — rows where original_amount IS NULL (counted
        as 0 in the sum per COALESCE, but tracked separately so the UI
        can flag incomplete underlying data instead of silently
        understating the figure).
      total_free_rows    — total in-scope free-villa rows, used by the
        caller to derive calculation_coverage =
        (total_free_rows - missing_rate_count) / total_free_rows.
      unique_accounts     — distinct member_number across in-scope rows.

    {villa_filter} is interpolated by the caller — either empty, or
    "AND rd.villa_name = :flt_villa" when a villa filter was supplied.
    {date_sql} is _rate_details_date_filter_sql().

    Requires :villa_exceptions (list) and the standard filter_params()
    bind set (:year, :month, :date, :start_date, :end_date) in params.
    """
    return """
        SELECT
            COALESCE(SUM(COALESCE(rd.original_amount, 0)), 0)  AS forgone_revenue,
            COUNT(*) FILTER (WHERE rd.original_amount IS NULL) AS missing_rate_count,
            COUNT(*)                                            AS total_free_rows,
            COUNT(DISTINCT rd.member_number)                   AS unique_accounts
        FROM rate_details rd
        WHERE rd.payment_type = 'Free' 
        AND rd.status = 'Posted' 
        AND NOT (rd.villa_name = ANY(:villa_exceptions))
        {villa_filter}
        {date_sql}
    """


def _villa_forgone_revenue_row(params: dict, villa: Optional[str] = None) -> dict:
    """
    Runs _villa_forgone_revenue_sql() and returns a dict with
    forgoneRevenue, missingRateCount, totalFreeRows, uniqueAccounts,
    and calculationCoverage (float in [0, 1], or None if there were
    zero free villa rows in scope — avoids a divide-by-zero and lets
    the frontend distinguish "0% covered" from "no free stays at all").

    `params` must already contain the standard filter_params() bind
    set (:year, :month, :date, :start_date, :end_date) — this function
    adds :villa_exceptions and, if `villa` is given, :flt_villa on a
    copy of that dict (never mutates the caller's params).
    """
    q_params = dict(params)
    q_params["villa_exceptions"] = list(VILLA_FORGONE_EXCLUDED)
    villa_filter = ""
    if villa:
        villa_filter = "AND rd.villa_name = :flt_villa"
        q_params["flt_villa"] = villa

    sql = text(_villa_forgone_revenue_sql().format(
        villa_filter=villa_filter,
        date_sql=_rate_details_date_filter_sql(),
    ))

    with engine.connect() as conn:
        row = conn.execute(sql, q_params).mappings().fetchone()

    total_free = int(row["total_free_rows"] or 0)
    missing = int(row["missing_rate_count"] or 0)
    coverage = ((total_free - missing) / total_free) if total_free else None

    return {
        "forgoneRevenue":      float(row["forgone_revenue"] or 0),
        "missingRateCount":    missing,
        "totalFreeRows":       total_free,
        "uniqueAccounts":      int(row["unique_accounts"] or 0),
        "calculationCoverage": coverage,
    }


def _villa_revenue_date_filter_sql(alias: str = "vr") -> str:
    """
    Period filter for the rate_details-sourced Villa Gross Revenue
    calculation (see _villa_gross_revenue_cte_sql()).

    DELIBERATELY DIFFERENT from _rate_details_date_filter_sql(): that
    one is a stay-OVERLAP filter (used for Forgone Revenue, which
    counts each free row on its own rate_date). Gross Revenue instead
    buckets an entire reservation into a single revenue month based on
    check_in_date only, per the business rule ("use check_in_date to
    determine the revenue month/year"). A 7-night stay spanning two
    calendar months contributes its whole total_rental to the
    check-in month, not split across both.

    {alias} must expose a `check_in_date` column — the dedup CTE's
    output column, not rate_details' raw (repeated) one.

    Expects the same bind params filter_params() already produces:
    :year, :month, :date, :start_date, :end_date.
    """
    return f"""
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    {alias}.check_in_date >= COALESCE(:start_date, {alias}.check_in_date)
                    AND {alias}.check_in_date <= COALESCE(:end_date, {alias}.check_in_date)
                WHEN :date IS NOT NULL THEN
                    {alias}.check_in_date = :date
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    {alias}.check_in_date >= MAKE_DATE(:year, :month, 1)
                    AND {alias}.check_in_date <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                WHEN :year IS NOT NULL THEN
                    {alias}.check_in_date >= MAKE_DATE(:year, 1, 1)
                    AND {alias}.check_in_date <= MAKE_DATE(:year, 12, 31)
                ELSE TRUE
            END
        )
    """


def _villa_gross_revenue_cte_sql() -> str:
    """
    Reservation-level dedup CTE — SOURCE OF TRUTH FOR GROSS VILLA
    REVENUE. Replaces the prior overview_villa_bookings source for
    /overview's villasRevenue card and /villa-revenue's per-villa table.

    WHY THE DEDUP IS NECESSARY:
    rate_details is a nightly/rate-date grain table — one row per
    (reservation, rate_date). total_rental is a RESERVATION-level
    total that is repeated verbatim on every nightly row belonging to
    that reservation. Summing total_rental directly over raw rows
    would multiply every reservation's revenue by its length of stay
    (e.g. a 7-night, $76,727.49 reservation would sum to $537,092.43
    instead of $76,727.49). This CTE collapses each reservation down
    to exactly one row before any SUM() happens.

    DEDUP KEY: COALESCE(NULLIF(TRIM(reservation_id), ''), NULLIF(TRIM(conf_code), ''))
    reservation_id is preferred; conf_code is the fallback for rows
    where reservation_id is null/blank. Rows where BOTH are null/blank
    are excluded (res_key IS NULL) — there is no safe way to identify
    which rows belong to the same reservation for those, so they
    cannot be deduplicated and are dropped rather than risk either
    double-counting or under-counting. This should be rare; monitor
    row counts if it isn't.

    SCOPE: payment_type = 'Paid' AND status = 'Posted' only, per the
    business rule (status='Posted' added after validating against a
    manual SUM(original_amount) check — see chat history). Rows with
    payment_type = 'Free' (and anything else) are excluded, same as
    before — this endpoint no longer touches Forgone Revenue at all,
    that stays on _villa_forgone_revenue_sql() (which does NOT filter
    on status — only on payment_type = 'Free' — see that function's
    own docstring for the open question of whether it should match).

    NOTE: does NOT filter on reservation_status (e.g. cancelled
    bookings). The business rule as given only specifies payment_type
    = 'Paid'; if cancelled-but-paid reservations should be excluded
    from gross revenue, that's a follow-up filter to add here, not
    assumed by this change.

    Selects one row per reservation with: res_key, villa_name,
    member_number, total_rental, check_in_date, check_out_date.
    Callers wrap this CTE with their own SELECT ... FROM
    villa_reservations vr {_villa_revenue_date_filter_sql()} GROUP BY ...
    """
    return """
        WITH rd_keyed AS (
            SELECT
                rd.villa_name,
                rd.member_number,
                rd.total_rental,
                rd.check_in_date,
                rd.check_out_date,
                rd.rate_date,
                COALESCE(NULLIF(TRIM(rd.reservation_id), ''), NULLIF(TRIM(rd.conf_code), '')) AS res_key
            FROM rate_details rd
            WHERE rd.payment_type = 'Paid'
              AND rd.villa_name IS NOT NULL
              AND rd.status = 'Posted'
        ),
        villa_reservations AS (
            SELECT DISTINCT ON (res_key)
                res_key, villa_name, member_number, total_rental, check_in_date, check_out_date
            FROM rd_keyed
            WHERE res_key IS NOT NULL
            ORDER BY res_key, rate_date
        )
    """


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
    stay-overlap) so this figure always equals what /overview's
    villasRevenue card and /villa-revenue's total show for the same
    filters — they're now literally the same query, just wrapped
    differently. If those ever need to diverge, don't just edit this
    function in isolation, since they're meant to be identical.

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


def _statement_period_filter_sql(alias: str = "sd") -> str:
    """
    Filters {alias}.statement_period by year and/or month, PARSED via
    TO_DATE({alias}.statement_period, 'Month, YYYY') rather than built
    and string-matched — this mirrors the exact parsing approach
    validated against real data (statement_period is stored as e.g.
    "March, 2025": full month name, comma, space, 4-digit year), and
    is more robust than an equality match against a hand-built string
    (tolerant of any stray whitespace/case in the stored text that a
    generated string wouldn't happen to reproduce).

    Both :year and :month are OPTIONAL (unlike _rate_details_date_filter_sql's
    bind set) — this lets one query answer three different questions,
    matching the three granularities actually needed:
      year AND month given -> single-month total
      year given, month NULL -> that year's total
      neither given          -> all-time total
    """
    return f"""
        AND (
            :year IS NULL
            OR EXTRACT(YEAR FROM TO_DATE({alias}.statement_period, 'Month, YYYY')) = :year
        )
        AND (
            :month IS NULL
            OR EXTRACT(MONTH FROM TO_DATE({alias}.statement_period, 'Month, YYYY')) = :month
        )
    """


# Shared FastAPI Query declarations for the 5 date-filter params, reused
# (by re-declaration, since FastAPI needs them per-route-signature) on
# every endpoint below. Centralized here only as a comment-level contract:
#
#   year:       Optional[int]  = Query(None)
#   month:      Optional[int]  = Query(None)
#   date:       Optional[date] = Query(None)
#   start_date: Optional[date] = Query(None)
#   end_date:   Optional[date] = Query(None)
#
# All five are passed straight into filter_params(...) from
# analytics_shared.py, which is the same call signature Visits & Rooms uses.


# ══════════════════════════════════════════════════════════════════
# COMPOSABLE DRILLDOWN FILTERS
#
# Single implementation of "what does each filter dimension mean in
# SQL", shared by /drilldown (flat records) and /drilldown-breakdown
# (grouped totals) so a stacked filter set means exactly the same
# thing — and sums to exactly the same number — no matter which
# endpoint produced the screen the user is looking at.
# ══════════════════════════════════════════════════════════════════
def _apply_common_filters(
    where_clauses: list,
    params: dict,
    *,
    source: Optional[str] = None,
    villa: Optional[str] = None,
    customer: Optional[str] = None,
    payment: Optional[str] = None,
    amenity: Optional[str] = None,
    category: Optional[str] = None,
    section: Optional[str] = None,
) -> None:
    """
    Append AND-able WHERE clauses (+ matching bind params) for every
    filter dimension that's actually set (non-None/non-empty).

    Each dimension is independent and they compose with a plain AND —
    e.g. payment='free' + villa='Solaria Villa' returns only the
    free-of-charge folio rows for that villa. This is the mechanism
    that makes "preserve filters while drilling deeper" possible: the
    frontend just keeps merging new dimensions into the same dict
    instead of replacing it.

    Callers must already have `f` (folios), a LEFT JOIN'd `bs`
    (business_source), and a LEFT JOIN'd `m` (members) in scope, since
    `payment` reads bs.payment_type and `customer` reads
    m.member_or_guest.

    NOTE: this powers /drilldown and /drilldown-breakdown, both of
    which still read from folios. It is NOT used by the rate_details-
    sourced Villa Forgone Revenue calculation (see
    _villa_forgone_revenue_sql()), which has its own filter handling.
    """
    if source:
        where_clauses.append("AND f.source = :flt_source")
        params["flt_source"] = source

    if villa:
        where_clauses.append("AND f.villa_name = :flt_villa")
        params["flt_villa"] = villa

    if customer == "Member":
        where_clauses.append("AND (m.member_or_guest IS NULL OR m.member_or_guest != 'Guest')")
    elif customer == "Guest":
        where_clauses.append("AND m.member_or_guest = 'Guest'")

    if payment == "free":
        where_clauses.append("AND bs.payment_type = 'Free'")
    elif payment == "paid":
        where_clauses.append("AND bs.payment_type = 'Paid'")

    if amenity and amenity in AMENITY_KEYWORDS:
        like_clauses = " OR ".join(
            f"LOWER(f.description) LIKE '%{kw}%'" for kw in AMENITY_KEYWORDS[amenity]
        )
        where_clauses.append(f"AND ({like_clauses})")

    if category:
        where_clauses.append("AND f.transaction_category = :flt_category")
        params["flt_category"] = category

    if section in ("Amenities", "Services"):
        where_clauses.append(f"AND ({_section_case_sql()}) = :flt_section")
        params["amenity_cats"] = list(AMENITY_CATS)
        params["flt_section"] = section
        # /overview's Amenities/Services figures only count the
        # 'collected' bucket (see _bucket_case_sql() docstring) — match
        # that by default so a plain section drill sums to the card
        # total. But if the caller has ALSO picked an explicit payment
        # bucket (stacked filters, e.g. section='Amenities'&payment='free'),
        # that explicit choice wins instead of silently zeroing the
        # result out against the 'collected'-only default.
        if not payment:
            where_clauses.append(f"AND ({_bucket_case_sql()}) = 'collected'")


def _legacy_type_value_to_filters(type_: Optional[str], value: Optional[str]) -> dict:
    """
    Maps the old single-dimension `type`/`value` query params onto the
    new structured filter dict, purely for backward compatibility with
    callers that haven't moved to the explicit param names (source /
    villa / customer / payment / amenity / category / section).
    """
    if not type_:
        return {}
    if type_ == "source":
        return {"source": value}
    if type_ == "villa":
        return {"villa": value}
    if type_ == "customer":
        return {"customer": value or "Member"}
    if type_ == "paid":
        return {"payment": "paid"}
    if type_ in ("free", "complimentary"):
        # 'complimentary' kept for backwards compat — maps to 'free'
        return {"payment": "free"}
    if type_ == "amenity":
        return {"amenity": value}
    if type_ == "category":
        return {"category": value}
    if type_ == "section":
        return {"section": value}
    return {}


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

    # ── Villas (rate_details, reservation-deduped gross revenue) ─────
    # SOURCE OF TRUTH CHANGE: was overview_villa_bookings.overview_villa_revenue,
    # now rate_details via _villa_gross_revenue_cte_sql() — see that
    # function's docstring for why the dedup is required and what it
    # excludes/assumes.
    villa_sql = text(f"""
        {_villa_gross_revenue_cte_sql()}
        SELECT
            COALESCE(SUM(vr.total_rental), 0) AS revenue,
            COUNT(*)                          AS bookings
        FROM villa_reservations vr
        WHERE 1=1
        {_villa_revenue_date_filter_sql(alias="vr")}
    """)

    with engine.connect() as conn:
        villa_row = conn.execute(villa_sql, params).fetchone()

    villas_revenue = float(villa_row[0] or 0) if villa_row else 0.0

    total_revenue = villas_revenue + amenities_revenue + services_revenue

    return {
        "totalRevenue":      total_revenue,
        "villasRevenue":     villas_revenue,
        "amenitiesRevenue":  amenities_revenue,
        "servicesRevenue":   services_revenue,
        "totalTransactions": total_transactions,
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
                ROUND(SUM(ABS(sd.amount)), 2)        AS net_revenue,
                ROUND(SUM(ABS(sd.amount)) / 0.85, 2) AS statement_gross_revenue
            FROM villa_owner_map vom
            JOIN statement_details sd ON sd.member_number = vom.member_number
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
            ROUND(SUM(ABS(sd.amount)), 2)        AS net_revenue,
            ROUND(SUM(ABS(sd.amount)) / 0.85, 2) AS statement_gross_revenue
        FROM villa_owner_map vom
        JOIN statement_details sd ON sd.member_number = vom.member_number
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
# 2. REVENUE BY SOURCE
# One row per source — group only by f.source, not by payment_type
# payment_type comes from business_source (one value per source)
# ══════════════════════════════════════════════════════════════════
@router.get("/source-breakdown")
def finance_source_breakdown(
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
    date_sql = date_filter_sql()

    sql = text(f"""
        SELECT
            COALESCE(f.source, 'Unknown')  AS source_name,
            MAX(bs.payment_type)           AS payment_type,
            SUM(f.amount)                  AS revenue,
            COUNT(*)                       AS transactions
        FROM folios f
        LEFT JOIN business_source bs ON bs.source_name = f.source
        WHERE f.amount IS NOT NULL
        {date_sql}
        GROUP BY f.source
        ORDER BY revenue DESC NULLS LAST
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql, params))

    return [
        {
            "source":       r["source_name"],
            "paymentType":  r["payment_type"] or "Unknown",
            "revenue":      float(r["revenue"] or 0),
            "transactions": int(r["transactions"] or 0),
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# 3. MEMBER vs GUEST
# member_or_guest = 'Guest'        → Guest
# member_or_guest IS NULL          → Member (assumption per business rule)
# member_or_guest = 'Member'       → Member (additional rule)
# (member_type moved from folios -> members; join on member_number)
# ══════════════════════════════════════════════════════════════════
@router.get("/member-vs-guest")
def finance_member_vs_guest(
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
    date_sql = date_filter_sql()

    sql = text(f"""
        SELECT
            CASE
                WHEN m.member_or_guest = 'Guest' THEN 'Guests'
                ELSE 'Member'
            END                      AS customer_type,
            SUM(f.amount)            AS revenue,
            COUNT(*)                 AS transactions,
            COUNT(DISTINCT
                CASE WHEN (m.member_or_guest IS NULL OR m.member_or_guest != 'Guest')
                     THEN f.member_number
                     ELSE f.guest_name
                END
            )                        AS unique_accounts
        FROM folios f
        LEFT JOIN members m
            ON m.member_number = f.member_number
        WHERE f.amount IS NOT NULL
        {date_sql}
        GROUP BY customer_type
        ORDER BY revenue DESC
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql, params))

    return [
        {
            "customerType":   r["customer_type"],
            "revenue":        float(r["revenue"] or 0),
            "transactions":   int(r["transactions"] or 0),
            "uniqueAccounts": int(r["unique_accounts"] or 0),
        }
        for r in rows
    ]

# ══════════════════════════════════════════════════════════════════
# 4. VILLA REVENUE (breakdown table, by villa name)
#
# SOURCE OF TRUTH CHANGE: was overview_villa_bookings.overview_villa_revenue,
# now rate_details via _villa_gross_revenue_cte_sql() — same
# reservation-deduped source as /overview's villasRevenue card, so
# this table's rows still always sum to that card's total (same
# invariant the prior overview_villa_bookings migration established,
# just on the new source). See _villa_gross_revenue_cte_sql()'s
# docstring for why the dedup is required.
#
# total_bookings = COUNT(*) over the deduped villa_reservations CTE —
# already one row per reservation, so no DISTINCT needed here (unlike
# the old overview_conf_code defensive DISTINCT).
#
# roomNights / avgStay are now derived from check_out_date -
# check_in_date per deduped reservation (rate_details carries both),
# rather than a pre-computed overview_nights column.
#
# memberBookings / guestBookings now come from a LEFT JOIN to members
# on rate_details.member_number (rate_details itself has no
# member_or_guest column). A reservation whose member_number has no
# match in `members` (e.g. a walk-in guest with no member record) is
# counted as a guest booking, mirroring the member-vs-guest default
# used elsewhere in this file (member_or_guest IS NULL -> Member is
# the default ONLY when there's a members row at all; no members row
# means there's no member to attribute it to).
#
# NOTE: this table has no payment-type (paid/free) breakdown — same
# as before, rate_details' 'Free' rows are out of scope for gross
# revenue by design. For a payment-aware per-villa breakdown, use
# GET /finance/drilldown-breakdown?group_by=villa&payment=free
# (folios-sourced, unaffected by this change). For Villa Net Revenue
# and gross/net reconciliation, see the new
# GET /finance/villa-revenue-reconciliation endpoint below.
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
        {_villa_gross_revenue_cte_sql()}
        SELECT
            vr.villa_name                                                AS villa_name,
            COALESCE(SUM(vr.total_rental), 0)                            AS revenue,
            COUNT(*)                                                     AS total_bookings,
            COALESCE(SUM(vr.check_out_date - vr.check_in_date), 0)       AS room_nights,
            COALESCE(ROUND(AVG(vr.check_out_date - vr.check_in_date)::numeric, 1), 0) AS avg_stay,
            COUNT(*) FILTER (
                WHERE m.member_or_guest = 'Guest' OR m.member_number IS NULL
            )                                                             AS guest_bookings,
            COUNT(*) FILTER (
                WHERE m.member_number IS NOT NULL
                  AND (m.member_or_guest IS NULL OR m.member_or_guest != 'Guest')
            )                                                             AS member_bookings
        FROM villa_reservations vr
        LEFT JOIN members m ON m.member_number = vr.member_number
        WHERE 1=1
        {_villa_revenue_date_filter_sql(alias="vr")}
        GROUP BY vr.villa_name
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
# 5. AMENITY REVENUE
#
# amenity_season_spend is also a pre-aggregated table with no per-row
# dates. Unfiltered requests use it (and keep the season breakdown).
# Any date filter falls back to deriving amenity from folio
# descriptions and aggregating off folios directly, with
# date_filter_sql() applied — same fallback query this endpoint
# already had for the empty-table case, just now filterable.
# Season-level breakdown isn't available on the folios fallback path.
# ══════════════════════════════════════════════════════════════════
@router.get("/amenity-revenue")
def finance_amenity_revenue(
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
    has_filter = any(v is not None for v in params.values())

    if not has_filter:
        sql = text("""
            SELECT
                amenity,
                SUM(total_spend)       AS revenue,
                SUM(transaction_count) AS transactions,
                COUNT(DISTINCT season) AS season_count
            FROM amenity_season_spend
            WHERE amenity IS NOT NULL
            GROUP BY amenity
            ORDER BY revenue DESC
        """)
        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql))

        if rows:
            sql_seasons = text("""
                SELECT
                    amenity,
                    season,
                    total_spend        AS revenue,
                    transaction_count  AS transactions
                FROM amenity_season_spend
                WHERE amenity IS NOT NULL
                ORDER BY amenity, revenue DESC
            """)
            with engine.connect() as conn:
                season_rows = _rows_to_dicts(conn.execute(sql_seasons))

            season_by_amenity: dict = {}
            for sr in season_rows:
                season_by_amenity.setdefault(sr["amenity"], []).append({
                    "season":       sr["season"],
                    "revenue":      float(sr["revenue"] or 0),
                    "transactions": int(sr["transactions"] or 0),
                })

            return [
                {
                    "amenity":      r["amenity"],
                    "revenue":      float(r["revenue"] or 0),
                    "transactions": int(r["transactions"] or 0),
                    "seasonCount":  int(r["season_count"] or 0),
                    "seasons":      season_by_amenity.get(r["amenity"], []),
                }
                for r in rows
            ]

    # Date-filtered (or summary table empty) path
    amenity_sql = _amenity_case_sql()
    date_sql = date_filter_sql()
    sql2 = text(f"""
        SELECT
            {amenity_sql} AS amenity,
            SUM(f.amount)  AS revenue,
            COUNT(*)       AS transactions
        FROM folios f
        WHERE f.amount IS NOT NULL
        {date_sql}
        GROUP BY amenity
        ORDER BY revenue DESC
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql2, params))

    return [
        {
            "amenity":      r["amenity"],
            "revenue":      float(r["revenue"] or 0),
            "transactions": int(r["transactions"] or 0),
            "seasonCount":  0,
            "seasons":      [],
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# 6. DRILL-DOWN — underlying folio records
# Enriched with member contact details from members + member_addresses + member_phones
# Ordered highest amount first
# Supports the full composable filter set (see module docstring) plus
# year / month / date / start_date / end_date via the shared
# date_filter_sql() + filter_params() pattern.
#
# `type`/`value` are accepted only for backward compatibility — see
# _legacy_type_value_to_filters(). New callers should pass the
# structured params (source / villa / customer / payment / amenity /
# category / section) directly, and can pass MULTIPLE of them at once
# to stack filters (e.g. payment=free&category=Villa).
#
# NOTE: this endpoint still reads from folios, unchanged by the
# Villa Forgone Revenue methodology change — it shows the underlying
# folio line items, not the rate_details-sourced forgone figure.
#
# NO LIMIT: previously capped at 200 rows by default / 500 max. Removed
# entirely per explicit request — every matching row is now returned.
# ⚠️ There is no pagination on this endpoint (unlike /drilldown-breakdown
# below) — a wide date range with no other filters can return a very
# large result set. If that turns out to be a real problem in practice
# (slow queries, huge payloads), the fix is the same pagination pattern
# used below, not re-adding a silent cap.
# ══════════════════════════════════════════════════════════════════
@router.get("/drilldown")
def finance_drilldown(
    type:       Optional[str] = Query(None, description="Legacy single-filter key — back-compat only"),
    value:      Optional[str] = Query(None, description="Legacy single-filter value — back-compat only"),
    source:     Optional[str] = Query(None),
    villa:      Optional[str] = Query(None),
    customer:   Optional[str] = Query(None, description="'Member' | 'Guest'"),
    payment:    Optional[str] = Query(None, description="'paid' | 'free'"),
    amenity:    Optional[str] = Query(None),
    category:   Optional[str] = Query(None),
    section:    Optional[str] = Query(None, description="'Amenities' | 'Services'"),
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
):
    # Fold the legacy type/value pair in as one more dimension — it
    # only fills a slot that isn't already explicitly set, so a caller
    # mixing both styles (e.g. a not-yet-migrated child component still
    # sending type=villa&value=X alongside an explicit payment=free
    # added by the drawer) gets both applied rather than one clobbering
    # the other.
    legacy = _legacy_type_value_to_filters(type, value)
    source   = source   or legacy.get("source")
    villa    = villa    or legacy.get("villa")
    customer = customer or legacy.get("customer")
    payment  = payment  or legacy.get("payment")
    amenity  = amenity  or legacy.get("amenity")
    category = category or legacy.get("category")
    section  = section  or legacy.get("section")

    base = """
        SELECT
            f.folio_key,
            f.transaction_date,
            f.description,
            f.amount,
            f.folio_num,
            f.folio_name,
            f.conf_code,
            f.member_number,
            f.guest_name,
            f.check_in_date,
            f.check_out_date,
            f.room_number,
            f.villa_name,
            f.source,
            f.payment_type         AS folio_payment_type,
            m.member_type,
            f.reservation_status,
            bs.payment_type        AS source_payment_type,
            m.email                AS member_email,
            mp.phone_number        AS member_phone,
            ma.city                AS member_city,
            ma.country             AS member_country
        FROM folios f
        LEFT JOIN business_source bs  ON bs.source_name = f.source
        LEFT JOIN members m           ON m.member_number = f.member_number
        LEFT JOIN LATERAL (
            SELECT phone_number
            FROM member_phones
            WHERE member_number = f.member_number
            ORDER BY id
            LIMIT 1
        ) mp ON true
        LEFT JOIN member_addresses ma ON ma.member_number = f.member_number
        WHERE f.amount IS NOT NULL
    """

    params: dict = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )
    where_clauses: list = [date_filter_sql()]  # alias="f", column="check_in_date"

    _apply_common_filters(
        where_clauses, params,
        source=source, villa=villa, customer=customer, payment=payment,
        amenity=amenity, category=category, section=section,
    )

    where_str = "\n        ".join(where_clauses)
    order = "ORDER BY f.amount DESC NULLS LAST, f.transaction_date DESC NULLS LAST"
    full_sql = text(f"{base}\n        {where_str}\n        {order}")

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(full_sql, params))

    return [
        {
            "folioKey":          r["folio_key"],
            "transactionDate":   str(r["transaction_date"]) if r["transaction_date"] else None,
            "description":       r["description"],
            "amount":            float(r["amount"] or 0),
            "folioNum":          r["folio_num"],
            "folioName":         r["folio_name"],
            "confCode":          r["conf_code"],
            "memberNumber":      r["member_number"],
            "guestName":         r["guest_name"],
            "checkInDate":       str(r["check_in_date"])  if r["check_in_date"]  else None,
            "checkOutDate":      str(r["check_out_date"]) if r["check_out_date"] else None,
            "roomNumber":        r["room_number"],
            "villaName":         r["villa_name"],
            "source":            r["source"],
            "paymentType":       r["source_payment_type"] or r["folio_payment_type"],
            "memberType":        r["member_type"],
            "reservationStatus": r["reservation_status"],
            "memberEmail":       r["member_email"],
            "memberPhone":       r["member_phone"],
            "memberCity":        r["member_city"],
            "memberCountry":     r["member_country"],
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# 7. DRILL-DOWN BREAKDOWN — grouped totals for a given dimension,
#    scoped by every OTHER active filter.
#
# Powers the drawer's mid-level "browse by…" breakdown lists (e.g.
# drilling into "Free" and then choosing to see it broken down by
# villa) using the exact same _apply_common_filters() logic /drilldown
# uses, so the numbers shown here always sum to what /drilldown's flat
# record list returns for the same accumulated filter set. This is
# what makes "Free -> Villas" show free-of-charge revenue PER VILLA
# instead of each villa's all-time total.
#
# The dimension passed as `group_by` is intentionally excluded from
# its own filter — e.g. group_by=villa ignores an incoming villa=
# filter, since grouping by a dimension you've already pinned to one
# value would just produce a single row.
#
# VILLA-SCOPED SOURCE SWITCH: group_by=villa now branches on whether
# the active drill is Villa-scoped (category='Villa' OR section='Villa'):
#   Villa-scoped     -> rate_details (see below) — matches the
#                       methodology used everywhere else in this file
#                       for Villa gross/collected/forgone revenue.
#   NOT Villa-scoped -> unchanged, still folios (e.g. "Spa revenue ->
#                       browse by villa" is a folios-only question;
#                       rate_details has no amenity-spend data at all).
# Within the Villa-scoped branch, `payment` selects which rate_details
# figure per villa:
#   payment == 'free' -> Forgone Revenue per villa (SUM(original_amount),
#                        payment_type='Free', excludes Villa Lolita/
#                        Wonderland — same rule as _villa_forgone_revenue_sql())
#   otherwise          -> Gross/Collected Revenue per villa (the same
#                        reservation-deduped CTE used by /overview,
#                        /villa-revenue, and category-comp-breakdown's
#                        Villa 'collected' row)
# ⚠️ LIMITATION: source / customer / amenity filters have no
# rate_details equivalent (rate_details has no such columns) and are
# NOT applied in the Villa-scoped branch — only `payment` and the
# standard date filters do anything there. If those filters are ever
# set alongside category='Villa'&group_by=villa in practice, they're
# silently ignored rather than producing a wrong number under a
# filter that looks like it applied.
#
# PAGINATION: replaces the old hard LIMIT (50 default / 200 max) with
# real Prev/Next paging — `page` (1-based) and `page_size`. Response
# is now an envelope {items, page, pageSize, totalItems, totalPages}
# instead of a bare list — this is a BREAKING CHANGE to the response
# shape, the frontend must be updated to match (see RevenueBreakdownDrawer.jsx).
# Pagination is done in Python over the full grouped result set for
# all three source branches (folios / rate_details gross / rate_details
# forgone) via one shared _paginate() helper, rather than three
# different SQL LIMIT/OFFSET implementations — these are aggregated
# group-by results (at most one row per distinct villa/source/category/
# customer/amenity), not raw transaction volume, so pulling the full
# set before slicing is not a performance concern the way it would be
# for /drilldown's flat records.
#
# NOTE: /drilldown-breakdown for non-villa group_by dimensions is
# otherwise unchanged by the Villa Forgone Revenue methodology change
# — still reads folios, same as /drilldown.
# ══════════════════════════════════════════════════════════════════
def _paginate(rows: list, page: int, page_size: int) -> dict:
    """
    Shared pagination helper for /drilldown-breakdown's three source
    branches. Slices an already-fully-fetched, already-sorted list of
    dicts; does not touch SQL. `rows` must already be sorted the way
    the caller wants (all three branches sort by revenue DESC).
    """
    total_items = len(rows)
    total_pages = max(1, math.ceil(total_items / page_size)) if page_size else 1
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": rows[start:end],
        "page": page,
        "pageSize": page_size,
        "totalItems": total_items,
        "totalPages": total_pages,
    }


_BREAKDOWN_GROUPS = {
    "villa":    {"expr": "f.villa_name", "requires_not_null": True},
    "source":   {"expr": "COALESCE(NULLIF(TRIM(f.source), ''), 'Unknown')", "requires_not_null": False},
    "category": {"expr": "COALESCE(NULLIF(TRIM(f.transaction_category), ''), 'Uncategorized')", "requires_not_null": False},
    "customer": {"expr": "CASE WHEN m.member_or_guest = 'Guest' THEN 'Guest' ELSE 'Member' END", "requires_not_null": False},
    "amenity":  {"expr": _amenity_case_sql(), "requires_not_null": False},
}


@router.get("/drilldown-breakdown")
def finance_drilldown_breakdown(
    group_by:   str           = Query(..., pattern="^(villa|source|category|customer|amenity)$"),
    type:       Optional[str] = Query(None),
    value:      Optional[str] = Query(None),
    source:     Optional[str] = Query(None),
    villa:      Optional[str] = Query(None),
    customer:   Optional[str] = Query(None),
    payment:    Optional[str] = Query(None),
    amenity:    Optional[str] = Query(None),
    category:   Optional[str] = Query(None),
    section:    Optional[str] = Query(None),
    page:       int           = Query(1, ge=1),
    page_size:  int           = Query(25, ge=1, le=500),
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
):
    legacy = _legacy_type_value_to_filters(type, value)
    source   = source   or legacy.get("source")
    villa    = villa    or legacy.get("villa")
    customer = customer or legacy.get("customer")
    payment  = payment  or legacy.get("payment")
    amenity  = amenity  or legacy.get("amenity")
    category = category or legacy.get("category")
    section  = section  or legacy.get("section")

    params: dict = filter_params(
        year=year, month=month, date=date,
        start_date=start_date, end_date=end_date,
    )

    is_villa_scoped = category == "Villa" or section == "Villa"

    if group_by == "villa" and is_villa_scoped:
        if payment == "free":
            # Forgone Revenue per villa — same scope/exclusions as
            # _villa_forgone_revenue_sql(), grouped instead of aggregated.
            params["villa_exceptions"] = list(VILLA_FORGONE_EXCLUDED)
            sql = text(f"""
                SELECT
                    rd.villa_name                                       AS group_label,
                    COALESCE(SUM(COALESCE(rd.original_amount, 0)), 0)   AS revenue,
                    COUNT(*)                                            AS transactions,
                    COUNT(DISTINCT rd.member_number)                    AS unique_accounts
                FROM rate_details rd
                WHERE rd.payment_type = 'Free'
                  AND rd.villa_name IS NOT NULL
                  AND NOT (rd.villa_name = ANY(:villa_exceptions))
                {_rate_details_date_filter_sql()}
                GROUP BY rd.villa_name
                ORDER BY revenue DESC NULLS LAST
            """)
        else:
            # Gross/Collected Revenue per villa — same reservation-deduped
            # CTE as /overview, /villa-revenue, and category-comp-breakdown's
            # Villa 'collected' row.
            sql = text(f"""
                {_villa_gross_revenue_cte_sql()}
                SELECT
                    vr.villa_name                      AS group_label,
                    COALESCE(SUM(vr.total_rental), 0)  AS revenue,
                    COUNT(*)                            AS transactions,
                    COUNT(DISTINCT vr.member_number)   AS unique_accounts
                FROM villa_reservations vr
                WHERE 1=1
                {_villa_revenue_date_filter_sql(alias="vr")}
                GROUP BY vr.villa_name
                ORDER BY revenue DESC NULLS LAST
            """)

        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql, params))

    else:
        group_cfg  = _BREAKDOWN_GROUPS[group_by]
        group_expr = group_cfg["expr"]

        where_clauses: list = [date_filter_sql()]

        _apply_common_filters(
            where_clauses, params,
            source=source if group_by != "source" else None,
            villa=villa if group_by != "villa" else None,
            customer=customer if group_by != "customer" else None,
            payment=payment,
            amenity=amenity if group_by != "amenity" else None,
            category=category if group_by != "category" else None,
            section=section,
        )

        if group_cfg["requires_not_null"]:
            where_clauses.append(f"AND {group_expr} IS NOT NULL")

        where_str = "\n        ".join(where_clauses)
        sql = text(f"""
            SELECT
                {group_expr}                       AS group_label,
                SUM(f.amount)                       AS revenue,
                COUNT(*)                            AS transactions,
                COUNT(DISTINCT f.member_number)     AS unique_accounts
            FROM folios f
            LEFT JOIN business_source bs
              ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
            LEFT JOIN members m
              ON m.member_number = f.member_number
            WHERE f.amount IS NOT NULL
            {where_str}
            GROUP BY 1
            ORDER BY revenue DESC NULLS LAST
        """)

        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql, params))

    formatted_rows = [
        {
            "label":          r["group_label"],
            "revenue":        float(r["revenue"] or 0),
            "transactions":   int(r["transactions"] or 0),
            "uniqueAccounts": int(r["unique_accounts"] or 0),
        }
        for r in rows
    ]

    return _paginate(formatted_rows, page, page_size)