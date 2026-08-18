"""
overview_sql.py — Run the post-load SQL from VS Code instead of the
Supabase SQL editor. Fully self-contained: every SQL block is embedded
below as constants — no separate .sql files needed.

Runs, in order:
  1. CLASSIFICATION_SQL      — adds/populates villa_payment_type,
                               transaction_category, transaction_flow on folios
  1b. RATE_DETAILS_BACKFILL  — bedroom_count / reservation_status backfill
  1c. STATEMENT_SPEND_SQL    — statement_details classification views:
                               statement_amenity_lines, member_statement_spend,
                               statement_villa_income_summary
  1d. UNIFIED_SQL            — villa_owner_map, the three synthetic folio
                               sources, and folios_unified (the complete
                               charge ledger the overview views now read)
  2. VIEWS_SQL               — (re)creates every overview_* view and
                               refreshes the two materialized views

Run this AFTER every cleaner.py load — new folios rows arrive with NULL
classification columns, and the materialized views are frozen until
refreshed. Everything is idempotent; re-running is always safe.

UNIFIED LEDGER (added 2026-07-16): overview_transaction_lines,
overview_villa_bookings, and overview_booking_meta now read from
folios_unified instead of folios — journal folio lines PLUS:
  synthetic_rate           villa rental lines rebuilt from rate_details
                           for the ~200 reservations that never got a
                           folio (Posted lines = charged-to-date, ties
                           to real folios to the penny where both exist)
  synthetic_statement      member amenity spend from statements,
                           attributed to stays via the rooms table
  synthetic_villa_income   rental-programme payouts to villa owners
                           ("Villa Income" credits on homeowner
                           statements), injected as Villa charge lines so
                           they land in the existing Villa slot on every
                           transaction-level card. EXCLUDED from
                           overview_villa_bookings on purpose — a monthly
                           payout is not a booking, and letting it in
                           would fabricate ~230 bookings/yr and a month
                           of room-nights each, corrupting booking
                           counts, ADR, and avg stay.
Payments views/endpoints stay on plain `folios` — synthetic rows contain
no settlement lines, nothing to gain.

When new unclassified descriptions show up in the verification output,
add patterns for them inside CLASSIFICATION_SQL below (Step 3's CASE or
the patch sections).

Usage:
    python overview_sql.py                 # everything (default)
    python overview_sql.py --classify-only # just folio classification
    python overview_sql.py --views-only    # statement/unified/overview views only
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
    # Order matters: villa_bookings reads from transaction_lines;
    # booking_meta is independent of both.
    "REFRESH MATERIALIZED VIEW overview_booking_meta;",
    "REFRESH MATERIALIZED VIEW overview_transaction_lines;",
    "REFRESH MATERIALIZED VIEW overview_villa_bookings;",
]

# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1 — FOLIO CLASSIFICATION            (unchanged)
# ═════════════════════════════════════════════════════════════════════

CLASSIFICATION_SQL = r"""
-- ============================================================
-- FOLIO CLASSIFICATION  (single-pass, 2026-08-13)
-- Populates 3 columns on folios:
--   villa_payment_type   -> was the STAY free or paid?
--   transaction_category -> what TYPE of spend is this?
--   transaction_flow     -> Charge / Payment / Reversal / Comp
--
-- Rewritten from five UPDATEs to one. The old version rewrote every
-- row three times per run with no WHERE clause, generating ~150 MB of
-- dead tuples each time and eventually filling the instance.
--
-- Idempotent AND cheap: the IS DISTINCT FROM guard at the bottom means
-- a re-run with no new folios rows updates zero rows.
--
-- To pick up a NEW pattern added to the CASE below, null the affected
-- rows first (targeted, never the whole table):
--     UPDATE folios SET transaction_category = NULL
--     WHERE description ILIKE '%your new pattern%';
-- ============================================================
 
-- STEP 1: columns. Metadata-only in PG11+, costs nothing.
ALTER TABLE folios
    ADD COLUMN IF NOT EXISTS villa_payment_type   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS transaction_flow     VARCHAR(20);
 
-- STEP 2: everything else, in one pass.
--
-- [2026-08-13] RESTRUCTURED — the original version of this rewrite used
-- `UPDATE folios f ... FROM pay_map p, LATERAL (...) c, LATERAL (...) fl`
-- with the LATERAL subqueries referencing f.description / f.amount. That
-- fails: "invalid reference to FROM-clause entry for table f" — the
-- UPDATE target is not visible inside a LATERAL subquery in its own FROM
-- list, only in the top-level SET/WHERE. Fixed by computing cat/flow in
-- CTEs over an independently-aliased read of folios (`src`), then joining
-- the real UPDATE target back to that by folio_key (verified unique and
-- NOT NULL across all 162k rows). Same logic, same branch order, same
-- IS DISTINCT FROM guard — only the join mechanics changed.
WITH pay_map AS (
    -- Reservation-level: any "Complimentary Rental" / "HO Reservation"
    -- line makes the whole stay Free. Rows with no conf_code stay
    -- 'Paid', matching what the old correlated EXISTS returned.
    SELECT
        COALESCE(conf_code, '__NULL__') AS ck,
        CASE
            WHEN COALESCE(conf_code, '__NULL__') <> '__NULL__'
             AND bool_or(
                     description ILIKE 'Complimentary Rental%'
                  OR description ILIKE 'HO Reservation%'
                 )
            THEN 'Free'
            ELSE 'Paid'
        END AS pay
    FROM folios
    GROUP BY COALESCE(conf_code, '__NULL__')
),
classified AS (
    SELECT
        src.folio_key,
        src.description,
        src.amount,
        pm.pay,
        CASE
            -- ---- main classification, first match wins ----
            WHEN src.description ILIKE 'Reversal of%'
              OR src.description ILIKE 'Reversal of :%'
                THEN 'Reversal'
            WHEN src.description ILIKE 'Villa Rental%'
              OR src.description ILIKE 'Complimentary Rental%'
              OR src.description ILIKE 'HO Reservation%'
                THEN 'Villa'
            WHEN src.description ILIKE '%- Rooms payment'
              OR src.description ILIKE 'Paid by%payment'
              OR src.description ILIKE 'Cash - Rooms payment'
              OR src.description ILIKE 'Check - Rooms payment'
              OR src.description ILIKE 'Member Charge - Rooms payment'
              OR src.description ILIKE 'Paid by SECURITY DEPOSIT%'
              OR src.description ILIKE 'Paid by Villa Advance Deposit%'
              OR src.description ILIKE 'Admin Fee- Adjustment payment'
              OR src.description ILIKE 'Adj Misc. - Rooms payment'
                THEN 'Payment'
            WHEN src.description ILIKE '%Spa at Tryall%'
              OR src.description ILIKE 'Beauty Salon%'
                THEN 'Spa & Beauty'
            WHEN src.description ILIKE '%-Golf Shop%'
              OR src.description ILIKE '%-Beverage Cart%'
                THEN 'Golf'
            WHEN src.description ILIKE '%-Tennis Shop%'
                THEN 'Tennis'
            WHEN src.description ILIKE '%-Grill Bar%'
              OR src.description ILIKE '%-GH Bar%'
              OR src.description ILIKE '%-9H Bar%'
              OR src.description ILIKE '%-Beach Bar%'
              OR src.description ILIKE '%-Beach Resturant%'
              OR src.description ILIKE '%-Beach Restaurant%'
              OR src.description ILIKE '%-Beach Night Functions%'
              OR src.description ILIKE '%-Ooshan Restaurant%'
              OR src.description ILIKE '%-Ooshan Bar%'
              OR src.description ILIKE 'Commissary Charge%'
              OR src.description ILIKE 'Villa Wine Sales%'
                THEN 'F&B'
            WHEN src.description ILIKE '%-Tryall Boutique%'
                THEN 'Boutique'
            WHEN src.description ILIKE 'Transportation Guest%'
                THEN 'Transport'
            WHEN src.description ILIKE 'Cash Advance%'
                THEN 'Cash Advance'
            WHEN src.description ILIKE 'Cribs & Beds Rentals%'
              OR src.description ILIKE 'Dive Shop%'
              OR src.description ILIKE 'Dive Shope%'
                THEN 'Equipment'
            WHEN src.description ILIKE 'Temp Membership Fee%'
                THEN 'Membership'
            WHEN src.description ILIKE 'Miscellaneous Charge%'
              OR src.description ILIKE 'Adj Miscellaneous Charge%'
                THEN 'Adjustment'

            -- ---- was PATCH 1: found in 'Other' review ----
            WHEN src.description ILIKE 'RSL Boutique sales%'
                THEN 'Boutique'
            WHEN src.description ILIKE 'RSL Dive Shope Charge%'
              OR src.description ILIKE 'RSL Dive Shop Charge%'
              OR src.description ILIKE 'Island Routes Charge Guest%'
                THEN 'Water Sports'
            WHEN src.description ILIKE 'Transportation Cart Rental%'
                THEN 'Cart Rental'
            WHEN src.description ILIKE '%-GH Restaurant%'
              OR src.description ILIKE '%-Beach Grill%'
                THEN 'F&B'
            WHEN src.description ILIKE '%-Events-%'
                THEN 'Events'
            WHEN src.description ILIKE 'Laundry Charge%'
                THEN 'Laundry'

            -- ---- was PATCH 2: final stragglers ----
            WHEN src.description ILIKE 'Paidout%'
                THEN 'Cash Advance'
            WHEN src.description ILIKE '%-Banquet%'
                THEN 'Events'
            WHEN src.description ILIKE 'Deposit from Old System%'
                THEN 'Payment'

            ELSE 'Other'
        END AS cat
    FROM folios src
    JOIN pay_map pm ON COALESCE(src.conf_code, '__NULL__') = pm.ck
),
flowed AS (
    SELECT
        cl.folio_key,
        cl.pay,
        cl.cat,
        -- Arm order is load-bearing: 'Payment' must be tested before
        -- 'amount < 0', or refunds against payment lines become 'Comp'.
        CASE
            WHEN cl.description ILIKE 'Reversal of%'
                THEN 'Reversal'
            WHEN cl.cat = 'Payment'
                THEN 'Payment'
            WHEN cl.cat = 'Villa'
             AND (
                 cl.amount = 0
              OR cl.description ILIKE 'Complimentary Rental%'
              OR cl.description ILIKE 'HO Reservation%'
             )
                THEN 'Comp'
            WHEN cl.amount < 0
             AND cl.cat <> 'Payment'
                THEN 'Comp'
            ELSE 'Charge'
        END AS flow
    FROM classified cl
)
UPDATE folios f
SET villa_payment_type   = fl.pay,
    transaction_category = fl.cat,
    transaction_flow     = fl.flow
FROM flowed fl
WHERE f.folio_key = fl.folio_key
  AND (
        f.villa_payment_type   IS DISTINCT FROM fl.pay
     OR f.transaction_category IS DISTINCT FROM fl.cat
     OR f.transaction_flow     IS DISTINCT FROM fl.flow
  );
"""

# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1b — RATE DETAILS BACKFILL          (unchanged)
# ═════════════════════════════════════════════════════════════════════
RATE_DETAILS_BACKFILL_SQL = r"""
-- ============================================================
-- payment_type BACKFILL (added 2026-07-18)
-- journal_scraper.py writes rate rows with "Payment Type": "" — only
-- the older standalone scrape_rate_revenue.py files ever carried it.
-- So Paid/Free filters on rate_details returned nothing, and the
-- overview Paid/Free toggle showed almost everything as Unknown.
-- The business source determines it (same mapping cleaner.py applies
-- to folios); reservations whose source isn't in business_source fall
-- back to the folio-side villa_payment_type for the same conf code.
-- ============================================================
UPDATE rate_details rd
SET payment_type = bs.payment_type, updated_at = NOW()
FROM business_source bs
WHERE bs.payment_type IS NOT NULL
  AND rd.source IS NOT NULL
  AND (LOWER(TRIM(rd.source)) = LOWER(TRIM(bs.source_name))
       OR LOWER(TRIM(split_part(rd.source, ' - ', 1)))
            = LOWER(TRIM(split_part(bs.source_name, ' - ', 1))))
  AND (rd.payment_type IS NULL OR TRIM(rd.payment_type) = '');

UPDATE rate_details rd
SET payment_type = f.villa_payment_type, updated_at = NOW()
FROM (
    SELECT conf_code::text AS conf_code,
           MAX(villa_payment_type) AS villa_payment_type
    FROM folios
    WHERE villa_payment_type IS NOT NULL
    GROUP BY 1
) f
WHERE rd.conf_code::text = f.conf_code
  AND (rd.payment_type IS NULL OR TRIM(rd.payment_type) = '');

-- bedroom_count SANITY RESET: clear implausible values so the chain
-- below re-derives them.
UPDATE rate_details
SET bedroom_count = NULL, updated_at = NOW()
WHERE bedroom_count IS NOT NULL
  AND bedroom_count NOT BETWEEN 1 AND 12;

-- bedroom_count PRIORITY 0: parse from the row's own rate_name.
UPDATE rate_details
SET bedroom_count = (regexp_match(rate_name, '(?:^|[^0-9])([0-9]{1,2})\s*BR', 'i'))[1]::int,
    updated_at = NOW()
WHERE bedroom_count IS NULL
  AND rate_name ~* '(?:^|[^0-9])[0-9]{1,2}\s*BR'
  AND (regexp_match(rate_name, '(?:^|[^0-9])([0-9]{1,2})\s*BR', 'i'))[1]::int BETWEEN 1 AND 12;

-- PRIORITY 0b: blank rate_name rows inherit from their OWN reservation.
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

-- PRIORITY 1: folios by conf_code.
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

-- modified_amount: NULL means 0
UPDATE rate_details
SET modified_amount = 0, updated_at = NOW()
WHERE modified_amount IS NULL;

-- PRIORITY 1b: non-blank rate_name with no 'NBR' marker = 1-bedroom.
UPDATE rate_details
SET bedroom_count = 1, updated_at = NOW()
WHERE bedroom_count IS NULL
  AND rate_name IS NOT NULL
  AND TRIM(rate_name) <> ''
  AND rate_name !~* '[0-9]+\s*BR';

-- PRIORITY 2: MANUAL villa mapping.
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
    ('ZZ Comp',        1)
) AS v(villa_name, bc)
WHERE rd.villa_name = v.villa_name
  AND v.bc IS NOT NULL
  AND rd.bedroom_count IS NULL;

-- PRIORITY 3: room_lookup fallback.
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

-- ============================================================
-- VILLA NAME NORMALIZATION (added 2026-07-16)
-- Fix abbreviated/mistyped villa names in the BASE tables so every
-- consumer agrees — overview bookings, transaction lines, rack-rate
-- views, and villa_owner_map (which has its own copy of this list;
-- keep the two lists in sync). Idempotent: new scraped rows with the
-- bad spelling get re-fixed on every run. Add rows as discovered.
-- ============================================================
UPDATE folios f
SET villa_name = v.correct_name, updated_at = NOW()
FROM (VALUES
    ('inf', 'Infinity')
) AS v(bad_name, correct_name)
WHERE LOWER(TRIM(f.villa_name)) = v.bad_name
  AND f.villa_name <> v.correct_name;

UPDATE rate_details rd
SET villa_name = v.correct_name, updated_at = NOW()
FROM (VALUES
    ('inf', 'Infinity')
) AS v(bad_name, correct_name)
WHERE LOWER(TRIM(rd.villa_name)) = v.bad_name
  AND rd.villa_name <> v.correct_name;

UPDATE rooms r
SET room_type = v.correct_name
FROM (VALUES
    ('inf', 'Infinity')
) AS v(bad_name, correct_name)
WHERE LOWER(TRIM(r.room_type)) = v.bad_name
  AND r.room_type <> v.correct_name;
"""


# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1c — STATEMENT SPEND VIEWS  (added 2026-07-16)
#
# (plain views over statement_details/rooms — recreating is always safe)
# Classifies homeowner-statement lines into amenity spend and attributes
# them to member stays. See each view's own docstring.
# ═════════════════════════════════════════════════════════════════════
STATEMENT_SPEND_SQL = r"""
-- Drop-first (NOT CREATE OR REPLACE alone): REPLACE can't change a
-- column's type, and these views already exist in the DB from the
-- earlier manual run. CASCADE also removes dependents (the synthetic
-- folio views / folios_unified), all recreated in the next block.
DROP VIEW IF EXISTS statement_villa_income_summary CASCADE;
DROP VIEW IF EXISTS member_statement_spend CASCADE;
DROP VIEW IF EXISTS statement_amenity_lines CASCADE;

-- statement_amenity_lines: every statement_details line that is genuine
-- member AMENITY spend. Excludes villa income, payments, staff wages,
-- utilities, maintenance/property tax/insurance, GCT, dues, transfers.
CREATE OR REPLACE VIEW statement_amenity_lines AS
WITH classified AS (
    SELECT
        sd.statement_detail_key,
        sd.member_number,
        sd.transaction_date,
        sd.description,
        sd.amount,
        CASE
            WHEN LOWER(sd.description) LIKE '%villa income%'                          THEN NULL
            -- [2026-07-19] THIRD-PARTY COSTS ARE NOT AMENITY SPEND.
            -- Vendor-numbered lines ("NNNN - Supplier / INV / detail") are
            -- villa operating costs billed to owners: TVs, dishwashers,
            -- landscaping, golf cart parts, generator servicing. Excluded
            -- UNLESS the vendor is a club outlet, because commissary, wine
            -- sales and the RSL boutique/dive shop ARE genuine club sales
            -- and share the same numbered format ($75,051.77 for 2026 —
            -- these must stay).
            -- POSIX classes, no braces: this block is inside a Python
            -- string where {3,} would be misread as a format placeholder.
            WHEN sd.description ~ '^[[:space:]]*[0-9][0-9][0-9]'
                 AND sd.description !~* '(commissary|wine sales|RSL)'      THEN NULL
            -- A donation is not amenity revenue.
            WHEN sd.description ~* 'donation'                              THEN NULL
            -- Utilities and insurance billed on to owners are cost
            -- recovery, not spend.
            WHEN sd.description ~* '(insurance|electricity bill|water bill|propane|utility charge)'
                                                                           THEN NULL
            -- [2026-07-18] STAY-REFERENCE BILLINGS: lines like
            -- 'Flanagan (Pinnac - 04/22/2026 to 04/26/2026 Pinnacle/V08
            -- 4 nights' are per-stay charges billed to a member's
            -- statement (owner cost-recovery for own-villa stays, or
            -- member-rate rentals whose economics run through the
            -- programme payouts). They are NOT amenity spend, and the
            -- keyword matching below was mis-bucketing them off guest
            -- SURNAMES (GreenSPAn -> Spa & Beauty, FoBARe -> F&B),
            -- inflating amenity revenue and double counting against
            -- Villa Income. Excluded entirely, pending finance's call
            -- on whether owner cost-recovery should surface as its own
            -- revenue line.
            WHEN sd.description ~ '\d{2}/\d{2}/\d{4}\s+to\s+\d{2}/\d{2}/\d{4}'
                 AND sd.description ~* 'night'                                        THEN NULL
            WHEN LOWER(sd.description) ~ '(wire|payment|thank you|lodgement|funds received|bns transfer|jmmb|cheque)' THEN NULL
            WHEN LOWER(sd.description) ~ '(staff wages|staff medical|staff insurance|payroll|petty c)'                THEN NULL
            WHEN LOWER(sd.description) ~ '(electricity|water usage|maintenance fee|property tax|insurance|hurricane)' THEN NULL
            WHEN LOWER(sd.description) ~ '(gct|dues|membership|transfer|loan)'        THEN NULL
            WHEN LOWER(sd.description) LIKE '%golf%'                                  THEN 'Golf'
            WHEN LOWER(sd.description) ~ '(tennis|pickleball)'                        THEN 'Tennis'
            WHEN LOWER(sd.description) ~ '(spa|massage|facial|yoga|body -|nails|salon)' THEN 'Spa & Beauty'
            WHEN LOWER(sd.description) ~ '(bar|beverage|wine|restaurant|grill|dining|banquet|ooshan)' THEN 'F&B'
            WHEN LOWER(sd.description) ~ '(commissary|grocery)'                       THEN 'Commissary'
            WHEN LOWER(sd.description) ~ '(boutique|shop|retail|gift)'                THEN 'Boutique'
            WHEN LOWER(sd.description) ~ '(cart rental|transportation)'               THEN 'Cart Rental'
            WHEN LOWER(sd.description) ~ '(water sports|kayak|snorkel|boat)'          THEN 'Water Sports'
            ELSE NULL
        END AS amenity_category
    FROM statement_details sd
    WHERE sd.amount <> 0
)
SELECT * FROM classified WHERE amenity_category IS NOT NULL;

-- member_statement_spend: amenity lines attributed to a stay when the
-- same member has a rooms record whose window (check_in .. check_out+3d)
-- contains the transaction_date. No-match rows keep NULL stay columns
-- (on_property_stay = FALSE) — legitimate house-account spend.
CREATE OR REPLACE VIEW member_statement_spend AS
SELECT DISTINCT ON (sal.statement_detail_key)
    sal.statement_detail_key,
    sal.member_number,
    sal.transaction_date,
    sal.description,
    sal.amenity_category,
    sal.amount,
    r.confirmation_code                       AS conf_code,
    r.room_number,
    r.check_in_date,
    r.check_out_date,
    (r.confirmation_code IS NOT NULL)         AS on_property_stay
FROM statement_amenity_lines sal
LEFT JOIN rooms r
       ON r.member_number = sal.member_number
      AND r.check_in_date IS NOT NULL
      AND r.check_out_date IS NOT NULL
      AND sal.transaction_date >= r.check_in_date
      AND sal.transaction_date <= r.check_out_date + INTERVAL '3 days'
ORDER BY sal.statement_detail_key, r.check_in_date DESC NULLS LAST;

-- statement_villa_income_summary: monthly rental-programme payouts to
-- owners. Per finance (2026-07-17) this IS the full net rental value —
-- no commission is deducted; only 15% GCT was removed upstream, and
-- revenue is reported net of tax anyway.
-- Latest month is usually partial (payouts post in arrears).
CREATE OR REPLACE VIEW statement_villa_income_summary AS
SELECT
    DATE_TRUNC('month', sd.transaction_date)::date AS income_month,
    COUNT(*)                                       AS villa_income_lines,
    COUNT(DISTINCT sd.member_number)               AS owners_paid,
    ABS(COALESCE(SUM(sd.amount), 0))               AS owner_payout_total
FROM statement_details sd
WHERE LOWER(sd.description) LIKE '%villa income%'
GROUP BY 1
ORDER BY 1;
"""


# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 1d — UNIFIED CHARGE LEDGER  (added 2026-07-16)
#
# folios_unified = journal folio lines + three synthetic sources. The
# overview matviews below read THIS instead of folios. Verified against
# real folios 2026-07-15/16:
#   - synthetic rate lines tie to real folio Villa lines to the penny
#     where both exist (Posted = charged-to-date, incl. in-house stays)
#   - zero conf-code overlap between synthetic and journal (NOT EXISTS
#     guards), so nothing double counts
#   - villa income conf codes are offset to 9,000,000+ because raw
#     ref_transaction_ids collide with real conf codes (9 of them fall
#     in the real 15,000-20,500 range — verified 2026-07-16)
# ═════════════════════════════════════════════════════════════════════
UNIFIED_SQL = r"""
-- Drop-first, dependents before dependencies (see note in the statement
-- block above — REPLACE can't change column types, and the earlier
-- manual run left old-shaped versions of these in the DB).
DROP VIEW IF EXISTS folios_unified_display CASCADE;
DROP VIEW IF EXISTS folios_unified CASCADE;
DROP VIEW IF EXISTS synthetic_villa_income_lines CASCADE;
DROP VIEW IF EXISTS synthetic_statement_folio_lines CASCADE;
DROP VIEW IF EXISTS synthetic_villa_folio_lines CASCADE;
DROP VIEW IF EXISTS programme_villa_periods CASCADE;
DROP VIEW IF EXISTS villa_owner_map CASCADE;

-- Owner account -> villa. Member numbers encode the villa number
-- (owner '12A' -> V12 -> Sunset). Resolves all 49 owners with 2026
-- payouts, 100% of the $8.22M. Joint accounts (12A/12B) collapse onto
-- one villa_name, which is correct.
CREATE OR REPLACE VIEW villa_owner_map AS
WITH room_names AS (
    SELECT room_number, villa_name FROM rate_details
    WHERE room_number IS NOT NULL AND villa_name IS NOT NULL
    UNION ALL
    SELECT room_number, room_type FROM rooms
    WHERE room_number IS NOT NULL AND room_type IS NOT NULL
),
villa_numbers AS (
    SELECT
        (REGEXP_MATCH(room_number, '^V?0*(\d+)'))[1] AS villa_num,
        villa_name,
        COUNT(*) AS n
    FROM room_names
    WHERE room_number ~ '^V?0*\d+'
    GROUP BY 1, 2
),
best_name AS (
    SELECT DISTINCT ON (villa_num) villa_num, villa_name
    FROM villa_numbers
    -- Tiebreak by frequency, then LONGER name — so an abbreviation
    -- ('Inf') never beats the full name ('Infinity') on a tie.
    ORDER BY villa_num, n DESC, LENGTH(villa_name) DESC
),
-- MANUAL NAME CORRECTIONS — add rows here whenever the source data's
-- most-common spelling is an abbreviation or typo. These win over
-- whatever best_name voted for. Same pattern as the bedroom manual map.
corrected_name AS (
    SELECT
        bn.villa_num,
        COALESCE(fix.correct_name, bn.villa_name) AS villa_name
    FROM best_name bn
    LEFT JOIN (VALUES
        ('Inf',        'Infinity')
        -- ('Trdwnds', 'Tradewinds On The Sea')   <- example format
    ) AS fix(bad_name, correct_name)
      ON bn.villa_name = fix.bad_name
)
SELECT DISTINCT
    m.member_number,
    cn.villa_name
FROM members m
JOIN corrected_name cn
  ON cn.villa_num = (REGEXP_MATCH(m.member_number, '^0*(\d+)'))[1]
WHERE m.member_number ~ '^\d';


-- Which villas were in the rental programme, per year: any year an
-- owner received a "Villa Income" payout for that villa. Used by the
-- overview matview to drop member-journal VILLA RENTAL lines for PAID
-- stays at these villas in these years — under the working assumption
-- (agreed 2026-07-16) that those stays' revenue already flows through
-- the owner's payout, so counting the folio/rate charge too would
-- double count (~$1.1M in 2026). Bookings, amenity spend, and Free
-- stays at these villas are untouched. If finance says member bookings
-- at programme villas are billed OUTSIDE the programme, delete the
-- overview_deduped_charge_lines filter in VIEWS_SQL to restore them.
CREATE OR REPLACE VIEW programme_villa_periods AS
SELECT DISTINCT
    vom.villa_name,
    -- villa_num (added 2026-07-17): the villa number straight from the
    -- owner's member number (owner 90 / 90A -> villa 90). Lets the
    -- dedup guard match on NUMBER via the booking's room_number
    -- instead of relying on exact villa-name equality — folio villa
    -- names contain variants ('inf' vs 'Infinity') that name equality
    -- silently misses, letting programme-villa charges escape removal
    -- and double count against the owner's payout.
    (REGEXP_MATCH(sd.member_number, '^0*(\d+)'))[1] AS villa_num,
    EXTRACT(YEAR FROM sd.transaction_date)::int AS income_year
FROM statement_details sd
JOIN villa_owner_map vom
  ON vom.member_number = sd.member_number
WHERE LOWER(sd.description) LIKE '%villa income%';


-- Villa rental lines rebuilt from rate_details for reservations with NO
-- folio. line_status Posted = charged-to-date; Unposted = future booked
-- value (kept out of revenue by the matview's Posted filter).
CREATE OR REPLACE VIEW synthetic_villa_folio_lines AS
SELECT
    'synthrate-' || rd.rate_detail_key            AS folio_key,
    rd.rate_date                                  AS transaction_date,
    COALESCE(rd.rate_name, 'Villa Rental')        AS description,
    COALESCE(rd.total_amount, 0)                  AS amount,
    rd.conf_code::text                            AS conf_code,
    rd.member_number,
    rd.guest_name,
    rd.check_in_date,
    rd.check_out_date,
    rd.room_number,
    rd.villa_name,
    rd.bedroom_count,
    rd.source,
    rd.payment_type                               AS villa_payment_type,
    rd.reservation_status,
    'Villa'                                       AS transaction_category,
    'Charge'                                      AS transaction_flow,
    rd.status                                     AS line_status,
    'synthetic_rate'                              AS folio_source,
    rd.payment_type                               AS payment_type,
    NULL::int                                     AS persons
FROM (
    -- [2026-07-18] ONE ROW PER NIGHT. rate_detail_key hashes the
    -- AMOUNTS, so re-scraping a stay whose charges changed (in-progress
    -- stays, applied discounts) inserts a second row for the same night
    -- instead of updating — doubling villa revenue for folio-less
    -- reservations. Keep the most recent version of each night;
    -- prefer Posted over Unposted when both exist.
    SELECT DISTINCT ON (conf_code, rate_date) *
    FROM rate_details
    ORDER BY conf_code, rate_date,
             (COALESCE(NULLIF(TRIM(status), ''), 'Posted') = 'Posted') DESC,
             updated_at DESC NULLS LAST,
             total_amount DESC
) rd
WHERE rd.conf_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folios f WHERE f.conf_code::text = rd.conf_code::text);


-- Member amenity spend from statements, attributed to stays, for conf
-- codes with NO folio.
CREATE OR REPLACE VIEW synthetic_statement_folio_lines AS
SELECT
    'synthstmt-' || mss.statement_detail_key      AS folio_key,
    mss.transaction_date,
    mss.description,
    mss.amount,
    mss.conf_code::text                           AS conf_code,
    mss.member_number,
    NULL::text                                    AS guest_name,
    mss.check_in_date,
    mss.check_out_date,
    mss.room_number,
    NULL::text                                    AS villa_name,
    NULL::int                                     AS bedroom_count,
    'Statement'                                   AS source,
    NULL::text                                    AS villa_payment_type,
    NULL::text                                    AS reservation_status,
    mss.amenity_category                          AS transaction_category,
    CASE WHEN mss.amount >= 0 THEN 'Charge' ELSE 'Credit' END AS transaction_flow,
    'Posted'                                      AS line_status,
    'synthetic_statement'                         AS folio_source,
    NULL::text                                    AS payment_type,
    NULL::int                                     AS persons
FROM member_statement_spend mss
WHERE mss.on_property_stay
  AND NOT EXISTS (SELECT 1 FROM folios f WHERE f.conf_code::text = mss.conf_code::text);


-- Rental-programme payouts ("Villa Income" credits on homeowner
-- statements) as ordinary Villa charge lines: this is what puts the
-- rental programme into the existing Villa slot on Finance at a glance,
-- Revenue by month, and Member vs guest revenue.
--   amount: sign flipped only — NO commission gross-up. CONFIRMED BY
--     FINANCE 2026-07-17: the Villa Income payout on the homeowner
--     statement is already the full net rental value of the stay — no
--     management commission is deducted from it. The only thing removed
--     upstream is Jamaica's 15% GCT, and revenue is reported net of tax
--     throughout, so the payout is used as-is. (Prior to 2026-07-17
--     this divided by 0.75 under a working assumption of a 25%
--     commission — that overstated programme income by a third. If a
--     commission ever IS introduced, divide by (1 - rate) here — this
--     is the only place it would appear.)
--     Credits (negative) -> positive revenue; the few positive
--     correction lines -> negative, netting out normally.
--   conf_code: 9000000 + ref_transaction_id (collision-proof — real
--     conf codes max ~20,500)
--   check_in/check_out: the income month, so month bucketing and the
--     date picker land the payout in the month it was earned
--   member_number: the owner -> classifies under Member
--   villa_name: from villa_owner_map -> per-villa breakdowns work
CREATE OR REPLACE VIEW synthetic_villa_income_lines AS
WITH payouts AS (
    SELECT
        sd.statement_detail_key,
        sd.transaction_date,
        sd.description,
        sd.member_number                                AS owner_member_number,
        ROUND((-sd.amount)::numeric, 2)                 AS amount,
        ROUND(sd.ref_transaction_id::numeric)::bigint   AS ref_id,
        vom.villa_name,
        DATE_TRUNC('month', sd.transaction_date)::date  AS income_month
    FROM statement_details sd
    LEFT JOIN villa_owner_map vom
           ON vom.member_number = sd.member_number
    WHERE LOWER(sd.description) LIKE '%villa income%'
      AND sd.ref_transaction_id IS NOT NULL
      AND TRIM(sd.ref_transaction_id::text) ~ '^\d+(\.\d+)?$'
      AND vom.villa_name IS NOT NULL
),
-- Every charged villa stay, from the two base sources (journal folios and
-- rate-derived lines). Comped stays are excluded by the SUM(amount) > 0
-- check below: a free stay generated no rental income, so it should not
-- absorb any of the payout.
villa_charge_lines AS (
    SELECT f.conf_code::text        AS conf_code,
           f.member_number,
           f.guest_name,
           f.villa_name,
           f.room_number,
           f.bedroom_count,
           f.check_in_date,
           f.check_out_date,
           f.villa_payment_type,
           f.reservation_status,
           f.amount
    FROM folios f
    WHERE f.transaction_category = 'Villa'
    UNION ALL
    SELECT s.conf_code::text,
           s.member_number,
           s.guest_name,
           s.villa_name,
           s.room_number,
           s.bedroom_count,
           s.check_in_date,
           s.check_out_date,
           s.villa_payment_type,
           s.reservation_status,
           s.amount
    FROM synthetic_villa_folio_lines s
    WHERE s.line_status = 'Posted'
),
stay_candidates AS (
    SELECT
        v.villa_name,
        DATE_TRUNC('month', v.check_in_date)::date  AS stay_month,
        v.conf_code,
        MAX(v.member_number)                        AS member_number,
        MAX(v.guest_name)                           AS guest_name,
        MAX(v.room_number)                          AS room_number,
        MAX(v.bedroom_count)                        AS bedroom_count,
        MIN(v.check_in_date)                        AS check_in_date,
        MAX(v.check_out_date)                       AS check_out_date,
        SUM(v.amount)                               AS weight
    FROM villa_charge_lines v
    WHERE v.villa_name    IS NOT NULL
      AND v.check_in_date IS NOT NULL
      AND COALESCE(LOWER(v.reservation_status), '')
            NOT IN ('cancelled', 'canceled', 'no-show')
    GROUP BY v.villa_name, DATE_TRUNC('month', v.check_in_date), v.conf_code
    HAVING SUM(v.amount) > 0
),
allocated AS (
    SELECT
        p.statement_detail_key,
        p.transaction_date,
        p.description,
        p.ref_id,
        p.villa_name,
        s.member_number,
        s.guest_name,
        s.room_number,
        s.bedroom_count,
        s.check_in_date                             AS stay_check_in,
        s.check_out_date                            AS stay_check_out,
        ROUND((p.amount * s.weight
               / SUM(s.weight) OVER (PARTITION BY p.statement_detail_key))::numeric, 2)
                                                    AS amount,
        ROW_NUMBER() OVER (PARTITION BY p.statement_detail_key
                           ORDER BY s.conf_code)    AS seq
    FROM payouts p
    JOIN stay_candidates s
      ON s.villa_name = p.villa_name
     AND s.stay_month = p.income_month
),
unallocated AS (
    SELECT p.*
    FROM payouts p
    WHERE NOT EXISTS (
        SELECT 1 FROM stay_candidates s
        WHERE s.villa_name = p.villa_name
          AND s.stay_month = p.income_month
    )
)
-- Allocated: attributed to the member or guest who actually stayed.
SELECT
    'synthvi-' || a.statement_detail_key || '-' || a.seq     AS folio_key,
    a.transaction_date,
    a.description,
    a.amount,
    ((9000000 + a.ref_id) * 100 + a.seq)::text              AS conf_code,
    a.member_number,
    a.guest_name,
    a.stay_check_in                                         AS check_in_date,
    a.stay_check_out                                        AS check_out_date,
    a.room_number,
    a.villa_name,
    a.bedroom_count,
    'Rental Programme'                                      AS source,
    'Paid'                                                  AS villa_payment_type,
    'Checked Out'                                           AS reservation_status,
    'Villa'                                                 AS transaction_category,
    CASE WHEN a.amount >= 0 THEN 'Charge' ELSE 'Credit' END AS transaction_flow,
    'Posted'                                                AS line_status,
    'synthetic_villa_income'                                AS folio_source,
    'Paid'                                                  AS payment_type,
    NULL::int                                               AS persons
FROM allocated a
WHERE a.amount <> 0
 
UNION ALL
 
-- Residual: no charged stay found for that villa-month, so it stays with
-- the owner and reports as Member, exactly as before.
SELECT
    'synthvi-' || u.statement_detail_key                    AS folio_key,
    u.transaction_date,
    u.description,
    u.amount,
    ((9000000 + u.ref_id) * 100)::text                      AS conf_code,
    u.owner_member_number                                   AS member_number,
    NULL::text                                              AS guest_name,
    u.income_month                                          AS check_in_date,
    u.transaction_date                                      AS check_out_date,
    NULL::text                                              AS room_number,
    u.villa_name,
    NULL::int                                               AS bedroom_count,
    'Rental Programme'                                      AS source,
    'Paid'                                                  AS villa_payment_type,
    'Checked Out'                                           AS reservation_status,
    'Villa'                                                 AS transaction_category,
    CASE WHEN u.amount >= 0 THEN 'Charge' ELSE 'Credit' END AS transaction_flow,
    'Posted'                                                AS line_status,
    'synthetic_villa_income'                                AS folio_source,
    'Paid'                                                  AS payment_type,
    NULL::int                                               AS persons
FROM unallocated u
WHERE u.amount <> 0;


-- The complete charge ledger.
CREATE OR REPLACE VIEW folios_unified AS
SELECT
    f.folio_key, f.transaction_date, f.description, f.amount, f.conf_code::text AS conf_code,
    f.member_number, f.guest_name, f.check_in_date, f.check_out_date,
    f.room_number, f.villa_name, f.bedroom_count, f.source,
    f.villa_payment_type, f.reservation_status, f.transaction_category,
    f.transaction_flow,
    'Posted'::text  AS line_status,
    'journal'::text AS folio_source,
    f.payment_type  AS payment_type,
    f.persons       AS persons
FROM folios f
UNION ALL
SELECT folio_key, transaction_date, description, amount, conf_code,
       member_number, guest_name, check_in_date, check_out_date,
       room_number, villa_name, bedroom_count, source, villa_payment_type,
       reservation_status, transaction_category, transaction_flow,
       line_status, folio_source, payment_type, persons
FROM synthetic_villa_folio_lines
UNION ALL
SELECT folio_key, transaction_date, description, amount, conf_code,
       member_number, guest_name, check_in_date, check_out_date,
       room_number, villa_name, bedroom_count, source, villa_payment_type,
       reservation_status, transaction_category, transaction_flow,
       line_status, folio_source, payment_type, persons
FROM synthetic_statement_folio_lines
UNION ALL
SELECT folio_key, transaction_date, description, amount, conf_code,
       member_number, guest_name, check_in_date, check_out_date,
       room_number, villa_name, bedroom_count, source, villa_payment_type,
       reservation_status, transaction_category, transaction_flow,
       line_status, folio_source, payment_type, persons
FROM synthetic_villa_income_lines;

-- ─────────────────────────────────────────────────────────────────────────
-- folios_unified_display: folios_unified with the ZERO-RENTAL
-- RECLASSIFICATION applied [2026-07-18].
--
-- Problem: owner-guest / host-arrangement stays are tagged
-- villa_payment_type = 'Paid' in the source system even though their
-- rental was waived — either rack rate posted then modified to $0
-- (Burke/Karma Bay: $46,256 list -> $0 charged) or no rate ever set
-- (Kelley/Pinnacle). The only money on such stays is a small
-- cost-recovery charge on the host member's statement. Counting them
-- as 'Paid' bookings distorted the Paid/Free toggle, dragged Paid ADR
-- down, and hid their rack value from the Free give-away card.
--
-- Rule: a 'Paid' booking is reclassified to 'Free' when it HAS posted
-- villa rental lines and they net to $0. Bookings with NO villa lines
-- at all are left alone (can't judge — typically statement-billed
-- stays at programme villas whose rental economics run through the
-- owner payouts). Revenue totals are unaffected either way: these
-- stays contribute $0 to Paid villa revenue by definition.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW folios_unified_display AS
WITH zero_rental_paid_confs AS (
    SELECT u.conf_code
    FROM folios_unified u
    WHERE u.conf_code IS NOT NULL
      AND u.villa_payment_type = 'Paid'
      AND u.transaction_category = 'Villa'
      AND u.line_status = 'Posted'
      AND COALESCE(u.folio_source, 'journal') <> 'synthetic_villa_income'
    GROUP BY u.conf_code
    HAVING COALESCE(SUM(u.amount), 0) = 0
)
SELECT
    u.folio_key, u.transaction_date, u.description, u.amount, u.conf_code,
    u.member_number, u.guest_name, u.check_in_date, u.check_out_date,
    u.room_number, u.villa_name, u.bedroom_count, u.source,
    CASE WHEN u.villa_payment_type = 'Paid' AND z.conf_code IS NOT NULL
         THEN 'Free' ELSE u.villa_payment_type END AS villa_payment_type,
    u.reservation_status, u.transaction_category, u.transaction_flow,
    u.line_status, u.folio_source, u.payment_type, u.persons
FROM folios_unified u
LEFT JOIN zero_rental_paid_confs z
  ON z.conf_code = u.conf_code;
"""


# ═════════════════════════════════════════════════════════════════════
# SQL BLOCK 2 — OVERVIEW VIEWS
#
# CHANGED 2026-07-16 (three FROM clauses, marked -- [UNIFIED] below):
#   overview_transaction_lines  -> folios_unified, Posted only
#   overview_booking_meta       -> folios_unified, everything (meta is
#                                  the conf_code -> dates lookup used by
#                                  date filters; villa-income conf codes
#                                  must be here or payouts vanish when a
#                                  date filter is active)
#   overview_villa_bookings     -> folios_unified, Posted only, and
#                                  EXCLUDING synthetic_villa_income (a
#                                  payout is not a booking — keeps
#                                  booking counts / room nights / ADR /
#                                  avg stay honest)
# Payments views stay on plain folios (no settlement lines in synthetics).
# ═════════════════════════════════════════════════════════════════════
VIEWS_SQL = r"""
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
-- (Same netting/classification as before; source is now the unified
-- ledger, Posted lines only.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW overview_transaction_lines AS
WITH overview_stripped_lines AS (
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
        f.reservation_status                           AS overview_reservation_status,
        f.check_in_date                                AS overview_check_in_date,
        f.folio_source                                 AS overview_folio_source,
        -- [2026-07-17] room_number carried through purely for the
        -- number-based programme-villa match in the dedup CTE below.
        -- Dropped at the netting stage; not exposed in the matview.
        f.room_number                                  AS overview_room_number
    FROM folios_unified_display f                      -- [UNIFIED+reclass 2026-07-18]
    WHERE f.conf_code IS NOT NULL
      AND f.description IS NOT NULL
      AND f.line_status = 'Posted'                     -- [UNIFIED] future rate lines excluded
      -- [2026-07-18] COMPLETED-STAY CUTOFF: revenue is recognized only
      -- once the stay has fully checked out (strictly before the
      -- refresh date). In-progress stays' folios are still open and
      -- subject to comps/adjustments/credits, so their already-posted
      -- lines are held back until departure. Applies to ALL of the
      -- stay's charge lines (villa, amenity, membership) so a booking
      -- never appears half-recognized. Lines with no check-out date
      -- (member-statement spend matched loosely, monthly programme
      -- income) keep their own dating and are unaffected in practice:
      -- programme income rows carry month-end check-out dates and
      -- payouts post in arrears anyway. CURRENT_DATE freezes at matview
      -- refresh time — refresh daily (or per data load) to roll stays
      -- in as they complete. To revert to as-posted recognition, delete
      -- this one condition.
      AND (f.check_out_date IS NULL OR f.check_out_date < CURRENT_DATE)
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
            -- [2026-07-19] Prepaid-TMD transfers and refunds are worded
            -- "Miscellaneous Charge - ... Prepaid TMD - Debit Folio 5",
            -- so they fell through to the Amenity catch-all, where they
            -- netted -$1,671.59 against amenity revenue. TMD is temp
            -- membership fee: these belong in Membership so debits,
            -- credits and refunds net against the fee they relate to.
            WHEN overview_stripped_description ~* '(^|[^a-z])tmd([^a-z]|$)'
            THEN 'Membership'
            WHEN overview_stripped_description ILIKE 'Villa Rental -%'
              OR overview_stripped_description ILIKE '%room rate%'
              OR overview_stripped_description ILIKE '%room portion%'
              OR overview_stripped_description ILIKE '%accommodation%'
              OR overview_stripped_description ILIKE 'Complimentary Rental%'
              OR overview_stripped_description ILIKE 'HO Reservation%'
              -- [UNIFIED] synthetic lines arrive pre-categorized: rate
              -- lines' rate_name and villa-income descriptions don't
              -- match the keyword patterns above, so trust the source
              -- category for them.
              OR overview_transaction_category = 'Villa'
            THEN 'Villa'
            ELSE 'Amenity'
        END                                              AS overview_line_category,
        overview_amount,
        overview_check_in_date,
        overview_folio_source,
        overview_room_number
    FROM overview_stripped_lines
    WHERE overview_stripped_description NOT ILIKE '%payment%'
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
overview_programme_keys AS MATERIALIZED (
    -- [2026-07-17 perf] The programme list, computed ONCE into a tiny
    -- in-memory set. Referencing programme_villa_periods directly
    -- inside a correlated EXISTS made the planner re-run that whole
    -- view stack (statement_details JOIN villa_owner_map) per charge
    -- line — nested-loop over thousands of rows — which blew past the
    -- pooler's statement timeout. MATERIALIZED pins it to one pass.
    SELECT DISTINCT
        p.villa_num,
        LOWER(TRIM(p.villa_name)) AS villa_name_norm,
        p.income_year
    FROM programme_villa_periods p
),
overview_keyed_charge_lines AS (
    -- Precompute each line's match keys once (regex per row, not per
    -- probe): villa number from the room code, normalized villa name.
    SELECT
        ocl.*,
        COALESCE(
            (REGEXP_MATCH(ocl.overview_room_number, 'v\s*0*(\d+)', 'i'))[1],
            -- bare number or 300-series unit code ('90', '306A'): the
            -- owner suffix rides on the room code itself, so take the
            -- leading digits.
            (REGEXP_MATCH(ocl.overview_room_number, '^\s*0*(\d+)\s*[A-Za-z]?\s*$'))[1]
        )                                               AS overview_villa_num_key,
        LOWER(TRIM(COALESCE(ocl.overview_villa_name, '~none~')))
                                                        AS overview_villa_name_key,
        EXTRACT(YEAR FROM ocl.overview_check_in_date)::int
                                                        AS overview_check_in_year
    FROM overview_charge_lines ocl
),
overview_deduped_charge_lines AS (
    -- [UNIFIED 2026-07-16] Programme-villa double-count guard: drop
    -- member-journal VILLA lines for PAID stays at villas that received
    -- rental-programme payouts in the stay's check-in year — that
    -- revenue already arrives via the Villa Income payout lines. Works
    -- for reversals too: 'Reversal of Villa Rental…' is stripped before
    -- categorization, so charge+reversal drop together — no orphaned
    -- anomalies. Villa-income lines exempt themselves via folio_source.
    -- Amenities, Free stays, and booking rows are untouched.
    --
    -- [2026-07-17] Matches on VILLA NUMBER (room code V90 -> 90 ->
    -- owner 90/90A), with normalized villa name as fallback — exact
    -- name equality silently missed spelling variants ('inf' vs
    -- 'Infinity'), letting programme charges double count against the
    -- owner's payout. Both matches are plain equality against the
    -- materialized key set above, so they hash-join instead of
    -- nested-looping. To undo the guard entirely: replace this CTE's
    -- body with SELECT * FROM overview_keyed_charge_lines.
    SELECT *
    FROM overview_keyed_charge_lines ocl
    WHERE NOT (
        ocl.overview_line_category = 'Villa'
        AND ocl.overview_booking_payment_type = 'Paid'
        AND COALESCE(ocl.overview_folio_source, 'journal') <> 'synthetic_villa_income'
        AND ocl.overview_check_in_date IS NOT NULL
        AND (
            EXISTS (
                SELECT 1 FROM overview_programme_keys p
                WHERE p.income_year = ocl.overview_check_in_year
                  AND p.villa_num   = ocl.overview_villa_num_key
            )
            OR EXISTS (
                SELECT 1 FROM overview_programme_keys p
                WHERE p.income_year     = ocl.overview_check_in_year
                  AND p.villa_name_norm = ocl.overview_villa_name_key
            )
        )
    )
),
overview_netted_lines AS (
    SELECT
        overview_conf_code,
        MAX(overview_villa_name)                       AS overview_villa_name,
        MAX(overview_booking_payment_type)              AS overview_booking_payment_type,
        bool_or(overview_transaction_category = 'Cash Advance') AS overview_is_cash_advance_category,
        overview_line_description,
        MAX(overview_line_category)                     AS overview_line_category,
        SUM(COALESCE(overview_amount, 0))               AS overview_net_amount,
        SUM(CASE WHEN overview_amount > 0 THEN overview_amount ELSE 0 END) AS overview_gross_charged_amount
    FROM overview_deduped_charge_lines
    GROUP BY overview_conf_code, overview_line_description
),
overview_amount_counts AS (
    SELECT
        overview_conf_code,
        ROUND(overview_net_amount::numeric, 2) AS overview_rounded_amount,
        COUNT(*) AS overview_amount_count
    FROM overview_netted_lines
    GROUP BY overview_conf_code, ROUND(overview_net_amount::numeric, 2)
),
overview_reversal_pairs AS (
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
        WHEN nl.overview_line_description ILIKE '%staff tip%'
          OR nl.overview_line_description ~* 'villa[ _]tips'
        THEN 'Tip'
        WHEN nl.overview_line_description ILIKE '%folio%'
          OR nl.overview_line_description ~* 'from v[0-9]+|to v[0-9]+'
        THEN 'InternalTransfer'
        WHEN rd.overview_line_description IS NOT NULL THEN 'Reversed'
        WHEN nl.overview_net_amount = 0 AND nl.overview_gross_charged_amount > 0 THEN 'Reversed'
        WHEN nl.overview_net_amount > 0 THEN 'Paid'
        WHEN nl.overview_net_amount = 0 THEN 'Free'
        -- [2026-07-19] Rental-programme income CORRECTIONS. The club
        -- occasionally reverses previously-paid Villa Income (owner 15,
        -- June 2026: -$16,316.24). The payout being corrected was
        -- recorded in a different month, so there is no matching charge
        -- to pair with and these fell through to Anomaly — held outside
        -- revenue, leaving villa revenue overstated by the correction
        -- and "Unexplained reversals" inflated by an entirely
        -- explainable adjustment. They belong in Paid, where they net
        -- against the payouts they correct.
        WHEN nl.overview_line_description ILIKE '%villa income%' THEN 'Paid'
        ELSE 'Anomaly'
    END AS overview_line_status,
    nl.overview_gross_charged_amount
FROM overview_netted_lines nl
LEFT JOIN overview_reversed_descriptions rd
  ON rd.overview_conf_code = nl.overview_conf_code
 AND rd.overview_line_description = nl.overview_line_description;

CREATE INDEX overview_transaction_lines_conf_code_idx
    ON overview_transaction_lines (overview_conf_code, overview_line_description);

-- ─────────────────────────────────────────────────────────────────────────
-- Rollup views (unchanged)
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

-- Payments — still folios directly (settlements never enter the
-- charge pipeline; synthetic sources contain no payment lines).
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
-- overview_booking_meta — conf_code -> dates/metadata lookup. Reads the
-- unified ledger with NO source/status exclusions, so villa-income conf
-- codes are date-filterable (their check_in = income month start).
--
-- MATERIALIZED (changed 2026-07-16): as a plain view it re-executed the
-- entire folios_unified union — including the statement classification
-- regexes and NOT EXISTS guards — on EVERY date-filtered endpoint
-- query, ~20 times per page load. Materializing pays that cost once at
-- refresh time, same as the other two matviews.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS overview_booking_meta CASCADE';
EXCEPTION WHEN wrong_object_type THEN
    EXECUTE 'DROP VIEW IF EXISTS overview_booking_meta CASCADE';
END $$;

CREATE MATERIALIZED VIEW overview_booking_meta AS
SELECT
    f.conf_code                                    AS overview_conf_code,
    MAX(f.villa_name)                               AS overview_villa_name,
    COALESCE(MAX(f.bedroom_count), 1)               AS overview_bedroom_count,
    COALESCE(NULLIF(TRIM(MAX(f.payment_type)), ''), 'Unknown')        AS overview_payment_type,
    MAX(f.member_number)                            AS overview_member_number,
    MAX(m.member_or_guest)                          AS overview_member_or_guest,
    MAX(f.persons)                                  AS overview_persons,
    MIN(f.check_in_date)                            AS overview_check_in_date,
    MAX(f.check_out_date)                           AS overview_check_out_date,
    MAX(f.check_out_date - f.check_in_date)         AS overview_nights
FROM folios_unified_display f                        -- [UNIFIED+reclass 2026-07-18]
LEFT JOIN members m
    ON m.member_number = f.member_number
WHERE f.conf_code IS NOT NULL
  AND f.villa_name IS NOT NULL
  AND f.check_in_date IS NOT NULL
  AND f.check_out_date IS NOT NULL
  AND COALESCE(LOWER(f.reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
GROUP BY f.conf_code;

CREATE UNIQUE INDEX overview_booking_meta_pk
    ON overview_booking_meta (overview_conf_code);
CREATE INDEX overview_booking_meta_dates_idx
    ON overview_booking_meta (overview_check_in_date, overview_check_out_date);

-- ─────────────────────────────────────────────────────────────────────────
-- overview_villa_bookings — one row per REAL booking. Villa-income rows
-- excluded (a payout is not a booking); Posted only (future rate lines
-- are booked value, not stays that have happened... they ARE included
-- as bookings when their status rows exist — the Posted filter here is
-- about which LINES form the booking record; Room Assigned reservations
-- with only Unposted lines simply appear once their rates post).
-- ─────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW overview_villa_bookings AS
WITH overview_booking_base AS (
    SELECT
        f.conf_code                                    AS overview_conf_code,
        MAX(f.villa_name)                               AS overview_villa_name,
        COALESCE(MAX(f.bedroom_count), 1)               AS overview_bedroom_count,
        COALESCE(NULLIF(TRIM(MAX(f.payment_type)), ''), 'Unknown')        AS overview_payment_type,
        MAX(f.member_number)                            AS overview_member_number,
        MAX(m.member_or_guest)                          AS overview_member_or_guest,
        MAX(f.persons)                                  AS overview_persons,
        MIN(f.check_in_date)                            AS overview_check_in_date,
        MAX(f.check_out_date)                           AS overview_check_out_date,
        MAX(f.check_out_date - f.check_in_date)         AS overview_nights
    FROM folios_unified_display f                        -- [UNIFIED+reclass 2026-07-18]
    LEFT JOIN members m
        ON m.member_number = f.member_number
    WHERE f.conf_code IS NOT NULL
      AND f.villa_name IS NOT NULL
      AND f.check_in_date IS NOT NULL
      AND f.check_out_date IS NOT NULL
      AND f.line_status = 'Posted'                       -- [UNIFIED]
      AND f.folio_source <> 'synthetic_villa_income'     -- [UNIFIED] payouts are not bookings
      AND COALESCE(LOWER(f.reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
      -- [2026-07-18] completed stays only — same cutoff as the
      -- transaction-lines matview, so bookings, nights, and ADR stay on
      -- the same basis as the revenue they're compared against.
      AND f.check_out_date < CURRENT_DATE
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
-- Member rollups (unchanged)
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

CREATE OR REPLACE VIEW overview_statements_summary AS
SELECT COALESCE(SUM(amount_due), 0) AS overview_total_amount_due
FROM (
    SELECT DISTINCT ON (member_number, receivable_type)
           amount_due
    FROM statements
    WHERE amount_due IS NOT NULL
    ORDER BY member_number, receivable_type, due_date DESC
) latest;

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
FROM (
    -- [2026-07-18] Same one-row-per-night dedup as
    -- synthetic_villa_folio_lines — see the note there.
    SELECT DISTINCT ON (conf_code, rate_date) *
    FROM rate_details
    WHERE rate_date <= CURRENT_DATE
      AND COALESCE(NULLIF(TRIM(status), ''), 'Posted') = 'Posted'
    ORDER BY conf_code, rate_date, updated_at DESC NULLS LAST, total_amount DESC
) rd;

CREATE OR REPLACE VIEW overview_villa_rack_rate_free AS
WITH zero_charged_paid AS (
    -- [2026-07-18] Same zero-rental reclass as folios_unified_display,
    -- expressed on the rate side: 'Paid' reservations whose posted
    -- charges net to $0 (rack listed, charge waived - e.g. Karma Bay's
    -- $46,256 week modified to $0) count as Free give-aways here, so
    -- their rack value shows on the Free give-away card instead of
    -- silently vanishing.
    SELECT conf_code
    FROM rate_details_with_discount
    WHERE payment_type = 'Paid'
      AND COALESCE(LOWER(reservation_status), '')
            NOT IN ('cancelled', 'canceled', 'no-show')
    GROUP BY conf_code
    HAVING COALESCE(SUM(total_amount), 0) = 0
)
SELECT
    rd.villa_name                       AS overview_villa_name,
    COALESCE(SUM(rd.rack_rate), 0)      AS overview_rack_rate_total,
    COUNT(DISTINCT rd.conf_code)         AS overview_free_bookings
FROM rate_details_with_discount rd
WHERE (rd.payment_type = 'Free'
       OR rd.conf_code IN (SELECT conf_code FROM zero_charged_paid))
  AND rd.villa_name IS NOT NULL
GROUP BY rd.villa_name;

-- Populate the materialized views (transaction_lines before villa_bookings).
REFRESH MATERIALIZED VIEW overview_booking_meta;
REFRESH MATERIALIZED VIEW overview_transaction_lines;
REFRESH MATERIALIZED VIEW overview_villa_bookings;

"""


def load_room_lookup(conn):
    """Load room_lookup.csv into a room_lookup table. The table is ALWAYS
    created (even empty) so the backfill SQL can reference it safely."""
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
        # The Supabase pooler ignores/strips the startup
        # "-c statement_timeout=0" option, so the server/role default
        # timeout still applies. SET LOCAL re-disables it inside this
        # transaction, where it actually takes effect through the pooler.
        cur.execute("SET LOCAL statement_timeout = 0;")
        cur.execute(sql)
    conn.commit()
    print(f"  {label} done in {time.time() - start:.1f}s")


def run_statements(conn, statements, label):
    print(f"Running {label} ...")
    start = time.time()
    with conn.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = 0;")
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
        ("transaction_category distribution",
         "SELECT transaction_category, COUNT(*), ROUND(SUM(amount)::numeric, 2) "
         "FROM folios GROUP BY transaction_category ORDER BY 2 DESC"),
        ("UNCLASSIFIED ('Other') rows — should be 0",
         "SELECT COUNT(*) FROM folios WHERE transaction_category = 'Other'"),
        ("rate_details rows still missing bedroom_count",
         "SELECT COUNT(*) FROM rate_details WHERE bedroom_count IS NULL"),
        # ── Unified ledger checks (added 2026-07-16) ──────────────────
        ("folios_unified rows by source",
         "SELECT folio_source, COUNT(*), ROUND(SUM(amount)::numeric, 2) "
         "FROM folios_unified GROUP BY folio_source ORDER BY 2 DESC"),
        ("synthetic conf codes overlapping journal (MUST be 0)",
         "SELECT COUNT(DISTINCT u.conf_code) FROM folios_unified u "
         "WHERE u.folio_source NOT IN ('journal', 'synthetic_villa_income') "
         "AND EXISTS (SELECT 1 FROM folios f WHERE f.conf_code::text = u.conf_code)"),
        ("villa income owners with NO villa mapping (want 0)",
         "SELECT COUNT(DISTINCT member_number) FROM synthetic_villa_income_lines "
         "WHERE villa_name IS NULL"),
        ("2026 Villa revenue, Posted (Finance card villa slot)",
         "SELECT ROUND(SUM(otl.overview_net_amount)::numeric, 2) "
         "FROM overview_transaction_lines otl "
         "JOIN overview_booking_meta ovb ON ovb.overview_conf_code = otl.overview_conf_code "
         "WHERE otl.overview_line_category = 'Villa' AND otl.overview_line_status = 'Paid' "
         "AND ovb.overview_check_in_date >= '2026-01-01' AND ovb.overview_check_in_date < '2027-01-01'"),
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
        description="Run folio classification + statement/unified/overview views SQL."
    )
    parser.add_argument("--classify-only", action="store_true",
                        help="Only run the folio classification block")
    parser.add_argument("--views-only", action="store_true",
                        help="Only run the statement/unified/overview views blocks")
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
                # Dependency order: statement views -> unified ledger ->
                # overview views (VIEWS_SQL ends with the two REFRESHes,
                # so a full run leaves the matviews current).
                run_sql(conn, STATEMENT_SPEND_SQL, "statement spend views")
                run_sql(conn, UNIFIED_SQL, "unified charge ledger")
                run_sql(conn, VIEWS_SQL, "overview views")
            if args.classify_only:
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