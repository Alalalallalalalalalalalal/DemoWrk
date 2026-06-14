# backend/postgres/finance_backend.py
# ─────────────────────────────────────────────────────────────────
# Finance endpoints — uses SQLAlchemy (same pattern as analytics.py)
# ─────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Query
from typing import Optional
from sqlalchemy import text
from .database import engine   # same engine your analytics.py uses

router = APIRouter(tags=["finance"])

# ── free payment_type codes (comp / complimentary) ────────────────
FREE_TYPES = ("HA", "HF", "CU", "HC", "HR", "CM", "CO")
FREE_LIST  = ", ".join(f"'{t}'" for t in FREE_TYPES)

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


# ══════════════════════════════════════════════════════════════════
# 1. OVERVIEW
# ══════════════════════════════════════════════════════════════════
@router.get("/overview")
def finance_overview():
    sql = text(f"""
        SELECT
            SUM(f.amount)                                                   AS total_revenue,
            SUM(CASE WHEN bs.payment_type NOT IN ({FREE_LIST})
                     THEN f.amount ELSE 0 END)                             AS paid_revenue,
            SUM(CASE WHEN bs.payment_type IN ({FREE_LIST})
                     THEN f.amount ELSE 0 END)                             AS complimentary_value,
            SUM(CASE WHEN f.member_number IS NOT NULL AND f.member_number <> ''
                     THEN f.amount ELSE 0 END)                             AS member_revenue,
            SUM(CASE WHEN f.member_number IS NULL OR f.member_number = ''
                     THEN f.amount ELSE 0 END)                             AS guest_revenue,
            COUNT(*)                                                        AS total_transactions
        FROM folios f
        LEFT JOIN business_source bs ON bs.source_name = f.source
        WHERE f.amount IS NOT NULL
    """)

    with engine.connect() as conn:
        row = conn.execute(sql).fetchone()

    if not row:
        return {
            "totalRevenue": 0, "paidRevenue": 0, "complimentaryValue": 0,
            "memberRevenue": 0, "guestRevenue": 0, "totalTransactions": 0,
        }

    return {
        "totalRevenue":       float(row[0] or 0),
        "paidRevenue":        float(row[1] or 0),
        "complimentaryValue": float(row[2] or 0),
        "memberRevenue":      float(row[3] or 0),
        "guestRevenue":       float(row[4] or 0),
        "totalTransactions":  int(row[5]   or 0),
    }


# ══════════════════════════════════════════════════════════════════
# 2. REVENUE BY SOURCE
# ══════════════════════════════════════════════════════════════════
@router.get("/source-breakdown")
def finance_source_breakdown():
    sql = text("""
        SELECT
            COALESCE(f.source, 'Unknown')  AS source_name,
            bs.payment_type,
            SUM(f.amount)                  AS revenue,
            COUNT(*)                       AS transactions
        FROM folios f
        LEFT JOIN business_source bs ON bs.source_name = f.source
        WHERE f.amount IS NOT NULL
        GROUP BY f.source, bs.payment_type
        ORDER BY revenue DESC NULLS LAST
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql))

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
# ══════════════════════════════════════════════════════════════════
@router.get("/member-vs-guest")
def finance_member_vs_guest():
    sql = text("""
        SELECT
            CASE
                WHEN f.member_number IS NOT NULL AND f.member_number <> ''
                THEN 'Member'
                ELSE 'Guest'
            END                      AS customer_type,
            SUM(f.amount)            AS revenue,
            COUNT(*)                 AS transactions,
            COUNT(DISTINCT
                CASE WHEN f.member_number IS NOT NULL AND f.member_number <> ''
                     THEN f.member_number
                     ELSE f.guest_name
                END
            )                        AS unique_accounts
        FROM folios f
        WHERE f.amount IS NOT NULL
        GROUP BY customer_type
        ORDER BY revenue DESC
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql))

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
# 4. VILLA REVENUE
# ══════════════════════════════════════════════════════════════════
@router.get("/villa-revenue")
def finance_villa_revenue():
    # Try pre-aggregated summary table first
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

    # Fallback to folios if summary table is empty
    if not rows:
        sql2 = text("""
            SELECT
                COALESCE(villa_name, 'Unknown') AS villa_name,
                SUM(amount)                     AS revenue,
                COUNT(DISTINCT conf_code)       AS total_bookings,
                0                               AS room_nights,
                0                               AS avg_stay,
                0                               AS member_bookings,
                0                               AS guest_bookings
            FROM folios
            WHERE amount IS NOT NULL AND villa_name IS NOT NULL
            GROUP BY villa_name
            ORDER BY revenue DESC
        """)
        with engine.connect() as conn:
            rows = _rows_to_dicts(conn.execute(sql2))

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
# ══════════════════════════════════════════════════════════════════
@router.get("/amenity-revenue")
def finance_amenity_revenue():
    # Try pre-aggregated amenity_season_spend first
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
        # Also pull per-season breakdown for each amenity
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

    # Fallback: classify folios by description keyword
    amenity_sql = _amenity_case_sql()
    sql2 = text(f"""
        SELECT
            {amenity_sql} AS amenity,
            SUM(f.amount)  AS revenue,
            COUNT(*)       AS transactions
        FROM folios f
        WHERE f.amount IS NOT NULL
        GROUP BY amenity
        ORDER BY revenue DESC
    """)

    with engine.connect() as conn:
        rows = _rows_to_dicts(conn.execute(sql2))

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
# ══════════════════════════════════════════════════════════════════
@router.get("/drilldown")
def finance_drilldown(
    type:  str           = Query(...),
    value: Optional[str] = Query(None),
    limit: int           = Query(200, le=500),
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
            bs.payment_type        AS source_payment_type
        FROM folios f
        LEFT JOIN business_source bs ON bs.source_name = f.source
        WHERE f.amount IS NOT NULL
    """

    params: dict = {}

    if type == "source" and value:
        where = " AND f.source = :val"
        params["val"] = value

    elif type == "villa" and value:
        where = " AND f.villa_name = :val"
        params["val"] = value

    elif type == "customer":
        if value == "Member":
            where = " AND f.member_number IS NOT NULL AND f.member_number <> ''"
        else:
            where = " AND (f.member_number IS NULL OR f.member_number = '')"

    elif type == "paid":
        where = f" AND bs.payment_type NOT IN ({FREE_LIST})"

    elif type == "complimentary":
        where = f" AND bs.payment_type IN ({FREE_LIST})"

    elif type == "amenity" and value and value in AMENITY_KEYWORDS:
        kws = AMENITY_KEYWORDS[value]
        like_clauses = " OR ".join(
            f"LOWER(f.description) LIKE '%{kw}%'" for kw in kws
        )
        where = f" AND ({like_clauses})"

    else:
        where = ""

    order = " ORDER BY f.transaction_date DESC NULLS LAST, f.amount DESC NULLS LAST"
    full_sql = text(f"{base}{where}{order} LIMIT {limit}")

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
            "checkInDate":       str(r["check_in_date"]) if r["check_in_date"] else None,
            "checkOutDate":      str(r["check_out_date"]) if r["check_out_date"] else None,
            "roomNumber":        r["room_number"],
            "villaName":         r["villa_name"],
            "source":            r["source"],
            "paymentType":       r["source_payment_type"] or r["folio_payment_type"],
            "memberType":        r["member_type"],
            "reservationStatus": r["reservation_status"],
        }
        for r in rows
    ]