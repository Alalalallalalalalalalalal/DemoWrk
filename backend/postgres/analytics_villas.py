# backend/postgres/analytics_villas.py
"""
Villa / room booking analytics using:
  * rate_details       -> booking dates, villa, bedrooms and rental values
  * statement_details  -> separate Villa Income reconciliation
  * villa_owner_map    -> maps statement member numbers to villas
  * statement_villa_income_summary -> monthly official-income reference
  * rooms              -> occupied-room evidence
  * reservation_guests -> party size and guest details
  * members            -> Member / Guest details

IMPORTANT DEDUPLICATION RULE
----------------------------
Each confirmation code is counted once using the latest valid rate_details row.

Different confirmation codes remain separate bookings, including when they
have the same villa and check-in date.

Rows with status Unposted and cancelled/no-show reservations are excluded.

Paid and Free/Comp values come directly from rate_details.total_rental.
Statement income is used separately for reconciliation and does not determine
whether a booking's total_rental is included.
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


def villa_income_cte(alias: str = "sd") -> str:
    """
    Monthly Villa Income derived directly from statement_details — identical
    definition to the Overview page. Payouts are stored negative, so the sign
    is flipped; reversal lines are INCLUDED so reversed payouts net out.
    """
    return f"""
        villa_income_rows AS (
            SELECT
                DATE_TRUNC('month', {alias}.transaction_date)::date AS income_month_date,
                SUM(COALESCE({alias}.amount, 0)) * -1               AS villa_income
            FROM statement_details {alias}
            WHERE {alias}.description ILIKE '%Villa Income%'
              AND {alias}.transaction_date IS NOT NULL
            GROUP BY 1
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
    """
    Return one booking per unique confirmation code.

    Revenue rules:
      * The latest valid row for each conf_code supplies total_rental.
      * Unposted rows are excluded.
      * Cancelled, canceled and no-show reservations are excluded.
      * Different confirmation codes remain separate, even when they have
        the same villa and check-in date.
      * Paid and Free/Comp totals come directly from rate_details.total_rental.
    """
    return rf"""
        filtered_rate_details AS (
            SELECT
                {alias}.rate_detail_key,
                TRIM({alias}.conf_code) AS conf_code,
                {alias}.reservation_id,
                {alias}.member_number,
                NULLIF(TRIM({alias}.guest_name), '') AS guest_name,
                NULLIF(TRIM({alias}.room_number), '') AS room_number,
                NULLIF(TRIM({alias}.villa_name), '') AS villa_name,
                {alias}.bedroom_count,
                COALESCE(
                    NULLIF(TRIM({alias}.source), ''),
                    'Unknown'
                ) AS source,
                COALESCE(
                    NULLIF(TRIM({alias}.payment_type), ''),
                    'Unknown'
                ) AS payment_type,
                {alias}.check_in_date,
                {alias}.check_out_date,
                {alias}.rate_date,
                {alias}.reservation_status,
                {alias}.status,
                COALESCE({alias}.total_rental, 0)::numeric AS total_rental,
                {alias}.created_at,
                {alias}.updated_at
            FROM rate_details {alias}
            WHERE {alias}.conf_code IS NOT NULL
              AND TRIM({alias}.conf_code) <> ''
              AND {alias}.check_in_date IS NOT NULL
              AND {alias}.check_out_date IS NOT NULL

              -- Do not include unposted rows.
              AND COALESCE(
                    LOWER(TRIM({alias}.status)),
                    ''
                  ) <> 'unposted'

              -- Do not include cancelled bookings.
              AND COALESCE(
                    LOWER(TRIM({alias}.reservation_status)),
                    ''
                  ) NOT IN (
                    'cancelled',
                    'canceled',
                    'no-show',
                    'no show'
              )

              {date_filter_sql(alias)}
        ),

        ranked_booking_values AS (
            SELECT
                frd.*,
                ROW_NUMBER() OVER (
                    PARTITION BY frd.conf_code
                    ORDER BY
                        frd.updated_at DESC NULLS LAST,
                        frd.created_at DESC NULLS LAST,
                        frd.rate_detail_key DESC
                ) AS booking_row_number
            FROM filtered_rate_details frd
        ),

        unique_booking_values AS (
            SELECT
                rbv.rate_detail_key,
                rbv.conf_code,
                rbv.reservation_id,
                rbv.member_number,
                rbv.guest_name,
                rbv.villa_name,
                rbv.bedroom_count,
                rbv.source,
                rbv.payment_type,
                rbv.check_in_date,
                rbv.check_out_date,
                rbv.reservation_status,
                rbv.status,
                ROUND(
                    COALESCE(rbv.total_rental, 0)::numeric,
                    2
                ) AS total_rental,

                CASE
                    WHEN LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    OR LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) LIKE '%free%'
                    OR LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) LIKE '%comp%'
                    OR LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) LIKE '%complimentary%'
                    OR LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) LIKE '%gratis%'
                    OR LOWER(
                        TRIM(COALESCE(rbv.payment_type, ''))
                    ) LIKE '%no charge%'
                    THEN TRUE
                    ELSE FALSE
                END AS is_free
            FROM ranked_booking_values rbv
            WHERE rbv.booking_row_number = 1
        ),

        booking_stay_rollup AS (
            SELECT
                frd.conf_code,
                MIN(frd.check_in_date) AS check_in_date,
                MAX(frd.check_out_date) AS check_out_date,

                GREATEST(
                    MAX(frd.check_out_date) - MIN(frd.check_in_date),
                    0
                )::int AS nights,

                COUNT(
                    DISTINCT (
                        frd.room_number,
                        frd.rate_date
                    )
                ) FILTER (
                    WHERE frd.room_number IS NOT NULL
                      AND frd.rate_date IS NOT NULL
                )::int AS room_nights
            FROM filtered_rate_details frd
            GROUP BY frd.conf_code
        ),

        rate_booking_rows AS (
            SELECT
                ubv.conf_code,
                ubv.reservation_id,
                ubv.villa_name,
                ubv.bedroom_count,
                ubv.member_number,
                ubv.guest_name,
                COALESCE(
                    bsr.check_in_date,
                    ubv.check_in_date
                ) AS check_in_date,
                COALESCE(
                    bsr.check_out_date,
                    ubv.check_out_date
                ) AS check_out_date,
                COALESCE(bsr.nights, 0)::int AS nights,
                COALESCE(
                    NULLIF(bsr.room_nights, 0),
                    bsr.nights,
                    0
                )::int AS room_nights,
                ubv.source,
                ubv.payment_type,
                ubv.reservation_status,
                ubv.status,
                ubv.total_rental,
                ubv.is_free
            FROM unique_booking_values ubv
            LEFT JOIN booking_stay_rollup bsr
              ON bsr.conf_code = ubv.conf_code
        ),

        room_detail_rows AS (
            SELECT DISTINCT
                TRIM(r.confirmation_code) AS conf_code,
                r.room_number,
                r.member_number,
                r.check_in_date,
                r.check_out_date
            FROM rooms r
            WHERE r.confirmation_code IS NOT NULL
              AND TRIM(r.confirmation_code) <> ''
              AND COALESCE(
                    LOWER(TRIM(r.status)),
                    ''
                  ) NOT IN (
                    'cancelled',
                    'canceled',
                    'no-show',
                    'no show'
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
                TRIM(rg.conf_code) AS conf_code,
                rg.member_number,
                NULLIF(TRIM(rg.guest_name), '') AS guest_name,
                rg.is_owner,
                rg.room_number,
                rg.check_in_date,
                rg.check_out_date
            FROM reservation_guests rg
            WHERE rg.conf_code IS NOT NULL
              AND TRIM(rg.conf_code) <> ''
        ),

        reservation_guest_rollup AS (
            SELECT
                conf_code,

                COUNT(*) FILTER (
                    WHERE guest_name IS NOT NULL
                       OR member_number IS NOT NULL
                )::int AS party_size,

                COALESCE(
                    JSON_AGG(
                        JSONB_BUILD_OBJECT(
                            'guest_name', guest_name,
                            'member_number', member_number,
                            'is_owner', is_owner,
                            'room_number', room_number,
                            'check_in_date', check_in_date,
                            'check_out_date', check_out_date
                        )
                        ORDER BY
                            room_number,
                            guest_name,
                            member_number
                    ) FILTER (
                        WHERE guest_name IS NOT NULL
                           OR member_number IS NOT NULL
                    ),
                    '[]'::json
                ) AS guests
            FROM reservation_guest_rows
            GROUP BY conf_code
        ),

        booking_base AS (
            SELECT
                rb.conf_code,
                rb.reservation_id,
                rb.villa_name,
                rb.bedroom_count,
                rb.member_number,
                rb.guest_name,
                rb.check_in_date,
                rb.check_out_date,
                rb.nights,
                rb.room_nights,
                rb.source,
                rb.payment_type,
                rb.reservation_status,
                rb.status,

                GREATEST(
                    COALESCE(NULLIF(rgr.party_size, 0), 1),
                    1
                )::int AS persons,

                COALESCE(rr.occupied_rooms, 0)::int AS occupied_rooms,
                COALESCE(rgr.guests, '[]'::json) AS guests,

                -- Revenue comes directly from the unique conf_code row.
                rb.total_rental AS revenue,
                rb.total_rental,
                rb.is_free,

                -- Retained for compatibility with existing responses.
                NULL::text AS statement_detail_key,
                NULL::numeric AS statement_amount,
                NULL::numeric AS payout_ratio,
                FALSE AS revenue_matched

            FROM rate_booking_rows rb

            LEFT JOIN room_rollup rr
              ON rr.conf_code = rb.conf_code

            LEFT JOIN reservation_guest_rollup rgr
              ON rgr.conf_code = rb.conf_code
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



def overview_villa_revenue_ctes() -> str:
    """
    Revenue source shared by Villa Analytics.

    This mirrors the Overview backend:
      * reads overview_transaction_lines (the unified/netted ledger)
      * includes Villa lines only
      * includes overview_line_status = 'Paid' so credits/corrections net properly
      * inherits Paid/Free from overview_booking_payment_type
      * includes synthetic_villa_income rows as source = Rental Programme
      * uses overview_booking_meta dates through folios_unified_display metadata
      * therefore respects the programme-villa double-count guard already applied
        inside overview_transaction_lines

    Booking counts must still come from booking_base because a monthly homeowner
    payout is revenue, not a booking.
    """
    return rf"""
        overview_source_meta AS (
            SELECT
                f.conf_code::text AS conf_code,
                MAX(f.villa_name) AS villa_name,
                COALESCE(
                    NULLIF(TRIM(MAX(f.source)), ''),
                    CASE
                        WHEN BOOL_OR(f.folio_source = 'synthetic_villa_income')
                        THEN 'Rental Programme'
                        ELSE 'Unknown'
                    END
                ) AS source,
                MAX(f.bedroom_count) AS bedroom_count,
                MAX(f.member_number) AS member_number,
                MIN(f.check_in_date) AS check_in_date,
                MAX(f.check_out_date) AS check_out_date
            FROM folios_unified_display f
            WHERE f.conf_code IS NOT NULL
              AND f.villa_name IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND f.check_out_date IS NOT NULL
              AND COALESCE(
                    LOWER(TRIM(f.reservation_status)),
                    ''
                  ) NOT IN ('cancelled', 'canceled', 'no-show', 'no show')
            GROUP BY f.conf_code
        ),

        overview_villa_revenue_rows AS (
            SELECT
                otl.overview_conf_code::text AS conf_code,
                COALESCE(
                    otl.overview_villa_name,
                    osm.villa_name
                ) AS villa_name,
                COALESCE(
                    NULLIF(TRIM(osm.source), ''),
                    'Unknown'
                ) AS source,
                COALESCE(
                    NULLIF(TRIM(otl.overview_booking_payment_type), ''),
                    'Unknown'
                ) AS payment_type,
                CASE
                    WHEN LOWER(
                        TRIM(
                            COALESCE(
                                otl.overview_booking_payment_type,
                                ''
                            )
                        )
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    OR LOWER(
                        TRIM(
                            COALESCE(
                                otl.overview_booking_payment_type,
                                ''
                            )
                        )
                    ) LIKE '%free%'
                    OR LOWER(
                        TRIM(
                            COALESCE(
                                otl.overview_booking_payment_type,
                                ''
                            )
                        )
                    ) LIKE '%comp%'
                    THEN TRUE
                    ELSE FALSE
                END AS is_free,
                osm.bedroom_count,
                osm.member_number,
                osm.check_in_date,
                osm.check_out_date,
                ROUND(
                    COALESCE(otl.overview_net_amount, 0)::numeric,
                    2
                ) AS revenue
            FROM overview_transaction_lines otl
            JOIN overview_source_meta osm
              ON osm.conf_code = otl.overview_conf_code::text
            WHERE otl.overview_line_category = 'Villa'
              AND otl.overview_line_status = 'Paid'

              -- Match the Overview hero Villa Rental rule:
              --   * Paid value: statement-backed Rental Programme income only
              --     (synthetic confirmation codes 9,000,000+)
              --   * Free/Comp value: retain ordinary free-stay Villa lines so
              --     the source page can still display their economic value.
              AND (
                    LOWER(TRIM(COALESCE(otl.overview_booking_payment_type, '')))
                        IN ('free', 'comp', 'complimentary', 'free/comp', 'free / comp')
                    OR LOWER(TRIM(COALESCE(otl.overview_booking_payment_type, ''))) LIKE '%free%'
                    OR LOWER(TRIM(COALESCE(otl.overview_booking_payment_type, ''))) LIKE '%comp%'
                    OR (
                        otl.overview_conf_code::text ~ '^[0-9]+$'
                        AND otl.overview_conf_code::text::bigint >= 9000000
                    )
              )
              {date_filter_sql('osm')}
        ),

        overview_villa_revenue_by_booking AS (
            SELECT
                conf_code,
                MAX(villa_name) AS villa_name,
                MAX(source) AS source,
                MAX(payment_type) AS payment_type,
                BOOL_OR(is_free) AS is_free,
                MAX(bedroom_count) AS bedroom_count,
                MAX(member_number) AS member_number,
                MIN(check_in_date) AS check_in_date,
                MAX(check_out_date) AS check_out_date,
                ROUND(
                    COALESCE(SUM(revenue), 0)::numeric,
                    2
                ) AS revenue
            FROM overview_villa_revenue_rows
            GROUP BY conf_code
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
            COUNT(*) FILTER (WHERE NOT is_free)::int AS paid_bookings,
            COUNT(*) FILTER (WHERE is_free)::int AS free_bookings,
            COALESCE(SUM(room_nights), 0)::int AS total_nights,
            ROUND(AVG(nights)::numeric, 1) AS avg_stay,
            COUNT(DISTINCT member_number)::int AS unique_members,
            COALESCE(SUM(persons), 0)::int AS total_guests,
            ROUND(AVG(persons)::numeric, 1) AS avg_party_size,
            ROUND(
                COALESCE(
                    SUM(total_rental) FILTER (WHERE NOT is_free),
                    0
                )::numeric,
                2
            ) AS paid_total_rental,
            ROUND(
                COALESCE(
                    SUM(total_rental) FILTER (WHERE is_free),
                    0
                )::numeric,
                2
            ) AS free_total_rental,
            ROUND(
                COALESCE(SUM(total_rental), 0)::numeric,
                2
            ) AS total_rental,
            ROUND(
                COALESCE(
                    SUM(total_rental) FILTER (WHERE NOT is_free),
                    0
                )::numeric,
                2
            ) AS revenue
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
            COUNT(*) FILTER (WHERE NOT b.is_free)::int AS paid_bookings,
            COUNT(*) FILTER (WHERE b.is_free)::int AS free_bookings,
            ROUND(
                COALESCE(SUM(b.revenue) FILTER (WHERE NOT b.is_free), 0)::numeric,
                2
            ) AS paid_revenue,
            ROUND(
                COALESCE(SUM(b.revenue) FILTER (WHERE b.is_free), 0)::numeric,
                2
            ) AS free_value,
            ROUND(COALESCE(SUM(b.revenue), 0)::numeric, 2) AS total_booking_value,
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


@router.get("/booking-summary")
def booking_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Return paid/free booking totals and the detailed homeowner Villa Income match.

    One booking is retained per unique confirmation code. Different confirmation
    codes on the same day remain separate bookings. Unposted rows are excluded.
    """
    params = {
        "villa": villa,
        **filter_params(year, month, date, start_date, end_date),
    }

    cte = r"""
        statement_income AS (
            SELECT
                sd.member_number,
                sd.statement_period,
                DATE_TRUNC('month', sd.transaction_date)::date AS statement_month,
                ROUND(SUM(COALESCE(sd.amount, 0) * -1)::numeric, 2)
                    AS homeowner_villa_income
            FROM statement_details sd
            WHERE sd.description ILIKE '%villa income%'
              AND sd.member_number IS NOT NULL
            GROUP BY
                sd.member_number,
                sd.statement_period,
                DATE_TRUNC('month', sd.transaction_date)
        ),
        homeowner_income AS (
            SELECT
                si.member_number,
                NULLIF(TRIM(vom.villa_name), '') AS villa_name,
                si.statement_period,
                si.statement_month,
                si.homeowner_villa_income
            FROM statement_income si
            JOIN villa_owner_map vom
              ON TRIM(vom.member_number::text) = TRIM(si.member_number::text)
            WHERE NULLIF(TRIM(vom.villa_name), '') IS NOT NULL
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
              AND COALESCE(LOWER(TRIM(rd.status)), '') <> 'unposted'
              AND COALESCE(LOWER(TRIM(rd.reservation_status)), '') NOT IN (
                    'cancelled', 'canceled', 'no-show'
              )
              AND (:villa IS NULL OR LOWER(TRIM(rd.villa_name)) = LOWER(TRIM(:villa)))
              AND (
                    :date IS NULL
                    OR rd.check_in_date = :date
              )
              AND (
                    :date IS NOT NULL
                    OR :start_date IS NULL
                    OR rd.check_in_date >= :start_date
              )
              AND (
                    :date IS NOT NULL
                    OR :end_date IS NULL
                    OR rd.check_in_date <= :end_date
              )
              AND (
                    :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                    OR :year IS NULL
                    OR EXTRACT(YEAR FROM rd.check_in_date)::int = :year
              )
              AND (
                    :date IS NOT NULL OR :start_date IS NOT NULL OR :end_date IS NOT NULL
                    OR :month IS NULL
                    OR EXTRACT(MONTH FROM rd.check_in_date)::int = :month
              )
        ),
        booking_details AS (
            SELECT
                rd.conf_code,
                rd.reservation_id,
                rd.member_number AS booking_member_number,
                rd.guest_name,
                NULLIF(TRIM(rd.villa_name), '') AS villa_name,
                rd.bedroom_count,
                COALESCE(NULLIF(TRIM(rd.source), ''), 'Unknown') AS source,
                COALESCE(NULLIF(TRIM(rd.payment_type), ''), 'Unknown') AS payment_type,
                rd.check_in_date,
                rd.check_out_date,
                rd.reservation_status,
                rd.status,
                ROUND(COALESCE(rd.total_rental, 0)::numeric, 2) AS total_rental,
                CASE
                    WHEN LOWER(TRIM(COALESCE(rd.payment_type, ''))) IN (
                        'free', 'comp', 'complimentary', 'free/comp', 'free / comp'
                    )
                    OR LOWER(TRIM(COALESCE(rd.payment_type, ''))) LIKE '%free%'
                    OR LOWER(TRIM(COALESCE(rd.payment_type, ''))) LIKE '%comp%'
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
                CASE WHEN bd.is_free THEN 'Free/Comp' ELSE 'Paid' END AS booking_type,
                bd.is_free,
                bd.total_rental,
                bd.reservation_status,
                bd.status
            FROM homeowner_income hi
            LEFT JOIN booking_details bd
              ON LOWER(TRIM(bd.villa_name)) = LOWER(TRIM(hi.villa_name))
             AND DATE_TRUNC('month', bd.check_in_date)::date = hi.statement_month
            WHERE :villa IS NULL
               OR LOWER(TRIM(hi.villa_name)) = LOWER(TRIM(:villa))
        )
    """

    summary = one(db, f"""
        WITH {cte}
        SELECT
            COUNT(*)::int AS total_bookings,
            COUNT(*) FILTER (WHERE NOT bd.is_free)::int AS paid_bookings,
            COUNT(*) FILTER (WHERE bd.is_free)::int AS free_bookings,
            ROUND(
                COALESCE(SUM(bd.total_rental) FILTER (WHERE NOT bd.is_free), 0)::numeric,
                2
            ) AS paid_revenue,
            ROUND(
                COALESCE(SUM(bd.total_rental) FILTER (WHERE bd.is_free), 0)::numeric,
                2
            ) AS free_value,
            ROUND(COALESCE(SUM(bd.total_rental), 0)::numeric, 2) AS total_booking_value,
            (
                SELECT ROUND(COALESCE(SUM(hi.homeowner_villa_income), 0)::numeric, 2)
                FROM homeowner_income hi
                WHERE :villa IS NULL
                   OR LOWER(TRIM(hi.villa_name)) = LOWER(TRIM(:villa))
            ) AS homeowner_villa_income
        FROM booking_details bd
    """, params)

    details = rows(db, f"""
        WITH {cte}
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
    """, params)

    return {
        "summary": summary,
        "bookings": details,
    }


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
    paid_free_totals = villa_paid_free_totals(
        year=year,
        month=month,
        date=date,
        start_date=start_date,
        end_date=end_date,
        villa=villa,
        db=db,
    )

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
        "villa_paid_free_totals": paid_free_totals,
        "bookings_by_bedroom": bedroom_stats,
        "monthly_revenue": monthly_revenue_data,
        "villa_monthly": villa_monthly_data,
        "selected_villa": selected_villa,
    }


# -----------------------------------------------------------------------------
# Villa x business-source endpoints
# -----------------------------------------------------------------------------

@router.get("/villa-paid-free-totals")
def villa_paid_free_totals(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Booking counts come from unique real bookings.

    Dollar amounts come from the same unified/netted Villa transaction ledger
    used by Overview. Rental Programme payouts are included as revenue but are
    never counted as bookings.
    """
    params = {
        "villa": villa,
        **filter_params(year, month, date, start_date, end_date),
    }

    return rows(db, f"""
        WITH
        {booking_base_cte()},
        {overview_villa_revenue_ctes()},

        booking_counts AS (
            SELECT
                b.villa_name,
                COUNT(DISTINCT b.conf_code)::int AS total_unique_bookings,
                COUNT(DISTINCT b.conf_code) FILTER (
                    WHERE NOT b.is_free
                )::int AS paid_unique_bookings,
                COUNT(DISTINCT b.conf_code) FILTER (
                    WHERE b.is_free
                )::int AS free_unique_bookings
            FROM booking_base b
            WHERE b.villa_name IS NOT NULL
              AND (
                    :villa IS NULL
                    OR LOWER(TRIM(b.villa_name)) = LOWER(TRIM(:villa))
              )
            GROUP BY b.villa_name
        ),

        revenue_totals AS (
            SELECT
                r.villa_name,
                ROUND(
                    COALESCE(SUM(r.revenue) FILTER (WHERE NOT r.is_free), 0)::numeric,
                    2
                ) AS paid_total_rental,
                ROUND(
                    COALESCE(SUM(r.revenue) FILTER (WHERE r.is_free), 0)::numeric,
                    2
                ) AS free_total_rental,
                ROUND(
                    COALESCE(SUM(r.revenue), 0)::numeric,
                    2
                ) AS overall_total_rental
            FROM overview_villa_revenue_by_booking r
            WHERE r.villa_name IS NOT NULL
              AND (
                    :villa IS NULL
                    OR LOWER(TRIM(r.villa_name)) = LOWER(TRIM(:villa))
              )
            GROUP BY r.villa_name
        )

        SELECT
            COALESCE(bc.villa_name, rt.villa_name) AS villa_name,
            COALESCE(bc.total_unique_bookings, 0)::int AS total_unique_bookings,
            COALESCE(bc.paid_unique_bookings, 0)::int AS paid_unique_bookings,
            COALESCE(bc.free_unique_bookings, 0)::int AS free_unique_bookings,
            COALESCE(rt.paid_total_rental, 0) AS paid_total_rental,
            COALESCE(rt.free_total_rental, 0) AS free_total_rental,
            COALESCE(rt.overall_total_rental, 0) AS overall_total_rental
        FROM booking_counts bc
        FULL OUTER JOIN revenue_totals rt
          ON LOWER(TRIM(rt.villa_name)) = LOWER(TRIM(bc.villa_name))
        ORDER BY paid_total_rental DESC, villa_name
    """, params)
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
    Booking/source counts come from unique posted rate_details bookings.

    Villa revenue follows the same calculation as:

        SUM(overview_transaction_lines.overview_net_amount)
        WHERE overview_line_status = 'Paid'
          AND overview_line_category = 'Villa'

    Revenue is split using overview_booking_meta.overview_payment_type.
    """

    params = filter_params(
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
        {booking_base_cte()},

        booking_detail AS (
            SELECT
                b.*,
                COUNT(*) OVER (
                    PARTITION BY
                        b.villa_name,
                        b.source,
                        b.is_free,
                        b.bedroom_count
                ) AS bedroom_count_total
            FROM booking_base b
            WHERE b.villa_name IS NOT NULL
        ),

        booking_summary AS (
            SELECT
                villa_name,
                source,

                CASE
                    WHEN is_free THEN 'Free'
                    ELSE 'Paid'
                END AS payment_type,

                is_free,
                COUNT(DISTINCT conf_code)::int AS bookings,
                COALESCE(SUM(room_nights), 0)::int AS total_nights,

                COUNT(
                    DISTINCT NULLIF(TRIM(member_number::text), '')
                )::int AS unique_members,

                ROUND(AVG(bedroom_count)::numeric, 1) AS avg_bedrooms,

                COALESCE(
                    JSONB_OBJECT_AGG(
                        bedroom_count::text,
                        bedroom_count_total
                        ORDER BY bedroom_count
                    ) FILTER (
                        WHERE bedroom_count IS NOT NULL
                    ),
                    '{{}}'::jsonb
                ) AS bedroom_distribution

            FROM booking_detail
            GROUP BY
                villa_name,
                source,
                is_free
        ),

        villa_revenue AS (
            SELECT
                COALESCE(
                    NULLIF(TRIM(otl.overview_villa_name), ''),
                    NULLIF(TRIM(ovb.overview_villa_name), '')
                ) AS villa_name,

                CASE
                    WHEN LOWER(
                        COALESCE(
                            NULLIF(TRIM(ovb.overview_payment_type), ''),
                            'paid'
                        )
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    THEN 'Free'
                    ELSE 'Paid'
                END AS payment_type,

                CASE
                    WHEN LOWER(
                        COALESCE(
                            NULLIF(TRIM(ovb.overview_payment_type), ''),
                            'paid'
                        )
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    THEN TRUE
                    ELSE FALSE
                END AS is_free,

                ROUND(
                    COALESCE(
                        SUM(otl.overview_net_amount),
                        0
                    )::numeric,
                    2
                ) AS revenue

            FROM overview_transaction_lines otl

            JOIN overview_booking_meta ovb
              ON ovb.overview_conf_code = otl.overview_conf_code

            WHERE otl.overview_line_status = 'Paid'
              AND otl.overview_line_category = 'Villa'

              AND (
                    :date IS NULL
                    OR ovb.overview_check_in_date = :date
              )

              AND (
                    :date IS NOT NULL
                    OR :start_date IS NULL
                    OR ovb.overview_check_in_date >= :start_date
              )

              AND (
                    :date IS NOT NULL
                    OR :end_date IS NULL
                    OR ovb.overview_check_in_date <= :end_date
              )

              AND (
                    :date IS NOT NULL
                    OR :start_date IS NOT NULL
                    OR :end_date IS NOT NULL
                    OR :year IS NULL
                    OR EXTRACT(
                        YEAR FROM ovb.overview_check_in_date
                    )::int = :year
              )

              AND (
                    :date IS NOT NULL
                    OR :start_date IS NOT NULL
                    OR :end_date IS NOT NULL
                    OR :month IS NULL
                    OR EXTRACT(
                        MONTH FROM ovb.overview_check_in_date
                    )::int = :month
              )

            GROUP BY
                COALESCE(
                    NULLIF(TRIM(otl.overview_villa_name), ''),
                    NULLIF(TRIM(ovb.overview_villa_name), '')
                ),
                CASE
                    WHEN LOWER(
                        COALESCE(
                            NULLIF(TRIM(ovb.overview_payment_type), ''),
                            'paid'
                        )
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    THEN 'Free'
                    ELSE 'Paid'
                END,
                CASE
                    WHEN LOWER(
                        COALESCE(
                            NULLIF(TRIM(ovb.overview_payment_type), ''),
                            'paid'
                        )
                    ) IN (
                        'free',
                        'comp',
                        'complimentary',
                        'free/comp',
                        'free / comp'
                    )
                    THEN TRUE
                    ELSE FALSE
                END
        ),

        revenue_rows AS (
            SELECT
                villa_name,
                'Rental Programme'::text AS source,
                payment_type,
                is_free,
                0::int AS bookings,
                0::int AS total_nights,
                0::int AS unique_members,
                NULL::numeric AS avg_bedrooms,
                '{{}}'::jsonb AS bedroom_distribution,
                revenue
            FROM villa_revenue
            WHERE villa_name IS NOT NULL
        ),

        combined_rows AS (
            SELECT
                bs.villa_name,
                bs.source,
                bs.payment_type,
                bs.is_free,
                bs.bookings,
                bs.total_nights,
                bs.unique_members,
                bs.avg_bedrooms,
                bs.bedroom_distribution,
                0::numeric AS revenue
            FROM booking_summary bs

            UNION ALL

            SELECT
                rr.villa_name,
                rr.source,
                rr.payment_type,
                rr.is_free,
                rr.bookings,
                rr.total_nights,
                rr.unique_members,
                rr.avg_bedrooms,
                rr.bedroom_distribution,
                rr.revenue
            FROM revenue_rows rr
        )

        SELECT
            villa_name,
            source,
            payment_type,
            is_free,
            bookings,
            total_nights,

            CASE
                WHEN NOT is_free
                THEN ROUND(revenue::numeric, 2)
                ELSE 0::numeric
            END AS revenue,

            ROUND(revenue::numeric, 2) AS total_value,

            CASE
                WHEN is_free
                THEN ROUND(revenue::numeric, 2)
                ELSE 0::numeric
            END AS free_value,

            unique_members,
            avg_bedrooms,
            bedroom_distribution::text AS bedroom_distribution,

            (
                SELECT bedroom_key::integer
                FROM JSONB_EACH_TEXT(
                    combined_rows.bedroom_distribution
                ) AS bedroom_item(
                    bedroom_key,
                    bedroom_value
                )
                ORDER BY
                    bedroom_value::integer DESC,
                    bedroom_key::integer
                LIMIT 1
            ) AS most_common_bedrooms

        FROM combined_rows

        ORDER BY
            villa_name,
            CASE
                WHEN source = 'Rental Programme' THEN 2
                ELSE 1
            END,
            payment_type,
            bookings DESC,
            source
        """,
        params,
    )

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
    """
    Counts/nights come from real bookings; amounts come from the Overview ledger.
    """
    return rows(db, f"""
        WITH
        {booking_base_cte()},
        {overview_villa_revenue_ctes()},

        booking_rollup AS (
            SELECT
                bedroom_count,
                source,
                is_free,
                COUNT(*)::int AS bookings,
                COALESCE(SUM(room_nights), 0)::int AS total_nights,
                COUNT(DISTINCT member_number)::int AS unique_members
            FROM booking_base
            WHERE villa_name IS NOT NULL
              AND bedroom_count IS NOT NULL
            GROUP BY bedroom_count, source, is_free
        ),

        revenue_rollup AS (
            SELECT
                bedroom_count,
                source,
                is_free,
                ROUND(COALESCE(SUM(revenue), 0)::numeric, 2) AS amount
            FROM overview_villa_revenue_by_booking
            WHERE villa_name IS NOT NULL
              AND bedroom_count IS NOT NULL
            GROUP BY bedroom_count, source, is_free
        )

        SELECT
            COALESCE(b.bedroom_count, r.bedroom_count) AS bedroom_count,
            COALESCE(b.source, r.source, 'Unknown') AS source,
            COALESCE(b.is_free, r.is_free, FALSE) AS is_free,
            COALESCE(b.bookings, 0)::int AS bookings,
            COALESCE(b.total_nights, 0)::int AS total_nights,
            CASE
                WHEN NOT COALESCE(b.is_free, r.is_free, FALSE)
                THEN COALESCE(r.amount, 0)
                ELSE 0
            END AS revenue,
            CASE
                WHEN COALESCE(b.is_free, r.is_free, FALSE)
                THEN COALESCE(r.amount, 0)
                ELSE 0
            END AS free_value,
            COALESCE(b.unique_members, 0)::int AS unique_members
        FROM booking_rollup b
        FULL OUTER JOIN revenue_rollup r
          ON r.bedroom_count = b.bedroom_count
         AND LOWER(TRIM(r.source)) = LOWER(TRIM(b.source))
         AND r.is_free = b.is_free
        ORDER BY bedroom_count NULLS LAST, bookings DESC, source
    """, filter_params(year, month, date, start_date, end_date))
