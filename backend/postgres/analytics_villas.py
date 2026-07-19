# backend/postgres/analytics_villas.py
"""
Villa / room booking analytics using:
  * rate_details      -> booking dates, villa, bedrooms and stay metrics
  * statement_details -> member/guest evidence only (never booking revenue)
  * statement_villa_income_summary -> official Villa Income (owner_payout_total)
  * statement_details -> reconciliation of gross Villa Income components
  * rooms             -> occupied-room evidence (confirmation_code)
  * reservation_guests -> party size and guest detail per conf_code
  * members           -> Member / Guest classification and contact information

IMPORTANT DEDUPLICATION RULE
----------------------------
Every source is reduced before it is joined:
  * rate_details:       one row per conf_code
  * rooms:              one aggregate per confirmation_code

statement_details has no confirmation code or stay dates. It is therefore used
only as an additional source of distinct member numbers for Member/Guest counts.
Official Villa Income comes from statement_villa_income_summary.owner_payout_total.
statement_details is used only as a reconciliation check because its signed amount can be negative.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .analytics_shared import get_db, rows, one, date_filter_sql, filter_params

router = APIRouter()


# -----------------------------------------------------------------------------
# Shared SQL fragments
# -----------------------------------------------------------------------------

def summary_date_filter_sql(alias: str = "vi") -> str:
    """Apply dashboard filters to the monthly Villa Income summary."""
    return f"""
      AND (
        :date IS NULL
        OR {alias}.income_month_date = DATE_TRUNC('month', CAST(:date AS date))::date
      )
      AND (
        :date IS NOT NULL
        OR :start_date IS NULL
        OR {alias}.income_month_date >= DATE_TRUNC('month', CAST(:start_date AS date))::date
      )
      AND (
        :date IS NOT NULL
        OR :end_date IS NULL
        OR {alias}.income_month_date <= DATE_TRUNC('month', CAST(:end_date AS date))::date
      )
      AND (
        :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
        OR :year IS NULL
        OR EXTRACT(YEAR FROM {alias}.income_month_date)::int = :year
      )
      AND (
        :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
        OR :month IS NULL
        OR EXTRACT(MONTH FROM {alias}.income_month_date)::int = :month
      )
    """


def villa_income_cte(alias: str = "svis") -> str:
    """
    Normalize statement_villa_income_summary.

    The source contains only income_month and owner_payout_total. income_month
    may be stored as a date/timestamp or as YYYY-MM text, so it is normalized
    to the first day of its month for filtering and grouping.
    """
    month_text = f"NULLIF(TRIM(to_jsonb({alias}) ->> 'income_month'), '')"
    return f"""
        villa_income_rows AS (
            SELECT
                CASE
                    WHEN {month_text} ~ '^\\d{{4}}-\\d{{2}}$'
                        THEN ({month_text} || '-01')::date
                    WHEN {month_text} ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}'
                        THEN LEFT({month_text}, 10)::date
                    ELSE NULL
                END AS income_month_date,
                COALESCE(
                    NULLIF(to_jsonb({alias}) ->> 'owner_payout_total', '')::numeric,
                    0
                ) AS villa_income
            FROM statement_villa_income_summary {alias}
        )
    """


def statement_reconciliation_cte(alias: str = "sd") -> str:
    """Gross statement-side check; never used as the official Villa Income total."""
    return f"""
        statement_villa_check AS (
            SELECT
                ROUND(COALESCE(SUM(COALESCE({alias}.charge, 0)), 0)::numeric, 2) AS charge_total,
                ROUND(COALESCE(SUM(COALESCE({alias}.surcharge, 0)), 0)::numeric, 2) AS surcharge_total,
                ROUND(COALESCE(SUM(COALESCE({alias}.service_charge, 0)), 0)::numeric, 2) AS service_charge_total,
                ROUND(COALESCE(SUM(COALESCE({alias}.sales_tax, 0)), 0)::numeric, 2) AS sales_tax_total,
                ROUND(COALESCE(SUM(
                    COALESCE({alias}.charge, 0)
                    + COALESCE({alias}.surcharge, 0)
                    + COALESCE({alias}.service_charge, 0)
                    + COALESCE({alias}.sales_tax, 0)
                ), 0)::numeric, 2) AS gross_statement_total,
                ROUND(COALESCE(SUM(COALESCE({alias}.amount, 0)), 0)::numeric, 2) AS signed_amount_total,
                COUNT(*)::int AS statement_rows
            FROM statement_details {alias}
            WHERE {alias}.description ILIKE '%Villa Income%'
              AND (
                (:date IS NULL AND :start_date IS NULL AND :end_date IS NULL)
                OR (:date IS NOT NULL AND {alias}.transaction_date = :date)
                OR (
                  :date IS NULL
                  AND :start_date IS NOT NULL
                  AND :end_date IS NOT NULL
                  AND {alias}.transaction_date BETWEEN :start_date AND :end_date
                )
              )
              AND (
                :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                OR :year IS NULL
                OR EXTRACT(YEAR FROM {alias}.transaction_date)::int = :year
              )
              AND (
                :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                OR :month IS NULL
                OR EXTRACT(MONTH FROM {alias}.transaction_date)::int = :month
              )
        )
    """


def booking_base_cte(alias: str = "rd") -> str:
    """Return one booking row per confirmation code without statement fan-out."""
    return f"""
        rate_booking_rows AS (
            SELECT
                {alias}.conf_code,
                MAX(NULLIF(TRIM({alias}.villa_name), '')) AS villa_name,
                MAX({alias}.bedroom_count) AS bedroom_count,
                MAX({alias}.member_number) AS member_number,
                MAX(NULLIF(TRIM({alias}.guest_name), '')) AS guest_name,
                MIN({alias}.check_in_date) AS check_in_date,
                MAX({alias}.check_out_date) AS check_out_date,
                GREATEST(MAX({alias}.check_out_date) - MIN({alias}.check_in_date), 0) AS nights,
                COUNT(DISTINCT ({alias}.room_number, {alias}.rate_date))::int AS room_nights,
                COALESCE(NULLIF(TRIM(MAX({alias}.source)), ''), 'Unknown') AS source,
                COALESCE(NULLIF(TRIM(MAX({alias}.payment_type)), ''), 'Unknown') AS payment_type,
                MAX({alias}.reservation_status) AS reservation_status,
                ROUND(COALESCE(MAX({alias}.total_rental), SUM({alias}.total_amount), 0)::numeric, 2)
                    AS booking_revenue
            FROM rate_details {alias}
            WHERE {alias}.conf_code IS NOT NULL
              AND {alias}.check_in_date IS NOT NULL
              AND {alias}.check_out_date IS NOT NULL
              AND COALESCE(LOWER({alias}.reservation_status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
              {date_filter_sql(alias)}
            GROUP BY {alias}.conf_code
        ),
        room_detail_rows AS (
            SELECT DISTINCT
                r.confirmation_code AS conf_code,
                r.room_number,
                r.member_number,
                r.check_in_date,
                r.check_out_date
            FROM rooms r
            WHERE r.confirmation_code IS NOT NULL
              AND COALESCE(LOWER(r.status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
        ),
        room_rollup AS (
            SELECT
                conf_code,
                COUNT(DISTINCT room_number)::int AS occupied_rooms
            FROM room_detail_rows
            GROUP BY conf_code
        ),
        reservation_guest_rows AS (
            SELECT DISTINCT
                rg.conf_code,
                rg.member_number,
                NULLIF(TRIM(rg.guest_name), '') AS guest_name,
                rg.is_owner,
                rg.room_number,
                rg.check_in_date,
                rg.check_out_date
            FROM reservation_guests rg
            WHERE rg.conf_code IS NOT NULL
        ),
        reservation_guest_rollup AS (
            SELECT
                conf_code,
                COUNT(*) FILTER (
                    WHERE guest_name IS NOT NULL OR member_number IS NOT NULL
                )::int AS party_size,
                COALESCE(
                    json_agg(
                        jsonb_build_object(
                            'guest_name', guest_name,
                            'member_number', member_number,
                            'is_owner', is_owner,
                            'room_number', room_number,
                            'check_in_date', check_in_date,
                            'check_out_date', check_out_date
                        ) ORDER BY room_number, guest_name, member_number
                    ) FILTER (
                        WHERE guest_name IS NOT NULL OR member_number IS NOT NULL
                    ),
                    '[]'::json
                ) AS guests
            FROM reservation_guest_rows
            GROUP BY conf_code
        ),
        booking_base AS (
            SELECT
                rb.conf_code,
                rb.villa_name,
                rb.bedroom_count,
                rb.member_number,
                rb.guest_name,
                rb.check_in_date,
                rb.check_out_date,
                rb.nights,
                COALESCE(NULLIF(rb.room_nights, 0), rb.nights, 0)::int AS room_nights,
                rb.source,
                rb.payment_type,
                rb.reservation_status,
                GREATEST(COALESCE(NULLIF(rgr.party_size, 0), 1), 1)::int AS persons,
                COALESCE(rr.occupied_rooms, 0)::int AS occupied_rooms,
                COALESCE(rgr.guests, '[]'::json) AS guests,
                COALESCE(rb.booking_revenue, 0)::numeric AS revenue,
                CASE
                    WHEN LOWER(rb.payment_type) ILIKE '%comp%'
                      OR LOWER(rb.payment_type) ILIKE '%free%'
                      OR LOWER(rb.payment_type) ILIKE '%complimentary%'
                      OR LOWER(rb.payment_type) ILIKE '%gratis%'
                      OR LOWER(rb.payment_type) ILIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END AS is_free
            FROM rate_booking_rows rb
            LEFT JOIN room_rollup rr ON rr.conf_code = rb.conf_code
            LEFT JOIN reservation_guest_rollup rgr ON rgr.conf_code = rb.conf_code
        )
    """

def booked_people_source_cte() -> str:
    """Distinct people seen in rate_details, rooms, or statement_details."""
    return f"""
        booked_person_numbers AS (
            SELECT DISTINCT rb.member_number
            FROM rate_booking_rows rb
            WHERE rb.member_number IS NOT NULL

            UNION

            SELECT DISTINCT r.member_number
            FROM rooms r
            JOIN rate_booking_rows rb
              ON rb.conf_code = r.confirmation_code
            WHERE r.member_number IS NOT NULL
              AND COALESCE(LOWER(r.status), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )

            UNION

            SELECT DISTINCT sd.member_number
            FROM statement_details sd
            WHERE sd.member_number IS NOT NULL
              AND sd.description ILIKE '%Villa Income%'
              AND (
                (:date IS NULL AND :start_date IS NULL AND :end_date IS NULL)
                OR (:date IS NOT NULL AND sd.transaction_date = :date)
                OR (
                  :date IS NULL
                  AND :start_date IS NOT NULL
                  AND :end_date IS NOT NULL
                  AND sd.transaction_date BETWEEN :start_date AND :end_date
                )
              )
              AND (
                :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                OR :year IS NULL
                OR EXTRACT(YEAR FROM sd.transaction_date)::int = :year
              )
              AND (
                :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                OR :month IS NULL
                OR EXTRACT(MONTH FROM sd.transaction_date)::int = :month
              )
        )
    """


def people_ctes() -> str:
    """One address and one preferred phone per member to prevent fan-out."""
    return """
        member_address AS (
            SELECT DISTINCT ON (member_number)
                member_number,
                TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(address_line1, ''),
                        NULLIF(address_line2, ''),
                        NULLIF(city, ''),
                        NULLIF(state, ''),
                        NULLIF(postal_code, ''),
                        NULLIF(country, '')
                    )
                ) AS address,
                country,
                state
            FROM member_addresses
            ORDER BY member_number
        ),
        member_phone AS (
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
        )
    """


@router.get("/villa-stats")
def villa_stats(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        WITH {booking_base_cte()}
        SELECT
            villa_name,
            bedroom_count,
            bedroom_count::text AS bedroom_counts,
            bedroom_count AS min_bedrooms,
            bedroom_count AS max_bedrooms,
            COUNT(*)::int AS bookings,
            COALESCE(SUM(room_nights), 0)::int AS total_nights,
            ROUND(AVG(nights)::numeric, 1) AS avg_stay,
            COUNT(DISTINCT member_number)::int AS unique_members,
            COALESCE(SUM(persons), 0)::int AS total_guests,
            ROUND(AVG(persons)::numeric, 1) AS avg_party_size,
            ROUND(COALESCE(SUM(revenue), 0)::numeric, 2) AS revenue
        FROM booking_base
        WHERE villa_name IS NOT NULL
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
    else:
        select_clause = """
            TO_CHAR(check_in_date, 'Mon') AS month,
            EXTRACT(MONTH FROM check_in_date)::int AS sort_key,
        """
        group_clause = "month, sort_key"

    return rows(db, f"""
        WITH {booking_base_cte()}
        SELECT
            {select_clause}
            COUNT(*)::int AS bookings,
            ROUND(COALESCE(SUM(revenue), 0)::numeric, 2) AS revenue
        FROM booking_base
        WHERE villa_name = :villa
        GROUP BY {group_clause}
        ORDER BY sort_key
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
        WITH {booking_base_cte()}
        SELECT
            bedroom_count AS beds,
            COUNT(*)::int AS bookings,
            COALESCE(SUM(room_nights), 0)::int AS total_nights,
            ROUND(AVG(nights)::numeric, 1) AS avg_stay
        FROM booking_base
        WHERE bedroom_count IS NOT NULL
        GROUP BY bedroom_count
        ORDER BY bedroom_count
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
        WITH
        {booking_base_cte()},
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
        LEFT JOIN members m ON m.member_number = b.member_number
        LEFT JOIN member_address ma ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp ON mp.member_number = b.member_number
        WHERE b.bedroom_count = :beds
        ORDER BY b.check_in_date DESC
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
        WITH {villa_income_cte()}
        SELECT
            TO_CHAR(vi.income_month_date, 'Mon') AS month,
            EXTRACT(MONTH FROM vi.income_month_date)::int AS month_num,
            0::int AS bookings,
            ROUND(COALESCE(SUM(vi.villa_income), 0)::numeric, 2) AS revenue
        FROM villa_income_rows vi
        WHERE vi.income_month_date IS NOT NULL
          {summary_date_filter_sql('vi')}
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
        WITH
        {booking_base_cte()},
        {booked_people_source_cte()},
        {villa_income_cte()},
        {statement_reconciliation_cte()}
        SELECT
            (
                SELECT COUNT(*)::int
                FROM booked_person_numbers bp
                LEFT JOIN members m ON m.member_number = bp.member_number
                WHERE COALESCE(m.member_or_guest, 'Member') = 'Member'
            ) AS total_members_booked,
            (
                SELECT COUNT(*)::int
                FROM booked_person_numbers bp
                JOIN members m ON m.member_number = bp.member_number
                WHERE m.member_or_guest = 'Guest'
            ) AS total_guests_booked,
            ROUND(AVG(b.nights)::numeric, 1) AS avg_length_of_stay,
            ROUND(AVG(b.persons)::numeric, 1) AS avg_party_size,
            COALESCE(SUM(b.room_nights), 0)::int AS total_room_nights,
            (
                SELECT ROUND(COALESCE(SUM(vi.villa_income), 0)::numeric, 2)
                FROM villa_income_rows vi
                WHERE 1 = 1
                  {summary_date_filter_sql('vi')}
            ) AS villa_rental_revenue,
            (SELECT svc.gross_statement_total FROM statement_villa_check svc)
                AS statement_gross_check,
            (SELECT svc.signed_amount_total FROM statement_villa_check svc)
                AS statement_signed_amount_check,
            (SELECT svc.statement_rows FROM statement_villa_check svc)
                AS statement_villa_income_rows,
            ROUND((
                SELECT COALESCE(SUM(vi.villa_income), 0)
                FROM villa_income_rows vi
                WHERE 1 = 1
                  {summary_date_filter_sql('vi')}
            ) - COALESCE((
                SELECT svc.gross_statement_total FROM statement_villa_check svc
            ), 0), 2) AS revenue_reconciliation_difference
        FROM booking_base b
        WHERE b.villa_name IS NOT NULL
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
        WITH
        {booking_base_cte()},
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
        LEFT JOIN members m ON m.member_number = b.member_number
        LEFT JOIN member_address ma ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp ON mp.member_number = b.member_number
        WHERE b.villa_name = :villa
        ORDER BY b.check_in_date DESC
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
    member_filter = (
        "COALESCE(m.member_or_guest, 'Member') = 'Member'"
        if kind == "members"
        else "m.member_or_guest = 'Guest'"
    )

    return rows(db, f"""
        WITH
        {booking_base_cte()},
        {people_ctes()},
        filtered_bookings AS (
            SELECT b.*
            FROM booking_base b
            LEFT JOIN members m ON m.member_number = b.member_number
            WHERE b.member_number IS NOT NULL
              AND {member_filter}
        ),
        person_totals AS (
            SELECT
                member_number,
                MAX(guest_name) AS folio_guest_name,
                COUNT(DISTINCT conf_code)::int AS bookings,
                MIN(check_in_date) AS first_check_in,
                MAX(check_out_date) AS last_check_out,
                COALESCE(SUM(nights), 0)::int AS nights,
                COALESCE(SUM(persons), 0)::int AS total_party_size
            FROM filtered_bookings
            GROUP BY member_number
        ),
        person_guests AS (
            SELECT
                fb.member_number,
                COALESCE(
                    jsonb_agg(DISTINCT guest_item) FILTER (
                        WHERE guest_item IS NOT NULL
                    ),
                    '[]'::jsonb
                ) AS rooms
            FROM filtered_bookings fb
            LEFT JOIN LATERAL jsonb_array_elements(fb.guests::jsonb) guest_item
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
            COALESCE(pg.rooms, '[]'::jsonb) AS rooms
        FROM person_totals pt
        LEFT JOIN members m ON m.member_number = pt.member_number
        LEFT JOIN member_address ma ON ma.member_number = pt.member_number
        LEFT JOIN member_phone mp ON mp.member_number = pt.member_number
        LEFT JOIN person_guests pg ON pg.member_number = pt.member_number
        ORDER BY pt.bookings DESC, m.member_full_name, m.member_name
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
    summary = visits_tab_summary(year, month, date, start_date, end_date, db)
    villa_stats_data = villa_stats(year, month, date, start_date, end_date, db)
    bedroom_stats = bookings_by_bedroom(year, month, date, start_date, end_date, db)
    monthly_revenue_data = monthly_revenue(year, month, date, start_date, end_date, db)

    selected_villa = villa
    if not selected_villa and villa_stats_data:
        selected_villa = villa_stats_data[0].get("villa_name")

    villa_monthly_data = (
        villa_monthly(
            villa=selected_villa,
            group_by="month",
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


# -----------------------------------------------------------------------------
# Villa x business-source endpoints
# -----------------------------------------------------------------------------

@router.get("/villa-source-breakdown")
def villa_source_breakdown(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return rows(db, f"""
        WITH
        {booking_base_cte()},
        bedroom_dist AS (
            SELECT
                villa_name,
                source,
                payment_type,
                is_free,
                jsonb_object_agg(
                    COALESCE(bedroom_count::text, 'Unknown'),
                    booking_count
                )::text AS bedroom_distribution
            FROM (
                SELECT
                    villa_name,
                    source,
                    payment_type,
                    is_free,
                    bedroom_count,
                    COUNT(*)::int AS booking_count
                FROM booking_base
                WHERE villa_name IS NOT NULL
                GROUP BY villa_name, source, payment_type, is_free, bedroom_count
            ) d
            GROUP BY villa_name, source, payment_type, is_free
        ),
        common_bedroom AS (
            SELECT DISTINCT ON (villa_name, source, payment_type, is_free)
                villa_name,
                source,
                payment_type,
                is_free,
                bedroom_count AS most_common_bedrooms
            FROM (
                SELECT
                    villa_name,
                    source,
                    payment_type,
                    is_free,
                    bedroom_count,
                    COUNT(*) AS booking_count
                FROM booking_base
                WHERE villa_name IS NOT NULL
                GROUP BY villa_name, source, payment_type, is_free, bedroom_count
            ) c
            ORDER BY
                villa_name, source, payment_type, is_free,
                booking_count DESC,
                bedroom_count NULLS LAST
        )
        SELECT
            b.villa_name,
            b.source,
            b.payment_type,
            b.is_free,
            COUNT(*)::int AS bookings,
            COALESCE(SUM(b.room_nights), 0)::int AS total_nights,
            ROUND(
                COALESCE(SUM(b.revenue) FILTER (WHERE NOT b.is_free), 0)::numeric,
                2
            ) AS revenue,
            ROUND(COALESCE(SUM(b.revenue), 0)::numeric, 2) AS total_value,
            ROUND(
                COALESCE(SUM(b.revenue) FILTER (WHERE b.is_free), 0)::numeric,
                2
            ) AS free_value,
            COUNT(DISTINCT b.member_number)::int AS unique_members,
            ROUND(AVG(b.bedroom_count)::numeric, 1) AS avg_bedrooms,
            bd.bedroom_distribution,
            cb.most_common_bedrooms
        FROM booking_base b
        LEFT JOIN bedroom_dist bd
          ON bd.villa_name = b.villa_name
         AND bd.source = b.source
         AND bd.payment_type = b.payment_type
         AND bd.is_free = b.is_free
        LEFT JOIN common_bedroom cb
          ON cb.villa_name = b.villa_name
         AND cb.source = b.source
         AND cb.payment_type = b.payment_type
         AND cb.is_free = b.is_free
        WHERE b.villa_name IS NOT NULL
        GROUP BY
            b.villa_name, b.source, b.payment_type, b.is_free,
            bd.bedroom_distribution, cb.most_common_bedrooms
        ORDER BY b.villa_name, b.is_free, bookings DESC
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
    source_filter = ""
    if source is not None and source != "All":
        source_filter = "AND b.source = :source_val"

    free_filter = "AND b.is_free = :is_free_val" if is_free is not None else ""
    bedroom_filter = "AND b.bedroom_count = :bedrooms_val" if bedrooms is not None else ""

    params = {
        "villa": villa,
        "source_val": source,
        "is_free_val": is_free,
        "bedrooms_val": bedrooms,
        **filter_params(year, month, date, start_date, end_date),
    }

    return rows(db, f"""
        WITH
        {booking_base_cte()},
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
        LEFT JOIN members m ON m.member_number = b.member_number
        LEFT JOIN member_address ma ON ma.member_number = b.member_number
        LEFT JOIN member_phone mp ON mp.member_number = b.member_number
        WHERE b.villa_name = :villa
          {source_filter}
          {free_filter}
          {bedroom_filter}
        ORDER BY b.check_in_date DESC NULLS LAST
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
    return rows(db, f"""
        WITH {booking_base_cte()}
        SELECT
            bedroom_count,
            source,
            is_free,
            COUNT(*)::int AS bookings,
            COALESCE(SUM(room_nights), 0)::int AS total_nights,
            ROUND(
                COALESCE(SUM(revenue) FILTER (WHERE NOT is_free), 0)::numeric,
                2
            ) AS revenue,
            ROUND(
                COALESCE(SUM(revenue) FILTER (WHERE is_free), 0)::numeric,
                2
            ) AS free_value,
            COUNT(DISTINCT member_number)::int AS unique_members
        FROM booking_base
        WHERE villa_name IS NOT NULL
          AND bedroom_count IS NOT NULL
        GROUP BY bedroom_count, source, is_free
        ORDER BY bedroom_count NULLS LAST, bookings DESC
    """, filter_params(year, month, date, start_date, end_date))