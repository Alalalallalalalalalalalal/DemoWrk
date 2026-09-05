"""
run_historical_dues_synopsis.py — Executes HISTORICAL_DUES_SYNOPSIS_setup.sql
against PostgreSQL. This is the automated counterpart to pasting the SETUP
section of HISTORICAL_DUES_SYNOPSIS.sql into the Supabase SQL editor by hand.

Builds villa_owner_map / villa_dues_lines (plain views) and their
materialized, indexed copies villa_owner_map_mv / villa_dues_lines_mv, which
backend/postgres/analytics_villa_fees.py (the Annual Fees tab) reads. Also
defines and calls refresh_dues_views().

REQUIRES: members, rate_details, folios, statement_details, rooms, and
room_lookup tables already populated. room_lookup is created and loaded by
overview_sql.py (backend/playwright/overview_sql.py), which must run first.

Re-runnable: safe to execute again any time.

The full reference file, HISTORICAL_DUES_SYNOPSIS.sql (same directory),
additionally contains ~25 numbered diagnostic/audit queries not included
here — those are meant to be run one at a time by hand while reviewing
results, not as part of an automated load.

Usage:
    python run_historical_dues_synopsis.py
"""
import os
import sys
import time

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host":     os.getenv("DB_HOST"),
    "port":     os.getenv("DB_PORT"),
    "database": os.getenv("DB_NAME"),
    "user":     os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "keepalives":          1,
    "keepalives_idle":     30,
    "keepalives_interval": 10,
    "keepalives_count":    5,
    "connect_timeout":     30,
    "options":             "-c statement_timeout=0",
}

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SETUP_SQL_PATH = os.path.join(_SCRIPT_DIR, "HISTORICAL_DUES_SYNOPSIS_setup.sql")


def main():
    print("=" * 60)
    print("Historical Dues Synopsis — Setup Runner")
    print("=" * 60)
    print(f"Database: {DB_CONFIG['database']} @ {DB_CONFIG['host']}")

    if not os.path.exists(SETUP_SQL_PATH):
        print(f"ERROR: {SETUP_SQL_PATH} not found.")
        sys.exit(1)

    with open(SETUP_SQL_PATH, "r", encoding="utf-8") as f:
        setup_sql = f.read()

    conn = psycopg2.connect(**DB_CONFIG)
    try:
        start = time.time()
        with conn.cursor() as cur:
            # Same reasoning as overview_sql.py's run_sql(): the Supabase
            # pooler ignores/strips the startup "-c statement_timeout=0"
            # option, so SET LOCAL re-disables it inside this transaction,
            # where it actually takes effect through the pooler.
            cur.execute("SET LOCAL statement_timeout = 0;")
            cur.execute(setup_sql)
        conn.commit()
        print(f"Setup complete in {time.time() - start:.1f}s")
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
