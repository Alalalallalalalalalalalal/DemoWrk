"""
Villa people endpoints: booked members/guests roster and homeowner
booking-summary reconciliation.
"""

from __future__ import annotations

from datetime import date as _date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..analytics_shared import get_db, rows, one
from ._shared import (
    resolve_period,
    period_params,
    booking_base_cte,
    people_ctes,
    villa_paid_free_metrics_cte,
    txn_date_filter,
)

router = APIRouter()


@router.get("/booked-people")
def booked_people(
    kind: str = Query(
        pattern="^(members|guests)$"
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

    member_filter = (
        "COALESCE(m.member_or_guest, 'Member') = 'Member'"
        if kind == "members"
        else "m.member_or_guest = 'Guest'"
    )

    return rows(
        db,
        f"""
        WITH
        {booking_base_cte(
            p,
            lean=False,
        )},
        {people_ctes()},

        filtered_bookings AS (
            SELECT b.*
            FROM booking_base b
            LEFT JOIN members m
              ON m.member_number = b.member_number
            WHERE b.member_number IS NOT NULL
              AND {member_filter}
        ),

        person_totals AS (
            SELECT
                member_number,
                MAX(guest_name) AS folio_guest_name,
                COUNT(DISTINCT conf_code)::int
                    AS bookings,
                MIN(check_in_date) AS first_check_in,
                MAX(check_out_date) AS last_check_out,
                COALESCE(SUM(nights), 0)::int
                    AS nights,
                COALESCE(SUM(persons), 0)::int
                    AS total_party_size
            FROM filtered_bookings
            GROUP BY member_number
        ),

        person_guests AS (
            SELECT
                fb.member_number,
                COALESCE(
                    JSONB_AGG(
                        DISTINCT guest_item
                    ) FILTER (
                        WHERE guest_item IS NOT NULL
                    ),
                    '[]'::jsonb
                ) AS rooms
            FROM filtered_bookings fb
            LEFT JOIN LATERAL
                JSONB_ARRAY_ELEMENTS(
                    fb.guests::jsonb
                ) guest_item
                ON TRUE
            GROUP BY fb.member_number
        )

        SELECT
            pt.member_number,
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
            pt.folio_guest_name,
            pt.bookings,
            pt.first_check_in,
            pt.last_check_out,
            pt.nights,
            pt.total_party_size,
            COALESCE(
                pg.rooms,
                '[]'::jsonb
            ) AS rooms
        FROM person_totals pt
        LEFT JOIN members m
          ON m.member_number = pt.member_number
        LEFT JOIN member_address ma
          ON ma.member_number = pt.member_number
        LEFT JOIN member_phone mp
          ON mp.member_number = pt.member_number
        LEFT JOIN person_guests pg
          ON pg.member_number = pt.member_number
        ORDER BY
            pt.bookings DESC,
            m.member_full_name,
            m.member_name
        LIMIT 1000
        """,
        period_params(p),
    )


@router.get("/booking-summary")
def booking_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Detailed homeowner reconciliation remains rate-detail based.

    The `summary` section now uses the same authoritative per-villa booking and
    amount rules as /villa-paid-free-totals when a villa is supplied. When no
    villa is supplied, the metrics are summed across villas.
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

    if p.start is not None:
        checkin_filter = (
            "AND rd.check_in_date "
            "BETWEEN :range_start AND :range_end"
        )
    elif p.month_only is not None:
        checkin_filter = (
            "AND EXTRACT(MONTH FROM "
            "rd.check_in_date)::int = :month_only"
        )
    else:
        checkin_filter = ""

    cte = rf"""
    statement_income AS (
        SELECT
            sd.member_number,
            sd.statement_period,
            DATE_TRUNC(
                'month',
                sd.transaction_date
            )::date AS statement_month,
            ROUND(
                SUM(
                    COALESCE(sd.amount, 0) * -1
                )::numeric,
                2
            ) AS homeowner_villa_income
        FROM statement_details sd
        WHERE sd.description ILIKE '%villa income%'
          AND sd.member_number IS NOT NULL
        GROUP BY
            sd.member_number,
            sd.statement_period,
            DATE_TRUNC(
                'month',
                sd.transaction_date
            )
    ),

    homeowner_income AS (
        SELECT
            si.member_number,
            NULLIF(
                TRIM(vom.villa_name),
                ''
            ) AS villa_name,
            si.statement_period,
            si.statement_month,
            si.homeowner_villa_income
        FROM statement_income si
        JOIN villa_owner_map vom
          ON TRIM(vom.member_number::text) =
             TRIM(si.member_number::text)
        WHERE NULLIF(
            TRIM(vom.villa_name),
            ''
        ) IS NOT NULL
    ),

    deduplicated_bookings AS (
        SELECT
            rd.rate_detail_key,
            rd.conf_code,
            rd.reservation_id,
            rd.member_number,
            rd.guest_name,
            rd.villa_name,
            rd.bedroom_count,
            rd.source,
            rd.payment_type,
            rd.check_in_date,
            rd.check_out_date,
            rd.reservation_status,
            rd.status,
            rd.total_rental,
            ROW_NUMBER() OVER (
                PARTITION BY TRIM(rd.conf_code)
                ORDER BY
                    rd.updated_at DESC NULLS LAST,
                    rd.created_at DESC NULLS LAST,
                    rd.rate_detail_key DESC
            ) AS booking_row_number
        FROM rate_details rd
        WHERE rd.conf_code IS NOT NULL
          AND TRIM(rd.conf_code) <> ''
          AND rd.villa_name IS NOT NULL
          AND rd.check_in_date IS NOT NULL
          AND COALESCE(
                LOWER(TRIM(rd.status)),
                ''
              ) <> 'unposted'
          AND COALESCE(
                LOWER(TRIM(rd.reservation_status)),
                ''
              ) NOT IN (
                'cancelled',
                'canceled',
                'no-show',
                'no show'
              )
          AND LOWER(TRIM(rd.villa_name)) <> 'zz comp'
          AND (
                :villa IS NULL
                OR LOWER(TRIM(rd.villa_name)) =
                   LOWER(TRIM(:villa))
              )
          {checkin_filter}
    ),

    booking_details AS (
        SELECT
            rd.conf_code,
            rd.reservation_id,
            rd.member_number AS booking_member_number,
            rd.guest_name,
            NULLIF(
                TRIM(rd.villa_name),
                ''
            ) AS villa_name,
            rd.bedroom_count,
            COALESCE(
                NULLIF(TRIM(rd.source), ''),
                'Unknown'
            ) AS source,
            COALESCE(
                NULLIF(TRIM(rd.payment_type), ''),
                'Unknown'
            ) AS payment_type,
            rd.check_in_date,
            rd.check_out_date,
            rd.reservation_status,
            rd.status,
            ROUND(
                COALESCE(
                    rd.total_rental,
                    0
                )::numeric,
                2
            ) AS total_rental,
            CASE
                WHEN LOWER(
                    TRIM(COALESCE(
                        rd.payment_type,
                        ''
                    ))
                ) IN (
                    'free',
                    'comp',
                    'complimentary',
                    'free/comp',
                    'free / comp'
                )
                OR LOWER(
                    TRIM(COALESCE(
                        rd.payment_type,
                        ''
                    ))
                ) LIKE '%free%'
                OR LOWER(
                    TRIM(COALESCE(
                        rd.payment_type,
                        ''
                    ))
                ) LIKE '%comp%'
                THEN TRUE
                ELSE FALSE
            END AS is_free
        FROM deduplicated_bookings rd
        WHERE rd.booking_row_number = 1
    ),

    matched_bookings AS (
        SELECT
            hi.member_number AS homeowner_member_number,
            hi.villa_name AS homeowner_villa,
            hi.statement_period,
            hi.statement_month,
            hi.homeowner_villa_income,
            bd.conf_code,
            bd.reservation_id,
            bd.booking_member_number,
            bd.guest_name,
            bd.villa_name,
            bd.bedroom_count,
            bd.source,
            bd.check_in_date,
            bd.check_out_date,
            bd.payment_type,
            CASE
                WHEN bd.is_free
                THEN 'Free/Comp'
                ELSE 'Paid'
            END AS booking_type,
            bd.is_free,
            bd.total_rental,
            bd.reservation_status,
            bd.status
        FROM homeowner_income hi
        LEFT JOIN booking_details bd
          ON LOWER(TRIM(bd.villa_name)) =
             LOWER(TRIM(hi.villa_name))
         AND DATE_TRUNC(
                'month',
                bd.check_in_date
             )::date = hi.statement_month
        WHERE
            :villa IS NULL
            OR LOWER(TRIM(hi.villa_name)) =
               LOWER(TRIM(:villa))
    )
    """

    summary = one(
        db,
        f"""
        WITH
        {booking_base_cte(p)},
        {villa_paid_free_metrics_cte(
            p,
            booking_src="booking_base",
        )}

        SELECT
            COALESCE(
                SUM(overall_bookings),
                0
            )::int AS total_bookings,

            COALESCE(
                SUM(paid_bookings),
                0
            )::int AS paid_bookings,

            COALESCE(
                SUM(free_bookings),
                0
            )::int AS free_bookings,

            ROUND(
                COALESCE(
                    SUM(paid_amount),
                    0
                )::numeric,
                2
            ) AS paid_revenue,

            ROUND(
                COALESCE(
                    SUM(free_amount),
                    0
                )::numeric,
                2
            ) AS free_value,

            ROUND(
                COALESCE(
                    SUM(overall_amount),
                    0
                )::numeric,
                2
            ) AS total_booking_value,

            (
                SELECT ROUND(
                    COALESCE(
                        SUM(
                            COALESCE(
                                sd.amount,
                                0
                            ) * -1
                        ),
                        0
                    )::numeric,
                    2
                )
                FROM statement_details sd
                LEFT JOIN villa_owner_map vom
                  ON TRIM(
                        vom.member_number::text
                     ) =
                     TRIM(
                        sd.member_number::text
                     )
                WHERE sd.description
                      ILIKE '%villa income%'
                  AND (
                        :villa IS NULL
                        OR LOWER(
                            TRIM(vom.villa_name)
                        ) =
                        LOWER(
                            TRIM(:villa)
                        )
                      )
                  {txn_date_filter(p, 'sd')}
            ) AS homeowner_villa_income,

            COALESCE(
                SUM(overview_booking_count),
                0
            )::int AS overview_booking_count,

            COALESCE(
                SUM(rate_booking_count),
                0
            )::int AS rate_booking_count,

            COALESCE(
                SUM(booking_count_difference),
                0
            )::int AS booking_count_difference

        FROM villa_paid_free_metrics

        WHERE
            :villa IS NULL
            OR LOWER(TRIM(villa_name)) =
               LOWER(TRIM(:villa))
        """,
        params,
    )

    details = rows(
        db,
        f"""
        WITH
        {cte}

        SELECT
            homeowner_member_number,
            homeowner_villa,
            statement_period,
            statement_month,
            homeowner_villa_income,
            conf_code,
            reservation_id,
            booking_member_number,
            guest_name,
            villa_name,
            bedroom_count,
            source,
            check_in_date,
            check_out_date,
            payment_type,
            booking_type,
            is_free,
            total_rental,
            reservation_status,
            status
        FROM matched_bookings
        ORDER BY
            statement_month DESC,
            homeowner_villa,
            check_in_date,
            conf_code
        """,
        params,
    )

    return {
        "summary": summary,
        "bookings": details,
    }
