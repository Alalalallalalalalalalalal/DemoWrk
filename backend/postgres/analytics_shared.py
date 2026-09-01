# backend/postgres/analytics_shared.py
"""
Shared dependencies, helper functions, and SQL fragment builders used across
the analytics route modules (dashboard, seasons, tables, ml_insights, villas,
demographics).

Nothing in this file defines routes — it's pure plumbing so each route module
can `from .analytics_shared import ...` without duplicating logic.
"""
from sqlalchemy.orm import Session
from sqlalchemy import text

from postgres.database import SessionLocal
from datetime import date


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def rows(db: Session, sql: str, params: dict | None = None):
    return [dict(row) for row in db.execute(text(sql), params or {}).mappings().all()]


def one(db: Session, sql: str, params: dict | None = None):
    return dict(db.execute(text(sql), params or {}).mappings().first() or {})


def date_filter_sql(alias="f", column="check_in_date"):
    """
    [2026-08-20 REARCHITECTED] Was a stay-OVERLAP filter (check_in <= end
    AND check_out >= start), which double-counts any stay whose date
    range crosses a period boundary — e.g. a Dec 28 -> Jan 3 stay was
    counted in BOTH the 2025 and 2026 totals when each was queried
    separately. overview_date_filter_sql()'s "checkin" mode (see
    overview_analytics.py) already fixed exactly this for Overview back
    on 2026-07-19 (its own comment cites a live $1.22M/55-stay double
    count) by attributing a stay's ENTIRE revenue to the period
    containing its check-in date, not every period it happens to
    overlap. Per explicit direction that Finance and Overview's numbers
    must match, Finance now uses the same rule — this is a straight port
    of overview_date_filter_sql()'s "checkin" branch onto the
    alias/column signature this function's ~10 call sites already use.

    [2026-08-20, same pass] Also added the COMPLETED-STAY CUTOFF:
    revenue only counts once a stay has checked out. An in-progress
    stay's folio is still open (comps/adjustments/credits can still
    land before departure), so Finance was counting already-posted
    charges from currently-checked-in guests immediately while Overview
    held them back until checkout (see overview_stripped_lines in
    overview_sql.py, same rule) — a live example: a $463.75 restaurant
    charge on a stay checked in Aug 10 with checkout Sep 3 showed in
    Finance's Amenities total but not Overview's, entirely explaining
    the last few hundred dollars of an otherwise-reconciled figure. Per
    explicit direction, Finance now waits for checkout too. Assumes
    `{alias}` has a check_out_date column — true for every current call
    site (all alias="f"/folios).
    """
    d = f"{alias}.{column}"
    out = f"{alias}.check_out_date"

    return f"""
      AND (
        CASE
            WHEN :start_date IS NOT NULL OR :end_date IS NOT NULL THEN
                {d} >= COALESCE(:start_date, {d})
                AND {d} <= COALESCE(:end_date, {d})
            WHEN :date IS NOT NULL THEN
                {d} = :date
            WHEN :year IS NOT NULL AND :month IS NOT NULL THEN
                {d} >= MAKE_DATE(:year, :month, 1)
                AND {d} <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::date
            WHEN :year IS NOT NULL THEN
                {d} >= MAKE_DATE(:year, 1, 1)
                AND {d} <= MAKE_DATE(:year, 12, 31)
            ELSE TRUE
        END
      )
      AND ({out} IS NULL OR {out} < CURRENT_DATE)
    """


def demographic_date_filter_sql(
    alias: str = "m",
    column: str = "since_date",
):
    """
    Filters demographic records using a single date column.

    Default:
        members.since_date

    Supported filters:
        year
        month
        exact date
        custom start/end range
    """
    date_column = f"{alias}.{column}"

    return f"""
      AND (
        (
          :date IS NULL
          AND :start_date IS NULL
          AND :end_date IS NULL
          AND :year IS NULL
          AND :month IS NULL
        )

        OR (
          :date IS NOT NULL
          AND {date_column}::date = :date
        )

        OR (
          :date IS NULL
          AND :start_date IS NOT NULL
          AND :end_date IS NOT NULL
          AND {date_column}::date
              BETWEEN :start_date AND :end_date
        )

        OR (
          :date IS NULL
          AND :start_date IS NULL
          AND :end_date IS NULL
          AND :year IS NOT NULL
          AND :month IS NULL
          AND EXTRACT(YEAR FROM {date_column})::int = :year
        )

        OR (
          :date IS NULL
          AND :start_date IS NULL
          AND :end_date IS NULL
          AND :year IS NULL
          AND :month IS NOT NULL
          AND EXTRACT(MONTH FROM {date_column})::int = :month
        )

        OR (
          :date IS NULL
          AND :start_date IS NULL
          AND :end_date IS NULL
          AND :year IS NOT NULL
          AND :month IS NOT NULL
          AND EXTRACT(YEAR FROM {date_column})::int = :year
          AND EXTRACT(MONTH FROM {date_column})::int = :month
        )
      )
    """


def filter_params(
    year: int | None = None,
    month: int | None = None,
    date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    return {
        "year": year,
        "month": month,
        "date": date,
        "start_date": start_date,
        "end_date": end_date,
    }


def valid_booking_sql(alias="f"):
    return f"""
      {alias}.conf_code IS NOT NULL
      AND {alias}.check_in_date IS NOT NULL
      AND {alias}.check_out_date IS NOT NULL
      AND COALESCE(LOWER({alias}.reservation_status), '') NOT IN (
        'cancelled', 'canceled', 'no-show'
      )
    """


# Used by demographics.py (state-accounts validation) and any other module
# that needs to validate/iterate US state abbreviations.
US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA",
    "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY",
    "DC",
}

# Same list, but as the literal SQL IN(...) clause used inline in a few
# queries (dashboard-summary, demographics-summary). Kept as a constant so
# it's defined once and formatted into the f-strings that need it.
US_STATE_CODES_SQL = """(
    'AL', 'AK', 'AZ', 'AR', 'CA',
    'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO',
    'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH',
    'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY',
    'DC'
)"""