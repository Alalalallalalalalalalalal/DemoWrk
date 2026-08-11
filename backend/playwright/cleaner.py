"""
cleaner.py — ETL loader: reads all scraped CSVs, cleans/normalizes them,
and upserts everything into PostgreSQL (Supabase).

Run AFTER the scrapers have produced their outputs:
  1. member_scraper.py        -> reports/member_demographics_*.csv, member_dependents_*.csv
  2. build_journal_profiles.py-> journal/{member}/{member}_profile.csv (+ _dependents.csv)
  3. journal_scraper.py       -> journal/{member}/ rooms, rate_details, services,
                                 statements, statement_details CSVs
  4. folio_report.py / folio_scraper.py -> reports/folio_report.csv + journal folio CSVs
  5. scrape_rate_revenue.py   -> reports/rate_details_free.csv, rate_details_paid.csv
  (+ reports/business_source.csv for the Source -> Payment Type mapping)

What the default run loads (python cleaner.py):
  Per member folder in journal/ (one transaction per member):
    _profile.csv            -> members, member_addresses, member_phones
    _dependents.csv         -> dependents, dependent_addresses, dependent_phones
    _rooms.csv              -> rooms
    _rate_details.csv       -> rate_details       (per-night Room Rates, 2025+)
    _recent_activity.csv    -> recent_activity
    _statements.csv         -> statements         (Homeowner receivable, 2025+)
    _statement_details.csv  -> statement_details  (itemized lines per period)
    _services.csv           -> services
    _interests.csv          -> interests
  Then the folio pipeline outputs:
    journal folio CSVs / reports/folio_report.csv -> folios (+ reservation_guests)
    reports/business_source.csv -> business_source, then stamps payment_type
                                   onto matching folios AND rate_details rows
    reports/rate_details_free|paid.csv -> rate_details (same table as journal
                                   rate details; data-derived keys dedupe them)
  Finishes with a data quality report.

Safety features:
  - Upserts everywhere -> safe to re-run; reloading is idempotent
  - Profile column-drift guard: if the demographics report loses columns
    (e.g. Employer), those DB fields are left untouched, not NULL-wiped
  - Dependent status derived: deactivation/death date overrides the
    report's incorrect "Active"

Usage:
    python cleaner.py                          # Everything (default)
    python cleaner.py --member 17A             # One member folder
    python cleaner.py --dry-run                # No writes, just logs
    python cleaner.py --recreate-tables        # Drop + recreate schema first
    python cleaner.py --sample-rate 0.10       # 10% deterministic sample (skips folios)
    python cleaner.py --folios-only            # Just folios/business_source/report rate details
    python cleaner.py --business-source-only   # Just the Source -> Payment Type mapping
    python cleaner.py --rate-details-only      # Just reports/ rate detail CSVs
    python cleaner.py --services-and-statements-only
    python cleaner.py --statement-details-only
"""
import os
import csv
import re
import glob
import time
import argparse
import logging
import hashlib
from datetime import datetime, date

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# cleaner.py is already inside backend/playwright
PLAYWRIGHT_FOLDER = BASE_DIR

JOURNAL_FOLDER = os.path.join(PLAYWRIGHT_FOLDER, "journal")
FOLIO_REPORT_FILE = os.path.join(PLAYWRIGHT_FOLDER, "reports", "folio_report.csv")
BUSINESS_SOURCE_FILE = os.path.join(PLAYWRIGHT_FOLDER, "reports", "business_source.csv")
FREE_RATE_DETAILS_FILE = os.path.join(PLAYWRIGHT_FOLDER, "reports", "rate_details_free.csv")
PAID_RATE_DETAILS_FILE = os.path.join(PLAYWRIGHT_FOLDER, "reports", "rate_details_paid.csv")
CLEANER_DONE_LOG       = os.path.join(PLAYWRIGHT_FOLDER, "cleaner_done.txt")

DB_CONFIG = {
    "host":     os.getenv("DB_HOST"),
    "port":     os.getenv("DB_PORT"),
    "database": os.getenv("DB_NAME"),
    "user":     os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    # ── Supabase session-pool keepalive settings ──────────────────
    # Session pooler (port 5432 on pooler.supabase.com) reuses a
    # single server connection per client session, so we keep it
    # alive and reconnect automatically if it drops.
    "keepalives":            1,
    "keepalives_idle":       30,
    "keepalives_interval":   10,
    "keepalives_count":      5,
    "connect_timeout":       30,
    "options":               "-c statement_timeout=0",   # no timeout on long bulk loads
}

# Metadata columns added by scraper — excluded from DB inserts
SCRAPER_META_COLS = {"_folder", "_section", "_tab"}

# Column-drift protection: the demographics report can lose columns
# without notice (Employer did). Missing optional columns are warned
# about and dropped from the upsert so existing DB values survive.
EXPECTED_PROFILE_COLS = {
    "Marital Status", "Member Number", "Member Name", "Member Full Name",
    "Member Type", "Member / Guest", "Gender", "Employer", "Status",
    "Age", "Membership Tenure", "Occupation", "Member Activation",
    "Member Since", "Date of Birth", "Email", "Home Phone",
    "Business Phone", "Cell Phone", "Fax Phone", "Address Line1",
    "Address Line2", "Postal Code", "City", "State", "Country",
}

# db_column -> source CSV column; only updated when present in the CSV.
OPTIONAL_PROFILE_COLS = {
    "employer":          "Employer",
    "age":               "Age",
    "membership_tenure": "Membership Tenure",
    "occupation":        "Occupation",
    "marital_status":    "Marital Status",
    "gender":            "Gender",
    "email":             "Email",
}

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
    prefix              VARCHAR(20),
    first_name          VARCHAR(100),
    middle_name         VARCHAR(100),
    last_name           VARCHAR(100),
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
    deactivation_date   DATE,
    since_date          DATE,
    date_of_birth       DATE,
    date_of_death       DATE,
    email               VARCHAR(255),
    billing_cycle       VARCHAR(50),
    bill_to_member      VARCHAR(50),
    fico_score          INTEGER,
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
    first_name          VARCHAR(100),
    middle_name         VARCHAR(100),
    last_name           VARCHAR(100),
    gender              CHAR(1),
    marital_status      VARCHAR(50),
    age                 INTEGER,
    date_of_birth       DATE,
    date_of_death       DATE,
    activation_date     DATE,
    deactivation_date   DATE,
    since_date          DATE,
    billing_cycle       VARCHAR(50),
    bill_to_member      VARCHAR(50),
    fico_score          INTEGER,
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

CREATE TABLE IF NOT EXISTS folios (
    folio_key              VARCHAR(64) PRIMARY KEY,

    -- Transaction columns from each folio CSV
    transaction_date       DATE,
    description            VARCHAR(500),
    amount                 NUMERIC(12, 2),

    -- Folio/reservation metadata added by Playwright scraper
    folio_num              VARCHAR(100),
    folio_name             VARCHAR(255),
    balance_due            NUMERIC(12, 2),
    reservation_folio_id   VARCHAR(100),

    -- Reservation/person context
    conf_code              VARCHAR(100),
    member_number          VARCHAR(50),
    guest_name             VARCHAR(255),
    check_in_date          DATE,
    check_out_date         DATE,
    room_number            VARCHAR(50),
    villa_name             VARCHAR(255),
    bedroom_count           INTEGER,
    persons                INTEGER,
    source                 VARCHAR(255),
    payment_type           VARCHAR(100),
    reservation_status     VARCHAR(100),

    
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS business_source (
    source_name           VARCHAR(255) PRIMARY KEY,
    payment_type          VARCHAR(100),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_details (
    rate_detail_key     VARCHAR(64) PRIMARY KEY,

    -- Reservation/person context (same shape as folios)
    conf_code            VARCHAR(100),
    reservation_id        VARCHAR(100),
    member_number         VARCHAR(50),
    guest_name            VARCHAR(255),
    room_number           VARCHAR(50),
    villa_name            VARCHAR(255),
    bedroom_count         INTEGER,
    source                VARCHAR(255),
    payment_type          VARCHAR(100),
    check_in_date         DATE,
    check_out_date        DATE,
    reservation_status    VARCHAR(100),

    -- Per-night rate breakdown, scraped from the reservationRateDetail popup.
    -- original_amount is NOT a reliable "rack rate" on its own — it's only
    -- populated when a manual override happened (see rate_details_with_discount
    -- view below for the derived rack_rate / discount_given logic).
    rate_date             DATE,
    rate_name             VARCHAR(255),
    original_amount       NUMERIC(12, 2),
    modified_amount       NUMERIC(12, 2),
    addon_amount          NUMERIC(12, 2),
    discounted_amount     NUMERIC(12, 2),
    total_amount          NUMERIC(12, 2),
    status                VARCHAR(50),
    total_rental          NUMERIC(12, 2),

    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservation_guests (
    guest_key              VARCHAR(64) PRIMARY KEY,
    conf_code              VARCHAR(100),
    member_number          VARCHAR(50),
    guest_name             VARCHAR(255),
    folio                  VARCHAR(100),
    is_owner                BOOLEAN,
    check_in_date          DATE,
    check_out_date         DATE,
    room_number            VARCHAR(50),
    journal_folder         VARCHAR(255),
    source_file            TEXT,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
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

-- Itemized statement lines (Homeowner receivable type, periods due
-- 2025-01-01+). Hash PK because ref_transaction_id can be blank.
CREATE TABLE IF NOT EXISTS statement_details (
    statement_detail_key    VARCHAR(64) PRIMARY KEY,
    member_number           VARCHAR(50) REFERENCES members(member_number) ON DELETE CASCADE,
    receivable_type         VARCHAR(50),
    statement_period        VARCHAR(100),
    statement_due_date      DATE,
    transaction_date        DATE,
    ref_transaction_id      VARCHAR(100),
    description             VARCHAR(500),
    charge                  NUMERIC(12, 2),
    surcharge               NUMERIC(12, 2),
    service_charge          NUMERIC(12, 2),
    sales_tax               NUMERIC(12, 2),
    amount                  NUMERIC(12, 2),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
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

# rack_rate = original_amount when overridden, else modified + addon.
# discount_given = rack_rate - total_amount. Kept as a view so the
# formula can change without re-loading data.
RATE_DETAILS_VIEW_DDL = """
CREATE OR REPLACE VIEW rate_details_with_discount AS
SELECT
    rd.*,
    CASE WHEN rd.original_amount > 0
         THEN rd.original_amount
         ELSE COALESCE(rd.modified_amount, 0) + COALESCE(rd.addon_amount, 0)
    END AS rack_rate,
    (CASE WHEN rd.original_amount > 0
          THEN rd.original_amount
          ELSE COALESCE(rd.modified_amount, 0) + COALESCE(rd.addon_amount, 0)
     END) - COALESCE(rd.total_amount, 0) AS discount_given
FROM rate_details rd;
"""

DROP_ALL = """
DROP TABLE IF EXISTS interests, services, statement_details, statements, recent_activity,
    reservation_guests, business_source, rate_details, folios, rooms, dependent_phones, dependent_addresses, dependents,
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
    # val is None / NaN / blank -> None; but a genuine 0 or 0.0 is a
    # real amount and must NOT be treated as falsy (pandas parses bare
    # "0.00" columns as float 0.0, and `not 0.0` is True).
    if val is None or str(val).strip() in ("", "nan", "-", "--"):
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


def clean_name(val, max_len=255):
    """Standardize names: strip extra spaces and title-case."""
    name = clean_str(val, max_len)
    if not name:
        return None
    name = re.sub(r"\s+", " ", name)
    return name.title()


def clean_email(val):
    """Lowercase and basic-validate email. Returns None if empty or invalid."""
    email = clean_str(val, 255)
    if not email:
        return None
    email = email.lower()
    return email if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) else None


def clean_status(val):
    """Standardize common status values and fix common misspellings."""
    status = clean_str(val, 50)
    if not status:
        return None

    key = re.sub(r"\s+", " ", status).strip().lower()
    status_map = {
        "active": "Active",
        "actve": "Active",
        "acctive": "Active",
        "inactive": "Inactive",
        "in active": "Inactive",
        "in-active": "Inactive",
        "cancelled": "Cancelled",
        "canceled": "Cancelled",
        "pending": "Pending",
        "suspended": "Suspended",
        "terminated": "Terminated",
        "resigned": "Resigned",
    }
    return status_map.get(key, key.title())


def clean_category(val, max_len=100):
    """Standardize category-like text fields."""
    category = clean_str(val, max_len)
    if not category:
        return None
    category = re.sub(r"\s+", " ", category)
    return category.title()


def clean_address_part(val, max_len=255):
    """Basic address standardization: strip extra spaces and title-case."""
    address = clean_str(val, max_len)
    if not address:
        return None
    address = re.sub(r"\s+", " ", address)
    return address.title()


def clean_postal_code(val):
    """Basic postal/ZIP cleaner: uppercase and remove spaces."""
    postal_code = clean_str(val, 20)
    if not postal_code:
        return None
    return postal_code.upper().replace(" ", "")


def remove_duplicate_dicts(rows, key_fields):
    """Remove duplicate row dictionaries before inserting into the database."""
    seen = set()
    unique_rows = []

    for row in rows:
        key = tuple(row.get(field) for field in key_fields)
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)

    return unique_rows


def clean_prefix(val):
    """Standardize common name prefixes."""
    prefix = clean_str(val, 20)
    if not prefix:
        return None

    prefix = prefix.replace(".", "").strip().lower()
    prefix_map = {
        "mr": "Mr.",
        "mrs": "Mrs.",
        "ms": "Ms.",
        "miss": "Miss",
        "dr": "Dr.",
        "prof": "Prof.",
    }
    return prefix_map.get(prefix, prefix.title())


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
    """Parse integer. Returns None if empty or non-numeric. Zero is a value."""
    if val is None or str(val).strip() in ("", "nan"):
        return None
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return None

def make_folio_key(*parts):
    """Create a stable key for folio upserts from identifying report columns."""
    raw = "|".join(clean_str(part) or "" for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def first_token(val):
    """Return the first non-space token from a value."""
    s = clean_str(val)
    return s.split()[0] if s else None


def clean_bool(val):
    """Parse common true/false values from CSV cells."""
    if val is None or str(val).strip() in ("", "nan"):
        return None
    v = str(val).strip().lower()
    if v in ("true", "t", "yes", "y", "1", "owner"):
        return True
    if v in ("false", "f", "no", "n", "0"):
        return False
    return None


def get_first(row, *names):
    """Return the first present value from a pandas row using possible column names."""
    for name in names:
        if name in row.index:
            val = row.get(name)
            if clean_str(val) is not None:
                return val
    return None


def extract_prefix(name):
    """Extract common prefixes from names."""
    if not name:
        return None

    match = re.match(
        r"^(mr|mrs|ms|miss|dr|prof)\.?\s+",
        str(name).strip(),
        flags=re.IGNORECASE
    )

    if not match:
        return None

    prefix = match.group(1).lower()

    prefix_map = {
        "mr": "Mr.",
        "mrs": "Mrs.",
        "ms": "Ms.",
        "miss": "Miss",
        "dr": "Dr.",
        "prof": "Prof.",
    }

    return prefix_map.get(prefix, prefix.title())

def split_name(val):
    """
    Splits names into first, middle, last.

    Handles common formats:
        'Smith, John Michael' -> John / Michael / Smith
        'John Michael Smith'  -> John / Michael / Smith
        'Dr. Smith, John'     -> John / None / Smith
    """
    name = clean_str(val)
    if not name:
        return None, None, None

    # Remove extra spaces
    name = re.sub(r"\s+", " ", name).strip()

    # Remove common prefixes from the start so they do not become first/last name
    name = re.sub(r"^(mr|mrs|ms|miss|dr|prof)\.?\s+", "", name, flags=re.IGNORECASE)

    # Remove common suffixes from the end
    name = re.sub(r",?\s+(jr|sr|ii|iii|iv)\.?$", "", name, flags=re.IGNORECASE)

    if "," in name:
        # Format: Last, First Middle
        last, rest = name.split(",", 1)
        last = clean_str(last.title(), 100)
        parts = rest.strip().split()
    else:
        # Format: First Middle Last
        parts = name.split()
        last = clean_str(parts[-1].title(), 100) if len(parts) > 1 else None
        parts = parts[:-1] if len(parts) > 1 else parts

    first = clean_str(parts[0].title(), 100) if len(parts) >= 1 else None
    middle = clean_str(" ".join(p.title() for p in parts[1:]), 100) if len(parts) > 1 else None

    return first, middle, last

def keep_sample(key, sample_rate):
    if sample_rate >= 1:
        return True
    h = int(hashlib.sha256(str(key).encode()).hexdigest(), 16)
    return (h % 10000) < int(sample_rate * 10000)


# ─────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────

def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def reconnect(max_attempts=5, delay=5):
    """Reconnect with retries — the Supabase pooler drops long sessions."""
    for attempt in range(1, max_attempts + 1):
        try:
            conn = get_connection()
            conn.autocommit = False
            log.info(f"Reconnected to PostgreSQL (attempt {attempt}).")
            return conn
        except Exception as e:
            log.warning(f"Reconnect attempt {attempt}/{max_attempts} failed: {e}")
            time.sleep(delay * attempt)
    raise ConnectionError("Could not reconnect to PostgreSQL.")


def connection_alive(conn):
    try:
        if conn is None or conn.closed:
            return False
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def safe_rollback(conn):
    try:
        conn.rollback()
    except Exception:
        pass


def load_cleaner_done():
    if not os.path.exists(CLEANER_DONE_LOG):
        return set()
    with open(CLEANER_DONE_LOG, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())


def mark_cleaner_done(folder_name):
    with open(CLEANER_DONE_LOG, "a", encoding="utf-8") as f:
        f.write(f"{folder_name}\n")



def create_tables(conn, recreate=False):
    with conn.cursor() as cur:
        if recreate:
            log.info("Dropping all tables...")
            cur.execute(DROP_ALL)
        log.info("Creating tables if not exist...")
        cur.execute(DDL)
        cur.execute(RATE_DETAILS_VIEW_DDL)

        # Folios/reservation guests may include guest/member numbers that are not
        # present in members yet, so these tables intentionally do not enforce
        # a foreign key to members. Drop the old FK if it exists from a previous run.
        cur.execute("""
            ALTER TABLE IF EXISTS reservation_guests
            DROP CONSTRAINT IF EXISTS reservation_guests_member_number_fkey
        """)

        # Keep existing folios tables aligned with the current scraper output.
        # New journal folio CSVs include Persons, Source, and Payment Type.
        # journal_folder/source_file are no longer persisted on folios.
        cur.execute("""
            ALTER TABLE IF EXISTS folios
            ADD COLUMN IF NOT EXISTS persons INTEGER,
            ADD COLUMN IF NOT EXISTS source VARCHAR(255),
            ADD COLUMN IF NOT EXISTS payment_type VARCHAR(100),
            DROP COLUMN IF EXISTS journal_folder,
            DROP COLUMN IF EXISTS source_file
        """)

        # services: dues/fee detail columns from Billing > Services
        cur.execute("""
            ALTER TABLE IF EXISTS services
            ADD COLUMN IF NOT EXISTS service_type VARCHAR(100),
            ADD COLUMN IF NOT EXISTS frequency VARCHAR(50),
            ADD COLUMN IF NOT EXISTS start_date DATE,
            ADD COLUMN IF NOT EXISTS billed_upto DATE,
            ADD COLUMN IF NOT EXISTS end_date DATE,
            ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)
        """)

        # Same service name can recur across renewal periods — the
        # composite key with start_date keeps each period as its own row.
        cur.execute("""
            ALTER TABLE IF EXISTS services
            DROP CONSTRAINT IF EXISTS services_member_number_service_name_key
        """)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'services_member_number_service_name_start_date_key'
                ) THEN
                    ALTER TABLE services
                    ADD CONSTRAINT services_member_number_service_name_start_date_key
                    UNIQUE (member_number, service_name, start_date);
                END IF;
            END $$;
        """)

        # statements: receivable_type in the key (scraper is Homeowner-
        # only now, but the composite key stays correct either way).
        cur.execute("""
            ALTER TABLE IF EXISTS statements
            ADD COLUMN IF NOT EXISTS receivable_type VARCHAR(50)
        """)
        cur.execute("""
            ALTER TABLE IF EXISTS statements
            DROP CONSTRAINT IF EXISTS statements_member_number_statement_period_key
        """)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'statements_member_number_statement_period_receivable_type_key'
                ) THEN
                    ALTER TABLE statements
                    ADD CONSTRAINT statements_member_number_statement_period_receivable_type_key
                    UNIQUE (member_number, statement_period, receivable_type);
                END IF;
            END $$;
        """)
    conn.commit()
    log.info("Tables ready.")


def filter_rows_to_existing_members(conn, rows, label, member_field="member_number"):
    """Keep only rows whose member_number exists in members.

    This prevents --folios-only loads from failing when journal/folio CSVs
    contain guest/member numbers that were not loaded into the members table.
    """
    if not rows:
        return rows

    member_numbers = sorted({
        clean_str(row.get(member_field), 50)
        for row in rows
        if clean_str(row.get(member_field), 50)
    })

    if not member_numbers:
        log.warning(f"  {label}: skipped {len(rows)} rows because no member_number was present")
        return []

    with conn.cursor() as cur:
        cur.execute(
            "SELECT member_number FROM members WHERE member_number = ANY(%s)",
            (member_numbers,),
        )
        existing = {r[0] for r in cur.fetchall()}

    kept = [
        row for row in rows
        if clean_str(row.get(member_field), 50) in existing
    ]

    skipped = len(rows) - len(kept)
    if skipped:
        log.warning(
            f"  {label}: skipped {skipped} rows because member_number was not in members"
        )

    return kept


def upsert(conn, table, rows, conflict_col, dry_run=False):
    """
    Insert rows into table. On conflict, update the existing row.
    rows: list of dicts with identical keys.
    Batches all rows in a single execute_values call (page_size=1000).
    """
    if not rows:
        return 0

    rows = remove_duplicate_dicts(rows, [conflict_col])

    cols = list(rows[0].keys())
    values = [[r.get(c) for c in cols] for r in rows]
    update_cols = [c for c in cols if c != conflict_col]
    update_sql = ", ".join([f"{col} = EXCLUDED.{col}" for col in update_cols])

    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT ({conflict_col}) DO UPDATE SET {update_sql}"
    )

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(rows)} rows into {table}")
        return len(rows)

    try:
        with conn.cursor() as cur:
            # page_size=1000 sends up to 1000 rows per round-trip instead of 100
            execute_values(cur, sql, values, page_size=1000)
        # NOTE: caller is responsible for commit — do NOT commit here
        return len(rows)
    except Exception:
        raise


def upsert_multi(conn, table, rows, conflict_cols, dry_run=False):
    """Upsert with composite conflict key. On conflict, update existing row."""
    if not rows:
        return 0

    rows = remove_duplicate_dicts(rows, conflict_cols)

    cols = list(rows[0].keys())
    values = [[r.get(c) for c in cols] for r in rows]
    conflict = ", ".join(conflict_cols)
    update_cols = [c for c in cols if c not in conflict_cols]
    update_sql = ", ".join([f"{col} = EXCLUDED.{col}" for col in update_cols])

    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT ({conflict}) DO UPDATE SET {update_sql}"
    )

    if dry_run:
        log.info(f"  [DRY RUN] Would upsert {len(rows)} rows into {table}")
        return len(rows)

    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, values, page_size=1000)
        # NOTE: caller is responsible for commit — do NOT commit here
        return len(rows)
    except Exception:
        raise


# ─────────────────────────────────────────────
# LOADERS
# ─────────────────────────────────────────────

def load_profile(conn, member_number, filepath, dry_run=False):
    """
    Load _profile.csv into members, member_addresses, member_phones.
    OPTIONAL_PROFILE_COLS missing from the CSV are dropped from the
    upsert so existing DB values aren't NULL-wiped by column drift.
    """
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    present = set(df.columns)
    missing_expected = EXPECTED_PROFILE_COLS - present
    if missing_expected:
        log.warning(
            f"  Profile CSV missing expected columns: {sorted(missing_expected)} "
            f"— protected fields among these will NOT be updated in the DB."
        )

    # ── Collect all rows first, then upsert once per table ───────
    member_rows   = []
    address_rows  = []
    phone_rows    = []

    for _, row in df.iterrows():
        mn = clean_str(row.get("Member Number")) or member_number
        full_name_source = row.get("Member Full Name") or row.get("Member Name")
        first_name, middle_name, last_name = split_name(full_name_source)

        member_rows.append({
            "member_number":    mn,
            "member_name":      clean_name(row.get("Member Name")),
            "member_full_name": clean_name(row.get("Member Full Name")),
            "prefix":           extract_prefix(full_name_source),
            "first_name":       first_name,
            "middle_name":      middle_name,
            "last_name":        last_name,
            "member_type":      clean_category(row.get("Member Type"), 100),
            "member_or_guest":  clean_category(row.get("Member / Guest"), 50),
            "gender":           clean_gender(row.get("Gender")),
            "employer":         clean_name(row.get("Employer")),
            "status":           clean_status(row.get("Status")),
            "age":              clean_int(row.get("Age")),
            "membership_tenure":clean_str(row.get("Membership Tenure"), 50),
            "occupation":       clean_category(row.get("Occupation"), 255),
            "marital_status":   clean_category(row.get("Marital Status"), 50),
            "activation_date":  clean_date(row.get("Member Activation")),
            "deactivation_date":clean_date(row.get("Member Deactivation") or row.get("Deactivation Date")),
            "since_date":       clean_date(row.get("Member Since")),
            "date_of_birth":    clean_date(row.get("Date of Birth")),
            "date_of_death":    clean_date(row.get("Date of Death")),
            "billing_cycle":    clean_str(row.get("Billing Cycle"), 50),
            "bill_to_member":   clean_str(row.get("Bill To Member"), 50),
            "fico_score":       clean_int(row.get("FICO Score")),
            "email":            clean_email(row.get("Email")),
        })

        addr = {
            "member_number": mn,
            "address_line1": clean_address_part(row.get("Address Line1"), 255),
            "address_line2": clean_address_part(row.get("Address Line2"), 255),
            "city":          clean_address_part(row.get("City"), 100),
            "state":         clean_address_part(row.get("State"), 100),
            "postal_code":   clean_postal_code(row.get("Postal Code")),
            "country":       clean_address_part(row.get("Country"), 100),
        }
        if any(v for k, v in addr.items() if k != "member_number"):
            address_rows.append(addr)

        phone_map = {
            "home":     row.get("Home Phone"),
            "business": row.get("Business Phone"),
            "cell":     row.get("Cell Phone"),
            "fax":      row.get("Fax Phone"),
        }
        for ptype, pval in phone_map.items():
            num = clean_phone(pval)
            if num:
                phone_rows.append({
                    "member_number": mn,
                    "phone_type":    ptype,
                    "phone_number":  num,
                })

    # ── Column-drift guard: drop DB fields whose source column is
    #    absent so the upsert preserves existing values ─────────────
    absent_keys = [db_col for db_col, csv_col in OPTIONAL_PROFILE_COLS.items()
                   if csv_col not in present]
    if absent_keys and member_rows:
        for r in member_rows:
            for k in absent_keys:
                r.pop(k, None)

    # ── Single upsert per table ───────────────────────────────────
    if member_rows:
        upsert(conn, "members", member_rows, "member_number", dry_run)
    if address_rows:
        upsert(conn, "member_addresses", address_rows, "member_number", dry_run)
    if phone_rows:
        upsert_multi(conn, "member_phones", phone_rows,
                     ["member_number", "phone_type"], dry_run)


def load_dependents(conn, member_number, filepath, dry_run=False):
    """
    Load _dependents.csv into dependents, dependent_addresses,
    dependent_phones. The report wrongly marks many inactive dependents
    as Active — a deactivation date or date of death overrides it.
    """
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    dep_rows     = []
    address_rows = []
    phone_rows   = []

    for _, row in df.iterrows():
        dn = clean_str(row.get("Dependant Number"))
        if not dn:
            continue

        dep_name = row.get("Dependant Name")
        first_name, middle_name, last_name = split_name(dep_name)

        # Deactivation/death dates override the report's status.
        deactivation = clean_date(row.get("Dependant Member Deactivation"))
        death        = clean_date(row.get("Dependant Date of Death"))
        raw_status   = clean_status(row.get("Dependant Status"))
        status       = "Inactive" if (deactivation or death) else raw_status

        dep_rows.append({
            "dependent_number": dn,
            "member_number":    clean_str(row.get("Member Number")) or member_number,
            "dependent_name":   clean_name(dep_name),
            "first_name":       first_name,
            "middle_name":      middle_name,
            "last_name":        last_name,
            "gender":           clean_gender(row.get("Dependant Gender")),
            "marital_status":   clean_category(row.get("Dependant Marital Status"), 50),
            "age":              clean_int(row.get("Dependant Age")),
            "date_of_birth":    clean_date(row.get("Dependant Date of Birth")),
            "date_of_death":    death,
            "activation_date":  clean_date(row.get("Dependant Member Activation")),
            "deactivation_date": deactivation,
            "since_date":       clean_date(row.get("Dependant Member Since")),
            "billing_cycle":    clean_str(row.get("Dependant Billing Cycle"), 50),
            "bill_to_member":   clean_str(row.get("Dependant Bill To Member"), 50),
            "fico_score":       clean_int(row.get("Dependant FICO Score")),
            "email":            clean_email(row.get("Dependant Email")),
            "status":           status,
        })

        addr = {
            "dependent_number": dn,
            "address_line1":    clean_address_part(row.get("Dependant Address Line1"), 255),
            "address_line2":    clean_address_part(row.get("Dependant Address Line2"), 255),
            "city":             clean_address_part(row.get("Dependant City"), 100),
            "state":            clean_address_part(row.get("Dependant State"), 100),
            "postal_code":      clean_postal_code(row.get("Dependant Postal Code")),
            "country":          clean_address_part(row.get("Dependant Country"), 100),
        }
        if any(v for k, v in addr.items() if k != "dependent_number"):
            address_rows.append(addr)

        phone_map = {
            "home":     row.get("Dependant Home Phone"),
            "business": row.get("Dependant Business Phone"),
            "cell":     row.get("Dependant Cell Phone"),
            "fax":      row.get("Dependant Fax Phone"),
        }
        for ptype, pval in phone_map.items():
            num = clean_phone(pval)
            if num:
                phone_rows.append({
                    "dependent_number": dn,
                    "phone_type":       ptype,
                    "phone_number":     num,
                })

    # ── Single upsert per table ───────────────────────────────────
    if dep_rows:
        upsert(conn, "dependents", dep_rows, "dependent_number", dry_run)
    if address_rows:
        upsert(conn, "dependent_addresses", address_rows, "dependent_number", dry_run)
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
            "room_type":        clean_category(row.get("Room Type"), 100),
            "room_number":      clean_str(row.get("Room #"), 50),
            "check_in_date":    clean_date(row.get("Check In Date")),
            "check_out_date":   clean_date(row.get("Check Out Date")),
            "status":           clean_status(row.get("status")),
        })

    # [2026-07-18] rooms.member_number has an FK to members. A normal
    # run loads 'profile' before 'rooms' (see LOADERS), so the member
    # row exists by now — but --rooms-only has no such ordering, and an
    # unknown member would fail the whole folder on an FK violation.
    # Skip those rows with a warning instead, same guard the folio
    # loaders use.
    rows = filter_rows_to_existing_members(conn, rows, "rooms")

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
    """Load _statements.csv (Homeowner receivable type, 2025+ periods)."""
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
            "receivable_type":  clean_str(row.get("_receivable_type"), 50),
        })

    if rows:
        upsert_multi(conn, "statements", rows,
                     ["member_number", "statement_period", "receivable_type"], dry_run)
        log.info(f"  statements: {len(rows)} rows")


def load_statement_details(conn, member_number, filepath, dry_run=False):
    """
    Load _statement_details.csv — itemized lines per statement period
    (DATE, REF./TRANSACTION ID, DESCRIPTION, CHARGE, Surcharge,
    Service Charge, SALES TAX, AMOUNT + scraper tags). Hash PK because
    ref_transaction_id can be blank (Balance Forward rows).
    """
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        receivable_type    = clean_str(get_first(row, "_receivable_type"), 50)
        statement_period   = clean_str(get_first(row, "_statement_period"), 100)
        statement_due_date = clean_date(get_first(row, "_statement_due_date"))
        transaction_date   = clean_date(get_first(row, "DATE", "Date"))
        ref_transaction_id = clean_str(get_first(row, "REF. / TRANSACTION ID", "Ref. / Transaction ID", "Ref / Transaction ID"), 100)
        description         = clean_str(get_first(row, "DESCRIPTION", "Description"), 500)
        charge              = clean_amount(get_first(row, "CHARGE", "Charge"))
        surcharge           = clean_amount(get_first(row, "Surcharge", "SURCHARGE"))
        service_charge      = clean_amount(get_first(row, "Service Charge", "SERVICE CHARGE"))
        sales_tax           = clean_amount(get_first(row, "SALES TAX", "Sales Tax"))
        amount              = clean_amount(get_first(row, "AMOUNT", "Amount"))

        if not any([transaction_date, description, amount]):
            continue

        rows.append({
            "statement_detail_key": make_folio_key(
                member_number, receivable_type, statement_period,
                transaction_date, ref_transaction_id, description, amount,
            ),
            "member_number":      member_number,
            "receivable_type":    receivable_type,
            "statement_period":   statement_period,
            "statement_due_date": statement_due_date,
            "transaction_date":   transaction_date,
            "ref_transaction_id": ref_transaction_id,
            "description":        description,
            "charge":             charge,
            "surcharge":          surcharge,
            "service_charge":     service_charge,
            "sales_tax":          sales_tax,
            "amount":             amount,
        })

    if rows:
        upsert(conn, "statement_details", rows, "statement_detail_key", dry_run)
        log.info(f"  statement_details: {len(rows)} rows")


def load_services(conn, member_number, filepath, dry_run=False):
    """
    Load _services.csv — Name, Type, Frequency, Start Date, Billed
    Upto, End Date, Amount. Conflict key includes start_date since the
    same service name recurs across renewal periods.
    """
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    # Page-level error/empty-state messages that occasionally get scraped
    # into the Name column instead of real service data — reject these
    # outright, same treatment as "no matching records found".
    PAGE_ERROR_PHRASES = {
        "no matching records found",
        "unable to process this request",
    }

    rows = []
    for _, row in df.iterrows():
        svc = clean_str(get_first(row, "Name", "Service", "service_name", "col_0"))
        if not svc or svc.lower() in PAGE_ERROR_PHRASES:
            continue
        # Reject anything that looks like scraped page code, not a
        # real service name (second line of defense behind the scraper).
        if len(svc) > 150 or any(tok in svc for tok in ("function(", "var ", "\n", "{", "};")):
            log.warning(f"  Skipping implausible service_name for {member_number}: {svc[:60]!r}...")
            continue
        rows.append({
            "member_number": member_number,
            "service_name":  clean_category(svc, 255),
            "service_type":  clean_category(get_first(row, "Type"), 100),
            "frequency":     clean_category(get_first(row, "Frequency"), 50),
            "start_date":    clean_date(get_first(row, "Start Date")),
            "billed_upto":   clean_date(get_first(row, "Billed Upto")),
            "end_date":      clean_date(get_first(row, "End Date")),
            "amount":        clean_amount(get_first(row, "Amount")),
        })

    if rows:
        upsert_multi(conn, "services", rows,
                     ["member_number", "service_name", "start_date"], dry_run)
        log.info(f"  services: {len(rows)} rows")


def load_interests(conn, member_number, filepath, dry_run=False):
    """Load _interests.csv into interests table."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

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
                    "interest_name":   clean_category(name, 255),
                    "interest_value":  clean_category(value, 255),
                })

    if rows:
        upsert_multi(conn, "interests", rows,
                     ["member_number", "interest_name"], dry_run)
        log.info(f"  interests: {len(rows)} rows")


def normalize_folio_row(row, journal_folder=None, source_file=None):
    """Normalize one Playwright folio transaction row to the folios table shape."""

    # Resolve member_number — only use explicit member columns, then journal
    # folder name as a fallback. Do not infer member_number from guest name or conf code values.
    member_number = clean_str(
        get_first(row, "Main Member #", "Member #", "Member Number", "Main Member Number"),
        50,
    )
    if not member_number:
        member_number = clean_str(journal_folder, 50)

    conf_code = clean_str(get_first(row, "Conf. Code", "Confirmation Code"), 100)
    folio_num = clean_str(get_first(row, "_folio_num", "Folio", "Folio #", "Folio Num"), 100)
    folio_name = clean_str(get_first(row, "_folio_name", "Folio Name"), 255)
    reservation_folio_id = clean_str(get_first(row, "_reservation_folio_id", "Reservation Folio Id"), 100)
    description = clean_str(get_first(row, "Description"), 500)
    transaction_date = clean_date(get_first(row, "Date", "Transaction Date"))
    amount = clean_amount(get_first(row, "Amount"))
    guest_name = clean_name(get_first(row, "Guest Name", "Member/Guest Name"))
    
    return {
        "folio_key": make_folio_key(
            source_file, journal_folder, conf_code, reservation_folio_id,
            folio_num, folio_name, transaction_date, description, amount,
            member_number, guest_name,
        ),
        "transaction_date": transaction_date,
        "description": description,
        "amount": amount,
        "folio_num": folio_num,
        "folio_name": folio_name,
        "balance_due": clean_amount(get_first(row, "_balance_due", "Balance Due")),
        "reservation_folio_id": reservation_folio_id,
        "conf_code": conf_code,
        "member_number": member_number,
        "guest_name": guest_name,
        "check_in_date": clean_date(get_first(row, "Check-In Date", "Check In Date")),
        "check_out_date": clean_date(get_first(row, "Check-Out Date", "Check Out Date")),
        "room_number": clean_str(get_first(row, "Room #", "Room Number"), 50),
        "villa_name": clean_str(get_first(row, "Villa Name"), 255),
        "bedroom_count": clean_int(get_first(row, "Bedroom Count")),
        "persons": clean_int(get_first(row, "Persons")),
        "source": clean_str(get_first(row, "Source"), 255),
        "payment_type": clean_str(get_first(row, "Payment Type"), 100),
        "reservation_status": clean_category(get_first(row, "Reservation Status"), 100),       
    }


def load_folio_file(conn, filepath, journal_folder=None, dry_run=False):
    """Load one per-person journal folio CSV into folios."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read folio file {filepath}: {e}")
        return 0

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        out = normalize_folio_row(row, journal_folder, filepath)

        if not any([
            out["transaction_date"], out["description"], out["amount"],
            out["folio_num"], out["folio_name"], out["reservation_folio_id"],
            out["conf_code"], out["member_number"], out["guest_name"],
        ]):
            continue
        rows.append(out)

    if rows:
        count = upsert(conn, "folios", rows, "folio_key", dry_run)
        log.info(f"  folios from {os.path.basename(filepath)}: {count} rows")
        return count
    return 0


def load_reservation_guests(conn, main_member_number, filepath, dry_run=False):
    """
    Load journal/{main_member_num}/{main_member_num}_guests.csv.
    Expected columns: Conf. Code, Member #, Guest Name, Folio, Is Owner,
                      Check-In Date, Check-Out Date, Room #
    """
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read guests file {filepath}: {e}")
        return 0

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]
    rows = []
    journal_folder = os.path.basename(os.path.dirname(filepath))

    for _, row in df.iterrows():
        conf_code = clean_str(get_first(row, "Conf. Code", "Confirmation Code"), 100)
        member_number = clean_str(get_first(row, "Member #", "Member Number"), 50)
        guest_name = clean_name(get_first(row, "Guest Name"))
        folio = clean_str(get_first(row, "Folio"), 100)

        if not any([conf_code, member_number, guest_name, folio]):
            continue

        rows.append({
            "guest_key": make_folio_key(main_member_number, conf_code, member_number, guest_name, folio),
            "conf_code": conf_code,
            "member_number": member_number,
            "guest_name": guest_name,
            "folio": folio,
            "is_owner": clean_bool(get_first(row, "Is Owner")),
            "check_in_date": clean_date(get_first(row, "Check-In Date", "Check In Date")),
            "check_out_date": clean_date(get_first(row, "Check-Out Date", "Check Out Date")),
            "room_number": clean_str(get_first(row, "Room #", "Room Number"), 50),
            "journal_folder": clean_str(journal_folder, 255),
            "source_file": clean_str(filepath),
        })

    if rows:
        count = upsert(conn, "reservation_guests", rows, "guest_key", dry_run)
        log.info(f"  reservation_guests: {count} rows")
        return count
    return 0


def load_journal_folios(conn, journal_folder=JOURNAL_FOLDER, dry_run=False):
    """Scan backend/playwright/journal/{person}/ for folio CSVs and guest tables."""
    if not os.path.isdir(journal_folder):
        log.warning(f"Journal folder not found: {journal_folder}")
        return 0

    total = 0
    for person_dir in sorted(f.path for f in os.scandir(journal_folder) if f.is_dir()):
        folder_name = os.path.basename(person_dir)

        guest_table = os.path.join(person_dir, f"{folder_name}_guests.csv")
        if os.path.exists(guest_table):
            load_reservation_guests(conn, folder_name, guest_table, dry_run)

        for filepath in sorted(glob.glob(os.path.join(person_dir, "*.csv"))):
            base = os.path.basename(filepath).lower()
            if base.endswith("_guests.csv"):
                continue
            if base.endswith("_rate_details.csv"):
                continue
            if "folio" not in base:
                continue
            total += load_folio_file(conn, filepath, folder_name, dry_run)

    log.info(f"journal folios: {total} rows")
    return total



def load_business_source(conn, filepath=BUSINESS_SOURCE_FILE, dry_run=False):
    """
    Load playwright/reports/business_source.csv and update folios.payment_type
    for existing folio rows whose folios.source matches Source Name.

    Expected columns:
        Source Name, Payment Type

    This does not insert new folio rows. It only upserts the mapping table and
    updates existing folios.source/payment_type values.
    """
    if not os.path.exists(filepath):
        log.warning(f"Business source report not found: {filepath}")
        return 0

    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"Could not read business source report {filepath}: {e}")
        return 0

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        source_name = clean_str(get_first(row, "Source Name", "Source", "Business Source"), 255)
        payment_type = clean_str(get_first(row, "Payment Type", "PaymentType"), 100)

        if not source_name:
            continue

        rows.append({
            "source_name": source_name,
            "payment_type": payment_type,
        })

    if not rows:
        log.info("business_source: 0 rows")
        return 0

    rows = remove_duplicate_dicts(rows, ["source_name"])
    count = upsert(conn, "business_source", rows, "source_name", dry_run)

    if dry_run:
        log.info(f"  [DRY RUN] Would update folios.payment_type from {len(rows)} business_source rows")
        return count

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE folios f
            SET payment_type = bs.payment_type,
                updated_at = NOW()
            FROM business_source bs
            WHERE f.source = bs.source_name
              AND COALESCE(f.payment_type, '') IS DISTINCT FROM COALESCE(bs.payment_type, '')
        """)
        updated = cur.rowcount

        # Journal-scraped rate_details rows carry Source (e.g. "HB -
        # Homeowner Booking") but a blank Payment Type — fill it from
        # the same mapping. Match on the source code prefix since
        # business_source names may be stored as code or full label.
        cur.execute("""
            UPDATE rate_details rd
            SET payment_type = bs.payment_type,
                updated_at = NOW()
            FROM business_source bs
            WHERE rd.source IS NOT NULL
              AND (rd.source = bs.source_name
                   OR split_part(rd.source, ' - ', 1) = split_part(bs.source_name, ' - ', 1))
              AND COALESCE(rd.payment_type, '') IS DISTINCT FROM COALESCE(bs.payment_type, '')
        """)
        updated_rd = cur.rowcount

    log.info(f"business_source: {count} mapping rows, updated {updated} folio rows, "
             f"{updated_rd} rate_detail rows")
    return updated

def load_folios(conn, filepath=FOLIO_REPORT_FILE, dry_run=False):
    """
    Load folios. Preferred source is backend/playwright/journal/{person}/ folio CSVs.
    Falls back to backend/playwright/reports/folio_report.csv for legacy exports.
    """
    total = load_journal_folios(conn, JOURNAL_FOLDER, dry_run)
    if total:
        return total

    if not os.path.exists(filepath):
        log.warning(f"Folio report not found: {filepath}")
        return 0

    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"Could not read folio report {filepath}: {e}")
        return 0

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]
    rows = []
    for _, row in df.iterrows():
        out = normalize_folio_row(row, None, filepath)
        if not any([out["conf_code"], out["folio_name"]]):
            continue
        rows.append(out)

    if rows:
        count = upsert(conn, "folios", rows, "folio_key", dry_run)
        log.info(f"folios: {count} rows")
        return count

    log.info("folios: 0 rows")
    return 0


def normalize_rate_detail_row(row, source_file=None):
    """
    Normalize one per-night rate detail row (reports/ CSVs or journal
    {folder}_rate_details.csv — same shape) to the rate_details table.
    The key is data-derived (no source_file) so the same night from
    either pipeline upserts instead of duplicating. source_file param
    kept for call compatibility, intentionally unused.
    """
    conf_code      = clean_str(get_first(row, "Conf. Code"), 100)
    reservation_id = clean_str(get_first(row, "Reservation ID"), 100)
    rate_date      = clean_date(get_first(row, "Date"))
    rate_name      = clean_str(get_first(row, "Rate Name"), 255)
    original_amount   = clean_amount(get_first(row, "Original Amount"))
    modified_amount   = clean_amount(get_first(row, "Modified Amount"))
    addon_amount      = clean_amount(get_first(row, "Addon Amount"))
    discounted_amount = clean_amount(get_first(row, "Discounted Amount"))
    total_amount      = clean_amount(get_first(row, "Total Amount"))

    return {
        "rate_detail_key": make_folio_key(
            conf_code, reservation_id, rate_date, rate_name,
            original_amount, modified_amount, addon_amount,
            discounted_amount, total_amount,
        ),
        "conf_code": conf_code,
        "reservation_id": reservation_id,
        "member_number": clean_str(get_first(row, "Member #"), 50),
        "guest_name": clean_name(get_first(row, "Guest Name")),
        "room_number": clean_str(get_first(row, "Room #"), 50),
        "villa_name": clean_str(get_first(row, "Villa Name"), 255),
        "bedroom_count": clean_int(get_first(row, "Bedroom Count")),
        "source": clean_str(get_first(row, "Source"), 255),
        "payment_type": clean_str(get_first(row, "Payment Type"), 100),
        "check_in_date": clean_date(get_first(row, "Check-In Date")),
        "check_out_date": clean_date(get_first(row, "Check-Out Date")),
        "reservation_status": clean_category(get_first(row, "Reservation Status"), 100),
        "rate_date": rate_date,
        "rate_name": rate_name,
        "original_amount": original_amount,
        "modified_amount": modified_amount,
        "addon_amount": addon_amount,
        "discounted_amount": discounted_amount,
        "total_amount": total_amount,
        "status": clean_str(get_first(row, "Status"), 50),
        "total_rental": clean_amount(get_first(row, "Total Rental")),
    }


def load_rate_detail_file(conn, filepath, dry_run=False):
    """Load one of rate_details_free.csv / rate_details_paid.csv into rate_details."""
    if not os.path.exists(filepath):
        log.warning(f"Rate details file not found: {filepath}")
        return 0

    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read rate details file {filepath}: {e}")
        return 0

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        out = normalize_rate_detail_row(row, filepath)
        if not any([out["conf_code"], out["rate_date"]]):
            continue
        rows.append(out)

    if rows:
        count = upsert(conn, "rate_details", rows, "rate_detail_key", dry_run)
        log.info(f"  rate_details from {os.path.basename(filepath)}: {count} rows")
        return count
    return 0


def load_rate_details(conn, dry_run=False):
    """Load both Free and Paid rate detail CSVs into the one rate_details table."""
    total = 0
    total += load_rate_detail_file(conn, FREE_RATE_DETAILS_FILE, dry_run)
    total += load_rate_detail_file(conn, PAID_RATE_DETAILS_FILE, dry_run)
    log.info(f"rate_details: {total} rows")
    return total


def load_member_rate_details(conn, member_number, filepath, dry_run=False):
    """Load a journal {folder}_rate_details.csv into rate_details."""
    try:
        df = pd.read_csv(filepath)
    except Exception as e:
        log.warning(f"  Could not read {filepath}: {e}")
        return

    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    rows = []
    for _, row in df.iterrows():
        out = normalize_rate_detail_row(row, filepath)
        if not any([out["conf_code"], out["rate_date"]]):
            continue
        if not out["member_number"]:
            out["member_number"] = clean_str(member_number, 50)
        rows.append(out)

    if rows:
        upsert(conn, "rate_details", rows, "rate_detail_key", dry_run)
        log.info(f"  rate_details (journal): {len(rows)} rows")


# ─────────────────────────────────────────────
# PER-MEMBER LOADER  — one commit per member
# ─────────────────────────────────────────────

LOADERS = {
    "profile":            load_profile,
    "dependents":         load_dependents,
    "rooms":              load_rooms,
    "recent_activity":    load_recent_activity,
    "interests":          load_interests,
}


def load_member(conn, member_folder_path, dry_run=False):
    """
    Load all CSVs in a member journal folder.
    All upserts for this member share one transaction — commit once at the end.
    """
    folder_name = os.path.basename(member_folder_path)
    member_number = folder_name

    log.info(f"Loading {folder_name}...")

    for suffix, loader_fn in LOADERS.items():
        filepath = os.path.join(member_folder_path, f"{folder_name}_{suffix}.csv")
        if os.path.exists(filepath):
            try:
                loader_fn(conn, member_number, filepath, dry_run)
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                # Dead connection — let the caller reconnect and retry
                # this member from the top.
                raise
            except Exception as e:
                safe_rollback(conn)
                log.error(f"  Error loading {suffix} for {folder_name}: {e}")
        else:
            log.debug(f"  No {suffix} file for {folder_name}")

    # ── Single commit for the entire member ──────────────────────
    if not dry_run:
        conn.commit()


# ─────────────────────────────────────────────
# DATA QUALITY REPORT
# ─────────────────────────────────────────────

def data_quality_report(conn):
    """Print simple data quality checks after loading."""
    try:
        conn.rollback()
    except Exception:
        pass

    checks = {
        "Members missing email": """
            SELECT COUNT(*) FROM members WHERE email IS NULL;
        """,
        "Members missing date of birth": """
            SELECT COUNT(*) FROM members WHERE date_of_birth IS NULL;
        """,
        "Members missing gender": """
            SELECT COUNT(*) FROM members WHERE gender IS NULL;
        """,
        "Members missing phone": """
            SELECT COUNT(*)
            FROM members m
            LEFT JOIN member_phones p
            ON m.member_number = p.member_number
            WHERE p.member_number IS NULL;
        """,
        "Dependents missing email": """
            SELECT COUNT(*) FROM dependents WHERE email IS NULL;
        """,
        "Dependents missing date of birth": """
            SELECT COUNT(*) FROM dependents WHERE date_of_birth IS NULL;
        """,
        "Dependents marked Active with deactivation/death date": """
            SELECT COUNT(*) FROM dependents
            WHERE status = 'Active'
              AND (deactivation_date IS NOT NULL OR date_of_death IS NOT NULL);
        """,
        "Recent activity missing amount": """
            SELECT COUNT(*) FROM recent_activity WHERE amount IS NULL;
        """,
    }

    print()
    print("=" * 60)
    print("Data Quality Report")
    print("=" * 60)

    for label, query in checks.items():
        try:
            with conn.cursor() as cur:
                cur.execute(query)
                count = cur.fetchone()[0]
                print(f"  {label}: {count}")
        except Exception as e:
            conn.rollback()
            print(f"  {label}: skipped ({e})")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Load member journal CSVs into PostgreSQL.")
    parser.add_argument("--member", type=str, default=None,
                        help="Load a single member folder (e.g. 1C)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Test run — no data written to DB")
    parser.add_argument("--recreate-tables", action="store_true",
                        help="Drop and recreate all tables before loading")
    parser.add_argument("--reload", action="store_true",
                        help="Ignore cleaner_done.txt and re-load every member folder")
    parser.add_argument("--sample-rate", type=float, default=1.0,
                        help="Load deterministic sample, e.g. 0.10 for 10%")
    parser.add_argument("--folios-only", action="store_true",
                        help="Only load folios/reservation guests/business_source/"
                             "reports rate details, skip member profile data")
    parser.add_argument("--business-source-only", action="store_true",
                        help="Only load reports/business_source.csv and update folios.payment_type")
    parser.add_argument("--rate-details-only", action="store_true",
                        help="Only load rate_details_free.csv and rate_details_paid.csv into rate_details")
    parser.add_argument("--rooms-only", action="store_true",
                        help="Only load *_rooms.csv from journal folders")
    parser.add_argument("--services-and-statements-only", action="store_true",
                        help="Only load *_services.csv and *_statements.csv from journal folders")
    parser.add_argument("--statement-details-only", action="store_true",
                        help="Only load *_statement_details.csv from journal folders")
    args = parser.parse_args()

    print("=" * 60)
    print("Member ETL Loader")
    print("=" * 60)
    print(f"Database:     {DB_CONFIG['database']} @ {DB_CONFIG['host']}")
    print(f"Journal:      {JOURNAL_FOLDER}")
    print(f"Folios:       {FOLIO_REPORT_FILE}")
    print(f"Dry run:      {args.dry_run}")
    print(f"Sample rate:  {args.sample_rate}")
    print(f"Folios only:  {args.folios_only}")
    print(f"Business source only: {args.business_source_only}")
    print(f"Rate details only: {args.rate_details_only}")
    print(f"Rooms only: {args.rooms_only}")
    print(f"Services and statements only: {args.services_and_statements_only}")
    print(f"Statement details only: {args.statement_details_only}")
    print()

    try:
        conn = get_connection()
        conn.autocommit = False
        log.info("Connected to PostgreSQL (Supabase session pool).")
    except Exception as e:
        log.error(f"Could not connect to PostgreSQL: {e}")
        return

    if args.recreate_tables and os.path.exists(CLEANER_DONE_LOG):
        os.remove(CLEANER_DONE_LOG)
        log.info("cleaner_done.txt cleared (tables being recreated).")

    create_tables(conn, recreate=args.recreate_tables)

    if args.business_source_only:
        log.info("Skipping member/profile/folio transaction load because --business-source-only was used.")
        try:
            load_business_source(conn, BUSINESS_SOURCE_FILE, dry_run=args.dry_run)
            if not args.dry_run:
                conn.commit()
        except Exception as e:
            conn.rollback()
            log.error(f"Failed loading business_source: {e}")
        conn.close()
        print()
        print("=" * 60)
        print("ETL Complete")
        print("=" * 60)
        return

    if args.rate_details_only:
        log.info("Skipping everything except rate_details because --rate-details-only was used.")

        # Standalone scrape_rate_revenue.py outputs (Free/Paid files).
        # Skipped when --member is given, since those files are global.
        if not args.member:
            try:
                load_rate_details(conn, dry_run=args.dry_run)
                if not args.dry_run:
                    conn.commit()
            except Exception as e:
                conn.rollback()
                log.error(f"Failed loading standalone rate_details files: {e}")

        # [2026-07-18] Journal per-member rate details — these were
        # MISSING from this flag before: load_rate_details() only reads
        # the two standalone files, so every
        # journal/{member}/{member}_rate_details.csv scraped from the
        # reservation popups was silently ignored. Same folder-walk
        # pattern as --statement-details-only above.
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

        if args.sample_rate < 1.0:
            folders = [
                f for f in folders
                if keep_sample(os.path.basename(f), args.sample_rate)
            ]

        print(f"Members to check: {len(folders)}\n")

        loaded, skipped, failed = [], [], []
        for folder in folders:
            folder_name = os.path.basename(folder)
            rates_fp = os.path.join(folder, f"{folder_name}_rate_details.csv")

            if not os.path.exists(rates_fp):
                skipped.append(folder_name)
                continue

            try:
                load_member_rate_details(conn, folder_name, rates_fp, args.dry_run)
                if not args.dry_run:
                    conn.commit()
                loaded.append(folder_name)
            except Exception as e:
                conn.rollback()
                log.error(f"Failed rate_details for {folder_name}: {e}")
                failed.append(folder_name)

        conn.close()
        print()
        print("=" * 60)
        print("ETL Complete (rate details only)")
        print("=" * 60)
        print(f"  Loaded:  {len(loaded)}")
        print(f"  Skipped (no _rate_details.csv): {len(skipped)}")
        print(f"  Failed:  {len(failed)}")
        if failed:
            print(f"  Failed members: {failed}")
        return

    if args.rooms_only:
        # [2026-07-18] Journal _rooms.csv files are otherwise only
        # loaded by a full run — every targeted flag skips them, which
        # is how the rooms table went stale. Same folder-walk pattern
        # as --statement-details-only below.
        log.info("Skipping everything except rooms because --rooms-only was used.")

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

        if args.sample_rate < 1.0:
            folders = [
                f for f in folders
                if keep_sample(os.path.basename(f), args.sample_rate)
            ]

        print(f"Members to check: {len(folders)}\n")

        loaded, skipped, failed = [], [], []
        for folder in folders:
            folder_name = os.path.basename(folder)
            rooms_fp = os.path.join(folder, f"{folder_name}_rooms.csv")

            if not os.path.exists(rooms_fp):
                skipped.append(folder_name)
                continue

            try:
                load_rooms(conn, folder_name, rooms_fp, args.dry_run)
                if not args.dry_run:
                    conn.commit()
                loaded.append(folder_name)
            except Exception as e:
                conn.rollback()
                log.error(f"Failed rooms for {folder_name}: {e}")
                failed.append(folder_name)

        conn.close()
        print()
        print("=" * 60)
        print("ETL Complete (rooms only)")
        print("=" * 60)
        print(f"  Loaded:  {len(loaded)}")
        print(f"  Skipped (no _rooms.csv): {len(skipped)}")
        print(f"  Failed:  {len(failed)}")
        if failed:
            print(f"  Failed members: {failed}")
        return

    if args.services_and_statements_only:
        log.info("Skipping member/profile/folio load because --services-and-statements-only was used.")

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

        if args.sample_rate < 1.0:
            folders = [
                f for f in folders
                if keep_sample(os.path.basename(f), args.sample_rate)
            ]

        print(f"Members to check: {len(folders)}\n")

        loaded_services, loaded_statements, loaded_details = [], [], []
        skipped, failed = [], []
        for folder in folders:
            folder_name = os.path.basename(folder)
            services_fp   = os.path.join(folder, f"{folder_name}_services.csv")
            statements_fp = os.path.join(folder, f"{folder_name}_statements.csv")
            details_fp    = os.path.join(folder, f"{folder_name}_statement_details.csv")

            found_any = False
            member_failed = False

            if os.path.exists(services_fp):
                found_any = True
                try:
                    load_services(conn, folder_name, services_fp, args.dry_run)
                    loaded_services.append(folder_name)
                except Exception as e:
                    conn.rollback()
                    log.error(f"Failed services for {folder_name}: {e}")
                    member_failed = True

            if os.path.exists(statements_fp):
                found_any = True
                try:
                    load_statements(conn, folder_name, statements_fp, args.dry_run)
                    loaded_statements.append(folder_name)
                except Exception as e:
                    conn.rollback()
                    log.error(f"Failed statements for {folder_name}: {e}")
                    member_failed = True

            if os.path.exists(details_fp):
                found_any = True
                try:
                    load_statement_details(conn, folder_name, details_fp, args.dry_run)
                    loaded_details.append(folder_name)
                except Exception as e:
                    conn.rollback()
                    log.error(f"Failed statement_details for {folder_name}: {e}")
                    member_failed = True

            if not found_any:
                skipped.append(folder_name)
                continue

            if member_failed:
                failed.append(folder_name)
                continue

            if not args.dry_run:
                conn.commit()

        conn.close()
        print()
        print("=" * 60)
        print("ETL Complete (services + statements only)")
        print("=" * 60)
        print(f"  Loaded services:          {len(loaded_services)}")
        print(f"  Loaded statements:        {len(loaded_statements)}")
        print(f"  Loaded statement details: {len(loaded_details)}")
        print(f"  Skipped (no CSVs yet):    {len(skipped)}")
        print(f"  Failed:  {len(failed)}")
        if failed:
            print(f"  Failed members: {failed}")
        return

    if args.statement_details_only:
        log.info("Skipping everything except statement_details because --statement-details-only was used.")

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

        if args.sample_rate < 1.0:
            folders = [
                f for f in folders
                if keep_sample(os.path.basename(f), args.sample_rate)
            ]

        print(f"Members to check: {len(folders)}\n")

        loaded, skipped, failed = [], [], []
        for folder in folders:
            folder_name = os.path.basename(folder)
            details_fp = os.path.join(folder, f"{folder_name}_statement_details.csv")

            if not os.path.exists(details_fp):
                skipped.append(folder_name)
                continue

            try:
                load_statement_details(conn, folder_name, details_fp, args.dry_run)
                if not args.dry_run:
                    conn.commit()
                loaded.append(folder_name)
            except Exception as e:
                conn.rollback()
                log.error(f"Failed statement_details for {folder_name}: {e}")
                failed.append(folder_name)

        conn.close()
        print()
        print("=" * 60)
        print("ETL Complete (statement details only)")
        print("=" * 60)
        print(f"  Loaded:  {len(loaded)}")
        print(f"  Skipped (no _statement_details.csv yet): {len(skipped)}")
        print(f"  Failed:  {len(failed)}")
        if failed:
            print(f"  Failed members: {failed}")
        return

    success, failed = [], []

    if not args.folios_only:
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

        total_before_sample = len(folders)

        if args.sample_rate < 1.0:
            folders = [
                f for f in folders
                if keep_sample(os.path.basename(f), args.sample_rate)
            ]

        done = set() if (args.reload or args.member) else load_cleaner_done()
        if done:
            before = len(folders)
            folders = [f for f in folders if os.path.basename(f) not in done]
            log.info(f"Resuming — {before - len(folders)} folders already loaded "
                     f"(cleaner_done.txt), {len(folders)} remaining. "
                     f"Use --reload to re-load everything.")

        print(f"Members available: {total_before_sample}")
        print(f"Members to load:   {len(folders)}\n")

        for folder in folders:
            name = os.path.basename(folder)
            for attempt in (1, 2):
                try:
                    if not connection_alive(conn):
                        log.warning("Connection lost — reconnecting...")
                        conn = reconnect()
                    load_member(conn, folder, dry_run=args.dry_run)
                    success.append(name)
                    if not args.dry_run:
                        mark_cleaner_done(name)
                    break
                except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                    log.warning(f"Connection error on {name} (attempt {attempt}/2): {e}")
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = reconnect()
                    if attempt == 2:
                        log.error(f"Failed {name}: connection error persisted")
                        failed.append(name)
                except Exception as e:
                    safe_rollback(conn)
                    log.error(f"Failed {name}: {e}")
                    failed.append(name)
                    break
    else:
        log.info("Skipping member/profile load because --folios-only was used.")

    # Folio pipeline data — part of the default run.
    try:
        if not connection_alive(conn):
            log.warning("Connection lost before folio load — reconnecting...")
            conn = reconnect()
        if args.sample_rate >= 1.0 or args.folios_only:
            load_folios(conn, FOLIO_REPORT_FILE, dry_run=args.dry_run)
            load_business_source(conn, BUSINESS_SOURCE_FILE, dry_run=args.dry_run)
            load_rate_details(conn, dry_run=args.dry_run)
            if not args.dry_run:
                conn.commit()
        else:
            log.info("Skipping full folio load during sampled member run.")
    except Exception as e:
        safe_rollback(conn)
        log.error(f"Failed loading folios: {e}")

    if not args.dry_run:
        if not connection_alive(conn):
            conn = reconnect()
        data_quality_report(conn)

    conn.close()

    print()
    print("=" * 60)
    print("ETL Complete")
    print("=" * 60)
    print(f"  Loaded members:  {len(success)}")
    print(f"  Failed members:  {len(failed)}")
    if failed:
        print(f"  Failed members: {failed}")


if __name__ == "__main__":
    main()