# backend/postgres/analytics_demographics.py
"""
Demographics analytics: the filterable `/demographics-summary` (the modern,
date-filterable counterpart to dashboard.py's static membersByX queries),
new-vs-repeat visitor classification, and the various account drilldown
endpoints (by state, by account category, by arbitrary dimension, by
new/repeat visitor status).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta

from .analytics_shared import (
    get_db,
    rows,
    one,
    demographic_date_filter_sql,
    filter_params,
    US_STATE_CODES,
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

    return {
        "membersByCountry": rows(
            db,
            f"""
            SELECT
                TRIM(a.country) AS country,
                COUNT(
                    DISTINCT m.member_number
                )::int AS total
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
        ),

        "membersByState": rows(
            db,
            f"""
            SELECT
                UPPER(TRIM(a.state)) AS state,
                COUNT(
                    DISTINCT m.member_number
                )::int AS total
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
        ),

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
        "geographicConcentration": one(
            db,
            f"""
            WITH base AS (
                SELECT m.member_number
                FROM members m
                WHERE 1 = 1
                  {member_filter}
            ),
            state_counts AS (
                SELECT
                    UPPER(TRIM(a.state)) AS state,
                    COUNT(
                        DISTINCT b.member_number
                    )::int AS total
                FROM base b
                JOIN member_addresses a
                  ON a.member_number = b.member_number
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
            ),
            country_counts AS (
                SELECT
                    TRIM(a.country) AS country,
                    COUNT(
                        DISTINCT b.member_number
                    )::int AS total
                FROM base b
                JOIN member_addresses a
                  ON a.member_number = b.member_number
                WHERE a.country IS NOT NULL
                  AND TRIM(a.country) <> ''
                GROUP BY TRIM(a.country)
            ),
            top5_states AS (
                SELECT COALESCE(SUM(total), 0)::int AS total
                FROM (
                    SELECT total FROM state_counts
                    ORDER BY total DESC
                    LIMIT 5
                ) t
            ),
            top5_countries AS (
                SELECT COALESCE(SUM(total), 0)::int AS total
                FROM (
                    SELECT total FROM country_counts
                    ORDER BY total DESC
                    LIMIT 5
                ) t
            ),
            domestic AS (
                SELECT COALESCE(SUM(total), 0)::int AS total
                FROM country_counts
                WHERE country = 'United States'
            ),
            country_total AS (
                SELECT COALESCE(SUM(total), 0)::int AS total
                FROM country_counts
            ),
            account_total AS (
                SELECT COUNT(*)::int AS total FROM base
            )
            SELECT
                account_total.total AS total_accounts,
                top5_states.total AS top5_states_total,
                top5_countries.total AS top5_countries_total,
                domestic.total AS domestic_accounts,

                (
                    country_total.total - domestic.total
                ) AS international_accounts,

                country_total.total AS accounts_with_country,

                ROUND(
                    100.0 * top5_states.total
                    / GREATEST(account_total.total, 1),
                    1
                )::float AS top5_states_pct,

                ROUND(
                    100.0 * top5_countries.total
                    / GREATEST(account_total.total, 1),
                    1
                )::float AS top5_countries_pct,

                ROUND(
                    100.0 * domestic.total
                    / GREATEST(country_total.total, 1),
                    1
                )::float AS domestic_pct,

                ROUND(
                    100.0 * (
                        country_total.total - domestic.total
                    ) / GREATEST(country_total.total, 1),
                    1
                )::float AS international_pct

            FROM
                account_total,
                top5_states,
                top5_countries,
                domestic,
                country_total
            """,
            params,
        ),
    }


@router.get("/state-accounts/{state_code}")
def state_accounts(
    state_code: str,
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    normalized_state = state_code.strip().upper()

    if normalized_state not in US_STATE_CODES:
        raise HTTPException(
            status_code=400,
            detail="Invalid US state abbreviation",
        )

    date_filter = demographic_date_filter_sql(
        alias="m",
        column="since_date",
    )

    result = db.execute(
        text(f"""
            SELECT DISTINCT ON (m.member_number)
                m.member_number,
                m.member_full_name,
                m.member_name,
                m.member_or_guest,
                m.member_type,
                m.status,
                m.age,
                m.gender,
                m.email,
                m.occupation,
                m.employer,
                m.since_date,
                ma.address_line1,
                ma.address_line2,
                ma.city,
                UPPER(TRIM(ma.state)) AS state,
                ma.postal_code,
                ma.country
            FROM members m
            INNER JOIN member_addresses ma
                ON ma.member_number = m.member_number
            WHERE UPPER(TRIM(ma.state)) = :state_code
            {date_filter}
            ORDER BY
                m.member_number,
                ma.city NULLS LAST,
                ma.address_line1 NULLS LAST
        """),
        {
            "state_code": normalized_state,
            **filter_params(
                year=year,
                month=month,
                date=date,
                start_date=start_date,
                end_date=end_date,
            ),
        },
    ).mappings().all()

    return [dict(row) for row in result]


@router.get("/account-category/{category}")
def account_category_details(
    category: str,
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    normalized_category = category.strip().lower()

    allowed_categories = {
        "member": "Member",
        "guest": "Guest",
    }

    if normalized_category not in allowed_categories:
        raise HTTPException(
            status_code=400,
            detail="Category must be Member or Guest",
        )

    category_value = allowed_categories[normalized_category]
    date_filter = demographic_date_filter_sql(
        alias="m",
        column="since_date",
    )

    result = db.execute(
        text(f"""
            SELECT
                m.member_number,
                m.member_full_name,
                m.member_name,
                m.member_or_guest,
                m.member_type,
                m.status,
                m.age,
                m.gender,
                m.email,
                m.occupation,
                m.employer,
                m.since_date,
                ma.address_line1,
                ma.address_line2,
                ma.city,
                UPPER(TRIM(ma.state)) AS state,
                ma.postal_code,
                ma.country
            FROM members m

            LEFT JOIN LATERAL (
                SELECT
                    address_line1,
                    address_line2,
                    city,
                    state,
                    postal_code,
                    country
                FROM member_addresses
                WHERE member_number = m.member_number
                ORDER BY
                    city NULLS LAST,
                    address_line1 NULLS LAST
                LIMIT 1
            ) ma ON TRUE

            WHERE LOWER(TRIM(m.member_or_guest)) =
                LOWER(:category)
            {date_filter}

            ORDER BY
                m.member_full_name NULLS LAST,
                m.member_name NULLS LAST,
                m.member_number
        """),
        {
            "category": category_value,
            **filter_params(
                year=year,
                month=month,
                date=date,
                start_date=start_date,
                end_date=end_date,
            ),
        },
    ).mappings().all()

    return [dict(row) for row in result]


@router.get("/demographics/account-details")
def demographic_account_details(
    dimension: str = Query(...),
    value: str = Query(...),
    category: str | None = Query(None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    normalized_dimension = dimension.strip().lower()
    normalized_value = value.strip()
    normalized_category = (
        category.strip()
        if category
        else None
    )

    date_filter = demographic_date_filter_sql(
        alias="m",
        column="since_date",
    )

    allowed_dimensions = {
        "country",
        "account_type",
        "status",
        "household",
    }

    if normalized_dimension not in allowed_dimensions:
        raise HTTPException(
            status_code=400,
            detail=(
                "dimension must be country, "
                "account_type, status, or household"
            ),
        )

    if normalized_dimension == "household":
        result = db.execute(
            text(f"""
                WITH household_counts AS (
                    SELECT
                        m.member_number,
                        COUNT(
                            d.dependent_number
                        )::int AS dependent_count
                    FROM members m
                    LEFT JOIN dependents d
                        ON d.member_number =
                           m.member_number
                    WHERE LOWER(
                        TRIM(m.member_or_guest)
                    ) = 'member'
                    GROUP BY m.member_number
                ),
                household_groups AS (
                    SELECT
                        member_number,
                        dependent_count,
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
                        END AS household_group
                    FROM household_counts
                )
                SELECT
                    m.member_number,
                    m.member_full_name,
                    m.member_name,
                    m.member_or_guest,
                    m.member_type,
                    m.status,
                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,
                    m.occupation,
                    m.employer,
                    hg.dependent_count,
                    ma.address_line1,
                    ma.address_line2,
                    ma.city,
                    UPPER(TRIM(ma.state)) AS state,
                    ma.postal_code,
                    ma.country
                FROM members m

                INNER JOIN household_groups hg
                    ON hg.member_number =
                       m.member_number

                LEFT JOIN LATERAL (
                    SELECT
                        address_line1,
                        address_line2,
                        city,
                        state,
                        postal_code,
                        country
                    FROM member_addresses
                    WHERE member_number =
                          m.member_number
                    ORDER BY
                        city NULLS LAST,
                        address_line1 NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE hg.household_group =
                      :household_group
                {date_filter}

                ORDER BY
                    hg.dependent_count DESC,
                    m.member_full_name NULLS LAST,
                    m.member_name NULLS LAST,
                    m.member_number
            """),
            {
                "household_group":
                    normalized_value,
                **filter_params(
                    year=year,
                    month=month,
                    date=date,
                    start_date=start_date,
                    end_date=end_date,
                ),
            },
        ).mappings().all()

        return [dict(row) for row in result]

    if normalized_dimension == "country":
        result = db.execute(
            text(f"""
                SELECT DISTINCT ON (
                    m.member_number
                )
                    m.member_number,
                    m.member_full_name,
                    m.member_name,
                    m.member_or_guest,
                    m.member_type,
                    m.status,
                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,
                    m.occupation,
                    m.employer,
                    ma.address_line1,
                    ma.address_line2,
                    ma.city,
                    UPPER(TRIM(ma.state)) AS state,
                    ma.postal_code,
                    ma.country
                FROM members m
                INNER JOIN member_addresses ma
                    ON ma.member_number =
                       m.member_number
                WHERE LOWER(TRIM(ma.country)) =
                      LOWER(:value)
                {date_filter}
                ORDER BY
                    m.member_number,
                    ma.city NULLS LAST,
                    ma.address_line1 NULLS LAST
            """),
            {
                "value": normalized_value,
                **filter_params(
                    year=year,
                    month=month,
                    date=date,
                    start_date=start_date,
                    end_date=end_date,
                ),
            },
        ).mappings().all()
        return [dict(row) for row in result]

    if normalized_dimension == "account_type":
        result = db.execute(
            text(f"""
                SELECT
                    m.member_number,
                    COALESCE(
                        NULLIF(TRIM(m.member_full_name), ''),
                        NULLIF(TRIM(m.member_name), '')
                    ) AS member_full_name,
                    m.member_name,
                    m.member_or_guest,
                    m.member_type,
                    m.status,
                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,
                    m.occupation,
                    m.employer,
                    ma.address_line1,
                    ma.address_line2,
                    ma.city,
                    UPPER(TRIM(ma.state)) AS state,
                    ma.postal_code,
                    ma.country
                FROM members m

                LEFT JOIN LATERAL (
                    SELECT
                        address_line1,
                        address_line2,
                        city,
                        state,
                        postal_code,
                        country
                    FROM member_addresses
                    WHERE member_number =
                        m.member_number
                    ORDER BY
                        city NULLS LAST,
                        address_line1 NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE LOWER(TRIM(m.member_type)) =
                    LOWER(:value)

                AND (
                    :category IS NULL
                    OR LOWER(
                        TRIM(m.member_or_guest)
                    ) = LOWER(:category)
                )

                {date_filter}

                ORDER BY
                    m.member_full_name NULLS LAST,
                    m.member_name NULLS LAST,
                    m.member_number
            """),
            {
                "value": normalized_value,
                "category": normalized_category,
                **filter_params(
                    year=year,
                    month=month,
                    date=date,
                    start_date=start_date,
                    end_date=end_date,
                ),
            },
        ).mappings().all()

        return [dict(row) for row in result]

    result = db.execute(
        text(f"""
            SELECT
                m.member_number,
                m.member_full_name,
                m.member_name,
                m.member_or_guest,
                m.member_type,
                m.status,
                m.since_date,
                m.age,
                m.gender,
                m.email,
                m.occupation,
                m.employer,
                ma.address_line1,
                ma.address_line2,
                ma.city,
                UPPER(TRIM(ma.state)) AS state,
                ma.postal_code,
                ma.country
            FROM members m

            LEFT JOIN LATERAL (
                SELECT
                    address_line1,
                    address_line2,
                    city,
                    state,
                    postal_code,
                    country
                FROM member_addresses
                WHERE member_number = m.member_number
                ORDER BY
                    city NULLS LAST,
                    address_line1 NULLS LAST
                LIMIT 1
            ) ma ON TRUE

            WHERE LOWER(TRIM(m.status)) =
                  LOWER(:value)

              AND (
                  :category IS NULL
                  OR LOWER(TRIM(m.member_or_guest)) =
                     LOWER(:category)
              )

              {date_filter}

            ORDER BY
                m.member_full_name NULLS LAST,
                m.member_name NULLS LAST,
                m.member_number
        """),
        {
            "value": normalized_value,
            "category": normalized_category,
            **filter_params(
                year=year,
                month=month,
                date=date,
                start_date=start_date,
                end_date=end_date,
            ),
        },
    ).mappings().all()

    return [dict(row) for row in result]

@router.get("/new-vs-repeat-visitors")
def get_new_vs_repeat_visitors(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if month is not None and not 1 <= month <= 12:
        raise HTTPException(
            status_code=400,
            detail="month must be between 1 and 12",
        )

    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=400,
            detail=(
                "start_date and end_date "
                "must be supplied together"
            ),
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

    use_monthly_groups = (
        year is not None
        or month is not None
        or (
            start_date is not None
            and end_date is not None
        )
    )

    if start_date is not None and end_date is not None:
        range_start = start_date
        range_end = end_date

    elif year is not None and month is not None:
        range_start = date(year, month, 1)

        if month == 12:
            range_end = date(year, 12, 31)
        else:
            range_end = (
                date(year, month + 1, 1)
                - timedelta(days=1)
            )

    elif year is not None:
        range_start = date(year, 1, 1)
        range_end = date(year, 12, 31)

    else:
        range_start = None
        range_end = None

    group_expression = (
        "DATE_TRUNC('month', event_date)::date"
        if use_monthly_groups
        else "DATE_TRUNC('year', event_date)::date"
    )

    result = db.execute(
        text(f"""
            WITH new_accounts AS (
                /*
                 * An account appears as New on its
                 * since_date, even if it has no booking.
                 */
                SELECT DISTINCT
                    m.member_number,
                    m.since_date::date AS event_date,
                    TRIM(m.member_or_guest)
                        AS account_category,
                    'New'::text AS account_status
                FROM members m
                WHERE m.since_date IS NOT NULL
                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')
            ),

            repeat_accounts AS (
                /*
                 * An account appears as Repeat when
                 * it has a booking after its since_date.
                 *
                 * DISTINCT prevents multiple bookings
                 * by the same account in the same month
                 * from counting that person repeatedly.
                 */
                SELECT DISTINCT
                    r.member_number,
                    r.check_in_date::date AS event_date,
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
            ),

            combined_events AS (
                SELECT * FROM new_accounts

                UNION ALL

                SELECT * FROM repeat_accounts
            ),

            filtered_events AS (
                SELECT
                    member_number,
                    event_date,
                    account_category,
                    account_status
                FROM combined_events
                WHERE (
                    CAST(:range_start AS date) IS NULL
                    OR event_date >=
                       CAST(:range_start AS date)
                )
                  AND (
                    CAST(:range_end AS date) IS NULL
                    OR event_date <=
                       CAST(:range_end AS date)
                )
            ),

            grouped_events AS (
                SELECT DISTINCT
                    member_number,
                    {group_expression}
                        AS period_start,
                    account_category,
                    account_status
                FROM filtered_events
            )

            SELECT
                period_start,

                CASE
                    WHEN :monthly = TRUE
                    THEN (
                        period_start
                        + INTERVAL '1 month'
                        - INTERVAL '1 day'
                    )::date

                    ELSE (
                        period_start
                        + INTERVAL '1 year'
                        - INTERVAL '1 day'
                    )::date
                END AS period_end,

                CASE
                    WHEN :monthly = TRUE
                    THEN TO_CHAR(
                        period_start,
                        'Mon YYYY'
                    )
                    ELSE TO_CHAR(
                        period_start,
                        'YYYY'
                    )
                END AS period_label,

                EXTRACT(
                    YEAR FROM period_start
                )::int AS year,

                CASE
                    WHEN :monthly = TRUE
                    THEN EXTRACT(
                        MONTH FROM period_start
                    )::int
                    ELSE NULL
                END AS month,

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

            FROM grouped_events
            GROUP BY period_start
            ORDER BY period_start
        """),
        {
            "range_start": range_start,
            "range_end": range_end,
            "monthly": use_monthly_groups,
        },
    ).mappings().all()

    return [dict(row) for row in result]

@router.get("/new-vs-repeat-visitors/details")
def get_new_vs_repeat_visitor_details(
    visitor_status: str,
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
):
    normalized_status = (
        visitor_status
        .strip()
        .lower()
    )

    if normalized_status not in {
        "new",
        "repeat",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "visitor_status must be "
                "either New or Repeat"
            ),
        )

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail=(
                "start_date cannot be "
                "after end_date"
            ),
        )

    if normalized_status == "new":
        result = db.execute(
            text("""
                SELECT DISTINCT ON (
                    m.member_number
                )
                    m.member_number,

                    COALESCE(
                        NULLIF(
                            TRIM(
                                m.member_full_name
                            ),
                            ''
                        ),
                        NULLIF(
                            TRIM(m.member_name),
                            ''
                        ),
                        'Unknown'
                    ) AS member_full_name,

                    TRIM(m.member_or_guest)
                        AS member_or_guest,

                    m.member_type,
                    m.status,

                    (
                        SELECT COUNT(*)
                        FROM dependents d
                        WHERE d.member_number =
                              m.member_number
                    )::int AS dependent_count,

                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,

                    ma.city,
                    ma.postal_code,
                    ma.country

                FROM members m

                LEFT JOIN LATERAL (
                    SELECT
                        a.city,
                        a.postal_code,
                        a.country
                    FROM member_addresses a
                    WHERE a.member_number =
                          m.member_number
                    ORDER BY
                        a.city NULLS LAST,
                        a.country NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE m.since_date::date
                      BETWEEN :start_date
                          AND :end_date

                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')

                ORDER BY
                    m.member_number,
                    m.member_full_name NULLS LAST,
                    m.member_name NULLS LAST
            """),
            {
                "start_date": start_date,
                "end_date": end_date,
            },
        ).mappings().all()

    else:
        result = db.execute(
            text("""
                SELECT DISTINCT ON (
                    m.member_number
                )
                    m.member_number,

                    COALESCE(
                        NULLIF(
                            TRIM(
                                m.member_full_name
                            ),
                            ''
                        ),
                        NULLIF(
                            TRIM(m.member_name),
                            ''
                        ),
                        'Unknown'
                    ) AS member_full_name,

                    TRIM(m.member_or_guest)
                        AS member_or_guest,

                    m.member_type,
                    m.status,

                    (
                        SELECT COUNT(*)
                        FROM dependents d
                        WHERE d.member_number =
                              m.member_number
                    )::int AS dependent_count,

                    m.since_date,
                    m.age,
                    m.gender,
                    m.email,

                    ma.city,
                    ma.postal_code,
                    ma.country

                FROM members m

                JOIN rooms r
                  ON r.member_number =
                     m.member_number

                LEFT JOIN LATERAL (
                    SELECT
                        a.city,
                        a.postal_code,
                        a.country
                    FROM member_addresses a
                    WHERE a.member_number =
                          m.member_number
                    ORDER BY
                        a.city NULLS LAST,
                        a.country NULLS LAST
                    LIMIT 1
                ) ma ON TRUE

                WHERE r.check_in_date::date
                      BETWEEN :start_date
                          AND :end_date

                  AND m.since_date IS NOT NULL

                  AND r.check_in_date::date >
                      m.since_date::date

                  AND TRIM(m.member_or_guest)
                      IN ('Member', 'Guest')

                ORDER BY
                    m.member_number,
                    r.check_in_date DESC
            """),
            {
                "start_date": start_date,
                "end_date": end_date,
            },
        ).mappings().all()

    return [dict(row) for row in result]