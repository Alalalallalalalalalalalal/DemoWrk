# backend/postgres/analytics.py
from fastapi import APIRouter, Depends, Query
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


@router.get("/members-by-country")
def members_by_country(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT country, COUNT(*) AS total
        FROM member_addresses
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"country": row["country"], "total": row["total"]} for row in result]


@router.get("/members-by-state")
def members_by_state(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT state, COUNT(*) AS total
        FROM member_addresses
        WHERE state IS NOT NULL
        GROUP BY state
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"state": row["state"], "total": row["total"]} for row in result]


@router.get("/members-by-gender")
def members_by_gender(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT gender, COUNT(*) AS total
        FROM members
        WHERE gender IS NOT NULL
        GROUP BY gender
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"gender": row["gender"], "total": row["total"]} for row in result]


@router.get("/members-by-age-group")
def members_by_age_group(db: Session = Depends(get_db)):
    result = db.execute(text("""
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
        ORDER BY age_group;
    """)).mappings().all()

    return [{"age_group": row["age_group"], "total": row["total"]} for row in result]


@router.get("/members-by-type")
def members_by_type(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT member_type, COUNT(*) AS total
        FROM members
        WHERE member_type IS NOT NULL
        GROUP BY member_type
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"member_type": row["member_type"], "total": row["total"]} for row in result]


@router.get("/members-by-status")
def members_by_status(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT status, COUNT(*) AS total
        FROM members
        WHERE status IS NOT NULL
        GROUP BY status
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"status": row["status"], "total": row["total"]} for row in result]


@router.get("/bookings-by-room-type")
def bookings_by_room_type(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT room_type, COUNT(*) AS total
        FROM rooms
        WHERE room_type IS NOT NULL
        GROUP BY room_type
        ORDER BY total DESC;
    """)).mappings().all()

    return [{"room_type": row["room_type"], "total": row["total"]} for row in result]


@router.get("/bookings-by-month")
def bookings_by_month(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT 
            TO_CHAR(check_in_date, 'YYYY-MM') AS month,
            COUNT(*) AS total
        FROM rooms
        WHERE check_in_date IS NOT NULL
        GROUP BY month
        ORDER BY month;
    """)).mappings().all()

    return [{"month": row["month"], "total": row["total"]} for row in result]


@router.get("/average-length-of-stay")
def average_length_of_stay(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT ROUND(AVG(check_out_date - check_in_date), 2) AS average_nights
        FROM rooms
        WHERE check_in_date IS NOT NULL
        AND check_out_date IS NOT NULL;
    """)).mappings().first()

    return {"average_nights": float(row["average_nights"] or 0)}


@router.get("/total-recent-activity-spend")
def total_recent_activity_spend(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT SUM(amount) AS total
        FROM recent_activity
        WHERE amount IS NOT NULL;
    """)).mappings().first()

    return {"total": float(row["total"] or 0)}


@router.get("/spend-by-month")
def spend_by_month(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            TO_CHAR(activity_date, 'YYYY-MM') AS month,
            SUM(amount) AS total
        FROM recent_activity
        WHERE activity_date IS NOT NULL
        AND amount IS NOT NULL
        GROUP BY month
        ORDER BY month;
    """)).mappings().all()

    return [{"month": row["month"], "total": float(row["total"] or 0)} for row in result]


@router.get("/top-spend-descriptions")
def top_spend_descriptions(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT description, SUM(amount) AS total
        FROM recent_activity
        WHERE description IS NOT NULL
        AND amount IS NOT NULL
        GROUP BY description
        ORDER BY total DESC
        LIMIT 10;
    """)).mappings().all()

    return [{"description": row["description"], "total": float(row["total"] or 0)} for row in result]


@router.get("/total-amount-due")
def total_amount_due(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT COALESCE(SUM(amount_due), 0) AS total_amount_due
        FROM statements
        WHERE amount_due IS NOT NULL;
    """)).mappings().first()

    return {
        "total_amount_due": float(row["total_amount_due"] or 0)
    }


@router.get("/amount-due-by-period")
def amount_due_by_period(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT statement_period, SUM(amount_due) AS total
        FROM statements
        WHERE statement_period IS NOT NULL
        GROUP BY statement_period
        ORDER BY statement_period;
    """)).mappings().all()

    return [
        {
            "statement_period": row["statement_period"],
            "total": float(row["total"] or 0)
        }
        for row in result
    ]


@router.get("/dependents-by-age-group")
def dependents_by_age_group(db: Session = Depends(get_db)):
    result = db.execute(text("""
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
        ORDER BY age_group;
    """)).mappings().all()

    return [{"age_group": row["age_group"], "total": row["total"]} for row in result]


@router.get("/dependents-per-member")
def dependents_per_member(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            member_number,
            COUNT(*) AS total_dependents
        FROM dependents
        GROUP BY member_number
        ORDER BY total_dependents DESC
        LIMIT 20;
    """)).mappings().all()

    return [
        {
            "member_number": row["member_number"],
            "total_dependents": row["total_dependents"]
        }
        for row in result
    ]

@router.get("/total-dependents")
def total_dependents(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT COUNT(*) AS total_dependents
        FROM dependents;
    """)).mappings().first()

    return {"total_dependents": row["total_dependents"]}

@router.get("/new-members-per-year")
def new_members_per_year(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            EXTRACT(YEAR FROM since_date)::INT AS year,
            COUNT(*) AS total
        FROM members
        WHERE since_date IS NOT NULL
        AND EXTRACT(YEAR FROM since_date) >= 2018
        GROUP BY year
        ORDER BY year;
    """)).mappings().all()

    return [{"year": row["year"], "total": row["total"]} for row in result]

@router.get("/most-used-room-types")
def most_used_room_types(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT room_type, COUNT(*) AS total
        FROM rooms
        WHERE room_type IS NOT NULL
        GROUP BY room_type
        ORDER BY total DESC
        LIMIT 10;
    """)).mappings().all()

    return [{"room_type": row["room_type"], "total": row["total"]} for row in result]

@router.get("/least-used-room-types")
def least_used_room_types(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT room_type, COUNT(*) AS total
        FROM rooms
        WHERE room_type IS NOT NULL
        GROUP BY room_type
        ORDER BY total ASC
        LIMIT 10;
    """)).mappings().all()

    return [{"room_type": row["room_type"], "total": row["total"]} for row in result]

@router.get("/average-tenure")
def average_tenure(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT
            ROUND(
                AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, since_date))),
                2
            ) AS average_tenure_years
        FROM members
        WHERE since_date IS NOT NULL;
    """)).mappings().first()

    return {
        "average_tenure_years": float(row["average_tenure_years"] or 0)
    }

@router.get("/members-by-marital-status")
def members_by_marital_status(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT marital_status, COUNT(*) AS total
        FROM members
        WHERE marital_status IS NOT NULL
        GROUP BY marital_status
        ORDER BY total DESC;
    """)).mappings().all()

    return [
        {
            "marital_status": row["marital_status"],
            "total": row["total"]
        }
        for row in result
    ]

@router.get("/currently-checked-in-members")
def currently_checked_in_members(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            r.member_number,
            m.member_full_name,
            r.confirmation_code,
            r.room_type,
            r.room_number,
            r.check_in_date,
            r.check_out_date,
            r.status
        FROM rooms r
        JOIN members m
        ON r.member_number = m.member_number
        WHERE r.check_in_date <= CURRENT_DATE
        AND r.check_out_date > CURRENT_DATE
        AND (
            r.status IS NULL
            OR LOWER(r.status) NOT IN ('cancelled', 'canceled')
        )
        ORDER BY r.check_in_date DESC;
    """)).mappings().all()

    return [
        {
            "member_number": row["member_number"],
            "member_full_name": row["member_full_name"],
            "confirmation_code": row["confirmation_code"],
            "room_type": row["room_type"],
            "room_number": row["room_number"],
            "check_in_date": row["check_in_date"],
            "check_out_date": row["check_out_date"],
            "status": row["status"]
        }
        for row in result
    ]

@router.get("/live-in-house-count")
def live_in_house_count(db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT COUNT(*) AS total_in_house
        FROM rooms
        WHERE check_in_date <= CURRENT_DATE
        AND check_out_date > CURRENT_DATE
        AND (
            status IS NULL
            OR LOWER(status) NOT IN ('cancelled', 'canceled')
        );
    """)).mappings().first()

    return {"total_in_house": row["total_in_house"]}

@router.get("/live-in-house-roster")
def live_in_house_roster(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            r.member_number,
            m.member_full_name,
            m.member_type,
            r.confirmation_code,
            r.room_type,
            r.room_number,
            r.check_in_date,
            r.check_out_date,
            r.status
        FROM rooms r
        JOIN members m
        ON r.member_number = m.member_number
        WHERE r.check_in_date <= CURRENT_DATE
        AND r.check_out_date > CURRENT_DATE
        AND (
            r.status IS NULL
            OR LOWER(r.status) NOT IN ('cancelled', 'canceled')
        )
        ORDER BY r.room_number;
    """)).mappings().all()

    return [
        {
            "member_number": row["member_number"],
            "member_full_name": row["member_full_name"],
            "member_type": row["member_type"],
            "confirmation_code": row["confirmation_code"],
            "room_type": row["room_type"],
            "room_number": row["room_number"],
            "check_in_date": row["check_in_date"],
            "check_out_date": row["check_out_date"],
            "status": row["status"]
        }
        for row in result
    ]

@router.get("/member-directory")
def member_directory(db: Session = Depends(get_db)):
    result = db.execute(text("""
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
        LEFT JOIN member_addresses a
        ON m.member_number = a.member_number
        LEFT JOIN (
            SELECT member_number, COUNT(*) AS total_dependents
            FROM dependents
            GROUP BY member_number
        ) d
        ON m.member_number = d.member_number
        LEFT JOIN (
            SELECT member_number, SUM(amount_due) AS amount_due
            FROM statements
            GROUP BY member_number
        ) s
        ON m.member_number = s.member_number
        LEFT JOIN (
            SELECT DISTINCT member_number
            FROM rooms
            WHERE check_in_date <= CURRENT_DATE
            AND check_out_date > CURRENT_DATE
            AND (
                status IS NULL
                OR LOWER(status) NOT IN ('cancelled', 'canceled')
            )
        ) r
        ON m.member_number = r.member_number
        ORDER BY m.member_name
        LIMIT 500;
    """)).mappings().all()

    return [dict(row) for row in result]


# ═══════════════════════════════════════════════════════════
# ML INSIGHT ENDPOINTS
# ═══════════════════════════════════════════════════════════
# These read from tables that ml_insights.build_insights() writes.
# The scheduler / pipeline should run build_insights() before these
# endpoints are called.  All endpoints degrade gracefully (return [])
# if the tables haven't been created yet.
 
# ───────────────────────────────────────────────────────────
# Customer Segments
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/member-segments")
def ml_member_segments(db: Session = Depends(get_db)):
    """
    Full per-member segment table.
    Includes: segment_name, active/inactive flag, spend, visits,
    avg stay, favourite amenity, and campaign assignment.
    """
    result = db.execute(text("""
        SELECT
            ms.member_number,
            m.member_full_name,
            ms.status,
            ms.member_type,
            ms.is_active,
            ms.segment_name,
            ms.total_spend,
            ms.avg_spend,
            ms.visit_count,
            ms.avg_stay,
            ms.days_since_last_visit,
            ms.campaign
        FROM member_segments ms
        LEFT JOIN members m ON ms.member_number = m.member_number
        ORDER BY ms.total_spend DESC NULLS LAST;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
@router.get("/ml/segment-summary")
def ml_segment_summary(db: Session = Depends(get_db)):
    """
    Aggregated count, average spend and average visits per segment.
    Ideal for a summary chart or dashboard card.
    """
    result = db.execute(text("""
        SELECT
            segment_name,
            COUNT(*)                             AS member_count,
            ROUND(AVG(total_spend)::NUMERIC, 2) AS avg_total_spend,
            ROUND(AVG(visit_count)::NUMERIC, 2) AS avg_visits,
            ROUND(AVG(avg_stay)::NUMERIC, 2)    AS avg_stay_nights,
            SUM(CASE WHEN is_active THEN 1 ELSE 0 END)      AS active_count,
            SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END)  AS inactive_count
        FROM member_segments
        GROUP BY segment_name
        ORDER BY member_count DESC;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
 
# ───────────────────────────────────────────────────────────
# Amenity Usage / Adoption
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/amenity-adoption")
def ml_amenity_adoption(db: Session = Depends(get_db)):
    """
    How many distinct members used each amenity at least once.
    """
    result = db.execute(text("""
        SELECT amenity, members_using
        FROM amenity_adoption
        ORDER BY members_using DESC;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
@router.get("/ml/member-amenity-usage")
def ml_member_amenity_usage(db: Session = Depends(get_db)):
    """
    Per-member × per-amenity usage count and spend.
    Optionally filter by member_number via query param.
    """
    result = db.execute(text("""
        SELECT
            mau.member_id   AS member_number,
            m.member_full_name,
            mau.amenity,
            mau.usage_count,
            mau.total_spend
        FROM member_amenity_usage mau
        LEFT JOIN members m ON mau.member_id = m.member_number
        ORDER BY mau.total_spend DESC;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
@router.get("/ml/member-amenity-segments")
def member_amenity_segments(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT *
        FROM member_amenity_segments
        ORDER BY total_amenity_visits DESC
    """)).mappings().all()

    return [dict(row) for row in result]
# ───────────────────────────────────────────────────────────
# Seasonal Behaviour
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/seasonal-visits")
def ml_seasonal_visits(db: Session = Depends(get_db)):
    """
    Aggregated check-in visits and average stay per calendar month
    across all members.
    """
    result = db.execute(text("""
        SELECT month, visits, avg_stay
        FROM seasonal_visits
        ORDER BY month;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
# ───────────────────────────────────────────────────────────
# Amenity Revenue
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/amenity-revenue")
def ml_amenity_revenue(db: Session = Depends(get_db)):
    """
    Total revenue and transaction count per amenity, ranked by revenue.
    Answers: which amenity makes the most money.
    """
    result = db.execute(text("""
        SELECT amenity, revenue, transactions
        FROM amenity_revenue
        ORDER BY revenue DESC;
    """)).mappings().all()
    return [
        {
            "amenity":      row["amenity"],
            "revenue":      float(row["revenue"] or 0),
            "transactions": int(row["transactions"] or 0),
        }
        for row in result
    ]
 
 
# ───────────────────────────────────────────────────────────
# Airport / Ground Transfer Users
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/airport-transfer-users")
def ml_airport_transfer_users(db: Session = Depends(get_db), limit: int = 20):
    """
    Top members by ground-transportation booking count.
    Default: top 20.  Pass ?limit=N to change.
    """
    result = db.execute(text("""
        SELECT
            atu.member_id  AS member_number,
            m.member_full_name,
            atu.transfers,
            atu.total_spend
        FROM airport_transfer_users atu
        LEFT JOIN members m ON atu.member_id = m.member_number
        ORDER BY atu.transfers DESC
        LIMIT :limit;
    """), {"limit": limit}).mappings().all()
    return [
        {
            "member_number":    row["member_number"],
            "member_full_name": row["member_full_name"],
            "transfers":        int(row["transfers"] or 0),
            "total_spend":      float(row["total_spend"] or 0),
        }
        for row in result
    ]
 
 
# ───────────────────────────────────────────────────────────
# Targeted Marketing
# ───────────────────────────────────────────────────────────
 
@router.get("/ml/marketing-targets")
def ml_marketing_targets(db: Session = Depends(get_db)):
    """
    Full marketing target list: member, segment, and assigned campaign.
    """
    result = db.execute(text("""
        SELECT
            mt.member_number,
            m.member_full_name,
            m.email,
            mt.segment_name,
            mt.campaign
        FROM marketing_targets mt
        LEFT JOIN members m ON mt.member_number = m.member_number
        ORDER BY mt.segment_name, m.member_full_name;
    """)).mappings().all()
    return [dict(row) for row in result]
 
 
# @router.get("/ml/marketing-targets-by-campaign")
# def ml_marketing_targets_by_campaign(db: Session = Depends(get_db)):
#     """
#     Member count per campaign — useful for planning send volumes.
#     """
#     result = db.execute(text("""
#         SELECT campaign, COUNT(*) AS member_count
#         FROM marketing_targets
#         GROUP BY campaign
#         ORDER BY member_count DESC;
#     """)).mappings().all()
#     return [{"campaign": row["campaign"], "member_count": row["member_count"]} for row in result]

@router.get("/ml/marketing-targets-by-individual-campaign")
def ml_marketing_targets_by_individual_campaign(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT
            TRIM(campaign_tag) AS campaign,
            COUNT(*) AS member_count
        FROM marketing_targets,
        LATERAL unnest(string_to_array(campaign, ' | ')) AS campaign_tag
        GROUP BY campaign_tag
        ORDER BY member_count DESC;
    """)).mappings().all()
    return [{"campaign": row["campaign"], "member_count": row["member_count"]} for row in result]

# insights and season

@router.get("/ml/insights")
def ml_insights(db: Session = Depends(get_db)):
    def rows(sql, params=None):
        return [dict(r) for r in db.execute(text(sql), params or {}).mappings().all()]

    return {
        "memberSegments": rows("""
            SELECT
                ms.member_number,
                m.member_full_name,
                ms.status,
                ms.member_type,
                ms.is_active,
                ms.segment_name,
                ms.total_spend,
                ms.avg_spend,
                ms.visit_count,
                ms.avg_stay,
                ms.days_since_last_visit,
                ms.campaign
            FROM member_segments ms
            LEFT JOIN members m ON ms.member_number = m.member_number
            ORDER BY ms.total_spend DESC NULLS LAST
            LIMIT 500;
        """),

        "segmentSummary": rows("""
            SELECT
                segment_name,
                COUNT(*) AS member_count,
                ROUND(AVG(total_spend)::NUMERIC, 2) AS avg_total_spend,
                ROUND(AVG(visit_count)::NUMERIC, 2) AS avg_visits,
                ROUND(AVG(avg_stay)::NUMERIC, 2) AS avg_stay_nights,
                SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END) AS inactive_count
            FROM member_segments
            GROUP BY segment_name
            ORDER BY member_count DESC;
        """),

        "amenityAdoption": rows("""
            SELECT amenity, members_using
            FROM amenity_adoption
            ORDER BY members_using DESC;
        """),

        "amenitySegments": rows("""
            SELECT *
            FROM member_amenity_segments
            ORDER BY total_amenity_visits DESC
            LIMIT 500;
        """),

        "seasonalVisits": rows("""
            SELECT month, visits, avg_stay
            FROM seasonal_visits
            ORDER BY month;
        """),

        "amenityRevenue": rows("""
            SELECT amenity, revenue, transactions
            FROM amenity_revenue
            ORDER BY revenue DESC;
        """),

      

        "marketingTargetsByCampaign": rows("""
            SELECT campaign, COUNT(*) AS member_count
            FROM marketing_targets
            GROUP BY campaign
            ORDER BY member_count DESC;
        """),

        "memberAmenityUsage": rows("""
            SELECT
                mau.member_id AS member_number,
                m.member_full_name,
                mau.amenity,
                mau.usage_count,
                mau.total_spend
            FROM member_amenity_usage mau
            LEFT JOIN members m ON mau.member_id = m.member_number
            ORDER BY mau.total_spend DESC
            LIMIT 2000;
        """),
    }


@router.get("/ml/seasonal-visit-details")
def ml_seasonal_visit_details(season: str, db: Session = Depends(get_db)):
    season_months = {
        "Spring":      "(1,2,3)",
        "Summer":      "(4,5,6,7)",
        "Late Summer": "(8)",
        "Autumn":      "(9,10)",
        "Winter":      "(11,12)",
    }
    months = season_months.get(season, "(1)")
    result = db.execute(text(f"""
        SELECT
            r.member_number,
            m.member_full_name,
            m.member_type,
            m.age,
            a.country,
            r.check_in_date,
            r.check_out_date,
            (r.check_out_date - r.check_in_date) AS length_of_stay,
            r.room_type
        FROM rooms r
        JOIN members m ON r.member_number = m.member_number
        LEFT JOIN member_addresses a ON m.member_number = a.member_number
        WHERE EXTRACT(MONTH FROM r.check_in_date) IN {months}
          AND r.check_in_date IS NOT NULL
        ORDER BY r.check_in_date DESC;
    """)).mappings().all()
    return [dict(row) for row in result]


@router.get("/ml/season-groups")
def get_season_groups(db: Session = Depends(get_db)):
    """Returns all season filter groups with their seasons."""
    result = db.execute(text("""
        SELECT sg.id, sg.group_name, sg.group_type,
               s.id AS season_id, s.season_name, s.start_month,
               s.start_day, s.end_month, s.end_day, s.is_active
        FROM season_groups sg
        JOIN seasons s ON s.group_id = sg.id
        ORDER BY sg.group_type, sg.id, s.start_month, s.start_day;
    """)).mappings().all()
    groups = {}
    for row in result:
        gid = row["id"]
        if gid not in groups:
            groups[gid] = {"id": gid, "group_name": row["group_name"],
                           "group_type": row["group_type"], "seasons": []}
        groups[gid]["seasons"].append({
            "id": row["season_id"], "season_name": row["season_name"],
            "start_month": row["start_month"], "start_day": row["start_day"],
            "end_month": row["end_month"], "end_day": row["end_day"],
            "is_active": row["is_active"],
        })
    return list(groups.values())


@router.post("/ml/season-groups")
def create_season_group(body: dict, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO season_groups (group_name, group_type)
        VALUES (:name, 'custom') RETURNING id;
    """), {"name": body["group_name"]}).mappings().first()
    db.commit()
    return {"id": row["id"], "group_name": body["group_name"], "group_type": "custom", "seasons": []}


@router.patch("/ml/seasons/{season_id}")
def update_season(season_id: int, body: dict, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE seasons SET
            season_name = COALESCE(:name, season_name),
            start_month = COALESCE(:start_month, start_month),
            start_day   = COALESCE(:start_day, start_day),
            end_month   = COALESCE(:end_month, end_month),
            end_day     = COALESCE(:end_day, end_day),
            is_active   = COALESCE(:is_active, is_active)
        WHERE id = :id;
    """), {
        "id": season_id,
        "name":        body.get("season_name"),
        "start_month": body.get("start_month"),
        "start_day":   body.get("start_day"),
        "end_month":   body.get("end_month"),
        "end_day":     body.get("end_day"),
        "is_active":   body.get("is_active"),
    })
    db.commit()
    return {"ok": True}


@router.post("/ml/seasons")
def add_season_to_group(body: dict, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO seasons
            (season_name, start_month, start_day, end_month, end_day, is_active, group_id)
        VALUES (:name, :start_month, :start_day, :end_month, :end_day, TRUE, :group_id)
        RETURNING id;
    """), body).mappings().first()
    db.commit()
    return {"id": row["id"], **body}