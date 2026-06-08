"""
backend/machinelearning/ml_amenity_seasons.py
─────────────────────────────────────────────
Builds amenity-season cross-analysis tables.

Important
─────────────────────────────
Season assignment is dynamic. This script does NOT use a static season value
from ml_amenity or any pre-labelled amenity table. It reads the active rows from
season_groups + seasons, then maps each amenity / room row to a season by date.

That means when the frontend updates seasons through SeasonFilterBar, rerunning
this pipeline will rebuild the amenity-season tables using the latest season
boundaries.

Tables read from PostgreSQL
─────────────────────────────
  season_groups
  seasons
  folios
  members

Tables written to PostgreSQL
─────────────────────────────
  amenity_season_spend
      Per amenity × per season: season_id, season, total spend,
      transaction count, avg spend per visit, and member count.

  member_amenity_profile
      Per member: member_id, full name, top amenity, total spend
      at that amenity, and total spend across all amenities.

  member_amenity_season_visits
      Per member × per season × per amenity:
      member_id, full name, season_id, season name, amenity used,
      spend, usage count, check-in/out formatted as "Mon DD, YYYY".

  season_villa_bedroom_summary
      Per season: season_id, season, most-booked villa,
      bedroom-count distribution and total room-nights.

Run standalone:
    python ml_amenity_seasons.py
    python ml_amenity_seasons.py --dry-run
    python ml_amenity_seasons.py --recreate
    python ml_amenity_seasons.py --group-type business
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path
from typing import Any

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

OUTPUT_TABLES = [
    "amenity_season_spend",
    "member_amenity_profile",
    "member_amenity_season_visits",
    "season_villa_bedroom_summary",
]


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


def _execute(sql: str, params: dict | None = None) -> None:
    with get_engine().begin() as conn:
        conn.execute(text(sql), params or {})


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %-40s  (%d rows)", table, len(df))


def _drop_output_tables() -> None:
    joined = ", ".join(OUTPUT_TABLES)
    _execute(f"DROP TABLE IF EXISTS {joined} CASCADE")
    log.info("Dropped amenity-season output tables")


# ─── Amenity Classification ──────────────────────────────────────────────────

AMENITY_PATTERNS: dict[str, str] = {
    "Spa": r"\b(spa|massage|facial)\b",
    "Golf": r"\b(golf|pro shop|cart)\b",
    "Grill": r"\bgrill\b",
    "Bar": r"\bbar\b",
    "Restaurant": r"\b(restaurant|dinner|lunch|breakfast)\b",
    "Tennis": r"\btennis\b",
    "Retail": r"\b(boutique|shop|commissary)\b",
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


def _load_active_seasons(group_type: str = "business") -> list[dict[str, Any]]:
    """
    Load active season definitions from the same season tables used by the
    frontend SeasonFilterBar.
    """
    rows = _query(
        """
        SELECT
            s.id AS season_id,
            s.group_id,
            sg.group_name,
            sg.group_type,
            s.season_name,
            s.start_month,
            s.start_day,
            s.end_month,
            s.end_day,
            s.is_active
        FROM seasons s
        JOIN season_groups sg ON sg.id = s.group_id
        WHERE s.is_active = TRUE
          AND sg.group_type = :group_type
        ORDER BY s.start_month, s.start_day, s.id
        """,
        {"group_type": group_type},
    )

    if rows.empty:
        return []

    int_cols = [
        "season_id",
        "group_id",
        "start_month",
        "start_day",
        "end_month",
        "end_day",
    ]
    for col in int_cols:
        rows[col] = pd.to_numeric(rows[col], errors="coerce").astype("Int64")

    rows = rows.dropna(subset=int_cols)
    for col in int_cols:
        rows[col] = rows[col].astype(int)

    return rows.to_dict("records")


def _season_for_date(value, seasons: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the matching season row for a date, including wrap-around seasons."""
    if pd.isna(value):
        return None

    ts = pd.Timestamp(value)
    md = (int(ts.month), int(ts.day))

    for season in seasons:
        start_md = (int(season["start_month"]), int(season["start_day"]))
        end_md = (int(season["end_month"]), int(season["end_day"]))

        # Normal season: Mar 7 → Mar 27
        if start_md <= end_md and start_md <= md <= end_md:
            return season

        # Wrap-around season: Dec 19 → Jan 3
        if start_md > end_md and (md >= start_md or md <= end_md):
            return season

    return None


def _assign_dynamic_seasons(
    df: pd.DataFrame,
    date_col: str,
    seasons: list[dict[str, Any]],
) -> pd.DataFrame:
    """
    Add season_id, season, season_group_id, and season_group_name to a dataframe
    based on the latest rows in seasons / season_groups.
    """
    output = df.copy()

    matched = output[date_col].apply(lambda value: _season_for_date(value, seasons))

    output["season_id"] = matched.apply(
        lambda season: season["season_id"] if season else None
    )
    output["season"] = matched.apply(
        lambda season: season["season_name"] if season else None
    )
    output["season_group_id"] = matched.apply(
        lambda season: season["group_id"] if season else None
    )
    output["season_group_name"] = matched.apply(
        lambda season: season["group_name"] if season else None
    )

    before = len(output)
    output = output[output["season_id"].notna()].copy()
    output["season_id"] = output["season_id"].astype(int)
    output["season_group_id"] = output["season_group_id"].astype(int)

    log.info(
        "Dynamic season assignment using %s: %d matched | %d unmatched",
        date_col,
        len(output),
        before - len(output),
    )

    return output


def _fmt_date(dt) -> str | None:
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
    df = _query(
        """
        SELECT
            f.member_number AS member_id,
            COALESCE(
                NULLIF(TRIM(f.guest_name), ''),
                NULLIF(TRIM(m.member_full_name), ''),
                NULLIF(TRIM(m.member_name), '')
            ) AS member_full_name,
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
        """
    )

    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce")
    df["check_in_date"] = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"] = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["amenity"] = df["description"].apply(classify_amenity)

    amenity_df = df[df["amenity"].notna()].copy()
    amenity_df["season_date"] = amenity_df["check_in_date"].fillna(
        amenity_df["transaction_date"]
    )

    log.info(
        "Folios loaded: %d total | %d amenity rows | %d excluded",
        len(df),
        len(amenity_df),
        len(df) - len(amenity_df),
    )
    return amenity_df


def _load_rooms_with_names() -> pd.DataFrame:
    """
    Load room/villa bookings for capacity planning.
    Pulls villa_name and bedroom_count from folios.
    """
    df = _query(
        """
        SELECT
            member_number,
            check_in_date,
            check_out_date,
            villa_name,
            bedroom_count
        FROM folios
        WHERE member_number IS NOT NULL
          AND check_in_date IS NOT NULL
        """
    )

    df["check_in_date"] = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"] = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["nights"] = (
        df["check_out_date"] - df["check_in_date"]
    ).dt.days.clip(lower=0).fillna(0)
    df["bedroom_count"] = pd.to_numeric(df["bedroom_count"], errors="coerce")

    log.info("Loaded folio stay rows for capacity planning: %d rows", len(df))
    return df


# ─── Table Builders ───────────────────────────────────────────────────────────


def build_amenity_season_spend(
    amenity_df: pd.DataFrame,
    seasons: list[dict[str, Any]],
) -> pd.DataFrame:
    """
    Per amenity × per dynamic season.
    """
    df = _assign_dynamic_seasons(amenity_df, "season_date", seasons)

    agg = (
        df.groupby(
            [
                "amenity",
                "season_id",
                "season",
                "season_group_id",
                "season_group_name",
            ],
            dropna=False,
        )
        .agg(
            total_spend=("amount", "sum"),
            transaction_count=("amount", "count"),
            member_count=("member_id", "nunique"),
        )
        .reset_index()
    )

    agg["avg_spend_per_visit"] = (
        agg["total_spend"] / agg["transaction_count"]
    ).round(2)
    agg["total_spend"] = agg["total_spend"].round(2)
    agg = agg.sort_values(["season_id", "amenity"])

    _save(agg, "amenity_season_spend")
    return agg


def build_member_amenity_profile(amenity_df: pd.DataFrame) -> pd.DataFrame:
    """
    Per member: top amenity, spend at that amenity, total spend across all amenities.
    """
    per_member_amenity = (
        amenity_df.groupby(["member_id", "member_full_name", "amenity"], dropna=False)
        .agg(usage_count=("description", "count"), amenity_spend=("amount", "sum"))
        .reset_index()
    )

    idx = per_member_amenity.groupby("member_id")["amenity_spend"].idxmax()
    top_amenity = per_member_amenity.loc[
        idx, ["member_id", "amenity", "amenity_spend"]
    ].rename(
        columns={
            "amenity": "top_amenity",
            "amenity_spend": "top_amenity_spend",
        }
    )

    total_spend = (
        amenity_df.groupby("member_id")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "total_amenity_spend"})
    )

    name_map = (
        amenity_df.dropna(subset=["member_full_name"])
        .groupby("member_id")["member_full_name"]
        .first()
        .reset_index()
    )

    profile = name_map.merge(top_amenity, on="member_id", how="left").merge(
        total_spend, on="member_id", how="left"
    )
    profile["top_amenity_spend"] = profile["top_amenity_spend"].round(2)
    profile["total_amenity_spend"] = profile["total_amenity_spend"].round(2)

    _save(profile, "member_amenity_profile")
    return profile


def build_member_amenity_season_visits(
    amenity_df: pd.DataFrame,
    seasons: list[dict[str, Any]],
) -> pd.DataFrame:
    """
    Per member × per visit × per amenity using dynamic seasons.
    """
    df = _assign_dynamic_seasons(amenity_df, "season_date", seasons)

    agg = (
        df.groupby(
            [
                "member_id",
                "member_full_name",
                "season_id",
                "season",
                "season_group_id",
                "season_group_name",
                "check_in_date",
                "check_out_date",
                "amenity",
            ],
            dropna=False,
        )
        .agg(
            usage_count=("description", "count"),
            total_spend=("amount", "sum"),
        )
        .reset_index()
    )

    agg["check_in_fmt"] = agg["check_in_date"].apply(_fmt_date)
    agg["check_out_fmt"] = agg["check_out_date"].apply(_fmt_date)
    agg = agg.drop(columns=["check_in_date", "check_out_date"])
    agg["total_spend"] = agg["total_spend"].round(2)
    agg = agg.sort_values(["member_id", "season_id", "check_in_fmt", "amenity"])

    _save(agg, "member_amenity_season_visits")
    return agg


def build_season_villa_bedroom_summary(
    rooms_df: pd.DataFrame,
    seasons: list[dict[str, Any]],
) -> pd.DataFrame:
    """
    Per dynamic season: villa distribution, bedroom count distribution,
    and room nights.
    """
    df = _assign_dynamic_seasons(rooms_df, "check_in_date", seasons)

    agg = (
        df.groupby(
            ["season_id", "season", "season_group_id", "season_group_name"],
            dropna=False,
        )
        .agg(
            total_bookings=("member_number", "count"),
            total_nights=("nights", "sum"),
            avg_nights=("nights", "mean"),
            unique_members=("member_number", "nunique"),
        )
        .reset_index()
    )

    villa_df = df[df["villa_name"].notna()]
    if not villa_df.empty:
        villa_mode = (
            villa_df.groupby("season_id")["villa_name"]
            .agg(lambda s: s.value_counts().index[0] if len(s) else None)
            .reset_index()
            .rename(columns={"villa_name": "top_villa"})
        )
    else:
        villa_mode = pd.DataFrame(columns=["season_id", "top_villa"])

    bed_df = df[df["bedroom_count"].notna()]
    if not bed_df.empty:
        bed_mode = (
            bed_df.groupby("season_id")["bedroom_count"]
            .agg(lambda s: int(s.value_counts().index[0]) if len(s) else None)
            .reset_index()
            .rename(columns={"bedroom_count": "top_bedroom_count"})
        )

        bed_counts = (
            bed_df.groupby(["season_id", "bedroom_count"])
            .size()
            .reset_index(name="count")
        )
        bed_dist_map = bed_counts.groupby("season_id").apply(
            lambda g: str(
                dict(zip(g["bedroom_count"].astype(int).astype(str), g["count"]))
            ),
            include_groups=False,
        )
        bed_dist = bed_dist_map.reset_index().rename(
            columns={0: "bedroom_distribution"}
        )
    else:
        log.warning("No bedroom_count data found in folios — bedroom columns will be null")
        bed_mode = pd.DataFrame(columns=["season_id", "top_bedroom_count"])
        bed_dist = pd.DataFrame(columns=["season_id", "bedroom_distribution"])

    summary = (
        agg.merge(villa_mode, on="season_id", how="left")
        .merge(bed_mode, on="season_id", how="left")
        .merge(bed_dist, on="season_id", how="left")
    )
    summary["avg_nights"] = summary["avg_nights"].round(2)
    summary = summary.sort_values("season_id")

    _save(summary, "season_villa_bedroom_summary")
    return summary


# ─── Main ─────────────────────────────────────────────────────────────────────


def build_amenity_season_tables(
    *,
    dry_run: bool = False,
    recreate: bool = False,
    group_type: str = "business",
) -> None:
    log.info("=== Amenity × Season pipeline starting ===")

    if recreate and not dry_run:
        _drop_output_tables()

    seasons = _load_active_seasons(group_type=group_type)
    if not seasons:
        log.error("No active %s seasons found — aborting.", group_type)
        return

    log.info(
        "Active %s seasons loaded from season tables: %s",
        group_type,
        [s["season_name"] for s in seasons],
    )

    amenity_df = _load_folios_with_names()
    rooms_df = _load_rooms_with_names()

    if amenity_df.empty:
        log.error("No amenity folio rows found — aborting.")
        return

    amenity_with_seasons = _assign_dynamic_seasons(amenity_df, "season_date", seasons)
    rooms_with_seasons = _assign_dynamic_seasons(rooms_df, "check_in_date", seasons)

    if dry_run:
        log.info("[DRY RUN] Would build using current season table values:")
        log.info("  amenity_season_spend          source rows=%d", len(amenity_with_seasons))
        log.info("  member_amenity_profile        members=%d", amenity_df["member_id"].nunique())
        log.info("  member_amenity_season_visits  source rows=%d", len(amenity_with_seasons))
        log.info("  season_villa_bedroom_summary  source rows=%d", len(rooms_with_seasons))
        return

    build_amenity_season_spend(amenity_df, seasons)
    build_member_amenity_profile(amenity_df)
    build_member_amenity_season_visits(amenity_df, seasons)
    build_season_villa_bedroom_summary(rooms_df, seasons)

    log.info("=== Amenity × Season pipeline complete ===")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build amenity × season cross-analysis tables from dynamic season tables."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read data but do not write tables",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop/recreate amenity-season output tables before build",
    )
    parser.add_argument(
        "--group-type",
        default="business",
        choices=["business", "custom"],
        help="Season group type to use for dynamic season assignment",
    )

    args = parser.parse_args()
    build_amenity_season_tables(
        dry_run=args.dry_run,
        recreate=args.recreate,
        group_type=args.group_type,
    )


if __name__ == "__main__":
    main()
