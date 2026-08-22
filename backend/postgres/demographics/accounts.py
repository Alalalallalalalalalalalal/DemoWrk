# backend/postgres/demographics/accounts.py
"""
Demographics account drilldowns: by state, by account category (Member vs
Guest), and by arbitrary dimension (country / account_type / status /
household).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date

from ..analytics_shared import (
    get_db,
    demographic_date_filter_sql,
    filter_params,
    US_STATE_CODES,
)

router = APIRouter()


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
