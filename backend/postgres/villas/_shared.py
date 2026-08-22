"""
Villa / room booking analytics — shared period resolution, SQL filter
builders, CTE builders, and aggregate-SQL builders used across the
`villas/` endpoint modules (stats.py, bookings.py, people.py, revenue.py,
visits.py).

PER-VILLA BOOKING / VALUE RULES
===============================

The per-villa cards/totals use the following authoritative sources:

BOOKINGS
--------
Primary source:
    overview_villa_bookings

    overall bookings = all Overview villa booking rows
    paid bookings    = overview_payment_type = 'Paid'
    free bookings    = overview_payment_type = 'Free'

Reconciliation source:
    rate_details / booking_base

The rate-details count is retained beside the Overview count so differences
(such as the known occasional off-by-one) can be identified. Overview is used
as the authoritative count whenever a villa exists there; rate_details is only
a fallback when Overview has no booking row for that villa.

AMOUNTS
-------
overall amount:
    SUM(overview_transaction_lines.overview_net_amount)
    WHERE overview_line_category = 'Villa'

paid amount:
    SUM(overview_transaction_lines.overview_net_amount)
    JOIN overview_booking_meta
    WHERE overview_line_category = 'Villa'
      AND overview_line_status = 'Paid'
      AND overview_booking_meta.overview_payment_type = 'Paid'
      AND overview_transaction_lines.overview_conf_code >= 9000000   -- [2026-08-13]

    [2026-08-13] Scoped to rental-programme payout lines only (synthetic
    conf_code >= 9,000,000), matching Overview's hero tile
    (overview_analytics.py, overview_total_villa_revenue) and Finance's
    headline figure (finance_backend.py, _villa_statement_net_revenue) —
    product decision: "Villa Revenue" excludes direct/non-programme paid
    villa bookings. All three now agree at $109,979,584 all-time. See
    villa_paid_free_metrics_cte()'s paid_villa_amounts CTE below.

free value:
    SUM(rate_details_with_discount.rack_rate)
    WHERE payment_type = 'Free'
       OR the reservation is marked Paid but its complete SUM(total_amount) = 0

Cancelled/canceled/no-show reservations are excluded from the rate-detail free
value rule.

IMPORTANT:
overall_amount is a net Overview-ledger amount while free_amount is an economic
rack-rate value. Therefore overall_amount is NOT forced to equal
paid_amount + free_amount. As of 2026-08-13 this is even more deliberately
true: overall_amount stays unscoped (all Villa-category ledger activity, any
status), while paid_amount is now scoped to rental-programme payouts only —
do not "fix" a future overall != paid + free report by forcing this equality.

PERFORMANCE
===========
The existing resolved-period filtering, scoped guest/room rollups, lean/full
booking base, temp-table materialization, and short-TTL dashboard cache are
retained (materialization + cache now live in visits.py, next to the one
endpoint that uses them).
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date as _date

_MIN_DATE = _date(1900, 1, 1)
_MAX_DATE = _date(9999, 12, 31)


# =============================================================================
# Period resolution
# =============================================================================

@dataclass(frozen=True)
class Period:
    """Resolved date filter."""
    start: _date | None = None
    end: _date | None = None
    month_only: int | None = None

    @property
    def active(self) -> bool:
        return self.start is not None or self.month_only is not None


def resolve_period(
    year: int | None = None,
    month: int | None = None,
    date: _date | None = None,
    start_date: _date | None = None,
    end_date: _date | None = None,
) -> Period:
    """
    Precedence:
      date
      start/end
      year + month
      year
      month-only
      all time
    """
    if date is not None:
        return Period(date, date)

    if start_date is not None or end_date is not None:
        lo = start_date or _MIN_DATE
        hi = end_date or _MAX_DATE
        if lo > hi:
            lo, hi = hi, lo
        return Period(lo, hi)

    if year is not None and month is not None:
        last = monthrange(year, month)[1]
        return Period(_date(year, month, 1), _date(year, month, last))

    if year is not None:
        return Period(_date(year, 1, 1), _date(year, 12, 31))

    if month is not None:
        return Period(month_only=month)

    return Period()


def period_params(p: Period, **extra) -> dict:
    return {
        "range_start": p.start,
        "range_end": p.end,
        "month_only": p.month_only,
        **extra,
    }


# =============================================================================
# SQL filter builders
# =============================================================================

def stay_overlap_filter(
    p: Period,
    alias: str = "rd",
    check_in: str = "check_in_date",
    check_out: str = "check_out_date",
) -> str:
    if p.start is not None:
        return (
            f"\n              AND {alias}.{check_in} <= :range_end"
            f"\n              AND {alias}.{check_out} >= :range_start"
        )

    if p.month_only is not None:
        return (
            f"\n              AND ("
            f"\n                EXTRACT(MONTH FROM {alias}.{check_in})::int = :month_only"
            f"\n                OR EXTRACT(MONTH FROM {alias}.{check_out})::int = :month_only"
            f"\n              )"
        )

    return ""


def txn_date_filter(
    p: Period,
    alias: str = "sd",
    col: str = "transaction_date",
) -> str:
    if p.start is not None:
        return f"\n              AND {alias}.{col} BETWEEN :range_start AND :range_end"

    if p.month_only is not None:
        return (
            f"\n              AND EXTRACT(MONTH FROM {alias}.{col})::int = :month_only"
        )

    return ""


def overview_checkin_filter(
    p: Period,
    alias: str = "ovb",
    col: str = "overview_check_in_date",
) -> str:
    """
    Per-villa booking/revenue metrics are scoped by Overview check-in date.
    """
    if p.start is not None:
        return f"\n              AND {alias}.{col} BETWEEN :range_start AND :range_end"

    if p.month_only is not None:
        return (
            f"\n              AND EXTRACT(MONTH FROM {alias}.{col})::int = :month_only"
        )

    return ""


# =============================================================================
# Shared CTEs
# =============================================================================

def villa_income_cte(p: Period, alias: str = "sd") -> str:
    return f"""
    villa_income_rows AS (
        SELECT
            DATE_TRUNC('month', {alias}.transaction_date)::date AS income_month_date,
            SUM(COALESCE({alias}.amount, 0)) * -1 AS villa_income
        FROM statement_details {alias}
        WHERE {alias}.description ILIKE '%Villa Income%'
          AND {alias}.transaction_date IS NOT NULL
          {txn_date_filter(p, alias)}
        GROUP BY 1
    )
    """


def statement_reconciliation_cte(p: Period, alias: str = "sd") -> str:
    return f"""
    statement_villa_check AS (
        SELECT
            ROUND(COALESCE(SUM(COALESCE({alias}.charge, 0)), 0)::numeric, 2)
                AS charge_total,
            ROUND(COALESCE(SUM(COALESCE({alias}.surcharge, 0)), 0)::numeric, 2)
                AS surcharge_total,
            ROUND(COALESCE(SUM(COALESCE({alias}.service_charge, 0)), 0)::numeric, 2)
                AS service_charge_total,
            ROUND(COALESCE(SUM(COALESCE({alias}.sales_tax, 0)), 0)::numeric, 2)
                AS sales_tax_total,
            ROUND(
                COALESCE(
                    SUM(
                        COALESCE({alias}.charge, 0)
                        + COALESCE({alias}.surcharge, 0)
                        + COALESCE({alias}.service_charge, 0)
                        + COALESCE({alias}.sales_tax, 0)
                    ),
                    0
                )::numeric,
                2
            ) AS gross_statement_total,
            ROUND(COALESCE(SUM(COALESCE({alias}.amount, 0)), 0)::numeric, 2)
                AS signed_amount_total,
            COUNT(*)::int AS statement_rows
        FROM statement_details {alias}
        WHERE {alias}.description ILIKE '%Villa Income%'
        {txn_date_filter(p, alias)}
    )
    """


def booking_base_cte(
    p: Period,
    alias: str = "rd",
    lean: bool = True,
) -> str:
    """
    One latest valid rate_details row per confirmation code.

    This remains the operational/detail booking base for nights, bedrooms,
    people, sources and drill-down rows. It is NOT the authoritative source
    for the per-villa booking count or per-villa dollar cards.
    """
    stay_filter = stay_overlap_filter(p, alias)

    if lean:
        guest_json_select = ""
        guest_json_column = "'[]'::json AS guests"
        room_cte = ""
        room_join = ""
        occupied_rooms_column = "0::int AS occupied_rooms"
    else:
        guest_json_select = """,
            COALESCE(
                JSON_AGG(
                    JSONB_BUILD_OBJECT(
                        'guest_name', rgs.guest_name,
                        'member_number', rgs.member_number,
                        'is_owner', rgs.is_owner,
                        'room_number', rgs.room_number,
                        'check_in_date', rgs.check_in_date,
                        'check_out_date', rgs.check_out_date
                    )
                    ORDER BY
                        rgs.room_number,
                        rgs.guest_name,
                        rgs.member_number
                ),
                '[]'::json
            ) AS guests"""

        guest_json_column = "COALESCE(rgr.guests, '[]'::json) AS guests"

        room_cte = """
    room_rollup AS (
        SELECT
            TRIM(r.confirmation_code) AS conf_code,
            COUNT(DISTINCT r.room_number)::int AS occupied_rooms
        FROM rooms r
        JOIN conf_scope cs
          ON cs.conf_code = TRIM(r.confirmation_code)
        WHERE COALESCE(LOWER(TRIM(r.status)), '') NOT IN (
            'cancelled', 'canceled', 'no-show', 'no show'
        )
        GROUP BY TRIM(r.confirmation_code)
    ),"""

        room_join = """
        LEFT JOIN room_rollup rr
          ON rr.conf_code = rb.conf_code"""

        occupied_rooms_column = (
            "COALESCE(rr.occupied_rooms, 0)::int AS occupied_rooms"
        )

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
            COALESCE(NULLIF(TRIM({alias}.source), ''), 'Unknown') AS source,
            COALESCE(NULLIF(TRIM({alias}.payment_type), ''), 'Unknown')
                AS payment_type,
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
          AND COALESCE(LOWER(TRIM({alias}.status)), '') <> 'unposted'
          AND COALESCE(
                LOWER(TRIM({alias}.reservation_status)),
                ''
              ) NOT IN ('cancelled', 'canceled', 'no-show', 'no show')
          AND COALESCE(LOWER(TRIM({alias}.villa_name)), '') <> 'zz comp'
          {stay_filter}
    ),

    conf_scope AS (
        SELECT DISTINCT conf_code
        FROM filtered_rate_details
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
            ROUND(COALESCE(rbv.total_rental, 0)::numeric, 2) AS total_rental,
            CASE
                WHEN LOWER(TRIM(COALESCE(rbv.payment_type, ''))) IN (
                    'free', 'comp', 'complimentary', 'free/comp', 'free / comp'
                )
                OR LOWER(TRIM(COALESCE(rbv.payment_type, ''))) LIKE '%free%'
                OR LOWER(TRIM(COALESCE(rbv.payment_type, ''))) LIKE '%comp%'
                OR LOWER(TRIM(COALESCE(rbv.payment_type, ''))) LIKE '%complimentary%'
                OR LOWER(TRIM(COALESCE(rbv.payment_type, ''))) LIKE '%gratis%'
                OR LOWER(TRIM(COALESCE(rbv.payment_type, ''))) LIKE '%no charge%'
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
            COUNT(DISTINCT (frd.room_number, frd.rate_date)) FILTER (
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
            COALESCE(bsr.check_in_date, ubv.check_in_date) AS check_in_date,
            COALESCE(bsr.check_out_date, ubv.check_out_date) AS check_out_date,
            COALESCE(bsr.nights, 0)::int AS nights,
            COALESCE(NULLIF(bsr.room_nights, 0), bsr.nights, 0)::int
                AS room_nights,
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

    {room_cte}

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
        JOIN conf_scope cs
          ON cs.conf_code = TRIM(rg.conf_code)
    ),

    reservation_guest_rollup AS (
        SELECT
            rgs.conf_code,
            COUNT(*)::int AS party_size
            {guest_json_select}
        FROM reservation_guest_rows rgs
        WHERE rgs.guest_name IS NOT NULL
           OR rgs.member_number IS NOT NULL
        GROUP BY rgs.conf_code
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
            {occupied_rooms_column},
            {guest_json_column},
            rb.total_rental AS revenue,
            rb.total_rental,
            rb.is_free,
            NULL::text AS statement_detail_key,
            NULL::numeric AS statement_amount,
            NULL::numeric AS payout_ratio,
            FALSE AS revenue_matched
        FROM rate_booking_rows rb
        {room_join}
        LEFT JOIN reservation_guest_rollup rgr
          ON rgr.conf_code = rb.conf_code
    )
    """


def booked_people_source_cte(
    p: Period,
    src: str = "booking_base",
) -> str:
    return f"""
    booked_person_numbers AS (
        SELECT DISTINCT b.member_number
        FROM {src} b
        WHERE b.member_number IS NOT NULL

        UNION

        SELECT DISTINCT r.member_number
        FROM rooms r
        JOIN {src} b
          ON b.conf_code = TRIM(r.confirmation_code)
        WHERE r.member_number IS NOT NULL
          AND COALESCE(LOWER(r.status), '') NOT IN (
              'cancelled', 'canceled', 'no-show'
          )

        UNION

        SELECT DISTINCT sd.member_number
        FROM statement_details sd
        WHERE sd.member_number IS NOT NULL
          AND sd.description ILIKE '%Villa Income%'
          {txn_date_filter(p, 'sd')}
    )
    """


def overview_villa_revenue_ctes(p: Period) -> str:
    """
    Legacy/source-breakdown Overview revenue dataset.

    The authoritative whole-villa amounts are produced by
    villa_paid_free_metrics_cte().
    """
    if p.start is not None:
        meta_having = """
        HAVING MIN(f.check_in_date) <= :range_end
           AND MAX(f.check_out_date) >= :range_start
        """
    elif p.month_only is not None:
        meta_having = """
        HAVING EXTRACT(MONTH FROM MIN(f.check_in_date))::int = :month_only
            OR EXTRACT(MONTH FROM MAX(f.check_out_date))::int = :month_only
        """
    else:
        meta_having = ""

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
        {meta_having}
    ),

    overview_villa_revenue_rows AS (
        SELECT
            otl.overview_conf_code::text AS conf_code,
            COALESCE(
                otl.overview_villa_name,
                osm.villa_name
            ) AS villa_name,
            COALESCE(NULLIF(TRIM(osm.source), ''), 'Unknown') AS source,
            COALESCE(
                NULLIF(TRIM(otl.overview_booking_payment_type), ''),
                'Unknown'
            ) AS payment_type,
            CASE
                WHEN LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
                ) IN (
                    'free', 'comp', 'complimentary', 'free/comp', 'free / comp'
                )
                OR LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
                ) LIKE '%free%'
                OR LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
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
          AND (
                LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
                ) IN (
                    'free', 'comp', 'complimentary', 'free/comp', 'free / comp'
                )
                OR LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
                ) LIKE '%free%'
                OR LOWER(
                    TRIM(COALESCE(otl.overview_booking_payment_type, ''))
                ) LIKE '%comp%'
                OR (
                    otl.overview_conf_code::text ~ '^[0-9]+$'
                    AND otl.overview_conf_code::text::bigint >= 9000000
                )
          )
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


def source_revenue_cte(p: Period) -> str:
    """
    Source-breakdown revenue remains based on Overview Villa lines split by
    overview_booking_meta payment type.
    """
    meta_filter = overview_checkin_filter(p, "ovb")

    free_case = """
        LOWER(
            COALESCE(
                NULLIF(TRIM(ovb.overview_payment_type), ''),
                'paid'
            )
        ) IN ('free', 'comp', 'complimentary', 'free/comp', 'free / comp')
    """

    return rf"""
    villa_revenue AS (
        SELECT
            COALESCE(
                NULLIF(TRIM(otl.overview_villa_name), ''),
                NULLIF(TRIM(ovb.overview_villa_name), '')
            ) AS villa_name,

            CASE WHEN {free_case}
                THEN 'Free'
                ELSE 'Paid'
            END AS payment_type,

            CASE WHEN {free_case}
                THEN TRUE
                ELSE FALSE
            END AS is_free,

            ROUND(
                COALESCE(SUM(otl.overview_net_amount), 0)::numeric,
                2
            ) AS revenue

        FROM overview_transaction_lines otl

        JOIN overview_booking_meta ovb
          ON ovb.overview_conf_code::text =
             otl.overview_conf_code::text

        WHERE otl.overview_line_status = 'Paid'
          AND otl.overview_line_category = 'Villa'
          {meta_filter}

        GROUP BY 1, 2, 3
    )
    """


def villa_paid_free_metrics_cte(
    p: Period,
    booking_src: str = "booking_base",
) -> str:
    """
    Authoritative per-villa bookings and amounts.

    Overview determines booking count/payment type.
    rate_details is retained for reconciliation/fallback.
    """

    overview_date_filter = overview_checkin_filter(p, "ovb")

    if p.start is not None:
        free_period_exists = """
          AND EXISTS (
                SELECT 1
                FROM overview_booking_meta free_obm
                WHERE free_obm.overview_conf_code::text =
                      TRIM(rd.conf_code::text)
                  AND free_obm.overview_check_in_date
                      BETWEEN :range_start AND :range_end
          )
        """

        overall_period_exists = """
          AND EXISTS (
                SELECT 1
                FROM overview_booking_meta amount_obm
                WHERE amount_obm.overview_conf_code::text =
                      otl.overview_conf_code::text
                  AND amount_obm.overview_check_in_date
                      BETWEEN :range_start AND :range_end
          )
        """

    elif p.month_only is not None:
        free_period_exists = """
          AND EXISTS (
                SELECT 1
                FROM overview_booking_meta free_obm
                WHERE free_obm.overview_conf_code::text =
                      TRIM(rd.conf_code::text)
                  AND EXTRACT(
                        MONTH FROM free_obm.overview_check_in_date
                      )::int = :month_only
          )
        """

        overall_period_exists = """
          AND EXISTS (
                SELECT 1
                FROM overview_booking_meta amount_obm
                WHERE amount_obm.overview_conf_code::text =
                      otl.overview_conf_code::text
                  AND EXTRACT(
                        MONTH FROM amount_obm.overview_check_in_date
                      )::int = :month_only
          )
        """

    else:
        free_period_exists = ""
        overall_period_exists = ""

    return rf"""
    zero_charged_paid AS (
        SELECT
            TRIM(conf_code::text) AS conf_code
        FROM rate_details_with_discount
        WHERE payment_type = 'Paid'
          AND conf_code IS NOT NULL
          AND COALESCE(
                LOWER(TRIM(reservation_status)),
                ''
              ) NOT IN (
                'cancelled',
                'canceled',
                'no-show',
                'no show'
              )
        GROUP BY TRIM(conf_code::text)
        HAVING COALESCE(SUM(total_amount), 0) = 0
    ),

    overview_booking_counts AS (
        SELECT
            NULLIF(TRIM(ovb.overview_villa_name), '') AS villa_name,

            COUNT(*)::int AS overall_bookings,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(COALESCE(
                    ovb.overview_payment_type,
                    ''
                ))) = 'paid'
            )::int AS paid_bookings,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(COALESCE(
                    ovb.overview_payment_type,
                    ''
                ))) IN (
                    'free',
                    'comp',
                    'complimentary',
                    'free/comp',
                    'free / comp'
                )
            )::int AS free_bookings

        FROM overview_villa_bookings ovb

        WHERE NULLIF(TRIM(ovb.overview_villa_name), '') IS NOT NULL
          AND LOWER(TRIM(ovb.overview_villa_name)) <> 'zz comp'
          {overview_date_filter}

        GROUP BY NULLIF(TRIM(ovb.overview_villa_name), '')
    ),

    rate_booking_counts AS (
        SELECT
            NULLIF(TRIM(b.villa_name), '') AS villa_name,

            COUNT(DISTINCT b.conf_code)::int AS rate_overall_bookings,

            COUNT(DISTINCT b.conf_code) FILTER (
                WHERE NOT b.is_free
            )::int AS rate_paid_bookings,

            COUNT(DISTINCT b.conf_code) FILTER (
                WHERE b.is_free
            )::int AS rate_free_bookings

        FROM {booking_src} b

        WHERE NULLIF(TRIM(b.villa_name), '') IS NOT NULL

        GROUP BY NULLIF(TRIM(b.villa_name), '')
    ),

    -- [2026-08-13] Deliberately NOT scoped to conf_code >= 9000000 or
    -- overview_line_status = 'Paid' below — this is the broad "all
    -- Villa-category ledger activity" figure (direct + programme, any
    -- status), distinct on purpose from paid_amount in paid_villa_amounts
    -- below (now scoped to the rental-programme-payout basis Overview's
    -- hero tile and Finance's headline figure use). Do not "fix" this to
    -- equal paid_amount + free_amount — see the module docstring above.
    overall_villa_amounts AS (
        SELECT
            NULLIF(TRIM(otl.overview_villa_name), '') AS villa_name,

            ROUND(
                COALESCE(
                    SUM(otl.overview_net_amount),
                    0
                )::numeric,
                2
            ) AS overall_amount

        FROM overview_transaction_lines otl

        WHERE otl.overview_line_category = 'Villa'
          AND NULLIF(TRIM(otl.overview_villa_name), '') IS NOT NULL
          AND LOWER(TRIM(otl.overview_villa_name)) <> 'zz comp'
          {overall_period_exists}

        GROUP BY NULLIF(TRIM(otl.overview_villa_name), '')
    ),

    paid_villa_amounts AS (
        SELECT
            COALESCE(
                NULLIF(TRIM(otl.overview_villa_name), ''),
                NULLIF(TRIM(obm.overview_villa_name), '')
            ) AS villa_name,

            ROUND(
                COALESCE(
                    SUM(otl.overview_net_amount),
                    0
                )::numeric,
                2
            ) AS paid_amount

        FROM overview_transaction_lines otl

        JOIN overview_booking_meta obm
          ON obm.overview_conf_code::text =
             otl.overview_conf_code::text

        WHERE otl.overview_line_category = 'Villa'
          AND otl.overview_line_status = 'Paid'
          -- [2026-08-13] Rental-programme payouts only (synthetic
          -- conf_code >= 9,000,000) — matches Overview's hero tile
          -- (overview_analytics.py, overview_total_villa_revenue) and
          -- Finance's headline figure (finance_backend.py,
          -- _villa_statement_net_revenue). Product decision: "Villa
          -- Revenue" excludes direct/non-programme paid villa bookings.
          -- The obm.overview_payment_type = 'paid' filter just below is
          -- now redundant with this floor (synthetic payout rows are
          -- always 'Paid') but left in place as defense-in-depth.
          AND otl.overview_conf_code::text ~ '^[0-9]+$'
          AND otl.overview_conf_code::text::bigint >= 9000000
          AND LOWER(TRIM(COALESCE(
                obm.overview_payment_type,
                ''
              ))) = 'paid'
          AND LOWER(TRIM(COALESCE(
                otl.overview_villa_name,
                obm.overview_villa_name,
                ''
              ))) <> 'zz comp'
          {overview_checkin_filter(p, "obm")}

        GROUP BY
            COALESCE(
                NULLIF(TRIM(otl.overview_villa_name), ''),
                NULLIF(TRIM(obm.overview_villa_name), '')
            )
    ),

    free_villa_amounts AS (
        SELECT
            NULLIF(TRIM(rd.villa_name), '') AS villa_name,

            ROUND(
                COALESCE(
                    SUM(rd.rack_rate),
                    0
                )::numeric,
                2
            ) AS free_amount

        FROM rate_details_with_discount rd

        WHERE (
                LOWER(TRIM(COALESCE(
                    rd.payment_type,
                    ''
                ))) IN (
                    'free',
                    'comp',
                    'complimentary',
                    'free/comp',
                    'free / comp'
                )

                OR TRIM(rd.conf_code::text) IN (
                    SELECT zcp.conf_code
                    FROM zero_charged_paid zcp
                )
              )

          AND NULLIF(TRIM(rd.villa_name), '') IS NOT NULL

          AND LOWER(TRIM(rd.villa_name)) <> 'zz comp'

          AND COALESCE(
                LOWER(TRIM(rd.reservation_status)),
                ''
              ) NOT IN (
                'cancelled',
                'canceled',
                'no-show',
                'no show'
              )

          {free_period_exists}

        GROUP BY NULLIF(TRIM(rd.villa_name), '')
    ),

    metric_villas AS (
        SELECT villa_name FROM overview_booking_counts
        UNION
        SELECT villa_name FROM rate_booking_counts
        UNION
        SELECT villa_name FROM overall_villa_amounts
        UNION
        SELECT villa_name FROM paid_villa_amounts
        UNION
        SELECT villa_name FROM free_villa_amounts
    ),

    villa_paid_free_metrics AS (
        SELECT
            mv.villa_name,

            COALESCE(
                obc.overall_bookings,
                rbc.rate_overall_bookings,
                0
            )::int AS overall_bookings,

            COALESCE(
                obc.paid_bookings,
                rbc.rate_paid_bookings,
                0
            )::int AS paid_bookings,

            COALESCE(
                obc.free_bookings,
                rbc.rate_free_bookings,
                0
            )::int AS free_bookings,

            COALESCE(ova.overall_amount, 0)::numeric
                AS overall_amount,

            COALESCE(pva.paid_amount, 0)::numeric
                AS paid_amount,

            COALESCE(fva.free_amount, 0)::numeric
                AS free_amount,

            COALESCE(obc.overall_bookings, 0)::int
                AS overview_booking_count,

            COALESCE(rbc.rate_overall_bookings, 0)::int
                AS rate_booking_count,

            (
                COALESCE(obc.overall_bookings, 0)
                -
                COALESCE(rbc.rate_overall_bookings, 0)
            )::int AS booking_count_difference,

            CASE
                WHEN obc.villa_name IS NOT NULL
                THEN 'Overview'
                ELSE 'Rate Details Fallback'
            END AS booking_count_source

        FROM metric_villas mv

        LEFT JOIN overview_booking_counts obc
          ON LOWER(TRIM(obc.villa_name)) =
             LOWER(TRIM(mv.villa_name))

        LEFT JOIN rate_booking_counts rbc
          ON LOWER(TRIM(rbc.villa_name)) =
             LOWER(TRIM(mv.villa_name))

        LEFT JOIN overall_villa_amounts ova
          ON LOWER(TRIM(ova.villa_name)) =
             LOWER(TRIM(mv.villa_name))

        LEFT JOIN paid_villa_amounts pva
          ON LOWER(TRIM(pva.villa_name)) =
             LOWER(TRIM(mv.villa_name))

        LEFT JOIN free_villa_amounts fva
          ON LOWER(TRIM(fva.villa_name)) =
             LOWER(TRIM(mv.villa_name))
    )
    """


def people_ctes() -> str:
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


# =============================================================================
# Aggregate SQL
# =============================================================================

def _villa_stats_sql(
    src: str,
    metrics_src: str | None = None,
) -> str:
    """
    Activity metrics remain rate-detail based.

    When metrics_src is supplied, whole-villa booking/value fields come from
    the authoritative Overview/reconciliation dataset.

    Most villas have a stable bedroom_count. If one villa appears with multiple
    bedroom_count values, the whole-villa booking/value fields will repeat on
    those rows by design; they must not be summed across bedroom rows.
    """

    if metrics_src:
        booking_columns = """
            COALESCE(MAX(vm.overall_bookings), 0)::int AS bookings,
            COALESCE(MAX(vm.paid_bookings), 0)::int AS paid_bookings,
            COALESCE(MAX(vm.free_bookings), 0)::int AS free_bookings,
        """

        money_columns = """
            ROUND(COALESCE(MAX(vm.paid_amount), 0)::numeric, 2)
                AS paid_total_rental,
            ROUND(COALESCE(MAX(vm.free_amount), 0)::numeric, 2)
                AS free_total_rental,
            ROUND(COALESCE(MAX(vm.overall_amount), 0)::numeric, 2)
                AS total_rental,
            ROUND(COALESCE(MAX(vm.paid_amount), 0)::numeric, 2)
                AS revenue,
        """

        reconciliation_columns = """
            COALESCE(MAX(vm.overview_booking_count), 0)::int
                AS overview_booking_count,
            COALESCE(MAX(vm.rate_booking_count), 0)::int
                AS rate_booking_count,
            COALESCE(MAX(vm.booking_count_difference), 0)::int
                AS booking_count_difference,
            MAX(vm.booking_count_source) AS booking_count_source,
        """

        metrics_join = f"""
        LEFT JOIN {metrics_src} vm
          ON LOWER(TRIM(vm.villa_name)) =
             LOWER(TRIM(b.villa_name))
        """

    else:
        booking_columns = """
            COUNT(*)::int AS bookings,
            COUNT(*) FILTER (WHERE NOT b.is_free)::int AS paid_bookings,
            COUNT(*) FILTER (WHERE b.is_free)::int AS free_bookings,
        """

        money_columns = """
            ROUND(
                COALESCE(
                    SUM(b.total_rental) FILTER (WHERE NOT b.is_free),
                    0
                )::numeric,
                2
            ) AS paid_total_rental,
            ROUND(
                COALESCE(
                    SUM(b.total_rental) FILTER (WHERE b.is_free),
                    0
                )::numeric,
                2
            ) AS free_total_rental,
            ROUND(
                COALESCE(SUM(b.total_rental), 0)::numeric,
                2
            ) AS total_rental,
            ROUND(
                COALESCE(
                    SUM(b.total_rental) FILTER (WHERE NOT b.is_free),
                    0
                )::numeric,
                2
            ) AS revenue,
        """

        reconciliation_columns = """
            NULL::int AS overview_booking_count,
            COUNT(*)::int AS rate_booking_count,
            NULL::int AS booking_count_difference,
            'Rate Details'::text AS booking_count_source,
        """

        metrics_join = ""

    return f"""
    SELECT
        b.villa_name,
        b.bedroom_count,
        b.bedroom_count::text AS bedroom_counts,
        b.bedroom_count AS min_bedrooms,
        b.bedroom_count AS max_bedrooms,

        {booking_columns}

        COALESCE(SUM(b.room_nights), 0)::int AS total_nights,
        ROUND(AVG(b.nights)::numeric, 1) AS avg_stay,
        COUNT(DISTINCT b.member_number)::int AS unique_members,
        COALESCE(SUM(b.persons), 0)::int AS total_guests,
        ROUND(AVG(b.persons)::numeric, 1) AS avg_party_size,

        {money_columns}

        {reconciliation_columns}

        COUNT(*)::int AS rate_detail_rows

    FROM {src} b

    {metrics_join}

    WHERE b.villa_name IS NOT NULL

    GROUP BY
        b.villa_name,
        b.bedroom_count

    ORDER BY
        bookings DESC,
        b.villa_name,
        b.bedroom_count NULLS LAST
    """


def _bookings_by_bedroom_sql(src: str) -> str:
    return f"""
    SELECT
        bedroom_count AS beds,
        COUNT(*)::int AS bookings,
        COALESCE(SUM(room_nights), 0)::int AS total_nights,
        ROUND(AVG(nights)::numeric, 1) AS avg_stay
    FROM {src}
    WHERE bedroom_count IS NOT NULL
    GROUP BY bedroom_count
    ORDER BY bedroom_count
    """


def _monthly_revenue_sql(p: Period) -> str:
    return """
    SELECT
        TO_CHAR(vi.income_month_date, 'Mon') AS month,
        EXTRACT(MONTH FROM vi.income_month_date)::int AS month_num,
        0::int AS bookings,
        ROUND(
            COALESCE(SUM(vi.villa_income), 0)::numeric,
            2
        ) AS revenue
    FROM villa_income_rows vi
    WHERE vi.income_month_date IS NOT NULL
    GROUP BY month, month_num
    ORDER BY month_num
    """


def _visits_summary_sql(src: str) -> str:
    return f"""
    SELECT
        (
            SELECT COUNT(*)::int
            FROM booked_person_numbers bp
            LEFT JOIN members m
              ON m.member_number = bp.member_number
            WHERE COALESCE(
                m.member_or_guest,
                'Member'
            ) = 'Member'
        ) AS total_members_booked,

        (
            SELECT COUNT(*)::int
            FROM booked_person_numbers bp
            JOIN members m
              ON m.member_number = bp.member_number
            WHERE m.member_or_guest = 'Guest'
        ) AS total_guests_booked,

        ROUND(AVG(b.nights)::numeric, 1) AS avg_length_of_stay,
        ROUND(AVG(b.persons)::numeric, 1) AS avg_party_size,
        COALESCE(SUM(b.room_nights), 0)::int AS total_room_nights,

        COUNT(*) FILTER (
            WHERE NOT b.is_free
        )::int AS paid_bookings,

        COUNT(*) FILTER (
            WHERE b.is_free
        )::int AS free_bookings,

        ROUND(
            COALESCE(
                SUM(b.revenue) FILTER (
                    WHERE NOT b.is_free
                ),
                0
            )::numeric,
            2
        ) AS paid_revenue,

        ROUND(
            COALESCE(
                SUM(b.revenue) FILTER (
                    WHERE b.is_free
                ),
                0
            )::numeric,
            2
        ) AS free_value,

        ROUND(
            COALESCE(SUM(b.revenue), 0)::numeric,
            2
        ) AS total_booking_value,

        (
            SELECT ROUND(
                COALESCE(SUM(vi.villa_income), 0)::numeric,
                2
            )
            FROM villa_income_rows vi
        ) AS villa_rental_revenue,

        (
            SELECT svc.gross_statement_total
            FROM statement_villa_check svc
        ) AS statement_gross_check,

        (
            SELECT svc.signed_amount_total
            FROM statement_villa_check svc
        ) AS statement_signed_amount_check,

        (
            SELECT svc.statement_rows
            FROM statement_villa_check svc
        ) AS statement_villa_income_rows,

        ROUND(
            (
                SELECT COALESCE(
                    SUM(vi.villa_income),
                    0
                )
                FROM villa_income_rows vi
            )
            -
            COALESCE(
                (
                    SELECT svc.gross_statement_total
                    FROM statement_villa_check svc
                ),
                0
            ),
            2
        ) AS revenue_reconciliation_difference

    FROM {src} b
    WHERE b.villa_name IS NOT NULL
    """


def _paid_free_totals_sql(
    src: str = "villa_paid_free_metrics",
) -> str:
    return f"""
    SELECT
        villa_name,

        overall_bookings AS total_unique_bookings,
        paid_bookings AS paid_unique_bookings,
        free_bookings AS free_unique_bookings,

        ROUND(paid_amount::numeric, 2) AS paid_total_rental,
        ROUND(free_amount::numeric, 2) AS free_total_rental,
        ROUND(overall_amount::numeric, 2) AS overall_total_rental,

        overview_booking_count,
        rate_booking_count,
        booking_count_difference,
        booking_count_source

    FROM {src}

    WHERE (
        :villa IS NULL
        OR LOWER(TRIM(villa_name)) =
           LOWER(TRIM(:villa))
    )

    ORDER BY
        paid_amount DESC,
        villa_name
    """


def _source_breakdown_sql(src: str, rev_src: str) -> str:
    return f"""
    WITH booking_detail AS (
        SELECT
            b.*,
            COUNT(*) OVER (
                PARTITION BY
                    b.villa_name,
                    b.source,
                    b.is_free,
                    b.bedroom_count
            ) AS bedroom_count_total
        FROM {src} b
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
                DISTINCT NULLIF(
                    TRIM(member_number::text),
                    ''
                )
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
        FROM {rev_src}
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
            WHEN source = 'Rental Programme'
            THEN 2
            ELSE 1
        END,
        payment_type,
        bookings DESC,
        source
    """


def _bedroom_breakdown_sql(src: str, rev_src: str) -> str:
    return f"""
    WITH booking_rollup AS (
        SELECT
            bedroom_count,
            source,
            is_free,
            COUNT(*)::int AS bookings,
            COALESCE(SUM(room_nights), 0)::int AS total_nights,
            COUNT(DISTINCT member_number)::int AS unique_members
        FROM {src}
        WHERE villa_name IS NOT NULL
          AND bedroom_count IS NOT NULL
        GROUP BY
            bedroom_count,
            source,
            is_free
    ),

    revenue_rollup AS (
        SELECT
            bedroom_count,
            source,
            is_free,
            ROUND(
                COALESCE(SUM(revenue), 0)::numeric,
                2
            ) AS amount
        FROM {rev_src}
        WHERE villa_name IS NOT NULL
          AND bedroom_count IS NOT NULL
        GROUP BY
            bedroom_count,
            source,
            is_free
    )

    SELECT
        COALESCE(
            b.bedroom_count,
            r.bedroom_count
        ) AS bedroom_count,

        COALESCE(
            b.source,
            r.source,
            'Unknown'
        ) AS source,

        COALESCE(
            b.is_free,
            r.is_free,
            FALSE
        ) AS is_free,

        COALESCE(b.bookings, 0)::int AS bookings,
        COALESCE(b.total_nights, 0)::int AS total_nights,

        CASE
            WHEN NOT COALESCE(
                b.is_free,
                r.is_free,
                FALSE
            )
            THEN COALESCE(r.amount, 0)
            ELSE 0
        END AS revenue,

        CASE
            WHEN COALESCE(
                b.is_free,
                r.is_free,
                FALSE
            )
            THEN COALESCE(r.amount, 0)
            ELSE 0
        END AS free_value,

        COALESCE(
            b.unique_members,
            0
        )::int AS unique_members

    FROM booking_rollup b

    FULL OUTER JOIN revenue_rollup r
      ON r.bedroom_count = b.bedroom_count
     AND LOWER(TRIM(r.source)) =
         LOWER(TRIM(b.source))
     AND r.is_free = b.is_free

    ORDER BY
        bedroom_count NULLS LAST,
        bookings DESC,
        source
    """
