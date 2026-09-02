"""
backend/postgres/create_performance_indexes.py

Space-aware index builder.

CHANGES FROM THE ORIGINAL
─────────────────────────
1. SET statement_timeout = 0.
   database.py puts statement_timeout=60000 on every connection. Index
   builds on folios (162k rows) and statement_details (269k rows) run
   longer than that. A cancelled CREATE INDEX CONCURRENTLY leaves an
   INVALID index behind that still occupies disk and speeds up nothing —
   the one failure mode that actively costs space.

2. Hard space budget.
   Checks free space before starting and after every index. Stops
   cleanly if headroom drops below --min-free-mb instead of filling the
   volume. Default quota 500 MB; pass --quota-mb if yours differs.

3. Two indexes removed (see the DISABLED block below): the covering
   index, and one that was a redundant prefix of another.

4. Failures no longer abort the run.
   The original re-raised on the first error, throwing away the
   remaining builds. This records failures, keeps going, and reports at
   the end.

5. Invalid-index sweep at the end, so cancelled builds can't silently
   squat on disk.

USAGE
─────
    python -m backend.postgres.create_performance_indexes --dry-run
    python -m backend.postgres.create_performance_indexes

    # if your plan is not 500 MB:
    python -m backend.postgres.create_performance_indexes --quota-mb 8192
"""
import argparse
import re
import sys
import time

from sqlalchemy import text

try:
    from database import engine            # run from inside backend/postgres
except ImportError:                        # run as -m from the repo root
    from .database import engine


# ═════════════════════════════════════════════════════════════════════
# INDEXES — ordered cheapest first, so if the budget runs out you have
# already banked the small high-value ones.
# ═════════════════════════════════════════════════════════════════════
indexes = [

    # ── Small lookup tables: pennies, big wins on joins ──────────────
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation_guests_conf
    ON reservation_guests ((TRIM(conf_code)))
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_conf
    ON rooms ((TRIM(confirmation_code)))
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_room_type
    ON rooms (room_number, room_type)
    WHERE room_number IS NOT NULL
      AND room_type IS NOT NULL
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_addresses_member
    ON member_addresses (member_number)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_phones_member
    ON member_phones (member_number, phone_type)
    """,

    # ── folios partials: cheap because they index a slice, not all
    #    162k rows. These carry the Overview villa cards.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_villa_category_conf
    ON folios (transaction_category, conf_code)
    WHERE transaction_category = 'Villa'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_paid_villa_conf
    ON folios (conf_code, villa_payment_type)
    WHERE transaction_category = 'Villa'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_villa_conf
    ON folios (villa_name, conf_code)
    WHERE villa_name IS NOT NULL
    """,

    # [2026-08-13] Not a partial — folios had no index on member_number at
    # all. backend/machinelearning/segmentation.py's build_amenities()
    # does `SELECT check_in_date, check_out_date FROM folios WHERE
    # member_number = a.member_id ORDER BY check_in_date DESC LIMIT 1` as
    # a correlated LATERAL, once per row of member_amenity_profile
    # (~2,877 members) — with no index that's a full 162k-row scan per
    # member, and is what made that build time out after ~2 minutes.
    # DESC on check_in_date so the ORDER BY ... LIMIT 1 in that query is
    # answered by the index directly (first matching row), not a sort.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_member_checkin
    ON folios (member_number, check_in_date DESC)
    WHERE member_number IS NOT NULL
    """,

    # ── statement_details partials: 269k rows, but 'Villa Income' is a
    #    thin slice of them, so these stay small.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statement_details_villa_income
    ON statement_details (transaction_date, member_number)
    WHERE description ILIKE '%Villa Income%'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statement_villa_income_member_date
    ON statement_details (member_number, transaction_date, ref_transaction_id)
    WHERE description ILIKE '%Villa Income%'
    """,

    # ── rate_details: 88k rows, moderate cost ────────────────────────
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_room_villa
    ON rate_details (room_number, villa_name)
    WHERE room_number IS NOT NULL
      AND villa_name IS NOT NULL
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_stay
    ON rate_details (check_in_date, check_out_date)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_villa_checkin
    ON rate_details (villa_name, check_in_date DESC)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_bedroom_checkin
    ON rate_details (bedroom_count, check_in_date DESC)
    """,

    # Serves the DISTINCT ON (conf_code, rate_date) ... ORDER BY
    # updated_at DESC dedup that synthetic_villa_folio_lines and
    # rate_details_with_discount both run.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_conf_rate_recency
    ON rate_details (conf_code, rate_date, updated_at DESC NULLS LAST)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_conf_recency
    ON rate_details (
        (TRIM(conf_code)),
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        rate_detail_key DESC
    )
    """,

    # ── The big one, last. folios is your largest table; this is the
    #    index the Overview tab lives or dies on.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_conf_stay
    ON folios (conf_code, check_in_date, check_out_date)
    """,
]


# ═════════════════════════════════════════════════════════════════════
# DISABLED — deliberately not built. Re-enable only with evidence.
# ═════════════════════════════════════════════════════════════════════
#
# idx_statement_details_nonzero_cover
#     CREATE INDEX ... ON statement_details (statement_detail_key)
#     INCLUDE (member_number, transaction_date, description, amount)
#     WHERE amount <> 0
#
#     A covering index over 269k rows whose INCLUDE list carries
#     `description` — wide free text. This is close to a second copy of
#     the table's hot columns and could alone exceed 30 MB. The leading
#     column is already the primary key, so the pkey serves any lookup;
#     the INCLUDE only avoids a heap fetch. Not worth 30 MB on a 500 MB
#     plan until a specific slow query proves it.
#
# idx_folios_conf_code
#     CREATE INDEX ... ON folios (conf_code)
#
#     Redundant. idx_folios_conf_stay above leads with conf_code, and a
#     composite index serves prefix lookups on its leading column. Two
#     indexes, one job — this saves several MB on your largest table at
#     no measurable cost.
#
# ═════════════════════════════════════════════════════════════════════


tables_to_analyze = [
    "folios",
    "rate_details",
    "statement_details",
    "reservation_guests",
    "rooms",
    "member_addresses",
    "member_phones",
]


# ─────────────────────────────────────────────────────────────────────
def index_name_of(statement):
    m = re.search(r"IF NOT EXISTS\s+(\w+)", statement)
    return m.group(1) if m else "<unknown>"


def table_of(statement):
    m = re.search(r"\bON\s+(\w+)\s*\(", statement)
    return m.group(1) if m else "<unknown>"


def db_mb(conn):
    return conn.execute(
        text("SELECT pg_database_size(current_database())")
    ).scalar() / 1024 / 1024


def index_mb(conn, name):
    return conn.execute(text("""
        SELECT COALESCE(pg_relation_size(c.oid), 0)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = :n
    """), {"n": name}).scalar() / 1024 / 1024


def invalid_indexes(conn):
    return conn.execute(text("""
        SELECT i.relname, pg_size_pretty(pg_relation_size(i.oid))
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE NOT x.indisvalid AND n.nspname = 'public'
    """)).fetchall()


# ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quota-mb", type=float, default=500.0,
                    help="Your plan's storage ceiling (default 500)")
    ap.add_argument("--min-free-mb", type=float, default=60.0,
                    help="Stop building when free space falls below this")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("\n" + "=" * 62)
    print("Performance indexes — space-aware build")
    print("=" * 62)

    if args.dry_run:
        print(f"\n{len(indexes)} indexes would be built, in this order:\n")
        for i, s in enumerate(indexes, 1):
            print(f"  {i:2d}. {index_name_of(s):45s} on {table_of(s)}")
        print("\n2 disabled — see the DISABLED block in this file.")
        print("\nDRY RUN — nothing executed.\n")
        return

    built, skipped, failed = [], [], []

    with engine.connect().execution_options(
        isolation_level="AUTOCOMMIT"
    ) as connection:

        # THE CRITICAL LINE. Without it, database.py's 60s cap cancels
        # the big builds and leaves invalid indexes squatting on disk.
        connection.execute(text("SET statement_timeout = 0"))

        start_mb = db_mb(connection)
        free = args.quota_mb - start_mb
        print(f"\nDatabase: {start_mb:,.1f} MB used, "
              f"{free:,.1f} MB free of {args.quota_mb:,.0f} MB")
        print(f"Will stop if free space drops below {args.min_free_mb:,.0f} MB\n")

        if free < args.min_free_mb:
            print("ABORT: already below the floor. Reclaim space first.")
            sys.exit(2)

        for n, statement in enumerate(indexes, 1):
            name = index_name_of(statement)
            free = args.quota_mb - db_mb(connection)

            if free < args.min_free_mb:
                print(f"\nWARNING: STOPPING at index {n}/{len(indexes)} — "
                      f"only {free:,.1f} MB free.")
                skipped = [index_name_of(s) for s in indexes[n - 1:]]
                break

            print(f"[{n:2d}/{len(indexes)}] {name} ...", end="", flush=True)
            t0 = time.time()
            try:
                connection.execute(text(statement))
                size = index_mb(connection, name)
                print(f" {size:6.1f} MB  {time.time() - t0:5.1f}s"
                      f"   [free {args.quota_mb - db_mb(connection):,.0f} MB]")
                built.append(name)
            except Exception as exc:
                print(f" FAILED after {time.time() - t0:.1f}s")
                print(f"        {str(exc).splitlines()[0]}")
                failed.append(name)

        print("\nRefreshing planner statistics ...")
        for table in tables_to_analyze:
            try:
                connection.execute(text(f"ANALYZE {table}"))
                print(f"  [OK] {table}")
            except Exception as exc:
                print(f"  [FAIL] {table}: {str(exc).splitlines()[0]}")

        # Cancelled CONCURRENTLY builds leave invalid indexes that hold
        # disk and help nothing. Surface them so they can be dropped.
        bad = invalid_indexes(connection)
        end_mb = db_mb(connection)

    print("\n" + "=" * 62)
    print(f"Built:   {len(built)}")
    if failed:
        print(f"Failed:  {len(failed)} -> {', '.join(failed)}")
    if skipped:
        print(f"Skipped: {len(skipped)} (out of space) -> {', '.join(skipped)}")
    print(f"\nDatabase: {start_mb:,.1f} MB -> {end_mb:,.1f} MB "
          f"(+{end_mb - start_mb:,.1f} MB)")
    print(f"Free:     {args.quota_mb - end_mb:,.1f} MB")

    if bad:
        print("\nWARNING: INVALID INDEXES — these waste disk. Drop them:")
        for name, size in bad:
            print(f"    DROP INDEX {name};   -- {size}")

    print("=" * 62 + "\n")


if __name__ == "__main__":
    main()