"""
backend/machinelearning/ml_insights.py
--------------
Builds and persists all ML-derived insight tables used by the analytics API.

Tables written to PostgreSQL
─────────────────────────────
  member_segments        – one row per member: segment label, spend, visits,
                           recency, active/inactive, and campaign assignment.
  member_amenity_usage   – per-member × per-amenity usage count + spend.
  amenity_adoption       – how many distinct members used each amenity.
  amenity_revenue        – total revenue + transaction count per amenity.
  seasonal_visits        – aggregated visits + avg stay per calendar month.
  airport_transfer_users – top members by ground-transport booking count.
  marketing_targets      – member_number, segment_name, campaign.

Merged from specfic_tb.py, table names unchanged:
  season_groups          – group definitions for Business/Simple/Custom seasons.
  seasons                – editable recurring season definitions, linked to a group.
  amenity_spend          – per-member spend and visit counts per amenity type.
  member_seasons         – per-member seasonal visit summary.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from psycopg2.extras import execute_values
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy import create_engine, text

# ─────────────────────────────────────────────────────────
# CONFIG / DB HELPERS
# ─────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[1]  # backend/
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

_engine = None


def get_engine():
    """Lazily build the SQLAlchemy engine so import never raises."""
    global _engine
    if _engine is None:
        required = ["DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_NAME"]
        missing = [key for key in required if not os.getenv(key)]
        if missing:
            raise EnvironmentError(f"Missing env vars: {missing}")

        url = (
            f"postgresql+psycopg2://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
            f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
        )
        _engine = create_engine(url)
    return _engine


def _query(sql: str, params: dict | None = None) -> pd.DataFrame:
    with get_engine().connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %s  (%d rows)", table, len(df))


def _raw_connection():
    """Raw psycopg2 connection from the same SQLAlchemy engine."""
    return get_engine().raw_connection()


# ─────────────────────────────────────────────────────────
# AMENITY CLASSIFICATION
# ─────────────────────────────────────────────────────────

ML_AMENITY_RULES = [
    ("Spa", ("spa", "massage", "facial")),
    ("Golf", ("golf", "pro shop", "cart")),
    ("Grill", ("grill",)),
    ("Bar", ("bar",)),
    ("Restaurant", ("restaurant", "dinner", "lunch", "breakfast")),
    ("Tennis", ("tennis",)),
    ("Retail", ("boutique", "shop", "commissary")),
    ("Villa Rental", ("villa", "rental")),
    ("Transportation", ("airport", "transfer", "transport")),
    ("Membership", ("membership", "dues", "fee")),
]

SPECIFIC_AMENITY_PATTERNS = {
    "Golf": r"\bgolf\b",
    "Tennis": r"\btennis\b",
    "Bar": r"\bbar\b",
    "Grill": r"\bgrill\b",
    "Boutique": r"\bboutique\b",
    "Airport Transfer": r"\bairport\s*(transfer|shuttle|transport)\b",
    "Breakfast": r"\bbreakfast\b",
    "Lunch": r"\blunch\b",
    "Dinner": r"\bdinner\b",
    "Restaurant": r"\brestaurant\b",
}
_SPECIFIC_COMPILED = {
    name: re.compile(pattern, re.IGNORECASE)
    for name, pattern in SPECIFIC_AMENITY_PATTERNS.items()
}


def classify_amenity(description: str) -> str:
    """Return one canonical amenity bucket for the ML insights pipeline."""
    if pd.isna(description):
        return "Other"

    desc = str(description).lower()
    for amenity, keywords in ML_AMENITY_RULES:
        if any(keyword in desc for keyword in keywords):
            return amenity
    return "Other"


def classify_specific_amenities(description: str) -> list[str]:
    """
    Return every specific amenity matched by a folio description.
    Used for the merged amenity_spend table from specfic_tb.py.
    """
    if not description:
        return []

    matched = [
        name
        for name, pattern in _SPECIFIC_COMPILED.items()
        if pattern.search(str(description))
    ]
    meal_subtypes = {"Breakfast", "Lunch", "Dinner"}
    if "Restaurant" in matched and set(matched) & meal_subtypes:
        matched = [name for name in matched if name != "Restaurant"]
    return matched


# ─────────────────────────────────────────────────────────
# DATA LOADERS
# ─────────────────────────────────────────────────────────

def _load_folios() -> pd.DataFrame:
    df = _query("""
        SELECT
            member_number AS member_id,
            description,
            amount,
            transaction_date,
            check_in_date,
            check_out_date
        FROM folios
        WHERE member_number IS NOT NULL
    """)
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["amenity"] = df["description"].apply(classify_amenity)
    log.info("Loaded folios: %d rows", len(df))
    return df


def _load_rooms() -> pd.DataFrame:
    df = _query("""
        SELECT member_number, check_in_date, check_out_date
        FROM rooms
        WHERE check_in_date IS NOT NULL
    """)
    df["check_in_date"] = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"] = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["length_of_stay"] = (df["check_out_date"] - df["check_in_date"]).dt.days
    log.info("Loaded rooms: %d rows", len(df))
    return df


RELEVANT_MEMBER_TYPES = (
    "Guests",
    "Dependent",
    "Golf Guest",
    "Spa Outside Guests",
    "Family Dependent",
    "Proprietary Members",
    "Group/Tournament Accounts",
    "Non-Proprietary Members",
    "Overseas Golf Members",
    "Overseas Standard Members",
    "Honorary Members",
    "Resident Members",
)


def _load_members() -> pd.DataFrame:
    placeholders = ", ".join(f":{i}" for i in range(len(RELEVANT_MEMBER_TYPES)))
    params = {str(i): value for i, value in enumerate(RELEVANT_MEMBER_TYPES)}
    df = _query(
        f"""
        SELECT member_number, status, member_type
        FROM members
        WHERE member_type IN ({placeholders})
        """,
        params=params,
    )
    log.info("Loaded members: %d rows  (filtered to relevant member types)", len(df))
    return df


# ─────────────────────────────────────────────────────────
# ORIGINAL ML INSIGHT TABLES
# ─────────────────────────────────────────────────────────

def build_member_amenity_usage(folios: pd.DataFrame) -> pd.DataFrame:
    usage = (
        folios.groupby(["member_id", "amenity"])
        .agg(usage_count=("description", "count"), total_spend=("amount", "sum"))
        .reset_index()
    )
    _save(usage, "member_amenity_usage")
    return usage


def build_amenity_adoption(member_amenity_usage: pd.DataFrame) -> pd.DataFrame:
    adoption = (
        member_amenity_usage.groupby("amenity")
        .agg(members_using=("member_id", "nunique"))
        .reset_index()
        .sort_values("members_using", ascending=False)
    )
    _save(adoption, "amenity_adoption")
    return adoption


def build_amenity_revenue(folios: pd.DataFrame) -> pd.DataFrame:
    revenue = (
        folios.groupby("amenity")
        .agg(revenue=("amount", "sum"), transactions=("amount", "count"))
        .reset_index()
        .sort_values("revenue", ascending=False)
    )
    _save(revenue, "amenity_revenue")
    return revenue


def build_seasonal_visits(rooms: pd.DataFrame) -> pd.DataFrame:
    seasonal = (
        rooms.dropna(subset=["check_in_date"])
        .assign(month=lambda df: df["check_in_date"].dt.strftime("%Y-%m"))
        .groupby("month")
        .agg(visits=("member_number", "count"), avg_stay=("length_of_stay", "mean"))
        .reset_index()
        .sort_values("month")
    )
    seasonal["avg_stay"] = seasonal["avg_stay"].round(2)
    _save(seasonal, "seasonal_visits")
    return seasonal


def build_airport_transfer_users(folios: pd.DataFrame) -> pd.DataFrame:
    transfers = (
        folios[folios["amenity"] == "Transportation"]
        .groupby("member_id")
        .agg(transfers=("amenity", "count"), total_spend=("amount", "sum"))
        .reset_index()
        .sort_values("transfers", ascending=False)
    )
    _save(transfers, "airport_transfer_users")
    return transfers


def _build_feature_matrix(
    members: pd.DataFrame,
    rooms: pd.DataFrame,
    folios: pd.DataFrame,
    member_amenity_usage: pd.DataFrame,
) -> tuple[pd.DataFrame, list[str]]:
    visit_features = (
        rooms.groupby("member_number")
        .agg(
            visit_count=("member_number", "count"),
            avg_stay=("length_of_stay", "mean"),
            last_visit=("check_out_date", "max"),
        )
        .reset_index()
    )

    spend_features = (
        folios.groupby("member_id")
        .agg(total_spend=("amount", "sum"), avg_spend=("amount", "mean"))
        .reset_index()
        .rename(columns={"member_id": "member_number"})
    )

    amenity_diversity = (
        folios.groupby("member_id")
        .agg(amenity_diversity=("amenity", "nunique"))
        .reset_index()
        .rename(columns={"member_id": "member_number"})
    )

    amenity_pivot = (
        member_amenity_usage.pivot_table(
            index="member_id",
            columns="amenity",
            values="usage_count",
            fill_value=0,
        )
        .reset_index()
    )
    amenity_pivot.columns.name = None
    amenity_cols = [col for col in amenity_pivot.columns if col != "member_id"]

    favorite_amenity = (
        member_amenity_usage.loc[
            member_amenity_usage.groupby("member_id")["usage_count"].idxmax()
        ][["member_id", "amenity"]]
        .rename(columns={"amenity": "favorite_amenity"})
    )

    for frame, column in (
        (members, "member_number"),
        (visit_features, "member_number"),
        (spend_features, "member_number"),
        (amenity_diversity, "member_number"),
        (amenity_pivot, "member_id"),
        (favorite_amenity, "member_id"),
    ):
        frame[column] = frame[column].astype(str)

    df = (
        members.merge(visit_features, on="member_number", how="left")
        .merge(spend_features, on="member_number", how="left")
        .merge(amenity_diversity, on="member_number", how="left")
        .merge(amenity_pivot, left_on="member_number", right_on="member_id", how="left")
        .drop(columns=["member_id"], errors="ignore")
        .merge(favorite_amenity, left_on="member_number", right_on="member_id", how="left")
        .drop(columns=["member_id"], errors="ignore")
    )

    log.info("favorite_amenity matched %d / %d members", df["favorite_amenity"].notna().sum(), len(df))

    fill_cols = [
        "visit_count",
        "avg_stay",
        "total_spend",
        "avg_spend",
        "amenity_diversity",
        *amenity_cols,
    ]
    for col in fill_cols:
        df[col] = df.get(col, 0).fillna(0)

    today = pd.Timestamp.today().normalize()
    df["last_visit"] = pd.to_datetime(df["last_visit"], errors="coerce")
    df["days_since_last_visit"] = (today - df["last_visit"]).dt.days.fillna(9999).clip(lower=0)
    df["is_active"] = df["days_since_last_visit"] <= 365

    return df, amenity_cols


def _assign_segment(row: pd.Series, p90_spend: float) -> str:
    if row["total_spend"] > 0 and row["total_spend"] >= p90_spend:
        return "High Value Guest"
    if not row["is_active"]:
        return "At Risk"
    if row.get("favorite_amenity") == "Transportation":
        return "Corporate Traveler"
    if row["avg_stay"] >= 7:
        return "Long Stay Guest"
    if row.get("favorite_amenity") == "Golf":
        return "Golf Enthusiast"
    if row.get("favorite_amenity") == "Spa":
        return "Spa & Wellness"
    return "Regular Member"


SEASON_MONTHS = {
    "Spring": {1, 2, 3},
    "Summer": {4, 5, 6, 7},
    "Late Summer": {8},
    "Autumn": {9, 10},
    "Winter": {11, 12},
}

SEASON_CAMPAIGNS = {
    "Spring": "Spring Season Offer",
    "Summer": "Summer Season Offer",
    "Late Summer": "Late Summer Season Offer",
    "Autumn": "Autumn Season Offer",
    "Winter": "Winter Season Offer",
}

AMENITY_CAMPAIGNS = {
    "Spa": "Spa Promotion",
    "Golf": "Golf Promotion",
    "Grill": "Dining & Events Invite",
    "Bar": "Dining & Events Invite",
    "Restaurant": "Dining & Events Invite",
    "Tennis": "Tennis Programme",
    "Retail": "Retail & Boutique Offer",
    "Villa Rental": "Villa Exclusive Offer",
    "Transportation": "Airport Transfer Package",
    "Membership": "Membership Renewal Reminder",
    "Other": None,
}

SEGMENT_CAMPAIGNS = {
    "High Value Guest": "VIP Retention Campaign",
    "At Risk": "Win-Back Campaign",
    "Corporate Traveler": "Airport Transfer Package",
    "Long Stay Guest": "Extended Stay Offer",
    "Golf Enthusiast": "Golf Promotion",
    "Spa & Wellness": "Spa Promotion",
}


def _build_season_visitors(rooms: pd.DataFrame) -> dict[str, set[str]]:
    season_sets: dict[str, set[str]] = {}
    for season, months in SEASON_MONTHS.items():
        visitors = (
            rooms[rooms["check_in_date"].dt.month.isin(months)]
            .groupby("member_number")
            .size()
            .reset_index(name="visits")
        )
        season_sets[season] = set(visitors[visitors["visits"] >= 2]["member_number"].astype(str))
        log.info("Season '%s' visitors (≥2 stays): %d", season, len(season_sets[season]))
    return season_sets


def _assign_campaign(row: pd.Series, season_visitors: dict[str, set[str]]) -> str:
    parts = [SEGMENT_CAMPAIGNS.get(row["segment_name"], "General Newsletter")]

    amenity_campaign = AMENITY_CAMPAIGNS.get(row.get("favorite_amenity", ""))
    if amenity_campaign and amenity_campaign not in parts:
        parts.append(amenity_campaign)

    member = str(row["member_number"])
    for season, campaign in SEASON_CAMPAIGNS.items():
        if member in season_visitors.get(season, set()):
            parts.append(campaign)

    return " | ".join(parts)


def build_member_segments(
    members: pd.DataFrame,
    rooms: pd.DataFrame,
    folios: pd.DataFrame,
    member_amenity_usage: pd.DataFrame,
    n_clusters: int = 5,
) -> pd.DataFrame:
    feature_df, amenity_cols = _build_feature_matrix(members, rooms, folios, member_amenity_usage)
    cluster_features = [
        "total_spend",
        "avg_spend",
        "visit_count",
        "avg_stay",
        "days_since_last_visit",
        "amenity_diversity",
        *amenity_cols,
    ]

    X = feature_df[cluster_features].fillna(0)
    if len(feature_df) >= n_clusters * 5:
        feature_df["cluster_id"] = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit_predict(
            StandardScaler().fit_transform(X)
        )
    else:
        feature_df["cluster_id"] = 0

    spenders = feature_df[feature_df["total_spend"] > 0]["total_spend"]
    p90_spend = spenders.quantile(0.90) if len(spenders) >= 10 else float("inf")

    feature_df["segment_name"] = feature_df.apply(lambda row: _assign_segment(row, p90_spend), axis=1)
    season_visitors = _build_season_visitors(rooms)
    feature_df["campaign"] = feature_df.apply(lambda row: _assign_campaign(row, season_visitors), axis=1)

    output_cols = [
        "member_number",
        "status",
        "member_type",
        "is_active",
        "segment_name",
        "total_spend",
        "avg_spend",
        "visit_count",
        "avg_stay",
        "days_since_last_visit",
        "campaign",
    ]
    member_segments = feature_df[output_cols].copy()
    for col in ["avg_stay", "avg_spend", "total_spend"]:
        member_segments[col] = member_segments[col].round(2)

    _save(member_segments, "member_segments")
    return member_segments


def build_marketing_targets(member_segments: pd.DataFrame) -> pd.DataFrame:
    targets = member_segments[["member_number", "segment_name", "campaign"]].copy()
    _save(targets, "marketing_targets")
    return targets


# ─────────────────────────────────────────────────────────
# MERGED specfic_tb.py TABLES
# ─────────────────────────────────────────────────────────

DEFAULT_SEASONS = [
    ("High Season 1", 1, 3, 3, 6),
    ("Spring Break", 3, 7, 3, 27),
    ("High Season 2", 3, 28, 4, 24),
    ("Shoulder Season 1", 4, 25, 7, 24),
    ("Summer Season", 7, 25, 10, 30),
    ("Shoulder Season 2", 10, 31, 11, 20),
    ("Thanksgiving", 11, 21, 11, 28),
    ("Shoulder Season 3", 11, 29, 12, 11),
    ("High Season 3", 12, 12, 12, 18),
    ("Festive", 12, 19, 1, 3),
]

SIMPLE_SEASONS = [
    ("Spring", 1, 1, 3, 31),
    ("Summer", 4, 1, 7, 31),
    ("Late Summer", 8, 1, 8, 31),
    ("Autumn", 9, 1, 10, 31),
    ("Winter", 11, 1, 12, 31),
]

SPECIFIC_DDL = """
CREATE TABLE IF NOT EXISTS season_groups (
    id          SERIAL PRIMARY KEY,
    group_name  VARCHAR(100) NOT NULL UNIQUE,
    group_type  VARCHAR(20)  NOT NULL DEFAULT 'custom'
                CHECK (group_type IN ('business', 'simple', 'custom')),
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasons (
    id              SERIAL PRIMARY KEY,
    group_id        INTEGER REFERENCES season_groups(id) ON DELETE SET NULL,
    season_name     VARCHAR(100) NOT NULL,
    start_month     INTEGER      NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    start_day       INTEGER      NOT NULL CHECK (start_day BETWEEN 1 AND 31),
    end_month       INTEGER      NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    end_day         INTEGER      NOT NULL CHECK (end_day BETWEEN 1 AND 31),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (group_id, season_name, start_month, start_day, end_month, end_day)
);

CREATE TABLE IF NOT EXISTS amenity_spend (
    id              SERIAL PRIMARY KEY,
    member_number   VARCHAR(50),
    amenity_type    VARCHAR(100) NOT NULL,
    total_spent     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    visit_count     INTEGER       NOT NULL DEFAULT 0,
    last_visit_date DATE,
    UNIQUE (member_number, amenity_type)
);

CREATE TABLE IF NOT EXISTS member_seasons (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50),
    season_id           INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    season_name         VARCHAR(100) NOT NULL,
    visit_count         INTEGER      NOT NULL DEFAULT 0,
    total_nights        INTEGER      NOT NULL DEFAULT 0,
    first_check_in      DATE,
    last_check_out      DATE,
    top_villa           VARCHAR(255),
    top_bedroom_count   INTEGER,
    UNIQUE (member_number, season_id)
);
"""

DROP_SPECIFIC_ANALYTICS = "DROP TABLE IF EXISTS amenity_spend, member_seasons, seasons, season_groups CASCADE;"


def create_specific_tables(conn, recreate: bool = False) -> None:
    with conn.cursor() as cur:
        if recreate:
            log.info("Dropping specific analytics tables...")
            cur.execute(DROP_SPECIFIC_ANALYTICS)

        log.info("Creating specific analytics tables if not exist...")
        cur.execute(SPECIFIC_DDL)

        # Migration-safe upgrades for databases that already had a seasons table.
        cur.execute("""
            ALTER TABLE seasons
            ADD COLUMN IF NOT EXISTS group_id INTEGER
        """)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'seasons_group_id_fkey'
                ) THEN
                    ALTER TABLE seasons
                    ADD CONSTRAINT seasons_group_id_fkey
                    FOREIGN KEY (group_id)
                    REFERENCES season_groups(id)
                    ON DELETE SET NULL;
                END IF;
            END $$;
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS seasons_group_definition_unique_idx
            ON seasons (group_id, season_name, start_month, start_day, end_month, end_day)
        """)
    conn.commit()


def _get_or_create_season_group(conn, group_name: str, group_type: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO season_groups (group_name, group_type)
            VALUES (%s, %s)
            ON CONFLICT (group_name) DO UPDATE SET
                group_type = EXCLUDED.group_type
            RETURNING id
            """,
            (group_name, group_type),
        )
        row = cur.fetchone()
    return int(row[0])


def _seed_group_seasons(conn, group_id: int, seasons: list[tuple], dry_run: bool = False) -> int:
    values = [(group_id, name, sm, sd, em, ed, True) for name, sm, sd, em, ed in seasons]
    if dry_run:
        return len(values)

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO seasons
                (group_id, season_name, start_month, start_day, end_month, end_day, is_active)
            VALUES %s
            ON CONFLICT (group_id, season_name, start_month, start_day, end_month, end_day) DO NOTHING
            """,
            values,
        )
    return len(values)


def seed_seasons(conn, dry_run: bool = False) -> None:
    if dry_run:
        log.info(
            "[DRY RUN] Would seed season groups plus %d business and %d simple season rows",
            len(DEFAULT_SEASONS),
            len(SIMPLE_SEASONS),
        )
        return

    business_group_id = _get_or_create_season_group(conn, "Business Seasons", "business")
    simple_group_id = _get_or_create_season_group(conn, "Simple Seasons", "simple")

    # Any seasons from the old schema become Business Seasons.
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE seasons
            SET group_id = %s
            WHERE group_id IS NULL
            """,
            (business_group_id,),
        )

    business_count = _seed_group_seasons(conn, business_group_id, DEFAULT_SEASONS)
    simple_count = _seed_group_seasons(conn, simple_group_id, SIMPLE_SEASONS)

    conn.commit()
    log.info(
        "Seeded season groups. Business=%d rows, Simple=%d rows; existing definitions skipped",
        business_count,
        simple_count,
    )


def load_active_seasons(conn, group_type: str = "business") -> list[tuple]:
    """
    Used by member_seasons. Defaults to Business Seasons so overlapping Simple/Custom
    groups do not double-count the same visit in this backend summary table.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.season_name, s.start_month, s.start_day, s.end_month, s.end_day
            FROM seasons s
            JOIN season_groups sg ON sg.id = s.group_id
            WHERE s.is_active = TRUE
              AND sg.group_type = %s
            ORDER BY s.start_month, s.start_day
            """,
            (group_type,),
        )
        return cur.fetchall()


def season_for_date(value: date | None, seasons: list[tuple]) -> tuple[int | None, str | None]:
    if value is None:
        return None, None

    md = (value.month, value.day)
    for season_id, name, start_month, start_day, end_month, end_day in seasons:
        start_md = (start_month, start_day)
        end_md = (end_month, end_day)
        if start_md <= end_md and start_md <= md <= end_md:
            return season_id, name
        if start_md > end_md and (md >= start_md or md <= end_md):
            return season_id, name
    return None, None


def build_amenity_spend(conn, dry_run: bool = False) -> int:
    log.info("Building amenity_spend from folios...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT member_number, description, amount, transaction_date
            FROM folios
            WHERE member_number IS NOT NULL
              AND description IS NOT NULL
        """)
        rows = cur.fetchall()

    agg: dict[tuple[str, str], dict] = {}
    for member_number, description, amount, txn_date in rows:
        for amenity in classify_specific_amenities(description):
            key = (str(member_number), amenity)
            if key not in agg:
                agg[key] = {"total_spent": 0.0, "visit_count": 0, "last_visit_date": None}
            agg[key]["total_spent"] += float(amount) if amount is not None else 0.0
            agg[key]["visit_count"] += 1
            if txn_date:
                previous = agg[key]["last_visit_date"]
                agg[key]["last_visit_date"] = txn_date if previous is None or txn_date > previous else previous

    output_rows = [
        (member_number, amenity, round(values["total_spent"], 2), values["visit_count"], values["last_visit_date"])
        for (member_number, amenity), values in agg.items()
    ]

    if dry_run:
        log.info("[DRY RUN] Would replace amenity_spend with %d rows", len(output_rows))
        return len(output_rows)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM amenity_spend")
        if output_rows:
            execute_values(
                cur,
                """
                INSERT INTO amenity_spend
                    (member_number, amenity_type, total_spent, visit_count, last_visit_date)
                VALUES %s
                ON CONFLICT (member_number, amenity_type) DO UPDATE SET
                    total_spent = EXCLUDED.total_spent,
                    visit_count = EXCLUDED.visit_count,
                    last_visit_date = EXCLUDED.last_visit_date
                """,
                output_rows,
                page_size=1000,
            )
    conn.commit()
    log.info("amenity_spend: %d rows written", len(output_rows))
    return len(output_rows)


def build_member_seasons(conn, dry_run: bool = False) -> int:
    log.info("Building member_seasons from folios...")
    active_seasons = load_active_seasons(conn)
    if not active_seasons:
        log.warning("No active seasons found; member_seasons skipped")
        return 0

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT
                member_number,
                conf_code,
                COALESCE(check_in_date, transaction_date) AS season_date,
                check_out_date,
                villa_name,
                bedroom_count
            FROM folios
            WHERE member_number IS NOT NULL
              AND COALESCE(check_in_date, transaction_date) IS NOT NULL
        """)
        rows = cur.fetchall()

    agg: dict[tuple[str, int], dict] = {}
    matched_by_season = Counter()
    skipped_month_days = Counter()
    bad_night_ranges = 0

    for member_number, _conf_code, season_date, check_out, villa_name, bedroom_count in rows:
        season_id, season_name = season_for_date(season_date, active_seasons)
        if not season_id:
            skipped_month_days[(season_date.month, season_date.day)] += 1
            continue

        matched_by_season[season_name] += 1
        nights = 0
        if check_out:
            nights = (check_out - season_date).days
            if nights < 0:
                bad_night_ranges += 1
                nights = 0

        key = (str(member_number), season_id)
        if key not in agg:
            agg[key] = {
                "season_name": season_name,
                "visit_count": 0,
                "total_nights": 0,
                "first_check_in": None,
                "last_check_out": None,
                "villa_counts": Counter(),
                "bedroom_counts": Counter(),
            }

        agg[key]["visit_count"] += 1
        agg[key]["total_nights"] += nights
        previous = agg[key]["first_check_in"]
        agg[key]["first_check_in"] = season_date if previous is None or season_date < previous else previous
        if check_out:
            previous = agg[key]["last_check_out"]
            agg[key]["last_check_out"] = check_out if previous is None or check_out > previous else previous
        if villa_name:
            agg[key]["villa_counts"][villa_name] += 1
        if bedroom_count is not None:
            agg[key]["bedroom_counts"][bedroom_count] += 1

    if matched_by_season:
        log.info("Matched by season: %s", ", ".join(f"{name}={count}" for name, count in matched_by_season.most_common()))
    if skipped_month_days:
        log.warning("Top skipped month/day values: %s", ", ".join(f"{m:02d}-{d:02d}={count}" for (m, d), count in skipped_month_days.most_common(10)))
    if bad_night_ranges:
        log.warning("Bad night ranges clamped to 0: %d", bad_night_ranges)

    output_rows = [
        (
            member_number,
            season_id,
            values["season_name"],
            values["visit_count"],
            values["total_nights"],
            values["first_check_in"],
            values["last_check_out"],
            values["villa_counts"].most_common(1)[0][0] if values["villa_counts"] else None,
            values["bedroom_counts"].most_common(1)[0][0] if values["bedroom_counts"] else None,
        )
        for (member_number, season_id), values in agg.items()
    ]

    if dry_run:
        log.info("[DRY RUN] Would replace member_seasons with %d rows", len(output_rows))
        return len(output_rows)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM member_seasons")
        if output_rows:
            execute_values(
                cur,
                """
                INSERT INTO member_seasons
                    (member_number, season_id, season_name, visit_count, total_nights,
                     first_check_in, last_check_out, top_villa, top_bedroom_count)
                VALUES %s
                ON CONFLICT (member_number, season_id) DO UPDATE SET
                    season_name = EXCLUDED.season_name,
                    visit_count = EXCLUDED.visit_count,
                    total_nights = EXCLUDED.total_nights,
                    first_check_in = EXCLUDED.first_check_in,
                    last_check_out = EXCLUDED.last_check_out,
                    top_villa = EXCLUDED.top_villa,
                    top_bedroom_count = EXCLUDED.top_bedroom_count
                """,
                output_rows,
                page_size=1000,
            )
    conn.commit()
    log.info("member_seasons: %d rows written", len(output_rows))
    return len(output_rows)


def build_specific_tables(dry_run: bool = False, recreate: bool = False) -> None:
    conn = _raw_connection()
    try:
        create_specific_tables(conn, recreate=recreate)
        seed_seasons(conn, dry_run=dry_run)
        build_amenity_spend(conn, dry_run=dry_run)
        build_member_seasons(conn, dry_run=dry_run)
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────

def build_insights(
    *,
    dry_run: bool = False,
    recreate_specific_tables: bool = False,
    skip_specific: bool = False,
) -> None:
    log.info("=== ML Insights pipeline starting ===")

    folios = _load_folios()
    rooms = _load_rooms()
    members = _load_members()

    if folios.empty:
        log.error("No folio data found — aborting insights pipeline.")
        return

    member_amenity_usage = (
        folios.groupby(["member_id", "amenity"])
        .agg(usage_count=("description", "count"), total_spend=("amount", "sum"))
        .reset_index()
        if dry_run else build_member_amenity_usage(folios)
    )

    if dry_run:
        log.info("[DRY RUN] Would build member_amenity_usage: %d rows", len(member_amenity_usage))
    else:
        build_amenity_adoption(member_amenity_usage)
        build_amenity_revenue(folios)
        build_seasonal_visits(rooms)
        build_airport_transfer_users(folios)
        member_segments = build_member_segments(members, rooms, folios, member_amenity_usage)
        build_marketing_targets(member_segments)

    if not skip_specific:
        build_specific_tables(dry_run=dry_run, recreate=recreate_specific_tables)

    log.info("=== ML Insights pipeline complete ===")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build all ML insights plus seasons, amenity_spend, and member_seasons."
    )
    parser.add_argument("--dry-run", action="store_true", help="Read/classify data but do not write tables")
    parser.add_argument(
        "--recreate-specific-tables",
        action="store_true",
        help="Drop/recreate seasons, amenity_spend, and member_seasons before building",
    )
    parser.add_argument("--skip-specific", action="store_true", help="Only build the original ML insights tables")
    args = parser.parse_args()

    build_insights(
        dry_run=args.dry_run,
        recreate_specific_tables=args.recreate_specific_tables,
        skip_specific=args.skip_specific,
    )


if __name__ == "__main__":
    main()
