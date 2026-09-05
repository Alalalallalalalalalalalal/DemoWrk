-- ============================================================================
-- HISTORICAL DUES SYNOPSIS — SETUP ONLY
--
-- This is the executable subset of HISTORICAL_DUES_SYNOPSIS.sql: parts 1-3
-- (the views, materialized copies, indexes, and refresh function). It is
-- what backend/sql/run_historical_dues_synopsis.py runs, and what pipeline.py
-- runs as its final stage.
--
-- The full file, HISTORICAL_DUES_SYNOPSIS.sql, additionally contains ~25
-- numbered diagnostic/audit queries (mapping quality checks, unmapped-member
-- investigation, etc.) meant to be run one at a time by hand in the Supabase
-- SQL editor while reviewing results. Those are NOT included here and are
-- NOT run automatically — see the full file for those.
--
-- Re-runnable: safe to execute again any time the override lists or a
-- classification rule in the full file are edited (edit both files).
-- ============================================================================

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
    -- Add any others query 11b (in the full file) turns up.
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
             nvr.villa_name,
             nvr.raw_villa,
             sv.villa_name)
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
        WHEN sd.description ILIKE '%gct%'
          OR sd.description ILIKE '%g.c.t%'
            THEN 'GCT on Family Membership (tax)'
        WHEN sd.description ILIKE 'adj%'
         AND sd.description ~* 'fam(ily|\.)?\s*mem'
            THEN 'Annual Fees - Family Membership Deferred'
        WHEN sd.description ILIKE '%monthly maintenance fee%'
          OR sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
            THEN 'Maintenance Fees'
        WHEN sd.description ILIKE '%capital expenditure%'
          OR sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
            THEN 'Capital Expenditure Fees'
        ELSE 'Annual Fees - Family Membership'
    END                                                         AS fee_type,
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
                                 REGEXP_REPLACE(sd.description,
                                     'fam(ily|\.)?\s*mem(b(ership)?)?\.?',
                                     'Family Membership', 'gi'),
                                 '\s+', ' ', 'g'),
                             '\d{2}/\d{2}/\d{4}\s*to\s*\d{2}/\d{2}/\d{4}', '', 'g'),
                         '\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*(-|to|through)\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*$', '', 'gi'),
                     '\s*-\s*\d+$', ''),
                 '\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[`''‘’]?\s*\d{2,4}\s*$', '', 'gi'),
             '\s+(19|20)\d{2}$', ''))
    END                                                         AS charge_name,
    COALESCE(NULLIF(sd.charge, 0), sd.amount, 0)                AS billed_amount
FROM statement_details sd
WHERE sd.transaction_date IS NOT NULL
  AND sd.description NOT ILIKE 'reversal%'
  AND (
        sd.description ILIKE '%monthly maintenance fee%'
     OR sd.description ILIKE '%capital expenditure%'
     OR sd.description ILIKE '%deferred%'
     OR sd.description ~* 'fam(ily|\.)?\s*mem'
     OR sd.description ~* '(^|[^a-z])mdues?([^a-z]|$)'
     OR sd.description ~* '(^|[^a-z])capit([^a-z]|$)'
  );


-- SETUP part 2 — materialised copies + indexes (what the tab reads)
CREATE OR REPLACE VIEW villa_owner_map AS SELECT * FROM villa_owner_map_src;

DROP MATERIALIZED VIEW IF EXISTS villa_owner_map_mv;
CREATE MATERIALIZED VIEW villa_owner_map_mv AS
SELECT * FROM villa_owner_map_src;

CREATE UNIQUE INDEX villa_owner_map_mv_pk    ON villa_owner_map_mv (member_number);
CREATE INDEX        villa_owner_map_mv_villa ON villa_owner_map_mv (villa_name);

CREATE OR REPLACE VIEW villa_owner_map AS SELECT * FROM villa_owner_map_mv;

DROP MATERIALIZED VIEW IF EXISTS villa_dues_lines_mv;
CREATE MATERIALIZED VIEW villa_dues_lines_mv AS
SELECT dl.*, row_number() OVER () AS mv_row_id
FROM villa_dues_lines dl;

CREATE UNIQUE INDEX villa_dues_lines_mv_pk       ON villa_dues_lines_mv (mv_row_id);
CREATE INDEX        villa_dues_lines_mv_year     ON villa_dues_lines_mv (year);
CREATE INDEX        villa_dues_lines_mv_member   ON villa_dues_lines_mv (member_number);
CREATE INDEX        villa_dues_lines_mv_year_fee ON villa_dues_lines_mv (year, fee_type);

ANALYZE villa_owner_map_mv;
ANALYZE villa_dues_lines_mv;


-- SETUP part 3 — refresh function
CREATE OR REPLACE FUNCTION refresh_dues_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW villa_owner_map_mv;
    REFRESH MATERIALIZED VIEW villa_dues_lines_mv;
    BEGIN
        REFRESH MATERIALIZED VIEW overview_transaction_lines;
    EXCEPTION WHEN undefined_table THEN
        NULL;   -- not present in every environment
    END;
    BEGIN
        REFRESH MATERIALIZED VIEW overview_villa_bookings;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
END;
$$;

SELECT refresh_dues_views();
