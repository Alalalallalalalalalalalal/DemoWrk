# backend/postgres/demographics/visitors.py
"""
New-vs-repeat visitor classification: the aggregate time-series endpoint and
the drilldown endpoint for the underlying account list.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta

from ..analytics_shared import get_db

router = APIRouter()


@router.get("/new-vs-repeat-visitors")
def get_new_vs_repeat_visitors(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    start_year: int | None = Query(default=None),
    end_year: int | None = Query(default=None),
    start_month: int | None = Query(default=None),
    end_month: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if month is not None and not 1 <= month <= 12:
        raise HTTPException(
            status_code=400,
            detail="month must be between 1 and 12",
        )

    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=400,
            detail=(
                "start_date and end_date "
                "must be supplied together"
            ),
        )

    if (
        start_date is not None
        and end_date is not None
        and start_date > end_date
    ):
        raise HTTPException(
            status_code=400,
            detail="start_date cannot be after end_date",
        )

    if (start_year is None) != (end_year is None):
        raise HTTPException(
            status_code=400,
            detail=(
                "start_year and end_year "
                "must be supplied together"
            ),
        )

    if (
        start_year is not None
        and end_year is not None
        and start_year > end_year
    ):
        raise HTTPException(
            status_code=400,
            detail="start_year cannot be after end_year",
        )

    monthly_custom_range = (
        start_month is not None
        or end_month is not None
    )

    if monthly_custom_range:
        if start_month is None or end_month is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "start_month and end_month "
                    "must be supplied together"
                ),
            )

        if start_year is None or end_year is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "start_year and end_year are "
                    "required together with "
                    "start_month/end_month"
                ),
            )

        if not (1 <= start_month <= 12) or not (1 <= end_month <= 12):
            raise HTTPException(
                status_code=400,
                detail="start_month and end_month must be between 1 and 12",
            )

        range_start = date(start_year, start_month, 1)

        if end_month == 12:
            range_end = date(end_year, 12, 31)
        else:
            range_end = (
                date(end_year, end_month + 1, 1)
                - timedelta(days=1)
            )

        if range_start > range_end:
            raise HTTPException(
                status_code=400,
                detail="End month must be on or after the start month",
            )

        month_count = (
            (end_year - start_year) * 12
            + (end_month - start_month)
            + 1
        )

        if month_count > 24:
            raise HTTPException(
                status_code=400,
                detail="Custom ranges can span at most 24 months",
            )

        use_monthly_groups = True

    else:
        use_monthly_groups = (
            year is not None
            or month is not None
            or (
                start_date is not None
                and end_date is not None
            )
        )

        if start_year is not None and end_year is not None:
            # Year mode window — always annual buckets.
            range_start = date(start_year, 1, 1)
            range_end = date(end_year, 12, 31)

        elif start_date is not None and end_date is not None:
            range_start = start_date
            range_end = end_date

        elif year is not None and month is not None:
            range_start = date(year, month, 1)

            if month == 12:
                range_end = date(year, 12, 31)
            else:
                range_end = (
                    date(year, month + 1, 1)
                    - timedelta(days=1)
                )

        elif year is not None:
            range_start = date(year, 1, 1)
            range_end = date(year, 12, 31)

        else:
            range_start = None
            range_end = None

    group_expression = (
        "DATE_TRUNC('month', event_date)::date"
        if use_monthly_groups
        else "DATE_TRUNC('year', event_date)::date"
    )

    result = db.execute(
        text(f"""
            WITH new_accounts AS (
                /*
                 * An account appears as New on its
                 * since_date, even if it has no booking.
                 */
                SELECT DISTINCT
                    m.member_number,
                    m.since_date::date AS event_date,
                    TRIM(m.member_or_guest)
                        AS account_category,
                    'New'::text AS account_status
                FROM members m
                WHERE m.since_date IS NOT NULL
                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')
            ),

            repeat_accounts AS (
                /*
                 * An account appears as Repeat when
                 * it has a booking after its since_date.
                 *
                 * DISTINCT prevents multiple bookings
                 * by the same account in the same month
                 * from counting that person repeatedly.
                 */
                SELECT DISTINCT
                    r.member_number,
                    r.check_in_date::date AS event_date,
                    TRIM(m.member_or_guest)
                        AS account_category,
                    'Repeat'::text AS account_status
                FROM rooms r
                JOIN members m
                  ON m.member_number =
                     r.member_number
                WHERE r.member_number IS NOT NULL
                  AND r.check_in_date IS NOT NULL
                  AND m.since_date IS NOT NULL
                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')
                  AND r.check_in_date::date >
                      m.since_date::date
            ),

            combined_events AS (
                SELECT * FROM new_accounts

                UNION ALL

                SELECT * FROM repeat_accounts
            ),

            filtered_events AS (
                SELECT
                    member_number,
                    event_date,
                    account_category,
                    account_status
                FROM combined_events
                WHERE (
                    CAST(:range_start AS date) IS NULL
                    OR event_date >=
                       CAST(:range_start AS date)
                )
                  AND (
                    CAST(:range_end AS date) IS NULL
                    OR event_date <=
                       CAST(:range_end AS date)
                )
            ),

            grouped_events AS (
                SELECT DISTINCT
                    member_number,
                    {group_expression}
                        AS period_start,
                    account_category,
                    account_status
                FROM filtered_events
            )

            SELECT
                period_start,

                CASE
                    WHEN :monthly = TRUE
                    THEN (
                        period_start
                        + INTERVAL '1 month'
                        - INTERVAL '1 day'
                    )::date

                    ELSE (
                        period_start
                        + INTERVAL '1 year'
                        - INTERVAL '1 day'
                    )::date
                END AS period_end,

                CASE
                    WHEN :monthly = TRUE
                    THEN TO_CHAR(
                        period_start,
                        'Mon YYYY'
                    )
                    ELSE TO_CHAR(
                        period_start,
                        'YYYY'
                    )
                END AS period_label,

                EXTRACT(
                    YEAR FROM period_start
                )::int AS year,

                CASE
                    WHEN :monthly = TRUE
                    THEN EXTRACT(
                        MONTH FROM period_start
                    )::int
                    ELSE NULL
                END AS month,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                )::int AS total_new,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                )::int AS total_repeat,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                      AND account_category = 'Member'
                )::int AS new_members,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                      AND account_category = 'Member'
                )::int AS repeat_members,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                      AND account_category = 'Guest'
                )::int AS new_guests,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                      AND account_category = 'Guest'
                )::int AS repeat_guests,

                COUNT(*)::int AS total_accounts

            FROM grouped_events
            GROUP BY period_start
            ORDER BY period_start
        """),
        {
            "range_start": range_start,
            "range_end": range_end,
            "monthly": use_monthly_groups,
        },
    ).mappings().all()

    return [dict(row) for row in result]


@router.get("/new-vs-repeat-visitors/details")
def get_new_vs_repeat_visitor_details(
    visitor_status: str,
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
):
    normalized_status = (
        visitor_status
        .strip()
        .lower()
    )

    if normalized_status not in {
        "new",
        "repeat",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "visitor_status must be "
                "either New or Repeat"
            ),
        )

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail=(
                "start_date cannot be "
                "after end_date"
            ),
        )

    if normalized_status == "new":
        result = db.execute(
            text("""
                SELECT DISTINCT ON (
                    m.member_number
                )
                    m.member_number,

                    COALESCE(
                        NULLIF(
                            TRIM(
                                m.member_full_name
                            ),
                            ''
                        ),
                        NULLIF(
                            TRIM(m.member_name),
                            ''
                        ),
                        'Unknown'
                    ) AS member_full_name,

                    TRIM(m.member_or_guest)
                        AS member_or_guest,

                    m.member_type,
                    m.status,

                    (
                        SELECT COUNT(*)
                        FROM dependents d
                        WHERE d.member_number =
                              m.member_number
                    )::int AS dependent_count,

                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,

                    ma.city,
                    ma.postal_code,
                    ma.country

                FROM members m

                LEFT JOIN LATERAL (
                    SELECT
                        a.city,
                        a.postal_code,
                        a.country
                    FROM member_addresses a
                    WHERE a.member_number =
                          m.member_number
                    ORDER BY
                        a.city NULLS LAST,
                        a.country NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE m.since_date::date
                      BETWEEN :start_date
                          AND :end_date

                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')

                ORDER BY
                    m.member_number,
                    m.member_full_name NULLS LAST,
                    m.member_name NULLS LAST
            """),
            {
                "start_date": start_date,
                "end_date": end_date,
            },
        ).mappings().all()

    else:
        result = db.execute(
            text("""
                SELECT DISTINCT ON (
                    m.member_number
                )
                    m.member_number,

                    COALESCE(
                        NULLIF(
                            TRIM(
                                m.member_full_name
                            ),
                            ''
                        ),
                        NULLIF(
                            TRIM(m.member_name),
                            ''
                        ),
                        'Unknown'
                    ) AS member_full_name,

                    TRIM(m.member_or_guest)
                        AS member_or_guest,

                    m.member_type,
                    m.status,

                    (
                        SELECT COUNT(*)
                        FROM dependents d
                        WHERE d.member_number =
                              m.member_number
                    )::int AS dependent_count,

                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,

                    ma.city,
                    ma.postal_code,
                    ma.country

                FROM members m

                JOIN rooms r
                  ON r.member_number =
                     m.member_number

                LEFT JOIN LATERAL (
                    SELECT
                        a.city,
                        a.postal_code,
                        a.country
                    FROM member_addresses a
                    WHERE a.member_number =
                          m.member_number
                    ORDER BY
                        a.city NULLS LAST,
                        a.country NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE r.check_in_date::date
                      BETWEEN :start_date
                          AND :end_date

                  AND m.since_date IS NOT NULL

                  AND r.check_in_date::date >
                      m.since_date::date

                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')

                ORDER BY
                    m.member_number,
                    r.check_in_date DESC
            """),
            {
                "start_date": start_date,
                "end_date": end_date,
            },
        ).mappings().all()

    return [dict(row) for row in result]
