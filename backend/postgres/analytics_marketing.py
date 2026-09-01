# backend/postgres/analytics_marketing.py
"""
Marketing targeting endpoints for ML Insights.

Adds action-ready marketing audiences that can be exported to MailLink or any
email platform. This module is intentionally separate from analytics_ml_insights.py
so descriptive ML analytics and marketing execution stay cleanly separated.

Routes, once included under /analytics by backend/postgres/analytics.py:
  GET /analytics/ml/marketing-campaigns
  GET /analytics/ml/marketing-campaigns/{campaign_key}/members
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Any
import re


from .analytics_shared import get_db

router = APIRouter()


FREE_PAYMENT_SQL = """
    (
        LOWER(COALESCE(NULLIF(TRIM(payment_type), ''), 'unknown')) LIKE '%comp%'
        OR LOWER(COALESCE(NULLIF(TRIM(payment_type), ''), 'unknown')) LIKE '%free%'
        OR LOWER(COALESCE(NULLIF(TRIM(payment_type), ''), 'unknown')) LIKE '%complimentary%'
        OR LOWER(COALESCE(NULLIF(TRIM(payment_type), ''), 'unknown')) LIKE '%gratis%'
        OR LOWER(COALESCE(NULLIF(TRIM(payment_type), ''), 'unknown')) LIKE '%no charge%'
    )
"""

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

SEASON_JOIN_SQL = """
    LEFT JOIN active_seasons s
      ON (
        (
          s.start_month < s.end_month
          OR (s.start_month = s.end_month AND s.start_day <= s.end_day)
        )
        AND (
          EXTRACT(MONTH FROM mf.ref_date)::INT > s.start_month
          OR (
            EXTRACT(MONTH FROM mf.ref_date)::INT = s.start_month
            AND EXTRACT(DAY FROM mf.ref_date)::INT >= s.start_day
          )
        )
        AND (
          EXTRACT(MONTH FROM mf.ref_date)::INT < s.end_month
          OR (
            EXTRACT(MONTH FROM mf.ref_date)::INT = s.end_month
            AND EXTRACT(DAY FROM mf.ref_date)::INT <= s.end_day
          )
        )
      )
      OR (
        (
          s.start_month > s.end_month
          OR (s.start_month = s.end_month AND s.start_day > s.end_day)
        )
        AND (
          EXTRACT(MONTH FROM mf.ref_date)::INT > s.start_month
          OR (
            EXTRACT(MONTH FROM mf.ref_date)::INT = s.start_month
            AND EXTRACT(DAY FROM mf.ref_date)::INT >= s.start_day
          )
          OR EXTRACT(MONTH FROM mf.ref_date)::INT < s.end_month
          OR (
            EXTRACT(MONTH FROM mf.ref_date)::INT = s.end_month
            AND EXTRACT(DAY FROM mf.ref_date)::INT <= s.end_day
          )
        )
      )
"""

BASE_MARKETING_CTES = f"""
WITH active_seasons AS (
    SELECT s.id, s.season_name, s.start_month, s.start_day, s.end_month, s.end_day
    FROM seasons s
    JOIN season_groups sg ON sg.id = s.group_id
    WHERE s.is_active = TRUE
      AND sg.group_type = 'business'
),
member_contact AS (
    SELECT
        m.member_number,
        COALESCE(
            NULLIF(TRIM(m.member_full_name), ''),
            NULLIF(TRIM(m.member_name), ''),
            NULLIF(TRIM(MAX(f.guest_name)), ''),
            NULLIF(TRIM(MAX(f.folio_name)), '')
        ) AS name,
        m.email,
        m.prefix AS title,
        m.date_of_birth,
        p.phone_number,
        a.address_line1,
        a.address_line2,
        a.city,
        a.state,
        a.postal_code,
        a.country
    FROM members m
    LEFT JOIN folios f ON f.member_number = m.member_number
    LEFT JOIN member_addresses a ON a.member_number = m.member_number
    LEFT JOIN LATERAL (
        SELECT phone_number
        FROM member_phones mp
        WHERE mp.member_number = m.member_number
          AND phone_number IS NOT NULL
        ORDER BY
            CASE phone_type
                WHEN 'cell' THEN 1
                WHEN 'home' THEN 2
                WHEN 'business' THEN 3
                ELSE 4
            END,
            id
        LIMIT 1
    ) p ON TRUE
    WHERE m.member_number IS NOT NULL
    GROUP BY
        m.member_number,
        m.member_full_name,
        m.member_name,
        m.email,
        m.prefix,
        m.date_of_birth,
        p.phone_number,
        a.address_line1,
        a.address_line2,
        a.city,
        a.state,
        a.postal_code,
        a.country
),
marketing_folios AS (
    SELECT
        f.member_number,
        COALESCE(NULLIF(TRIM(f.guest_name), ''), NULLIF(TRIM(f.folio_name), '')) AS folio_member_name,
        f.conf_code,
        f.description,
        COALESCE(f.amount, 0)::NUMERIC AS amount,
        f.payment_type,
        {FREE_PAYMENT_SQL} AS is_free,
        COALESCE(f.check_in_date, f.transaction_date)::DATE AS ref_date,
        f.check_in_date::DATE AS check_in_date,
        f.check_out_date::DATE AS check_out_date,
        NULLIF(TRIM(f.villa_name), '') AS villa_name,
        f.bedroom_count,
        COALESCE(NULLIF(TRIM(f.source), ''), 'Unknown') AS business_source,
        COALESCE(NULLIF(TRIM(f.transaction_category), ''), 'Uncategorized') AS transaction_category,
        COALESCE(NULLIF(TRIM(f.transaction_flow), ''), 'Charge') AS transaction_flow,
        {AMENITY_CASE_SQL} AS amenity
    FROM folios f
    WHERE f.member_number IS NOT NULL
      AND COALESCE(f.check_in_date, f.transaction_date) IS NOT NULL
),
folio_with_season AS (
    SELECT
        mf.*,
        s.season_name AS season
    FROM marketing_folios mf
    {SEASON_JOIN_SQL}
),
stays AS (
    SELECT DISTINCT
        member_number,
        COALESCE(conf_code, check_in_date::TEXT || '-' || COALESCE(villa_name, 'unknown')) AS stay_key,
        check_in_date,
        check_out_date,
        villa_name,
        bedroom_count,
        business_source,
        season,
        GREATEST(COALESCE(check_out_date - check_in_date, 0), 0) AS nights
    FROM folio_with_season
    WHERE check_in_date IS NOT NULL
),
member_rollup AS (
    SELECT
        member_number,
        COUNT(DISTINCT stay_key)::INT AS total_visits,
        MIN(check_in_date) AS first_visit,
        MAX(check_out_date) AS last_visit,
        COALESCE(SUM(nights), 0)::INT AS total_nights
    FROM stays
    GROUP BY member_number
),
money_rollup AS (
    SELECT
        member_number,
        ROUND(SUM(CASE WHEN NOT is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS paid_revenue,
        ROUND(SUM(CASE WHEN is_free THEN amount ELSE 0 END)::NUMERIC, 2) AS free_value,
        ROUND(SUM(amount)::NUMERIC, 2) AS lifetime_spend
    FROM folio_with_season
    GROUP BY member_number
),
season_pref AS (
    SELECT member_number, season AS preferred_season, visit_count AS preferred_season_visits
    FROM (
        SELECT
            member_number,
            season,
            COUNT(*)::INT AS visit_count,
            ROW_NUMBER() OVER (PARTITION BY member_number ORDER BY COUNT(*) DESC, season) AS rn
        FROM stays
        WHERE season IS NOT NULL
        GROUP BY member_number, season
    ) ranked
    WHERE rn = 1
),
villa_pref AS (
    SELECT member_number, villa_name AS preferred_villa, villa_visits
    FROM (
        SELECT
            member_number,
            villa_name,
            COUNT(*)::INT AS villa_visits,
            ROW_NUMBER() OVER (PARTITION BY member_number ORDER BY COUNT(*) DESC, villa_name) AS rn
        FROM stays
        WHERE villa_name IS NOT NULL
        GROUP BY member_number, villa_name
    ) ranked
    WHERE rn = 1
),
source_pref AS (
    SELECT member_number, business_source, source_count
    FROM (
        SELECT
            member_number,
            business_source,
            COUNT(*)::INT AS source_count,
            ROW_NUMBER() OVER (PARTITION BY member_number ORDER BY COUNT(*) DESC, business_source) AS rn
        FROM stays
        WHERE business_source IS NOT NULL
        GROUP BY member_number, business_source
    ) ranked
    WHERE rn = 1
),
amenity_pref AS (
    SELECT member_number, amenity AS preferred_amenity, amenity_spend, amenity_visits
    FROM (
        SELECT
            member_number,
            amenity,
            ROUND(SUM(amount)::NUMERIC, 2) AS amenity_spend,
            COUNT(*)::INT AS amenity_visits,
            ROW_NUMBER() OVER (
                PARTITION BY member_number
                ORDER BY SUM(amount) DESC, COUNT(*) DESC, amenity
            ) AS rn
        FROM folio_with_season
        WHERE amenity IS NOT NULL
        GROUP BY member_number, amenity
    ) ranked
    WHERE rn = 1
),
member_profile AS (
    SELECT
        COALESCE(mc.member_number, mr.member_number) AS member_number,
        COALESCE(mc.name, MAX(fws.folio_member_name)) AS name,
        mc.email,
        mc.title,
        mc.date_of_birth,
        mc.phone_number,
        mc.address_line1,
        mc.address_line2,
        mc.city,
        mc.state,
        mc.postal_code,
        mc.country,
        COALESCE(mr.total_visits, 0)::INT AS total_visits,
        mr.first_visit,
        mr.last_visit,
        COALESCE(mr.total_nights, 0)::INT AS total_nights,
        COALESCE(mo.paid_revenue, 0)::NUMERIC AS paid_revenue,
        COALESCE(mo.free_value, 0)::NUMERIC AS free_value,
        COALESCE(mo.lifetime_spend, 0)::NUMERIC AS lifetime_spend,
        sp.preferred_season,
        COALESCE(sp.preferred_season_visits, 0)::INT AS preferred_season_visits,
        vp.preferred_villa,
        COALESCE(vp.villa_visits, 0)::INT AS preferred_villa_visits,
        src.business_source,
        ap.preferred_amenity,
        COALESCE(ap.amenity_spend, 0)::NUMERIC AS preferred_amenity_spend,
        COALESCE(ap.amenity_visits, 0)::INT AS preferred_amenity_visits
    FROM member_rollup mr
    FULL OUTER JOIN member_contact mc ON mc.member_number = mr.member_number
    LEFT JOIN money_rollup mo ON mo.member_number = COALESCE(mc.member_number, mr.member_number)
    LEFT JOIN season_pref sp ON sp.member_number = COALESCE(mc.member_number, mr.member_number)
    LEFT JOIN villa_pref vp ON vp.member_number = COALESCE(mc.member_number, mr.member_number)
    LEFT JOIN source_pref src ON src.member_number = COALESCE(mc.member_number, mr.member_number)
    LEFT JOIN amenity_pref ap ON ap.member_number = COALESCE(mc.member_number, mr.member_number)
    LEFT JOIN folio_with_season fws ON fws.member_number = COALESCE(mc.member_number, mr.member_number)
    WHERE COALESCE(mc.member_number, mr.member_number) IS NOT NULL
    GROUP BY
        COALESCE(mc.member_number, mr.member_number),
        mc.name,
        mc.email,
        mc.title,
        mc.date_of_birth,
        mc.phone_number,
        mc.address_line1,
        mc.address_line2,
        mc.city,
        mc.state,
        mc.postal_code,
        mc.country,
        mr.total_visits,
        mr.first_visit,
        mr.last_visit,
        mr.total_nights,
        mo.paid_revenue,
        mo.free_value,
        mo.lifetime_spend,
        sp.preferred_season,
        sp.preferred_season_visits,
        vp.preferred_villa,
        vp.villa_visits,
        src.business_source,
        ap.preferred_amenity,
        ap.amenity_spend,
        ap.amenity_visits
)
"""

CAMPAIGN_DEFINITIONS = {
    "seasonal_loyalists": {
        "title": "Seasonal Loyalists",
        "category": "Seasonality",
        "description": "Members who repeatedly visit in the same season and are strong targets for early seasonal booking emails.",
        "where": "preferred_season_visits >= 3",
        "reason": "'Visited ' || COALESCE(preferred_season, 'their preferred season') || ' ' || preferred_season_visits || ' times.'",
        "sort": "preferred_season_visits DESC, lifetime_spend DESC",
    },
    "lapsed_members": {
        "title": "Lapsed Members",
        "category": "Win Back",
        "description": "Members who have not visited in the last 18 months.",
        "where": "last_visit IS NOT NULL AND last_visit < (CURRENT_DATE - INTERVAL '18 months')",
        "reason": "'Last visit was ' || TO_CHAR(last_visit, 'Mon DD, YYYY') || '. Send a win-back offer.'",
        "sort": "last_visit ASC NULLS LAST, lifetime_spend DESC",
    },
    "free_to_paid": {
        "title": "Free to Paid Conversion",
        "category": "Conversion",
        "description": "Members with complimentary/free value but little or no paid revenue.",
        "where": "free_value > 0 AND paid_revenue <= 0 AND total_visits >= 1",
        "reason": "'Has complimentary value of $' || TO_CHAR(free_value, 'FM999,999,999,990.00') || ' and no paid revenue recorded.'",
        "sort": "free_value DESC, total_visits DESC",
    },
    "paid_vips": {
        "title": "Paid VIP Members",
        "category": "VIP",
        "description": "High-value paid members for premium villa, concierge, and early-access campaigns.",
        "where": "paid_revenue >= 10000",
        "reason": "'Paid revenue is $' || TO_CHAR(paid_revenue, 'FM999,999,999,990.00') || '. Prioritize premium messaging.'",
        "sort": "paid_revenue DESC, total_visits DESC",
    },
    "villa_lovers": {
        "title": "Villa Lovers",
        "category": "Villa",
        "description": "Members with a clear preferred villa. Use this for villa-specific availability campaigns.",
        "where": "preferred_villa IS NOT NULL AND preferred_villa_visits >= 2",
        "reason": "'Preferred villa is ' || preferred_villa || ' with ' || preferred_villa_visits || ' visits.'",
        "sort": "preferred_villa_visits DESC, lifetime_spend DESC",
    },
    "amenity_lovers": {
        "title": "Amenity Lovers",
        "category": "Amenities",
        "description": "Members with strong amenity preferences such as Golf, Spa, Restaurant, Bar, or Grill.",
        "where": "preferred_amenity IS NOT NULL AND preferred_amenity_visits >= 2",
        "reason": "'Top amenity is ' || preferred_amenity || ' with ' || preferred_amenity_visits || ' uses and $' || TO_CHAR(preferred_amenity_spend, 'FM999,999,999,990.00') || ' spend.'",
        "sort": "preferred_amenity_spend DESC, preferred_amenity_visits DESC",
    },
    "business_source": {
        "title": "Business Source Campaigns",
        "category": "Source",
        "description": "Members grouped by strongest business source for channel-specific messaging.",
        "where": "business_source IS NOT NULL AND business_source <> 'Unknown'",
        "reason": "'Primary business source is ' || business_source || '. Use source-specific messaging.'",
        "sort": "business_source, lifetime_spend DESC",
    },
    "birthday_next_month": {
        "title": "Birthdays Next Month",
        "category": "Occasion",
        "description": "Members with birthdays next month for birthday greeting or birthday offer campaigns.",
        "where": "date_of_birth IS NOT NULL AND EXTRACT(MONTH FROM date_of_birth)::INT = EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '1 month'))::INT",
        "reason": "'Birthday is next month: ' || TO_CHAR(date_of_birth, 'Mon DD') || '.'",
        "sort": "EXTRACT(DAY FROM date_of_birth), lifetime_spend DESC",
    },
    "anniversary_members": {
        "title": "Visit Anniversary",
        "category": "Occasion",
        "description": "Members whose first visit anniversary is next month.",
        "where": "first_visit IS NOT NULL AND EXTRACT(MONTH FROM first_visit)::INT = EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '1 month'))::INT",
        "reason": "'First visit anniversary is next month. First visit: ' || TO_CHAR(first_visit, 'Mon DD, YYYY') || '.'",
        "sort": "EXTRACT(DAY FROM first_visit), lifetime_spend DESC",
    },
    "dormant_high_value": {
        "title": "Dormant High Value",
        "category": "Win Back",
        "description": "High-value members who have not visited recently. Strongest potential revenue recovery list.",
        "where": "lifetime_spend >= 10000 AND last_visit IS NOT NULL AND last_visit < (CURRENT_DATE - INTERVAL '18 months')",
        "reason": "'High lifetime spend of $' || TO_CHAR(lifetime_spend, 'FM999,999,999,990.00') || ' but last visit was ' || TO_CHAR(last_visit, 'Mon DD, YYYY') || '.'",
        "sort": "lifetime_spend DESC, last_visit ASC NULLS LAST",
    },
}



CAMPAIGN_FIELD_OPTIONS = {
    "lifetime_spend": {
        "label": "Lifetime Spend",
        "type": "number",
        "column": "lifetime_spend",
        "default_sort": True,
    },
    "paid_revenue": {"label": "Paid Revenue", "type": "number", "column": "paid_revenue"},
    "free_value": {"label": "Complimentary Value", "type": "number", "column": "free_value"},
    "total_visits": {"label": "Number of Visits", "type": "number", "column": "total_visits"},
    "total_nights": {"label": "Number of Nights", "type": "number", "column": "total_nights"},
    "preferred_season_visits": {"label": "Preferred Season Visits", "type": "number", "column": "preferred_season_visits"},
    "preferred_villa_visits": {"label": "Preferred Villa Visits", "type": "number", "column": "preferred_villa_visits"},
    "preferred_amenity_visits": {"label": "Preferred Amenity Uses", "type": "number", "column": "preferred_amenity_visits"},
    "last_visit": {"label": "Last Visit", "type": "date", "column": "last_visit"},
    "first_visit": {"label": "First Visit", "type": "date", "column": "first_visit"},
    "date_of_birth": {"label": "Birthday", "type": "date", "column": "date_of_birth"},
    "preferred_villa": {"label": "Preferred Villa", "type": "text", "column": "preferred_villa"},
    "preferred_amenity": {"label": "Preferred Amenity", "type": "text", "column": "preferred_amenity"},
    "preferred_season": {"label": "Preferred Season", "type": "text", "column": "preferred_season"},
    "business_source": {"label": "Business Source", "type": "text", "column": "business_source"},
    "country": {"label": "Country", "type": "text", "column": "country"},
    "state": {"label": "State", "type": "text", "column": "state"},
    "city": {"label": "City", "type": "text", "column": "city"},
    "email": {"label": "Email", "type": "text", "column": "email"},
}

SORT_FIELD_OPTIONS = {
    key: value["column"]
    for key, value in CAMPAIGN_FIELD_OPTIONS.items()
}

TEXT_OPERATORS = {"is", "is_not", "contains", "not_contains", "is_known", "is_unknown"}
NUMBER_OPERATORS = {"=", "!=", ">", ">=", "<", "<=", "between"}
DATE_OPERATORS = {"before", "after", "within_last_months", "more_than_months_ago", "next_month", "this_month", "is_known", "is_unknown"}

REASON_TEMPLATES = {
    "auto": "'Matched selected marketing audience rules.'",
    "win_back": "'Last visit was ' || COALESCE(TO_CHAR(last_visit, 'Mon DD, YYYY'), 'not recorded') || '. Send a win-back offer.'",
    "high_value": "'Lifetime spend is $' || TO_CHAR(lifetime_spend, 'FM999,999,999,990.00') || '. Prioritize premium messaging.'",
    "villa": "'Preferred villa is ' || COALESCE(preferred_villa, 'not recorded') || ' with ' || preferred_villa_visits || ' visits.'",
    "amenity": "'Top amenity is ' || COALESCE(preferred_amenity, 'not recorded') || ' with ' || preferred_amenity_visits || ' uses.'",
    "birthday": "'Birthday: ' || COALESCE(TO_CHAR(date_of_birth, 'Mon DD'), 'not recorded') || '.'",
    "custom": "'Custom campaign match.'",
}


class CampaignRulePayload(BaseModel):
    field: str
    operator: str
    value: Any | None = None
    value2: Any | None = None


class CampaignPayload(BaseModel):
    key: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=2, max_length=160)
    category: str = Field(default="Custom", min_length=2, max_length=80)
    description: str = Field(default="", max_length=800)
    # Advanced SQL mode still works, but normal UI should send rules/sort dropdown values.
    where: str | None = Field(default=None, max_length=1200)
    reason: str | None = Field(default=None, max_length=1200)
    sort: str | None = Field(default=None, max_length=400)
    rules: list[CampaignRulePayload] = Field(default_factory=list)
    rule_logic: str = Field(default="AND", max_length=3)
    sort_field: str = Field(default="lifetime_spend", max_length=80)
    sort_direction: str = Field(default="DESC", max_length=4)
    reason_template: str = Field(default="auto", max_length=40)
    advanced_mode: bool = False
    is_active: bool = True


class CampaignStatusPayload(BaseModel):
    is_active: bool


def _rows(db: Session, sql: str, params: dict | None = None):
    return [dict(row) for row in db.execute(text(sql), params or {}).mappings().all()]


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return cleaned or "custom_campaign"


def _validate_sql_piece(value: str, field: str) -> str:
    # These snippets are placed inside a SELECT/WHERE/ORDER BY. Keep them expression-only.
    blocked = [";", "--", "/*", "*/", " drop ", " delete ", " insert ", " update ", " alter ", " create ", " truncate "]
    low = f" {value.lower()} "
    if any(token in low for token in blocked):
        raise HTTPException(status_code=400, detail=f"Unsafe SQL in {field}.")
    return value.strip()


def _quote_sql_text(value: Any) -> str:
    return "'" + str(value).replace("'", "''").strip() + "'"


def _number_value(value: Any, field: str) -> str:
    try:
        return str(float(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a number.")


def _positive_int(value: Any, field: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a whole number.")
    if parsed < 0:
        raise HTTPException(status_code=400, detail=f"{field} cannot be negative.")
    return parsed


def _rule_to_sql(rule: CampaignRulePayload) -> str:
    field_meta = CAMPAIGN_FIELD_OPTIONS.get(rule.field)
    if not field_meta:
        raise HTTPException(status_code=400, detail=f"Unknown rule field: {rule.field}")

    column = field_meta["column"]
    field_type = field_meta["type"]
    operator = rule.operator

    if field_type == "number":
        if operator not in NUMBER_OPERATORS:
            raise HTTPException(status_code=400, detail=f"Invalid number operator for {rule.field}.")
        if operator == "between":
            return f"{column} BETWEEN {_number_value(rule.value, rule.field)} AND {_number_value(rule.value2, rule.field)}"
        return f"{column} {operator} {_number_value(rule.value, rule.field)}"

    if field_type == "text":
        if operator not in TEXT_OPERATORS:
            raise HTTPException(status_code=400, detail=f"Invalid text operator for {rule.field}.")
        if operator == "is_known":
            return f"{column} IS NOT NULL AND TRIM({column}) <> ''"
        if operator == "is_unknown":
            return f"({column} IS NULL OR TRIM({column}) = '')"
        value = _quote_sql_text(rule.value or "")
        if operator == "is":
            return f"{column} = {value}"
        if operator == "is_not":
            return f"({column} IS NULL OR {column} <> {value})"
        if operator == "contains":
            return f"{column} ILIKE '%' || {value} || '%'"
        if operator == "not_contains":
            return f"({column} IS NULL OR {column} NOT ILIKE '%' || {value} || '%')"

    if field_type == "date":
        if operator not in DATE_OPERATORS:
            raise HTTPException(status_code=400, detail=f"Invalid date operator for {rule.field}.")
        if operator == "is_known":
            return f"{column} IS NOT NULL"
        if operator == "is_unknown":
            return f"{column} IS NULL"
        if operator == "next_month":
            return f"{column} IS NOT NULL AND EXTRACT(MONTH FROM {column})::INT = EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '1 month'))::INT"
        if operator == "this_month":
            return f"{column} IS NOT NULL AND EXTRACT(MONTH FROM {column})::INT = EXTRACT(MONTH FROM CURRENT_DATE)::INT"
        if operator == "within_last_months":
            months = _positive_int(rule.value, rule.field)
            return f"{column} IS NOT NULL AND {column} >= (CURRENT_DATE - INTERVAL '{months} months')"
        if operator == "more_than_months_ago":
            months = _positive_int(rule.value, rule.field)
            return f"{column} IS NOT NULL AND {column} < (CURRENT_DATE - INTERVAL '{months} months')"
        value = _quote_sql_text(rule.value)
        if operator == "before":
            return f"{column} IS NOT NULL AND {column} < {value}::DATE"
        if operator == "after":
            return f"{column} IS NOT NULL AND {column} > {value}::DATE"

    raise HTTPException(status_code=400, detail="Invalid campaign rule.")


def _payload_sql_parts(payload: CampaignPayload) -> dict:
    if payload.advanced_mode:
        return {
            "where": _validate_sql_piece(payload.where or "total_visits >= 1", "where"),
            "reason": _validate_sql_piece(payload.reason or "'Custom campaign match.'", "reason"),
            "sort": _validate_sql_piece(payload.sort or "lifetime_spend DESC", "sort"),
        }

    rules = [rule for rule in payload.rules if rule.field and rule.operator]
    if not rules:
        where_sql = "total_visits >= 1"
    else:
        joiner = " OR " if payload.rule_logic.upper() == "OR" else " AND "
        where_sql = joiner.join(f"({_rule_to_sql(rule)})" for rule in rules)

    sort_column = SORT_FIELD_OPTIONS.get(payload.sort_field, "lifetime_spend")
    sort_direction = "ASC" if payload.sort_direction.upper() == "ASC" else "DESC"
    reason_sql = REASON_TEMPLATES.get(payload.reason_template, REASON_TEMPLATES["auto"])

    return {
        "where": where_sql,
        "reason": reason_sql,
        "sort": f"{sort_column} {sort_direction} NULLS LAST",
    }


def _ensure_campaign_table(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS marketing_campaign_definitions (
            campaign_key TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Custom',
            description TEXT NOT NULL DEFAULT '',
            where_sql TEXT NOT NULL,
            reason_sql TEXT NOT NULL,
            sort_sql TEXT NOT NULL DEFAULT 'lifetime_spend DESC',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_custom BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """))
    db.commit()


def _get_campaign_definitions(db: Session, include_inactive: bool = False) -> dict:
    _ensure_campaign_table(db)
    definitions = {
        key: {**value, "key": key, "is_active": True, "is_custom": False}
        for key, value in CAMPAIGN_DEFINITIONS.items()
    }
    overrides = _rows(db, """
        SELECT campaign_key, title, category, description, where_sql, reason_sql, sort_sql, is_active, is_custom
        FROM marketing_campaign_definitions
    """)
    for row in overrides:
        definitions[row["campaign_key"]] = {
            "key": row["campaign_key"],
            "title": row["title"],
            "category": row["category"],
            "description": row["description"],
            "where": row["where_sql"],
            "reason": row["reason_sql"],
            "sort": row["sort_sql"],
            "is_active": bool(row["is_active"]),
            "is_custom": bool(row["is_custom"]),
        }
    if not include_inactive:
        definitions = {k: v for k, v in definitions.items() if v.get("is_active", True)}
    return definitions


def _campaign_sql(campaign_key: str, campaign: dict, *, limit: int | None = None) -> str:
    limit_sql = "" if limit is None else "LIMIT :limit"
    where_sql = _validate_sql_piece(campaign["where"], "where")
    reason_sql = _validate_sql_piece(campaign["reason"], "reason")
    sort_sql = _validate_sql_piece(campaign["sort"], "sort")

    return f"""
        {BASE_MARKETING_CTES},
        selected AS (
            SELECT
                member_number,
                title,
                name,
                email,
                phone_number,
                address_line1,
                address_line2,
                city,
                state,
                postal_code,
                country,
                date_of_birth,
                total_visits,
                total_nights,
                first_visit,
                last_visit,
                paid_revenue,
                free_value,
                lifetime_spend,
                preferred_season,
                preferred_season_visits,
                preferred_villa,
                preferred_villa_visits,
                preferred_amenity,
                preferred_amenity_visits,
                preferred_amenity_spend,
                business_source,
                '{campaign_key}' AS campaign_key,
                :campaign_title AS campaign_name,
                ({reason_sql}) AS campaign_reason
            FROM member_profile
            WHERE {where_sql}
            ORDER BY {sort_sql}
            {limit_sql}
        )
        SELECT *
        FROM selected
    """


@router.get("/ml/marketing-campaigns")
def marketing_campaigns(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Return campaign cards with counts and summary KPIs."""
    cards = []
    definitions = _get_campaign_definitions(db, include_inactive=include_inactive)

    # [2026-08-13] Was: BASE_MARKETING_CTES (folios joined to members/
    # member_addresses/member_phones, live regex amenity classification,
    # non-indexed season-range join — the same expensive pattern fixed in
    # analytics_ml_insights.py, but heavier here since marketing_folios
    # scans ALL of folios, not just amenity-matching rows) re-executed
    # from scratch for EVERY campaign definition in the loop below. With
    # several hardcoded CAMPAIGN_DEFINITIONS, that's N full re-computations
    # of the heaviest query in the codebase per page load — this endpoint
    # was hanging past a 30s timeout. Materialize member_profile once,
    # then run each campaign's cheap filter/aggregate against that.
    db.execute(text("DROP TABLE IF EXISTS _marketing_member_profile"))
    db.execute(text(f"""
        CREATE TEMP TABLE _marketing_member_profile
        ON COMMIT DROP AS
        {BASE_MARKETING_CTES}
        SELECT * FROM member_profile
    """))
    db.execute(text(
        "CREATE INDEX ON _marketing_member_profile (member_number)"
    ))
    db.execute(text("ANALYZE _marketing_member_profile"))

    for key, campaign in definitions.items():
        if not include_inactive and not campaign.get("is_active", True):
            continue
        sql = f"""
            SELECT
                COUNT(*)::INT AS member_count,
                ROUND(COALESCE(SUM(lifetime_spend), 0)::NUMERIC, 2) AS potential_revenue,
                ROUND(COALESCE(AVG(lifetime_spend), 0)::NUMERIC, 2) AS avg_lifetime_spend,
                ROUND(COALESCE(AVG(paid_revenue), 0)::NUMERIC, 2) AS avg_paid_revenue,
                ROUND(COALESCE(SUM(free_value), 0)::NUMERIC, 2) AS total_free_value,
                COUNT(*) FILTER (WHERE email IS NOT NULL AND TRIM(email) <> '')::INT AS emailable_count,
                COUNT(DISTINCT preferred_season)::INT AS season_count,
                COUNT(DISTINCT preferred_villa)::INT AS villa_count,
                COUNT(DISTINCT preferred_amenity)::INT AS amenity_count,
                COUNT(DISTINCT business_source)::INT AS source_count
            FROM _marketing_member_profile
            WHERE {_validate_sql_piece(campaign['where'], 'where')}
        """
        stats = _rows(db, sql)[0]
        cards.append({
            "key": key,
            "title": campaign["title"],
            "category": campaign["category"],
            "description": campaign["description"],
            "where": campaign["where"],
            "reason": campaign["reason"],
            "sort": campaign["sort"],
            "isActive": bool(campaign.get("is_active", True)),
            "isCustom": bool(campaign.get("is_custom", False)),
            "memberCount": stats.get("member_count", 0),
            "emailableCount": stats.get("emailable_count", 0),
            "potentialRevenue": float(stats.get("potential_revenue") or 0),
            "avgLifetimeSpend": float(stats.get("avg_lifetime_spend") or 0),
            "avgPaidRevenue": float(stats.get("avg_paid_revenue") or 0),
            "totalFreeValue": float(stats.get("total_free_value") or 0),
            "seasonCount": stats.get("season_count", 0),
            "villaCount": stats.get("villa_count", 0),
            "amenityCount": stats.get("amenity_count", 0),
            "sourceCount": stats.get("source_count", 0),
        })

    return {"campaigns": cards}


@router.post("/ml/marketing-campaigns")
def create_marketing_campaign(payload: CampaignPayload, db: Session = Depends(get_db)):
    _ensure_campaign_table(db)
    key = _slug(payload.key or payload.title)
    existing = _get_campaign_definitions(db, include_inactive=True)
    if key in existing:
        raise HTTPException(status_code=409, detail="Campaign key already exists. Use edit instead.")
    sql_parts = _payload_sql_parts(payload)
    db.execute(text("""
        INSERT INTO marketing_campaign_definitions
            (campaign_key, title, category, description, where_sql, reason_sql, sort_sql, is_active, is_custom)
        VALUES
            (:key, :title, :category, :description, :where_sql, :reason_sql, :sort_sql, :is_active, TRUE)
    """), {
        "key": key,
        "title": payload.title.strip(),
        "category": payload.category.strip(),
        "description": payload.description.strip(),
        "where_sql": sql_parts["where"],
        "reason_sql": sql_parts["reason"],
        "sort_sql": sql_parts["sort"],
        "is_active": payload.is_active,
    })
    db.commit()
    return {"ok": True, "key": key}


@router.put("/ml/marketing-campaigns/{campaign_key}")
def update_marketing_campaign(campaign_key: str, payload: CampaignPayload, db: Session = Depends(get_db)):
    _ensure_campaign_table(db)
    existing = _get_campaign_definitions(db, include_inactive=True)
    if campaign_key not in existing:
        raise HTTPException(status_code=404, detail="Unknown marketing campaign")
    is_custom = bool(existing[campaign_key].get("is_custom", False))
    sql_parts = _payload_sql_parts(payload)
    db.execute(text("""
        INSERT INTO marketing_campaign_definitions
            (campaign_key, title, category, description, where_sql, reason_sql, sort_sql, is_active, is_custom, updated_at)
        VALUES
            (:key, :title, :category, :description, :where_sql, :reason_sql, :sort_sql, :is_active, :is_custom, NOW())
        ON CONFLICT (campaign_key) DO UPDATE SET
            title = EXCLUDED.title,
            category = EXCLUDED.category,
            description = EXCLUDED.description,
            where_sql = EXCLUDED.where_sql,
            reason_sql = EXCLUDED.reason_sql,
            sort_sql = EXCLUDED.sort_sql,
            is_active = EXCLUDED.is_active,
            is_custom = EXCLUDED.is_custom,
            updated_at = NOW()
    """), {
        "key": campaign_key,
        "title": payload.title.strip(),
        "category": payload.category.strip(),
        "description": payload.description.strip(),
        "where_sql": sql_parts["where"],
        "reason_sql": sql_parts["reason"],
        "sort_sql": sql_parts["sort"],
        "is_active": payload.is_active,
        "is_custom": is_custom,
    })
    db.commit()
    return {"ok": True, "key": campaign_key}


@router.patch("/ml/marketing-campaigns/{campaign_key}/status")
def set_marketing_campaign_status(campaign_key: str, payload: CampaignStatusPayload, db: Session = Depends(get_db)):
    existing = _get_campaign_definitions(db, include_inactive=True)
    if campaign_key not in existing:
        raise HTTPException(status_code=404, detail="Unknown marketing campaign")
    campaign = existing[campaign_key]
    db.execute(text("""
        INSERT INTO marketing_campaign_definitions
            (campaign_key, title, category, description, where_sql, reason_sql, sort_sql, is_active, is_custom, updated_at)
        VALUES
            (:key, :title, :category, :description, :where_sql, :reason_sql, :sort_sql, :is_active, :is_custom, NOW())
        ON CONFLICT (campaign_key) DO UPDATE SET
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
    """), {
        "key": campaign_key,
        "title": campaign["title"],
        "category": campaign["category"],
        "description": campaign["description"],
        "where_sql": campaign["where"],
        "reason_sql": campaign["reason"],
        "sort_sql": campaign["sort"],
        "is_active": payload.is_active,
        "is_custom": bool(campaign.get("is_custom", False)),
    })
    db.commit()
    return {"ok": True, "key": campaign_key, "isActive": payload.is_active}


@router.delete("/ml/marketing-campaigns/{campaign_key}")
def delete_marketing_campaign(campaign_key: str, db: Session = Depends(get_db)):
    existing = _get_campaign_definitions(db, include_inactive=True)
    if campaign_key not in existing:
        raise HTTPException(status_code=404, detail="Unknown marketing campaign")
    if existing[campaign_key].get("is_custom"):
        db.execute(text("DELETE FROM marketing_campaign_definitions WHERE campaign_key = :key"), {"key": campaign_key})
        db.commit()
        return {"ok": True, "deleted": True}
    # Built-in campaigns are disabled instead of physically deleted.
    set_marketing_campaign_status(campaign_key, CampaignStatusPayload(is_active=False), db)
    return {"ok": True, "deleted": False, "disabled": True}


@router.get("/ml/marketing-campaigns/{campaign_key}/members")
def marketing_campaign_members(
    campaign_key: str,
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
):
    """Return marketing-ready member rows for one campaign export/drawer."""
    definitions = _get_campaign_definitions(db, include_inactive=True)
    if campaign_key not in definitions:
        raise HTTPException(status_code=404, detail="Unknown marketing campaign")

    campaign = definitions[campaign_key]
    rows = _rows(
        db,
        _campaign_sql(campaign_key, campaign, limit=limit),
        {"limit": limit, "campaign_title": campaign["title"]},
    )

    return {
        "campaign": {
            "key": campaign_key,
            "title": campaign["title"],
            "category": campaign["category"],
            "description": campaign["description"],
        },
        "members": rows,
    }
