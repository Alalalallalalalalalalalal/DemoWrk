-- ============================================================================
-- HISTORICAL DUES SYNOPSIS — FINAL
-- This is the only SQL file you need. It replaces v1–v4.1.
--
-- HOW TO USE (Supabase SQL Editor):
--   STEP 1: Run the whole SETUP section (parts 1-3) top to bottom. It is
--           re-runnable -- run it again any time you edit the override
--           lists or a classification rule.
--   STEP 2: Run the numbered queries (each is a few lines, run one at a
--           time, export the results grid to CSV).
--   AFTER ANY SCRAPE:  SELECT refresh_dues_views();
--
-- TWO LAYERS -- this matters when editing:
--   villa_owner_map / villa_dues_lines        = plain views, the LOGIC.
--                                               NEVER DROP villa_owner_map:
--                                               13 objects depend on it
--                                               (synthetic_villa_income_lines
--                                               -> folios_unified -> the
--                                               Overview tab). Always
--                                               CREATE OR REPLACE.
--   villa_owner_map_mv / villa_dues_lines_mv  = materialised + indexed,
--                                               what analytics_villa_fees.py
--                                               reads.
--   Editing a plain view does NOT change the tab until a refresh runs.
--
-- BACKEND: analytics_villa_fees.py must query the _mv names. Nothing else
-- in the codebase should -- other pages read villa_owner_map directly and
-- must keep doing so.
--
-- WHAT THE VIEWS ENCODE (everything we established):
--   * Fee buckets per the GL classification:
--       Maintenance Fees           (Members dues and subscription)
--       Capital Expenditure Fees   (Advance on share; monthly + annual summed)
--       Annual Fees - Family Membership (Deferred family membership)
--       GCT on Family Membership   (tax, kept separate)
--   * Member -> villa: manual override > villa named in the member record
--     (the parenthetical, e.g. "Shirley Beasley (Round House)") > stays /
--     homeowner bookings. Includes 23Z -> Hummingbird House override.
--   * Villa size: manual override > room_lookup (the PMS property register)
--     > MAX bedroom count ever recorded in bookings. One constant size per
--     villa. Now that the register is wired in, most of the
--     villa_bedroom_overrides entries below should be unnecessary — verify
--     with query 8 before deleting them.
--   * room_lookup is authoritative for room -> villa and for villa naming.
--     It closes two gaps bookings cannot: rooms that never carry a
--     villa_name on any booking row (V06, V09, V11, V20, V301, V37, V51,
--     V73, V80, 311B), and villa-name aliases (V89 booked as both
--     'Infinity' and 'inf'). mapping_basis now distinguishes 'homeowner
--     booking' > 'stays (room register)' > 'stays/bookings' so you can see
--     which members rest on the weakest evidence.
--   * Junk 'ZZ%' room types excluded; reversal lines excluded.
--   * CODED descriptions on older statements are matched as equals of their
--     spelled-out forms (added 2026-08-06):
--         MDUES             = Monthly Maintenance Fee
--         CAPIT.            = Capital Expenditure Contribution
--         Family Memb. Dues = Family Membership Dues
--         Fam. Mem. Dues    = Family Membership Dues
--     The family pattern is fam(ily|.)?\s*mem — it must cover BOTH the
--     "Famil-" and "Fam." stems. Month-name billing periods
--     ("Dec. `19 - Nov.2020") are stripped from charge_name alongside the
--     slash-date form, so a charge groups as one row across years.
--     Before this, all three were dropped entirely: MDUES matched no
--     pattern, '%capital%' missed "CAPIT." (truncated, no "al"), and
--     '%family membership%' missed "Family Memb.". Coded statements
--     therefore captured the ANNUAL capex contribution but not the MONTHLY
--     capex line, and no maintenance or family membership dues at all.
--     NOTE the family fix had to go in TWO places: the WHERE filter and the
--     Deferred branch of the CASE. Widening only the filter would have let
--     "Adj- Family Memb." lines land in the BASE family bucket instead of
--     Deferred — right grand total, wrong column.
--
-- KNOWN DATA NOTES for the write-up:
--   * Multi-member coverage starts Dec 2024. "2024" ~= one month of charges.
--     2025 is the only complete year. 2026 is partial. The 20-year trend
--     must come from the accounting GL (annual credits to the three GL
--     accounts, 2006–2025).
--   * PRE-2024 COVERAGE IS UNVERIFIED. The old note here said 2019–2023 was
--     member 1A only; that is wrong (e.g. member 306 has a Dec 2019
--     statement), and recovering the coded lines above may surface more.
--     Run query 3 and rewrite this line with what it actually returns.
--   * FEE YEAR vs BILLING YEAR. `year` is the TRANSACTION year, not the year
--     the fee covers. The 2020 capex contribution is dated 12/31/2019, so it
--     lands in 2019 — a member can show 12 monthly charges plus next year's
--     annual contribution in one year. Fine for "what was billed in period",
--     wrong if read as "what the 2020 fees were". Decide which the write-up
--     means before quoting annual capex totals.
--   * Maintenance includes special assessments (e.g. member 61 ~ $390k in
--     2025) — split before comparing growth to inflation.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SETUP — re-runnable. Run after editing the override lists or any
-- classification rule, then the whole section top to bottom.
--
-- Structure: the LOGIC lives in two plain views (*_src). The names the
-- backend reads -- villa_owner_map / villa_dues_lines -- are MATERIALISED
-- copies with indexes. The Annual Fees page fires 7 endpoints, 6 of which
-- join villa_owner_map; as plain views every request recomputed the whole
-- CTE chain (~18 scans of rate_details/folios per page load) and re-ran the
-- regex classification over all of statement_details. Materialising pays
-- that once, here, instead of on every request.
--
-- COST: the page is only as fresh as the last refresh. Section 3 below
-- defines refresh_dues_views() -- it MUST be called after every scraper
-- load or the page serves stale dues with no error and no symptom.
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the materialised copies first so the source views underneath can be
-- replaced even when their column list changes. IF EXISTS covers both a
-- clean install and an upgrade from the older plain-view layout.

CREATE OR REPLACE VIEW villa_owner_map_src AS
WITH member_villa_overrides(member_number, override_villa) AS (
    VALUES
        ('23Z', 'Hummingbird House')   -- Andrew Crawford, 2nd account of 23B
        -- add member-level fixes here: ('member#', 'Villa Name')
),
villa_bedroom_overrides(villa_name, override_bedrooms) AS (
    VALUES
        -- Fill in real bedroom counts as you confirm them (they beat the
        -- automatic MAX-from-bookings). NULL rows are ignored.
        ('Eagles Nest',        NULL::int),
        ('Coo Yah',            NULL::int),
        ('Island House',       NULL::int),
        ('Folly',              NULL::int),
        ('Adyta',              NULL::int),
        ('Lot #3 Garden Hill', NULL::int),
        ('Lot #7 Garden Hill', NULL::int),
        ('One Love',           NULL::int),
        ('Idlehour (Captains Choice)', NULL::int),  -- was 'Captains Choice'
        ('Rum Punch',          NULL::int),
        ('Lion''S Lair',       NULL::int),
        ('Hanover Windward Gardens',   NULL::int)   -- was 'Windward'
),
-- room_lookup is the PROPERTY REGISTER scraped from the PMS
-- (room_number, villa_name, display_name, max_persons, bedroom_count,
-- room_id, room_type_id). It is authoritative for room -> villa and for
-- villa size; bookings are only evidence of who stayed where.
lookup_rooms AS (
    SELECT
        UPPER(TRIM(rl.room_number))                                  AS room_number,
        TRIM(rl.villa_name)                                          AS villa_name,
        NULLIF(rl.bedroom_count, 0)                                  AS bedroom_count
    FROM room_lookup rl
    WHERE TRIM(COALESCE(rl.room_number, '')) <> ''
      AND TRIM(COALESCE(rl.villa_name, ''))  <> ''
      AND rl.villa_name  NOT ILIKE 'zz%'
      AND rl.room_number NOT ILIKE 'zz%'
),
villa_catalog AS (
    -- Names from room_lookup are weighted so they win the canonical-name
    -- vote outright. Fixes booking-side aliases (e.g. 'inf' vs 'Infinity').
    SELECT
        TRIM(u.villa_name)                                           AS villa_name,
        LOWER(REGEXP_REPLACE(u.villa_name, '[^a-zA-Z0-9]', '', 'g')) AS villa_key,
        SUM(u.w)                                                     AS n
    FROM (
        SELECT villa_name, 1000000 AS w FROM lookup_rooms
        UNION ALL
        SELECT villa_name, 1 FROM rate_details
        UNION ALL
        SELECT villa_name, 1 FROM folios
    ) u
    WHERE TRIM(COALESCE(u.villa_name, '')) <> ''
      AND u.villa_name NOT ILIKE 'zz%'
    GROUP BY 1, 2
),
villa_canonical AS (
    SELECT DISTINCT ON (villa_key) villa_key, villa_name, n
    FROM villa_catalog
    ORDER BY villa_key, n DESC
),
villa_bedrooms_booked AS (
    -- Fallback only: MAX ever recorded (room-level bookings stamp low
    -- bedroom counts, so max approximates the villa's true size).
    SELECT TRIM(u.villa_name) AS villa_name, MAX(u.bedroom_count) AS bedroom_count
    FROM (
        SELECT villa_name, bedroom_count FROM rate_details
        UNION ALL
        SELECT villa_name, bedroom_count FROM folios
    ) u
    WHERE TRIM(COALESCE(u.villa_name, '')) <> ''
      AND u.villa_name NOT ILIKE 'zz%'
      AND u.bedroom_count IS NOT NULL
    GROUP BY 1
),
villa_bedrooms_lookup AS (
    -- Authoritative: full capacity = MAX across the villa's rooms in the
    -- register (a villa let as separate units has one row per unit).
    SELECT villa_name, MAX(bedroom_count) AS bedroom_count
    FROM lookup_rooms
    WHERE bedroom_count IS NOT NULL
    GROUP BY 1
),
villa_bedrooms AS (
    SELECT
        COALESCE(l.villa_name, b.villa_name)              AS villa_name,
        COALESCE(l.bedroom_count, b.bedroom_count)        AS bedroom_count
    FROM villa_bedrooms_lookup l
    FULL OUTER JOIN villa_bedrooms_booked b USING (villa_name)
),
non_villa_parentheticals(bad) AS (
    -- Parentheticals that are PMS flags/notes, NOT villa names. Without
    -- this they become pseudo-villas with no bedroom count and block the
    -- member from falling through to real evidence.
    -- Add any others query 11b turns up.
    VALUES ('do not post'), ('do not disturb'), ('dnd'), ('deceased'),
           ('inactive'), ('resigned'), ('no post'), ('do not mail')
),
name_villa AS (
    SELECT m.member_number,
           TRIM((REGEXP_MATCH(m.member_full_name, '\(([^)]+)'))[1]) AS raw_villa
    FROM members m
    WHERE m.member_full_name LIKE '%(%'
      AND LOWER(TRIM((REGEXP_MATCH(m.member_full_name, '\(([^)]+)'))[1]))
          NOT IN (SELECT bad FROM non_villa_parentheticals)
),
name_villa_resolved AS (
    -- Resolves the parenthetical in "Carol Wedderburn (Windward)" to a real
    -- villa. Matching is exact, then prefix, then CONTAINS -- the contains
    -- rule is what lets 'Windward' reach 'Hanover Windward Gardens'.
    -- villa_name is NULL when nothing matched; raw_villa is kept separately
    -- so an UNRESOLVED guess can never outrank real evidence (see the final
    -- SELECT: resolved name > stays > raw parenthetical).
    SELECT DISTINCT ON (nv.member_number)
        nv.member_number,
        vc.villa_name   AS villa_name,
        nv.raw_villa    AS raw_villa
    FROM (
        SELECT member_number, raw_villa,
               LOWER(REGEXP_REPLACE(raw_villa, '[^a-zA-Z0-9]', '', 'g')) AS villa_key
        FROM name_villa
        WHERE LENGTH(TRIM(raw_villa)) > 2
    ) nv
    LEFT JOIN villa_canonical vc
      ON vc.villa_key = nv.villa_key
      OR (LENGTH(nv.villa_key) >= 5 AND vc.villa_key LIKE nv.villa_key || '%')
      OR (LENGTH(vc.villa_key) >= 5 AND nv.villa_key LIKE vc.villa_key || '%')
      -- CONTAINS: 'windward' inside 'hanoverwindwardgardens'.
      -- Length guard >= 6 so short names ('folly', 'irie') cannot match
      -- loosely inside unrelated villa names.
      OR (LENGTH(nv.villa_key) >= 6 AND vc.villa_key LIKE '%' || nv.villa_key || '%')
    ORDER BY nv.member_number,
             (vc.villa_key = nv.villa_key) DESC NULLS LAST,
             (vc.villa_key LIKE nv.villa_key || '%') DESC NULLS LAST,
             ABS(LENGTH(COALESCE(vc.villa_key, '')) - LENGTH(nv.villa_key)),
             vc.n DESC NULLS LAST
),
room_villa_booked AS (
    SELECT DISTINCT ON (room_number) room_number, villa_name
    FROM (
        SELECT UPPER(TRIM(u.room_number)) AS room_number,
               TRIM(u.villa_name) AS villa_name, COUNT(*) AS n
        FROM (
            SELECT room_number, villa_name FROM rate_details
            UNION ALL
            SELECT room_number, villa_name FROM folios
        ) u
        WHERE TRIM(COALESCE(u.room_number, '')) <> ''
          AND TRIM(COALESCE(u.villa_name, '')) <> ''
          AND u.villa_name NOT ILIKE 'zz%'
        GROUP BY 1, 2
    ) g
    ORDER BY room_number, n DESC
),
room_villa_map AS (
    -- Register wins; booking-derived mapping only covers rooms the
    -- register does not list. Names are canonicalised either way.
    SELECT
        COALESCE(l.room_number, b.room_number)                       AS room_number,
        COALESCE(vc.villa_name,
                 l.villa_name,
                 b.villa_name)                                       AS villa_name
    FROM lookup_rooms l
    FULL OUTER JOIN room_villa_booked b ON b.room_number = l.room_number
    LEFT JOIN villa_canonical vc
      ON vc.villa_key = LOWER(REGEXP_REPLACE(
             COALESCE(l.villa_name, b.villa_name), '[^a-zA-Z0-9]', '', 'g'))
),
owner_unit AS (
    -- THE NUMBERING CONVENTION: a member's own villa is unit 'V' + their
    -- member number (V37, V56, V17A, and zero-padded forms V06 / V301).
    -- This is the ONLY path that works for owners who never appear in
    -- rooms/rate_details/folios -- their GUESTS occupy the villa, so
    -- occupancy-based evidence points at the guest, not the owner.
    -- Verify with query 10 before trusting it.
    SELECT DISTINCT
        am.member_number,
        l.villa_name
    FROM (SELECT member_number FROM members) am
    JOIN lookup_rooms l
      ON l.room_number = ANY (
             -- Exact form always. Plus a zero-padded form ONLY for
             -- single-digit members (V06, V09 exist in the register).
             --
             -- DO NOT use LPAD without a length guard: LPAD TRUNCATES when
             -- the input is longer than the target, so LPAD('309',2,'0')
             -- returns '30' and silently maps member 309 to V30's villa.
             -- That bug mapped members 1001-1099 to V10 and 1100-1199 to
             -- V11 before it was caught.
             ARRAY['V' || UPPER(TRIM(am.member_number))]
             || CASE WHEN TRIM(am.member_number) ~ '^[0-9]$'
                     THEN ARRAY['V0' || TRIM(am.member_number)]
                     ELSE ARRAY[]::text[]
                END
             || CASE WHEN TRIM(am.member_number) ~ '^0[0-9]+$'
                     THEN ARRAY['V' || LTRIM(TRIM(am.member_number), '0')]
                     ELSE ARRAY[]::text[]
                END
             -- OWNER GENERATION: a trailing letter marks the successive
             -- owner of the SAME villa (37 -> 37A -> ...; 91 -> 91A;
             -- 11A -> 11B; 4B -> 4Z). The villa is the BASE number, so
             -- member 91A must resolve to V91, not the non-existent V91A.
             || CASE WHEN TRIM(am.member_number) ~ '^[0-9]+[A-Za-z]+$'
                     THEN ARRAY['V' || REGEXP_REPLACE(
                                    UPPER(TRIM(am.member_number)),
                                    '[A-Z]+$', '')]
                     ELSE ARRAY[]::text[]
                END
         )
),
member_base AS (
    -- Base villa number for a member: member number minus the trailing
    -- owner-generation letters. 37 and 37A both have base '37'.
    SELECT member_number,
           REGEXP_REPLACE(UPPER(TRIM(member_number)), '[A-Z]+$', '') AS base
    FROM members
    WHERE TRIM(member_number) ~ '^[0-9]+[A-Za-z]*$'
),
lineage_villa AS (
    -- A member inherits the villa of a SIBLING sharing the same base
    -- number, when that sibling has an explicit homeowner booking.
    -- This is how a long-inactive first owner (e.g. member 309, whose
    -- unit is not in room_lookup) reaches the villa their successor
    -- (309A) is recorded against.
    SELECT DISTINCT mb.member_number, TRIM(rd.villa_name) AS villa_name
    FROM member_base mb
    JOIN member_base sib      ON sib.base = mb.base
                             AND sib.member_number <> mb.member_number
    JOIN rate_details rd      ON rd.member_number = sib.member_number
    WHERE rd.source ILIKE 'H%' AND rd.source ILIKE '%homeowner%'
      AND TRIM(COALESCE(rd.villa_name, '')) <> ''
      AND rd.villa_name NOT ILIKE 'zz%'
),
ownership_evidence AS (
    -- strength 6 = homeowner-source booking (explicit PMS ownership)
    SELECT rd.member_number, TRIM(rd.villa_name) AS villa_name, 6 AS strength
    FROM rate_details rd
    WHERE rd.member_number IS NOT NULL
      AND TRIM(COALESCE(rd.villa_name, '')) <> ''
      AND rd.villa_name NOT ILIKE 'zz%'
      AND rd.source ILIKE 'H%' AND rd.source ILIKE '%homeowner%'
    UNION ALL
    -- strength 5 = the member's OWN unit by the numbering convention.
    SELECT ou.member_number, ou.villa_name, 5
    FROM owner_unit ou
    UNION ALL
    -- strength 4 = villa of a same-base sibling with a homeowner booking.
    SELECT lv.member_number, lv.villa_name, 4
    FROM lineage_villa lv
    UNION ALL
    -- strength 3 = member occupied a room the REGISTER ties to a villa.
    -- This is the coverage win: rooms the register lists but that never
    -- carry a villa_name on any booking row.
    SELECT ro.member_number, l.villa_name, 3
    FROM rooms ro
    JOIN lookup_rooms l ON l.room_number = UPPER(TRIM(ro.room_number))
    WHERE ro.member_number IS NOT NULL
    UNION ALL
    -- strength 2 = room -> villa inferred from bookings only
    SELECT ro.member_number, rvm.villa_name, 2
    FROM rooms ro
    JOIN room_villa_map rvm ON rvm.room_number = UPPER(TRIM(ro.room_number))
    WHERE ro.member_number IS NOT NULL
    UNION ALL
    SELECT f.member_number, TRIM(f.villa_name), 1
    FROM folios f
    WHERE f.member_number IS NOT NULL
      AND TRIM(COALESCE(f.villa_name, '')) <> ''
      AND f.villa_name NOT ILIKE 'zz%'
),
stay_villa AS (
    SELECT DISTINCT ON (member_number) member_number, villa_name, strength
    FROM (
        SELECT member_number, villa_name,
               MAX(strength) AS strength, COUNT(*) AS n
        FROM ownership_evidence
        GROUP BY member_number, villa_name
    ) e
    ORDER BY member_number, strength DESC, n DESC, villa_name
),
all_members AS (
    SELECT member_number FROM members
)
SELECT
    am.member_number,
    COALESCE(mvo.override_villa,
             nvr.villa_name,      -- parenthetical RESOLVED to a register villa
             nvr.raw_villa,       -- parenthetical that resolves to NOTHING:
                                  -- still the club's record of what the member
                                  -- OWNS, and some real villas are absent from
                                  -- room_lookup entirely (Lot #3 Garden Hill,
                                  -- Lot #7 Garden Hill, Adyta). Must outrank
                                  -- stays: a member's own villa beats wherever
                                  -- they happened to stay. Junk fragments are
                                  -- excluded upstream by
                                  -- non_villa_parentheticals.
             sv.villa_name)       -- evidence (homeowner booking / unit no.)
                                                                 AS villa_name,
    COALESCE(
        vbo.override_bedrooms,
        vb.bedroom_count
    )                                                            AS bedroom_count,
    CASE
        WHEN mvo.override_villa IS NOT NULL THEN 'manual override'
        WHEN nvr.villa_name     IS NOT NULL THEN 'registry (member name)'
        WHEN nvr.raw_villa      IS NOT NULL
            THEN 'registry name, not in register (no bedrooms)'
        WHEN sv.strength = 6    THEN 'homeowner booking'
        WHEN sv.strength = 5    THEN 'unit number (V+member)'
        WHEN sv.strength = 4    THEN 'owner lineage (same base number)'
        WHEN sv.strength = 3    THEN 'stays (room register)'
        WHEN sv.villa_name      IS NOT NULL THEN 'stays/bookings'
        ELSE 'unmapped'
    END                                                          AS mapping_basis
FROM all_members am
LEFT JOIN member_villa_overrides mvo ON mvo.member_number = am.member_number
LEFT JOIN name_villa_resolved nvr    ON nvr.member_number = am.member_number
LEFT JOIN stay_villa sv              ON sv.member_number  = am.member_number
LEFT JOIN villa_bedroom_overrides vbo
  ON vbo.villa_name = COALESCE(mvo.override_villa, nvr.villa_name,
                               nvr.raw_villa, sv.villa_name)
LEFT JOIN villa_bedrooms vb
  ON vb.villa_name  = COALESCE(mvo.override_villa, nvr.villa_name,
                               nvr.raw_villa, sv.villa_name);


CREATE OR REPLACE VIEW villa_dues_lines AS
SELECT
    sd.member_number,
    sd.transaction_date,
    EXTRACT(YEAR FROM sd.transaction_date)::int                 AS year,
    CASE
        -- TAX FIRST: GCT rides on other fees and must never land in a fee
        -- bucket. Matches "Gct - ...", "Adj- G.C.T- ...", etc.
        WHEN sd.description ILIKE '%gct%'
          OR sd.description ILIKE '%g.c.t%'
            THEN 'GCT on Family Membership (tax)'
        -- "Adj- Family Membership Dues ..." billing — the Deferred slice
        -- of family membership, kept as its own fee type per request.
        -- Regex covers the abbreviated "Family Memb." form too; matching
        -- only the spelled-out text here would silently drop Adj- lines
        -- into the base Family Membership bucket.
        WHEN sd.description ILIKE 'adj%'
         AND sd.description ~* 'fam(ily|\.)?\s*mem'
            THEN 'Annual Fees - Family Membership Deferred'
        -- MAINTENANCE: spelled out, or the MDUES / MDUE code used on
        -- older statements. Word-boundary regex so it cannot fire inside
        -- a longer word.
        WHEN sd.description ILIKE '%monthly maintenance fee%'
          OR sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
            THEN 'Maintenance Fees'
        -- CAPEX: the full phrase, or the truncated CAPIT. / CAPIT code.
        -- MUST be 'capital expenditure', NOT '%capital%'. The loose
        -- pattern swept in things that merely contain the word:
        --   'UMB Bank Chq#1005 ... - Capital Expenses'  (a cheque PAYMENT)
        --   'Kovo Capital Ventures / ...'               (an entity NAME)
        --   'Kovo Capital Ventures JE Member Adjustment ...' (journal entry)
        -- Those put -500,000 into Someday Soon's 2025 capex and ~205,000
        -- of member-adjustment journal entries into Harmony Hill's 2022.
        -- 'CAPIT.' still matches via its own regex; 'Capital Expenditure
        -- Contribution', its dated variants, and 'Rebate:'/'Adj-' forms
        -- all still match the phrase.
        WHEN sd.description ILIKE '%capital expenditure%'
          OR sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
            THEN 'Capital Expenditure Fees'
        ELSE 'Annual Fees - Family Membership'
    END                                                         AS fee_type,
    -- Clean charge name: collapse newlines/extra spaces, drop the billing
    -- period ("11/01/2025 to 10/31/2026"), trailing reference numbers, and
    -- a trailing fee year ("Capital Expenditure Contribution 2020"), so the
    -- same charge groups as one row across years.
    -- Coded lines map onto their exact spelled-out equivalents (confirmed):
    --     MDUES  = Monthly Maintenance Fee
    --     CAPIT. = Capital Expenditure Contribution
    CASE
        WHEN sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
         AND sd.description NOT ILIKE '%maintenance%'
            THEN 'Monthly Maintenance Fee'
        WHEN sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
         AND sd.description NOT ILIKE '%capital expenditure%'
            THEN 'Capital Expenditure Contribution'
        ELSE TRIM(REGEXP_REPLACE(
             REGEXP_REPLACE(
                 REGEXP_REPLACE(
                     REGEXP_REPLACE(
                         REGEXP_REPLACE(
                             REGEXP_REPLACE(
                                 -- expand "Family Memb." / "Fam. Mem." to the
                                 -- full form IN PLACE, so all three spellings
                                 -- group as one charge without losing the
                                 -- "Adj-" prefix or the billing period.
                                 REGEXP_REPLACE(sd.description,
                                     'fam(ily|\.)?\s*mem(b(ership)?)?\.?',
                                     'Family Membership', 'gi'),
                                 '\s+', ' ', 'g'),
                             '\d{2}/\d{2}/\d{4}\s*to\s*\d{2}/\d{2}/\d{4}', '', 'g'),
                         -- month-name billing period: "Dec. `19 - Nov.2020"
                         '\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*(-|to|through)\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*$', '', 'gi'),
                     '\s*-\s*\d+$', ''),
                 -- single month-year tail: "Special Assessment Nov 2025"
                 '\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*$', '', 'gi'),
             '\s+(19|20)\d{2}$', ''))
    END                                                         AS charge_name,
    COALESCE(NULLIF(sd.charge, 0), sd.amount, 0)                AS billed_amount
FROM statement_details sd
WHERE sd.transaction_date IS NOT NULL
  AND sd.description NOT ILIKE 'reversal%'
  AND (
        -- Only the standard recurring maintenance fee. One-off maintenance
        -- work (contractor invoices, storm repairs) is NOT dues and is
        -- excluded from this dataset entirely.
        sd.description ILIKE '%monthly maintenance fee%'
     -- full phrase only: '%capital%' also matched cheque payments and
     -- entity names such as 'Kovo Capital Ventures'
     OR sd.description ILIKE '%capital expenditure%'
     OR sd.description ILIKE '%deferred%'
     -- covers "Family Membership", "Family Memb." and "Family Memb"
     OR sd.description ~* 'fam(ily|\.)?\s*mem'
     -- coded equivalents on older statements
     OR sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
     OR sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
  );


-- ════════════════════════════════════════════════════════════════════════════
-- SETUP part 2 — materialised copies + indexes (what the tab reads)
-- ════════════════════════════════════════════════════════════════════════════
-- These are SEPARATE OBJECTS with new names. villa_owner_map itself is NOT
-- materialised and NOT dropped: 13 objects depend on it, including
-- synthetic_villa_income_lines -> folios_unified -> the whole Overview tab.
-- Replacing it in place (CREATE OR REPLACE above) leaves all of them intact.

-- villa_owner_map is read by 13 objects, including
-- synthetic_villa_income_lines -> folios_unified -> folios_unified_display,
-- which /analytics/visits-rooms-dashboard queries directly. As a plain
-- view it recomputed the whole CTE chain on EVERY request: owner_unit
-- builds a candidate array per member and joins it to room_lookup across
-- all ~38k members, plus lineage_villa's self-join and two FULL OUTER
-- JOINs. That is what started timing out the villas dashboard.
--
-- Fix: the logic lives in villa_owner_map_src; villa_owner_map becomes a
-- THIN READ over a materialised, indexed copy. Same name, same columns,
-- so every dependant keeps working and none of them recompute anything.
--
-- The three statements below are ordered to be re-runnable. Step 1 points
-- villa_owner_map back at _src so the matview can be dropped without a
-- dependency error on the second and later runs.
CREATE OR REPLACE VIEW villa_owner_map AS SELECT * FROM villa_owner_map_src;

DROP MATERIALIZED VIEW IF EXISTS villa_owner_map_mv;
CREATE MATERIALIZED VIEW villa_owner_map_mv AS
SELECT * FROM villa_owner_map_src;

-- UNIQUE index is REQUIRED for REFRESH ... CONCURRENTLY, and serves the
-- member_number joins every dependant makes.
CREATE UNIQUE INDEX villa_owner_map_mv_pk    ON villa_owner_map_mv (member_number);
CREATE INDEX        villa_owner_map_mv_villa ON villa_owner_map_mv (villa_name);

-- Now repoint the public name at the materialised copy.
CREATE OR REPLACE VIEW villa_owner_map AS SELECT * FROM villa_owner_map_mv;

DROP MATERIALIZED VIEW IF EXISTS villa_dues_lines_mv;
-- No natural unique key (a member can have two identical lines on one day),
-- so a surrogate is generated IN THE DEFINITION -- ALTER TABLE ... ADD
-- COLUMN does not work on a materialised view.
CREATE MATERIALIZED VIEW villa_dues_lines_mv AS
SELECT dl.*, row_number() OVER () AS mv_row_id
FROM villa_dues_lines dl;

CREATE UNIQUE INDEX villa_dues_lines_mv_pk       ON villa_dues_lines_mv (mv_row_id);
CREATE INDEX        villa_dues_lines_mv_year     ON villa_dues_lines_mv (year);
CREATE INDEX        villa_dues_lines_mv_member   ON villa_dues_lines_mv (member_number);
CREATE INDEX        villa_dues_lines_mv_year_fee ON villa_dues_lines_mv (year, fee_type);

ANALYZE villa_owner_map_mv;
ANALYZE villa_dues_lines_mv;


-- ════════════════════════════════════════════════════════════════════════════
-- SETUP part 3 — refresh. Wire into the loader (end of cleaner.py).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_dues_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- CONCURRENTLY removed 2026-08-07: it is disallowed inside a
    -- transaction block, and a plpgsql body always runs in one, so this
    -- function raised "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot be
    -- executed from a function" on every call and never refreshed anything.
    -- Non-concurrent takes a brief write lock instead. Run it when nobody
    -- is on the page (i.e. straight after a load), not mid-session.
    REFRESH MATERIALIZED VIEW villa_owner_map_mv;
    REFRESH MATERIALIZED VIEW villa_dues_lines_mv;
    -- villa_owner_map feeds synthetic_villa_income_lines ->
    -- folios_unified -> folios_unified_display -> overview_transaction_lines.
    -- That last one is itself materialised, so a villa-mapping change is
    -- invisible on the Overview tab until it is refreshed too.
    BEGIN
        REFRESH MATERIALIZED VIEW overview_transaction_lines;
    EXCEPTION WHEN undefined_table THEN
        NULL;   -- not present in every environment
    END;
    -- overview_villa_bookings is built FROM overview_transaction_lines, so
    -- it must be refreshed after it, or the Finance card sees new
    -- transaction lines while Bookings at a glance still sees the old
    -- booking rollup. Same order as REFRESH_STATEMENTS in overview_sql.py.
    BEGIN
        REFRESH MATERIALIZED VIEW overview_villa_bookings;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
END;
$$;

-- Call after every load:   SELECT refresh_dues_views();
SELECT refresh_dues_views();

-- ════════════════════════════════════════════════════════════════════════════
-- QUERIES — run one at a time
-- ════════════════════════════════════════════════════════════════════════════

-- 0. PRE-FLIGHT / BLAST RADIUS. Run this BEFORE re-running SETUP.
--    Lists everything that depends on villa_owner_map. CREATE OR REPLACE
--    keeps them all working, but any change to the villa mapping FLOWS
--    THROUGH synthetic_villa_income_lines into folios_unified and the
--    Overview tab. Re-check Overview totals after changing the mapping.
--    (Never DROP villa_owner_map. CASCADE would take all of these with it.)
WITH RECURSIVE deps AS (
    SELECT c.oid, c.relname::text AS name, c.relkind, 1 AS depth
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'villa_owner_map' AND n.nspname = current_schema()
    UNION
    SELECT c.oid, c.relname::text, c.relkind, d.depth + 1
    FROM deps d
    JOIN pg_depend  dep ON dep.refobjid = d.oid
    JOIN pg_rewrite rw  ON rw.oid = dep.objid
    JOIN pg_class   c   ON c.oid = rw.ev_class
    WHERE c.oid <> d.oid AND d.depth < 10
)
SELECT DISTINCT
    depth,
    name,
    CASE relkind WHEN 'v' THEN 'view'
                 WHEN 'm' THEN 'materialised view'
                 ELSE relkind::text END AS object_type
FROM deps
ORDER BY depth, name;


-- 1. DUES BY YEAR × FEE TYPE (all villas)
SELECT
    dl.year,
    dl.fee_type,
    ROUND(SUM(dl.billed_amount)::numeric, 2)          AS total_billed,
    COUNT(DISTINCT dl.member_number)::int             AS members_billed,
    ROUND((SUM(dl.billed_amount)
        / NULLIF(COUNT(DISTINCT dl.member_number), 0))::numeric, 2)
                                                      AS avg_per_member
FROM villa_dues_lines dl
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2. DUES BY YEAR × FEE TYPE × VILLA SIZE
SELECT
    dl.year,
    dl.fee_type,
    om.bedroom_count,
    COUNT(DISTINCT om.villa_name)                     AS villas,
    COUNT(DISTINCT dl.member_number)::int             AS members_billed,
    ROUND(SUM(dl.billed_amount)::numeric, 2)          AS total_billed,
    ROUND((SUM(dl.billed_amount)
        / NULLIF(COUNT(DISTINCT dl.member_number), 0))::numeric, 2)
                                                      AS avg_per_member
FROM villa_dues_lines dl
LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3 NULLS LAST;

-- 3. VILLAS AND MEMBERS BILLED PER YEAR
SELECT
    dl.year,
    COUNT(DISTINCT om.villa_name)                     AS villas_billed,
    COUNT(DISTINCT dl.member_number)::int             AS members_billed,
    COUNT(DISTINCT dl.member_number) FILTER (
        WHERE om.villa_name IS NULL)::int             AS unmapped_members
FROM villa_dues_lines dl
LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
GROUP BY 1
ORDER BY 1;

-- 4. PER-MEMBER MAPPING CHECK (spot-check who resolved to what)
SELECT
    dl.year,
    dl.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    om.villa_name,
    om.bedroom_count,
    om.mapping_basis,
    ROUND(SUM(dl.billed_amount)::numeric, 2)          AS dues_billed
FROM villa_dues_lines dl
LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
LEFT JOIN members m          ON m.member_number  = dl.member_number
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY (om.villa_name IS NULL) DESC, dl.year, dl.member_number;

-- 5. CHARGE NAMES BY YEAR (use to separate the standard maintenance fee
--    from special assessments before comparing growth to inflation)
SELECT
    dl.year,
    dl.fee_type,
    dl.charge_name,
    COUNT(*)                                          AS lines,
    ROUND(SUM(dl.billed_amount)::numeric, 2)          AS total_billed
FROM villa_dues_lines dl
GROUP BY 1, 2, 3
ORDER BY 1, 2, 5 DESC;
-- 6. CODED-LINE SPOT CHECK (confirms the MDUES / CAPIT. fix took)
--    Member 306, Dec 2019 should return three rows:
--      12/01  Monthly Maintenance Fee          Maintenance Fees          550.00
--      12/01  Capital Expenditure Contribution Capital Expenditure Fees  150.00
--      12/31  Capital Expenditure Contribution Capital Expenditure Fees 5000.00
--    The two capex rows share one charge_name and sum to 5,150.00 for 2019.
SELECT
    dl.transaction_date,
    dl.charge_name,
    dl.fee_type,
    dl.billed_amount
FROM villa_dues_lines dl
WHERE dl.member_number = '306'
  AND dl.year = 2019
ORDER BY dl.transaction_date, dl.charge_name;

-- 7. HUNT FOR MORE CODES. MDUES and CAPIT. are unlikely to be the only
--    abbreviations. Lists every short, all-caps, code-looking description
--    still OUTSIDE the view, most frequent first. Review it and add any real
--    fee codes to the view above, then re-run SETUP.
--    Expect noise — GART, utility lines, F & B minimums are not dues.
SELECT
    TRIM(sd.description)                    AS description,
    COUNT(*)                                AS occurrences,
    COUNT(DISTINCT sd.member_number)        AS members,
    MIN(sd.transaction_date)                AS first_seen,
    MAX(sd.transaction_date)                AS last_seen,
    ROUND(SUM(COALESCE(NULLIF(sd.charge, 0), sd.amount, 0))::numeric, 2)
                                            AS total_amount
FROM statement_details sd
WHERE sd.transaction_date IS NOT NULL
  AND sd.description NOT ILIKE 'reversal%'
  AND LENGTH(TRIM(sd.description)) <= 12
  AND TRIM(sd.description) = UPPER(TRIM(sd.description))
  AND TRIM(sd.description) !~ '^[0-9$(,.\-]+$'
  AND NOT (
        sd.description ILIKE '%monthly maintenance fee%'
     -- full phrase only: '%capital%' also matched cheque payments and
     -- entity names such as 'Kovo Capital Ventures'
     OR sd.description ILIKE '%capital expenditure%'
     OR sd.description ILIKE '%deferred%'
     OR sd.description ~* 'fam(ily|\.)?\s*mem'
     OR sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
     OR sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
  )
GROUP BY 1
ORDER BY occurrences DESC
LIMIT 60;

-- 8. MAPPING QUALITY — run after wiring room_lookup in.
--    Shows how each member resolved to a villa. 'unmapped' rows are the
--    ones to chase; 'stays/bookings' rows rest on inference rather than the
--    property register and are the next weakest.
SELECT
    om.mapping_basis,
    COUNT(*)                                          AS members,
    COUNT(DISTINCT om.villa_name)                     AS villas,
    COUNT(*) FILTER (WHERE om.bedroom_count IS NULL)  AS missing_bedrooms
FROM villa_owner_map om
GROUP BY 1
ORDER BY members DESC;

-- 8b. UNMAPPED MEMBERS THAT ACTUALLY MATTER (billed dues but no villa).
--     Anyone here is silently inflating the "Unmapped" row on the tab.
SELECT
    dl.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    MIN(dl.year)                                      AS first_year,
    MAX(dl.year)                                      AS last_year,
    ROUND(SUM(dl.billed_amount)::numeric, 2)          AS dues_billed
FROM villa_dues_lines dl
LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
LEFT JOIN members m          ON m.member_number  = dl.member_number
WHERE om.villa_name IS NULL
GROUP BY 1, 2
ORDER BY dues_billed DESC;

-- 8c. BEDROOM COUNTS: register vs bookings. Any row where they disagree is
--     either a stale override or a bad MAX inference. Register wins.
SELECT
    COALESCE(l.villa_name, b.villa_name)              AS villa_name,
    l.bedroom_count                                   AS register_bedrooms,
    b.bedroom_count                                   AS booked_max_bedrooms
FROM (
    SELECT TRIM(villa_name) AS villa_name, MAX(NULLIF(bedroom_count, 0)) AS bedroom_count
    FROM room_lookup
    WHERE villa_name NOT ILIKE 'zz%' GROUP BY 1
) l
FULL OUTER JOIN (
    SELECT TRIM(villa_name) AS villa_name, MAX(bedroom_count) AS bedroom_count
    FROM (
        SELECT villa_name, bedroom_count FROM rate_details
        UNION ALL
        SELECT villa_name, bedroom_count FROM folios
    ) u
    WHERE TRIM(COALESCE(villa_name, '')) <> '' AND villa_name NOT ILIKE 'zz%'
    GROUP BY 1
) b USING (villa_name)
WHERE l.bedroom_count IS DISTINCT FROM b.bedroom_count
ORDER BY 1;

-- 8d. IS AN UNMAPPED MEMBER ACTUALLY A VILLA OWNER?
--     Villa owners receive villa-linked lines on their statements (Villa
--     Income credits, Condo Wages/Electricity, Villa Cable, Monitoring).
--     A dues-billed member with NONE of these almost certainly owns no
--     villa -- they are a club/proprietary member, and belong in a
--     "No villa (club member)" bucket rather than "Unmapped".
--     DO NOT write member_villa_overrides rows for members with
--     villa_linked_lines = 0. That invents an ownership that isn't there.
WITH dues_members AS (
    SELECT DISTINCT dl.member_number FROM villa_dues_lines dl
),
villa_signals AS (
    SELECT
        sd.member_number,
        COUNT(*) FILTER (WHERE
              sd.description ILIKE '%villa income%'
           OR sd.description ILIKE '%condo wages%'
           OR sd.description ILIKE '%condo electricity%'
           OR sd.description ILIKE '%villa cable%'
           OR sd.description ILIKE '%villa telephone%'
           OR sd.description ILIKE '%villa recurrent%'
           OR sd.description ILIKE '%water bill%')::int  AS villa_linked_lines
    FROM statement_details sd
    GROUP BY 1
)
SELECT
    dm.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    m.member_type,
    m.status,
    om.villa_name,
    om.mapping_basis,
    COALESCE(vs.villa_linked_lines, 0)                AS villa_linked_lines,
    CASE WHEN COALESCE(vs.villa_linked_lines, 0) = 0
         THEN 'no villa evidence -> likely club member, NOT unmapped'
         ELSE 'villa evidence exists -> genuinely unmapped, needs override'
    END                                               AS verdict
FROM dues_members dm
LEFT JOIN villa_owner_map om ON om.member_number = dm.member_number
LEFT JOIN members m          ON m.member_number  = dm.member_number
LEFT JOIN villa_signals vs   ON vs.member_number = dm.member_number
WHERE om.villa_name IS NULL
ORDER BY villa_linked_lines DESC, dm.member_number;

-- 9. RECOVER VILLA FROM STATEMENT TEXT.
--    For members with NO rows in rooms / rate_details / folios, the only
--    remaining evidence is the statement descriptions themselves, which
--    carry unit identifiers ("... Charles/A4 4 nights", "Villa Cable &
--    Internet Charges", "December Villa Income").
--    This proposes a villa per unmapped member by matching known villa
--    names and known room numbers against their statement text.
--    REVIEW BEFORE USING -- then paste confirmed pairs into
--    member_villa_overrides at the top of this file.
WITH unmapped AS (
    SELECT DISTINCT dl.member_number
    FROM villa_dues_lines dl
    LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
    WHERE om.villa_name IS NULL
),
villa_names AS (
    -- Only names long enough to match safely. Short ones ('Folly',
    -- 'Adyta', 'One Love') generate false hits inside ordinary prose.
    SELECT DISTINCT TRIM(villa_name) AS villa_name
    FROM room_lookup
    WHERE villa_name NOT ILIKE 'zz%'
      AND LENGTH(TRIM(villa_name)) >= 6
),
room_codes AS (
    SELECT DISTINCT UPPER(TRIM(room_number)) AS room_number, TRIM(villa_name) AS villa_name
    FROM room_lookup
    WHERE room_number NOT ILIKE 'zz%'
      AND LENGTH(TRIM(room_number)) >= 2
),
hits AS (
    -- villa name appears verbatim in the description
    SELECT u.member_number, v.villa_name, 'villa name in text' AS how, COUNT(*) AS n
    FROM unmapped u
    JOIN statement_details sd ON sd.member_number = u.member_number
    JOIN villa_names v
      ON sd.description ~* ('(^|[^a-z])' || REGEXP_REPLACE(v.villa_name,
             '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^a-z]|$)')
    GROUP BY 1, 2, 3
    UNION ALL
    -- room code appears in the description ("Charles/A4 4 nights")
    SELECT u.member_number, rc.villa_name, 'room code in text', COUNT(*)
    FROM unmapped u
    JOIN statement_details sd ON sd.member_number = u.member_number
    JOIN room_codes rc
      ON sd.description ~* ('(^|[^a-z0-9])' || rc.room_number || '([^a-z0-9]|$)')
    GROUP BY 1, 2, 3
)
SELECT
    h.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    h.villa_name          AS proposed_villa,
    h.how                 AS evidence,
    h.n                   AS mentions
FROM hits h
LEFT JOIN members m ON m.member_number = h.member_number
ORDER BY h.member_number, h.n DESC;

-- 9b. WHAT DO THEIR STATEMENTS ACTUALLY SAY? Run this for any member query
--     9 cannot place -- read the descriptions and map by hand.
--     Replace the member list with whoever is still unmapped.
SELECT
    sd.member_number,
    MIN(sd.transaction_date)  AS first_seen,
    MAX(sd.transaction_date)  AS last_seen,
    COUNT(*)                  AS lines,
    TRIM(REGEXP_REPLACE(sd.description, '\s+', ' ', 'g')) AS description
FROM statement_details sd
WHERE sd.member_number IN ('309', '37', '56', '85')
GROUP BY 1, 5
ORDER BY 1, lines DESC;

-- 10. VERIFY THE NUMBERING CONVENTION before trusting it.
--     Compares the villa implied by the member's unit number (V+member)
--     against the villa implied by an explicit homeowner booking.
--     'agree' rows confirm the convention. 'CONFLICT' rows mean the
--     convention is wrong for that member -- the homeowner booking wins
--     (strength 5), but investigate and add a member_villa_overrides entry.
WITH unit AS (
    SELECT m.member_number, l.villa_name
    FROM members m
    JOIN room_lookup l
      ON UPPER(TRIM(l.room_number)) = ANY (
             ARRAY['V' || UPPER(TRIM(m.member_number))]
             || CASE WHEN TRIM(m.member_number) ~ '^[0-9]$'
                     THEN ARRAY['V0' || TRIM(m.member_number)]
                     ELSE ARRAY[]::text[] END
             || CASE WHEN TRIM(m.member_number) ~ '^0[0-9]+$'
                     THEN ARRAY['V' || LTRIM(TRIM(m.member_number), '0')]
                     ELSE ARRAY[]::text[] END)
    WHERE l.villa_name NOT ILIKE 'zz%'
),
homeowner AS (
    SELECT DISTINCT rd.member_number, TRIM(rd.villa_name) AS villa_name
    FROM rate_details rd
    WHERE rd.source ILIKE 'H%' AND rd.source ILIKE '%homeowner%'
      AND TRIM(COALESCE(rd.villa_name, '')) <> ''
      AND rd.villa_name NOT ILIKE 'zz%'
)
SELECT
    COALESCE(u.member_number, h.member_number)        AS member_number,
    u.villa_name                                      AS villa_from_unit_number,
    h.villa_name                                      AS villa_from_homeowner_booking,
    CASE
        WHEN u.villa_name IS NULL              THEN 'no unit number match'
        WHEN h.villa_name IS NULL              THEN 'unit number only (no booking to check)'
        WHEN LOWER(REGEXP_REPLACE(u.villa_name, '[^a-zA-Z0-9]', '', 'g'))
           = LOWER(REGEXP_REPLACE(h.villa_name, '[^a-zA-Z0-9]', '', 'g'))
                                               THEN 'agree'
        ELSE 'CONFLICT — investigate'
    END                                               AS verdict
FROM unit u
FULL OUTER JOIN homeowner h USING (member_number)
ORDER BY (CASE WHEN u.villa_name IS NOT NULL AND h.villa_name IS NOT NULL
               AND LOWER(REGEXP_REPLACE(u.villa_name, '[^a-zA-Z0-9]', '', 'g'))
                <> LOWER(REGEXP_REPLACE(h.villa_name, '[^a-zA-Z0-9]', '', 'g'))
          THEN 0 ELSE 1 END), member_number;

-- 10b. DID THE FOUR GET MAPPED? Run after re-running SETUP.
SELECT member_number, villa_name, bedroom_count, mapping_basis
FROM villa_owner_map
WHERE member_number IN ('309', '37', '56', '85')
ORDER BY member_number;

-- 10c. GUARD AGAINST THE TRUNCATION CLASS OF BUG.
--      A unit-number mapping is only trustworthy when the villa is claimed
--      by ONE member. If many members resolve to the same villa via the
--      numbering convention, the matching is too loose -- that is exactly
--      how LPAD truncation mapped 100 members onto V10's villa.
--      Expect 1 member per villa. Anything higher needs investigation.
WITH unit AS (
    SELECT m.member_number, l.villa_name
    FROM members m
    JOIN room_lookup l
      ON UPPER(TRIM(l.room_number)) = ANY (
             ARRAY['V' || UPPER(TRIM(m.member_number))]
             || CASE WHEN TRIM(m.member_number) ~ '^[0-9]$'
                     THEN ARRAY['V0' || TRIM(m.member_number)]
                     ELSE ARRAY[]::text[] END
             || CASE WHEN TRIM(m.member_number) ~ '^0[0-9]+$'
                     THEN ARRAY['V' || LTRIM(TRIM(m.member_number), '0')]
                     ELSE ARRAY[]::text[] END)
    WHERE l.villa_name NOT ILIKE 'zz%'
)
SELECT
    villa_name,
    COUNT(DISTINCT member_number)                     AS members_claiming,
    STRING_AGG(DISTINCT member_number, ', ' ORDER BY member_number) AS member_numbers
FROM unit
GROUP BY 1
HAVING COUNT(DISTINCT member_number) > 1
ORDER BY members_claiming DESC;

-- 11. UNRESOLVED PARENTHETICALS. Every member whose "(Villa)" name fragment
--     did not match a real villa. Each is either a villa missing from
--     room_lookup, a spelling variant needing a wider match, or a member
--     needing a member_villa_overrides entry.
--     mapping_basis = 'UNRESOLVED name (check)' means the raw fragment is
--     being used as a villa name -- it will have NO bedroom count and will
--     appear as its own pseudo-villa in the totals.
SELECT
    om.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    om.villa_name        AS villa_name_used,
    om.bedroom_count,
    om.mapping_basis
FROM villa_owner_map om
LEFT JOIN members m ON m.member_number = om.member_number
WHERE om.mapping_basis = 'UNRESOLVED name (check)'
   OR (om.villa_name IS NOT NULL AND om.bedroom_count IS NULL)
ORDER BY om.mapping_basis, om.member_number;

-- 11b. VILLA NAMES IN USE THAT THE REGISTER DOES NOT KNOW.
--      Anything here is a pseudo-villa: it will split totals away from the
--      real villa and carry no bedroom count.
SELECT
    om.villa_name,
    COUNT(*)                                 AS members,
    MAX(om.mapping_basis)                    AS example_basis
FROM villa_owner_map om
WHERE om.villa_name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM room_lookup rl
      WHERE LOWER(REGEXP_REPLACE(rl.villa_name, '[^a-zA-Z0-9]', '', 'g'))
          = LOWER(REGEXP_REPLACE(om.villa_name, '[^a-zA-Z0-9]', '', 'g'))
  )
GROUP BY 1
ORDER BY members DESC, 1;

-- 12. MAX vs SUM FOR VILLA SIZE — a judgement call, not a bug.
--     villa_bedrooms_lookup uses MAX(bedroom_count) across a villa's rooms.
--     That is correct when the rows are alternative configurations of ONE
--     villa (whole-villa vs part-villa bookings stamp low numbers).
--     It UNDERSTATES villas split into lettered units, e.g.
--        303A  Idlehour (Captains Choice)  "…(Captains Choice-A1)"  1 bed
--     where three 1-bed units mean a 3-bed villa, not a 1-bed villa.
--     Review this list and set the true size in villa_bedroom_overrides at
--     the top of this file for any villa where SUM is the right answer.
SELECT
    TRIM(rl.villa_name)                              AS villa_name,
    COUNT(*)                                         AS rooms_in_register,
    STRING_AGG(DISTINCT UPPER(TRIM(rl.room_number)), ', '
               ORDER BY UPPER(TRIM(rl.room_number))) AS room_numbers,
    MAX(NULLIF(rl.bedroom_count, 0))                 AS size_if_max_used,
    SUM(NULLIF(rl.bedroom_count, 0))                 AS size_if_sum_used,
    MAX(NULLIF(rl.max_persons, 0))                   AS max_persons_per_room
FROM room_lookup rl
WHERE rl.villa_name NOT ILIKE 'zz%'
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY (SUM(NULLIF(rl.bedroom_count, 0)) - MAX(NULLIF(rl.bedroom_count, 0))) DESC,
         1;

-- 12b. STALE BEDROOM OVERRIDES. Entries at the top of this file that no
--      longer match any villa name the register knows -- usually a short
--      fragment left over from before names were canonicalised
--      ('Captains Choice' vs 'Idlehour (Captains Choice)', 'Windward' vs
--      'Hanover Windward Gardens'). These silently do nothing.
WITH overrides(villa_name) AS (
    VALUES ('Eagles Nest'), ('Coo Yah'), ('Island House'), ('Folly'),
           ('Adyta'), ('Lot #3 Garden Hill'), ('Lot #7 Garden Hill'),
           ('One Love'), ('Captains Choice'), ('Rum Punch'),
           ('Lion''S Lair'), ('Windward')
)
SELECT
    o.villa_name                                     AS override_entry,
    CASE WHEN r.villa_name IS NULL
         THEN 'STALE — matches no villa in room_lookup'
         ELSE 'ok — matches ' || r.villa_name END    AS status
FROM overrides o
LEFT JOIN LATERAL (
    SELECT TRIM(rl.villa_name) AS villa_name
    FROM room_lookup rl
    WHERE LOWER(REGEXP_REPLACE(rl.villa_name, '[^a-zA-Z0-9]', '', 'g'))
        = LOWER(REGEXP_REPLACE(o.villa_name, '[^a-zA-Z0-9]', '', 'g'))
    LIMIT 1
) r ON TRUE
ORDER BY (r.villa_name IS NOT NULL), o.villa_name;

-- 13. ALL PARENTHETICALS IN MEMBER NAMES, and whether each resolved.
--     Use this to spot more non-villa notes like 'Do Not Post' (add them to
--     non_villa_parentheticals) and real villas missing from room_lookup
--     (give those a bedroom count in villa_bedroom_overrides instead).
SELECT
    TRIM((REGEXP_MATCH(m.member_full_name, '\(([^)]+)'))[1]) AS parenthetical,
    COUNT(*)                                                 AS members,
    STRING_AGG(DISTINCT m.member_number, ', ')               AS member_numbers,
    CASE WHEN EXISTS (
            SELECT 1 FROM room_lookup rl
            WHERE LOWER(REGEXP_REPLACE(rl.villa_name, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE '%' || LOWER(REGEXP_REPLACE(
                      TRIM((REGEXP_MATCH(m.member_full_name, '\(([^)]+)'))[1]),
                      '[^a-zA-Z0-9]', '', 'g')) || '%'
         ) THEN 'resolves to a register villa'
         ELSE 'NOT in room_lookup — real villa needing an override, or junk'
    END                                                      AS status
FROM members m
WHERE m.member_full_name LIKE '%(%'
GROUP BY 1, 4
ORDER BY 4, 2 DESC, 1;

-- 14. WHERE THE MEMBER-NAME PARENTHETICAL DISAGREES WITH THE EVIDENCE.
--     The parenthetical now outranks stays evidence, so a wrong or stale
--     one silently wins. This lists every member where the two disagree.
--     'agree' is reassuring; a disagreement is either a stale member name
--     or a villa missing from room_lookup. Fix with member_villa_overrides.
WITH parenthetical AS (
    SELECT om.member_number, om.villa_name AS villa_used, om.mapping_basis
    FROM villa_owner_map om
    WHERE om.mapping_basis IN ('registry (member name)',
                               'registry name, not in register (no bedrooms)')
),
homeowner AS (
    SELECT DISTINCT rd.member_number, TRIM(rd.villa_name) AS villa_name
    FROM rate_details rd
    WHERE rd.source ILIKE 'H%' AND rd.source ILIKE '%homeowner%'
      AND TRIM(COALESCE(rd.villa_name, '')) <> ''
      AND rd.villa_name NOT ILIKE 'zz%'
)
SELECT
    p.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    p.villa_used          AS villa_from_member_name,
    h.villa_name          AS villa_from_homeowner_booking,
    p.mapping_basis,
    CASE WHEN h.villa_name IS NULL THEN 'no booking to compare'
         WHEN LOWER(REGEXP_REPLACE(p.villa_used,   '[^a-zA-Z0-9]', '', 'g'))
            = LOWER(REGEXP_REPLACE(h.villa_name,   '[^a-zA-Z0-9]', '', 'g'))
              THEN 'agree'
         ELSE 'DISAGREE — check' END                              AS verdict
FROM parenthetical p
LEFT JOIN homeowner h ON h.member_number = p.member_number
LEFT JOIN members   m ON m.member_number = p.member_number
ORDER BY (CASE WHEN h.villa_name IS NOT NULL
               AND LOWER(REGEXP_REPLACE(p.villa_used, '[^a-zA-Z0-9]', '', 'g'))
                <> LOWER(REGEXP_REPLACE(h.villa_name, '[^a-zA-Z0-9]', '', 'g'))
          THEN 0 ELSE 1 END), p.member_number;

-- 15. WHY MEMBERS > VILLAS IN A GIVEN YEAR.
--     The card shows both counts but not the reason. The gap is:
--       (a) members with NO villa  (villa count ignores NULLs), plus
--       (b) villas billed to MORE THAN ONE member.
--     This decomposes it per year. members_billed should equal
--     villas_billed + unmapped_members + extra_members_on_shared_villas.
SELECT
    dl.year,
    COUNT(DISTINCT om.villa_name)                                  AS villas_billed,
    COUNT(DISTINCT dl.member_number)                               AS members_billed,
    COUNT(DISTINCT dl.member_number) FILTER (
        WHERE om.villa_name IS NULL)                               AS unmapped_members,
    COUNT(DISTINCT dl.member_number) FILTER (
        WHERE om.villa_name IS NOT NULL)
      - COUNT(DISTINCT om.villa_name)                              AS extra_members_on_shared_villas
FROM villa_dues_lines dl
LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
GROUP BY 1
ORDER BY 1;

-- 15b. TRANSFER OR SECOND ACCOUNT? Every villa billed to more than one
--      member in a year, with each member's billing window.
--      NON-OVERLAPPING windows  -> looks like a mid-year OWNERSHIP TRANSFER
--                                  (correct: both were billed that year).
--      OVERLAPPING windows      -> looks like a SECOND/JOINT ACCOUNT, or a
--                                  mapping error putting two owners on one
--                                  villa. Check against query 14.
WITH per_member AS (
    SELECT
        dl.year,
        om.villa_name,
        dl.member_number,
        MIN(dl.transaction_date)                  AS first_billed,
        MAX(dl.transaction_date)                  AS last_billed,
        ROUND(SUM(dl.billed_amount)::numeric, 2)  AS billed
    FROM villa_dues_lines dl
    JOIN villa_owner_map om ON om.member_number = dl.member_number
    WHERE om.villa_name IS NOT NULL
    GROUP BY 1, 2, 3
),
shared AS (
    SELECT year, villa_name
    FROM per_member
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT member_number) > 1
)
SELECT
    p.year,
    p.villa_name,
    p.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    p.first_billed,
    p.last_billed,
    p.billed,
    -- A handover shares ONE boundary date (the transfer date), which a
    -- naive overlap test wrongly reads as a joint account. Require a
    -- MATERIAL overlap (> 31 days) before calling it joint. The outgoing
    -- owner's closing credit shows as a negative amount.
    CASE WHEN EXISTS (
            SELECT 1 FROM per_member q
            WHERE q.year = p.year AND q.villa_name = p.villa_name
              AND q.member_number <> p.member_number
              AND LEAST(q.last_billed, p.last_billed)
                - GREATEST(q.first_billed, p.first_billed) > 31
         ) THEN 'joint/second account — both billed for months'
         WHEN p.billed < 0
              THEN 'transfer OUT — closing credit to previous owner'
         WHEN EXISTS (
            SELECT 1 FROM per_member q
            WHERE q.year = p.year AND q.villa_name = p.villa_name
              AND q.member_number <> p.member_number
              AND q.billed < 0
         ) THEN 'transfer IN — took over from previous owner'
         ELSE 'handover — windows meet, check member records'
    END                                                           AS interpretation
FROM per_member p
JOIN shared s ON s.year = p.year AND s.villa_name = p.villa_name
LEFT JOIN members m ON m.member_number = p.member_number
ORDER BY p.year, p.villa_name, p.first_billed;

-- 16. WHY IS THIS MEMBER UNMAPPED? Evidence audit for every dues-billed
--     member with no villa. Each column is one path villa_owner_map tries.
--     All blank/zero = nothing in the data can place them; they need a
--     member_villa_overrides entry. Anything non-zero = the rule that
--     should have fired did not, which is a bug worth chasing.
WITH unmapped AS (
    SELECT DISTINCT dl.member_number
    FROM villa_dues_lines dl
    LEFT JOIN villa_owner_map om ON om.member_number = dl.member_number
    WHERE om.villa_name IS NULL
),
dues AS (
    SELECT member_number,
           MIN(year) AS first_year, MAX(year) AS last_year,
           ROUND(SUM(billed_amount)::numeric, 2) AS dues_billed
    FROM villa_dues_lines GROUP BY 1
)
SELECT
    u.member_number,
    COALESCE(NULLIF(TRIM(m.member_full_name), ''), m.member_name) AS member_name,
    m.member_type,
    m.status,
    d.first_year, d.last_year, d.dues_billed,

    -- path 1: parenthetical in the member name
    TRIM((REGEXP_MATCH(m.member_full_name, '\(([^)]+)'))[1])      AS parenthetical,

    -- path 2: unit number V+base (does that room exist in the register?)
    'V' || REGEXP_REPLACE(UPPER(TRIM(u.member_number)), '[A-Z]+$', '')
                                                                  AS unit_tried,
    (SELECT TRIM(rl.villa_name) FROM room_lookup rl
      WHERE UPPER(TRIM(rl.room_number)) =
            'V' || REGEXP_REPLACE(UPPER(TRIM(u.member_number)), '[A-Z]+$', '')
      LIMIT 1)                                                    AS unit_villa,

    -- path 3: siblings sharing the base number
    (SELECT STRING_AGG(DISTINCT m2.member_number, ', ')
       FROM members m2
      WHERE REGEXP_REPLACE(UPPER(TRIM(m2.member_number)), '[A-Z]+$', '')
          = REGEXP_REPLACE(UPPER(TRIM(u.member_number)), '[A-Z]+$', '')
        AND m2.member_number <> u.member_number)                  AS siblings,

    -- paths 4-6: the member's own activity
    (SELECT COUNT(*) FROM rate_details rd
      WHERE rd.member_number = u.member_number
        AND rd.source ILIKE 'H%' AND rd.source ILIKE '%homeowner%')::int
                                                                  AS homeowner_bookings,
    (SELECT COUNT(*) FROM rooms ro
      WHERE ro.member_number = u.member_number)::int              AS room_rows,
    (SELECT COUNT(*) FROM folios f
      WHERE f.member_number = u.member_number
        AND TRIM(COALESCE(f.villa_name, '')) <> '')::int          AS folio_rows_with_villa
FROM unmapped u
LEFT JOIN members m ON m.member_number = u.member_number
LEFT JOIN dues    d ON d.member_number = u.member_number
ORDER BY d.dues_billed DESC NULLS LAST;

-- 17. NON-FEE LINES THAT MIGHT STILL BE SLIPPING IN.
--     The fee patterns match on DESCRIPTION TEXT, so anything whose
--     wording happens to contain a fee phrase is captured. Tightening
--     '%capital%' to '%capital expenditure%' removed cheque payments and
--     entity names like 'Kovo Capital Ventures', but the same class of
--     mistake can recur with new wording.
--     This flags captured lines carrying PAYMENT / JOURNAL-ENTRY markers.
--     Review them: a real fee should be a CHARGE, not a settlement of one.
--     NOTE: 'Rebate:' and 'Adj-' lines are legitimate negative fee
--     adjustments and are deliberately NOT flagged here.
SELECT
    dl.year,
    dl.member_number,
    dl.fee_type,
    dl.charge_name,
    ROUND(dl.billed_amount::numeric, 2)  AS amount,
    CASE
        WHEN dl.charge_name ILIKE '%chq%'
          OR dl.charge_name ILIKE '%cheque%'
          OR dl.charge_name ILIKE '%check #%'      THEN 'cheque / payment'
        WHEN dl.charge_name ILIKE '%transfer of funds%'
          OR dl.charge_name ILIKE '%wire%'          THEN 'funds transfer'
        WHEN dl.charge_name ILIKE '%journal entry%'
          OR dl.charge_name ILIKE '% je %'
          OR dl.charge_name ILIKE '%invoice number%' THEN 'journal entry'
        WHEN dl.charge_name ILIKE '%ventures%'
          OR dl.charge_name ILIKE '%ltd%'
          OR dl.charge_name ILIKE '%llc%'
          OR dl.charge_name ILIKE '%inc.%'           THEN 'entity name'
        ELSE 'other'
    END                                   AS marker
FROM villa_dues_lines dl
WHERE dl.charge_name ILIKE '%chq%'
   OR dl.charge_name ILIKE '%cheque%'
   OR dl.charge_name ILIKE '%check #%'
   OR dl.charge_name ILIKE '%transfer of funds%'
   OR dl.charge_name ILIKE '%wire%'
   OR dl.charge_name ILIKE '%journal entry%'
   OR dl.charge_name ILIKE '% je %'
   OR dl.charge_name ILIKE '%invoice number%'
   OR dl.charge_name ILIKE '%ventures%'
   OR dl.charge_name ILIKE '%ltd%'
   OR dl.charge_name ILIKE '%llc%'
   OR dl.charge_name ILIKE '%inc.%'
ORDER BY ABS(dl.billed_amount) DESC;

-- 17b. LARGEST SINGLE LINES PER FEE TYPE — the cheap sanity check.
--      A -500,000 capex line or a +60,000 "contribution" is not a dues
--      charge. Scan the top of this list after any pattern change.
SELECT
    dl.year, dl.fee_type, dl.member_number, dl.charge_name,
    ROUND(dl.billed_amount::numeric, 2) AS amount
FROM villa_dues_lines dl
WHERE ABS(dl.billed_amount) >= 20000
ORDER BY ABS(dl.billed_amount) DESC
LIMIT 60;
