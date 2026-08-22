# backend/postgres/finance/_shared.py
# ─────────────────────────────────────────────────────────────────
# Shared module-level helpers / SQL-fragment builders used across the
# Finance route modules (overview.py, villas.py, breakdowns.py).
#
# Nothing in this file defines routes — it's pure plumbing so each
# route module can `from ._shared import ...` without duplicating
# logic. Split out of what used to be a single finance/routes.py (see
# finance/__init__.py for the aggregator that replaces it).
#
# Date filtering: all endpoints across the finance package accept
# year / month / date / start_date / end_date and reuse the SAME
# date_filter_sql() + filter_params() helpers from analytics_shared.py
# that Visits & Rooms uses. No bespoke date-filtering SQL is defined
# in this file, EXCEPT _villa_bookings_date_filter_sql() below — see
# its docstring for why.
#
# date_filter_sql() defaults to alias="f", column="check_in_date" and
# always pairs it with "f.check_out_date" — i.e. it filters folio rows
# whose underlying STAY overlaps the requested period. Since `folios`
# is aliased `f` everywhere in the finance package already, the
# defaults apply unmodified everywhere except the pre-aggregated/
# alternate-source tables (villa-revenue, amenity-revenue, villa
# forgone revenue), which are addressed inline.
# ─────────────────────────────────────────────────────────────────

from typing import Optional
from sqlalchemy import text
from ..database import engine   # same engine your analytics.py uses

# Top-level Finance sections (Villa / Amenities / Services). A folio's
# transaction_category is bucketed into one of these three groups.
# Shared by category-comp-breakdown, the /overview cards, and
# /drilldown's `section` filter — see _section_case_sql(). This used
# to be defined locally inside category_comp_breakdown(); it now lives
# here so every consumer uses the exact same list.
# [2026-08-13] Added 'Commissary' — CLASSIFICATION_SQL (overview_sql.py)
# now splits it out of 'F&B' into its own transaction_category, matching
# how the statement_details side (statement_amenity_lines) already
# classified it as a standalone amenity_category. Without it here,
# Commissary's dollars would silently fall out of Amenities Revenue and
# into Services instead of just moving to a different line within
# Amenities.
AMENITY_CATS = (
    "F&B", "Commissary", "Golf", "Spa & Beauty", "Tennis", "Boutique",
    "Water Sports", "Equipment", "Cart Rental", "Events",
)

# ⚠️ DEPRECATED / CURRENTLY UNUSED as of the Forgone Revenue formula
# change (ROUND(SUM(original_amount - total_amount), 2) — see
# _villa_forgone_revenue_sql()). Villa Lolita / Wonderland are no
# longer excluded from Forgone Revenue — explicit decision, not an
# oversight (see chat history). Left defined, not deleted, in case
# something outside this file still references it.
VILLA_FORGONE_EXCLUDED = ("Villa Lolita", "Wonderland", "ZZ Comp")


def _rows_to_dicts(result):
    """Convert SQLAlchemy result rows to plain dicts."""
    keys = list(result.keys())
    return [dict(zip(keys, row)) for row in result.fetchall()]


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
    Check-in-year/period attribution filter for overview_booking_meta
    (alias `ovb`) — the SAME rule date_filter_sql() and
    overview_date_filter_sql()'s "checkin" mode use, just written
    against overview_check_in_date instead of folios.check_in_date,
    since date_filter_sql() is hard-wired to the `f`/folios alias (per
    the module docstring above).

    [2026-08-20] Was a stay-OVERLAP filter (check_in <= end AND
    check_out >= start) — double-counts a boundary-crossing stay across
    adjacent period filters, the same issue date_filter_sql() had. Now a
    straight check-in-containment port of
    overview_date_filter_sql()'s "checkin" branch, so every consumer of
    this function (finance_member_vs_guest()'s Villa portion,
    finance_villa_revenue() as of 2026-08-20) attributes a stay to its
    check-in period exactly like Overview does.

    Expects the same bind params filter_params() already produces:
    :year, :month, :date, :start_date, :end_date.
    """
    return """
        AND (
            CASE
                WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                    ovb.overview_check_in_date >= COALESCE(:start_date, ovb.overview_check_in_date)
                    AND ovb.overview_check_in_date <= COALESCE(:end_date, ovb.overview_check_in_date)
                WHEN :date IS NOT NULL THEN
                    ovb.overview_check_in_date = :date
                WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                    ovb.overview_check_in_date >= MAKE_DATE(:year, :month, 1)
                    AND ovb.overview_check_in_date <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
                WHEN :year IS NOT NULL THEN
                    ovb.overview_check_in_date >= MAKE_DATE(:year, 1, 1)
                    AND ovb.overview_check_in_date <= MAKE_DATE(:year, 12, 31)
                ELSE TRUE
            END
        )
    """


def _villa_forgone_revenue_sql() -> str:
    """
    Villa Forgone Revenue — SOURCE OF TRUTH IS rate_details, not folios.

    FORMULA CHANGE (validated by the team): Forgone Revenue is now
    ROUND(SUM(original_amount - total_amount), 2) — the actual discount
    given per row (rack rate minus what was actually charged), not a
    flat SUM(original_amount). Scope: payment_type = 'Free',
    status = 'Posted', AND original_amount >= total_amount (excludes
    any row where the "discount" would work out negative — i.e. rows
    where the guest was somehow charged MORE than rack rate, which
    isn't a forgone-revenue row at all).

    ⚠️ VILLA LOLITA / WONDERLAND ARE NO LONGER EXCLUDED. The prior
    VILLA_FORGONE_EXCLUDED exclusion was dropped as part of this
    change (explicit decision — see chat history). VILLA_FORGONE_EXCLUDED
    is left defined below but is now unused by this function.

    ⚠️ missing_rate_count IS NOW STRUCTURALLY ALWAYS 0 (and
    calculationCoverage always 1.0, or None with zero qualifying rows):
    the WHERE clause's `original_amount >= total_amount` excludes any
    row with a NULL original_amount before it ever reaches the
    COUNT(*) FILTER (WHERE original_amount IS NULL) — NULL >= x is
    never true in SQL, so such rows never enter the result set to be
    counted by that FILTER. Both columns are kept because they're
    part of the validated query as given, but they no longer carry
    the "how much underlying data is missing" signal they used to —
    if the frontend surfaces calculationCoverage as a data-quality
    badge, it will now always read as fully covered.

    Also returns:
      total_free_rows — count of rows meeting ALL the above conditions
        (no longer "every free row", now "every free row this formula
        actually counted" — same caveat as missing_rate_count above).
      unique_accounts  — distinct member_number across in-scope rows.

    {villa_filter} is interpolated by the caller — either empty, or
    "AND rd.villa_name = :flt_villa" when a villa filter was supplied.
    {date_sql} is _villa_revenue_date_filter_sql(alias="rd") — check-in
    -month bucketing, NOT _rate_details_date_filter_sql()'s stay-overlap
    (that was the original, since-corrected date semantic here — it
    double-counted/leaked stays across a period boundary; see that
    function's docstring for the fix and the validated discrepancy).

    Requires the standard filter_params() bind set (:year, :month,
    :date, :start_date, :end_date) in params. No longer requires
    :villa_exceptions (the exclusion this used to bind is gone).
    """
    return """
        SELECT
            COALESCE(ROUND(SUM(rd.original_amount - rd.total_amount)::numeric, 2)) AS forgone_revenue,
            COUNT(*) FILTER (WHERE rd.original_amount IS NULL) AS missing_rate_count,
            COUNT(*)                                            AS total_free_rows,
            COUNT(DISTINCT rd.member_number)                   AS unique_accounts
        FROM rate_details rd
        WHERE rd.status = 'Posted'
          AND rd.payment_type = 'Free'
          AND rd.original_amount >= rd.total_amount
        {villa_filter}
        {date_sql}
    """


def _villa_forgone_revenue_row(params: dict, villa: Optional[str] = None) -> dict:
    """
    Runs _villa_forgone_revenue_sql() and returns a dict with
    forgoneRevenue, missingRateCount, totalFreeRows, uniqueAccounts,
    and calculationCoverage.

    ⚠️ calculationCoverage is now structurally always 1.0 (or None with
    zero qualifying rows) — see _villa_forgone_revenue_sql()'s
    docstring for why. Kept for response-shape compatibility, no
    longer a meaningful data-quality signal.

    `params` must already contain the standard filter_params() bind
    set (:year, :month, :date, :start_date, :end_date) — this function
    adds :flt_villa on a copy of that dict if `villa` is given (never
    mutates the caller's params). No longer adds :villa_exceptions —
    the Villa Lolita/Wonderland exclusion this used to bind was
    dropped along with the formula change.
    """
    q_params = dict(params)
    villa_filter = ""
    if villa:
        villa_filter = "AND rd.villa_name = :flt_villa"
        q_params["flt_villa"] = villa

    sql = text(_villa_forgone_revenue_sql().format(
        villa_filter=villa_filter,
        date_sql=_villa_revenue_date_filter_sql(alias="rd"),
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
    Check-in-month period filter, shared by TWO rate_details-sourced
    calculations:
      - Villa Gross/Collected Revenue (_villa_gross_revenue_cte_sql()),
        called with alias="vr" against the dedup CTE's output column.
      - Villa Forgone Revenue (_villa_forgone_revenue_sql()), called
        with alias="rd" directly against raw rate_details rows (no
        dedup — see that function's docstring for why Forgone doesn't
        dedupe the way Gross does).

    Both bucket an entire reservation into a single revenue month
    based on check_in_date only — a 7-night stay spanning two calendar
    months contributes its whole figure to the check-in month, not
    split across both.

    ⚠️ Forgone Revenue used to use a DIFFERENT filter here —
    _rate_details_date_filter_sql(), a stay-OVERLAP check (does the
    stay's check_in_date/check_out_date range overlap the requested
    period at all). That mismatch was found to cause real double-
    counting/leakage for stays crossing a period boundary (e.g. a
    Dec 25 -> Jan 4 stay got counted in BOTH "2025" and "2026" under
    the overlap filter, but only in "2025" here) — see chat history
    for the validated discrepancy. Forgone Revenue was switched to
    this check-in-month filter specifically to fix that. See
    _rate_details_date_filter_sql()'s own docstring — it's no longer
    called by anything in this file, kept only as deprecated/unused.

    {alias} must expose a `check_in_date` column. For the Gross/
    Collected caller that's the dedup CTE's output column (not
    rate_details' raw, repeated one); for the Forgone caller it's
    rate_details' own check_in_date directly.

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
            WHERE rd.payment_type = 'Paid' AND rd.villa_name <> 'ZZ Comp'
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
