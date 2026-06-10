# season_tables.py

from __future__ import annotations
import argparse
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
import logging
from collections import Counter
from datetime import date

from psycopg2.extras import execute_values

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

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


def _raw_connection():
    return get_engine().raw_connection()

DEFAULT_SEASONS = [
    ("High Season 1", 1, 3, 2, 12),
    ("Presidents Week", 2, 13, 2, 19),
    ("High Season 2", 2, 20, 3, 5),
    ("Spring Break", 3, 6, 4, 2),
    ("High Season 3", 4, 3, 4, 23),
    ("Shoulder Season 1", 4, 24, 7, 23),
    ("Summer Season", 7, 24, 10, 29),
    ("Shoulder Season 2", 10, 30, 11, 19),
    ("Thanksgiving", 11, 20, 11, 26),
    ("Shoulder Season 3", 11, 27, 12, 10),
    ("High Season 4", 12, 11, 12, 18),
    ("Christmas", 12, 19, 12, 27),
    ("Festive", 12, 27, 1, 2),
]

SPECIFIC_DDL = """
CREATE TABLE IF NOT EXISTS season_groups (
    id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL UNIQUE,
    group_type VARCHAR(20) NOT NULL DEFAULT 'custom'
        CHECK (group_type IN ('business', 'custom')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES season_groups(id) ON DELETE SET NULL,
    season_name VARCHAR(100) NOT NULL,
    start_month INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    start_day INTEGER NOT NULL CHECK (start_day BETWEEN 1 AND 31),
    end_month INTEGER NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    end_day INTEGER NOT NULL CHECK (end_day BETWEEN 1 AND 31),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (group_id, season_name, start_month, start_day, end_month, end_day)
);

CREATE TABLE IF NOT EXISTS member_seasons (
    id SERIAL PRIMARY KEY,
    member_number VARCHAR(50),
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    season_name VARCHAR(100) NOT NULL,

    guest_name VARCHAR(255),
    conf_code VARCHAR(100),
    room_number VARCHAR(50),
    villa_name VARCHAR(255),
    bedroom_count INTEGER,
    reservation_status VARCHAR(100),

    visit_count INTEGER NOT NULL DEFAULT 0,
    total_nights INTEGER NOT NULL DEFAULT 0,
    first_check_in DATE,
    last_check_out DATE,

    UNIQUE (member_number, season_id, conf_code)
);

CREATE TABLE IF NOT EXISTS seasonal_visits (
    month VARCHAR(7) PRIMARY KEY,
    visits INTEGER NOT NULL DEFAULT 0,
    avg_stay NUMERIC(10, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS season_visitors (
    member_number VARCHAR(50),
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    season_name VARCHAR(100),
    visit_count INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (member_number, season_id)
);
"""

DROP_SPECIFIC_ANALYTICS = """
DROP TABLE IF EXISTS
    season_visitors,
    member_seasons,
    seasons,
    season_groups,
    seasonal_visits
CASCADE;
"""


def create_specific_tables(conn, recreate: bool = False) -> None:
    with conn.cursor() as cur:
        if recreate:
            log.info("Dropping seasonal analytics tables...")
            cur.execute(DROP_SPECIFIC_ANALYTICS)

        log.info("Creating seasonal analytics tables if needed...")
        cur.execute(SPECIFIC_DDL)

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


        # Keep existing databases in sync with the folio-backed member_seasons shape.
        cur.execute("""
            ALTER TABLE member_seasons
            ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS conf_code VARCHAR(100),
            ADD COLUMN IF NOT EXISTS room_number VARCHAR(50),
            ADD COLUMN IF NOT EXISTS reservation_status VARCHAR(100)
        """)

        # Remove the older two-column unique constraint if it exists; it prevents
        # multiple folio reservations for the same member in the same season.
        cur.execute("""
            ALTER TABLE member_seasons
            DROP CONSTRAINT IF EXISTS member_seasons_member_number_season_id_key
        """)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS member_seasons_member_season_conf_idx
            ON member_seasons (member_number, season_id, conf_code)
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
        return int(cur.fetchone()[0])


def _seed_group_seasons(conn, group_id: int, seasons: list[tuple], dry_run: bool = False) -> int:
    rows = [(group_id, name, sm, sd, em, ed, True) for name, sm, sd, em, ed in seasons]

    if dry_run:
        return len(rows)

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO seasons
                (group_id, season_name, start_month, start_day, end_month, end_day, is_active)
            VALUES %s
            ON CONFLICT (group_id, season_name, start_month, start_day, end_month, end_day)
            DO NOTHING
            """,
            rows,
        )

    return len(rows)


def seed_seasons(conn, dry_run: bool = False) -> None:
    if dry_run:
        log.info("[DRY RUN] Would seed %d business seasons", len(DEFAULT_SEASONS))
        return

    business_group_id = _get_or_create_season_group(
        conn,
        "Business Seasons",
        "business",
    )

    with conn.cursor() as cur:
        cur.execute("""
            DELETE FROM seasons
            WHERE group_id IN (
                SELECT id FROM season_groups
                WHERE group_name = 'Simple Seasons'
            )
        """)

        cur.execute("""
            DELETE FROM season_groups
            WHERE group_name = 'Simple Seasons'
        """)

        cur.execute(
            """
            UPDATE seasons
            SET group_id = %s
            WHERE group_id IS NULL
            """,
            (business_group_id,),
        )

    count = _seed_group_seasons(conn, business_group_id, DEFAULT_SEASONS)
    conn.commit()

    log.info("Seeded Business Seasons=%d rows", count)


def load_active_seasons(conn, group_type: str = "business") -> list[tuple]:
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


def build_member_seasons(conn, dry_run: bool = False) -> int:
    log.info("Building member_seasons from folios...")

    active_seasons = load_active_seasons(conn)

    if not active_seasons:
        log.warning("No active seasons found; member_seasons skipped")
        return 0

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (
                member_number,
                COALESCE(conf_code, reservation_folio_id, folio_num, folio_key)
            )
                member_number,
                COALESCE(conf_code, reservation_folio_id, folio_num, folio_key) AS conf_code,
                guest_name,
                COALESCE(check_in_date, transaction_date) AS season_date,
                check_in_date,
                check_out_date,
                room_number,
                villa_name,
                bedroom_count,
                reservation_status
            FROM folios
            WHERE member_number IS NOT NULL
              AND COALESCE(check_in_date, transaction_date) IS NOT NULL
            ORDER BY
                member_number,
                COALESCE(conf_code, reservation_folio_id, folio_num, folio_key),
                check_in_date NULLS LAST,
                transaction_date NULLS LAST
        """)
        rows = cur.fetchall()

    output_rows = []
    matched_by_season = Counter()

    for (
        member_number,
        conf_code,
        guest_name,
        season_date,
        check_in,
        check_out,
        room_number,
        villa_name,
        bedroom_count,
        reservation_status,
    ) in rows:
        season_id, season_name = season_for_date(season_date, active_seasons)

        if not season_id:
            continue

        matched_by_season[season_name] += 1

        first_check_in = check_in or season_date
        last_check_out = check_out

        nights = 0
        if first_check_in and last_check_out:
            nights = max((last_check_out - first_check_in).days, 0)

        output_rows.append(
            (
                str(member_number),
                season_id,
                season_name,
                guest_name,
                conf_code,
                room_number,
                villa_name,
                bedroom_count,
                reservation_status,
                1,
                nights,
                first_check_in,
                last_check_out,
            )
        )

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
                    (member_number, season_id, season_name, guest_name, conf_code,
                     room_number, villa_name, bedroom_count, reservation_status,
                     visit_count, total_nights, first_check_in, last_check_out)
                VALUES %s
                ON CONFLICT (member_number, season_id, conf_code) DO UPDATE SET
                    season_name = EXCLUDED.season_name,
                    guest_name = EXCLUDED.guest_name,
                    room_number = EXCLUDED.room_number,
                    villa_name = EXCLUDED.villa_name,
                    bedroom_count = EXCLUDED.bedroom_count,
                    reservation_status = EXCLUDED.reservation_status,
                    visit_count = EXCLUDED.visit_count,
                    total_nights = EXCLUDED.total_nights,
                    first_check_in = EXCLUDED.first_check_in,
                    last_check_out = EXCLUDED.last_check_out
                """,
                output_rows,
                page_size=1000,
            )

    conn.commit()

    log.info("member_seasons: %d rows written", len(output_rows))
    log.info("Matched by season: %s", dict(matched_by_season))

    return len(output_rows)


def build_seasonal_visits(conn, dry_run: bool = False) -> int:
    log.info("Building seasonal_visits from rooms...")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT member_number, check_in_date, check_out_date
            FROM rooms
            WHERE check_in_date IS NOT NULL
        """)
        rows = cur.fetchall()

    monthly = {}

    for member_number, check_in, check_out in rows:
        month = check_in.strftime("%Y-%m")

        if month not in monthly:
            monthly[month] = {
                "visits": 0,
                "total_stay": 0,
                "stay_count": 0,
            }

        monthly[month]["visits"] += 1

        if check_out:
            nights = max((check_out - check_in).days, 0)
            monthly[month]["total_stay"] += nights
            monthly[month]["stay_count"] += 1

    output_rows = [
        (
            month,
            values["visits"],
            round(values["total_stay"] / values["stay_count"], 2)
            if values["stay_count"]
            else 0,
        )
        for month, values in sorted(monthly.items())
    ]

    if dry_run:
        log.info("[DRY RUN] Would replace seasonal_visits with %d rows", len(output_rows))
        return len(output_rows)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM seasonal_visits")

        if output_rows:
            execute_values(
                cur,
                """
                INSERT INTO seasonal_visits (month, visits, avg_stay)
                VALUES %s
                ON CONFLICT (month) DO UPDATE SET
                    visits = EXCLUDED.visits,
                    avg_stay = EXCLUDED.avg_stay
                """,
                output_rows,
                page_size=1000,
            )

    conn.commit()
    log.info("seasonal_visits: %d rows written", len(output_rows))
    return len(output_rows)

def build_season_visitors(conn, dry_run: bool = False) -> int:
    log.info("Building season_visitors...")

    active_seasons = load_active_seasons(conn)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                member_number,
                check_in_date
            FROM rooms
            WHERE member_number IS NOT NULL
              AND check_in_date IS NOT NULL
        """)
        rows = cur.fetchall()

    visitor_counts = {}

    for member_number, check_in_date in rows:
        season_id, season_name = season_for_date(
            check_in_date,
            active_seasons,
        )

        if not season_id:
            continue

        key = (str(member_number), season_id)

        if key not in visitor_counts:
            visitor_counts[key] = {
                "season_name": season_name,
                "visits": 0,
            }

        visitor_counts[key]["visits"] += 1

    output_rows = [
        (
            member_number,
            season_id,
            values["season_name"],
            values["visits"],
        )
        for (member_number, season_id), values in visitor_counts.items()
        if values["visits"] >= 2
    ]

    if dry_run:
        log.info(
            "[DRY RUN] Would replace season_visitors with %d rows",
            len(output_rows),
        )
        return len(output_rows)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM season_visitors")

        if output_rows:
            execute_values(
                cur,
                """
                INSERT INTO season_visitors
                    (member_number, season_id, season_name, visit_count)
                VALUES %s
                ON CONFLICT (member_number, season_id)
                DO UPDATE SET
                    visit_count = EXCLUDED.visit_count,
                    season_name = EXCLUDED.season_name
                """,
                output_rows,
            )

    conn.commit()

    log.info(
        "season_visitors: %d rows written",
        len(output_rows),
    )

    return len(output_rows)

def build_season_tables(
    *,
    dry_run: bool = False,
    recreate: bool = False,
) -> None:
    log.info("=== Seasonal analytics pipeline starting ===")

    conn = _raw_connection()

    try:
        create_specific_tables(conn, recreate=recreate)
        seed_seasons(conn, dry_run=dry_run)

        build_member_seasons(conn, dry_run=dry_run)
        build_seasonal_visits(conn, dry_run=dry_run)
        build_season_visitors(conn, dry_run=dry_run)

    finally:
        conn.close()

    log.info("=== Seasonal analytics pipeline complete ===")

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build seasonal analytics tables."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read data but do not write tables",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop/recreate seasonal tables before build",
    )

    args = parser.parse_args()

    build_season_tables(
        dry_run=args.dry_run,
        recreate=args.recreate,
    )


if __name__ == "__main__":
    main()