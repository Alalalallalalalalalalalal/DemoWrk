# backend/postgres/finance/breakdowns.py
# ─────────────────────────────────────────────────────────────────
# Finance breakdown / drill-down endpoints — revenue by source,
# member vs guest, amenity revenue, and the composable /drilldown +
# /drilldown-breakdown pair (flat records + grouped totals sharing
# the same filter dimensions).
# Split out of what used to be a single finance/routes.py (see
# finance/__init__.py for the aggregator that replaces it).
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
# ─────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Query
from typing import Optional
from datetime import date
from sqlalchemy import text
import math
from ..database import engine   # same engine your analytics.py uses
from ..analytics_shared import date_filter_sql, filter_params
from ._shared import (
    AMENITY_CATS,
    _rows_to_dicts,
    _section_case_sql,
    _bucket_case_sql,
    _villa_bookings_date_filter_sql,
    _villa_revenue_date_filter_sql,
    _villa_gross_revenue_cte_sql,
)

router = APIRouter()

# ── fine-grained amenity breakdown (Amenity Revenue & Season Breakdown
# table + its /drilldown filter) ────────────────────────────────────
# [2026-08-20] Replaces the old free-standing AMENITY_KEYWORDS
# description-keyword map, which covered only 8 of the 10 AMENITY_CATS
# categories — rows classified Water Sports/Equipment/Cart Rental/Events
# (and any F&B row not matching a Grill/Bar/Restaurant keyword) had no
# matching WHEN and fell into "Other" in the summary table, and silently
# matched nothing at all when drilled into (amenity in AMENITY_KEYWORDS
# was False, so the filter clause was just skipped). Now built from
# transaction_category directly — the same authoritative column
# CLASSIFICATION_SQL (overview_sql.py) already assigns every row, so
# every AMENITY_CATS row lands in exactly one named bucket, never
# "Other". Mirrors ml_amenity_seasons.py's classify_amenity() exactly.
_FNB_SUB_PATTERNS = {
    "Grill":      r"\ygrill\y",
    "Bar":        r"\ybar\y",
    "Restaurant": r"\y(restaurant|dinner|lunch|breakfast)\y",
}
# label -> transaction_category, for every AMENITY_CATS category other
# than F&B (F&B splits into Grill/Bar/Restaurant/plain-F&B above instead
# of mapping 1:1).
AMENITY_DIRECT_LABELS = {
    "Commissary":   "Commissary",
    "Golf":         "Golf",
    "Spa":          "Spa & Beauty",
    "Tennis":       "Tennis",
    "Boutique":     "Boutique",
    "Water Sports": "Water Sports",
    "Equipment":    "Equipment",
    "Cart Rental":  "Cart Rental",
    "Events":       "Events",
}


def _amenity_case_sql() -> str:
    """
    Requires the caller to have already scoped
    WHERE f.transaction_category = ANY(:amenity_cats) (see AMENITY_CATS)
    — under that scope every row matches one of the WHENs below, so the
    ELSE is unreachable in practice, kept only as a defensive fallback.
    """
    fnb_whens = "\n            ".join(
        f"WHEN f.transaction_category = 'F&B' AND f.description ~* '{pat}' THEN '{label}'"
        for label, pat in _FNB_SUB_PATTERNS.items()
    )
    direct_whens = "\n            ".join(
        f"WHEN f.transaction_category = '{cat}' THEN '{label}'"
        for label, cat in AMENITY_DIRECT_LABELS.items()
    )
    return f"""
        CASE
            {fnb_whens}
            WHEN f.transaction_category = 'F&B' THEN 'F&B'
            {direct_whens}
            ELSE 'Other'
        END
    """


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

    if amenity in _FNB_SUB_PATTERNS:
        where_clauses.append(
            f"AND f.transaction_category = 'F&B' AND f.description ~* '{_FNB_SUB_PATTERNS[amenity]}'"
        )
    elif amenity == "F&B":
        not_patterns = " AND ".join(
            f"f.description !~* '{pat}'" for pat in _FNB_SUB_PATTERNS.values()
        )
        where_clauses.append(f"AND f.transaction_category = 'F&B' AND ({not_patterns})")
    elif amenity in AMENITY_DIRECT_LABELS:
        where_clauses.append(f"AND f.transaction_category = '{AMENITY_DIRECT_LABELS[amenity]}'")

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
    date_sql = _villa_revenue_date_filter_sql(alias="r")

    sql = text(f"""
            SELECT
                COALESCE(r.source, 'Unknown') AS source_name,
                MAX(r.payment_type)           AS payment_type,
                SUM(r.total_rental)           AS revenue,
                COUNT(*)                      AS transactions
            FROM (
                SELECT
                    reservation_id,
                    MAX(source)        AS source,
                    MAX(payment_type)  AS payment_type,
                    MAX(total_rental)  AS total_rental,
                    MAX(check_in_date) AS check_in_date
                FROM rate_details
                WHERE status = 'Posted'
                AND villa_name <> 'ZZ Comp'
                GROUP BY reservation_id
            ) r
            WHERE 1=1
            {date_sql}
            GROUP BY r.source
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

    # [2026-08-13] Was `WHERE f.amount IS NOT NULL` only — summing every
    # folio line with no category/bucket scope, so large negative
    # Payment settlement lines and Reversals netted directly against
    # Villa/Amenity charges in the same SUM. Guests came out to $28,447
    # revenue across 152,740 transactions (18 cents/txn) — the same
    # payments-and-reversals-contaminate-the-sum bug already documented
    # and fixed in finance_overview()'s section_sql above. That first fix
    # scoped this to folios' collected bucket (correct for Amenities/
    # Services), but left Villa folios-sourced too — which double-
    # diverged from every other Villa figure on this page (the
    # $109,979,584 rental-programme basis _villa_statement_net_revenue()
    # and everywhere else here uses), the same way Overview's OWN
    # member-vs-guest card already avoided by sourcing Villa through the
    # unified ledger. See overview_analytics.py's
    # overview_transaction_member_vs_guest_revenue() — this mirrors that
    # scoping exactly (line_status='Paid', conf_code >= 9000000) so
    # Finance's card is built the same way Overview's already-correct one
    # is, just reusing _villa_bookings_date_filter_sql() (defined above,
    # previously unused) instead of duplicating its overlap logic.
    #
    # unique_accounts is computed from ONE combined DISTINCT count over
    # both sources (not two separate COUNT(DISTINCT) added together) —
    # summing two independent distinct counts would double-count anyone
    # who both stayed (Villa) and spent on-property (Amenities/Services)
    # in the period.
    sql = text(f"""
        WITH combined AS (
            SELECT
                CASE
                    WHEN ovb.overview_member_or_guest = 'Guest' THEN 'Guests'
                    ELSE 'Member'
                END AS customer_type,
                otl.overview_net_amount AS amount,
                COALESCE(ovb.overview_member_number, '') AS account_key
            FROM overview_transaction_lines otl
            JOIN overview_booking_meta ovb
              ON ovb.overview_conf_code = otl.overview_conf_code
            WHERE otl.overview_line_category = 'Villa'
              AND otl.overview_line_status = 'Paid'
              AND otl.overview_conf_code::text ~ '^[0-9]+$'
              AND otl.overview_conf_code::text::bigint >= 9000000
              {_villa_bookings_date_filter_sql()}

            UNION ALL

            SELECT
                CASE
                    WHEN m.member_or_guest = 'Guest' THEN 'Guests'
                    ELSE 'Member'
                END AS customer_type,
                f.amount,
                CASE WHEN (m.member_or_guest IS NULL OR m.member_or_guest != 'Guest')
                     THEN COALESCE(f.member_number, '')
                     ELSE COALESCE(f.guest_name, '')
                END AS account_key
            FROM folios f
            LEFT JOIN business_source bs ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
            LEFT JOIN members m
                ON m.member_number = f.member_number
            WHERE f.transaction_category IS NOT NULL
              AND f.transaction_category <> 'Laundry'
              AND f.transaction_category <> 'Villa'
              AND ({_bucket_case_sql()}) = 'collected'
            {date_sql}
        )
        SELECT
            customer_type,
            ROUND(SUM(amount)::numeric, 2)          AS revenue,
            COUNT(*)                                AS transactions,
            COUNT(DISTINCT NULLIF(account_key, '')) AS unique_accounts
        FROM combined
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
        # [2026-08-13] amenity_season_spend is populated by a separate ML
        # pipeline (backend/machinelearning/ml_amenity_seasons.py), which
        # itself depends on `seasons`/`season_groups` tables defining the
        # business's actual season date ranges. Neither exists in this
        # database yet (confirmed: `relation "seasons" does not exist` —
        # this isn't a dropped view, the season date ranges were never
        # configured at all, which needs business input, not a code fix).
        # Without this try/except, that turned into an unhandled 500 here
        # — which the browser then reported as a CORS failure (FastAPI's
        # CORSMiddleware doesn't reliably attach CORS headers to a
        # response that errored before the route returned), so this
        # looked like a network/CORS bug instead of the missing-table
        # issue it actually was. Falls through to the folios-based query
        # below (same one the date-filtered branch already uses) so the
        # page shows real amenity revenue now; season breakdowns stay
        # empty until the seasons tables + ML pipeline are built.
        # [2026-08-13, redone 2026-08-19 after an uncommitted-changes
        # discard] Was `SUM(total_spend) AS revenue` — a leftover from
        # before amenity_season_spend had a real revenue/free_value split
        # (ml_amenity_seasons.py's rewrite, see that file's docstring).
        # total_spend = revenue + free_value (collected + comp/free
        # combined), so this was overstating "revenue" by the comp/free
        # portion — $28,715,808.57 shown against the headline Amenities
        # Revenue card's $26,732,340.12. Now reads the real collected-only
        # revenue column, which reconciles with that card exactly.
        rows = None
        try:
            sql = text("""
                SELECT
                    amenity,
                    SUM(revenue)            AS revenue,
                    SUM(transaction_count)  AS transactions,
                    COUNT(DISTINCT season)  AS season_count
                FROM amenity_season_spend
                WHERE amenity IS NOT NULL
                GROUP BY amenity
                ORDER BY revenue DESC
            """)
            with engine.connect() as conn:
                rows = _rows_to_dicts(conn.execute(sql))
        except Exception:
            rows = None

        if rows:
            sql_seasons = text("""
                SELECT
                    amenity,
                    season,
                    revenue,
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
    #
    # [2026-08-13] Scoped to genuine amenity-category, collected revenue
    # only — same AMENITY_CATS / _bucket_case_sql() basis the rest of
    # this file already trusts (see finance_overview()'s section_sql).
    # The original version had no such scope (`WHERE f.amount IS NOT
    # NULL` only), so every row _amenity_case_sql()'s keyword CASE didn't
    # recognize — Villa charges, Payments, Reversals, Membership dues,
    # Adjustments — fell into its 'Other' catch-all, producing an "Other"
    # amenity showing -$15.9M across 65,957 transactions the one time
    # this path actually ran. _amenity_case_sql() is still used here for
    # its finer Spa/Golf/Restaurant/Bar/etc. sub-categories (a nicer
    # breakdown than the coarse AMENITY_CATS tuple gives), just scoped
    # down first to rows that are actually amenity revenue.
    amenity_sql = _amenity_case_sql()
    date_sql = date_filter_sql()
    params["amenity_cats"] = list(AMENITY_CATS)
    sql2 = text(f"""
        SELECT
            {amenity_sql} AS amenity,
            SUM(f.amount)  AS revenue,
            COUNT(*)       AS transactions
        FROM folios f
        LEFT JOIN business_source bs ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
        WHERE f.amount IS NOT NULL
          AND f.transaction_category = ANY(:amenity_cats)
          AND ({_bucket_case_sql()}) = 'collected'
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
        WHERE f.amount IS NOT NULL AND f.villa_name <> 'ZZ Comp'
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
            # Forgone Revenue per villa — same formula/scope/date
            # semantics as _villa_forgone_revenue_sql() (ROUND(SUM(
            # original_amount - total_amount), 2), status='Posted',
            # original_amount >= total_amount, check-in-month
            # bucketing — NOT stay-overlap, see that function's
            # docstring for why this changed), grouped instead of
            # aggregated. No villa exclusion (dropped along with the
            # formula change).
            sql = text(f"""
                SELECT
                    rd.villa_name                                                          AS group_label,
                    COALESCE(ROUND(SUM(rd.original_amount - rd.total_amount)::numeric, 2))  AS revenue,
                    COUNT(*)                                                                 AS transactions,
                    COUNT(DISTINCT rd.member_number)                                        AS unique_accounts
                FROM rate_details rd
                WHERE rd.status = 'Posted' AND rd.villa_name <> 'ZZ Comp'
                  AND rd.payment_type = 'Free'
                  AND rd.original_amount >= rd.total_amount
                  AND rd.villa_name IS NOT NULL
                {_villa_revenue_date_filter_sql(alias="rd")}
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
