"""
Villa stats endpoints: per-villa aggregate stats and per-villa monthly
trend data.
"""

from __future__ import annotations

from datetime import date as _date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..analytics_shared import get_db, rows
from ._shared import (
    resolve_period,
    period_params,
    booking_base_cte,
    villa_paid_free_metrics_cte,
    _villa_stats_sql,
)

router = APIRouter()


def _villa_monthly_sql(src: str, group_by: str) -> str:
    if group_by == "year":
        select_clause = """
            EXTRACT(YEAR FROM check_in_date)::int AS year,
            EXTRACT(YEAR FROM check_in_date)::int AS sort_key,
        """
        group_clause = "year, sort_key"
    else:
        select_clause = """
            TO_CHAR(check_in_date, 'Mon') AS month,
            EXTRACT(MONTH FROM check_in_date)::int AS sort_key,
        """
        group_clause = "month, sort_key"

    return f"""
    SELECT
        {select_clause}
        COUNT(*)::int AS bookings,
        ROUND(COALESCE(SUM(revenue), 0)::numeric, 2) AS revenue
    FROM {src}
    WHERE LOWER(TRIM(villa_name)) = LOWER(TRIM(:villa))
    GROUP BY {group_clause}
    ORDER BY sort_key
    """


@router.get("/villa-stats")
def villa_stats(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(p)},
        {villa_paid_free_metrics_cte(
            p,
            booking_src="booking_base",
        )}
        {_villa_stats_sql(
            "booking_base",
            "villa_paid_free_metrics",
        )}
        """,
        period_params(p),
    )


@router.get("/villa-monthly")
def villa_monthly(
    villa: str = Query(...),
    group_by: str = Query(
        default="month",
        pattern="^(month|year)$",
    ),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(p)}
        {_villa_monthly_sql(
            'booking_base',
            group_by,
        )}
        """,
        period_params(
            p,
            villa=villa,
        ),
    )
