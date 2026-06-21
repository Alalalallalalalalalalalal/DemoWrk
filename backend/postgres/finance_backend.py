# backend/postgres/finance_backend.py
# ─────────────────────────────────────────────────────────────────
# Finance endpoints — uses SQLAlchemy (same pattern as analytics.py)
#
# Date filtering: all endpoints below accept year / month / date /
# start_date / end_date and reuse the SAME date_filter_sql() +
# filter_params() helpers from analytics_shared.py that Visits & Rooms
# uses. No bespoke date-filtering SQL is defined in this file, EXCEPT
# _villa_bookings_date_filter_sql() below — see its docstring for why.
#
# date_filter_sql() defaults to alias="f", column="check_in_date" and
# always pairs it with "f.check_out_date" — i.e. it filters folio rows
# whose underlying STAY overlaps the requested period. Since `folios`
# is aliased `f` everywhere in this file already, the defaults apply
# unmodified everywhere except the two pre-aggregated summary tables
# (villa-revenue, amenity-revenue), which are addressed inline.
# ─────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Query
from typing import Optional
from datetime import date
from sqlalchemy import text
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

      'collected'   — an actual paid charge. This is REVENUE.
      'given_away'  — a comped/free charge. $0 was actually collected,
                      even though the row carries a face-value amount.
      'reversed'    — a refunded/voided charge.
      'other'       — anything that isn't a Charge at all (payments
                      against balance, adjustments, etc.) — NOT revenue.

    Only 'collected' rows should ever be summed into a revenue figure.
    Previously this CASE only lived inline inside category_comp_breakdown
    (which deliberately shows all four buckets, since that's its whole
    point). It's pulled out here so /overview's Amenities/Services
    revenue — and the matching /drilldown 'section' filter — apply the
    EXACT same "what counts as revenue" rule, instead of re-deriving it
    and accidentally summing all four buckets together (which is the
    bug that produced a negative Services total: payments/adjustments/
    reversals with no amenity-specific category fall into the 'Services'
    catch-all via _section_case_sql()'s ELSE, and without this bucket
    filter they were being added straight into "revenue").

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
                THEN 'given_away'
            ELSE 'collected'
        END
    """


def _villa_bookings_date_filter_sql() -> str:
    """
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

    # ── Villas (trusted booking-level source) ────────────────────────
    villa_sql = text(f"""
        SELECT
            COALESCE(SUM(ovb.overview_villa_revenue), 0) AS revenue,
            COUNT(*)                                      AS bookings
        FROM overview_villa_bookings ovb
        WHERE 1=1
        {_villa_bookings_date_filter_sql()}
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


@router.get("/category-comp-breakdown")
def category_comp_breakdown(
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

    return [
        {
            "section": r["section"],
            "category": r["category"],
            "PaymentType": r["payment_type"],
            "bucket": r["bucket"],
            "amount": float(r["amount"] or 0),
            "transactions": r["transactions"],
            "uniqueAccounts": r["unique_accounts"],
        }
        for r in rows
    ]

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
# member_type = 'Guest' → Guest
# member_type = NULL    → Member (assumption per business rule)
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
                WHEN f.member_type = 'Guests' THEN 'Guests'
                ELSE 'Member'
            END                      AS customer_type,
            SUM(f.amount)            AS revenue,
            COUNT(*)                 AS transactions,
            COUNT(DISTINCT
                CASE WHEN (f.member_type IS NULL OR f.member_type != 'Guests')
                     THEN f.member_number
                     ELSE f.guest_name
                END
            )                        AS unique_accounts
        FROM folios f
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
# Out of scope for this change. Still uses visit_room_villa_summary
# (unfiltered) / folios fallback (filtered) as before — this endpoint
# powers the "Villa Revenue" breakdown TABLE further down the page, not
# the new "Villas Revenue" OVERVIEW CARD (which now uses
# overview_villa_bookings, see finance_overview() above).
#
# ⚠️ KNOWN INCONSISTENCY: this means the Villas Revenue card total and
# the sum of this table's rows can now disagree for a filtered period,
# since they read from different sources. Wasn't asked to fix this
# table, so leaving it as-is — flagging in case you want to migrate it
# to overview_villa_bookings too in a follow-up for full consistency.
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
    has_filter = any(v is not None for v in params.values())

    rows = []

    if not has_filter:
        sql = text("""
            SELECT
                villa_name,
                COALESCE(villa_rental_revenue, 0)  AS revenue,
                COALESCE(total_bookings, 0)         AS total_bookings,
                COALESCE(room_nights, 0)            AS room_nights,
                COALESCE(avg_stay, 0)               AS avg_stay,
                COALESCE(member_bookings, 0)        AS member_bookings,
                COALESCE(guest_bookings, 0)         AS guest_bookings
            FROM visit_room_villa_summary
            WHERE villa_name IS NOT NULL
            ORDER BY revenue DESC NULLS LAST
        """)
        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql))

    if not rows:
        # Date-filtered (or summary table empty) — derive villa revenue
        # straight from folios using the shared date filter pattern.
        date_sql = date_filter_sql()  # alias="f", column="check_in_date"
        sql2 = text(f"""
            SELECT
                COALESCE(f.villa_name, 'Unknown') AS villa_name,
                SUM(f.amount)                     AS revenue,
                COUNT(DISTINCT f.conf_code)       AS total_bookings,
                0                                 AS room_nights,
                0                                 AS avg_stay,
                0                                 AS member_bookings,
                0                                 AS guest_bookings
            FROM folios f
            WHERE f.amount IS NOT NULL AND f.villa_name IS NOT NULL
            {date_sql}
            GROUP BY f.villa_name
            ORDER BY revenue DESC
        """)
        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql2, params))

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
# Supports type/value filters plus year / month / date / start_date / end_date
# via the shared date_filter_sql() + filter_params() pattern (replaces the
# previous ad hoc EXTRACT(YEAR/MONTH FROM f.transaction_date) filters).
# payment_type filtering uses 'Free' / 'Paid' string values directly
#
# NEW: type="section" (value "Amenities" | "Services") — backs the new
# Amenities Revenue / Services Revenue overview cards. Reuses
# _section_case_sql(), the same bucketing category-comp-breakdown and
# the /overview endpoint use, so the records shown here always agree
# with the totals on those cards.
# ══════════════════════════════════════════════════════════════════
@router.get("/drilldown")
def finance_drilldown(
    type:       str           = Query(...),
    value:      Optional[str] = Query(None),
    limit:      int           = Query(200, le=500),
    year:       Optional[int]  = Query(None),
    month:      Optional[int]  = Query(None),
    date:       Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
):
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
            f.member_type,
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

    # ── type-based filter ─────────────────────────────────────────
    if type == "source" and value:
        where_clauses.append("AND f.source = :val")
        params["val"] = value

    elif type == "villa" and value:
        where_clauses.append("AND f.villa_name = :val")
        params["val"] = value

    elif type == "customer":
        if value == "Member":
            where_clauses.append("AND (f.member_type IS NULL OR f.member_type != 'Guests')")
        else:
            where_clauses.append("AND f.member_type = 'Guests'")

    elif type == "paid":
        where_clauses.append("AND bs.payment_type = 'Paid'")

    elif type == "complimentary":
        # kept for backwards compat — maps to Free
        where_clauses.append("AND bs.payment_type = 'Free'")

    elif type == "free":
        where_clauses.append("AND bs.payment_type = 'Free'")

    elif type == "amenity" and value and value in AMENITY_KEYWORDS:
        kws = AMENITY_KEYWORDS[value]
        like_clauses = " OR ".join(
            f"LOWER(f.description) LIKE '%{kw}%'" for kw in kws
        )
        where_clauses.append(f"AND ({like_clauses})")

    elif type == "category" and value:
        where_clauses.append("AND f.transaction_category = :val")
        params["val"] = value

    elif type == "section" and value in ("Amenities", "Services"):
        # Matches finance_overview()'s revenue figure exactly: collected
        # charges only, so the records shown here sum to the card total
        # (no payments/adjustments/reversals mixed in).
        where_clauses.append(f"AND ({_section_case_sql()}) = :val")
        where_clauses.append(f"AND ({_bucket_case_sql()}) = 'collected'")
        params["amenity_cats"] = list(AMENITY_CATS)
        params["val"] = value

    where_str = "\n        ".join(where_clauses)
    order = "ORDER BY f.amount DESC NULLS LAST, f.transaction_date DESC NULLS LAST"
    full_sql = text(f"{base}\n        {where_str}\n        {order}\n        LIMIT {limit}")

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