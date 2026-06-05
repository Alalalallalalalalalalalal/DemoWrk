"""
specfic_tb.py

Builds derived/analytics tables from folios data:

  1. seasons         — config table of season definitions (editable via frontend).
                       Seeded on first run; frontend can add/edit/disable/delete.

  2. amenity_spend   — per-member spend and visit counts per amenity type,
                       parsed from folio descriptions.

  3. member_seasons  — which season each member's reservation falls into,
                       with villa name, bedroom count, nights, and date ranges.
                       Computed from folios using the seasons config table.

Run after cleaner.py has loaded folios:
    python specfic_tb.py
    python specfic_tb.py --dry-run
    python specfic_tb.py --recreate-tables
    python specfic_tb.py --amenity-only
    python specfic_tb.py --seasons-only
"""

import os
import re
import logging
import argparse
from collections import Counter
from datetime import date

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
DB_CONFIG = {
    "host":                os.getenv("DB_HOST"),
    "port":                os.getenv("DB_PORT"),
    "database":            os.getenv("DB_NAME"),
    "user":                os.getenv("DB_USER"),
    "password":            os.getenv("DB_PASSWORD"),
    "keepalives":          1,
    "keepalives_idle":     30,
    "keepalives_interval": 10,
    "keepalives_count":    5,
    "connect_timeout":     30,
    "options":             "-c statement_timeout=0",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# DEFAULT SEASON SEED DATA
# Used only to populate the seasons table on first run.
# After that, the frontend owns this data.
# ─────────────────────────────────────────────
DEFAULT_SEASONS = [
    # Year-agnostic recurring season definitions: name, start_month, start_day, end_month, end_day
    # These apply to every folio year. Example: Feb 10 in any year => High Season 1.
    ("High Season 1",     1,  3,  3,  6),
    ("Spring Break",      3,  7,  3, 27),
    ("High Season 2",     3, 28,  4, 24),
    ("Shoulder Season 1", 4, 25,  7, 24),
    ("Summer Season",     7, 25, 10, 30),
    ("Shoulder Season 2",10, 31, 11, 20),
    ("Thanksgiving",     11, 21, 11, 28),
    ("Shoulder Season 3",11, 29, 12, 11),
    ("High Season 3",    12, 12, 12, 18),
    # Wraparound season: Dec 19 through Jan 3, regardless of year.
    ("Festive",          12, 19,  1,  3),
]



# ─────────────────────────────────────────────
# AMENITY KEYWORD MAP
# ─────────────────────────────────────────────
AMENITY_PATTERNS = {
    "Golf":             r"\bgolf\b",
    "Tennis":           r"\btennis\b",
    "Bar":              r"\bbar\b",
    "Grill":            r"\bgrill\b",
    "Boutique":         r"\bboutique\b",
    "Airport Transfer": r"\bairport\s*(transfer|shuttle|transport)\b",
    "Breakfast":        r"\bbreakfast\b",
    "Lunch":            r"\blunch\b",
    "Dinner":           r"\bdinner\b",
    "Restaurant":       r"\brestaurant\b",
}

_COMPILED = {k: re.compile(v, re.IGNORECASE) for k, v in AMENITY_PATTERNS.items()}


def classify_amenity(description: str) -> list[str]:
    """
    Return amenity types matching the folio description.
    'Restaurant' is suppressed when Breakfast/Lunch/Dinner already matched.
    """
    if not description:
        return []
    matched = [k for k, pat in _COMPILED.items() if pat.search(description)]
    meal_subtypes = {"Breakfast", "Lunch", "Dinner"}
    if "Restaurant" in matched and set(matched) & meal_subtypes:
        matched = [m for m in matched if m != "Restaurant"]
    return matched


# ─────────────────────────────────────────────
# DDL
# ─────────────────────────────────────────────
DDL = """
-- ── Season config table — owned by the frontend ──────────────────────────────
-- Add, edit, disable, or delete seasons here via the admin UI.
-- member_seasons is rebuilt from folios using only active (is_active = true) rows.
CREATE TABLE IF NOT EXISTS seasons (
    id              SERIAL PRIMARY KEY,
    season_name     VARCHAR(100) NOT NULL,
    start_month     INTEGER      NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    start_day       INTEGER      NOT NULL CHECK (start_day BETWEEN 1 AND 31),
    end_month       INTEGER      NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    end_day         INTEGER      NOT NULL CHECK (end_day BETWEEN 1 AND 31),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (season_name, start_month, start_day, end_month, end_day)
);

-- ── Per-member amenity spend — aggregated from folio descriptions ─────────────
CREATE TABLE IF NOT EXISTS amenity_spend (
    id              SERIAL PRIMARY KEY,
    -- No FK here: folios can contain member numbers that are not present
    -- in members yet, and analytics should still keep those rows.
    member_number   VARCHAR(50),
    amenity_type    VARCHAR(100) NOT NULL,
    total_spent     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    visit_count     INTEGER       NOT NULL DEFAULT 0,
    last_visit_date DATE,
    UNIQUE (member_number, amenity_type)
);

-- ── Per-member season visits — computed from folios + seasons config ──────────
-- member_number has no FK to members because folios may reference member numbers
-- that haven't been loaded into the members table yet.
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

DROP_ANALYTICS = """
DROP TABLE IF EXISTS amenity_spend, member_seasons, seasons CASCADE;
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
        log.info("Creating tables if not exist...")
        cur.execute(DDL)
    conn.commit()
    log.info("Tables ready.")


# ─────────────────────────────────────────────
# SEED SEASONS
# ─────────────────────────────────────────────
def seed_seasons(conn, dry_run=False):
    """
    Insert recurring month/day season definitions into seasons.
    Re-runs do not overwrite frontend edits because conflicts do nothing.
    """
    log.info("Seeding recurring seasons table...")

    sql = """
        INSERT INTO seasons
            (season_name, start_month, start_day, end_month, end_day, is_active)
        VALUES %s
        ON CONFLICT (season_name, start_month, start_day, end_month, end_day) DO NOTHING
    """
    values = [(name, sm, sd, em, ed, True) for name, sm, sd, em, ed in DEFAULT_SEASONS]

    if dry_run:
        log.info(f"  [DRY RUN] Would seed {len(values)} recurring season rows")
        return

    with conn.cursor() as cur:
        execute_values(cur, sql, values)
    conn.commit()
    log.info(f"  Seeded {len(values)} recurring season definitions (skipped existing)")


def load_active_seasons(conn) -> list[tuple]:
    """
    Load active recurring season definitions from the DB.
    Returns list of (id, season_name, start_month, start_day, end_month, end_day).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, season_name, start_month, start_day, end_month, end_day
            FROM seasons
            WHERE is_active = TRUE
            ORDER BY
                CASE WHEN start_month = 1 AND start_day = 1 THEN 0 ELSE 1 END,
                start_month, start_day
        """)
        return cur.fetchall()


def season_for_date(d: date, seasons: list[tuple]):
    """
    Return (season_id, season_name) for a date using month/day only.
    This ignores the year, so seasons work dynamically across all folio years.
    Handles wraparound ranges like Dec 19 -> Jan 3.
    """
    if d is None:
        return None, None

    md = (d.month, d.day)

    for season_id, name, start_month, start_day, end_month, end_day in seasons:
        start_md = (start_month, start_day)
        end_md = (end_month, end_day)

        # Normal range, e.g. Jan 3 -> Mar 6
        if start_md <= end_md:
            if start_md <= md <= end_md:
                return season_id, name
        # Wraparound range, e.g. Dec 19 -> Jan 3
        else:
            if md >= start_md or md <= end_md:
                return season_id, name

    return None, None



# ─────────────────────────────────────────────
# BUILD AMENITY SPEND
# ─────────────────────────────────────────────
def build_amenity_spend(conn, dry_run=False):
    """
    Read folio rows, classify descriptions into amenity types, and aggregate
    spend + visit counts per (member_number, amenity_type).

    Important: this intentionally does NOT join to members. Folios may contain
    member numbers that have not been loaded into the members table yet, and
    joining to members would silently drop those analytics rows.
    """
    log.info("Building amenity_spend from folios...")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT member_number, description, amount, transaction_date
            FROM folios
            WHERE member_number IS NOT NULL
              AND description   IS NOT NULL
        """)
        rows = cur.fetchall()

        cur.execute("""
            SELECT COUNT(DISTINCT f.member_number)
            FROM folios f
            LEFT JOIN members m ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND f.description   IS NOT NULL
              AND m.member_number IS NULL
        """)
        orphan_count = cur.fetchone()[0]

    log.info(f"  {len(rows)} folio rows to classify")
    if orphan_count:
        log.warning(f"  Including folio rows for {orphan_count} member_number(s) not in members table")

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
            agg[key]["total_spent"] += spend
            agg[key]["visit_count"] += 1
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

    if not dry_run:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM amenity_spend")
        log.info("  Cleared existing amenity_spend rows")

    if not output_rows:
        log.info("  amenity_spend: 0 rows upserted")
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
        for r in output_rows
    ]

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(output_rows)} amenity_spend rows")
        return len(output_rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=1000)
    log.info(f"  amenity_spend: {len(output_rows)} rows upserted")
    return len(output_rows)


# ─────────────────────────────────────────────
# BUILD MEMBER SEASONS
# ─────────────────────────────────────────────
def build_member_seasons(conn, dry_run=False):
    """
    Read distinct reservations from folios and match each to an active recurring
    month/day season. Aggregates per (member_number, season).

    No JOIN to members — all folio member_numbers are included regardless of
    whether they exist in the members table, so no records are lost.
    """
    log.info("Building member_seasons from folios using dynamic month/day seasons...")

    active_seasons = load_active_seasons(conn)
    if not active_seasons:
        log.warning("  No active seasons found in seasons table — run seed first")
        return 0
    log.info(f"  Using {len(active_seasons)} active recurring season definitions")

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

        cur.execute("""
            SELECT COUNT(DISTINCT member_number)
            FROM folios
            WHERE member_number IS NOT NULL
              AND COALESCE(check_in_date, transaction_date) IS NULL
        """)
        missing_date_members = cur.fetchone()[0]

    log.info(f"  {len(rows)} distinct folio reservation/date rows to classify")
    if missing_date_members:
        log.warning(f"  {missing_date_members} member_number(s) have folio rows with no check_in_date or transaction_date")

    agg: dict[tuple, dict] = {}
    matched_count = 0
    skipped_no_season_count = 0
    skipped_bad_nights_count = 0
    matched_by_season = Counter()
    skipped_month_days = Counter()
    matched_examples = []
    skipped_examples = []

    for member_number, conf_code, season_date, check_out, villa_name, bedroom_count in rows:
        season_id, season_name = season_for_date(season_date, active_seasons)
        if not season_id:
            skipped_no_season_count += 1
            skipped_month_days[(season_date.month, season_date.day)] += 1
            if len(skipped_examples) < 10:
                skipped_examples.append((member_number, conf_code, season_date, "no active season range"))
            continue

        matched_count += 1
        matched_by_season[season_name] += 1
        if len(matched_examples) < 10:
            matched_examples.append((member_number, conf_code, season_date, season_name))

        nights = 0
        if check_out:
            nights = (check_out - season_date).days
            if nights < 0:
                skipped_bad_nights_count += 1
                nights = 0

        key = (member_number, season_id)

        if key not in agg:
            agg[key] = {
                "season_name":    season_name,
                "visit_count":    0,
                "total_nights":   0,
                "first_check_in": None,
                "last_check_out": None,
                "villa_counts":   Counter(),
                "bedroom_counts": Counter(),
            }

        agg[key]["visit_count"]  += 1
        agg[key]["total_nights"] += nights

        prev = agg[key]["first_check_in"]
        agg[key]["first_check_in"] = season_date if (prev is None or season_date < prev) else prev

        if check_out:
            prev = agg[key]["last_check_out"]
            agg[key]["last_check_out"] = check_out if (prev is None or check_out > prev) else prev

        if villa_name:
            agg[key]["villa_counts"][villa_name] += 1

        if bedroom_count is not None:
            agg[key]["bedroom_counts"][bedroom_count] += 1

    log.info(f"  Season match diagnostics: matched={matched_count}, skipped_no_season={skipped_no_season_count}, bad_night_ranges={skipped_bad_nights_count}")
    if matched_by_season:
        log.info("  Matched by season: " + ", ".join(f"{name}={count}" for name, count in matched_by_season.most_common()))
    if skipped_month_days:
        log.warning("  Top skipped month/day values: " + ", ".join(f"{m:02d}-{d:02d}={count}" for (m, d), count in skipped_month_days.most_common(10)))
    if matched_examples:
        log.info("  Matched examples: " + "; ".join(f"{mn} {conf or '-'} {dt} -> {season}" for mn, conf, dt, season in matched_examples))
    if skipped_examples:
        log.warning("  Skipped examples: " + "; ".join(f"{mn} {conf or '-'} {dt} -> {reason}" for mn, conf, dt, reason in skipped_examples))

    output_rows = [
        {
            "member_number":    mn,
            "season_id":        sid,
            "season_name":      v["season_name"],
            "visit_count":      v["visit_count"],
            "total_nights":     v["total_nights"],
            "first_check_in":   v["first_check_in"],
            "last_check_out":   v["last_check_out"],
            "top_villa":        v["villa_counts"].most_common(1)[0][0] if v["villa_counts"] else None,
            "top_bedroom_count": v["bedroom_counts"].most_common(1)[0][0] if v["bedroom_counts"] else None,
        }
        for (mn, sid), v in agg.items()
    ]

    if not dry_run:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM member_seasons")
        log.info("  Cleared existing member_seasons rows")

    if not output_rows:
        log.info("  member_seasons: 0 rows upserted")
        return 0

    sql = """
        INSERT INTO member_seasons
            (member_number, season_id, season_name, visit_count, total_nights,
             first_check_in, last_check_out, top_villa, top_bedroom_count)
        VALUES %s
        ON CONFLICT (member_number, season_id) DO UPDATE SET
            season_name       = EXCLUDED.season_name,
            visit_count       = EXCLUDED.visit_count,
            total_nights      = EXCLUDED.total_nights,
            first_check_in    = EXCLUDED.first_check_in,
            last_check_out    = EXCLUDED.last_check_out,
            top_villa         = EXCLUDED.top_villa,
            top_bedroom_count = EXCLUDED.top_bedroom_count
    """
    values = [
        (r["member_number"], r["season_id"], r["season_name"],
         r["visit_count"], r["total_nights"],
         r["first_check_in"], r["last_check_out"],
         r["top_villa"], r["top_bedroom_count"])
        for r in output_rows
    ]

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(output_rows)} member_seasons rows")
        return len(output_rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=1000)
    log.info(f"  member_seasons: {len(output_rows)} rows upserted")
    return len(output_rows)




# ─────────────────────────────────────────────
# SOURCE DIAGNOSTICS
# ─────────────────────────────────────────────
def print_source_diagnostics(conn):
    """Show why analytics output may be lower than the raw member/folio count."""
    print()
    print("=" * 60)
    print("Folio Source Diagnostics")
    print("=" * 60)

    queries = {
        "Folio rows": "SELECT COUNT(*) FROM folios",
        "Distinct folio member_numbers": "SELECT COUNT(DISTINCT member_number) FROM folios WHERE member_number IS NOT NULL",
        "Distinct folio confirmations": "SELECT COUNT(DISTINCT conf_code) FROM folios WHERE conf_code IS NOT NULL",
        "Folio members also in members table": """
            SELECT COUNT(DISTINCT f.member_number)
            FROM folios f
            JOIN members m ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
        """,
        "Folio members missing from members table": """
            SELECT COUNT(DISTINCT f.member_number)
            FROM folios f
            LEFT JOIN members m ON m.member_number = f.member_number
            WHERE f.member_number IS NOT NULL
              AND m.member_number IS NULL
        """,
        "Folio members with check_in_date": """
            SELECT COUNT(DISTINCT member_number)
            FROM folios
            WHERE member_number IS NOT NULL
              AND check_in_date IS NOT NULL
        """,
        "Folio members with transaction_date fallback": """
            SELECT COUNT(DISTINCT member_number)
            FROM folios
            WHERE member_number IS NOT NULL
              AND COALESCE(check_in_date, transaction_date) IS NOT NULL
        """,
        "Folio rows matching amenity keywords": """
            SELECT COUNT(*)
            FROM folios
            WHERE member_number IS NOT NULL
              AND description IS NOT NULL
              AND (
                    description ~* '\mgolf\M'
                 OR description ~* '\mtennis\M'
                 OR description ~* '\mbar\M'
                 OR description ~* '\mgrill\M'
                 OR description ~* '\mboutique\M'
                 OR description ~* '\mairport\s*(transfer|shuttle|transport)\M'
                 OR description ~* '\mbreakfast\M'
                 OR description ~* '\mlunch\M'
                 OR description ~* '\mdinner\M'
                 OR description ~* '\mrestaurant\M'
              )
        """,
    }

    for label, sql in queries.items():
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                result = cur.fetchone()
                print(f"  {label}: {result[0] if result else 'n/a'}")
        except Exception as e:
            conn.rollback()
            print(f"  {label}: skipped ({e})")

# ─────────────────────────────────────────────
# QUICK SUMMARY REPORT
# ─────────────────────────────────────────────
def print_summary(conn):
    print()
    print("=" * 60)
    print("Analytics Summary")
    print("=" * 60)

    queries = {
        "Active seasons defined":     "SELECT COUNT(*) FROM seasons WHERE is_active = TRUE",
        "Total amenity_spend rows":   "SELECT COUNT(*) FROM amenity_spend",
        "Members with amenity data":  "SELECT COUNT(DISTINCT member_number) FROM amenity_spend",
        "Top amenity by visits": """
            SELECT amenity_type, SUM(visit_count) AS visits
            FROM amenity_spend
            GROUP BY amenity_type ORDER BY visits DESC LIMIT 1
        """,
        "Top amenity by spend": """
            SELECT amenity_type, ROUND(SUM(total_spent)::NUMERIC, 2) AS spent
            FROM amenity_spend
            GROUP BY amenity_type ORDER BY spent DESC LIMIT 1
        """,
        "Total member_seasons rows":  "SELECT COUNT(*) FROM member_seasons",
        "Members with season data":   "SELECT COUNT(DISTINCT member_number) FROM member_seasons",
        "Most visited season": """
            SELECT season_name, SUM(visit_count) AS visits
            FROM member_seasons
            GROUP BY season_name ORDER BY visits DESC LIMIT 1
        """,
        "Most visited villa": """
            SELECT top_villa, SUM(visit_count) AS visits
            FROM member_seasons
            WHERE top_villa IS NOT NULL
            GROUP BY top_villa ORDER BY visits DESC LIMIT 1
        """,
        "Most popular bedroom count": """
            SELECT top_bedroom_count, SUM(visit_count) AS visits
            FROM member_seasons
            WHERE top_bedroom_count IS NOT NULL
            GROUP BY top_bedroom_count ORDER BY visits DESC LIMIT 1
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
        description="Build seasons config, amenity_spend, and member_seasons tables."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Classify and aggregate but do not write to DB")
    parser.add_argument("--recreate-tables", action="store_true",
                        help="Drop and recreate all analytics tables before building")
    parser.add_argument("--amenity-only", action="store_true",
                        help="Only rebuild amenity_spend")
    parser.add_argument("--seasons-only", action="store_true",
                        help="Only rebuild member_seasons (still seeds seasons config)")
    parser.add_argument("--seed-only", action="store_true",
                        help="Only seed the seasons config table, do not build analytics")
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

    # Always seed seasons so the config table is never empty on first run
    seed_seasons(conn, dry_run=args.dry_run)

    if args.seed_only:
        conn.close()
        print("\nDone — seasons seeded only.")
        return

    if not args.dry_run:
        print_source_diagnostics(conn)

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