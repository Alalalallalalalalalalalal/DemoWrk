"""
Villa booking-detail endpoints: bedroom breakdowns, per-villa booking rows,
and per-villa source/bedroom breakdowns.
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
    people_ctes,
    overview_villa_revenue_ctes,
    _bookings_by_bedroom_sql,
    _bedroom_breakdown_sql,
)

router = APIRouter()


@router.get("/bookings-by-bedroom")
def bookings_by_bedroom(
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
        {_bookings_by_bedroom_sql(
            'booking_base'
        )}
        """,
        period_params(p),
    )


@router.get("/bedroom-bookings")
def bedroom_bookings(
    beds: int = Query(...),
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
        {booking_base_cte(p, lean=False)},
        {people_ctes()}

        SELECT
            b.conf_code,
            b.villa_name,
            b.member_number,
            m.member_full_name,
            m.member_name,
            m.email,
            m.prefix AS title,
            mp.phone_number AS phone,
            ma.address,
            ma.country,
            ma.state,
            b.guest_name,
            b.persons,
            b.bedroom_count,
            b.check_in_date,
            b.check_out_date,
            b.nights,
            b.revenue,
            b.guests
        FROM booking_base b
        LEFT JOIN members m
          ON m.member_number = b.member_number
        LEFT JOIN member_address ma
          ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp
          ON mp.member_number = b.member_number
        WHERE b.bedroom_count = :beds
        ORDER BY b.check_in_date DESC
        """,
        period_params(
            p,
            beds=beds,
        ),
    )


@router.get("/villa-bookings")
def villa_bookings(
    villa: str = Query(...),
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
        {booking_base_cte(
            p,
            lean=False,
        )},
        {people_ctes()}

        SELECT
            b.conf_code,
            b.villa_name,
            b.member_number,
            m.member_full_name,
            m.member_name,
            m.email,
            m.prefix AS title,
            mp.phone_number AS phone,
            ma.address,
            ma.country,
            ma.state,
            b.guest_name,
            b.persons,
            b.bedroom_count,
            b.check_in_date,
            b.check_out_date,
            b.nights,
            b.revenue,
            b.guests
        FROM booking_base b
        LEFT JOIN members m
          ON m.member_number = b.member_number
        LEFT JOIN member_address ma
          ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp
          ON mp.member_number = b.member_number
        WHERE LOWER(TRIM(b.villa_name)) =
              LOWER(TRIM(:villa))
        ORDER BY b.check_in_date DESC
        """,
        period_params(
            p,
            villa=villa,
        ),
    )


@router.get("/villa-source-bookings")
def villa_source_bookings(
    villa: str = Query(...),
    source: str | None = Query(default=None),
    is_free: bool | None = Query(default=None),
    bedrooms: int | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=20000,
    ),
    db: Session = Depends(get_db),
):
    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    source_filter = ""

    if source is not None and source != "All":
        source_filter = (
            "AND b.source = :source_val"
        )

    free_filter = (
        "AND b.is_free = :is_free_val"
        if is_free is not None
        else ""
    )

    bedroom_filter = (
        "AND b.bedroom_count = :bedrooms_val"
        if bedrooms is not None
        else ""
    )

    limit_clause = (
        "LIMIT :row_limit"
        if limit is not None
        else ""
    )

    params = period_params(
        p,
        villa=villa,
        source_val=source,
        is_free_val=is_free,
        bedrooms_val=bedrooms,
        row_limit=limit,
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(
            p,
            lean=False,
        )},
        {people_ctes()}

        SELECT
            b.conf_code,
            b.villa_name,
            b.member_number,
            m.member_full_name,
            m.member_name,
            m.member_type,
            m.member_or_guest,
            m.email,
            m.prefix AS title,
            mp.phone_number AS phone,
            ma.address,
            ma.country,
            ma.state,
            b.guest_name,
            b.persons,
            b.bedroom_count,
            b.check_in_date,
            b.check_out_date,
            b.nights,
            b.source,
            b.payment_type,
            b.reservation_status,
            b.revenue AS total_amount,
            b.is_free,
            b.guests
        FROM booking_base b
        LEFT JOIN members m
          ON m.member_number = b.member_number
        LEFT JOIN member_address ma
          ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp
          ON mp.member_number = b.member_number
        WHERE LOWER(TRIM(b.villa_name)) =
              LOWER(TRIM(:villa))
          {source_filter}
          {free_filter}
          {bedroom_filter}
        ORDER BY
            b.check_in_date DESC NULLS LAST
        {limit_clause}
        """,
        params,
    )


@router.get("/villa-source-bedroom-breakdown")
def villa_source_bedroom_breakdown(
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

    inner = _bedroom_breakdown_sql(
        "booking_base",
        "overview_villa_revenue_by_booking",
    )

    inner = inner.replace(
        "WITH booking_rollup AS",
        "booking_rollup AS",
        1,
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(p)},
        {overview_villa_revenue_ctes(p)},
        {inner}
        """,
        period_params(p),
    )
