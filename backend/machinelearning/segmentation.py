"""
segmentation.py — Analytics segmentation pipeline (dashboard-ready)

Creates and refreshes:
    1. segment_spenders
    2. segment_visitors
    3. segment_amenities

Designed for dashboard/API consumption (precomputed tables).
"""

import os
import logging
from datetime import date, timedelta

import psycopg
from dotenv import load_dotenv

from season_tables import load_active_seasons, season_for_date

load_dotenv()

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# DB CONFIG
# ─────────────────────────────────────────────
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# ─────────────────────────────────────────────
# THRESHOLDS (calibrated from real data)
# ─────────────────────────────────────────────
HIGH_SPEND = 10000
LOW_SPEND = 1000

FREQUENT_MIN = 4
LAPSED_DAYS = 18 * 30  # ~18 months


# ─────────────────────────────────────────────
# CONNECTION
# ─────────────────────────────────────────────
def get_conn():
    return psycopg.connect(**DB_CONFIG)

#Actually create tables if they don't exist (idempotent)
# ─────────────────────────────────────────────
# DDL
# ─────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS segment_spenders (
    id SERIAL PRIMARY KEY,
    member_number VARCHAR,
    name VARCHAR,
    email VARCHAR,
    tier VARCHAR,
    net_spend NUMERIC,
    spend_categories TEXT[],
    check_in_date DATE,
    check_out_date DATE,
    season VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS segment_visitors (
    id SERIAL PRIMARY KEY,
    member_number VARCHAR,
    name VARCHAR,
    email VARCHAR,
    visitor_type VARCHAR,
    total_reservations INTEGER,
    last_visit DATE,
    check_in_date DATE,
    check_out_date DATE,
    season VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS segment_amenities (
    id SERIAL PRIMARY KEY,
    member_number VARCHAR,
    name VARCHAR,
    email VARCHAR,
    amenity_type VARCHAR,
    total_spend NUMERIC,
    visit_count INTEGER,
    check_in_date DATE,
    check_out_date DATE,
    season VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);
"""
# Execute DDL on startup to ensure tables exist
with get_conn() as conn:
    with conn.cursor() as cur:
        for stmt in DDL.split(";"):
            if stmt.strip():
                cur.execute(stmt)
    conn.commit()

# ─────────────────────────────────────────────
# UTIL: SPEND CATEGORIZATION
# ─────────────────────────────────────────────
def categorize_spend(descriptions):
    categories = set()

    for d in descriptions or []:
        d = (d or "").lower()

        if any(x in d for x in ["bar", "grill", "restaurant", "dinner", "lunch", "breakfast"]):
            categories.add("Food & Beverage")

        if "golf" in d:
            categories.add("Golf")

        if "tennis" in d:
            categories.add("Tennis")

        if "airport" in d:
            categories.add("Transfers")

        if "boutique" in d:
            categories.add("Retail")

    return list(categories)


# ─────────────────────────────────────────────
# CLEAN TABLE REFRESH
# ─────────────────────────────────────────────
def truncate_tables(conn):
    with conn.cursor() as cur:
        cur.execute("TRUNCATE segment_spenders, segment_visitors, segment_amenities")



# ─────────────────────────────────────────────
# 1. SPENDERS
# ─────────────────────────────────────────────
def build_spenders(conn, seasons):
    sql = """
        WITH spend AS (
            SELECT
                member_number,
                guest_name,
                SUM(COALESCE(amount, 0)) AS net_spend,
                ARRAY_AGG(DISTINCT description) AS spend_items
            FROM folios
            WHERE member_number IS NOT NULL
            GROUP BY member_number, guest_name
        ),
        latest_stay AS (
            SELECT DISTINCT ON (member_number)
                member_number,
                check_in_date,
                check_out_date
            FROM folios
            WHERE member_number IS NOT NULL
            ORDER BY member_number, check_in_date DESC
        )
        SELECT
            s.member_number,
            s.guest_name AS name,
            m.email,
            s.net_spend,
            s.spend_items,
            ls.check_in_date,
            ls.check_out_date
        FROM spend s
        LEFT JOIN latest_stay ls ON ls.member_number = s.member_number
        LEFT JOIN members m ON m.member_number = s.member_number;
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            spend = r["net_spend"] or 0

            if spend > HIGH_SPEND:
                tier = "High Spender"
            elif spend >= LOW_SPEND:
                tier = "Medium Spender"
            else:
                tier = "Low Spender"

            categories = categorize_spend(r.get("spend_items"))
            
            #get season for check-in date (if available)
            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_spenders
                (member_number, name, email, tier, net_spend,
                 spend_categories, check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["name"],
                r["email"],
                tier,
                spend,
                categories,
                r["check_in_date"],
                r["check_out_date"],
                season
            ))


# ─────────────────────────────────────────────
# 2. VISITORS
# ─────────────────────────────────────────────
def build_visitors(conn, seasons):
    cutoff = date.today() - timedelta(days=LAPSED_DAYS)

    sql = """
        WITH visits AS (
            SELECT
                member_number,
                guest_name,
                COUNT(DISTINCT conf_code) AS total_reservations,
                MAX(check_out_date) AS last_visit
            FROM folios
            WHERE member_number IS NOT NULL
            GROUP BY member_number, guest_name
        ),
        latest_stay AS (
            SELECT DISTINCT ON (member_number)
                member_number,
                check_in_date,
                check_out_date
            FROM folios
            WHERE member_number IS NOT NULL
            ORDER BY member_number, check_in_date DESC
        )
        SELECT
            v.member_number,
            v.guest_name AS name,
            m.email,
            v.total_reservations,
            v.last_visit,
            ls.check_in_date,
            ls.check_out_date
        FROM visits v
        LEFT JOIN latest_stay ls ON ls.member_number = v.member_number
        LEFT JOIN members m ON m.member_number = v.member_number;
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            res = r["total_reservations"] or 0
            last = r["last_visit"]

            if res >= FREQUENT_MIN:
                vtype = "Frequent"
            elif last is None:
                vtype = "Never Visited"
            elif last < cutoff:
                vtype = "Lapsed"
            else:
                vtype = "Regular"

            #get season for check-in date (if available)
            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_visitors
                (member_number, name, email, visitor_type,
                 total_reservations, last_visit,
                 check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["name"],
                r["email"],
                vtype,
                res,
                r["last_visit"],
                r["check_in_date"],
                r["check_out_date"],
                season
            ))


# ─────────────────────────────────────────────
# 3. AMENITIES (NO GROUPING — AS REQUESTED)
# ─────────────────────────────────────────────
def build_amenities(conn, seasons):
    sql = """
    SELECT
        a.member_number,
        f.guest_name AS name,
        m.email,
        a.amenity_type,
        a.total_spent,
        a.visit_count,
        f.check_in_date,
        f.check_out_date
    FROM amenity_spend a
    LEFT JOIN LATERAL (
        SELECT
            guest_name,
            check_in_date,
            check_out_date
        FROM folios
        WHERE member_number = a.member_number
        ORDER BY check_in_date DESC
        LIMIT 1
    ) f ON TRUE
    LEFT JOIN members m
        ON m.member_number = a.member_number;
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            #get season for check-in date (if available)
            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_amenities
                (member_number, name, email, amenity_type,
                 total_spend, visit_count,
                 check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["name"],
                r["email"],
                r["amenity_type"],
                r["total_spent"],
                r["visit_count"],
                r["check_in_date"],
                r["check_out_date"],
                season
            ))

# ─────────────────────────────────────────────
# MASTER PIPELINE
# ─────────────────────────────────────────────
def refresh_all_segments():
    conn = get_conn()

    try:
        log.info("Refreshing segment tables...")

        truncate_tables(conn)
        
        seasons = load_active_seasons(conn)

        build_spenders(conn, seasons)
        build_visitors(conn, seasons)
        build_amenities(conn, seasons)

        conn.commit()

        log.info("Segment refresh complete.")

    except Exception as e:
        conn.rollback()
        log.error(f"Segment refresh failed: {e}")
        raise

    finally:
        conn.close()


# ─────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────
if __name__ == "__main__":
    refresh_all_segments()


