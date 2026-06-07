# season_tables.py

from __future__ import annotations

import logging
from collections import Counter
from datetime import date

from psycopg2.extras import execute_values

log = logging.getLogger(__name__)

DEFAULT_SEASONS = [
    ("High Season 1", 1, 3, 3, 6),
    ("Spring Break", 3, 7, 3, 27),
    ("High Season 2", 3, 28, 4, 24),
    ("Shoulder Season 1", 4, 25, 7, 24),
    ("Summer Season", 7, 25, 10, 30),
    ("Shoulder Season 2", 10, 31, 11, 20),
    ("Thanksgiving", 11, 21, 11, 28),
    ("Shoulder Season 3", 11, 29, 12, 11),
    ("High Season 3", 12, 12, 12, 18),
    ("Festive", 12, 19, 1, 3),
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
    visit_count INTEGER NOT NULL DEFAULT 0,
    total_nights INTEGER NOT NULL DEFAULT 0,
    first_check_in DATE,
    last_check_out DATE,
    villa_name VARCHAR(255),
    bedroom_count INTEGER,
    UNIQUE (member_number, season_id)
);
"""

DROP_SPECIFIC_ANALYTICS = """
DROP TABLE IF EXISTS member_seasons, seasons, season_groups CASCADE;
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

    agg = {}
    matched_by_season = Counter()

    for member_number, _conf_code, season_date, check_out, villa_name, bedroom_count in rows:
        season_id, season_name = season_for_date(season_date, active_seasons)

        if not season_id:
            continue

        matched_by_season[season_name] += 1

        nights = 0
        if check_out:
            nights = max((check_out - season_date).days, 0)

        key = (str(member_number), season_id)

        if key not in agg:
            agg[key] = {
                "season_name": season_name,
                "visit_count": 0,
                "total_nights": 0,
                "first_check_in": None,
                "last_check_out": None,
                "villa_counts": Counter(),
                "bedroom_counts": Counter(),
            }

        agg[key]["visit_count"] += 1
        agg[key]["total_nights"] += nights

        if agg[key]["first_check_in"] is None or season_date < agg[key]["first_check_in"]:
            agg[key]["first_check_in"] = season_date

        if check_out and (
            agg[key]["last_check_out"] is None or check_out > agg[key]["last_check_out"]
        ):
            agg[key]["last_check_out"] = check_out

        if villa_name:
            agg[key]["villa_counts"][villa_name] += 1

        if bedroom_count is not None:
            agg[key]["bedroom_counts"][bedroom_count] += 1

    output_rows = [
        (
            member_number,
            season_id,
            values["season_name"],
            values["visit_count"],
            values["total_nights"],
            values["first_check_in"],
            values["last_check_out"],
            values["villa_counts"].most_common(1)[0][0] if values["villa_counts"] else None,
            values["bedroom_counts"].most_common(1)[0][0] if values["bedroom_counts"] else None,
        )
        for (member_number, season_id), values in agg.items()
    ]

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
                    (member_number, season_id, season_name, visit_count, total_nights,
                     first_check_in, last_check_out, villa_name, bedroom_count)
                VALUES %s
                ON CONFLICT (member_number, season_id) DO UPDATE SET
                    season_name = EXCLUDED.season_name,
                    visit_count = EXCLUDED.visit_count,
                    total_nights = EXCLUDED.total_nights,
                    first_check_in = EXCLUDED.first_check_in,
                    last_check_out = EXCLUDED.last_check_out,
                    villa_name = EXCLUDED.villa_name,
                    bedroom_count = EXCLUDED.bedroom_count
                """,
                output_rows,
                page_size=1000,
            )

    conn.commit()

    log.info("member_seasons: %d rows written", len(output_rows))
    log.info("Matched by season: %s", dict(matched_by_season))

    return len(output_rows)


def build_season_tables(
    conn,
    *,
    dry_run: bool = False,
    recreate: bool = False,
) -> None:
    create_specific_tables(conn, recreate=recreate)
    seed_seasons(conn, dry_run=dry_run)
    build_member_seasons(conn, dry_run=dry_run)