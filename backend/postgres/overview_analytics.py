# backend/postgres/overview_analytics.py
# ─────────────────────────────────────────────────────────────────
# OVERVIEW TAB — analytics endpoints
# All routes prefixed with /overview (mounted in main.py)
# Tagged [overview] so they're easy to find in the API docs
# ─────────────────────────────────────────────────────────────────
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from .database import get_db   # adjust import to match your project

router = APIRouter(tags=["overview"])


def rows(db, sql, params=None):
    result = db.execute(sql, params or {})
    keys = result.keys()
    return [dict(zip(keys, row)) for row in result.fetchall()]


def one(db, sql, params=None):
    result = db.execute(sql, params or {})
    keys = result.keys()
    row = result.fetchone()
    return dict(zip(keys, row)) if row else {}


def vpt_clause(villa_payment_type):
    """Returns SQL fragment and updated params for villa_payment_type filter."""
    if villa_payment_type:
        return "AND f.villa_payment_type = :vpt", {"vpt": villa_payment_type}
    return "", {}


# ── Villa Revenue ─────────────────────────────────────────────────
@router.get("/villa-revenue")
def overview_villa_revenue(
    villa_payment_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    frag, extra = vpt_clause(villa_payment_type)
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name)    AS villa_name,
                MAX(f.bedroom_count) AS bedroom_count,
                MAX(f.check_out_date - f.check_in_date) AS nights,
                SUM(
                    CASE WHEN f.transaction_category = 'Villa'
                    THEN COALESCE(f.amount, 0) ELSE 0 END
                ) AS revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '')
                  NOT IN ('cancelled', 'canceled', 'no-show')
              {frag}
            GROUP BY f.conf_code
        )
        SELECT
            villa_name             AS "villaName",
            COUNT(*)               AS "totalBookings",
            SUM(nights)            AS "roomNights",
            SUM(revenue)           AS revenue
        FROM booking_rows
        GROUP BY villa_name
        ORDER BY revenue DESC
    """, extra)


# ── Monthly Revenue ───────────────────────────────────────────────
@router.get("/monthly-revenue")
def overview_monthly_revenue(
    villa_payment_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    frag, extra = vpt_clause(villa_payment_type)
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MIN(f.check_in_date)  AS check_in_date,
                SUM(
                    CASE WHEN f.transaction_category = 'Villa'
                    THEN COALESCE(f.amount, 0) ELSE 0 END
                ) AS revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '')
                  NOT IN ('cancelled', 'canceled', 'no-show')
              {frag}
            GROUP BY f.conf_code
        )
        SELECT
            TO_CHAR(check_in_date, 'Mon')           AS month,
            EXTRACT(MONTH FROM check_in_date)::int  AS month_num,
            COUNT(*)                                AS bookings,
            COALESCE(SUM(revenue), 0)               AS revenue
        FROM booking_rows
        GROUP BY month, month_num
        ORDER BY month_num
    """, extra)


# ── Bedroom Bookings ──────────────────────────────────────────────
@router.get("/bedroom-bookings")
def overview_bedroom_bookings(
    villa_payment_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    frag, extra = vpt_clause(villa_payment_type)
    return rows(db, f"""
        SELECT
            f.bedroom_count                                       AS beds,
            COUNT(DISTINCT f.conf_code)                          AS bookings,
            ROUND(AVG(f.check_out_date - f.check_in_date), 1)   AS avg_stay
        FROM folios f
        WHERE f.bedroom_count IS NOT NULL
          AND f.check_in_date IS NOT NULL
          AND f.check_out_date IS NOT NULL
          AND COALESCE(LOWER(f.reservation_status), '')
              NOT IN ('cancelled', 'canceled', 'no-show')
          {frag}
        GROUP BY f.bedroom_count
        ORDER BY f.bedroom_count
    """, extra)


# ── Member vs Guest Revenue ───────────────────────────────────────
@router.get("/member-vs-guest")
def overview_member_vs_guest(
    villa_payment_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    frag, extra = vpt_clause(villa_payment_type)
    return rows(db, f"""
        SELECT
            CASE WHEN m.member_or_guest = 'Guest'
                 THEN 'Guests' ELSE 'Member'
            END                                    AS "customerType",
            COUNT(*)                               AS transactions,
            ROUND(SUM(f.amount)::numeric, 2)       AS revenue,
            COUNT(DISTINCT f.member_number)        AS "uniqueAccounts"
        FROM folios f
        LEFT JOIN members m ON m.member_number = f.member_number
        WHERE f.amount IS NOT NULL
          AND f.transaction_flow = 'Charge'
          {frag}
        GROUP BY "customerType"
        ORDER BY revenue DESC
    """, extra)


# ── Stay Category Summary (your 4-bucket classification) ──────────
@router.get("/stay-categories")
def overview_stay_categories(
    db: Session = Depends(get_db),
):
    """
    Returns counts and revenue for each of the 4 stay categories:
      Free Villa + Free Amenities
      Free Villa + Paid Amenities
      Paid Villa + Free Amenities
      Paid Villa + Paid Amenities
    """
    return rows(db, """
        SELECT
            villa_payment_type,
            transaction_payment_type,
            COUNT(DISTINCT conf_code)          AS reservations,
            COUNT(*)                           AS rows,
            ROUND(SUM(amount)::numeric, 2)     AS total_amount
        FROM folios
        WHERE villa_payment_type IS NOT NULL
          AND transaction_payment_type IS NOT NULL
        GROUP BY villa_payment_type, transaction_payment_type
        ORDER BY villa_payment_type, transaction_payment_type
    """)