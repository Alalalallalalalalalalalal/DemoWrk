from fastapi import APIRouter, Depends
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
        SELECT SUM(amount_due) AS total
        FROM statements
        WHERE amount_due IS NOT NULL;
    """)).mappings().first()

    return {"total_amount_due": float(row["total"] or 0)}


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