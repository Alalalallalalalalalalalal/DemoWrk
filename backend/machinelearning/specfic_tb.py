"""
specfic_tb.py

Builds two derived/analytics tables from the folios data:

  1. amenity_spend  — per-member spend and visit counts for each amenity
                      (golf, grill, bar, restaurant sub-types, tennis,
                       boutique, airport transfer) parsed from folio descriptions.

  2. member_seasons — which season(s) each member's reservation falls into,
                      derived from folio check_in_date / check_out_date.

Run after cleaner.py has loaded folios:
    python specfic_tb.py
    python specfic_tb.py --dry-run
    python specfic_tb.py --recreate-tables
"""

import os
import re
import logging
import argparse
from datetime import date, timedelta

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
DB_CONFIG = {
    "host":              os.getenv("DB_HOST"),
    "port":              os.getenv("DB_PORT"),
    "database":          os.getenv("DB_NAME"),
    "user":              os.getenv("DB_USER"),
    "password":          os.getenv("DB_PASSWORD"),
    "keepalives":        1,
    "keepalives_idle":   30,
    "keepalives_interval": 10,
    "keepalives_count":  5,
    "connect_timeout":   30,
    "options":           "-c statement_timeout=0",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# SEASON DEFINITIONS
# Each entry: (season_name, start_date inclusive, end_date inclusive)
# Dates are month/day only — resolved against the folio year at query time.
# We store them as real dates anchored to the 2025-2026 season cycle.
# ─────────────────────────────────────────────
SEASONS = [
    ("High Season 1",      date(2026, 1,  3),  date(2026, 3,  6)),
    ("Spring Break",       date(2026, 3,  7),  date(2026, 3, 27)),
    ("High Season 2",      date(2026, 3, 28),  date(2026, 4, 24)),
    ("Shoulder Season 1",  date(2026, 4, 25),  date(2026, 7, 24)),
    ("Summer Season",      date(2026, 7, 25),  date(2026, 10, 30)),
    ("Shoulder Season 2",  date(2026, 10, 31), date(2026, 11, 20)),
    ("Thanksgiving",       date(2026, 11, 21), date(2026, 11, 28)),
    ("Shoulder Season 3",  date(2026, 11, 29), date(2026, 12, 11)),
    ("High Season 3",      date(2026, 12, 12), date(2026, 12, 18)),
    ("Festive",            date(2026, 12, 19), date(2027, 1,  3)),
    # Previous cycle (covers reservations that checked in before Jan 3 2026)
    ("Festive",            date(2025, 12, 19), date(2026, 1,  2)),
    ("High Season 3",      date(2025, 12, 12), date(2025, 12, 18)),
    ("Shoulder Season 3",  date(2025, 11, 29), date(2025, 12, 11)),
    ("Thanksgiving",       date(2025, 11, 21), date(2025, 11, 28)),
    ("Shoulder Season 2",  date(2025, 10, 31), date(2025, 11, 20)),
    ("Summer Season",      date(2025, 7,  25), date(2025, 10, 30)),
    ("Shoulder Season 1",  date(2025, 4,  25), date(2025, 7,  24)),
    ("High Season 2",      date(2025, 3,  28), date(2025, 4,  24)),
    ("Spring Break",       date(2025, 3,   7), date(2025, 3,  27)),
    ("High Season 1",      date(2025, 1,   3), date(2025, 3,   6)),
    ("Festive",            date(2024, 12, 19), date(2025, 1,   2)),
]


def season_for_date(d: date):
    """Return the season name for a given date, or None if outside all ranges."""
    if d is None:
        return None
    for name, start, end in SEASONS:
        if start <= d <= end:
            return name
    return None


# ─────────────────────────────────────────────
# AMENITY KEYWORD MAP
# Keys are the canonical amenity_type stored in the DB.
# Values are regex patterns matched (case-insensitive) against folio description.
# ─────────────────────────────────────────────
AMENITY_PATTERNS = {
    "Golf":              r"\bgolf\b",
    "Tennis":            r"\btennis\b",
    "Bar":               r"\bbar\b",
    "Grill":             r"\bgrill\b",
    "Boutique":          r"\bboutique\b",
    "Airport Transfer":  r"\bairport\s*(transfer|shuttle|transport)\b",
    "Breakfast":         r"\bbreakfast\b",
    "Lunch":             r"\blunch\b",
    "Dinner":            r"\bdinner\b",
    # Catch-all restaurant that isn't already breakfast/lunch/dinner
    "Restaurant":        r"\brestaurant\b",
}

# Compile all patterns once
_COMPILED = {k: re.compile(v, re.IGNORECASE) for k, v in AMENITY_PATTERNS.items()}


def classify_amenity(description: str) -> list[str]:
    """
    Return a list of amenity types that match the folio description.
    A single line can match multiple types (e.g. 'Golf Cart Breakfast').
    'Restaurant' is only emitted when the description doesn't already match
    Breakfast, Lunch, or Dinner, to avoid double-counting.
    """
    if not description:
        return []

    matched = [k for k, pat in _COMPILED.items() if pat.search(description)]

    # Suppress generic 'Restaurant' when a meal sub-type already matched
    meal_subtypes = {"Breakfast", "Lunch", "Dinner"}
    if "Restaurant" in matched and set(matched) & meal_subtypes:
        matched = [m for m in matched if m != "Restaurant"]

    return matched


# ─────────────────────────────────────────────
# DDL
# ─────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS amenity_spend (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    amenity_type        VARCHAR(100) NOT NULL,   -- Golf, Tennis, Bar, etc.
    total_spent         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    visit_count         INTEGER       NOT NULL DEFAULT 0,
    last_visit_date     DATE,
    UNIQUE (member_number, amenity_type)
);

CREATE TABLE IF NOT EXISTS member_seasons (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    season_name         VARCHAR(100) NOT NULL,
    visit_count         INTEGER      NOT NULL DEFAULT 0,  -- number of reservations in this season
    total_nights        INTEGER      NOT NULL DEFAULT 0,
    first_check_in      DATE,
    last_check_out      DATE,
    UNIQUE (member_number, season_name)
);
"""

DROP_ANALYTICS = """
DROP TABLE IF EXISTS amenity_spend, member_seasons CASCADE;
"""


# ─────────────────────────────────────────────
# DB HELPERS
# ─────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def create_tables(conn, recreate=False):
    with conn.cursor() as cur:
        if recreate:
            log.info("Dropping analytics tables...")
            cur.execute(DROP_ANALYTICS)
        log.info("Creating analytics tables if not exist...")
        cur.execute(DDL)
    conn.commit()
    log.info("Analytics tables ready.")


def upsert_amenity_spend(conn, rows, dry_run=False):
    """
    Upsert amenity_spend rows.
    On conflict, accumulate spend and visit counts rather than overwrite.
    """
    if not rows:
        return 0

    sql = """
        INSERT INTO amenity_spend
            (member_number, amenity_type, total_spent, visit_count, last_visit_date)
        VALUES %s
        ON CONFLICT (member_number, amenity_type) DO UPDATE SET
            total_spent     = amenity_spend.total_spent     + EXCLUDED.total_spent,
            visit_count     = amenity_spend.visit_count     + EXCLUDED.visit_count,
            last_visit_date = GREATEST(amenity_spend.last_visit_date, EXCLUDED.last_visit_date)
    """

    values = [
        (r["member_number"], r["amenity_type"],
         r["total_spent"], r["visit_count"], r["last_visit_date"])
        for r in rows
    ]

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(rows)} amenity_spend rows")
        return len(rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=1000)
    return len(rows)


def upsert_member_seasons(conn, rows, dry_run=False):
    """
    Upsert member_seasons rows.
    On conflict, accumulate visit counts, nights, and widen the date range.
    """
    if not rows:
        return 0

    sql = """
        INSERT INTO member_seasons
            (member_number, season_name, visit_count, total_nights,
             first_check_in, last_check_out)
        VALUES %s
        ON CONFLICT (member_number, season_name) DO UPDATE SET
            visit_count    = member_seasons.visit_count  + EXCLUDED.visit_count,
            total_nights   = member_seasons.total_nights + EXCLUDED.total_nights,
            first_check_in = LEAST(member_seasons.first_check_in,  EXCLUDED.first_check_in),
            last_check_out = GREATEST(member_seasons.last_check_out, EXCLUDED.last_check_out)
    """

    values = [
        (r["member_number"], r["season_name"], r["visit_count"],
         r["total_nights"], r["first_check_in"], r["last_check_out"])
        for r in rows
    ]

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(rows)} member_seasons rows")
        return len(rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=1000)
    return len(rows)


# ─────────────────────────────────────────────
# BUILD AMENITY SPEND
# ─────────────────────────────────────────────
def build_amenity_spend(conn, dry_run=False):
    """
    Read all folio rows that have a member_number and a description,
    classify the description, and aggregate spend + visit counts per
    (member_number, amenity_type).
    """
    log.info("Building amenity_spend from folios...")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT f.member_number, f.description, f.amount, f.transaction_date
            FROM folios f
            JOIN members m
              ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND f.description IS NOT NULL
        """)
        rows = cur.fetchall()

        cur.execute("""
            SELECT COUNT(DISTINCT f.member_number)
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND f.description IS NOT NULL
              AND m.member_number IS NULL
        """)
        orphan_member_count = cur.fetchone()[0]

    log.info(f"  {len(rows)} folio rows to classify")
    if orphan_member_count:
        log.warning(
            f"  Skipped folio rows for {orphan_member_count} member_number(s) "
            "not present in members"
        )

    # Accumulate: (member_number, amenity_type) -> {total_spent, visit_count, last_visit_date}
    agg: dict[tuple, dict] = {}

    for member_number, description, amount, txn_date in rows:
        amenities = classify_amenity(description)
        if not amenities:
            continue

        spend = float(amount) if amount is not None else 0.0

        for amenity in amenities:
            key = (member_number, amenity)
            if key not in agg:
                agg[key] = {"total_spent": 0.0, "visit_count": 0, "last_visit_date": None}

            agg[key]["total_spent"]  += spend
            agg[key]["visit_count"]  += 1
            if txn_date:
                prev = agg[key]["last_visit_date"]
                agg[key]["last_visit_date"] = txn_date if (prev is None or txn_date > prev) else prev

    output_rows = [
        {
            "member_number":   mn,
            "amenity_type":    amenity,
            "total_spent":     round(v["total_spent"], 2),
            "visit_count":     v["visit_count"],
            "last_visit_date": v["last_visit_date"],
        }
        for (mn, amenity), v in agg.items()
    ]

    # Clear existing data before re-aggregating so counts don't double on re-runs
    if not dry_run:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM amenity_spend")
        log.info("  Cleared existing amenity_spend rows")

    count = upsert_amenity_spend(conn, output_rows, dry_run)
    log.info(f"  amenity_spend: {count} rows upserted")
    return count


# ─────────────────────────────────────────────
# BUILD MEMBER SEASONS
# ─────────────────────────────────────────────
def build_member_seasons(conn, dry_run=False):
    """
    Read distinct (member_number, conf_code, check_in_date, check_out_date)
    combos from folios, determine which season each stay falls in, and
    aggregate visit counts, nights, and date ranges per (member, season).
    """
    log.info("Building member_seasons from folios...")

    with conn.cursor() as cur:
        # Use DISTINCT to avoid counting the same reservation multiple times
        # (one reservation can have many folio transaction rows)
        cur.execute("""
            SELECT DISTINCT f.member_number, f.conf_code, f.check_in_date, f.check_out_date
            FROM folios f
            JOIN members m
              ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND f.check_in_date IS NOT NULL
        """)
        rows = cur.fetchall()

        cur.execute("""
            SELECT COUNT(DISTINCT f.member_number)
            FROM folios f
            LEFT JOIN members m
              ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND f.check_in_date IS NOT NULL
              AND m.member_number IS NULL
        """)
        orphan_member_count = cur.fetchone()[0]

    log.info(f"  {len(rows)} distinct reservations to classify")
    if orphan_member_count:
        log.warning(
            f"  Skipped reservations for {orphan_member_count} member_number(s) "
            "not present in members"
        )

    # Accumulate: (member_number, season_name) -> {visit_count, total_nights, first_check_in, last_check_out}
    agg: dict[tuple, dict] = {}

    for member_number, conf_code, check_in, check_out in rows:
        season = season_for_date(check_in)
        if not season:
            continue

        nights = (check_out - check_in).days if check_out else 0

        key = (member_number, season)
        if key not in agg:
            agg[key] = {
                "visit_count":   0,
                "total_nights":  0,
                "first_check_in":  None,
                "last_check_out":  None,
            }

        agg[key]["visit_count"]  += 1
        agg[key]["total_nights"] += nights

        if check_in:
            prev = agg[key]["first_check_in"]
            agg[key]["first_check_in"] = check_in if (prev is None or check_in < prev) else prev

        if check_out:
            prev = agg[key]["last_check_out"]
            agg[key]["last_check_out"] = check_out if (prev is None or check_out > prev) else prev

    output_rows = [
        {
            "member_number":  mn,
            "season_name":    season,
            "visit_count":    v["visit_count"],
            "total_nights":   v["total_nights"],
            "first_check_in": v["first_check_in"],
            "last_check_out": v["last_check_out"],
        }
        for (mn, season), v in agg.items()
    ]

    # Clear before re-aggregating
    if not dry_run:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM member_seasons")
        log.info("  Cleared existing member_seasons rows")

    count = upsert_member_seasons(conn, output_rows, dry_run)
    log.info(f"  member_seasons: {count} rows upserted")
    return count


# ─────────────────────────────────────────────
# QUICK SUMMARY REPORT
# ─────────────────────────────────────────────
def print_summary(conn):
    """Print a quick sanity-check after building analytics tables."""
    print()
    print("=" * 60)
    print("Analytics Summary")
    print("=" * 60)

    queries = {
        "Total amenity_spend rows":   "SELECT COUNT(*) FROM amenity_spend",
        "Members with amenity data":  "SELECT COUNT(DISTINCT member_number) FROM amenity_spend",
        "Top amenity by visits": """
            SELECT amenity_type, SUM(visit_count) AS visits
            FROM amenity_spend
            GROUP BY amenity_type
            ORDER BY visits DESC
            LIMIT 1
        """,
        "Top amenity by spend": """
            SELECT amenity_type, ROUND(SUM(total_spent)::NUMERIC, 2) AS spent
            FROM amenity_spend
            GROUP BY amenity_type
            ORDER BY spent DESC
            LIMIT 1
        """,
        "Total member_seasons rows":  "SELECT COUNT(*) FROM member_seasons",
        "Members with season data":   "SELECT COUNT(DISTINCT member_number) FROM member_seasons",
        "Most visited season": """
            SELECT season_name, SUM(visit_count) AS visits
            FROM member_seasons
            GROUP BY season_name
            ORDER BY visits DESC
            LIMIT 1
        """,
    }

    for label, sql in queries.items():
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                result = cur.fetchone()
                if result and len(result) > 1:
                    print(f"  {label}: {' | '.join(str(v) for v in result)}")
                else:
                    print(f"  {label}: {result[0] if result else 'n/a'}")
        except Exception as e:
            conn.rollback()
            print(f"  {label}: skipped ({e})")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Build amenity_spend and member_seasons analytics tables from folios."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Classify and aggregate but do not write to DB")
    parser.add_argument("--recreate-tables", action="store_true",
                        help="Drop and recreate analytics tables before building")
    parser.add_argument("--amenity-only", action="store_true",
                        help="Only rebuild amenity_spend")
    parser.add_argument("--seasons-only", action="store_true",
                        help="Only rebuild member_seasons")
    args = parser.parse_args()

    print("=" * 60)
    print("Analytics Builder")
    print("=" * 60)
    print(f"Database:  {DB_CONFIG['database']} @ {DB_CONFIG['host']}")
    print(f"Dry run:   {args.dry_run}")
    print()

    try:
        conn = get_connection()
        conn.autocommit = False
        log.info("Connected to PostgreSQL.")
    except Exception as e:
        log.error(f"Could not connect: {e}")
        return

    create_tables(conn, recreate=args.recreate_tables)

    try:
        if not args.seasons_only:
            build_amenity_spend(conn, dry_run=args.dry_run)
            if not args.dry_run:
                conn.commit()

        if not args.amenity_only:
            build_member_seasons(conn, dry_run=args.dry_run)
            if not args.dry_run:
                conn.commit()
    except Exception as e:
        conn.rollback()
        log.error(f"Error building analytics: {e}")
        raise

    if not args.dry_run:
        print_summary(conn)

    conn.close()
    print()
    print("=" * 60)
    print("Done.")
    print("=" * 60)


if __name__ == "__main__":
    main()