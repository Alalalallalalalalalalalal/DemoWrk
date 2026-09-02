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
#
# [2026-08-13, redone after being lost to an uncommitted-changes discard —
# see 2026-08-19 note below] Classifies off folios.transaction_category
# (the same column CLASSIFICATION_SQL populates and finance_backend.py's
# headline "Amenities Revenue" card sums) instead of an independent
# live-regex match on description. The old version only recognized 9
# literal keywords (spa/massage/facial, golf/pro shop/cart, grill, bar,
# restaurant/dinner/lunch/breakfast, tennis, boutique, shop, commissary)
# and silently DROPPED any row whose description didn't contain one of
# them — e.g. "Villa Wine Sales", "-9H Bar", "-Beach Night Functions" are
# all F&B by transaction_category but matched none of those patterns.
# Measured effect on live data: amenity_season_spend totalled $14.81M
# against the headline card's $26.73M for the exact same period — a
# $11.92M gap, concentrated almost entirely in F&B (missing ~56% of it)
# plus four categories (Water Sports, Equipment, Cart Rental, Events)
# that had no keyword bucket at all and were 100% dropped.
#
# AMENITY_CATEGORY_LABELS must stay in sync with finance_backend.py's
# AMENITY_CATS tuple — those are the transaction_category values that
# count as "Amenities" everywhere else in the app.
#
# [2026-08-19] Commissary moved here from _FNB_SUB_PATTERNS — per the
# repo owner, Commissary is its own category, matching how
# STATEMENT_SPEND_SQL's statement_amenity_lines already classified it on
# the homeowner-statement side (its own 'Commissary' amenity_category, a
# peer of 'F&B', never nested under it). CLASSIFICATION_SQL
# (overview_sql.py) now splits "Commissary Charge%" into its own
# transaction_category = 'Commissary' instead of folding it into 'F&B',
# so this table follows the same split.
AMENITY_CATEGORY_LABELS: dict[str, str] = {
    "Golf":          "Golf",
    "Commissary":    "Commissary",
    "Spa & Beauty":  "Spa",
    "Tennis":        "Tennis",
    "Boutique":      "Boutique",
    "Water Sports":  "Water Sports",
    "Equipment":     "Equipment",
    "Cart Rental":   "Cart Rental",
    "Events":        "Events",
}

# F&B is still worth splitting further (it's the biggest amenity bucket
# by far, and the old table already had these labels). Any F&B-category
# row that doesn't match one of these keywords still gets counted — as
# 'F&B' — instead of being silently dropped, which is the actual bug
# being fixed here.
_FNB_SUB_PATTERNS: dict[str, re.Pattern] = {
    "Grill":      re.compile(r"\bgrill\b", re.IGNORECASE),
    "Bar":        re.compile(r"\bbar\b", re.IGNORECASE),
    "Restaurant": re.compile(r"\b(restaurant|dinner|lunch|breakfast)\b", re.IGNORECASE),
}


def classify_amenity(transaction_category: str | None, description: str | None) -> str | None:
    """
    None means "not an amenity" (excludes Villa, Payment, Membership,
    Adjustment, Cash Advance, Laundry, Reversal, Other, etc. — anything
    outside finance_backend.py's AMENITY_CATS scope), matching the
    headline card's WHERE f.transaction_category IN (...) exactly.
    """
    if transaction_category == "F&B":
        desc = "" if pd.isna(description) else str(description)
        for label, pattern in _FNB_SUB_PATTERNS.items():
            if pattern.search(desc):
                return label
        return "F&B"
    return AMENITY_CATEGORY_LABELS.get(transaction_category)


# ─── Revenue Bucket (mirrors finance_backend.py's _bucket_case_sql()) ─────────
#
# Only 'collected' should ever be summed as revenue; 'forgone_revenue' is
# comp/free value (real cost, $0 actually charged); 'reversed'/'other'
# rows are excluded entirely, matching the headline card's scope.
_FORGONE_RE = re.compile(r"(comp|free|complimentary|gratis|no charge)", re.IGNORECASE)


def _clean_str(value) -> str:
    """pandas returns NaN (a float) for SQL NULL, not None — plain `or`
    truthiness doesn't catch that (NaN is truthy), so .strip() on it
    blows up. pd.isna() is the reliable check for both None and NaN."""
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def compute_bucket(
    transaction_flow: str | None,
    payment_type: str | None,
    business_source_payment_type: str | None,
) -> str:
    if transaction_flow == "Reversal":
        return "reversed"
    if transaction_flow != "Charge":
        return "other"
    effective_payment_type = _clean_str(payment_type) or _clean_str(business_source_payment_type)
    if effective_payment_type and _FORGONE_RE.search(effective_payment_type):
        return "forgone_revenue"
    return "collected"


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
    Load amenity folios joined to member contact/address details.
    Member full name comes from folios.guest_name first, then members table.
    """
    df = _query("""
        SELECT
            f.member_number AS member_id,
            COALESCE(
                NULLIF(TRIM(f.guest_name), ''),
                NULLIF(TRIM(m.member_full_name), ''),
                NULLIF(TRIM(m.member_name), '')
            ) AS member_full_name,

            m.email,
            mp.phone_number AS telephone,
            TRIM(
                CONCAT_WS(
                    ', ',
                    NULLIF(a.address_line1, ''),
                    NULLIF(a.address_line2, ''),
                    NULLIF(a.city, ''),
                    NULLIF(a.state, ''),
                    NULLIF(a.postal_code, ''),
                    NULLIF(a.country, '')
                )
            ) AS address,
            a.country,
            a.state,
            m.prefix AS title,
            m.date_of_birth AS dob,

            f.description,
            f.amount,
            f.transaction_date,
            f.check_in_date,
            f.check_out_date,
            f.villa_name,
            f.bedroom_count,
            f.transaction_category,
            f.transaction_flow,
            f.payment_type,
            bs.payment_type AS business_source_payment_type
        FROM folios f
        LEFT JOIN members m
            ON f.member_number = m.member_number
        LEFT JOIN member_addresses a
            ON f.member_number = a.member_number
        LEFT JOIN business_source bs
            ON LOWER(TRIM(f.source)) = LOWER(TRIM(bs.source_name))
        LEFT JOIN (
            SELECT DISTINCT ON (member_number)
                member_number,
                phone_number
            FROM member_phones
            WHERE phone_number IS NOT NULL
            ORDER BY
                member_number,
                CASE phone_type
                    WHEN 'cell' THEN 1
                    WHEN 'home' THEN 2
                    WHEN 'business' THEN 3
                    ELSE 4
                END
        ) mp
            ON f.member_number = mp.member_number
        WHERE f.member_number IS NOT NULL
    """)

    df["amount"]           = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce")
    df["check_in_date"]    = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"]   = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["dob"]              = pd.to_datetime(df["dob"], errors="coerce")
    df["amenity"] = df.apply(
        lambda r: classify_amenity(r["transaction_category"], r["description"]), axis=1
    )
    df["bucket"] = df.apply(
        lambda r: compute_bucket(
            r["transaction_flow"], r["payment_type"], r["business_source_payment_type"]
        ),
        axis=1,
    )

    # Amenity scope (transaction_category) AND revenue scope (collected /
    # forgone_revenue only — 'reversed' and 'other' rows are excluded
    # entirely, same as finance_backend.py's headline card).
    amenity_df = df[
        df["amenity"].notna() & df["bucket"].isin(["collected", "forgone_revenue"])
    ].copy()
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
      revenue (collected bucket only — reconciles with finance_backend.py's
      headline Amenities Revenue card), free_value (forgone_revenue bucket),
      total_spend (revenue + free_value), transaction_count, avg_spend_per_visit,
      member_count.
    """
    ref_date = amenity_df["check_in_date"].fillna(amenity_df["transaction_date"])
    amenity_df = amenity_df.copy()
    amenity_df["season"] = ref_date.apply(
        lambda d: _season_for_date(d.month, d.day, seasons) if pd.notna(d) else None
    )
    amenity_df = amenity_df[amenity_df["season"].notna()]

    amenity_df["revenue_amt"] = amenity_df["amount"].where(amenity_df["bucket"] == "collected", 0)
    amenity_df["free_amt"] = amenity_df["amount"].where(amenity_df["bucket"] == "forgone_revenue", 0)

    agg = (
        amenity_df.groupby(["amenity", "season"])
        .agg(
            revenue=("revenue_amt", "sum"),
            free_value=("free_amt", "sum"),
            total_spend=("amount", "sum"),
            transaction_count=("amount", "count"),
            member_count=("member_id", "nunique"),
        )
        .reset_index()
    )
    agg["avg_spend_per_visit"] = (agg["total_spend"] / agg["transaction_count"]).round(2)
    for col in ("revenue", "free_value", "total_spend"):
        agg[col] = agg[col].round(2)

    _save(agg, "amenity_season_spend")
    return agg

def build_member_amenity_profile(amenity_df: pd.DataFrame) -> pd.DataFrame:
    """
    Per member: full name, top amenity, spend at that amenity,
    and total spend across all amenities.
    """
    per_member_amenity = (
        amenity_df.groupby(
            ["member_id", "member_full_name", "amenity"],
            dropna=False,
        )
        .agg(
            usage_count=("description", "count"),
            amenity_spend=("amount", "sum"),
        )
        .reset_index()
    )

    idx = per_member_amenity.groupby("member_id")["amenity_spend"].idxmax()

    top_amenity = per_member_amenity.loc[
        idx,
        [
            "member_id",
            "member_full_name",
            "amenity",
            "amenity_spend",
            "usage_count",
        ],
    ].rename(
        columns={
            "amenity": "top_amenity",
            "amenity_spend": "top_amenity_spend",
            "usage_count": "top_amenity_usage_count",
        }
    )

    total_spend = (
        amenity_df.groupby("member_id")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "total_amenity_spend"})
    )

    profile = top_amenity.merge(total_spend, on="member_id", how="left")

    profile["top_amenity_spend"] = profile["top_amenity_spend"].round(2)
    profile["total_amenity_spend"] = profile["total_amenity_spend"].round(2)

    profile = profile.sort_values(
        ["total_amenity_spend", "member_id"],
        ascending=[False, True],
    )

    _save(profile, "member_amenity_profile")
    return profile

def build_member_amenity_season_visits(
    amenity_df: pd.DataFrame,
    seasons: list[dict],
) -> pd.DataFrame:
    """
    Per member × per visit × per amenity used:
    Shows what amenity they used each time they were on property,
    with member contact/address details for export.

    One row per (member, check_in_date, amenity) combination so a member
    visiting during High Season twice produces two rows.
    """
    df = amenity_df.copy()

    ref = df["check_in_date"].fillna(df["transaction_date"])
    df["season"] = ref.apply(
        lambda d: _season_for_date(d.month, d.day, seasons) if pd.notna(d) else None
    )
    df = df[df["season"].notna()].copy()

    group_cols = [
        "member_id",
        "member_full_name",
        "email",
        "telephone",
        "address",
        "country",
        "state",
        "title",
        "dob",
        "season",
        "check_in_date",
        "check_out_date",
        "amenity",
    ]

    agg = (
        df.groupby(group_cols, dropna=False)
        .agg(
            usage_count=("description", "count"),
            total_spend=("amount", "sum"),
        )
        .reset_index()
    )

    agg["check_in_fmt"] = agg["check_in_date"].apply(_fmt_date)
    agg["check_out_fmt"] = agg["check_out_date"].apply(_fmt_date)
    agg["dob"] = agg["dob"].apply(_fmt_date)

    agg = agg.drop(columns=["check_in_date", "check_out_date"])
    agg["total_spend"] = agg["total_spend"].round(2)

    agg = agg.sort_values(["member_full_name", "check_in_fmt", "season", "amenity"])

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