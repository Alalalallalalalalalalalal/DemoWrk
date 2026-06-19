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
    d = f"{alias}.{column}"
    out = f"{alias}.check_out_date"

    return f"""
      AND (
        (:date IS NULL AND :start_date IS NULL AND :end_date IS NULL)
        OR (
          :date IS NOT NULL
          AND {d} <= :date
          AND {out} >= :date
        )
        OR (
          :date IS NULL
          AND :start_date IS NOT NULL
          AND :end_date IS NOT NULL
          AND {d} <= :end_date
          AND {out} >= :start_date
        )
      )
      AND (
        :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
        OR :year IS NULL
        OR (
          {d} <= MAKE_DATE(:year, 12, 31)
          AND {out} >= MAKE_DATE(:year, 1, 1)
        )
      )
      AND (
        :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
        OR :month IS NULL
        OR (
          :year IS NOT NULL
          AND {d} <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::DATE
          AND {out} >= MAKE_DATE(:year, :month, 1)
        )
        OR (
          :year IS NULL
          AND (
            EXTRACT(MONTH FROM {d})::INT = :month
            OR EXTRACT(MONTH FROM {out})::INT = :month
          )
        )
      )
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