# backend/postgres/analytics_lead_time.py
"""
Lead-time analytics endpoints.

Definition:
    Lead Time = Arrival / Check-In Date - Booking Confirmed (Created On) Date

Source:
    reservation_lead_time

Date filtering:
    Filters are applied to check_in_date (arrival date), so "2026" means
    reservations arriving in 2026. Custom start/end dates use the same rule.

Routes (mounted under /analytics by postgres/analytics.py):
    GET /lead-time/available-years
    GET /lead-time/average
    GET /lead-time/trends
    GET /lead-time/full
    GET /lead-time/export

Important:
    Unlike analytics_shared.date_filter_sql(), this module intentionally does
    NOT require a completed stay. Lead time is known when a reservation is
    created and should therefore also work for confirmed future arrivals.
"""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .analytics_shared import get_db, filter_params

router = APIRouter()


def _lead_time_date_filter_sql(alias: str = "rlt") -> str:
    """
    Filter by ARRIVAL/check_in_date.

    Priority matches the dashboard convention:
      custom range -> exact date -> year+month -> year -> all time.

    A one-sided custom range is allowed.
    """
    d = f"{alias}.check_in_date"
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
    """


def _status_filter_sql(alias: str = "rlt") -> str:
    """
    Exclude cancelled/no-show reservations from lead-time KPIs.

    Full/export endpoints can include them with include_cancelled=true.
    """
    return f"""
      AND COALESCE(LOWER(TRIM({alias}.reservation_status)), '') NOT IN (
        'cancelled', 'canceled', 'no-show', 'no show'
      )
    """


def _params(
    year: Optional[int],
    month: Optional[int],
    exact_date: Optional[date],
    start_date: Optional[date],
    end_date: Optional[date],
) -> dict:
    return filter_params(
        year=year,
        month=month,
        date=exact_date,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/lead-time/available-years")
def lead_time_available_years(
    db: Session = Depends(get_db),
):
    """Distinct arrival years currently present in reservation_lead_time."""
    result = db.execute(text("""
        SELECT DISTINCT EXTRACT(YEAR FROM check_in_date)::int AS year
        FROM reservation_lead_time
        WHERE check_in_date IS NOT NULL
        ORDER BY year DESC
    """)).mappings().all()

    return [int(r["year"]) for r in result if r["year"] is not None]


@router.get("/lead-time/average")
def lead_time_average(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    date_: Optional[date] = Query(None, alias="date"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    include_cancelled: bool = Query(False),
    db: Session = Depends(get_db),
):
    """
    KPI/summary view.

    Average/median/min/max use only rows where Created On and lead_time_days
    are available. reservationCount still shows every reservation in scope,
    allowing the frontend to show data coverage.
    """
    params = _params(year, month, date_, start_date, end_date)
    cancelled_sql = "" if include_cancelled else _status_filter_sql("rlt")

    row = db.execute(text(f"""
        SELECT
            COUNT(*) AS reservation_count,

            COUNT(*) FILTER (
                WHERE rlt.created_on IS NOT NULL
                  AND rlt.lead_time_days IS NOT NULL
            ) AS calculated_count,

            COUNT(*) FILTER (
                WHERE rlt.created_on IS NULL
                   OR rlt.lead_time_days IS NULL
            ) AS missing_created_count,

            ROUND(
                AVG(rlt.lead_time_days) FILTER (
                    WHERE rlt.lead_time_days IS NOT NULL
                )::numeric,
                1
            ) AS average_lead_time_days,

            ROUND(
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY rlt.lead_time_days
                ) FILTER (
                    WHERE rlt.lead_time_days IS NOT NULL
                )::numeric,
                1
            ) AS median_lead_time_days,

            MIN(rlt.lead_time_days) FILTER (
                WHERE rlt.lead_time_days IS NOT NULL
            ) AS minimum_lead_time_days,

            MAX(rlt.lead_time_days) FILTER (
                WHERE rlt.lead_time_days IS NOT NULL
            ) AS maximum_lead_time_days,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days = 0
            ) AS same_day_bookings,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days BETWEEN 0 AND 7
            ) AS bookings_0_7_days,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days BETWEEN 8 AND 30
            ) AS bookings_8_30_days,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days BETWEEN 31 AND 90
            ) AS bookings_31_90_days,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days >= 91
            ) AS bookings_91_plus_days

        FROM reservation_lead_time rlt
        WHERE rlt.check_in_date IS NOT NULL
          {_lead_time_date_filter_sql("rlt")}
          {cancelled_sql}
    """), params).mappings().first() or {}

    reservation_count = int(row.get("reservation_count") or 0)
    calculated_count = int(row.get("calculated_count") or 0)

    return {
        "reservationCount": reservation_count,
        "calculatedCount": calculated_count,
        "missingCreatedCount": int(row.get("missing_created_count") or 0),
        "calculationCoverage": (
            round(calculated_count / reservation_count, 4)
            if reservation_count else None
        ),
        "averageLeadTimeDays": (
            float(row["average_lead_time_days"])
            if row.get("average_lead_time_days") is not None else None
        ),
        "medianLeadTimeDays": (
            float(row["median_lead_time_days"])
            if row.get("median_lead_time_days") is not None else None
        ),
        "minimumLeadTimeDays": (
            int(row["minimum_lead_time_days"])
            if row.get("minimum_lead_time_days") is not None else None
        ),
        "maximumLeadTimeDays": (
            int(row["maximum_lead_time_days"])
            if row.get("maximum_lead_time_days") is not None else None
        ),
        "sameDayBookings": int(row.get("same_day_bookings") or 0),
        "buckets": {
            "0-7": int(row.get("bookings_0_7_days") or 0),
            "8-30": int(row.get("bookings_8_30_days") or 0),
            "31-90": int(row.get("bookings_31_90_days") or 0),
            "91+": int(row.get("bookings_91_plus_days") or 0),
        },
    }


@router.get("/lead-time/trends")
def lead_time_trends(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    date_: Optional[date] = Query(None, alias="date"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    include_cancelled: bool = Query(False),
    db: Session = Depends(get_db),
):
    """
    Monthly lead-time trend based on ARRIVAL month.

    Returns one row per year/month so custom ranges crossing years remain
    unambiguous.
    """
    params = _params(year, month, date_, start_date, end_date)
    cancelled_sql = "" if include_cancelled else _status_filter_sql("rlt")

    result = db.execute(text(f"""
        SELECT
            DATE_TRUNC('month', rlt.check_in_date)::date AS period,
            EXTRACT(YEAR FROM rlt.check_in_date)::int AS year,
            EXTRACT(MONTH FROM rlt.check_in_date)::int AS month_num,
            TO_CHAR(rlt.check_in_date, 'Mon') AS month,

            COUNT(*) AS reservation_count,

            COUNT(*) FILTER (
                WHERE rlt.lead_time_days IS NOT NULL
            ) AS calculated_count,

            ROUND(
                AVG(rlt.lead_time_days) FILTER (
                    WHERE rlt.lead_time_days IS NOT NULL
                )::numeric,
                1
            ) AS average_lead_time_days,

            ROUND(
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY rlt.lead_time_days
                ) FILTER (
                    WHERE rlt.lead_time_days IS NOT NULL
                )::numeric,
                1
            ) AS median_lead_time_days,

            MIN(rlt.lead_time_days) FILTER (
                WHERE rlt.lead_time_days IS NOT NULL
            ) AS minimum_lead_time_days,

            MAX(rlt.lead_time_days) FILTER (
                WHERE rlt.lead_time_days IS NOT NULL
            ) AS maximum_lead_time_days

        FROM reservation_lead_time rlt
        WHERE rlt.check_in_date IS NOT NULL
          {_lead_time_date_filter_sql("rlt")}
          {cancelled_sql}

        GROUP BY
            DATE_TRUNC('month', rlt.check_in_date),
            EXTRACT(YEAR FROM rlt.check_in_date),
            EXTRACT(MONTH FROM rlt.check_in_date),
            TO_CHAR(rlt.check_in_date, 'Mon')

        ORDER BY period
    """), params).mappings().all()

    return [
        {
            "period": r["period"].isoformat() if r["period"] else None,
            "year": int(r["year"]),
            "monthNum": int(r["month_num"]),
            "month": r["month"],
            "label": f"{r['month']} {int(r['year'])}",
            "reservationCount": int(r["reservation_count"] or 0),
            "calculatedCount": int(r["calculated_count"] or 0),
            "averageLeadTimeDays": (
                float(r["average_lead_time_days"])
                if r["average_lead_time_days"] is not None else None
            ),
            "medianLeadTimeDays": (
                float(r["median_lead_time_days"])
                if r["median_lead_time_days"] is not None else None
            ),
            "minimumLeadTimeDays": (
                int(r["minimum_lead_time_days"])
                if r["minimum_lead_time_days"] is not None else None
            ),
            "maximumLeadTimeDays": (
                int(r["maximum_lead_time_days"])
                if r["maximum_lead_time_days"] is not None else None
            ),
        }
        for r in result
    ]


@router.get("/lead-time/full")
def lead_time_full(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    date_: Optional[date] = Query(None, alias="date"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    include_cancelled: bool = Query(False),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Full reservation-level view with pagination and optional search."""
    params = _params(year, month, date_, start_date, end_date)
    cancelled_sql = "" if include_cancelled else _status_filter_sql("rlt")

    search_sql = ""
    if search and search.strip():
        params["search"] = f"%{search.strip()}%"
        search_sql = """
          AND (
            rlt.member_number ILIKE :search
            OR rlt.confirmation_code ILIKE :search
            OR COALESCE(rlt.reservation_id, '') ILIKE :search
            OR COALESCE(rlt.guest_name, '') ILIKE :search
            OR COALESCE(rlt.room_number, '') ILIKE :search
            OR COALESCE(rlt.reservation_status, '') ILIKE :search
          )
        """

    where_sql = f"""
        FROM reservation_lead_time rlt
        WHERE rlt.check_in_date IS NOT NULL
          {_lead_time_date_filter_sql("rlt")}
          {cancelled_sql}
          {search_sql}
    """

    total = int(
        db.execute(
            text(f"SELECT COUNT(*) {where_sql}"),
            params,
        ).scalar()
        or 0
    )

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    result = db.execute(text(f"""
        SELECT
            rlt.member_number,
            rlt.confirmation_code,
            rlt.reservation_id,
            rlt.guest_name,
            rlt.room_number,
            rlt.check_in_date,
            rlt.check_out_date,
            rlt.created_on,
            rlt.lead_time_days,
            rlt.reservation_status
        {where_sql}
        ORDER BY
            rlt.check_in_date DESC,
            rlt.confirmation_code
        LIMIT :limit OFFSET :offset
    """), params).mappings().all()

    items = []
    for r in result:
        items.append({
            "memberNumber": r["member_number"],
            "confirmationCode": r["confirmation_code"],
            "reservationId": r["reservation_id"],
            "guestName": r["guest_name"],
            "roomNumber": r["room_number"],
            "checkInDate": r["check_in_date"].isoformat() if r["check_in_date"] else None,
            "checkOutDate": r["check_out_date"].isoformat() if r["check_out_date"] else None,
            "createdOn": r["created_on"].isoformat(sep=" ") if r["created_on"] else None,
            "leadTimeDays": int(r["lead_time_days"]) if r["lead_time_days"] is not None else None,
            "reservationStatus": r["reservation_status"],
        })

    total_pages = max(1, (total + page_size - 1) // page_size)

    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "totalItems": total,
        "totalPages": total_pages,
    }


@router.get("/lead-time/export")
def lead_time_export(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    date_: Optional[date] = Query(None, alias="date"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    include_cancelled: bool = Query(False),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Export every filtered reservation to CSV.

    This uses the same arrival-date/status/search rules as /lead-time/full,
    but does not paginate.
    """
    params = _params(year, month, date_, start_date, end_date)
    cancelled_sql = "" if include_cancelled else _status_filter_sql("rlt")

    search_sql = ""
    if search and search.strip():
        params["search"] = f"%{search.strip()}%"
        search_sql = """
          AND (
            rlt.member_number ILIKE :search
            OR rlt.confirmation_code ILIKE :search
            OR COALESCE(rlt.reservation_id, '') ILIKE :search
            OR COALESCE(rlt.guest_name, '') ILIKE :search
            OR COALESCE(rlt.room_number, '') ILIKE :search
            OR COALESCE(rlt.reservation_status, '') ILIKE :search
          )
        """

    result = db.execute(text(f"""
        SELECT
            rlt.member_number,
            rlt.confirmation_code,
            rlt.reservation_id,
            rlt.guest_name,
            rlt.room_number,
            rlt.check_in_date,
            rlt.check_out_date,
            rlt.created_on,
            rlt.lead_time_days,
            rlt.reservation_status
        FROM reservation_lead_time rlt
        WHERE rlt.check_in_date IS NOT NULL
          {_lead_time_date_filter_sql("rlt")}
          {cancelled_sql}
          {search_sql}
        ORDER BY
            rlt.check_in_date DESC,
            rlt.confirmation_code
    """), params).mappings().all()

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Member #",
        "Confirmation Code",
        "Reservation ID",
        "Guest Name",
        "Room #",
        "Arrival Date",
        "Check-Out Date",
        "Booking Confirmed Date",
        "Lead Time (days)",
        "Reservation Status",
    ])

    for r in result:
        writer.writerow([
            r["member_number"] or "",
            r["confirmation_code"] or "",
            r["reservation_id"] or "",
            r["guest_name"] or "",
            r["room_number"] or "",
            r["check_in_date"].isoformat() if r["check_in_date"] else "",
            r["check_out_date"].isoformat() if r["check_out_date"] else "",
            r["created_on"].isoformat(sep=" ") if r["created_on"] else "",
            r["lead_time_days"] if r["lead_time_days"] is not None else "",
            r["reservation_status"] or "",
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename = "lead_time_export.csv"

    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
