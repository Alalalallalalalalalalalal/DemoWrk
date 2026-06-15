# backend/postgres/analytics.py
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from postgres.database import SessionLocal

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/dashboard-summary")
def dashboard_summary(db: Session = Depends(get_db)):
    def rows(sql: str):
        return [dict(row) for row in db.execute(text(sql)).mappings().all()]

    def one(sql: str):
        return dict(db.execute(text(sql)).mappings().first() or {})

    return {
        "membersByCountry": rows("""SELECT country, COUNT(*) AS total
                                    FROM member_addresses
                                    WHERE country IS NOT NULL
                                    GROUP BY country
                                    ORDER BY total DESC"""),

        "membersByState": rows("""
            SELECT
                UPPER(TRIM(state)) AS state,
                COUNT(*)::int AS total
            FROM member_addresses
            WHERE UPPER(TRIM(state)) IN (
                'AL', 'AK', 'AZ', 'AR', 'CA',
                'CO', 'CT', 'DE', 'FL', 'GA',
                'HI', 'ID', 'IL', 'IN', 'IA',
                'KS', 'KY', 'LA', 'ME', 'MD',
                'MA', 'MI', 'MN', 'MS', 'MO',
                'MT', 'NE', 'NV', 'NH', 'NJ',
                'NM', 'NY', 'NC', 'ND', 'OH',
                'OK', 'OR', 'PA', 'RI', 'SC',
                'SD', 'TN', 'TX', 'UT', 'VT',
                'VA', 'WA', 'WV', 'WI', 'WY',
                'DC'
            )
            GROUP BY UPPER(TRIM(state))
            ORDER BY total DESC
        """),

        "membersByState": rows("""SELECT state, COUNT(*) AS total
                                  FROM member_addresses
                                  WHERE state IS NOT NULL
                                  GROUP BY state
                                  ORDER BY total DESC"""),

        "membersByGender": rows("""SELECT gender, COUNT(*) AS total
                                   FROM members
                                   WHERE gender IS NOT NULL
                                   GROUP BY gender
                                   ORDER BY total DESC"""),

        "membersByAgeGroup": rows("""
            SELECT
                CASE
                    WHEN age < 18 THEN 'Under 18'
                    WHEN age BETWEEN 18 AND 25 THEN '18-25'
                    WHEN age BETWEEN 26 AND 35 THEN '26-35'
                    WHEN age BETWEEN 36 AND 50 THEN '36-50'
                    WHEN age BETWEEN 51 AND 65 THEN '51-65'
                    ELSE '66+'
                END AS age_group,
                COUNT(*) AS total
            FROM members
            WHERE age IS NOT NULL
            GROUP BY age_group
            ORDER BY age_group
        """),

        "membersByType": rows("""
            SELECT member_type, COUNT(*) AS total
            FROM members
            WHERE member_type IS NOT NULL
            GROUP BY member_type
            ORDER BY total DESC
        """),

        "accountsByType": rows("""
            SELECT
                member_type AS member_type,
                member_or_guest AS account_category,
                COUNT(*) AS total
            FROM members
            WHERE member_type IS NOT NULL
            AND member_type <> ''
            AND member_or_guest IN ('Member', 'Guest')
            GROUP BY
                member_type,
                member_or_guest
            ORDER BY total DESC
        """),

        "membersByStatus": rows("""
            SELECT
                status,
                COUNT(*) FILTER (
                    WHERE member_or_guest = 'Member'
                ) AS members,
                COUNT(*) FILTER (
                    WHERE member_or_guest = 'Guest'
                ) AS guests,
                COUNT(*) AS total
            FROM members
            WHERE status IS NOT NULL
            GROUP BY status
            ORDER BY total DESC
        """),

        "bookingsByRoomType": rows("""
            SELECT room_type, COUNT(*) AS total
            FROM rooms
            WHERE room_type IS NOT NULL
            GROUP BY room_type
            ORDER BY total DESC
        """),

        "bookingsByMonth": rows("""
            SELECT TO_CHAR(check_in_date,'YYYY-MM') AS month,
                   COUNT(*) AS total
            FROM rooms
            WHERE check_in_date IS NOT NULL
            GROUP BY month
            ORDER BY month
        """),

        "newMembersPerYear": rows("""
            SELECT EXTRACT(YEAR FROM since_date)::INT AS year,
                COUNT(*) FILTER (
                    WHERE member_or_guest = 'Member'
                ) AS members,
                COUNT(*) FILTER (
                    WHERE member_or_guest = 'Guest'
                ) AS guests,
                COUNT(*) AS total
            FROM members
            WHERE since_date IS NOT NULL
                AND EXTRACT(YEAR FROM since_date) >= 2018
                AND member_or_guest IN ('Member', 'Guest')
            GROUP BY year
            ORDER BY year
        """),

        "averageTenure": one("""
            SELECT ROUND(
                AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, since_date))),2
            ) AS average_tenure_years
            FROM members
            WHERE since_date IS NOT NULL
        """),

        "averageLengthOfStay": one("""
            SELECT ROUND(
                AVG(check_out_date - check_in_date),2
            ) AS average_nights
            FROM rooms
            WHERE check_in_date IS NOT NULL
              AND check_out_date IS NOT NULL
        """),

        "totalRecentActivitySpend": one("""
            SELECT COALESCE(SUM(amount),0) AS total
            FROM recent_activity
            WHERE amount IS NOT NULL
        """),

        "spendByMonth": rows("""
            SELECT TO_CHAR(activity_date,'YYYY-MM') AS month,
                   SUM(amount) AS total
            FROM recent_activity
            WHERE activity_date IS NOT NULL
              AND amount IS NOT NULL
            GROUP BY month
            ORDER BY month
        """),

        "topSpendDescriptions": rows("""
            SELECT description,
                   SUM(amount) AS total
            FROM recent_activity
            WHERE description IS NOT NULL
              AND amount IS NOT NULL
            GROUP BY description
            ORDER BY total DESC
            LIMIT 10
        """),

        "totalAmountDue": one("""
            SELECT COALESCE(SUM(amount_due),0)
                   AS total_amount_due
            FROM statements
            WHERE amount_due IS NOT NULL
        """),

        "amountDueByPeriod": rows("""
            SELECT statement_period,
                   SUM(amount_due) AS total
            FROM statements
            WHERE statement_period IS NOT NULL
            GROUP BY statement_period
            ORDER BY statement_period
        """),

            "dependentsByAgeGroup": rows("""
        SELECT
            CASE
                WHEN age < 18 THEN 'Under 18'
                WHEN age BETWEEN 18 AND 25 THEN '18-25'
                WHEN age BETWEEN 26 AND 35 THEN '26-35'
                WHEN age BETWEEN 36 AND 50 THEN '36-50'
                ELSE '51+'
            END AS age_group,
            COUNT(*) AS total
        FROM dependents
        WHERE age IS NOT NULL
        GROUP BY age_group
        ORDER BY age_group
    """),

    "dependentsPerMember": rows("""
        SELECT
            member_number,
            COUNT(*) AS total_dependents
        FROM dependents
        GROUP BY member_number
        ORDER BY total_dependents DESC
        LIMIT 20
    """),

    "dependentsPerHousehold": rows("""
        WITH household_counts AS (
            SELECT
                m.member_number,
                COUNT(d.dependent_number) AS dependent_count
            FROM members m
            LEFT JOIN dependents d
                ON d.member_number = m.member_number
            WHERE LOWER(TRIM(m.member_or_guest)) = 'member'
            GROUP BY m.member_number
        ),
        grouped_households AS (
            SELECT
                CASE
                    WHEN dependent_count = 0 THEN '0 Dependents'
                    WHEN dependent_count = 1 THEN '1 Dependent'
                    WHEN dependent_count = 2 THEN '2 Dependents'
                    WHEN dependent_count = 3 THEN '3 Dependents'
                    ELSE '4+ Dependents'
                END AS household_group,
                CASE
                    WHEN dependent_count = 0 THEN 1
                    WHEN dependent_count = 1 THEN 2
                    WHEN dependent_count = 2 THEN 3
                    WHEN dependent_count = 3 THEN 4
                    ELSE 5
                END AS sort_order
            FROM household_counts
        )
        SELECT
            household_group,
            COUNT(*)::int AS total_households
        FROM grouped_households
        GROUP BY household_group, sort_order
        ORDER BY sort_order
    """),

    "totalDependents": one("""
        SELECT COUNT(*) AS total_dependents
        FROM dependents
    """),

    "mostUsedRoomTypes": rows("""
        SELECT room_type, COUNT(*) AS total
        FROM rooms
        WHERE room_type IS NOT NULL
        GROUP BY room_type
        ORDER BY total DESC
        LIMIT 10
    """),

    "leastUsedRoomTypes": rows("""
        SELECT room_type, COUNT(*) AS total
        FROM rooms
        WHERE room_type IS NOT NULL
        GROUP BY room_type
        ORDER BY total ASC
        LIMIT 10
    """),

    "membersByMaritalStatus": rows("""
        SELECT marital_status, COUNT(*) AS total
        FROM members
        WHERE marital_status IS NOT NULL
        GROUP BY marital_status
        ORDER BY total DESC
    """),

    "directoryMembers": rows("""
        SELECT
            m.member_number,
            m.member_name,
            m.member_full_name,
            m.member_type,
            m.member_or_guest,
            m.status,
            m.age,
            m.gender,
            m.occupation,
            m.employer,
            m.email,
            m.membership_tenure,
            a.city,
            a.state,
            a.country,
            COALESCE(d.total_dependents, 0) AS dependents,
            COALESCE(s.amount_due, 0) AS amount_due,
            CASE
                WHEN r.member_number IS NOT NULL THEN true
                ELSE false
            END AS currently_checked_in
        FROM members m
        LEFT JOIN member_addresses a ON m.member_number = a.member_number
        LEFT JOIN (
            SELECT member_number, COUNT(*) AS total_dependents
            FROM dependents
            GROUP BY member_number
        ) d ON m.member_number = d.member_number
        LEFT JOIN (
            SELECT member_number, SUM(amount_due) AS amount_due
            FROM statements
            GROUP BY member_number
        ) s ON m.member_number = s.member_number
        LEFT JOIN (
            SELECT DISTINCT member_number
            FROM rooms
            WHERE check_in_date <= CURRENT_DATE
            AND check_out_date > CURRENT_DATE
            AND (
                status IS NULL
                OR LOWER(status) NOT IN ('cancelled', 'canceled')
            )
        ) r ON m.member_number = r.member_number
        ORDER BY m.member_name
        LIMIT 500
    """),
    }

#season stuff

@router.get("/season-summary")
def season_summary(db: Session = Depends(get_db)):
    def rows(sql: str):
        return [dict(row) for row in db.execute(text(sql)).mappings().all()]

    season_groups = rows("""
        SELECT
            sg.id,
            sg.group_name,
            sg.group_type,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', s.id,
                        'season_name', s.season_name,
                        'start_month', s.start_month,
                        'start_day', s.start_day,
                        'end_month', s.end_month,
                        'end_day', s.end_day,
                        'is_active', s.is_active
                    )
                    ORDER BY s.start_month, s.start_day
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'
            ) AS seasons
        FROM season_groups sg
        LEFT JOIN seasons s ON s.group_id = sg.id
        WHERE sg.group_type <> 'simple'
        GROUP BY sg.id, sg.group_name, sg.group_type
        ORDER BY sg.id
    """)

    seasonal_visits = rows("""
        SELECT month, visits, avg_stay
        FROM seasonal_visits
        ORDER BY month
    """)

    season_visitors = rows("""
        SELECT season_id, season_name, COUNT(*) AS repeat_visitor_count
        FROM season_visitors
        GROUP BY season_id, season_name
        ORDER BY repeat_visitor_count DESC
    """)

    return {
        "seasonGroups": season_groups,
        "seasonalVisits": seasonal_visits,
        "seasonVisitors": season_visitors,
    }

@router.post("/season-groups")
def create_season_group(payload: dict, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            INSERT INTO season_groups (group_name, group_type)
            VALUES (:group_name, 'custom')
            RETURNING id, group_name, group_type, created_at
        """),
        {"group_name": payload["group_name"]},
    ).mappings().first()
    db.commit()
    return {**dict(row), "seasons": []}


@router.delete("/seasons/{season_id}")
def delete_season(season_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            DELETE FROM seasons
            WHERE id = :season_id
            RETURNING id
        """),
        {"season_id": season_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Season not found")

    db.commit()
    return {"ok": True, "deleted_id": season_id}


@router.delete("/season-groups/{group_id}")
def delete_season_group(group_id: int, db: Session = Depends(get_db)):
    group = db.execute(
        text("""
            SELECT id, group_type
            FROM season_groups
            WHERE id = :group_id
        """),
        {"group_id": group_id},
    ).mappings().first()

    if not group:
        raise HTTPException(status_code=404, detail="Season group not found")

    if group["group_type"] != "custom":
        raise HTTPException(
            status_code=400,
            detail="Only custom season groups can be deleted"
        )

    db.execute(
        text("DELETE FROM seasons WHERE group_id = :group_id"),
        {"group_id": group_id},
    )

    db.execute(
        text("DELETE FROM season_groups WHERE id = :group_id"),
        {"group_id": group_id},
    )

    db.commit()
    return {"ok": True, "deleted_id": group_id}


@router.post("/seasons")
def create_season(payload: dict, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            INSERT INTO seasons
                (group_id, season_name, start_month, start_day, end_month, end_day, is_active)
            VALUES
                (:group_id, :season_name, :start_month, :start_day, :end_month, :end_day, true)
            RETURNING id, group_id, season_name, start_month, start_day, end_month, end_day, is_active
        """),
        payload,
    ).mappings().first()
    db.commit()
    return dict(row)


@router.patch("/seasons/{season_id}")
def update_season(season_id: int, payload: dict, db: Session = Depends(get_db)):
    allowed = {
        "season_name",
        "start_month",
        "start_day",
        "end_month",
        "end_day",
        "is_active",
    }

    updates = {k: v for k, v in payload.items() if k in allowed}

    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_sql = ", ".join([f"{k} = :{k}" for k in updates])

    row = db.execute(
        text(f"""
            UPDATE seasons
            SET {set_sql}, updated_at = NOW()
            WHERE id = :season_id
            RETURNING id, group_id, season_name, start_month, start_day, end_month, end_day, is_active
        """),
        {**updates, "season_id": season_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Season not found")

    db.commit()
    return dict(row)

@router.get("/seasons/{season_id}/members")
def season_members(season_id: int, db: Session = Depends(get_db)):
    season = db.execute(
        text("""
            SELECT id, season_name, start_month, start_day, end_month, end_day
            FROM seasons
            WHERE id = :season_id
        """),
        {"season_id": season_id},
    ).mappings().first()

    if not season:
        raise HTTPException(status_code=404, detail="Season not found")

    result = db.execute(
        text("""
            SELECT DISTINCT
                f.member_number,
                f.conf_code,
                COALESCE(m.member_full_name, f.guest_name, f.folio_name) AS member_full_name,
                f.guest_name,
                f.folio_name,
                m.member_type,
                m.age,
                a.country,
                f.check_in_date,
                f.check_out_date,
                CASE
                    WHEN f.check_in_date IS NOT NULL AND f.check_out_date IS NOT NULL
                    THEN GREATEST(f.check_out_date - f.check_in_date, 0)
                    ELSE NULL
                END AS length_of_stay,
                f.room_number,
                f.villa_name,
                f.bedroom_count,
                f.reservation_status,
                f.transaction_date
            FROM folios f
            LEFT JOIN members m
                ON f.member_number = m.member_number
            LEFT JOIN member_addresses a
                ON f.member_number = a.member_number
            WHERE f.member_number IS NOT NULL
              AND COALESCE(f.check_in_date, f.transaction_date) IS NOT NULL
              AND (
                (
                  (:start_month < :end_month)
                  OR (:start_month = :end_month AND :start_day <= :end_day)
                )
                AND (
                  EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) > :start_month
                  OR (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :start_month
                    AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) >= :start_day
                  )
                )
                AND (
                  EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) < :end_month
                  OR (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :end_month
                    AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) <= :end_day
                  )
                )
                OR
                (
                  (:start_month > :end_month)
                  OR (:start_month = :end_month AND :start_day > :end_day)
                )
                AND (
                  (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) > :start_month
                    OR (
                      EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :start_month
                      AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) >= :start_day
                    )
                  )
                  OR
                  (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) < :end_month
                    OR (
                      EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :end_month
                      AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) <= :end_day
                    )
                  )
                )
              )
            ORDER BY f.check_in_date DESC NULLS LAST, member_full_name
            LIMIT 1000
        """),
        {
            "start_month": season["start_month"],
            "start_day": season["start_day"],
            "end_month": season["end_month"],
            "end_day": season["end_day"],
        },
    ).mappings().all()

    return [dict(row) for row in result]

@router.get("/tables")
def get_tables(db: Session = Depends(get_db)):
    allowed_tables = [
        "amenity_season_spend",
        "dependent_addresses",
        "dependent_phones",
        "dependents",
        "folios",
        "interests",
        "member_addresses",
        "member_amenity_profile",
        "member_amenity_season_visits",
        "member_phones",
        "member_seasons",
        "members",
        "recent_activity",
        "reservation_guests",
        "rooms",
        "season_groups",
        "season_villa_bedroom_summary",
        "seasonal_visitors",
        "seasonal_visits",
        "seasons",
        "segment_amenities",
        "segment_spenders",
        "segment_visitors",
        "services",
        "statements",
    ]
    return allowed_tables

@router.get("/table/{table_name}")
def get_table_data(table_name: str, limit: int = 100,
                    offset: int = 0, db: Session = Depends(get_db)):
    allowed_tables = {
        "amenity_season_spend",
        "dependent_addresses",
        "dependent_phones",
        "dependents",
        "folios",
        "interests",
        "member_addresses",
        "member_amenity_profile",
        "member_amenity_season_visits",
        "member_phones",
        "member_seasons",
        "members",
        "recent_activity",
        "reservation_guests",
        "rooms",
        "season_groups",
        "season_villa_bedroom_summary",
        "seasonal_visitors",
        "seasonal_visits",
        "seasons",
        "segment_amenities",
        "segment_spenders",
        "segment_visitors",
        "services",
        "statements",
    }

    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table")

    result = db.execute(
        text(f"""
            SELECT *
            FROM {table_name}
            LIMIT :limit
            OFFSET :offset
        """),
        {"limit": limit, "offset": offset}
    ).mappings().all()

    return [dict(row) for row in result]

@router.get("/table/{table_name}/search")
def search_table(
    table_name: str,
    column: str,
    value: str,
    db: Session = Depends(get_db)
):
    allowed_tables = {
        "amenity_season_spend",
        "dependent_addresses",
        "dependent_phones",
        "dependents",
        "folios",
        "interests",
        "member_addresses",
        "member_amenity_profile",
        "member_amenity_season_visits",
        "member_phones",
        "member_seasons",
        "members",
        "recent_activity",
        "reservation_guests",
        "rooms",
        "season_groups",
        "season_villa_bedroom_summary",
        "seasonal_visitors",
        "seasonal_visits",
        "seasons",
        "segment_amenities",
        "segment_spenders",
        "segment_visitors",
        "services",
        "statements",
    }

    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table")

    result = db.execute(
        text(f"""
            SELECT *
            FROM {table_name}
            WHERE CAST({column} AS TEXT) ILIKE :value
            LIMIT 100
        """),
        {"value": f"%{value}%"}
    ).mappings().all()

    return [dict(row) for row in result]


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
                   COUNT(*) AS usage_count,
                   SUM(amount) AS amenity_spend
            FROM season_amenity_rows
            GROUP BY year, member_id, amenity
        ),
        ranked AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY year, member_id
                       ORDER BY amenity_spend DESC NULLS LAST
                   ) AS rn,
                   SUM(amenity_spend) OVER (PARTITION BY year, member_id) AS total_amenity_spend
            FROM per_member_amenity
        )
        SELECT year,
               member_id,
               member_full_name,
               amenity AS top_amenity,
               ROUND(amenity_spend::NUMERIC, 2) AS top_amenity_spend,
               ROUND(total_amenity_spend::NUMERIC, 2) AS total_amenity_spend
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
               COUNT(*)::INT AS usage_count,
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
                 amenity
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

    spend_raw = rows("""
        SELECT amenity,
               season,
               total_spend,
               transaction_count,
               avg_spend_per_visit,
               member_count
        FROM amenity_season_spend
        ORDER BY season, total_spend DESC
    """)

    profile_raw = rows("""
        SELECT member_id,
               member_full_name,
               top_amenity,
               top_amenity_spend,
               total_amenity_spend
        FROM member_amenity_profile
        ORDER BY total_amenity_spend DESC NULLS LAST
        LIMIT 1000
    """)

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
               usage_count,
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

# villa


def rows(db: Session, sql: str, params: dict | None = None):
    return [dict(row) for row in db.execute(text(sql), params or {}).mappings().all()]


def one(db: Session, sql: str, params: dict | None = None):
    return dict(db.execute(text(sql), params or {}).mappings().first() or {})


def date_filter_sql(alias="f"):
    return f"""
      AND (
        :year IS NULL
        OR (
          {alias}.check_in_date <= MAKE_DATE(:year, 12, 31)
          AND {alias}.check_out_date >= MAKE_DATE(:year, 1, 1)
        )
      )
      AND (
        :month IS NULL
        OR (
          :year IS NOT NULL
          AND {alias}.check_in_date <= (MAKE_DATE(:year, :month, 1) + INTERVAL '1 month - 1 day')::DATE
          AND {alias}.check_out_date >= MAKE_DATE(:year, :month, 1)
        )
        OR (
          :year IS NULL
          AND (
            EXTRACT(MONTH FROM {alias}.check_in_date)::INT = :month
            OR EXTRACT(MONTH FROM {alias}.check_out_date)::INT = :month
          )
        )
      )
    """


def filter_params(year: int | None, month: int | None):
    return {"year": year, "month": month}


def valid_booking_sql(alias="f"):
    return f"""
      {alias}.conf_code IS NOT NULL
      AND {alias}.check_in_date IS NOT NULL
      AND {alias}.check_out_date IS NOT NULL
      AND COALESCE(LOWER({alias}.reservation_status), '') NOT IN (
        'cancelled', 'canceled', 'no-show'
      )
    """




@router.get("/villa-stats")
def villa_stats(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, filter_params(year, month))

@router.get("/villa-monthly")
def villa_monthly(
    villa: str = Query(...),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
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
          TO_CHAR(check_in_date, 'Mon') AS month,
          EXTRACT(MONTH FROM check_in_date)::int AS month_num,
          COUNT(*) AS bookings,
          COALESCE(SUM(revenue), 0) AS revenue
        FROM booking_rows
        GROUP BY month, month_num
        ORDER BY month_num
    """, {"villa": villa, **filter_params(year, month)})

@router.get("/bookings-by-bedroom")
def bookings_by_bedroom(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, filter_params(year, month))


@router.get("/bedroom-bookings")
def bedroom_bookings(
    beds: int = Query(...),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, {"beds": beds, **filter_params(year, month)})

@router.get("/monthly-revenue")
def monthly_revenue(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, filter_params(year, month))

@router.get("/visits-tab-summary")
def visits_tab_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, filter_params(year, month))

@router.get("/villa-bookings")
def villa_bookings(
    villa: str = Query(...),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, {"villa": villa, **filter_params(year, month)})


@router.get("/booked-people")
def booked_people(
    kind: str = Query(pattern="^(members|guests)$"),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
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
    """, filter_params(year, month))

@router.get("/visits-rooms-dashboard")
def visits_rooms_dashboard(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    summary = visits_tab_summary(year=year, month=month, db=db)
    villa_stats_data = villa_stats(year=year, month=month, db=db)
    bedroom_stats = bookings_by_bedroom(year=year, month=month, db=db)
    monthly_revenue_data = monthly_revenue(year=year, month=month, db=db)

    selected_villa = villa
    if not selected_villa and villa_stats_data:
        selected_villa = villa_stats_data[0].get("villa_name")

    villa_monthly_data = (
        villa_monthly(
            villa=selected_villa,
            year=year,
            month=month,
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