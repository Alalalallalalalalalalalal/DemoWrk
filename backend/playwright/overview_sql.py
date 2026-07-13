"""
overview_sql.py — Run the post-load SQL from VS Code instead of the
Supabase SQL editor. Fully self-contained: both SQL blocks are embedded
below as constants — no separate .sql files needed.

Runs, in order:
  1. CLASSIFICATION_SQL — adds/populates villa_payment_type,
     transaction_category, transaction_flow on folios
  2. VIEWS_SQL          — (re)creates every overview_* view and
     refreshes the two materialized views

Run this AFTER every cleaner.py load — new folios rows arrive with NULL
classification columns, and the materialized views are frozen until
refreshed. Everything is idempotent; re-running is always safe.

When new unclassified descriptions show up in the verification output,
add patterns for them inside CLASSIFICATION_SQL below (Step 3's CASE or
the patch sections).

Usage:
    python overview_sql.py                 # classification + views (default)
    python overview_sql.py --classify-only # just folio classification
    python overview_sql.py --views-only    # just (re)create the views
    python overview_sql.py --refresh-only  # just refresh the 2 matviews
                                            # (fastest option when no SQL changed)
"""
import os
import sys
import time
import argparse

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
# Searched in order — first hit wins
ROOM_LOOKUP_CANDIDATES = [
    os.path.join(_SCRIPT_DIR, "room_lookup.csv"),
    os.path.join(_SCRIPT_DIR, "reports", "room_lookup.csv"),
    os.path.join(os.path.dirname(_SCRIPT_DIR), "room_lookup.csv"),
    os.path.join(os.path.dirname(_SCRIPT_DIR), "playwright", "room_lookup.csv"),
]

REFRESH_STATEMENTS = [
    # Order matters: villa_bookings reads from transaction_lines
    "REFRESH MATERIALIZED VIEW overview_transaction_lines;",
    "REFRESH MATERIALIZED VIEW overview_villa_bookings;",
]

# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1 — FOLIO CLASSIFICATION
# ═════════════════════════════════════════════════════════════════════
CLASSIFICATION_SQL = r"""
-- ============================================================
-- FOLIO CLASSIFICATION
-- Adds and populates 3 columns on folios:
--   villa_payment_type   -> was the STAY free or paid?
--   transaction_category -> what TYPE of spend is this?
--   transaction_flow     -> Charge / Payment / Reversal / Comp
-- Idempotent — run via overview_sql.py after every cleaner.py load
-- (new folios rows arrive with these columns NULL). Verification
-- output is printed by overview_sql.py.
-- ============================================================

-- STEP 1: columns
ALTER TABLE folios
    ADD COLUMN IF NOT EXISTS villa_payment_type   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS transaction_flow     VARCHAR(20);

-- STEP 2: villa_payment_type — reservation-level (conf_code):
-- any "Complimentary Rental" / "HO Reservation" line makes the
-- whole stay Free, otherwise Paid.
UPDATE folios f
SET villa_payment_type = CASE
    WHEN EXISTS (
        SELECT 1
        FROM folios f2
        WHERE f2.conf_code = f.conf_code
          AND (
              f2.description ILIKE 'Complimentary Rental%'
           OR f2.description ILIKE 'HO Reservation%'
          )
    ) THEN 'Free'
    ELSE 'Paid'
END;

-- STEP 3: transaction_category — first match wins
UPDATE folios
SET transaction_category = CASE
    WHEN description ILIKE 'Reversal of%'
      OR description ILIKE 'Reversal of :%'
      THEN 'Reversal'
    WHEN description ILIKE 'Villa Rental%'
      OR description ILIKE 'Complimentary Rental%'
      OR description ILIKE 'HO Reservation%'
      THEN 'Villa'
    WHEN description ILIKE '%- Rooms payment'
      OR description ILIKE 'Paid by%payment'
      OR description ILIKE 'Cash - Rooms payment'
      OR description ILIKE 'Check - Rooms payment'
      OR description ILIKE 'Member Charge - Rooms payment'
      OR description ILIKE 'Paid by SECURITY DEPOSIT%'
      OR description ILIKE 'Paid by Villa Advance Deposit%'
      OR description ILIKE 'Admin Fee- Adjustment payment'
      OR description ILIKE 'Adj Misc. - Rooms payment'
      THEN 'Payment'
    WHEN description ILIKE '%Spa at Tryall%'
      OR description ILIKE 'Beauty Salon%'
      THEN 'Spa & Beauty'
    WHEN description ILIKE '%-Golf Shop%'
      OR description ILIKE '%-Beverage Cart%'
      THEN 'Golf'
    WHEN description ILIKE '%-Tennis Shop%'
      THEN 'Tennis'
    WHEN description ILIKE '%-Grill Bar%'
      OR description ILIKE '%-GH Bar%'
      OR description ILIKE '%-9H Bar%'
      OR description ILIKE '%-Beach Bar%'
      OR description ILIKE '%-Beach Resturant%'
      OR description ILIKE '%-Beach Restaurant%'
      OR description ILIKE '%-Beach Night Functions%'
      OR description ILIKE '%-Ooshan Restaurant%'
      OR description ILIKE '%-Ooshan Bar%'
      OR description ILIKE 'Commissary Charge%'
      OR description ILIKE 'Villa Wine Sales%'
      THEN 'F&B'
    WHEN description ILIKE '%-Tryall Boutique%'
      THEN 'Boutique'
    WHEN description ILIKE 'Transportation Guest%'
      THEN 'Transport'
    WHEN description ILIKE 'Cash Advance%'
      THEN 'Cash Advance'
    WHEN description ILIKE 'Cribs & Beds Rentals%'
      OR description ILIKE 'Dive Shop%'
      OR description ILIKE 'Dive Shope%'
      THEN 'Equipment'
    WHEN description ILIKE 'Temp Membership Fee%'
      THEN 'Membership'
    WHEN description ILIKE 'Miscellaneous Charge%'
      OR description ILIKE 'Adj Miscellaneous Charge%'
      THEN 'Adjustment'
    ELSE 'Other'
END;

-- STEP 4: transaction_flow
UPDATE folios
SET transaction_flow = CASE
    WHEN description ILIKE 'Reversal of%'
      THEN 'Reversal'
    WHEN transaction_category = 'Payment'
      THEN 'Payment'
    WHEN transaction_category = 'Villa'
     AND (
         amount = 0
      OR description ILIKE 'Complimentary Rental%'
      OR description ILIKE 'HO Reservation%'
     )
      THEN 'Comp'
    WHEN amount < 0
     AND transaction_category != 'Payment'
      THEN 'Comp'
    ELSE 'Charge'
END;

-- ============================================================
-- PATCH 1: categories discovered from 'Other' review
-- ============================================================
UPDATE folios
SET
    transaction_category = CASE
        WHEN description ILIKE 'RSL Boutique sales%'
            THEN 'Boutique'
        WHEN description ILIKE 'RSL Dive Shope Charge%'
          OR description ILIKE 'RSL Dive Shop Charge%'
          OR description ILIKE 'Island Routes Charge Guest%'
            THEN 'Water Sports'
        WHEN description ILIKE 'Transportation Cart Rental%'
            THEN 'Cart Rental'
        WHEN description ILIKE '%-GH Restaurant%'
          OR description ILIKE '%-Beach Grill%'
            THEN 'F&B'
        WHEN description ILIKE '%-Events-%'
            THEN 'Events'
        WHEN description ILIKE 'Laundry Charge%'
            THEN 'Laundry'
        ELSE transaction_category
    END,
    transaction_flow = CASE
        WHEN description ILIKE 'Reversal of%'
            THEN 'Reversal'
        WHEN amount < 0
         AND transaction_category != 'Payment'
            THEN 'Comp'
        ELSE transaction_flow
    END
WHERE transaction_category = 'Other';

-- ============================================================
-- PATCH 2: final stragglers
--   Paidout            -> Cash Advance (petty cash to guest)
--   -Banquet-          -> Events
--   Deposit from Old System -> Payment (legacy PMS migration)
-- ============================================================
UPDATE folios
SET
    transaction_category = CASE
        WHEN description ILIKE 'Paidout%'
            THEN 'Cash Advance'
        WHEN description ILIKE '%-Banquet%'
            THEN 'Events'
        WHEN description ILIKE 'Deposit from Old System%'
            THEN 'Payment'
        ELSE transaction_category
    END,
    transaction_flow = CASE
        WHEN description ILIKE 'Deposit from Old System%'
            THEN 'Payment'
        ELSE transaction_flow
    END
WHERE transaction_category = 'Other';

"""

# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1b — RATE DETAILS BACKFILL
# Fills columns the journal scraper couldn't populate from the popup:
#   bedroom_count       <- folios (by conf_code, then by villa_name)
#   reservation_status  <- rooms (by confirmation_code)
#   modified_amount     <- 0 where NULL (zeros were lost to a since-
#                          fixed clean_amount bug; a blank popup cell
#                          means 0 anyway)
# Idempotent — only touches NULLs.
# ═════════════════════════════════════════════════════════════════════
RATE_DETAILS_BACKFILL_SQL = r"""
-- bedroom_count SANITY RESET: clear implausible values so the chain
-- below re-derives them (e.g. 20264 parsed from the data-entry mash
-- 'Three Little Birds 20264BR' where '2026 4BR' lost its space).
UPDATE rate_details
SET bedroom_count = NULL, updated_at = NOW()
WHERE bedroom_count IS NOT NULL
  AND bedroom_count NOT BETWEEN 1 AND 12;

-- bedroom_count PRIORITY 0: parse the booked configuration straight
-- out of the row's own rate_name (e.g. 'Round House 7BR',
-- 'Vista Del Mar 2025 4BR - Shoulder 1') — this is the per-booking
-- truth, and the only source that reflects partial-buyout configs.
UPDATE rate_details
SET bedroom_count = (regexp_match(rate_name, '(?:^|[^0-9])([0-9]{1,2})\s*BR', 'i'))[1]::int,
    updated_at = NOW()
WHERE bedroom_count IS NULL
  AND rate_name ~* '(?:^|[^0-9])[0-9]{1,2}\s*BR'
  AND (regexp_match(rate_name, '(?:^|[^0-9])([0-9]{1,2})\s*BR', 'i'))[1]::int BETWEEN 1 AND 12;

-- PRIORITY 0b: rows with a blank rate_name inherit from their OWN
-- reservation's parsed value (conf-scoped only — never crosses into
-- other bookings of the same villa).
UPDATE rate_details rd
SET bedroom_count = c.bc, updated_at = NOW()
FROM (
    SELECT conf_code, MAX(bedroom_count) AS bc
    FROM rate_details
    WHERE bedroom_count IS NOT NULL
    GROUP BY conf_code
) c
WHERE rd.conf_code = c.conf_code
  AND rd.bedroom_count IS NULL;

-- bedroom_count PRIORITY 1: folios by conf_code — the per-reservation
-- truth (a villa can be booked at different bedroom configurations,
-- so the booking's own folio record beats any villa-level constant)
UPDATE rate_details rd
SET bedroom_count = f.bc, updated_at = NOW()
FROM (
    SELECT conf_code, MAX(bedroom_count) AS bc
    FROM folios
    WHERE bedroom_count IS NOT NULL
    GROUP BY conf_code
) f
WHERE rd.conf_code = f.conf_code
  AND rd.bedroom_count IS NULL;

-- reservation_status from the rooms table
UPDATE rate_details rd
SET reservation_status = r.status, updated_at = NOW()
FROM rooms r
WHERE r.confirmation_code = rd.conf_code
  AND r.status IS NOT NULL
  AND rd.reservation_status IS NULL;

-- modified_amount: NULL means 0 (blank popup cell / lost zero)
UPDATE rate_details
SET modified_amount = 0, updated_at = NOW()
WHERE modified_amount IS NULL;

-- bedroom_count PRIORITY 1b: a NON-BLANK rate_name with NO 'NBR'
-- marker is, by the club's naming convention, the 1-bedroom
-- configuration (e.g. plain 'Seaclusion' vs 'Seaclusion 7BR').
-- Blank rate_name rows are NOT touched here — those are genuinely
-- unknown and fall through to the manual map / room_lookup below.
UPDATE rate_details
SET bedroom_count = 1, updated_at = NOW()
WHERE bedroom_count IS NULL
  AND rate_name IS NOT NULL
  AND TRIM(rate_name) <> ''
  AND rate_name !~* '[0-9]+\s*BR';   -- any digits+BR (even malformed) disqualifies

-- bedroom_count PRIORITY 2: MANUAL villa mapping — edit these values
-- as needed; they win over room_lookup for any villa listed with a
-- number. Villas left as NULL::int are skipped (fall through to
-- room_lookup below).
UPDATE rate_details rd
SET bedroom_count = v.bc, updated_at = NOW()
FROM (VALUES
    ('Round House',    NULL::int),
    ('Vista Del Mar',  NULL::int),
    ('Seaclusion',     NULL::int),
    ('Skyline',        NULL::int),
    ('Hanover Grange', NULL::int),
    ('Clive House',    NULL::int),
    ('Sky High',       NULL::int),
    ('Bluebird',       NULL::int),
    ('Bali Hai',       NULL::int),
    ('Elysian Plain',  NULL::int),
    ('Infinity',       NULL::int),
    ('ZZ Comp',        1)          -- back-office placeholder, matches overview default
) AS v(villa_name, bc)
WHERE rd.villa_name = v.villa_name
  AND v.bc IS NOT NULL
  AND rd.bedroom_count IS NULL;

-- bedroom_count PRIORITY 3: room_lookup fallback (loaded from
-- room_lookup.csv by this script) — only reached when neither the
-- booking's folio nor the manual map supplied a value.
UPDATE rate_details rd
SET bedroom_count = v.bc, updated_at = NOW()
FROM (
    SELECT villa_name, MAX(bedroom_count) AS bc
    FROM room_lookup
    WHERE villa_name IS NOT NULL AND bedroom_count IS NOT NULL
    GROUP BY villa_name
) v
WHERE rd.villa_name = v.villa_name
  AND rd.bedroom_count IS NULL;
"""


# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 2 — OVERVIEW VIEWS
# ═════════════════════════════════════════════════════════════════════
VIEWS_SQL = r"""
-- ════════════════════════════════════════════════════════════════════════
-- overview_views.sql
--
-- Dedicated SQL views that back the OVERVIEW TAB ONLY.
-- Every view name is prefixed with `overview_`.
--
-- Run via overview_sql.py after every cleaner.py load (classification
-- runs first — overview_transaction_lines reads transaction_category).
--
-- overview_transaction_lines and overview_villa_bookings are
-- MATERIALIZED views — heavy netting/classification work happens once
-- at refresh, every query afterwards reads the precomputed result.
-- They are refreshed at the end of this file (transaction_lines FIRST,
-- villa_bookings depends on it).
-- ════════════════════════════════════════════════════════════════════════

-- Defensive drop: handles the object existing as either a plain VIEW or
-- a MATERIALIZED VIEW from a previous run. CASCADE also drops the
-- dependent summary views, all recreated below.
DO $$
BEGIN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS overview_transaction_lines CASCADE';
EXCEPTION WHEN wrong_object_type THEN
    EXECUTE 'DROP VIEW IF EXISTS overview_transaction_lines CASCADE';
END $$;

DO $$
BEGIN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS overview_villa_bookings CASCADE';
EXCEPTION WHEN wrong_object_type THEN
    EXECUTE 'DROP VIEW IF EXISTS overview_villa_bookings CASCADE';
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- overview_transaction_lines — ONE ROW PER NET LINE-ITEM PER BOOKING.
--
-- Charges + reversals are netted by (conf_code, description); payment
-- and abbreviated payment-reversal lines are excluded; the net amount
-- is then classified:
--   CashAdvance / Tip / InternalTransfer — not product/service revenue,
--     pulled out to their own statuses (see the summary views below)
--   Reversed — net $0 but something WAS charged (same-description
--     netting, or an unambiguous cross-description charge+reversal pair)
--   Paid (net > 0) / Free (net = 0, nothing ever charged) /
--   Anomaly (net < 0 with no clean reversal partner)
-- Category: Villa / Membership / Amenity (narrow keyword match — a broad
-- villa|room|rental match wrongly catches crib rentals, room key
-- deposits, etc).
-- overview_gross_charged_amount = sum of only the POSITIVE raw lines,
-- i.e. what was charged before any reversal — the only place the
-- original value survives for Reversed/Free lines.
-- ─────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW overview_transaction_lines AS
WITH overview_stripped_lines AS (
    -- Strip a leading "Reversal of" prefix BEFORE exclusions, so a
    -- reversal of a payment line is excluded like the payment itself.
    SELECT
        f.conf_code                                  AS overview_conf_code,
        f.villa_name                                  AS overview_villa_name,
        COALESCE(f.payment_type, 'Unknown')           AS overview_booking_payment_type,
        f.transaction_category                        AS overview_transaction_category,
        f.description                                 AS overview_raw_description,
        TRIM(
            REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')
        )                                              AS overview_stripped_description,
        f.amount                                       AS overview_amount,
        f.reservation_status                           AS overview_reservation_status
    FROM folios f
    WHERE f.conf_code IS NOT NULL
      AND f.description IS NOT NULL
),
overview_charge_lines AS (
    SELECT
        overview_conf_code,
        overview_villa_name,
        overview_booking_payment_type,
        overview_transaction_category,
        overview_stripped_description                  AS overview_line_description,
        CASE
            WHEN overview_stripped_description ILIKE 'Temp Membership Fee%'
            THEN 'Membership'
            WHEN overview_stripped_description ILIKE 'Villa Rental -%'
              OR overview_stripped_description ILIKE '%room rate%'
              OR overview_stripped_description ILIKE '%room portion%'
              OR overview_stripped_description ILIKE '%accommodation%'
              OR overview_stripped_description ILIKE 'Complimentary Rental%'
              OR overview_stripped_description ILIKE 'HO Reservation%'
            THEN 'Villa'
            ELSE 'Amenity'
        END                                              AS overview_line_category,
        overview_amount
    FROM overview_stripped_lines
    WHERE overview_stripped_description NOT ILIKE '%payment%'
      -- Abbreviated payment reversals drop the word "payment" entirely
      -- (e.g. "Reversal of Amex - Rooms"): "Rooms" + a payment-method
      -- word is the reliable signal.
      AND NOT (
        overview_stripped_description ILIKE '%rooms%'
        AND (
             overview_stripped_description ILIKE '%visa%'
          OR overview_stripped_description ILIKE '%mastercard%'
          OR overview_stripped_description ILIKE '%amex%'
          OR overview_stripped_description ILIKE '%discover%'
          OR overview_stripped_description ILIKE '%check%'
          OR overview_stripped_description ILIKE '%cash%'
          OR overview_stripped_description ILIKE '%bns%'
          OR overview_stripped_description ILIKE '%ncb%'
          OR overview_stripped_description ILIKE '%member charge%'
        )
      )
      AND COALESCE(LOWER(overview_reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
),
overview_netted_lines AS (
    SELECT
        overview_conf_code,
        MAX(overview_villa_name)                       AS overview_villa_name,
        MAX(overview_booking_payment_type)              AS overview_booking_payment_type,
        -- bool_or, not MAX(text): a group can contain both a Cash
        -- Advance row and a Reversal row; MAX picks alphabetically.
        bool_or(overview_transaction_category = 'Cash Advance') AS overview_is_cash_advance_category,
        overview_line_description,
        MAX(overview_line_category)                     AS overview_line_category,
        SUM(COALESCE(overview_amount, 0))               AS overview_net_amount,
        SUM(CASE WHEN overview_amount > 0 THEN overview_amount ELSE 0 END) AS overview_gross_charged_amount
    FROM overview_charge_lines
    GROUP BY overview_conf_code, overview_line_description
),
overview_amount_counts AS (
    -- One row per (booking, rounded amount): lets the pair-matching
    -- below check amount-uniqueness with a join instead of O(n²)
    -- correlated subqueries (which timed out at production volume).
    SELECT
        overview_conf_code,
        ROUND(overview_net_amount::numeric, 2) AS overview_rounded_amount,
        COUNT(*) AS overview_amount_count
    FROM overview_netted_lines
    GROUP BY overview_conf_code, ROUND(overview_net_amount::numeric, 2)
),
overview_reversal_pairs AS (
    -- Cross-description charge+reversal pairs: same booking, exact
    -- opposite amounts, MUTUALLY unique on both sides — ambiguous
    -- multi-candidate amounts are deliberately left as Anomaly.
    SELECT
        neg.overview_conf_code,
        neg.overview_line_description AS overview_negative_desc,
        pos.overview_line_description AS overview_positive_desc
    FROM overview_netted_lines neg
    JOIN overview_amount_counts neg_match
      ON neg_match.overview_conf_code = neg.overview_conf_code
     AND neg_match.overview_rounded_amount = ROUND(-1 * neg.overview_net_amount::numeric, 2)
     AND neg_match.overview_amount_count = 1
    JOIN overview_netted_lines pos
      ON pos.overview_conf_code = neg.overview_conf_code
     AND ROUND(pos.overview_net_amount::numeric, 2) = ROUND(-1 * neg.overview_net_amount::numeric, 2)
    JOIN overview_amount_counts pos_match
      ON pos_match.overview_conf_code = pos.overview_conf_code
     AND pos_match.overview_rounded_amount = ROUND(-1 * pos.overview_net_amount::numeric, 2)
     AND pos_match.overview_amount_count = 1
    WHERE neg.overview_net_amount < 0
),
overview_reversed_descriptions AS (
    SELECT overview_conf_code, overview_negative_desc AS overview_line_description
    FROM overview_reversal_pairs
    UNION
    SELECT overview_conf_code, overview_positive_desc AS overview_line_description
    FROM overview_reversal_pairs
)
SELECT
    nl.overview_conf_code,
    nl.overview_villa_name,
    nl.overview_booking_payment_type,
    nl.overview_line_description,
    nl.overview_line_category,
    nl.overview_net_amount,
    CASE
        WHEN nl.overview_line_description ILIKE '%cash advance%'
          OR nl.overview_is_cash_advance_category
        THEN 'CashAdvance'
        WHEN nl.overview_line_description ILIKE '%staff tip%' THEN 'Tip'
        WHEN nl.overview_line_description ILIKE '%folio%'
          OR nl.overview_line_description ~* 'from v[0-9]+|to v[0-9]+'
        THEN 'InternalTransfer'
        WHEN rd.overview_line_description IS NOT NULL THEN 'Reversed'
        -- net $0 but something WAS charged = correction, not a giveaway
        WHEN nl.overview_net_amount = 0 AND nl.overview_gross_charged_amount > 0 THEN 'Reversed'
        WHEN nl.overview_net_amount > 0 THEN 'Paid'
        WHEN nl.overview_net_amount = 0 THEN 'Free'
        ELSE 'Anomaly'
    END AS overview_line_status,
    nl.overview_gross_charged_amount
FROM overview_netted_lines nl
LEFT JOIN overview_reversed_descriptions rd
  ON rd.overview_conf_code = nl.overview_conf_code
 AND rd.overview_line_description = nl.overview_line_description;

-- Non-unique (duplicate charge-line issue) — upgrade to UNIQUE once fixed.
CREATE INDEX overview_transaction_lines_conf_code_idx
    ON overview_transaction_lines (overview_conf_code, overview_line_description);

-- ─────────────────────────────────────────────────────────────────────────
-- Rollup views over overview_transaction_lines — each status excluded
-- from Paid/Free revenue elsewhere gets one visible home here.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_reversals_summary AS
SELECT
    COUNT(*)                                     AS overview_reversed_count,
    COALESCE(SUM(overview_gross_charged_amount), 0) AS overview_reversed_total
FROM overview_transaction_lines
WHERE overview_line_status = 'Reversed'
  AND overview_gross_charged_amount > 0;

CREATE OR REPLACE VIEW overview_reversals_by_category_summary AS
SELECT
    overview_line_category                          AS overview_category,
    COUNT(*)                                         AS overview_reversed_count,
    COALESCE(SUM(overview_gross_charged_amount), 0)  AS overview_reversed_total
FROM overview_transaction_lines
WHERE overview_line_status = 'Reversed'
  AND overview_gross_charged_amount > 0
GROUP BY overview_line_category;

CREATE OR REPLACE VIEW overview_cash_advance_summary AS
SELECT
    COUNT(*)                              AS overview_cash_advance_count,
    COALESCE(SUM(overview_net_amount), 0) AS overview_cash_advance_total
FROM overview_transaction_lines
WHERE overview_line_status = 'CashAdvance';

CREATE OR REPLACE VIEW overview_anomalies_summary AS
SELECT
    COUNT(*)                              AS overview_anomaly_count,
    COALESCE(SUM(overview_net_amount), 0) AS overview_anomaly_total
FROM overview_transaction_lines
WHERE overview_line_status = 'Anomaly';

CREATE OR REPLACE VIEW overview_tips_summary AS
SELECT
    COUNT(*)                              AS overview_tip_count,
    COALESCE(SUM(overview_net_amount), 0) AS overview_tip_total
FROM overview_transaction_lines
WHERE overview_line_status = 'Tip';

CREATE OR REPLACE VIEW overview_internal_transfers_summary AS
SELECT
    COUNT(*)                              AS overview_internal_transfer_count,
    COALESCE(SUM(overview_net_amount), 0) AS overview_internal_transfer_total
FROM overview_transaction_lines
WHERE overview_line_status = 'InternalTransfer';

-- ─────────────────────────────────────────────────────────────────────────
-- Payments — queried from folios directly (payment lines never enter the
-- charge pipeline; they're settlements, not charges).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_payments_summary AS
SELECT
    COUNT(*)                AS overview_payments_count,
    COALESCE(SUM(f.amount), 0) AS overview_payments_total
FROM folios f
WHERE f.conf_code IS NOT NULL
  AND f.description IS NOT NULL
  AND TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%payment%';

CREATE OR REPLACE VIEW overview_payment_corrections_summary AS
SELECT
    COUNT(*)                   AS overview_payment_correction_count,
    COALESCE(SUM(f.amount), 0) AS overview_payment_correction_total
FROM folios f
WHERE f.conf_code IS NOT NULL
  AND f.description IS NOT NULL
  AND TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) NOT ILIKE '%payment%'
  AND TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%rooms%'
  AND (
       TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%visa%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%mastercard%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%amex%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%discover%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%check%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%cash%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%bns%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%ncb%'
    OR TRIM(REGEXP_REPLACE(f.description, '^\s*reversal\s+of\s*:?\s*', '', 'i')) ILIKE '%member charge%'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- overview_booking_meta — lightweight booking-level view (dates/metadata
-- only, NO revenue column, NO dependency on overview_transaction_lines).
-- Use for date-filter joins; use overview_villa_bookings only when
-- overview_villa_revenue is actually needed.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_booking_meta AS
SELECT
    f.conf_code                                    AS overview_conf_code,
    MAX(f.villa_name)                               AS overview_villa_name,
    COALESCE(MAX(f.bedroom_count), 1)               AS overview_bedroom_count,
    COALESCE(MAX(f.payment_type), 'Unknown')        AS overview_payment_type,
    MAX(f.member_number)                            AS overview_member_number,
    MAX(m.member_or_guest)                          AS overview_member_or_guest,
    MAX(f.persons)                                  AS overview_persons,
    MIN(f.check_in_date)                            AS overview_check_in_date,
    MAX(f.check_out_date)                           AS overview_check_out_date,
    MAX(f.check_out_date - f.check_in_date)         AS overview_nights
FROM folios f
LEFT JOIN members m
    ON m.member_number = f.member_number
WHERE f.conf_code IS NOT NULL
  AND f.villa_name IS NOT NULL
  AND f.check_in_date IS NOT NULL
  AND f.check_out_date IS NOT NULL
  AND COALESCE(LOWER(f.reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
GROUP BY f.conf_code;

-- ─────────────────────────────────────────────────────────────────────────
-- overview_villa_bookings — one row per booking, with NETTED villa
-- revenue sourced from overview_transaction_lines (Villa category, Paid
-- status) so charge+reversal pairs don't double-count.
-- ─────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW overview_villa_bookings AS
WITH overview_booking_base AS (
    SELECT
        f.conf_code                                    AS overview_conf_code,
        MAX(f.villa_name)                               AS overview_villa_name,
        COALESCE(MAX(f.bedroom_count), 1)               AS overview_bedroom_count,
        COALESCE(MAX(f.payment_type), 'Unknown')        AS overview_payment_type,
        MAX(f.member_number)                            AS overview_member_number,
        MAX(m.member_or_guest)                          AS overview_member_or_guest,
        MAX(f.persons)                                  AS overview_persons,
        MIN(f.check_in_date)                            AS overview_check_in_date,
        MAX(f.check_out_date)                           AS overview_check_out_date,
        MAX(f.check_out_date - f.check_in_date)         AS overview_nights
    FROM folios f
    LEFT JOIN members m
        ON m.member_number = f.member_number
    WHERE f.conf_code IS NOT NULL
      AND f.villa_name IS NOT NULL
      AND f.check_in_date IS NOT NULL
      AND f.check_out_date IS NOT NULL
      AND COALESCE(LOWER(f.reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
    GROUP BY f.conf_code
),
overview_booking_villa_revenue AS (
    SELECT
        overview_conf_code,
        SUM(overview_net_amount) AS overview_villa_revenue
    FROM overview_transaction_lines
    WHERE overview_line_category = 'Villa'
      AND overview_line_status = 'Paid'
    GROUP BY overview_conf_code
)
SELECT
    b.overview_conf_code,
    b.overview_villa_name,
    b.overview_bedroom_count,
    b.overview_payment_type,
    b.overview_member_number,
    b.overview_member_or_guest,
    b.overview_persons,
    b.overview_check_in_date,
    b.overview_check_out_date,
    b.overview_nights,
    COALESCE(v.overview_villa_revenue, 0) AS overview_villa_revenue
FROM overview_booking_base b
LEFT JOIN overview_booking_villa_revenue v
    ON v.overview_conf_code = b.overview_conf_code;

CREATE UNIQUE INDEX overview_villa_bookings_pk
    ON overview_villa_bookings (overview_conf_code);

-- ─────────────────────────────────────────────────────────────────────────
-- Member rollups
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_member_status AS
SELECT
    status                                                       AS overview_status,
    COUNT(*) FILTER (WHERE member_or_guest = 'Member')           AS overview_members,
    COUNT(*) FILTER (WHERE member_or_guest = 'Guest')             AS overview_guests,
    COUNT(*)                                                      AS overview_total
FROM members
WHERE status IS NOT NULL
GROUP BY status;

CREATE OR REPLACE VIEW overview_member_type AS
SELECT
    member_type    AS overview_member_type,
    COUNT(*)        AS overview_total
FROM members
WHERE member_type IS NOT NULL
GROUP BY member_type;

-- ─────────────────────────────────────────────────────────────────────────
-- overview_statements_summary
--
-- FIXED 2026-07-12: amount_due is a RUNNING BALANCE per statement period
-- (balance forward + that month's activity), so summing every period
-- multiplied each member's balance by their number of periods. The
-- correct "total amount due" is the sum of each member's LATEST
-- statement balance only. Scope note: statements now contain the
-- Homeowner receivable type only, periods due 2025-01-01+ — this figure
-- means "net Homeowner receivables", not club-wide dues.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_statements_summary AS
SELECT COALESCE(SUM(amount_due), 0) AS overview_total_amount_due
FROM (
    SELECT DISTINCT ON (member_number, receivable_type)
           amount_due
    FROM statements
    WHERE amount_due IS NOT NULL
    ORDER BY member_number, receivable_type, due_date DESC
) latest;

-- Balance outstanding as of each period (a trend, NOT additive across
-- periods — each value is that period's running balance).
CREATE OR REPLACE VIEW overview_statements_by_period AS
SELECT
    statement_period            AS overview_statement_period,
    SUM(amount_due)              AS overview_total
FROM statements
WHERE statement_period IS NOT NULL
GROUP BY statement_period;

CREATE OR REPLACE VIEW overview_dependents_summary AS
SELECT
    COUNT(*)    AS overview_total_dependents
FROM dependents;

-- ─────────────────────────────────────────────────────────────────────────
-- rate_details_with_discount — recreated here with the actuals-only
-- filter (also updated in cleaner.py's DDL; both definitions match).
-- Future/unposted nights stay in the raw rate_details table but are
-- excluded from every derived figure.
-- ─────────────────────────────────────────────────────────────────────────
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
FROM rate_details rd
WHERE rd.rate_date <= CURRENT_DATE
  AND COALESCE(NULLIF(TRIM(rd.status), ''), 'Posted') = 'Posted';

-- ─────────────────────────────────────────────────────────────────────────
-- overview_villa_rack_rate_free — total rack-rate value of nights given
-- away on Free bookings, per villa. Actuals-only filtering is inherited
-- from rate_details_with_discount above.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW overview_villa_rack_rate_free AS
SELECT
    villa_name                          AS overview_villa_name,
    COALESCE(SUM(rack_rate), 0)         AS overview_rack_rate_total,
    COUNT(DISTINCT conf_code)            AS overview_free_bookings
FROM rate_details_with_discount
WHERE payment_type = 'Free'
  AND villa_name IS NOT NULL
GROUP BY villa_name;

-- ─────────────────────────────────────────────────────────────────────────
-- Populate the materialized views (transaction_lines FIRST).
-- ─────────────────────────────────────────────────────────────────────────
REFRESH MATERIALIZED VIEW overview_transaction_lines;
REFRESH MATERIALIZED VIEW overview_villa_bookings;

"""


def load_room_lookup(conn):
    """Load room_lookup.csv into a room_lookup table (villa -> bedroom
    count, room type ids). The table is ALWAYS created (even empty) so
    the backfill SQL can reference it safely when the CSV is absent."""
    import csv as _csv

    csv_path = next((p for p in ROOM_LOOKUP_CANDIDATES if os.path.exists(p)), None)

    rows = []
    if csv_path:
        with open(csv_path, newline="", encoding="utf-8") as f:
            rows = [r for r in _csv.DictReader(f) if r.get("room_number")]
    else:
        print("  WARNING: room_lookup.csv not found — bedroom backfill will")
        print("  rely on the other sources only. Searched:")
        for p in ROOM_LOOKUP_CANDIDATES:
            print(f"    {p}")

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS room_lookup (
                room_number   VARCHAR(50) PRIMARY KEY,
                villa_name    VARCHAR(255),
                display_name  VARCHAR(255),
                max_persons   INTEGER,
                bedroom_count INTEGER,
                room_id       VARCHAR(50),
                room_type_id  VARCHAR(50)
            )
        """)
        for r in rows:
            cur.execute("""
                INSERT INTO room_lookup
                    (room_number, villa_name, display_name, max_persons,
                     bedroom_count, room_id, room_type_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (room_number) DO UPDATE SET
                    villa_name = EXCLUDED.villa_name,
                    display_name = EXCLUDED.display_name,
                    max_persons = EXCLUDED.max_persons,
                    bedroom_count = EXCLUDED.bedroom_count,
                    room_id = EXCLUDED.room_id,
                    room_type_id = EXCLUDED.room_type_id
            """, (
                r.get("room_number"), r.get("villa_name"),
                r.get("display_name"),
                int(r["max_persons"]) if r.get("max_persons") else None,
                int(r["bedroom_count"]) if r.get("bedroom_count") else None,
                r.get("room_id"), r.get("room_type_id"),
            ))
    conn.commit()
    if rows:
        print(f"  room_lookup: {len(rows)} rooms loaded from {csv_path}")


def run_sql(conn, sql, label):
    """Execute a multi-statement SQL block as one command."""
    print(f"Running {label} ...")
    start = time.time()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print(f"  {label} done in {time.time() - start:.1f}s")


def run_statements(conn, statements, label):
    print(f"Running {label} ...")
    start = time.time()
    with conn.cursor() as cur:
        for stmt in statements:
            print(f"  {stmt.strip().rstrip(';')}")
            cur.execute(stmt)
    conn.commit()
    print(f"  {label} done in {time.time() - start:.1f}s")


def verify(conn):
    """Print the key verification numbers after a run."""
    checks = [
        ("villa_payment_type distribution",
         "SELECT villa_payment_type, COUNT(*) FROM folios "
         "GROUP BY villa_payment_type ORDER BY 2 DESC"),
        ("transaction_flow distribution",
         "SELECT transaction_flow, COUNT(*), ROUND(SUM(amount)::numeric, 2) "
         "FROM folios GROUP BY transaction_flow ORDER BY 2 DESC"),
        ("transaction_category distribution",
         "SELECT transaction_category, COUNT(*), ROUND(SUM(amount)::numeric, 2) "
         "FROM folios GROUP BY transaction_category ORDER BY 2 DESC"),
        ("UNCLASSIFIED ('Other') rows — should be 0",
         "SELECT COUNT(*) FROM folios WHERE transaction_category = 'Other'"),
        ("rate_details rows still missing bedroom_count",
         "SELECT COUNT(*) FROM rate_details WHERE bedroom_count IS NULL"),
        ("rate_details rows with IMPLAUSIBLE bedroom_count (should be 0)",
         "SELECT COUNT(*) FROM rate_details "
         "WHERE bedroom_count IS NOT NULL AND bedroom_count NOT BETWEEN 1 AND 12"),
        ("overview_transaction_lines rows",
         "SELECT COUNT(*) FROM overview_transaction_lines"),
        ("overview_villa_bookings rows",
         "SELECT COUNT(*) FROM overview_villa_bookings"),
        ("line status distribution",
         "SELECT overview_line_status, COUNT(*), "
         "ROUND(SUM(overview_net_amount)::numeric, 2) "
         "FROM overview_transaction_lines GROUP BY 1 ORDER BY 2 DESC"),
    ]

    print()
    print("=" * 60)
    print("Verification")
    print("=" * 60)
    for label, query in checks:
        try:
            with conn.cursor() as cur:
                cur.execute(query)
                rows = cur.fetchall()
            print(f"\n  {label}:")
            for row in rows:
                print("    " + "  |  ".join(str(v) for v in row))
        except Exception as e:
            conn.rollback()
            print(f"\n  {label}: skipped ({e})")

    # Any 'Other' rows left need new patterns added to CLASSIFICATION_SQL
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT description, COUNT(*) FROM folios "
                "WHERE transaction_category = 'Other' "
                "GROUP BY description ORDER BY 2 DESC LIMIT 20"
            )
            others = cur.fetchall()
        if others:
            print("\n  NEW UNCLASSIFIED DESCRIPTIONS (add patterns for these):")
            for desc, n in others:
                print(f"    {n:>5}x  {desc[:90]}")
    except Exception:
        conn.rollback()


def main():
    parser = argparse.ArgumentParser(
        description="Run folio classification + overview views SQL against Postgres."
    )
    parser.add_argument("--classify-only", action="store_true",
                        help="Only run the folio classification block")
    parser.add_argument("--views-only", action="store_true",
                        help="Only run the overview views block")
    parser.add_argument("--refresh-only", action="store_true",
                        help="Only refresh the two materialized views")
    parser.add_argument("--no-verify", action="store_true",
                        help="Skip the verification queries at the end")
    args = parser.parse_args()

    print("=" * 60)
    print("Overview SQL Runner")
    print("=" * 60)
    print(f"Database: {DB_CONFIG['database']} @ {DB_CONFIG['host']}")
    print()

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        print("Connected.")
    except Exception as e:
        print(f"ERROR: could not connect: {e}")
        sys.exit(1)

    try:
        if args.refresh_only:
            run_statements(conn, REFRESH_STATEMENTS, "materialized view refresh")
        else:
            if not args.views_only:
                run_sql(conn, CLASSIFICATION_SQL, "folio classification")
                load_room_lookup(conn)
                run_sql(conn, RATE_DETAILS_BACKFILL_SQL, "rate details backfill")
            if not args.classify_only:
                # VIEWS_SQL ends with the two REFRESH statements,
                # so a full run leaves the matviews current.
                run_sql(conn, VIEWS_SQL, "overview views")
            if args.classify_only:
                # Classification changed the data the matviews are
                # built from — refresh them so they pick it up.
                run_statements(conn, REFRESH_STATEMENTS, "materialized view refresh")

        if not args.no_verify:
            verify(conn)

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        sys.exit(1)
    finally:
        conn.close()

    print()
    print("=" * 60)
    print("Done")
    print("=" * 60)


if __name__ == "__main__":
    main()