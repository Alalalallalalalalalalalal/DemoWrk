"""
Villa revenue endpoints: monthly statement villa income, authoritative
paid/free totals, and source-breakdown revenue.
"""

from __future__ import annotations

from datetime import date as _date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..analytics_shared import get_db, rows
from ._shared import (
    resolve_period,
    period_params,
    villa_income_cte,
    booking_base_cte,
    villa_paid_free_metrics_cte,
    source_revenue_cte,
    _monthly_revenue_sql,
    _paid_free_totals_sql,
    _source_breakdown_sql,
)

router = APIRouter()


@router.get("/monthly-revenue")
def monthly_revenue(
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
        {villa_income_cte(p)}
        {_monthly_revenue_sql(p)}
        """,
        period_params(p),
    )


@router.get("/villa-paid-free-totals")
def villa_paid_free_totals(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Authoritative per-villa booking/value endpoint.
    """
    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    params = period_params(
        p,
        villa=villa,
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
        {_paid_free_totals_sql()}
        """,
        params,
    )


@router.get("/villa-source-breakdown")
def villa_source_breakdown(
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

    inner = _source_breakdown_sql(
        "booking_base",
        "villa_revenue",
    )

    inner = inner.replace(
        "WITH booking_detail AS",
        "booking_detail AS",
        1,
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(p)},
        {source_revenue_cte(p)},
        {inner}
        """,
        period_params(p),
    )
