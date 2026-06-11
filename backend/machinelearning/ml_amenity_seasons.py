"""
backend/machinelearning/ml_amenity_seasons.py
─────────────────────────────────────────────
Builds amenity-season cross-analysis tables.

Tables written to PostgreSQL
─────────────────────────────
  amenity_season_spend
      Per amenity × per season: total spend, transaction count,
      avg spend per visit, and member count.

  member_amenity_profile
      Per member: member_id, full name, top amenity, total spend
      at that amenity, and total spend across all amenities.

  member_amenity_season_visits
      Per member × per season × per amenity:
      member_id, full name, season name, amenity used most
      during that season, spend, usage count, check-in/out
      formatted as "Mon DD, YYYY".  Rows are de-duplicated per
      visit so a member who visits twice in the same season
      produces two rows.

  season_villa_bedroom_summary
      Per season: most-booked villa, bedroom-count distribution
      and total room-nights — for capacity planning.

Run standalone:
    python ml_amenity_seasons.py
    python ml_amenity_seasons.py --dry-run
    python ml_amenity_seasons.py --recreate
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

_engine = None


def get_engine():
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
    with get_engine().connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %-40s  (%d rows)", table, len(df))


# ─── Amenity Classification (single source of truth) ──────────────────────────

AMENITY_PATTERNS: dict[str, str] = {
    "Spa":        r"\b(spa|massage|facial)\b",
    "Golf":       r"\b(golf|pro shop|cart)\b",
    "Grill":      r"\bgrill\b",
    "Bar":        r"\bbar\b",
    "Restaurant": r"\b(restaurant|dinner|lunch|breakfast)\b",
    "Tennis":     r"\btennis\b",
    "Boutique":    r"\bboutique\b",
    "Shop":         r"\bshop\b",
    "Commissary":   r"\bcommissary\b",
}

_AMENITY_RE: dict[str, re.Pattern] = {
    name: re.compile(pattern, re.IGNORECASE)
    for name, pattern in AMENITY_PATTERNS.items()
}

_EXCLUDED_RE = re.compile(
    r"\b(villa|rental|airport|transfer|shuttle|transport|transportation"
    r"|membership|dues|fee)\b",
    re.IGNORECASE,
)


def classify_amenity(description: str | None) -> str | None:
    if pd.isna(description):
        return None
    desc = str(description)
    if _EXCLUDED_RE.search(desc):
        return None
    for amenity, pattern in _AMENITY_RE.items():
        if pattern.search(desc):
            return amenity
    return None


# ─── Season helpers ───────────────────────────────────────────────────────────

def _load_active_seasons(group_id: int | None = None) -> list[dict]:
    """Load active season definitions from DB.

    Defaults to Business Seasons for the existing standalone rebuild.
    Passing group_id lets the same builder use a selected custom group.
    """
    if group_id is not None:
        rows = _query(
            """
            SELECT s.id, s.season_name, s.start_month, s.start_day,
                   s.end_month, s.end_day
            FROM seasons s
            WHERE s.is_active = TRUE
              AND s.group_id = :group_id
            ORDER BY s.start_month, s.start_day
            """,
            {"group_id": group_id},
        )
    else:
        rows = _query("""
            SELECT s.id, s.season_name, s.start_month, s.start_day,
                   s.end_month, s.end_day
            FROM seasons s
            JOIN season_groups sg ON sg.id = s.group_id
            WHERE s.is_active = TRUE
              AND sg.group_type = 'business'
            ORDER BY s.start_month, s.start_day
        """)
    return rows.to_dict("records")


def _season_for_date(month: int, day: int, seasons: list[dict]) -> str | None:
    md = (month, day)
    for s in seasons:
        start_md = (s["start_month"], s["start_day"])
        end_md   = (s["end_month"],   s["end_day"])
        if start_md <= end_md:
            if start_md <= md <= end_md:
                return s["season_name"]
        else:
            if md >= start_md or md <= end_md:
                return s["season_name"]
    return None


def _fmt_date(dt) -> str | None:
    """Format a date as 'Jan 12, 2024' style."""
    if pd.isna(dt):
        return None
    try:
        return pd.Timestamp(dt).strftime("%b %d, %Y")
    except Exception:
        return None


# ─── Data Loaders ─────────────────────────────────────────────────────────────

def _load_folios_with_names() -> pd.DataFrame:
    """
    Load amenity folios joined to member names.
    Member full name comes from folios.guest_name first, then members table.
    """
    df = _query("""
        SELECT
            f.member_number                        AS member_id,
            COALESCE(
                NULLIF(TRIM(f.guest_name), ''),
                NULLIF(TRIM(m.member_full_name), ''),
                NULLIF(TRIM(m.member_name), '')
            )                                      AS member_full_name,
            f.description,
            f.amount,
            f.transaction_date,
            f.check_in_date,
            f.check_out_date,
            f.villa_name,
            f.bedroom_count
        FROM folios f
        LEFT JOIN members m ON f.member_number = m.member_number
        WHERE f.member_number IS NOT NULL
    """)

    df["amount"]           = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce")
    df["check_in_date"]    = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"]   = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["amenity"]          = df["description"].apply(classify_amenity)

    amenity_df = df[df["amenity"].notna()].copy()
    log.info(
        "Folios loaded: %d total  |  %d amenity rows  |  %d excluded",
        len(df), len(amenity_df), len(df) - len(amenity_df),
    )
    return amenity_df


def _load_rooms_with_names() -> pd.DataFrame:
    """
    Load room/villa bookings for capacity planning.
    Pulls villa_name and bedroom_count from folios (where the data actually lives),
    falling back to the rooms table for members who have no folio rows.
    """
    df = _query("""
        SELECT
            member_number,
            check_in_date,
            check_out_date,
            villa_name,
            bedroom_count
        FROM folios
        WHERE member_number IS NOT NULL
          AND check_in_date IS NOT NULL
    """)
    df["check_in_date"]  = pd.to_datetime(df["check_in_date"],  errors="coerce")
    df["check_out_date"] = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["nights"] = (df["check_out_date"] - df["check_in_date"]).dt.days.clip(lower=0).fillna(0)
    df["bedroom_count"] = pd.to_numeric(df["bedroom_count"], errors="coerce")
    log.info("Loaded folio stay rows for capacity planning: %d rows", len(df))
    return df


# ─── Table Builders ───────────────────────────────────────────────────────────

def build_amenity_season_spend(
    amenity_df: pd.DataFrame,
    seasons: list[dict],
) -> pd.DataFrame:
    """
    Per amenity × per season:
      total_spend, transaction_count, avg_spend_per_visit, member_count
    """
    ref_date = amenity_df["check_in_date"].fillna(amenity_df["transaction_date"])
    amenity_df = amenity_df.copy()
    amenity_df["season"] = ref_date.apply(
        lambda d: _season_for_date(d.month, d.day, seasons) if pd.notna(d) else None
    )
    amenity_df = amenity_df[amenity_df["season"].notna()]

    agg = (
        amenity_df.groupby(["amenity", "season"])
        .agg(
            total_spend=("amount", "sum"),
            transaction_count=("amount", "count"),
            member_count=("member_id", "nunique"),
        )
        .reset_index()
    )
    agg["avg_spend_per_visit"] = (agg["total_spend"] / agg["transaction_count"]).round(2)
    agg["total_spend"] = agg["total_spend"].round(2)

    _save(agg, "amenity_season_spend")
    return agg


def build_member_amenity_profile(amenity_df: pd.DataFrame) -> pd.DataFrame:
    """
    Per member: top amenity, spend at that amenity, total spend across all amenities.
    """
    per_member_amenity = (
        amenity_df.groupby(["member_id", "member_full_name", "amenity"])
        .agg(usage_count=("description", "count"), amenity_spend=("amount", "sum"))
        .reset_index()
    )

    # Top amenity per member = highest spend
    idx = per_member_amenity.groupby("member_id")["amenity_spend"].idxmax()
    top_amenity = per_member_amenity.loc[idx, ["member_id", "amenity", "amenity_spend"]].rename(
        columns={"amenity": "top_amenity", "amenity_spend": "top_amenity_spend"}
    )

    total_spend = (
        amenity_df.groupby("member_id")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "total_amenity_spend"})
    )

    # Stable name per member
    name_map = (
        amenity_df.dropna(subset=["member_full_name"])
        .groupby("member_id")["member_full_name"]
        .first()
        .reset_index()
    )

    profile = (
        name_map
        .merge(top_amenity, on="member_id", how="left")
        .merge(total_spend, on="member_id", how="left")
    )
    profile["top_amenity_spend"]    = profile["top_amenity_spend"].round(2)
    profile["total_amenity_spend"]  = profile["total_amenity_spend"].round(2)

    _save(profile, "member_amenity_profile")
    return profile


def build_member_amenity_season_visits(
    amenity_df: pd.DataFrame,
    seasons: list[dict],
) -> pd.DataFrame:
    """
    Per member × per visit × per amenity used:
    Shows what amenity they used each time they were on property,
    with check-in/check-out formatted as "Jan 12, 2024".

    One row per (member, check_in_date, amenity) combination so a member
    visiting during High Season twice produces two rows.
    """
    df = amenity_df.copy()
    ref = df["check_in_date"].fillna(df["transaction_date"])
    df["season"] = ref.apply(
        lambda d: _season_for_date(d.month, d.day, seasons) if pd.notna(d) else None
    )
    df = df[df["season"].notna()].copy()

    # Aggregate per member × check_in_date × amenity
    agg = (
        df.groupby(
            ["member_id", "member_full_name", "season", "check_in_date", "check_out_date", "amenity"],
            dropna=False,
        )
        .agg(
            usage_count=("description",  "count"),
            total_spend=("amount",       "sum"),
        )
        .reset_index()
    )

    # Format dates human-readable
    agg["check_in_fmt"]  = agg["check_in_date"].apply(_fmt_date)
    agg["check_out_fmt"] = agg["check_out_date"].apply(_fmt_date)

    # Drop raw date columns — the API will return the formatted strings
    agg = agg.drop(columns=["check_in_date", "check_out_date"])
    agg["total_spend"] = agg["total_spend"].round(2)
    agg = agg.sort_values(["member_id", "check_in_fmt", "season"])

    _save(agg, "member_amenity_season_visits")
    return agg


def build_season_villa_bedroom_summary(
    rooms_df: pd.DataFrame,
    seasons: list[dict],
) -> pd.DataFrame:
    """
    Per season: villa distribution, bedroom-count distribution, total room-nights.
    Useful for capacity planning.  All data sourced from folios.
    """
    df = rooms_df.copy()
    df["season"] = df["check_in_date"].apply(
        lambda d: _season_for_date(d.month, d.day, seasons) if pd.notna(d) else None
    )
    df = df[df["season"].notna()]
    df["year"] = df["check_in_date"].dt.year

    agg = (
        df.groupby(["year", "season"])
        .agg(
            total_bookings=("member_number",  "count"),
            total_nights=("nights",           "sum"),
            avg_nights=("nights",             "mean"),
            unique_members=("member_number",  "nunique"),
        )
        .reset_index()
    )

    # Most popular villa per season
    villa_df = df[df["villa_name"].notna()]
    if not villa_df.empty:
        villa_mode = (
            villa_df.groupby(["year", "season"])["villa_name"]
            .agg(lambda s: s.value_counts().index[0] if len(s) else None)
            .reset_index()
            .rename(columns={"villa_name": "top_villa"})
        )
    else:
        villa_mode = pd.DataFrame(columns=["year", "season", "top_villa"])

    # Most popular bedroom count per season
    bed_df = df[df["bedroom_count"].notna()]
    if not bed_df.empty:
        bed_mode = (
            bed_df.groupby(["year", "season"])["bedroom_count"]
            .agg(lambda s: int(s.value_counts().index[0]) if len(s) else None)
            .reset_index()
            .rename(columns={"bedroom_count": "top_bedroom_count"})
        )

        # Bedroom count distribution per season — serialised as string for DB
        bed_counts = (
            bed_df.groupby(["year", "season", "bedroom_count"])
            .size()
            .reset_index(name="count")
        )
        bed_dist_map = (
            bed_counts.groupby(["year", "season"])
            .apply(
                lambda g: str(dict(zip(g["bedroom_count"].astype(int).astype(str), g["count"]))),
                include_groups=False,
            )
        )
        bed_dist = bed_dist_map.reset_index().rename(columns={0: "bedroom_distribution"})
    else:
        log.warning("No bedroom_count data found in folios — bedroom columns will be null")
        bed_mode = pd.DataFrame(columns=["year", "season", "top_bedroom_count"])
        bed_dist = pd.DataFrame(columns=["year", "season", "bedroom_distribution"])

    summary = (
        agg
        .merge(villa_mode, on=["year", "season"], how="left")
        .merge(bed_mode,   on=["year", "season"], how="left")
        .merge(bed_dist,   on=["year", "season"], how="left")
    )
    summary["avg_nights"] = summary["avg_nights"].round(2)

    _save(summary, "season_villa_bedroom_summary")
    return summary


# ─── Main ─────────────────────────────────────────────────────────────────────

def build_amenity_season_tables(
    *,
    dry_run: bool = False,
    recreate: bool = False,
    group_id: int | None = None,
) -> None:
    log.info("=== Amenity × Season pipeline starting ===")

    seasons = _load_active_seasons(group_id=group_id)
    if not seasons:
        log.error("No active seasons found — aborting.")
        return

    log.info("Active seasons loaded: %s", [s["season_name"] for s in seasons])

    amenity_df = _load_folios_with_names()
    rooms_df   = _load_rooms_with_names()

    if amenity_df.empty:
        log.error("No amenity folio rows found — aborting.")
        return

    if dry_run:
        log.info("[DRY RUN] Would build:")
        log.info("  amenity_season_spend          ~%d rows", len(amenity_df["amenity"].unique()) * len(seasons))
        log.info("  member_amenity_profile        ~%d rows", amenity_df["member_id"].nunique())
        log.info("  member_amenity_season_visits  ~%d rows", len(amenity_df))
        log.info("  season_villa_bedroom_summary  ~%d rows", len(seasons))
        return

    build_amenity_season_spend(amenity_df, seasons)
    build_member_amenity_profile(amenity_df)
    build_member_amenity_season_visits(amenity_df, seasons)
    build_season_villa_bedroom_summary(rooms_df, seasons)

    log.info("=== Amenity × Season pipeline complete ===")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build amenity × season cross-analysis tables.")
    parser.add_argument("--dry-run",  action="store_true", help="Read data but do not write tables")
    parser.add_argument("--recreate", action="store_true", help="Drop/recreate tables before build")
    parser.add_argument("--group-id", type=int, default=None, help="Use active seasons from one season group")
    args = parser.parse_args()
    build_amenity_season_tables(
        dry_run=args.dry_run,
        recreate=args.recreate,
        group_id=args.group_id,
    )


if __name__ == "__main__":
    main()