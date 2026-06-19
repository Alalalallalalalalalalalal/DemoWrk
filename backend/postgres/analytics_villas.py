# backend/postgres/analytics_villas.py
"""
Villa / room booking analytics: per-villa stats, per-villa monthly trends,
bedroom-count breakdowns, booked member/guest rollups, the combined
visits-rooms dashboard, and villa x business-source breakdowns
(including the bedroom x source cross-tab).

All of these accept the common year/month/date/start_date/end_date filter
set via `date_filter_sql`, applied against folios.check_in_date /
check_out_date.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import date

from .analytics_shared import get_db, rows, one, date_filter_sql, filter_params, valid_booking_sql

router = APIRouter()


@router.get("/villa-stats")
def villa_stats(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    # One row per villa + bedroom count.
    # This prevents villas with multiple bedroom configurations from being collapsed
    # into a single comma-separated bedroom_counts value.
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name) AS villa_name,
                MAX(f.bedroom_count) AS bedroom_count,
                MAX(f.member_number) AS member_number,
                MAX(f.persons) AS persons,
                MAX(f.check_out_date - f.check_in_date) AS nights,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                ) AS revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT
            villa_name,
            bedroom_count,
            bedroom_count::text AS bedroom_counts,
            bedroom_count AS min_bedrooms,
            bedroom_count AS max_bedrooms,
            COUNT(*) AS bookings,
            SUM(nights) AS total_nights,
            ROUND(AVG(nights)::numeric, 1) AS avg_stay,
            COUNT(DISTINCT member_number) AS unique_members,
            SUM(persons) AS total_guests,
            ROUND(AVG(persons)::numeric, 1) AS avg_party_size,
            SUM(revenue) AS revenue
        FROM booking_rows
        GROUP BY villa_name, bedroom_count
        ORDER BY bookings DESC, villa_name, bedroom_count NULLS LAST
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/villa-monthly")
def villa_monthly(
    villa: str = Query(...),
    group_by: str = Query(default="month", pattern="^(month|year)$"),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if group_by == "year":
        select_clause = """
          EXTRACT(YEAR FROM check_in_date)::int AS year,
          EXTRACT(YEAR FROM check_in_date)::int AS sort_key,
        """
        group_clause = "year, sort_key"
        order_clause = "sort_key"
    else:
        select_clause = """
          TO_CHAR(check_in_date, 'Mon') AS month,
          EXTRACT(MONTH FROM check_in_date)::int AS sort_key,
        """
        group_clause = "month, sort_key"
        order_clause = "sort_key"

    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                MAX(f.check_out_date - f.check_in_date) AS nights,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                ) AS revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name = :villa
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT
          {select_clause}
          COUNT(*) AS bookings,
          COALESCE(SUM(revenue), 0) AS revenue
        FROM booking_rows
        GROUP BY {group_clause}
        ORDER BY {order_clause}
    """, {"villa": villa, **filter_params(year, month, date, start_date, end_date)})


@router.get("/bookings-by-bedroom")
def bookings_by_bedroom(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        SELECT
          f.bedroom_count AS beds,
          COUNT(DISTINCT f.conf_code) AS bookings,
          SUM(f.check_out_date - f.check_in_date) AS total_nights,
          ROUND(AVG(f.check_out_date - f.check_in_date), 1) AS avg_stay
        FROM folios f
        WHERE f.bedroom_count IS NOT NULL
          AND f.check_in_date IS NOT NULL
          AND f.check_out_date IS NOT NULL
          AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
            'cancelled', 'canceled', 'no-show'
          )
          {date_filter_sql("f")}
        GROUP BY f.bedroom_count
        ORDER BY f.bedroom_count
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/bedroom-bookings")
def bedroom_bookings(
    beds: int = Query(...),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name) AS villa_name,
                MAX(f.member_number) AS member_number,
                MAX(m.member_full_name) AS member_full_name,
                MAX(m.member_name) AS member_name,
                MAX(m.email) AS email,
                MAX(m.prefix) AS title,
                MAX(mp.phone_number) AS phone,
                MAX(TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(a.address_line1, ''),
                        NULLIF(a.address_line2, ''),
                        NULLIF(a.city, ''),
                        NULLIF(a.state, ''),
                        NULLIF(a.postal_code, ''),
                        NULLIF(a.country, '')
                    )
                )) AS address,
                MAX(a.country) AS country,
                MAX(a.state) AS state,
                MAX(f.guest_name) AS guest_name,
                MAX(f.persons) AS persons,
                MAX(f.bedroom_count) AS bedroom_count,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                MAX(f.check_out_date - f.check_in_date) AS nights
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            LEFT JOIN member_addresses a
              ON a.member_number = f.member_number
            LEFT JOIN (
                SELECT DISTINCT ON (member_number)
                    member_number,
                    phone_number
                FROM member_phones
                WHERE phone_number IS NOT NULL
                ORDER BY
                    member_number,
                    CASE phone_type
                        WHEN 'cell' THEN 1
                        WHEN 'home' THEN 2
                        WHEN 'business' THEN 3
                        ELSE 4
                    END
            ) mp
              ON mp.member_number = f.member_number
            WHERE f.conf_code IS NOT NULL
              AND f.bedroom_count = :beds
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT *
        FROM booking_rows
        ORDER BY check_in_date DESC
    """, {"beds": beds, **filter_params(year, month, date, start_date, end_date)})


@router.get("/monthly-revenue")
def monthly_revenue(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                ) AS revenue
            FROM folios f
            WHERE f.conf_code IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT
          TO_CHAR(check_in_date, 'Mon') AS month,
          EXTRACT(MONTH FROM check_in_date)::int AS month_num,
          COUNT(*) AS bookings,
          COALESCE(SUM(revenue), 0) AS revenue
        FROM booking_rows
        GROUP BY month, month_num
        ORDER BY month_num
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/visits-tab-summary")
def visits_tab_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return one(db, f"""
        WITH bookings AS (
            SELECT
                f.conf_code,
                MAX(f.member_number) AS member_number,
                MAX(m.member_or_guest) AS member_or_guest,
                MAX(f.persons) AS persons,
                MAX(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                MAX(f.check_out_date - f.check_in_date) AS nights,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                ) AS villa_revenue
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            LEFT JOIN member_addresses a
              ON a.member_number = f.member_number
            LEFT JOIN (
                SELECT DISTINCT ON (member_number)
                    member_number,
                    phone_number
                FROM member_phones
                WHERE phone_number IS NOT NULL
                ORDER BY
                    member_number,
                    CASE phone_type
                        WHEN 'cell' THEN 1
                        WHEN 'home' THEN 2
                        WHEN 'business' THEN 3
                        ELSE 4
                    END
            ) mp
              ON mp.member_number = f.member_number
            WHERE {valid_booking_sql("f")}
              AND f.villa_name IS NOT NULL
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT
            COUNT(DISTINCT member_number) FILTER (
                WHERE member_or_guest = 'Member'
                   OR member_or_guest IS NULL
            ) AS total_members_booked,

            COUNT(DISTINCT member_number) FILTER (
                WHERE member_or_guest = 'Guest'
            ) AS total_guests_booked,

            ROUND(AVG(nights)::numeric, 1) AS avg_length_of_stay,
            ROUND(AVG(persons)::numeric, 1) AS avg_party_size,
            COALESCE(SUM(nights), 0) AS total_room_nights,
            COALESCE(SUM(villa_revenue), 0) AS villa_rental_revenue
        FROM bookings
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/villa-bookings")
def villa_bookings(
    villa: str = Query(...),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name) AS villa_name,
                MAX(f.member_number) AS member_number,
                MAX(m.member_full_name) AS member_full_name,
                MAX(m.member_name) AS member_name,
                MAX(m.email) AS email,
                MAX(m.prefix) AS title,
                MAX(mp.phone_number) AS phone,
                MAX(TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(a.address_line1, ''),
                        NULLIF(a.address_line2, ''),
                        NULLIF(a.city, ''),
                        NULLIF(a.state, ''),
                        NULLIF(a.postal_code, ''),
                        NULLIF(a.country, '')
                    )
                )) AS address,
                MAX(a.country) AS country,
                MAX(a.state) AS state,
                MAX(f.guest_name) AS guest_name,
                MAX(f.persons) AS persons,
                MAX(f.bedroom_count) AS bedroom_count,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                MAX(f.check_out_date - f.check_in_date) AS nights,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                ) AS revenue
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            LEFT JOIN member_addresses a
              ON a.member_number = f.member_number
            LEFT JOIN (
                SELECT DISTINCT ON (member_number)
                    member_number,
                    phone_number
                FROM member_phones
                WHERE phone_number IS NOT NULL
                ORDER BY
                    member_number,
                    CASE phone_type
                        WHEN 'cell' THEN 1
                        WHEN 'home' THEN 2
                        WHEN 'business' THEN 3
                        ELSE 4
                    END
            ) mp
              ON mp.member_number = f.member_number
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name = :villa
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        )
        SELECT
            br.*,
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'guest_name', rg.guest_name,
                        'member_number', rg.member_number,
                        'is_owner', rg.is_owner,
                        'room_number', rg.room_number,
                        'check_in_date', rg.check_in_date,
                        'check_out_date', rg.check_out_date
                    )
                ) FILTER (WHERE rg.guest_name IS NOT NULL),
                '[]'
            ) AS guests
        FROM booking_rows br
        LEFT JOIN reservation_guests rg
          ON rg.conf_code = br.conf_code
        GROUP BY
            br.conf_code,
            br.villa_name,
            br.member_number,
            br.member_full_name,
            br.member_name,
            br.email,
            br.title,
            br.phone,
            br.address,
            br.country,
            br.state,
            br.guest_name,
            br.persons,
            br.bedroom_count,
            br.check_in_date,
            br.check_out_date,
            br.nights,
            br.revenue
        ORDER BY br.check_in_date DESC
    """, {"villa": villa, **filter_params(year, month, date, start_date, end_date)})


@router.get("/booked-people")
def booked_people(
    kind: str = Query(pattern="^(members|guests)$"),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    member_filter = """
      AND (
        m.member_or_guest = 'Member'
        OR m.member_or_guest IS NULL
      )
    """ if kind == "members" else """
      AND m.member_or_guest = 'Guest'
    """

    return rows(db, f"""
        WITH booked_accounts AS (
            SELECT
                f.conf_code,
                f.member_number,
                MAX(m.member_full_name) AS member_full_name,
                MAX(m.member_name) AS member_name,
                MAX(m.member_type) AS member_type,
                MAX(m.member_or_guest) AS member_or_guest,
                MAX(m.email) AS email,
                MAX(m.prefix) AS title,
                MAX(mp.phone_number) AS phone,
                MAX(TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(a.address_line1, ''),
                        NULLIF(a.address_line2, ''),
                        NULLIF(a.city, ''),
                        NULLIF(a.state, ''),
                        NULLIF(a.postal_code, ''),
                        NULLIF(a.country, '')
                    )
                )) AS address,
                MAX(a.country) AS country,
                MAX(a.state) AS state,
                MAX(f.guest_name) AS folio_guest_name,
                MAX(f.persons) AS persons,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date,
                GREATEST(MAX(f.check_out_date) - MIN(f.check_in_date), 0) AS nights
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            LEFT JOIN member_addresses a
              ON a.member_number = f.member_number
            LEFT JOIN (
                SELECT DISTINCT ON (member_number)
                    member_number,
                    phone_number
                FROM member_phones
                WHERE phone_number IS NOT NULL
                ORDER BY
                    member_number,
                    CASE phone_type
                        WHEN 'cell' THEN 1
                        WHEN 'home' THEN 2
                        WHEN 'business' THEN 3
                        ELSE 4
                    END
            ) mp
              ON mp.member_number = f.member_number
            WHERE {valid_booking_sql("f")}
              {member_filter}
              {date_filter_sql("f")}
            GROUP BY f.conf_code, f.member_number
        ),
        reservation_guest_rows AS (
            SELECT
                ba.conf_code,
                rg.member_number AS reservation_member_number,
                rg.guest_name,
                rg.room_number,
                rg.is_owner,
                rg.check_in_date AS guest_check_in_date,
                rg.check_out_date AS guest_check_out_date
            FROM booked_accounts ba
            LEFT JOIN reservation_guests rg
              ON rg.conf_code = ba.conf_code
        )
        SELECT
            ba.member_number,
            ba.member_full_name,
            ba.member_name,
            ba.member_type,
            ba.member_or_guest,
            ba.email,
            ba.title,
            ba.phone,
            ba.address,
            ba.country,
            ba.state,
            MAX(ba.folio_guest_name) AS folio_guest_name,
            COUNT(DISTINCT ba.conf_code) AS bookings,
            MIN(ba.check_in_date) AS first_check_in,
            MAX(ba.check_out_date) AS last_check_out,
           SUM(DISTINCT ba.nights) AS nights,
            SUM(COALESCE(ba.persons, 0)) AS total_party_size,
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'guest_name', rgr.guest_name,
                        'member_number', rgr.reservation_member_number,
                        'room_number', rgr.room_number,
                        'is_owner', rgr.is_owner,
                        'check_in_date', rgr.guest_check_in_date,
                        'check_out_date', rgr.guest_check_out_date
                    )
                ) FILTER (WHERE rgr.guest_name IS NOT NULL),
                '[]'
            ) AS reservation_guests
        FROM booked_accounts ba
        LEFT JOIN reservation_guest_rows rgr
          ON rgr.conf_code = ba.conf_code
        GROUP BY
            ba.member_number,
            ba.member_full_name,
            ba.member_name,
            ba.member_type,
            ba.member_or_guest,
            ba.email,
            ba.title,
            ba.phone,
            ba.address,
            ba.country,
            ba.state
        ORDER BY bookings DESC, member_full_name, member_name
        LIMIT 1000
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/visits-rooms-dashboard")
def visits_rooms_dashboard(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    summary = visits_tab_summary(year=year, month=month, date=date, start_date=start_date, end_date=end_date, db=db)
    villa_stats_data = villa_stats(year=year, month=month, date=date, start_date=start_date, end_date=end_date, db=db)
    bedroom_stats = bookings_by_bedroom(year=year, month=month, date=date, start_date=start_date, end_date=end_date, db=db)
    monthly_revenue_data = monthly_revenue(year=year, month=month, date=date, start_date=start_date, end_date=end_date, db=db)

    selected_villa = villa
    if not selected_villa and villa_stats_data:
        selected_villa = villa_stats_data[0].get("villa_name")

    villa_monthly_data = (
        villa_monthly(
            villa=selected_villa,
            year=year,
            month=month,
            date=date,
            start_date=start_date,
            end_date=end_date,
            db=db,
        )
        if selected_villa
        else []
    )

    return {
        "summary": summary,
        "villa_stats": villa_stats_data,
        "bookings_by_bedroom": bedroom_stats,
        "monthly_revenue": monthly_revenue_data,
        "villa_monthly": villa_monthly_data,
        "selected_villa": selected_villa,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Villa × Business Source endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/villa-source-breakdown")
def villa_source_breakdown(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Returns per-villa booking counts, nights, and revenue split by source.
    Each row carries:
      - villa_name
      - source
      - payment_type
      - is_free
      - bookings
      - total_nights
      - revenue
      - free_value
      - total_value
      - unique_members
      - avg_bedrooms
      - bedroom_distribution  JSON string {"1": 4, "2": 10, ...}
      - most_common_bedrooms  most-booked bedroom count for this slice
    """
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name)                                    AS villa_name,
                COALESCE(NULLIF(TRIM(MAX(f.source)), ''), 'Unknown') AS source,
                COALESCE(
                    NULLIF(TRIM(MAX(f.payment_type)), ''),
                    NULLIF(TRIM(MAX(bs.payment_type)), ''),
                    'Unknown'
                )                                                    AS payment_type,
                MAX(f.member_number)                                 AS member_number,
                MAX(f.check_out_date - f.check_in_date)              AS nights,
                MAX(f.bedroom_count)                                 AS bedroom_count,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                )                                                    AS raw_amount
            FROM folios f
            LEFT JOIN business_source bs
                ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code
        ),
        tagged AS (
            SELECT
                *,
                CASE
                    WHEN LOWER(payment_type) ILIKE '%comp%'
                      OR LOWER(payment_type) ILIKE '%free%'
                      OR LOWER(payment_type) ILIKE '%complimentary%'
                      OR LOWER(payment_type) ILIKE '%gratis%'
                      OR LOWER(payment_type) ILIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END AS is_free
            FROM booking_rows
        ),
        bedroom_dist AS (
            SELECT
                villa_name,
                source,
                payment_type,
                is_free,
                jsonb_object_agg(
                    COALESCE(bedroom_count::text, 'Unknown'),
                    cnt
                )::text AS bedroom_distribution,
                (
                    SELECT bedroom_count
                    FROM (
                        SELECT bedroom_count, COUNT(*) AS c
                        FROM tagged t2
                        WHERE t2.villa_name = t.villa_name
                          AND t2.source = t.source
                          AND t2.payment_type = t.payment_type
                          AND t2.is_free = t.is_free
                        GROUP BY bedroom_count
                        ORDER BY c DESC NULLS LAST
                        LIMIT 1
                    ) sub
                ) AS most_common_bedrooms
            FROM (
                SELECT
                    villa_name, source, payment_type, is_free,
                    bedroom_count, COUNT(*)::int AS cnt
                FROM tagged
                GROUP BY villa_name, source, payment_type, is_free, bedroom_count
            ) t
            GROUP BY villa_name, source, payment_type, is_free
        )
        SELECT
            tg.villa_name,
            tg.source,
            tg.payment_type,
            tg.is_free,
            COUNT(*)::int                                       AS bookings,
            COALESCE(SUM(tg.nights), 0)::int                   AS total_nights,
            ROUND(
                SUM(CASE WHEN NOT tg.is_free THEN tg.raw_amount ELSE 0 END)::numeric,
                2
            )                                                   AS revenue,
            ROUND(SUM(tg.raw_amount)::numeric, 2)              AS total_value,
            ROUND(
                SUM(CASE WHEN tg.is_free THEN tg.raw_amount ELSE 0 END)::numeric,
                2
            )                                                   AS free_value,
            COUNT(DISTINCT tg.member_number)::int               AS unique_members,
            ROUND(AVG(tg.bedroom_count)::numeric, 1)            AS avg_bedrooms,
            bd.bedroom_distribution,
            bd.most_common_bedrooms
        FROM tagged tg
        LEFT JOIN bedroom_dist bd
            ON bd.villa_name    = tg.villa_name
           AND bd.source        = tg.source
           AND bd.payment_type  = tg.payment_type
           AND bd.is_free       = tg.is_free
        GROUP BY tg.villa_name, tg.source, tg.payment_type, tg.is_free,
                 bd.bedroom_distribution, bd.most_common_bedrooms
        ORDER BY tg.villa_name, tg.is_free, bookings DESC
    """, filter_params(year, month, date, start_date, end_date))


@router.get("/villa-source-bookings")
def villa_source_bookings(
    villa: str = Query(...),
    source: str | None = Query(default=None),
    is_free: bool | None = Query(default=None),
    bedrooms: int | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Drilldown: every booking for a specific villa, optionally filtered by
    source, paid/free flag, and/or bedroom count.
    """
    source_filter = ""
    if source is not None and source != "All":
        source_filter = "AND COALESCE(NULLIF(TRIM(f.source), ''), 'Unknown') = :source_val"

    free_filter = ""
    if is_free is not None:
        free_filter = """
            AND (
                CASE
                    WHEN LOWER(COALESCE(
                            NULLIF(TRIM(f.payment_type), ''),
                            NULLIF(TRIM(bs.payment_type), ''),
                            'Unknown'
                         )) ILIKE '%comp%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(f.payment_type), ''),
                            NULLIF(TRIM(bs.payment_type), ''),
                            'Unknown'
                         )) ILIKE '%free%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(f.payment_type), ''),
                            NULLIF(TRIM(bs.payment_type), ''),
                            'Unknown'
                         )) ILIKE '%complimentary%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(f.payment_type), ''),
                            NULLIF(TRIM(bs.payment_type), ''),
                            'Unknown'
                         )) ILIKE '%gratis%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(f.payment_type), ''),
                            NULLIF(TRIM(bs.payment_type), ''),
                            'Unknown'
                         )) ILIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END
            ) = :is_free_val
        """

    bedroom_filter = "AND f.bedroom_count = :bedrooms_val" if bedrooms is not None else ""

    params = {
        "villa": villa,
        "source_val": source,
        "is_free_val": is_free,
        "bedrooms_val": bedrooms,
        **filter_params(year, month, date, start_date, end_date),
    }

    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                MAX(f.villa_name)                                        AS villa_name,
                MAX(f.member_number)                                     AS member_number,
                MAX(m.member_full_name)                                  AS member_full_name,
                MAX(m.member_name)                                       AS member_name,
                MAX(m.member_type)                                       AS member_type,
                MAX(m.member_or_guest)                                   AS member_or_guest,
                MAX(m.email)                                             AS email,
                MAX(m.prefix)                                            AS title,
                MAX(mp.phone_number)                                     AS phone,
                MAX(TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(a.address_line1, ''),
                        NULLIF(a.address_line2, ''),
                        NULLIF(a.city, ''),
                        NULLIF(a.state, ''),
                        NULLIF(a.postal_code, ''),
                        NULLIF(a.country, '')
                    )
                ))                                                       AS address,
                MAX(a.country)                                           AS country,
                MAX(a.state)                                             AS state,
                MAX(f.guest_name)                                        AS guest_name,
                MAX(f.folio_name)                                        AS folio_name,
                MAX(f.persons)                                           AS persons,
                MAX(f.bedroom_count)                                     AS bedroom_count,
                MIN(f.check_in_date)                                     AS check_in_date,
                MAX(f.check_out_date)                                    AS check_out_date,
                MAX(f.check_out_date - f.check_in_date)                 AS nights,
                COALESCE(NULLIF(TRIM(MAX(f.source)), ''), 'Unknown')    AS source,
                COALESCE(
                    NULLIF(TRIM(MAX(f.payment_type)), ''),
                    NULLIF(TRIM(MAX(bs.payment_type)), ''),
                    'Unknown'
                )                                                        AS payment_type,
                MAX(f.reservation_status)                               AS reservation_status,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                )                                                        AS total_amount,
                CASE
                    WHEN LOWER(COALESCE(
                            NULLIF(TRIM(MAX(f.payment_type)), ''),
                            NULLIF(TRIM(MAX(bs.payment_type)), ''),
                            'Unknown'
                         )) ILIKE '%comp%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(MAX(f.payment_type)), ''),
                            NULLIF(TRIM(MAX(bs.payment_type)), ''),
                            'Unknown'
                         )) ILIKE '%free%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(MAX(f.payment_type)), ''),
                            NULLIF(TRIM(MAX(bs.payment_type)), ''),
                            'Unknown'
                         )) ILIKE '%complimentary%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(MAX(f.payment_type)), ''),
                            NULLIF(TRIM(MAX(bs.payment_type)), ''),
                            'Unknown'
                         )) ILIKE '%gratis%'
                      OR LOWER(COALESCE(
                            NULLIF(TRIM(MAX(f.payment_type)), ''),
                            NULLIF(TRIM(MAX(bs.payment_type)), ''),
                            'Unknown'
                         )) ILIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END                                                      AS is_free
            FROM folios f
            LEFT JOIN members m
                ON m.member_number = f.member_number
            LEFT JOIN member_addresses a
                ON a.member_number = f.member_number
            LEFT JOIN (
                SELECT DISTINCT ON (member_number)
                    member_number, phone_number
                FROM member_phones
                WHERE phone_number IS NOT NULL
                ORDER BY member_number,
                    CASE phone_type
                        WHEN 'cell'     THEN 1
                        WHEN 'home'     THEN 2
                        WHEN 'business' THEN 3
                        ELSE 4
                    END
            ) mp ON mp.member_number = f.member_number
            LEFT JOIN business_source bs
                ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name = :villa
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
              {source_filter}
              {free_filter}
              {bedroom_filter}
            GROUP BY f.conf_code
        )
        SELECT
            br.*,
            COALESCE(
                (
                    SELECT json_agg(
                        DISTINCT jsonb_build_object(
                            'guest_name',    rg.guest_name,
                            'member_number', rg.member_number,
                            'is_owner',      rg.is_owner,
                            'room_number',   rg.room_number,
                            'check_in_date', rg.check_in_date,
                            'check_out_date',rg.check_out_date
                        )
                    )
                    FROM reservation_guests rg
                    WHERE rg.conf_code = br.conf_code
                      AND rg.guest_name IS NOT NULL
                ),
                '[]'::json
            ) AS guests
        FROM booking_rows br
        ORDER BY br.check_in_date DESC NULLS LAST
    """, params)


@router.get("/villa-source-bedroom-breakdown")
def villa_source_bedroom_breakdown(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Cross-tab of bedroom_count × source × paid/free.
    Powers the Bedroom Intelligence card.
    Each row: bedroom_count, source, is_free, bookings, total_nights,
              revenue, free_value, unique_members
    """
    return rows(db, f"""
        WITH booking_rows AS (
            SELECT
                f.conf_code,
                f.bedroom_count,
                COALESCE(NULLIF(TRIM(MAX(f.source)), ''), 'Unknown') AS source,
                COALESCE(
                    NULLIF(TRIM(MAX(f.payment_type)), ''),
                    NULLIF(TRIM(MAX(bs.payment_type)), ''),
                    'Unknown'
                )                                                    AS payment_type,
                MAX(f.member_number)                                 AS member_number,
                MAX(f.check_out_date - f.check_in_date)              AS nights,
                SUM(
                    CASE
                        WHEN f.description ILIKE '%villa%'
                          OR f.description ILIKE '%room%'
                          OR f.description ILIKE '%rental%'
                          OR f.description ILIKE '%accommodation%'
                        THEN COALESCE(f.amount, 0)
                        ELSE 0
                    END
                )                                                    AS raw_amount
            FROM folios f
            LEFT JOIN business_source bs
                ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND f.bedroom_count IS NOT NULL
              AND COALESCE(LOWER(f.reservation_status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql("f")}
            GROUP BY f.conf_code, f.bedroom_count
        ),
        tagged AS (
            SELECT *,
                CASE
                    WHEN LOWER(payment_type) ILIKE '%comp%'
                      OR LOWER(payment_type) ILIKE '%free%'
                      OR LOWER(payment_type) ILIKE '%complimentary%'
                      OR LOWER(payment_type) ILIKE '%gratis%'
                      OR LOWER(payment_type) ILIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END AS is_free
            FROM booking_rows
        )
        SELECT
            bedroom_count,
            source,
            is_free,
            COUNT(*)::int                                         AS bookings,
            COALESCE(SUM(nights), 0)::int                        AS total_nights,
            ROUND(
                SUM(CASE WHEN NOT is_free THEN raw_amount ELSE 0 END)::numeric, 2
            )                                                     AS revenue,
            ROUND(
                SUM(CASE WHEN is_free THEN raw_amount ELSE 0 END)::numeric, 2
            )                                                     AS free_value,
            COUNT(DISTINCT member_number)::int                    AS unique_members
        FROM tagged
        GROUP BY bedroom_count, source, is_free
        ORDER BY bedroom_count NULLS LAST, bookings DESC
    """, filter_params(year, month, date, start_date, end_date))