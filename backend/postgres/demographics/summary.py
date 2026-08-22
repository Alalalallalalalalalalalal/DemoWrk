# backend/postgres/demographics/summary.py
"""
Demographics summary: the filterable `/demographics-summary` endpoint (the
modern, date-filterable counterpart to dashboard.py's static membersByX
queries).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date

from ..analytics_shared import (
    get_db,
    rows,
    one,
    demographic_date_filter_sql,
    filter_params,
)

router = APIRouter()


@router.get("/demographics-summary")
def demographics_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if month is not None and not 1 <= month <= 12:
        raise HTTPException(
            status_code=400,
            detail="month must be between 1 and 12",
        )

    if (
        start_date is not None
        and end_date is not None
        and start_date > end_date
    ):
        raise HTTPException(
            status_code=400,
            detail="start_date cannot be after end_date",
        )

    if (
        (start_date is None) !=
        (end_date is None)
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "start_date and end_date "
                "must be supplied together"
            ),
        )

    params = filter_params(
        year=year,
        month=month,
        date=date,
        start_date=start_date,
        end_date=end_date,
    )

    member_filter = demographic_date_filter_sql(
        alias="m",
        column="since_date",
    )

    member_state_rows = rows(
        db,
        f"""
        SELECT
            UPPER(TRIM(a.state)) AS state,
            COUNT(DISTINCT m.member_number) FILTER (
                WHERE TRIM(m.member_or_guest) = 'Member'
            )::int AS member_total,
            COUNT(DISTINCT m.member_number) FILTER (
                WHERE TRIM(m.member_or_guest) = 'Guest'
            )::int AS guest_total,
            COUNT(DISTINCT m.member_number)::int AS total
        FROM members m
        JOIN member_addresses a
          ON a.member_number = m.member_number
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
          {member_filter}
        GROUP BY UPPER(TRIM(a.state))
        ORDER BY total DESC
        """,
        params,
    )

    member_country_rows = rows(
        db,
        f"""
        SELECT
            TRIM(a.country) AS country,
            COUNT(DISTINCT m.member_number) FILTER (
                WHERE TRIM(m.member_or_guest) = 'Member'
            )::int AS member_total,
            COUNT(DISTINCT m.member_number) FILTER (
                WHERE TRIM(m.member_or_guest) = 'Guest'
            )::int AS guest_total,
            COUNT(DISTINCT m.member_number)::int AS total
        FROM members m
        JOIN member_addresses a
          ON a.member_number = m.member_number
        WHERE a.country IS NOT NULL
          AND TRIM(a.country) <> ''
          {member_filter}
        GROUP BY TRIM(a.country)
        ORDER BY total DESC
        """,
        params,
    )

    account_total_row = one(
        db,
        f"""
        SELECT
            COUNT(DISTINCT m.member_number)::int AS total
        FROM members m
        WHERE 1 = 1
          {member_filter}
        """,
        params,
    )
    account_total = int(account_total_row.get("total") or 0)

    top5_states = member_state_rows[:5]
    top5_states_total = sum(r["total"] for r in top5_states)
    top5_states_pct = round(
        100.0 * top5_states_total / max(account_total, 1), 1
    )

    top5_countries = member_country_rows[:5]
    top5_countries_total = sum(r["total"] for r in top5_countries)
    top5_countries_pct = round(
        100.0 * top5_countries_total / max(account_total, 1), 1
    )

    accounts_with_country = sum(
        r["total"] for r in member_country_rows
    )
    countries_represented = len(member_country_rows)

    domestic_row = next(
        (
            r for r in member_country_rows
            if r["country"] == "United States"
        ),
        None,
    )
    domestic_accounts = domestic_row["total"] if domestic_row else 0
    domestic_members = domestic_row["member_total"] if domestic_row else 0
    domestic_guests = domestic_row["guest_total"] if domestic_row else 0
    domestic_pct = round(
        100.0 * domestic_accounts / max(accounts_with_country, 1), 1
    )

    international_rows = [
        r for r in member_country_rows
        if r["country"] != "United States"
    ]
    international_accounts = sum(r["total"] for r in international_rows)
    international_members = sum(
        r["member_total"] for r in international_rows
    )
    international_guests = sum(
        r["guest_total"] for r in international_rows
    )
    international_country_count = sum(
        1 for r in international_rows if r["total"] > 0
    )
    international_pct = round(
        100.0 * international_accounts
        / max(accounts_with_country, 1),
        1,
    )

    geographic_concentration = {
        "total_accounts": account_total,

        "top5_states_total": top5_states_total,
        "top5_states_pct": top5_states_pct,
        "top5_states": top5_states,

        "top5_countries_total": top5_countries_total,
        "top5_countries_pct": top5_countries_pct,
        "top5_countries": top5_countries,

        "domestic_accounts": domestic_accounts,
        "domestic_members": domestic_members,
        "domestic_guests": domestic_guests,
        "domestic_pct": domestic_pct,

        "international_accounts": international_accounts,
        "international_members": international_members,
        "international_guests": international_guests,
        "international_country_count": international_country_count,
        "international_pct": international_pct,

        "accounts_with_country": accounts_with_country,
        "countries_represented": countries_represented,
    }

    return {
        "membersByCountry": member_country_rows,

        "membersByState": member_state_rows,

        "membersByGender": rows(
            db,
            f"""
            SELECT
                TRIM(m.gender) AS gender,
                COUNT(*)::int AS total
            FROM members m
            WHERE m.gender IS NOT NULL
              AND TRIM(m.gender) <> ''
              {member_filter}
            GROUP BY TRIM(m.gender)
            ORDER BY total DESC
            """,
            params,
        ),

        "membersByAgeGroup": rows(
            db,
            f"""
            SELECT
                age_group,
                COUNT(*)::int AS total
            FROM (
                SELECT
                    CASE
                        WHEN m.age < 18
                            THEN 'Under 18'
                        WHEN m.age BETWEEN 18 AND 25
                            THEN '18-25'
                        WHEN m.age BETWEEN 26 AND 35
                            THEN '26-35'
                        WHEN m.age BETWEEN 36 AND 50
                            THEN '36-50'
                        WHEN m.age BETWEEN 51 AND 65
                            THEN '51-65'
                        ELSE '66+'
                    END AS age_group
                FROM members m
                WHERE m.age IS NOT NULL
                {member_filter}
            ) AS grouped_members
            GROUP BY age_group
            ORDER BY
                CASE age_group
                    WHEN 'Under 18' THEN 1
                    WHEN '18-25' THEN 2
                    WHEN '26-35' THEN 3
                    WHEN '36-50' THEN 4
                    WHEN '51-65' THEN 5
                    ELSE 6
                END
            """,
            params,
        ),

        "accountsByType": rows(
            db,
            f"""
            SELECT
                TRIM(m.member_type) AS member_type,
                TRIM(m.member_or_guest)
                    AS account_category,

                COUNT(*) FILTER (
                    WHERE TRIM(m.status) = 'Active'
                )::int AS active_total,

                COUNT(*) FILTER (
                    WHERE TRIM(m.status) IS DISTINCT FROM 'Active'
                )::int AS inactive_total,

                COUNT(*)::int AS total
            FROM members m
            WHERE m.member_type IS NOT NULL
              AND TRIM(m.member_type) <> ''
              AND TRIM(m.member_or_guest)
                  IN ('Member', 'Guest')
              {member_filter}
            GROUP BY
                TRIM(m.member_type),
                TRIM(m.member_or_guest)
            ORDER BY total DESC
            """,
            params,
        ),

        "membersByStatus": rows(
            db,
            f"""
            SELECT
                TRIM(m.status) AS status,

                COUNT(*) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Member'
                )::int AS members,

                COUNT(*) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Guest'
                )::int AS guests,

                COUNT(*)::int AS total
            FROM members m
            WHERE m.status IS NOT NULL
              AND TRIM(m.status) <> ''
              {member_filter}
            GROUP BY TRIM(m.status)
            ORDER BY total DESC
            """,
            params,
        ),

        "membersByMaritalStatus": rows(
            db,
            f"""
            SELECT
                TRIM(m.marital_status)
                    AS marital_status,
                COUNT(*)::int AS total
            FROM members m
            WHERE m.marital_status IS NOT NULL
              AND TRIM(m.marital_status) <> ''
              {member_filter}
            GROUP BY TRIM(m.marital_status)
            ORDER BY total DESC
            """,
            params,
        ),

        "newMembersPerYear": rows(
            db,
            f"""
            SELECT
                EXTRACT(
                    YEAR FROM m.since_date
                )::int AS year,

                COUNT(*) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Member'
                )::int AS members,

                COUNT(*) FILTER (
                    WHERE TRIM(m.member_or_guest) = 'Guest'
                )::int AS guests,

                COUNT(*)::int AS total
            FROM members m
            WHERE m.since_date IS NOT NULL
              AND EXTRACT(
                    YEAR FROM m.since_date
                  ) >= 2018
              AND TRIM(m.member_or_guest)
                  IN ('Member', 'Guest')
              {member_filter}
            GROUP BY year
            ORDER BY year
            """,
            params,
        ),

        "newVsRepeatVisitors": rows(
            db,
            """
            WITH new_accounts AS (
                SELECT
                    m.member_number,
                    EXTRACT(
                        YEAR FROM m.since_date
                    )::int AS year,

                    TRIM(m.member_or_guest)
                        AS account_category,

                    'New'::text AS account_status

                FROM members m

                WHERE m.since_date IS NOT NULL
                AND TRIM(m.member_or_guest)
                    IN ('Member', 'Guest')
            ),

            repeat_booking_accounts AS (
                SELECT DISTINCT
                    r.member_number,

                    EXTRACT(
                        YEAR FROM r.check_in_date
                    )::int AS year,

                    TRIM(m.member_or_guest)
                        AS account_category,

                    'Repeat'::text AS account_status

                FROM rooms r

                JOIN members m
                ON m.member_number =
                    r.member_number

                WHERE r.member_number IS NOT NULL
                AND r.check_in_date IS NOT NULL
                AND m.since_date IS NOT NULL
                AND TRIM(m.member_or_guest)
                    IN ('Member', 'Guest')

                AND r.check_in_date::date >
                    m.since_date::date

                AND EXTRACT(
                        YEAR FROM r.check_in_date
                    ) >
                    EXTRACT(
                        YEAR FROM m.since_date
                    )
            ),

            combined_accounts AS (
                SELECT
                    member_number,
                    year,
                    account_category,
                    account_status
                FROM new_accounts

                UNION ALL

                SELECT
                    member_number,
                    year,
                    account_category,
                    account_status
                FROM repeat_booking_accounts
            )

            SELECT
                year,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                )::int AS total_new,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                )::int AS total_repeat,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                    AND account_category = 'Member'
                )::int AS new_members,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                    AND account_category = 'Member'
                )::int AS repeat_members,

                COUNT(*) FILTER (
                    WHERE account_status = 'New'
                    AND account_category = 'Guest'
                )::int AS new_guests,

                COUNT(*) FILTER (
                    WHERE account_status = 'Repeat'
                    AND account_category = 'Guest'
                )::int AS repeat_guests,

                COUNT(*)::int AS total_accounts

            FROM combined_accounts

            GROUP BY year
            ORDER BY year
            """,
        ),

        "dependentsByAgeGroup": rows(
            db,
            f"""
            SELECT
                age_group,
                COUNT(*)::int AS total
            FROM (
                SELECT
                    CASE
                        WHEN d.age < 18
                            THEN 'Under 18'
                        WHEN d.age BETWEEN 18 AND 25
                            THEN '18-25'
                        WHEN d.age BETWEEN 26 AND 35
                            THEN '26-35'
                        WHEN d.age BETWEEN 36 AND 50
                            THEN '36-50'
                        ELSE '51+'
                    END AS age_group
                FROM dependents d
                JOIN members m
                ON m.member_number = d.member_number
                WHERE d.age IS NOT NULL
                {member_filter}
            ) AS grouped_dependents
            GROUP BY age_group
            ORDER BY
                CASE age_group
                    WHEN 'Under 18' THEN 1
                    WHEN '18-25' THEN 2
                    WHEN '26-35' THEN 3
                    WHEN '36-50' THEN 4
                    ELSE 5
                END
            """,
            params,
        ),

        "dependentsPerMember": rows(
            db,
            f"""
            SELECT
                m.member_number,
                COUNT(
                    d.dependent_number
                )::int AS total_dependents
            FROM members m
            JOIN dependents d
              ON d.member_number = m.member_number
            WHERE 1 = 1
              {member_filter}
            GROUP BY m.member_number
            ORDER BY total_dependents DESC
            LIMIT 20
            """,
            params,
        ),

        "dependentsPerHousehold": rows(
            db,
            f"""
            WITH household_counts AS (
                SELECT
                    m.member_number,
                    COUNT(
                        d.dependent_number
                    )::int AS dependent_count
                FROM members m
                LEFT JOIN dependents d
                  ON d.member_number = m.member_number
                WHERE LOWER(
                    TRIM(m.member_or_guest)
                ) = 'member'
                  {member_filter}
                GROUP BY m.member_number
            ),
            grouped_households AS (
                SELECT
                    CASE
                        WHEN dependent_count = 0
                            THEN '0 Dependents'
                        WHEN dependent_count = 1
                            THEN '1 Dependent'
                        WHEN dependent_count = 2
                            THEN '2 Dependents'
                        WHEN dependent_count = 3
                            THEN '3 Dependents'
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
            """,
            params,
        ),

        "totalDependents": one(
            db,
            f"""
            SELECT
                COUNT(
                    d.dependent_number
                )::int AS total_dependents
            FROM dependents d
            JOIN members m
              ON m.member_number = d.member_number
            WHERE 1 = 1
              {member_filter}
            """,
            params,
        ),

        # ── Demographic data completeness ──────────────────
        "dataCompleteness": one(
            db,
            f"""
            SELECT
                COUNT(*)::int AS total_accounts,

                COUNT(*) FILTER (
                    WHERE m.age IS NULL
                )::int AS missing_age,

                COUNT(*) FILTER (
                    WHERE m.gender IS NULL
                       OR TRIM(m.gender) = ''
                )::int AS missing_gender,

                COUNT(*) FILTER (
                    WHERE m.marital_status IS NULL
                       OR TRIM(m.marital_status) = ''
                )::int AS missing_marital_status,

                COUNT(*) FILTER (
                    WHERE m.since_date IS NULL
                )::int AS missing_since_date,

                COUNT(*) FILTER (
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM member_addresses a
                        WHERE a.member_number = m.member_number
                          AND a.country IS NOT NULL
                          AND TRIM(a.country) <> ''
                    )
                )::int AS missing_country

            FROM members m
            WHERE 1 = 1
              {member_filter}
            """,
            params,
        ),

        # ── Household composition summary ───────────────────
        "householdComposition": one(
            db,
            f"""
            WITH household_counts AS (
                SELECT
                    m.member_number,
                    COUNT(
                        d.dependent_number
                    )::int AS dependent_count
                FROM members m
                LEFT JOIN dependents d
                  ON d.member_number = m.member_number
                WHERE LOWER(
                    TRIM(m.member_or_guest)
                ) = 'member'
                  {member_filter}
                GROUP BY m.member_number
            )
            SELECT
                COUNT(*) FILTER (
                    WHERE dependent_count = 0
                )::int AS accounts_no_dependents,

                COUNT(*) FILTER (
                    WHERE dependent_count > 0
                )::int AS accounts_with_dependents,

                ROUND(
                    AVG(dependent_count), 2
                )::float AS avg_dependents_per_household,

                COALESCE(
                    MAX(dependent_count), 0
                )::int AS largest_household_size

            FROM household_counts
            """,
            params,
        ),

        # ── Geographic concentration summary ─────────────────
        "geographicConcentration": geographic_concentration,
    }
