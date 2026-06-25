# backend/postgres/analytics_ml_insights.py
"""
Machine-learning-adjacent analytics endpoints:

  - /ml/amenity-season-insights   : per-season amenity spend, top-amenity
                                     member profiles, amenity visit detail,
                                     and villa/bedroom usage, either computed
                                     live for a given season group_id or read
                                     from pre-materialized summary tables.
  - /ml/member-segments           : reads pre-computed spender/visitor/
                                     amenity segment tables.
  - /ml/segment-config            : get/patch the spend thresholds used to
                                     define "high"/"low" spender segments.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from .analytics_shared import get_db

router = APIRouter()


AMENITY_CASE_SQL = """
    CASE
        WHEN description ~* '\\m(spa|massage|facial)\\M' THEN 'Spa'
        WHEN description ~* '\\m(golf|pro shop|cart)\\M' THEN 'Golf'
        WHEN description ~* '\\mgrill\\M' THEN 'Grill'
        WHEN description ~* '\\mbar\\M' THEN 'Bar'
        WHEN description ~* '\\m(restaurant|dinner|lunch|breakfast)\\M' THEN 'Restaurant'
        WHEN description ~* '\\mtennis\\M' THEN 'Tennis'
        WHEN description ~* '\\mboutique\\M' THEN 'Boutique'
        WHEN description ~* '\\mshop\\M' THEN 'Shop'
        WHEN description ~* '\\mcommissary\\M' THEN 'Commissary'
        ELSE NULL
    END
"""

AMENITY_EXCLUDED_SQL = """
    description !~* '\\m(villa|rental|airport|transfer|shuttle|transport|transportation|membership|dues|fee)\\M'
"""

SEASON_JOIN_SQL = """
    JOIN active_seasons s
      ON (
        (
          s.start_month < s.end_month
          OR (s.start_month = s.end_month AND s.start_day <= s.end_day)
        )
        AND (
          EXTRACT(MONTH FROM ref_date)::INT > s.start_month
          OR (
            EXTRACT(MONTH FROM ref_date)::INT = s.start_month
            AND EXTRACT(DAY FROM ref_date)::INT >= s.start_day
          )
        )
        AND (
          EXTRACT(MONTH FROM ref_date)::INT < s.end_month
          OR (
            EXTRACT(MONTH FROM ref_date)::INT = s.end_month
            AND EXTRACT(DAY FROM ref_date)::INT <= s.end_day
          )
        )
      )
      OR (
        (
          s.start_month > s.end_month
          OR (s.start_month = s.end_month AND s.start_day > s.end_day)
        )
        AND (
          EXTRACT(MONTH FROM ref_date)::INT > s.start_month
          OR (
            EXTRACT(MONTH FROM ref_date)::INT = s.start_month
            AND EXTRACT(DAY FROM ref_date)::INT >= s.start_day
          )
          OR EXTRACT(MONTH FROM ref_date)::INT < s.end_month
          OR (
            EXTRACT(MONTH FROM ref_date)::INT = s.end_month
            AND EXTRACT(DAY FROM ref_date)::INT <= s.end_day
          )
        )
      )
"""

PAYMENT_IS_FREE_SQL = """
    CASE
        WHEN LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown')) ILIKE '%comp%'
          OR LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown')) ILIKE '%free%'
          OR LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown')) ILIKE '%complimentary%'
          OR LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown')) ILIKE '%gratis%'
          OR LOWER(COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown')) ILIKE '%no charge%'
        THEN TRUE
        ELSE FALSE
    END
"""

def _ml_amenity_season_insights_for_group(group_id: int, db: Session):
    active_season_count = db.execute(
        text("""
            SELECT COUNT(*)
            FROM seasons
            WHERE group_id = :group_id
              AND is_active = TRUE
        """),
        {"group_id": group_id},
    ).scalar() or 0

    if active_season_count == 0:
        return {
            "amenitySeasonSpend": [],
            "memberAmenityProfile": [],
            "memberAmenitySeasonVisits": [],
            "seasonVillaBedroom": [],
        }

    def rows(sql: str):
        return [
            dict(row)
            for row in db.execute(text(sql), {"group_id": group_id}).mappings().all()
        ]

    base_ctes = f"""
        WITH active_seasons AS (
            SELECT id, season_name, start_month, start_day, end_month, end_day
            FROM seasons
            WHERE group_id = :group_id
              AND is_active = TRUE
        ),
        amenity_rows AS (
            SELECT
                f.member_number AS member_id,
                COALESCE(
                    NULLIF(TRIM(f.guest_name), ''),
                    NULLIF(TRIM(m.member_full_name), ''),
                    NULLIF(TRIM(m.member_name), '')
                ) AS member_full_name,

                m.email,
                mp.phone_number AS telephone,
                TRIM(
                    CONCAT_WS(
                        ', ',
                        NULLIF(a.address_line1, ''),
                        NULLIF(a.address_line2, ''),
                        NULLIF(a.city, ''),
                        NULLIF(a.state, ''),
                        NULLIF(a.postal_code, ''),
                        NULLIF(a.country, '')
                    )
                ) AS address,
                a.country,
                a.state,
                m.prefix AS title,
                m.date_of_birth AS dob,

                f.description,
                COALESCE(f.amount, 0) AS amount,
                COALESCE(NULLIF(TRIM(f.payment_type), ''), 'Unknown') AS payment_type,
                {PAYMENT_IS_FREE_SQL} AS is_free,
                COALESCE(f.check_in_date, f.transaction_date)::DATE AS ref_date,
                f.check_in_date,
                f.check_out_date,
                {AMENITY_CASE_SQL} AS amenity
            FROM folios f
            LEFT JOIN members m
                ON f.member_number = m.member_number
            LEFT JOIN member_addresses a
                ON f.member_number = a.member_number
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
                ON f.member_number = mp.member_number
            WHERE f.member_number IS NOT NULL
              AND f.description IS NOT NULL
              AND COALESCE(f.check_in_date, f.transaction_date) IS NOT NULL
              AND {AMENITY_EXCLUDED_SQL}
        ),
        season_amenity_rows AS (
            SELECT
                ar.member_id,
                ar.member_full_name,
                ar.email,
                ar.telephone,
                ar.address,
                ar.country,
                ar.state,
                ar.title,
                ar.dob,
                ar.description,
                ar.amount,
                ar.payment_type,
                ar.is_free,
                ar.ref_date,
                ar.check_in_date,
                ar.check_out_date,
                ar.amenity,
                EXTRACT(YEAR FROM ar.ref_date)::INT AS year,
                s.season_name AS season
            FROM amenity_rows ar
            {SEASON_JOIN_SQL}
            WHERE ar.amenity IS NOT NULL
        )
    """

    spend_raw = rows(f"""
        {base_ctes}
        SELECT year,
               amenity,
               season,
               ROUND(SUM(CASE WHEN NOT is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS revenue,
               ROUND(SUM(CASE WHEN is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS free_value,
               ROUND(SUM(amount)::NUMERIC, 2) AS total_spend,
               COUNT(*)::INT AS transaction_count,
               ROUND((SUM(amount) / NULLIF(COUNT(*), 0))::NUMERIC, 2) AS avg_spend_per_visit,
               COUNT(DISTINCT member_id)::INT AS member_count
        FROM season_amenity_rows
        GROUP BY year, amenity, season
        ORDER BY year DESC, season, total_spend DESC
    """)

    profile_raw = rows(f"""
        {base_ctes},
        per_member_amenity AS (
            SELECT year,
                   member_id,
                   MAX(member_full_name) AS member_full_name,
                   amenity,
                   BOOL_OR(is_free) AS has_comp,
                   COUNT(*) AS usage_count,
                   SUM(amount) AS amenity_spend,
                   SUM(CASE WHEN NOT is_free THEN amount ELSE 0 END) AS amenity_revenue,
                   SUM(CASE WHEN is_free THEN amount ELSE 0 END) AS amenity_free_value
            FROM season_amenity_rows
            GROUP BY year, member_id, amenity
        ),
        ranked AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY year, member_id
                       ORDER BY amenity_spend DESC NULLS LAST
                   ) AS rn,
                   SUM(amenity_spend) OVER (PARTITION BY year, member_id) AS total_amenity_spend,
                   SUM(amenity_revenue) OVER (PARTITION BY year, member_id) AS total_amenity_revenue,
                   SUM(amenity_free_value) OVER (PARTITION BY year, member_id) AS total_amenity_free_value
            FROM per_member_amenity
        )
        SELECT year,
               member_id,
               member_full_name,
               amenity AS top_amenity,
               has_comp,
               ROUND(amenity_spend::NUMERIC, 2) AS top_amenity_spend,
               ROUND(amenity_revenue::NUMERIC, 2) AS top_amenity_revenue,
               ROUND(amenity_free_value::NUMERIC, 2) AS top_amenity_free_value,
               ROUND(total_amenity_spend::NUMERIC, 2) AS total_amenity_spend,
               ROUND(total_amenity_revenue::NUMERIC, 2) AS total_amenity_revenue,
               ROUND(total_amenity_free_value::NUMERIC, 2) AS total_amenity_free_value
        FROM ranked
        WHERE rn = 1
        ORDER BY year DESC, total_amenity_spend DESC NULLS LAST
        LIMIT 1000
    """)

    visits_raw = rows(f"""
        {base_ctes}
        SELECT year,
               member_id,
               member_full_name,
               email,
               telephone,
               address,
               country,
               state,
               title,
               TO_CHAR(dob, 'Mon DD, YYYY') AS dob,
               season,
               amenity,
               payment_type,
               is_free,
               COUNT(*)::INT AS usage_count,
               ROUND(SUM(CASE WHEN NOT is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS revenue,
               ROUND(SUM(CASE WHEN is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS free_value,
               ROUND(SUM(amount)::NUMERIC, 2) AS total_spend,
               TO_CHAR(check_in_date, 'Mon DD, YYYY') AS check_in_fmt,
               TO_CHAR(check_out_date, 'Mon DD, YYYY') AS check_out_fmt
        FROM season_amenity_rows
        GROUP BY year,
                 member_id,
                 member_full_name,
                 email,
                 telephone,
                 address,
                 country,
                 state,
                 title,
                 dob,
                 season,
                 check_in_date,
                 check_out_date,
                 amenity,
                 payment_type,
                 is_free
        ORDER BY check_in_date DESC NULLS LAST
        LIMIT 2000
    """)

    villa_raw = rows(f"""
        WITH active_seasons AS (
            SELECT id, season_name, start_month, start_day, end_month, end_day
            FROM seasons
            WHERE group_id = :group_id
              AND is_active = TRUE
        ),
        stay_rows AS (
            SELECT
                f.member_number,
                f.check_in_date::DATE AS ref_date,
                EXTRACT(YEAR FROM f.check_in_date)::INT AS year,
                f.check_in_date,
                f.check_out_date,
                f.villa_name,
                f.bedroom_count,
                GREATEST((f.check_out_date - f.check_in_date), 0) AS nights
            FROM folios f
            WHERE f.member_number IS NOT NULL
              AND f.check_in_date IS NOT NULL
        ),
        season_stay_rows AS (
            SELECT sr.*, s.season_name AS season
            FROM stay_rows sr
            {SEASON_JOIN_SQL}
        ),
        season_totals AS (
            SELECT year,
                   season,
                   COUNT(*)::INT AS total_bookings,
                   COALESCE(SUM(nights), 0)::INT AS total_nights,
                   ROUND(AVG(nights)::NUMERIC, 2) AS avg_nights,
                   COUNT(DISTINCT member_number)::INT AS unique_members
            FROM season_stay_rows
            GROUP BY year, season
        ),
        villa_rank AS (
            SELECT year,
                   season,
                   villa_name,
                   ROW_NUMBER() OVER (
                       PARTITION BY year, season
                       ORDER BY COUNT(*) DESC, villa_name
                   ) AS rn
            FROM season_stay_rows
            WHERE villa_name IS NOT NULL
            GROUP BY year, season, villa_name
        ),
        bedroom_rank AS (
            SELECT year,
                   season,
                   bedroom_count,
                   ROW_NUMBER() OVER (
                       PARTITION BY year, season
                       ORDER BY COUNT(*) DESC, bedroom_count
                   ) AS rn
            FROM season_stay_rows
            WHERE bedroom_count IS NOT NULL
            GROUP BY year, season, bedroom_count
        ),
        bedroom_dist AS (
            SELECT year,
                   season,
                   jsonb_object_agg(bedroom_count::INT::TEXT, count)::TEXT AS bedroom_distribution
            FROM (
                SELECT year, season, bedroom_count, COUNT(*)::INT AS count
                FROM season_stay_rows
                WHERE bedroom_count IS NOT NULL
                GROUP BY year, season, bedroom_count
            ) counts
            GROUP BY year, season
        )
        SELECT st.year,
               st.season,
               st.total_bookings,
               st.total_nights,
               st.avg_nights,
               st.unique_members,
               vr.villa_name AS top_villa,
               br.bedroom_count::INT AS top_bedroom_count,
               bd.bedroom_distribution
        FROM season_totals st
        LEFT JOIN villa_rank vr ON vr.year = st.year AND vr.season = st.season AND vr.rn = 1
        LEFT JOIN bedroom_rank br ON br.year = st.year AND br.season = st.season AND br.rn = 1
        LEFT JOIN bedroom_dist bd ON bd.year = st.year AND bd.season = st.season
        ORDER BY st.year DESC, st.total_bookings DESC
    """)

    return {
        "amenitySeasonSpend": spend_raw,
        "memberAmenityProfile": profile_raw,
        "memberAmenitySeasonVisits": visits_raw,
        "seasonVillaBedroom": villa_raw,
    }


@router.get("/ml/amenity-season-insights")
def ml_amenity_season_insights(
    group_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if group_id is not None:
        return _ml_amenity_season_insights_for_group(group_id, db)

    def rows(sql: str):
        return [dict(row) for row in db.execute(text(sql)).mappings().all()]

    def table_columns(table_name: str):
        return {
            row["column_name"]
            for row in db.execute(
                text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = :table_name
                """),
                {"table_name": table_name},
            ).mappings().all()
        }

    amenity_spend_cols = table_columns("amenity_season_spend")
    if {"revenue", "free_value"}.issubset(amenity_spend_cols):
        spend_raw = rows("""
            SELECT amenity,
                   season,
                   revenue,
                   free_value,
                   total_spend,
                   transaction_count,
                   avg_spend_per_visit,
                   member_count
            FROM amenity_season_spend
            ORDER BY season, total_spend DESC
        """)
    else:
        spend_raw = rows("""
            SELECT amenity,
                   season,
                   total_spend AS revenue,
                   0::NUMERIC AS free_value,
                   total_spend,
                   transaction_count,
                   avg_spend_per_visit,
                   member_count
            FROM amenity_season_spend
            ORDER BY season, total_spend DESC
        """)

    member_profile_cols = table_columns("member_amenity_profile")
    if {
        "has_comp",
        "top_amenity_free_value",
        "top_amenity_revenue",
        "top_amenity_free_value",
        "total_amenity_revenue",
        "total_amenity_free_value",
    }.issubset(member_profile_cols):
        profile_raw = rows("""
            SELECT member_id,
                   member_full_name,
                   top_amenity,
                   has_comp,
                   top_amenity_spend,
                   top_amenity_revenue,
                   top_amenity_free_value,
                   total_amenity_spend,
                   total_amenity_revenue,
                   total_amenity_free_value
            FROM member_amenity_profile
            ORDER BY total_amenity_spend DESC NULLS LAST
            LIMIT 1000
        """)
    else:
        profile_raw = rows("""
            SELECT member_id,
                   member_full_name,
                   top_amenity,
                   false AS has_comp,
                   top_amenity_spend,
                   top_amenity_spend AS top_amenity_revenue,
                   0::NUMERIC AS top_amenity_free_value,
                   total_amenity_spend,
                   total_amenity_spend AS total_amenity_revenue,
                   0::NUMERIC AS total_amenity_free_value
            FROM member_amenity_profile
            ORDER BY total_amenity_spend DESC NULLS LAST
            LIMIT 1000
        """)

    member_visits_cols = table_columns("member_amenity_season_visits")
    if {"payment_type", "is_free", "revenue", "free_value"}.issubset(member_visits_cols):
        visits_raw = rows("""
            SELECT member_id,
                   member_full_name,
                   email,
                   telephone,
                   address,
                   country,
                   state,
                   title,
                   dob,
                   season,
                   amenity,
                   payment_type,
                   is_free,
                   usage_count,
                   revenue,
                   free_value,
                   total_spend,
                   check_in_fmt,
                   check_out_fmt
            FROM member_amenity_season_visits
            ORDER BY check_in_fmt DESC NULLS LAST
            LIMIT 2000
        """)
    else:
        visits_raw = rows("""
            SELECT member_id,
                   member_full_name,
                   email,
                   telephone,
                   address,
                   country,
                   state,
                   title,
                   dob,
                   season,
                   amenity,
                   'Unknown' AS payment_type,
                   false AS is_free,
                   usage_count,
                   total_spend AS revenue,
                   0::NUMERIC AS free_value,
                   total_spend,
                   check_in_fmt,
                   check_out_fmt
            FROM member_amenity_season_visits
            ORDER BY check_in_fmt DESC NULLS LAST
            LIMIT 2000
        """)

    villa_raw = rows("""
        SELECT season,
               total_bookings,
               total_nights,
               avg_nights,
               unique_members,
               top_villa,
               top_bedroom_count,
               bedroom_distribution
        FROM season_villa_bedroom_summary
        ORDER BY total_bookings DESC
    """)

    return {
        "amenitySeasonSpend": spend_raw,
        "memberAmenityProfile": profile_raw,
        "memberAmenitySeasonVisits": visits_raw,
        "seasonVillaBedroom": villa_raw,
    }


#-----------------------------#
# Endpoints for Segmentation
#-----------------------------#
@router.get("/ml/member-segments")
def member_segments(db: Session = Depends(get_db)):

    spenders = db.execute(text("""
        SELECT *
        FROM segment_spenders
    """)).mappings().all()

    visitors = db.execute(text("""
        SELECT *
        FROM segment_visitors
    """)).mappings().all()

    amenities = db.execute(text("""
        SELECT *
        FROM segment_amenities
    """)).mappings().all()

    return {
        "spenders": [dict(r) for r in spenders],
        "visitors": [dict(r) for r in visitors],
        "amenities": [dict(r) for r in amenities]
    }


@router.get("/ml/segment-config")
def get_segment_config(db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT key, value FROM segment_config WHERE key IN ('high_spend_threshold', 'low_spend_threshold')")
    ).mappings().all()
    return {row["key"]: float(row["value"]) for row in rows}


@router.patch("/ml/segment-config")
def update_segment_config(payload: dict, db: Session = Depends(get_db)):
    allowed_keys = {"high_spend_threshold", "low_spend_threshold"}
    updates = {k: v for k, v in payload.items() if k in allowed_keys}

    if not updates:
        raise HTTPException(status_code=400, detail="No valid keys provided")

    for key, value in updates.items():
        db.execute(
            text("""
                INSERT INTO segment_config (key, value) VALUES (:key, :value)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """),
            {"key": key, "value": value},
        )

    db.commit()
    return {"ok": True, "updated": updates}