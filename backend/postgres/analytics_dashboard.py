# backend/postgres/analytics_dashboard.py
"""
Legacy all-in-one dashboard endpoint.

This is the original `/dashboard-summary` payload that powers the main
overview dashboard widgets (members by country/state/gender/age, bookings,
spend, dependents, directory listing, etc). It's kept as a single big query
set (rather than split into the newer filterable `/demographics-summary`
style endpoints) for backwards compatibility with the existing frontend —
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from .analytics_shared import get_db

router = APIRouter()


@router.get("/dashboard-summary")
def dashboard_summary(db: Session = Depends(get_db)):
    def rows(sql: str):
        return [dict(row) for row in db.execute(text(sql)).mappings().all()]

    def one(sql: str):
        return dict(db.execute(text(sql)).mappings().first() or {})

    return {
        "membersByCountry": rows("""
            SELECT
                TRIM(a.country) AS country,
                COUNT(DISTINCT m.member_number) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Member'
                )::int AS member_total,
                COUNT(DISTINCT m.member_number) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Guest'
                )::int AS guest_total,
                COUNT(DISTINCT m.member_number)::int AS total
            FROM member_addresses a
            JOIN members m
              ON m.member_number = a.member_number
            WHERE a.country IS NOT NULL
              AND TRIM(a.country) <> ''
            GROUP BY TRIM(a.country)
            ORDER BY total DESC
        """),

        "membersByState": rows("""
            SELECT
                UPPER(TRIM(a.state)) AS state,
                COUNT(DISTINCT m.member_number) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Member'
                )::int AS member_total,
                COUNT(DISTINCT m.member_number) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Guest'
                )::int AS guest_total,
                COUNT(DISTINCT m.member_number)::int AS total
            FROM member_addresses a
            JOIN members m
              ON m.member_number = a.member_number
            WHERE UPPER(TRIM(a.state)) IN (
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
            GROUP BY UPPER(TRIM(a.state))
            ORDER BY total DESC
        """),

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