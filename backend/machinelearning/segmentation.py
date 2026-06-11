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
# ─────────────────────────────────────────────
# spend THRESHOLDS — loaded from DB, set by frontend
# ─────────────────────────────────────────────
def load_thresholds(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT key, value FROM segment_config WHERE key IN ('high_spend_threshold', 'low_spend_threshold')")
        rows = dict(cur.fetchall())
    return float(rows.get("high_spend_threshold", 10000)), float(rows.get("low_spend_threshold", 1000))

FREQUENT_MIN = 4
LAPSED_DAYS = 18 * 30  # ~18 months


# ─────────────────────────────────────────────
# CONNECTION
# ─────────────────────────────────────────────
def get_conn():
    return psycopg.connect(**DB_CONFIG)


# ─────────────────────────────────────────────
# DDL — drop and recreate so schema changes always apply cleanly
# ─────────────────────────────────────────────
DDL = """
DROP TABLE IF EXISTS segment_spenders;
CREATE TABLE segment_spenders (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR,
    title               VARCHAR,
    name                VARCHAR,
    email               VARCHAR,
    date_of_birth       DATE,
    phone_number        VARCHAR,
    address_line1       VARCHAR,
    address_line2       VARCHAR,
    city                VARCHAR,
    state               VARCHAR,
    postal_code         VARCHAR,
    country             VARCHAR,
    tier                VARCHAR,
    net_spend           NUMERIC,
    spend_categories    TEXT[],
    check_in_date       DATE,
    check_out_date      DATE,
    season              VARCHAR,
    created_at          TIMESTAMP DEFAULT NOW()
);

DROP TABLE IF EXISTS segment_visitors;
CREATE TABLE segment_visitors (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR,
    title               VARCHAR,
    name                VARCHAR,
    email               VARCHAR,
    date_of_birth       DATE,
    phone_number        VARCHAR,
    address_line1       VARCHAR,
    address_line2       VARCHAR,
    city                VARCHAR,
    state               VARCHAR,
    postal_code         VARCHAR,
    country             VARCHAR,
    visitor_type        VARCHAR,
    total_reservations  INTEGER,
    last_visit          DATE,
    check_in_date       DATE,
    check_out_date      DATE,
    season              VARCHAR,
    created_at          TIMESTAMP DEFAULT NOW()
);

DROP TABLE IF EXISTS segment_amenities;
CREATE TABLE segment_amenities (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR,
    title               VARCHAR,
    name                VARCHAR,
    email               VARCHAR,
    date_of_birth       DATE,
    phone_number        VARCHAR,
    address_line1       VARCHAR,
    address_line2       VARCHAR,
    city                VARCHAR,
    state               VARCHAR,
    postal_code         VARCHAR,
    country             VARCHAR,
    top_amenity         VARCHAR,
    top_amenity_spend   NUMERIC,
    total_amenity_spend NUMERIC,
    check_in_date       DATE,
    check_out_date      DATE,
    season              VARCHAR,
    created_at          TIMESTAMP DEFAULT NOW()
)


CREATE TABLE IF NOT EXISTS segment_config (
    key   VARCHAR PRIMARY KEY,
    value NUMERIC NOT NULL
);

-- Seed defaults if not already set
INSERT INTO segment_config (key, value)
VALUES ('high_spend_threshold', 10000),
       ('low_spend_threshold',  1000)
ON CONFLICT (key) DO NOTHING;
"""

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
def  build_spenders(conn, seasons, high_spend, low_spend):
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
            m.prefix           AS title,
            s.guest_name       AS name,
            m.email,
            m.date_of_birth,
            p.phone_number,
            a.address_line1,
            a.address_line2,
            a.city,
            a.state,
            a.postal_code,
            a.country,
            s.net_spend,
            s.spend_items,
            ls.check_in_date,
            ls.check_out_date
        FROM spend s
        LEFT JOIN latest_stay ls
            ON ls.member_number = s.member_number
        LEFT JOIN members m
            ON m.member_number = s.member_number
        LEFT JOIN member_addresses a
            ON a.member_number = s.member_number
        LEFT JOIN LATERAL (
            SELECT phone_number
            FROM member_phones mp
            WHERE mp.member_number = s.member_number
            ORDER BY id
            LIMIT 1
        ) p ON TRUE
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            spend = r["net_spend"] or 0

            if spend > high_spend:
                tier = "High Spender"
            elif spend >= low_spend:
                tier = "Medium Spender"
            else:
                tier = "Low Spender"

            categories = categorize_spend(r.get("spend_items"))

            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_spenders
                    (member_number, title, name, email, date_of_birth, phone_number,
                     address_line1, address_line2, city, state, postal_code, country,
                     tier, net_spend, spend_categories,
                     check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["title"],
                r["name"],
                r["email"],
                r["date_of_birth"],
                r["phone_number"],
                r["address_line1"],
                r["address_line2"],
                r["city"],
                r["state"],
                r["postal_code"],
                r["country"],
                tier,           # VARCHAR  — "High / Medium / Low Spender"
                spend,          # NUMERIC  — actual spend value
                categories,     # TEXT[]   — spend category labels
                r["check_in_date"],
                r["check_out_date"],
                season,
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
                MAX(check_out_date)       AS last_visit
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
            m.prefix           AS title,
            v.guest_name       AS name,
            m.email,
            m.date_of_birth,
            p.phone_number,
            a.address_line1,
            a.address_line2,
            a.city,
            a.state,
            a.postal_code,
            a.country,
            v.total_reservations,
            v.last_visit,
            ls.check_in_date,
            ls.check_out_date
        FROM visits v
        LEFT JOIN latest_stay ls
            ON ls.member_number = v.member_number
        LEFT JOIN members m
            ON m.member_number = v.member_number
        LEFT JOIN member_addresses a
            ON a.member_number = v.member_number
        LEFT JOIN LATERAL (
            SELECT phone_number
            FROM member_phones mp
            WHERE mp.member_number = v.member_number
            ORDER BY id
            LIMIT 1
        ) p ON TRUE
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            res  = r["total_reservations"] or 0
            last = r["last_visit"]

            if res >= FREQUENT_MIN:
                vtype = "Frequent"
            elif last is None:
                vtype = "Never Visited"
            elif last < cutoff:
                vtype = "Lapsed"
            else:
                vtype = "Regular"

            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_visitors
                    (member_number, title, name, email, date_of_birth, phone_number,
                     address_line1, address_line2, city, state, postal_code, country,
                     visitor_type, total_reservations, last_visit,
                     check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["title"],
                r["name"],
                r["email"],
                r["date_of_birth"],
                r["phone_number"],
                r["address_line1"],
                r["address_line2"],
                r["city"],
                r["state"],
                r["postal_code"],
                r["country"],
                vtype,
                res,
                r["last_visit"],
                r["check_in_date"],
                r["check_out_date"],
                season,
            ))


# ─────────────────────────────────────────────
# 3. AMENITIES
# ─────────────────────────────────────────────
def build_amenities(conn, seasons):
    sql = """
        SELECT
            a.member_id          AS member_number,
            m.prefix             AS title,
            a.member_full_name   AS name,
            m.email,
            m.date_of_birth,
            p.phone_number,
            addr.address_line1,
            addr.address_line2,
            addr.city,
            addr.state,
            addr.postal_code,
            addr.country,
            a.top_amenity,
            a.top_amenity_spend,
            a.total_amenity_spend,
            f.check_in_date,
            f.check_out_date
        FROM member_amenity_profile a
        LEFT JOIN members m
            ON m.member_number = a.member_id
        LEFT JOIN member_addresses addr
            ON addr.member_number = a.member_id
        LEFT JOIN LATERAL (
            SELECT phone_number
            FROM member_phones mp
            WHERE mp.member_number = a.member_id
            ORDER BY id
            LIMIT 1
        ) p ON TRUE
        LEFT JOIN LATERAL (
            SELECT check_in_date, check_out_date
            FROM folios
            WHERE member_number = a.member_id
            ORDER BY check_in_date DESC
            LIMIT 1
        ) f ON TRUE
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows]

        for r in rows:
            season = None
            if r["check_in_date"]:
                _, season = season_for_date(r["check_in_date"], seasons)

            cur.execute("""
                INSERT INTO segment_amenities
                    (member_number, title, name, email, date_of_birth, phone_number,
                     address_line1, address_line2, city, state, postal_code, country,
                     top_amenity, top_amenity_spend, total_amenity_spend,
                     check_in_date, check_out_date, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                r["member_number"],
                r["title"],
                r["name"],
                r["email"],
                r["date_of_birth"],
                r["phone_number"],
                r["address_line1"],
                r["address_line2"],
                r["city"],
                r["state"],
                r["postal_code"],
                r["country"],
                r["top_amenity"],
                r["top_amenity_spend"],
                r["total_amenity_spend"],
                r["check_in_date"],
                r["check_out_date"],
                season,
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
        high_spend, low_spend = load_thresholds(conn)   # ← add this
        build_spenders(conn, seasons, high_spend, low_spend)  # ← pass them in
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