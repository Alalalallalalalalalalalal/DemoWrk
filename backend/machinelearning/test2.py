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
  amenity_revenue        – total amenity revenue + transaction count per amenity.
  seasonal_visits        – aggregated visits + avg stay per calendar month.
  marketing_targets      – member_number, segment_name, campaign.

Season definition tables are now handled in machinelearning/season_tables.py:
  season_groups          – group definitions for Business/Custom seasons.
  seasons                – editable recurring season definitions, linked to a group.
  member_seasons         – per-member seasonal visit summary.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy import create_engine, text

try:
    from .season_tables import build_season_tables
except ImportError:  # Allows running this file directly as a script.
    from machinelearning.season_tables import build_season_tables

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


def _table_columns(table_name: str) -> set[str]:
    """Return actual database columns for a public table."""
    cols = _query(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :table_name
        """,
        {"table_name": table_name},
    )
    return set(cols["column_name"].astype(str))


def _member_name_select_expr(columns: set[str], alias: str = "") -> str:
    """Build a safe member-name SQL expression using columns that actually exist."""
    prefix = f"{alias}." if alias else ""

    for col in ("member_name", "full_name", "name", "display_name"):
        if col in columns:
            return f"NULLIF(TRIM({prefix}{col}::text), '')"

    first_options = [c for c in ("first_name", "firstname", "given_name") if c in columns]
    last_options = [c for c in ("last_name", "lastname", "surname", "family_name") if c in columns]
    if first_options or last_options:
        first = f"COALESCE({prefix}{first_options[0]}::text, '')" if first_options else "''"
        last = f"COALESCE({prefix}{last_options[0]}::text, '')" if last_options else "''"
        return f"NULLIF(TRIM(CONCAT_WS(' ', {first}, {last})), '')"

    return "NULL::text"


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %s  (%d rows)", table, len(df))


def _raw_connection():
    """Raw psycopg2 connection from the same SQLAlchemy engine."""
    return get_engine().raw_connection()


# ─────────────────────────────────────────────────────────
# AMENITY CLASSIFICATION
# ─────────────────────────────────────────────────────────

# One source of truth for amenity classification.
# Anything that does not match these patterns is excluded from amenity outputs,
# instead of being bucketed as "Other". Villa rentals, airport transfers,
# transportation, and membership dues/fees are intentionally excluded.
AMENITY_PATTERNS = {
    "Spa": r"\b(spa|massage|facial)\b",
    "Golf": r"\b(golf|pro shop|cart)\b",
    "Grill": r"\bgrill\b",
    "Bar": r"\bbar\b",
    "Restaurant": r"\b(restaurant|dinner|lunch|breakfast)\b",
    "Tennis": r"\btennis\b",
    "Retail": r"\b(boutique|shop|commissary)\b",
}
_AMENITY_COMPILED = {
    name: re.compile(pattern, re.IGNORECASE)
    for name, pattern in AMENITY_PATTERNS.items()
}

EXCLUDED_AMENITY_PATTERNS = re.compile(
    r"\b(villa|rental|airport|transfer|shuttle|transport|transportation|membership|dues|fee)\b",
    re.IGNORECASE,
)


def classify_amenity(description: str) -> str | None:
    """Return one canonical amenity bucket, or None when the row is not an amenity."""
    if pd.isna(description):
        return None

    desc = str(description)
    if EXCLUDED_AMENITY_PATTERNS.search(desc):
        return None

    for amenity, pattern in _AMENITY_COMPILED.items():
        if pattern.search(desc):
            return amenity
    return None


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
    raw_count = len(df)
    df = df[df["amenity"].notna()].copy()
    log.info("Loaded amenity folios: %d rows  (excluded non-amenity rows: %d)", len(df), raw_count - len(df))
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
    member_columns = _table_columns("members")
    member_name_expr = _member_name_select_expr(member_columns)

    df = _query(
        f"""
        SELECT
            member_number,
            {member_name_expr} AS member_name,
            status,
            member_type
        FROM members
        WHERE member_type IN ({placeholders})
        """,
        params=params,
    )
    missing_names = df["member_name"].isna().sum() if "member_name" in df else len(df)
    log.info("Loaded members: %d rows  (missing member_name=%d)", len(df), missing_names)
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
        "member_name",
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
    targets = member_segments[["member_number", "member_name", "segment_name", "campaign"]].copy()
    _save(targets, "marketing_targets")
    return targets


# ─────────────────────────────────────────────────────────
# SEASON TABLES ENTRY POINT
# ─────────────────────────────────────────────────────────

def build_specific_tables(dry_run: bool = False, recreate: bool = False) -> None:
    """Build separated seasonal analytics tables from season_tables.py."""
    conn = _raw_connection()
    try:
        build_season_tables(conn, dry_run=dry_run, recreate=recreate)
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
        member_segments = build_member_segments(members, rooms, folios, member_amenity_usage)
        build_marketing_targets(member_segments)

    if not skip_specific:
        build_specific_tables(dry_run=dry_run, recreate=recreate_specific_tables)

    log.info("=== ML Insights pipeline complete ===")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build all ML insights plus seasons and member_seasons."
    )
    parser.add_argument("--dry-run", action="store_true", help="Read/classify data but do not write tables")
    parser.add_argument(
        "--recreate-specific-tables",
        action="store_true",
        help="Drop/recreate seasons and member_seasons before building",
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
