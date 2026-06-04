"""
ml_insights.py
--------------
Builds and persists all ML-derived insight tables used by the analytics API.

Tables written to PostgreSQL
─────────────────────────────
  member_segments        – one row per member: cluster, segment label, spend,
                           visits, recency, favorite amenity, active/inactive,
                           and campaign assignment.
  member_amenity_usage   – per-member × per-amenity usage count + spend.
  amenity_adoption       – how many distinct members used each amenity.
  amenity_revenue        – total revenue + transaction count per amenity.
  seasonal_visits        – aggregated visits + avg stay per calendar month.
  airport_transfer_users – top members by ground-transport booking count.
  marketing_targets      – member_number, segment_name, campaign (slim table
                           for targeted marketing queries).

Entry point
───────────
  Call  build_insights()  from a scheduler, pipeline, or CLI.
  Each sub-function can also be called individually for incremental refreshes.
"""

import os
import logging

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from pathlib import Path
from sqlalchemy import create_engine
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

# ─────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[1]   # backend/
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
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            raise EnvironmentError(f"Missing env vars: {missing}")
        url = (
            f"postgresql+psycopg2://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
            f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
        )
        _engine = create_engine(url)
    return _engine


def _query(sql: str, params: dict | None = None) -> pd.DataFrame:
    from sqlalchemy import text as _text
    with get_engine().connect() as conn:
        return pd.read_sql(_text(sql), conn, params=params)


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %s  (%d rows)", table, len(df))


# ─────────────────────────────────────────────────────────
# AMENITY CLASSIFICATION  (single canonical copy)
# ─────────────────────────────────────────────────────────

def classify_amenity(description: str) -> str:
    """Map a free-text folio description to a named amenity bucket."""
    if pd.isna(description):
        return "Other"

    desc = str(description).lower()

    if "spa" in desc or "massage" in desc or "facial" in desc:
        return "Spa"
    if "golf" in desc or "pro shop" in desc or "cart" in desc:
        return "Golf"
    if "grill" in desc:
        return "Grill"
    if "bar" in desc:
        return "Bar"
    if "restaurant" in desc or "dinner" in desc or "lunch" in desc or "breakfast" in desc:
        return "Restaurant"
    if "tennis" in desc:
        return "Tennis"
    if "boutique" in desc or "shop" in desc or "commissary" in desc:
        return "Retail"
    if "villa" in desc or "rental" in desc:
        return "Villa Rental"
    if "airport" in desc or "transfer" in desc or "transport" in desc:
        return "Transportation"
    if "membership" in desc or "dues" in desc or "fee" in desc:
        return "Membership"

    return "Other"


# ─────────────────────────────────────────────────────────
# DATA LOADERS
# ─────────────────────────────────────────────────────────

def _load_folios() -> pd.DataFrame:
    df = _query("""
        SELECT
            COALESCE(member_number, main_member_number) AS member_id,
            description,
            amount,
            transaction_date,
            check_in_date,
            check_out_date
        FROM folios
        WHERE COALESCE(member_number, main_member_number) IS NOT NULL
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


# Member types that have meaningful activity data and are relevant for
# marketing segmentation.  Staff records and other internal accounts are
# excluded so they don't dilute segment quality or skew spend statistics.
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
    params       = {str(i): v for i, v in enumerate(RELEVANT_MEMBER_TYPES)}
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
# 1. AMENITY USAGE PER MEMBER
# ─────────────────────────────────────────────────────────

def build_member_amenity_usage(folios: pd.DataFrame) -> pd.DataFrame:
    """
    How many times each member used each amenity and how much they spent.
    Answers: "amenity use by user"
    """
    usage = (
        folios
        .groupby(["member_id", "amenity"])
        .agg(
            usage_count=("description", "count"),
            total_spend=("amount", "sum"),
        )
        .reset_index()
    )
    _save(usage, "member_amenity_usage")
    return usage


# ─────────────────────────────────────────────────────────
# 2. AMENITY ADOPTION  (distinct members per amenity)
# ─────────────────────────────────────────────────────────

def build_amenity_adoption(member_amenity_usage: pd.DataFrame) -> pd.DataFrame:
    """
    How many distinct members used each amenity at least once.
    Answers: "how many members use each amenity"
    """
    adoption = (
        member_amenity_usage
        .groupby("amenity")
        .agg(members_using=("member_id", "nunique"))
        .reset_index()
        .sort_values("members_using", ascending=False)
    )
    _save(adoption, "amenity_adoption")
    return adoption


# ─────────────────────────────────────────────────────────
# 3. AMENITY REVENUE
# ─────────────────────────────────────────────────────────

def build_amenity_revenue(folios: pd.DataFrame) -> pd.DataFrame:
    """
    Total revenue and transaction count per amenity.
    Answers: "total spend for amenities, which amenity making most money"
    """
    revenue = (
        folios
        .groupby("amenity")
        .agg(
            revenue=("amount", "sum"),
            transactions=("amount", "count"),
        )
        .reset_index()
        .sort_values("revenue", ascending=False)
    )
    _save(revenue, "amenity_revenue")
    return revenue


# ─────────────────────────────────────────────────────────
# 4. SEASONAL VISITS
# ─────────────────────────────────────────────────────────

def build_seasonal_visits(rooms: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregated check-in visits and average stay per calendar month.
    Answers: "seasonal behavior using check in/out data"
    """
    seasonal = (
        rooms
        .dropna(subset=["check_in_date"])
        .assign(month=lambda x: x["check_in_date"].dt.strftime("%Y-%m"))
        .groupby("month")
        .agg(
            visits=("member_number", "count"),
            avg_stay=("length_of_stay", "mean"),
        )
        .reset_index()
        .sort_values("month")
    )
    seasonal["avg_stay"] = seasonal["avg_stay"].round(2)
    _save(seasonal, "seasonal_visits")
    return seasonal


# ─────────────────────────────────────────────────────────
# 5. AIRPORT TRANSFER TOP USERS
# ─────────────────────────────────────────────────────────

def build_airport_transfer_users(folios: pd.DataFrame) -> pd.DataFrame:
    """
    Members who book the most ground transportation, ranked by booking count.
    Answers: "top airport transfer users"
    """
    transfers = (
        folios[folios["amenity"] == "Transportation"]
        .groupby("member_id")
        .agg(
            transfers=("amenity", "count"),
            total_spend=("amount", "sum"),
        )
        .reset_index()
        .sort_values("transfers", ascending=False)
    )
    _save(transfers, "airport_transfer_users")
    return transfers


# ─────────────────────────────────────────────────────────
# 6. MEMBER SEGMENTS  (clustering + business labels)
# ─────────────────────────────────────────────────────────

def _build_feature_matrix(
    members: pd.DataFrame,
    rooms: pd.DataFrame,
    folios: pd.DataFrame,
    member_amenity_usage: pd.DataFrame,
) -> pd.DataFrame:
    """
    Build the per-member feature matrix used for clustering.

    Features
    ─────────
    total_spend          – lifetime folio spend
    avg_spend            – average transaction value
    visit_count          – number of room stays
    avg_stay             – average length of stay (nights)
    days_since_last_visit– recency (9999 = never stayed)
    amenity_diversity    – number of distinct amenity types used
    <amenity>_visits     – visit count per amenity category (amenity mix)
    """
    # Visit / recency features from rooms
    visit_features = (
        rooms
        .groupby("member_number")
        .agg(
            visit_count=("member_number", "count"),
            avg_stay=("length_of_stay", "mean"),
            last_visit=("check_out_date", "max"),
        )
        .reset_index()
    )

    # Spend features from folios
    spend_features = (
        folios
        .groupby("member_id")
        .agg(
            total_spend=("amount", "sum"),
            avg_spend=("amount", "mean"),
        )
        .reset_index()
        .rename(columns={"member_id": "member_number"})
    )

    # Amenity diversity
    amenity_diversity = (
        folios
        .groupby("member_id")
        .agg(amenity_diversity=("amenity", "nunique"))
        .reset_index()
        .rename(columns={"member_id": "member_number"})
    )

    # Amenity-mix pivot (visit counts per category per member)
    # Keep member_id as-is after reset_index to avoid pandas axis-name
    # quirks that can corrupt the rename when columns.name == "amenity".
    amenity_pivot = (
        member_amenity_usage
        .pivot_table(
            index="member_id",
            columns="amenity",
            values="usage_count",
            fill_value=0,
        )
        .reset_index()
    )
    amenity_pivot.columns.name = None
    amenity_cols = [c for c in amenity_pivot.columns if c != "member_id"]

    # Favorite amenity (most-used category) — idxmax guarantees correct top
    # amenity per member regardless of DataFrame ordering.
    fav = (
        member_amenity_usage
        .loc[
            member_amenity_usage.groupby("member_id")["usage_count"].idxmax()
        ][["member_id", "amenity"]]
        .rename(columns={"amenity": "favorite_amenity"})
    )

    # ── Normalise all join keys to str before merging ──────────────────────
    # Postgres may return member_number as INTEGER in some tables and VARCHAR
    # in others.  A type mismatch silently produces all-NaN join results, so
    # we cast every key column to str here in one place.
    members["member_number"]          = members["member_number"].astype(str)
    visit_features["member_number"]   = visit_features["member_number"].astype(str)
    spend_features["member_number"]   = spend_features["member_number"].astype(str)
    amenity_diversity["member_number"]= amenity_diversity["member_number"].astype(str)
    amenity_pivot["member_id"]        = amenity_pivot["member_id"].astype(str)
    fav["member_id"]                  = fav["member_id"].astype(str)

    df = (
        members
        .merge(visit_features,    on="member_number",                            how="left")
        .merge(spend_features,    on="member_number",                            how="left")
        .merge(amenity_diversity, on="member_number",                            how="left")
        .merge(amenity_pivot,     left_on="member_number", right_on="member_id", how="left")
        .drop(columns=["member_id"], errors="ignore")
        .merge(fav,               left_on="member_number", right_on="member_id", how="left")
        .drop(columns=["member_id"], errors="ignore")
    )

    matched = df["favorite_amenity"].notna().sum()
    log.info("favorite_amenity matched %d / %d members", matched, len(df))

    # Fill nulls
    for col in ["visit_count", "avg_stay", "total_spend", "avg_spend", "amenity_diversity"] + amenity_cols:
        df[col] = df.get(col, 0).fillna(0)

    # Recency — coerce first so NaT subtracts cleanly, then fill never-stayed
    # members with 9999. Negative values (future checkouts) are clamped to 0.
    today = pd.Timestamp.today().normalize()
    df["last_visit"] = pd.to_datetime(df["last_visit"], errors="coerce")
    df["days_since_last_visit"] = (today - df["last_visit"]).dt.days
    df["days_since_last_visit"] = (
        df["days_since_last_visit"]
        .fillna(9999)
        .clip(lower=0)
    )

    # Active flag: visited in the last 365 days
    df["is_active"] = df["days_since_last_visit"] <= 365

    return df, amenity_cols


def _assign_segment(row, p90_spend: float) -> str:
    """
    Priority-ordered business segment rules applied after clustering.

    Segments
    ────────
    High Value Guest   – top 10 % by lifetime spend
    At Risk            – no visit in > 365 days (inactive)
    Corporate Traveler – transportation is their most-used amenity
    Long Stay Guest    – avg stay ≥ 7 nights
    Golf Enthusiast    – golf is their top amenity
    Spa & Wellness     – spa is their top amenity
    Regular Member     – everyone else
    """
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

# ─────────────────────────────────────────────────────────
# SEASONAL VISITOR DETECTION
# ─────────────────────────────────────────────────────────

SEASON_MONTHS = {
    "Spring": {1, 2, 3},
    "Summer": {4, 5, 6, 7},
    "Late Summer": {8},
    "Autumn": {9, 10},
    "Winter": {11, 12},
}

def _build_season_visitors(rooms: pd.DataFrame) -> dict[str, set]:
    """
    Returns a dict of season_name -> set of member_numbers who visited
    in that season at least twice.

    Mirrors the season_months mapping used in /ml/seasonal-visit-details
    so the campaign tags are consistent with the analytics endpoint.
    """
    season_sets: dict[str, set] = {}

    for season, months in SEASON_MONTHS.items():
        visitors = (
            rooms[rooms["check_in_date"].dt.month.isin(months)]
            .groupby("member_number")
            .size()
            .reset_index(name="visits")
        )
        season_sets[season] = set(
            visitors[visitors["visits"] >= 2]["member_number"].astype(str)
        )
        log.info(
            "Season '%s' visitors (≥2 stays): %d", season, len(season_sets[season])
        )

    return season_sets


# Full amenity -> campaign lookup (covers every bucket from classify_amenity)
AMENITY_CAMPAIGNS = {
    "Spa":            "Spa Promotion",
    "Golf":           "Golf Promotion",
    "Grill":          "Dining & Events Invite",
    "Bar":            "Dining & Events Invite",
    "Restaurant":     "Dining & Events Invite",
    "Tennis":         "Tennis Programme",
    "Retail":         "Retail & Boutique Offer",
    "Villa Rental":   "Villa Exclusive Offer",
    "Transportation": "Airport Transfer Package",
    "Membership":     "Membership Renewal Reminder",
    "Other":          None,   # no sub-campaign for uncategorised spend
}

# Every season gets its own campaign tag
SEASON_CAMPAIGNS = {
    "Spring":      "Spring Season Offer",
    "Summer":      "Summer Season Offer",
    "Late Summer": "Late Summer Season Offer",
    "Autumn":      "Autumn Season Offer",
    "Winter":      "Winter Season Offer",
}


def _assign_campaign(row, season_visitors: dict[str, set]) -> str:
    """
    Returns a pipe-separated string of all applicable campaigns.

    Layer 1 — segment campaign   (always exactly one)
    Layer 2 — amenity campaign   (one per favorite amenity, deduped)
    Layer 3 — seasonal campaigns (one per season the member visits ≥2×)
    """
    seg    = row["segment_name"]
    fav    = row.get("favorite_amenity", "")
    member = str(row["member_number"])

    parts: list[str] = []

    # ── Layer 1: segment ──────────────────────────────────
    segment_camp = {
        "High Value Guest":  "VIP Retention Campaign",
        "At Risk":           "Win-Back Campaign",
        "Corporate Traveler":"Airport Transfer Package",
        "Long Stay Guest":   "Extended Stay Offer",
        "Golf Enthusiast":   "Golf Promotion",
        "Spa & Wellness":    "Spa Promotion",
    }.get(seg, "General Newsletter")

    parts.append(segment_camp)

    # ── Layer 2: amenity sub-campaign ─────────────────────
    # Fires for every member, so a High Value spa lover also
    # gets "Spa Promotion" (deduped if segment already added it).
    amenity_camp = AMENITY_CAMPAIGNS.get(fav)
    if amenity_camp and amenity_camp not in parts:
        parts.append(amenity_camp)

    # ── Layer 3: seasonal campaigns ───────────────────────
    # A member who visits heavily in both Summer and Winter
    # gets both tags — useful for year-round engagement.
    for season, camp in SEASON_CAMPAIGNS.items():
        if member in season_visitors.get(season, set()):
            parts.append(camp)

    return " | ".join(parts)


def build_member_segments(
    members, rooms, folios, member_amenity_usage, n_clusters=5
):
    feature_df, amenity_cols = _build_feature_matrix(
        members, rooms, folios, member_amenity_usage
    )
    cluster_features = [
        "total_spend",
        "avg_spend",
        "visit_count",
        "avg_stay",
        "days_since_last_visit",
        "amenity_diversity",
    ] + amenity_cols

    X = feature_df[cluster_features].fillna(0)

    if len(feature_df) >= n_clusters * 5:
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        feature_df["cluster_id"] = kmeans.fit_predict(X_scaled)
    else:
        feature_df["cluster_id"] = 0

    # Exclude zero-spend members from the p90 calculation.
    # With ~98 % of members having no folio data, a naive quantile(0.90)
    # returns 0 and every member becomes "High Value Guest".
    spenders = feature_df[feature_df["total_spend"] > 0]["total_spend"]
    p90_spend = spenders.quantile(0.90) if len(spenders) >= 10 else float("inf")

    feature_df["segment_name"] = feature_df.apply(
        lambda r: _assign_segment(r, p90_spend), axis=1
    )

    season_visitors = _build_season_visitors(rooms)

    feature_df["campaign"] = feature_df.apply(
        lambda r: _assign_campaign(r, season_visitors), axis=1
    )

    # cluster_id stays in feature_df for internal use but is not written to
    # member_segments — on a dataset that is ~98 % zero-activity members the
    # KMeans groupings are not meaningful enough to surface to end users.
    # amenity_diversity and favorite_amenity are used internally for segment
    # assignment and clustering but are not written to the output table.
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
    member_segments["avg_stay"] = member_segments["avg_stay"].round(2)
    member_segments["avg_spend"] = member_segments["avg_spend"].round(2)
    member_segments["total_spend"] = member_segments["total_spend"].round(2)

    _save(member_segments, "member_segments")
    return member_segments


# ─────────────────────────────────────────────────────────
# 7. MARKETING TARGETS  (slim join table)
# ─────────────────────────────────────────────────────────

def build_marketing_targets(member_segments: pd.DataFrame) -> pd.DataFrame:
    """
    Slim table with just member_number, segment_name, and campaign.
    Designed for quick targeted-marketing queries.
    """
    targets = member_segments[["member_number", "segment_name", "campaign"]].copy()
    _save(targets, "marketing_targets")
    return targets


# ─────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────

def build_insights() -> None:
    """
    Run the full ML insight pipeline and write all tables to PostgreSQL.
    Call this from the scheduler, pipeline.py, or directly via CLI.
    """
    log.info("=== ML Insights pipeline starting ===")

    # Load raw data once
    folios  = _load_folios()
    rooms   = _load_rooms()
    members = _load_members()

    if folios.empty:
        log.error("No folio data found — aborting insights pipeline.")
        return

    # Build derived tables (order matters — some feed into later steps)
    member_amenity_usage = build_member_amenity_usage(folios)
    build_amenity_adoption(member_amenity_usage)
    build_amenity_revenue(folios)
    build_seasonal_visits(rooms)
    build_airport_transfer_users(folios)

    member_segments = build_member_segments(members, rooms, folios, member_amenity_usage)
    build_marketing_targets(member_segments)

    log.info("=== ML Insights pipeline complete ===")


if __name__ == "__main__":
    build_insights()