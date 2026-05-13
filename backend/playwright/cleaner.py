"""
cleaner.py — Transform and load member journal CSVs into PostgreSQL.

Reads from the journal/ folder structure and loads into a normalized
PostgreSQL schema. Creates all tables automatically on first run.

Tables created:
    members             — from _profile.csv
    member_addresses    — from _profile.csv (address columns)
    member_phones       — from _profile.csv (phone columns)
    dependents          — from _dependents.csv
    dependent_addresses — from _dependents.csv (dependent address columns)
    dependent_phones    — from _dependents.csv (dependent phone columns)
    rooms               — from _rooms.csv
    recent_activity     — from _recent_activity.csv
    statements          — from _statements.csv
    services            — from _services.csv
    interests           — from _interests.csv

Usage:
    python cleaner.py                    # Load all members in journal/
    python cleaner.py --member 1C        # Load single member
    python cleaner.py --dry-run          # Test without writing to DB
    python cleaner.py --recreate-tables  # Drop and recreate all tables

Requirements:
    pip install psycopg2-binary pandas python-dotenv
"""
import os
import csv
import re
import glob
import argparse
import logging
from datetime import datetime, date

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
JOURNAL_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "journal")

DB_CONFIG = {
    "host":     os.getenv("DB_HOST"),
    "port":     os.getenv("DB_PORT"),
    "database": os.getenv("DB_NAME"),
    "user":     os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# Metadata columns added by scraper — excluded from DB inserts
SCRAPER_META_COLS = {"_folder", "_section", "_tab"}

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# DDL — TABLE DEFINITIONS
# ─────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS members (
    member_number       VARCHAR(50)  PRIMARY KEY,
    member_name         VARCHAR(255),
    member_full_name    VARCHAR(255),
    member_type         VARCHAR(100),
    member_or_guest     VARCHAR(50),
    gender              CHAR(1),
    employer            VARCHAR(255),
    status              VARCHAR(50),
    age                 INTEGER,
    membership_tenure   VARCHAR(50),
    occupation          VARCHAR(255),
    marital_status      VARCHAR(50),
    activation_date     DATE,
    since_date          DATE,
    date_of_birth       DATE,
    email               VARCHAR(255),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_addresses (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    postal_code         VARCHAR(20),
    country             VARCHAR(100),
    UNIQUE (member_number)
);

CREATE TABLE IF NOT EXISTS member_phones (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    phone_type          VARCHAR(20),  -- home, business, cell, fax
    phone_number        VARCHAR(50),
    UNIQUE (member_number, phone_type)
);

CREATE TABLE IF NOT EXISTS dependents (
    dependent_number    VARCHAR(50)  PRIMARY KEY,
    member_number       VARCHAR(50)  REFERENCES members(member_number) ON DELETE CASCADE,
    dependent_name      VARCHAR(255),
    gender              CHAR(1),
    marital_status      VARCHAR(50),
    age                 INTEGER,
    date_of_birth       DATE,
    activation_date     DATE,
    since_date          DATE,
    email               VARCHAR(255),
    status              VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS dependent_addresses (
    id                  SERIAL PRIMARY KEY,
    dependent_number    VARCHAR(50) REFERENCES dependents(dependent_number) ON DELETE CASCADE,
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    postal_code         VARCHAR(20),
    country             VARCHAR(100),
    UNIQUE (dependent_number)
);

CREATE TABLE IF NOT EXISTS dependent_phones (
    id                  SERIAL PRIMARY KEY,
    dependent_number    VARCHAR(50) REFERENCES dependents(dependent_number) ON DELETE CASCADE,
    phone_type          VARCHAR(20),
    phone_number        VARCHAR(50),
    UNIQUE (dependent_number, phone_type)
);

CREATE TABLE IF NOT EXISTS rooms (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    confirmation_code   VARCHAR(100),
    room_type           VARCHAR(100),
    room_number         VARCHAR(50),
    check_in_date       DATE,
    check_out_date      DATE,
    status              VARCHAR(50),
    UNIQUE (member_number, confirmation_code)
);

CREATE TABLE IF NOT EXISTS recent_activity (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    activity_date       DATE,
    transaction_id      VARCHAR(100),
    ref_number          VARCHAR(100),
    description         VARCHAR(500),
    amount              NUMERIC(12, 2),
    UNIQUE (member_number, transaction_id)
);

CREATE TABLE IF NOT EXISTS statements (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    statement_period    VARCHAR(100),
    due_date            DATE,
    amount_due          NUMERIC(12, 2),
    UNIQUE (member_number, statement_period)
);

CREATE TABLE IF NOT EXISTS services (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    service_name        VARCHAR(255),
    UNIQUE (member_number, service_name)
);

CREATE TABLE IF NOT EXISTS interests (
    id                  SERIAL PRIMARY KEY,
    member_number       VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    interest_name       VARCHAR(255),
    interest_value      VARCHAR(255),
    UNIQUE (member_number, interest_name)
);
"""

DROP_ALL = """
DROP TABLE IF EXISTS interests, services, statements, recent_activity,
    rooms, dependent_phones, dependent_addresses, dependents,
    member_phones, member_addresses, members CASCADE;
"""


# ─────────────────────────────────────────────
# CLEANING HELPERS
# ─────────────────────────────────────────────

def clean_phone(val):
    """Digits only, must be 10+. Returns None if empty or invalid."""
    if not val or str(val).strip() in ("", "nan"):
        return None
    digits = re.sub(r"\D", "", str(val))
    return digits if len(digits) >= 10 else None


def clean_date(val):
    """Parse MM/DD/YYYY → date object. Returns None if invalid or suspicious."""
    if not val or str(val).strip() in ("", "nan", "SUSPICIOUS_DATE"):
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            d = datetime.strptime(str(val).strip(), fmt).date()
            if d.year == 1901 or d.year > date.today().year + 1:
                return None
            return d
        except ValueError:
            continue
    return None


def clean_amount(val):
    """Parse currency strings like ($43,857.50) → -43857.50. Returns None if empty."""
    if not val or str(val).strip() in ("", "nan"):
        return None
    val = str(val).strip()
    negative = val.startswith("(") and val.endswith(")")
    val = re.sub(r"[()$,\s]", "", val)
    try:
        amount = float(val)
        return -amount if negative else amount
    except ValueError:
        return None


def clean_str(val, max_len=None):
    """Strip whitespace. Returns None if empty."""
    if val is None or str(val).strip() in ("", "nan"):
        return None
    s = str(val).strip()
    if max_len:
        s = s[:max_len]
    return s


def clean_gender(val):
    """Standardize gender to M or F. Returns None if unknown."""
    if not val or str(val).strip() in ("", "nan"):
        return None
    v = str(val).strip().upper()
    if v in ("M", "MALE", "0"):
        return "M"
    if v in ("F", "FEMALE", "1"):
        return "F"
    return None


def clean_int(val):
    """Parse integer. Returns None if empty or non-numeric."""
    if not val or str(val).strip() in ("", "nan"):
        return None
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────

def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def create_tables(conn, recreate=False):
    with conn.cursor() as cur:
        if recreate:
            log.info("Dropping all tables...")
            cur.execute(DROP_ALL)
        log.info("Creating tables if not exist...")
        cur.execute(DDL)
    conn.commit()
    log.info("Tables ready.")


def upsert(conn, table, rows, conflict_col, dry_run=False):
    """
    Insert rows into table. On conflict on conflict_col, do nothing.
    rows: list of dicts with identical keys.
    """
    if not rows:
        return 0

    cols = list(rows[0].keys())
    values = [[r.get(c) for c in cols] for r in rows]
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT ({conflict_col}) DO NOTHING"
    )

    if dry_run:
        log.info(f"  [DRY RUN] Would insert {len(rows)} rows into {table}")
        return len(rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values)
    conn.commit()
    return len(rows)


def upsert_multi(conn, table, rows, conflict_cols, dry_run=False):
    """Upsert with composite conflict key."""
    if not rows:
        return 0

    cols = list(rows[0].keys())
    values = [[r.get(c) for c in cols] for r in rows]
    conflict = ", ".join(conflict_cols)
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT ({conflict}) DO NOTHING"
    )

    if dry_run:
        log.info(f"  [DRY RUN] Would insert {len(rows)} rows into {table}")
        return len(rows)

    with conn.cursor() as cur:
        execute_values(cur, sql, values)
    conn.commit()
    return len(rows)


# ─────────────────────────────────────────────
# LOADERS
# ─────────────────────────────────────────────

def load_profile(conn, member_number, filepath, dry_run=False):
    """Load _profile.csv into members, member_addresses, member_phones."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    for _, row in df.iterrows():
        mn = clean_str(row.get("Member Number")) or member_number

        # ── members ──────────────────────────────────────
        member = {
            "member_number":    mn,
            "member_name":      clean_str(row.get("Member Name"), 255),
            "member_full_name": clean_str(row.get("Member Full Name"), 255),
            "member_type":      clean_str(row.get("Member Type"), 100),
            "member_or_guest":  clean_str(row.get("Member / Guest"), 50),
            "gender":           clean_gender(row.get("Gender")),
            "employer":         clean_str(row.get("Employer"), 255),
            "status":           clean_str(row.get("Status"), 50),
            "age":              clean_int(row.get("Age")),
            "membership_tenure":clean_str(row.get("Membership Tenure"), 50),
            "occupation":       clean_str(row.get("Occupation"), 255),
            "marital_status":   clean_str(row.get("Marital Status"), 50),
            "activation_date":  clean_date(row.get("Member Activation")),
            "since_date":       clean_date(row.get("Member Since")),
            "date_of_birth":    clean_date(row.get("Date of Birth")),
            "email":            clean_str(row.get("Email"), 255),
        }
        upsert(conn, "members", [member], "member_number", dry_run)

        # ── member_addresses ─────────────────────────────
        addr = {
            "member_number": mn,
            "address_line1": clean_str(row.get("Address Line1"), 255),
            "address_line2": clean_str(row.get("Address Line2"), 255),
            "city":          clean_str(row.get("City"), 100),
            "state":         clean_str(row.get("State"), 100),
            "postal_code":   clean_str(row.get("Postal Code"), 20),
            "country":       clean_str(row.get("Country"), 100),
        }
        if any(v for k, v in addr.items() if k != "member_number"):
            upsert(conn, "member_addresses", [addr], "member_number", dry_run)

        # ── member_phones ────────────────────────────────
        phone_map = {
            "home":     row.get("Home Phone"),
            "business": row.get("Business Phone"),
            "cell":     row.get("Cell Phone"),
            "fax":      row.get("Fax Phone"),
        }
        phone_rows = []
        for ptype, pval in phone_map.items():
            num = clean_phone(pval)
            if num:
                phone_rows.append({
                    "member_number": mn,
                    "phone_type":    ptype,
                    "phone_number":  num,
                })
        if phone_rows:
            upsert_multi(conn, "member_phones", phone_rows,
                         ["member_number", "phone_type"], dry_run)


def load_dependents(conn, member_number, filepath, dry_run=False):
    """Load _dependents.csv into dependents, dependent_addresses, dependent_phones."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    for _, row in df.iterrows():
        dn = clean_str(row.get("Dependant Number"))
        if not dn:
            continue

        # ── dependents ───────────────────────────────────
        dep = {
            "dependent_number": dn,
            "member_number":    clean_str(row.get("Member Number")) or member_number,
            "dependent_name":   clean_str(row.get("Dependant Name"), 255),
            "gender":           clean_gender(row.get("Dependant Gender")),
            "marital_status":   clean_str(row.get("Dependant Marital Status"), 50),
            "age":              clean_int(row.get("Dependant Age")),
            "date_of_birth":    clean_date(row.get("Dependant Date of Birth")),
            "activation_date":  clean_date(row.get("Dependant Member Activation")),
            "since_date":       clean_date(row.get("Dependant Member Since")),
            "email":            clean_str(row.get("Dependant Email"), 255),
            "status":           clean_str(row.get("Dependant Status"), 50),
        }
        upsert(conn, "dependents", [dep], "dependent_number", dry_run)

        # ── dependent_addresses ──────────────────────────
        addr = {
            "dependent_number": dn,
            "address_line1":    clean_str(row.get("Dependant Address Line1"), 255),
            "address_line2":    clean_str(row.get("Dependant Address Line2"), 255),
            "city":             clean_str(row.get("Dependant City"), 100),
            "state":            clean_str(row.get("Dependant State"), 100),
            "postal_code":      clean_str(row.get("Dependant Postal Code"), 20),
            "country":          clean_str(row.get("Dependant Country"), 100),
        }
        if any(v for k, v in addr.items() if k != "dependent_number"):
            upsert(conn, "dependent_addresses", [addr], "dependent_number", dry_run)

        # ── dependent_phones ─────────────────────────────
        phone_map = {
            "home":     row.get("Dependant Home Phone"),
            "business": row.get("Dependant Business Phone"),
            "cell":     row.get("Dependant Cell Phone"),
            "fax":      row.get("Dependant Fax Phone"),
        }
        phone_rows = []
        for ptype, pval in phone_map.items():
            num = clean_phone(pval)
            if num:
                phone_rows.append({
                    "dependent_number": dn,
                    "phone_type":       ptype,
                    "phone_number":     num,
                })
        if phone_rows:
            upsert_multi(conn, "dependent_phones", phone_rows,
                         ["dependent_number", "phone_type"], dry_run)


def load_rooms(conn, member_number, filepath, dry_run=False):
    """Load _rooms.csv into rooms table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    rows = []
    for _, row in df.iterrows():
        conf = clean_str(row.get("Confirmation Code"), 100)
        if not conf:
            continue
        rows.append({
            "member_number":    member_number,
            "confirmation_code": conf,
            "room_type":        clean_str(row.get("Room Type"), 100),
            "room_number":      clean_str(row.get("Room #"), 50),
            "check_in_date":    clean_date(row.get("Check In Date")),
            "check_out_date":   clean_date(row.get("Check Out Date")),
            "status":           clean_str(row.get("status"), 50),
        })

    if rows:
        upsert_multi(conn, "rooms", rows,
                     ["member_number", "confirmation_code"], dry_run)
        log.info(f"  rooms: {len(rows)} rows")


def load_recent_activity(conn, member_number, filepath, dry_run=False):
    """Load _recent_activity.csv into recent_activity table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    # Drop unnamed index column if present
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        txn = clean_str(row.get("Transaction Id"), 100)
        if not txn:
            continue
        rows.append({
            "member_number":  member_number,
            "activity_date":  clean_date(row.get("Date")),
            "transaction_id": txn,
            "ref_number":     clean_str(row.get("Ref #"), 100),
            "description":    clean_str(row.get("Description"), 500),
            "amount":         clean_amount(row.get("Amount")),
        })

    if rows:
        upsert_multi(conn, "recent_activity", rows,
                     ["member_number", "transaction_id"], dry_run)
        log.info(f"  recent_activity: {len(rows)} rows")


def load_statements(conn, member_number, filepath, dry_run=False):
    """Load _statements.csv into statements table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        period = clean_str(row.get("Statement Periods"), 100)
        if not period:
            continue
        rows.append({
            "member_number":    member_number,
            "statement_period": period,
            "due_date":         clean_date(row.get("Due Date")),
            "amount_due":       clean_amount(row.get("Amount Due")),
        })

    if rows:
        upsert_multi(conn, "statements", rows,
                     ["member_number", "statement_period"], dry_run)
        log.info(f"  statements: {len(rows)} rows")


def load_services(conn, member_number, filepath, dry_run=False):
    """Load _services.csv into services table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    rows = []
    for _, row in df.iterrows():
        # Services CSV has col_0 as the service name
        svc = clean_str(row.get("col_0") or row.get("Service") or row.get("service_name"))
        if not svc or svc.lower() == "no matching records found":
            continue
        rows.append({
            "member_number": member_number,
            "service_name":  svc[:255],
        })

    if rows:
        upsert_multi(conn, "services", rows,
                     ["member_number", "service_name"], dry_run)
        log.info(f"  services: {len(rows)} rows")


def load_interests(conn, member_number, filepath, dry_run=False):
    """Load _interests.csv into interests table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    # Drop scraper meta columns
    df = df.drop(columns=[c for c in SCRAPER_META_COLS if c in df.columns],
                 errors="ignore")
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        for col, val in row.items():
            name = clean_str(col)
            value = clean_str(str(val)) if val is not None else None
            if name and value and value.lower() not in ("nan", "none"):
                rows.append({
                    "member_number":   member_number,
                    "interest_name":   name[:255],
                    "interest_value":  value[:255],
                })

    if rows:
        upsert_multi(conn, "interests", rows,
                     ["member_number", "interest_name"], dry_run)
        log.info(f"  interests: {len(rows)} rows")


# ─────────────────────────────────────────────
# PER-MEMBER LOADER
# ─────────────────────────────────────────────

# Maps CSV suffix to loader function
LOADERS = {
    "profile":         load_profile,
    "dependents":      load_dependents,
    "rooms":           load_rooms,
    "recent_activity": load_recent_activity,
    "statements":      load_statements,
    "services":        load_services,
    "interests":       load_interests,
}


def load_member(conn, member_folder_path, dry_run=False):
    """Load all CSVs in a member journal folder."""
    folder_name = os.path.basename(member_folder_path)
    # member_number is the folder name (strip _ID suffix for generic labels)
    member_number = folder_name

    log.info(f"Loading {folder_name}...")

    for suffix, loader_fn in LOADERS.items():
        filepath = os.path.join(member_folder_path, f"{folder_name}_{suffix}.csv")
        if os.path.exists(filepath):
            try:
                loader_fn(conn, member_number, filepath, dry_run)
            except Exception as e:
                log.error(f"  Error loading {suffix} for {folder_name}: {e}")
        else:
            log.debug(f"  No {suffix} file for {folder_name}")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Load member journal CSVs into PostgreSQL.")
    parser.add_argument("--member",          type=str,  default=None,
                        help="Load a single member folder (e.g. 1C)")
    parser.add_argument("--dry-run",         action="store_true",
                        help="Test run — no data written to DB")
    parser.add_argument("--recreate-tables", action="store_true",
                        help="Drop and recreate all tables before loading")
    args = parser.parse_args()

    print("=" * 60)
    print("Member ETL Loader")
    print("=" * 60)
    print(f"Database:  {DB_CONFIG['database']} @ {DB_CONFIG['host']}")
    print(f"Journal:   {JOURNAL_FOLDER}")
    print(f"Dry run:   {args.dry_run}")
    print()

    # Connect
    try:
        conn = get_connection()
        log.info("Connected to PostgreSQL.")
    except Exception as e:
        log.error(f"Could not connect to PostgreSQL: {e}")
        log.error("Check your .env file — DB_HOST, DB_NAME, DB_USER, DB_PASSWORD")
        return

    # Create / recreate tables
    create_tables(conn, recreate=args.recreate_tables)

    # Find member folders
    if args.member:
        folders = [os.path.join(JOURNAL_FOLDER, args.member)]
        if not os.path.isdir(folders[0]):
            log.error(f"Folder not found: {folders[0]}")
            conn.close()
            return
    else:
        folders = sorted([
            f.path for f in os.scandir(JOURNAL_FOLDER)
            if f.is_dir()
        ])

    print(f"Members to load: {len(folders)}\n")

    success, failed = [], []

    for folder in folders:
        try:
            load_member(conn, folder, dry_run=args.dry_run)
            success.append(os.path.basename(folder))
        except Exception as e:
            log.error(f"Failed {os.path.basename(folder)}: {e}")
            failed.append(os.path.basename(folder))

    conn.close()

    print()
    print("=" * 60)
    print("ETL Complete")
    print("=" * 60)
    print(f"  Loaded:  {len(success)}")
    print(f"  Failed:  {len(failed)}")
    if failed:
        print(f"  Failed members: {failed}")


if __name__ == "__main__":
    main()