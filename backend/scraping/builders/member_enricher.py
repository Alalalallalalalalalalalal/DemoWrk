"""
member_enricher.py — Backfill missing gender and marital status from prefix/name
for members and dependents.

Gender rules:
  - Mr.           → M
  - Mrs./Ms./Miss → F
  - M/M, Dr., Judge, Prof. and other ambiguous prefixes → skip

Marital status rules:
  - Mrs. prefix                          → Married
  - M/M prefix                           → Married
  - first_name = 'M/M'                   → Married
  - '& ' in middle_name (shared last)    → Married

Only updates rows where the column IS NULL.

Usage:
    python member_enricher.py           # dry run — preview only
    python member_enricher.py --apply   # write updates to DB
"""

import os
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
}

# Prefix → gender
PREFIX_GENDER = {
    "mr.":  "M",
    "mr":   "M",
    "mrs.": "F",
    "mrs":  "F",
    "ms.":  "F",
    "ms":   "F",
    "miss": "F",
}

# Prefix → marital status
PREFIX_MARITAL = {
    "mrs.": "Married",
    "mrs":  "Married",
    "m/m":  "Married",
}

# Ambiguous prefixes — skip for gender
SKIP_GENDER_PREFIXES = {
    "m/m", "dr.", "dr", "prof.", "prof",
    "judge", "rev.", "rev", "hon.", "hon",
}

# Non-person member types — skip entirely
NON_PERSON_TYPES = {
    "Banquet Functions",
    "Group/Tournament Accounts",
    "Travel Agents",
    "App Club Staff",
}


def infer_gender(prefix, member_type=None):
    if member_type and member_type in NON_PERSON_TYPES:
        return None
    if not prefix:
        return None
    key = prefix.strip().lower()
    if key in SKIP_GENDER_PREFIXES:
        return None
    return PREFIX_GENDER.get(key)


def infer_marital(prefix, first_name, middle_name):
    """
    Infer marital status from prefix or name patterns.
    - Mrs.          → Married
    - M/M prefix    → Married
    - first_name == 'M/M' → Married
    - '&' in middle_name  → Married (e.g. John & Lisa, middle='& Lisa')
    """
    if prefix:
        key = prefix.strip().lower()
        if key in PREFIX_MARITAL:
            return "Married"

    if first_name and first_name.strip().upper() == "M/M":
        return "Married"

    if middle_name and "&" in middle_name:
        return "Married"

    return None


def run(apply=False):
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = True

    # ── Members — Gender ─────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT member_number, prefix, member_type, first_name
            FROM members
            WHERE gender IS NULL
              AND prefix IS NOT NULL
        """)
        rows = cur.fetchall()

    gender_updates  = []
    gender_skipped  = []

    for member_number, prefix, member_type, first_name in rows:
        if member_type in NON_PERSON_TYPES:
            gender_skipped.append((member_number, prefix, "non-person type"))
            continue
        g = infer_gender(prefix, member_type)
        if g:
            gender_updates.append((g, member_number, prefix, first_name))
        else:
            gender_skipped.append((member_number, prefix, "ambiguous prefix"))

    print()
    print("=" * 60)
    print("Members — Gender")
    print("=" * 60)
    print(f"  gender IS NULL with prefix : {len(rows)}")
    print(f"  Can infer                  : {len(gender_updates)}")
    print(f"  Skipping                   : {len(gender_skipped)}")

    if gender_updates:
        print("\n  Sample updates:")
        for g, mn, px, fn in gender_updates[:15]:
            print(f"    {mn:15s}  {(fn or ''):15s}  prefix={px!r:8s}  → gender={g}")
        if len(gender_updates) > 15:
            print(f"    ... and {len(gender_updates) - 15} more")

    if apply and gender_updates:
        with conn.cursor() as cur:
            for g, mn, *_ in gender_updates:
                cur.execute(
                    "UPDATE members SET gender = %s, updated_at = NOW() WHERE member_number = %s",
                    (g, mn)
                )
        print(f"\n  ✓ Applied {len(gender_updates)} member gender updates.")

    # ── Members — Marital Status ──────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT member_number, prefix, first_name, middle_name, member_type
            FROM members
            WHERE marital_status IS NULL
        """)
        marital_rows = cur.fetchall()

    marital_updates = []
    marital_skipped = []

    for member_number, prefix, first_name, middle_name, member_type in marital_rows:
        if member_type in NON_PERSON_TYPES:
            marital_skipped.append((member_number, "non-person type"))
            continue
        m = infer_marital(prefix, first_name, middle_name)
        if m:
            marital_updates.append((m, member_number, prefix, first_name, middle_name))
        else:
            marital_skipped.append((member_number, "no signal"))

    print()
    print("=" * 60)
    print("Members — Marital Status")
    print("=" * 60)
    print(f"  marital_status IS NULL     : {len(marital_rows)}")
    print(f"  Can infer                  : {len(marital_updates)}")
    print(f"  Skipping                   : {len(marital_skipped)}")

    if marital_updates:
        print("\n  Sample updates:")
        for m, mn, px, fn, mid in marital_updates[:15]:
            print(f"    {mn:15s}  {(fn or ''):10s}  {(mid or ''):20s}  prefix={str(px or ''):8s}  → {m}")
        if len(marital_updates) > 15:
            print(f"    ... and {len(marital_updates) - 15} more")

    if apply and marital_updates:
        with conn.cursor() as cur:
            for m, mn, *_ in marital_updates:
                cur.execute(
                    "UPDATE members SET marital_status = %s, updated_at = NOW() WHERE member_number = %s",
                    (m, mn)
                )
        print(f"\n  ✓ Applied {len(marital_updates)} member marital status updates.")

    # ── Dependents — Gender ───────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT dependent_number, first_name
            FROM dependents
            WHERE gender IS NULL
        """)
        dep_rows = cur.fetchall()

    dep_gender_updates = []
    dep_gender_skipped = []

    for dep_number, first_name in dep_rows:
        g = infer_gender(None)
        if g:
            dep_gender_updates.append((g, dep_number, None, first_name))
        else:
            dep_gender_skipped.append((dep_number, None, "no prefix"))

    print()
    print("=" * 60)
    print("Dependents — Gender")
    print("=" * 60)
    print(f"  gender IS NULL with prefix : {len(dep_rows)}")
    print(f"  Can infer                  : {len(dep_gender_updates)}")
    print(f"  Skipping                   : {len(dep_gender_skipped)}")

    if dep_gender_updates:
        print("\n  Sample updates:")
        for g, dn, px, fn in dep_gender_updates[:15]:
            print(f"    {dn:15s}  {(fn or ''):15s}  prefix={px!r:8s}  → gender={g}")
        if len(dep_gender_updates) > 15:
            print(f"    ... and {len(dep_gender_updates) - 15} more")

    if apply and dep_gender_updates:
        with conn.cursor() as cur:
            for g, dn, *_ in dep_gender_updates:
                cur.execute(
                    "UPDATE dependents SET gender = %s WHERE dependent_number = %s",
                    (g, dn)
                )
        print(f"\n  ✓ Applied {len(dep_gender_updates)} dependent gender updates.")

    # ── Dependents — Marital Status ───────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT dependent_number, first_name, middle_name
            FROM dependents
            WHERE marital_status IS NULL
        """)
        dep_marital_rows = cur.fetchall()

    dep_marital_updates = []

    for dep_number, first_name, middle_name in dep_marital_rows:
        m = infer_marital(None, first_name, middle_name)
        if m:
            dep_marital_updates.append((m, dep_number, None, first_name, middle_name))

    print()
    print("=" * 60)
    print("Dependents — Marital Status")
    print("=" * 60)
    print(f"  marital_status IS NULL     : {len(dep_marital_rows)}")
    print(f"  Can infer                  : {len(dep_marital_updates)}")

    if dep_marital_updates:
        print("\n  Sample updates:")
        for m, dn, px, fn, mid in dep_marital_updates[:15]:
            print(f"    {dn:15s}  {(fn or ''):10s}  {(mid or ''):20s}  prefix={str(px or ''):8s}  → {m}")
        if len(dep_marital_updates) > 15:
            print(f"    ... and {len(dep_marital_updates) - 15} more")

    if apply and dep_marital_updates:
        with conn.cursor() as cur:
            for m, dn, *_ in dep_marital_updates:
                cur.execute(
                    "UPDATE dependents SET marital_status = %s WHERE dependent_number = %s",
                    (m, dn)
                )
        print(f"\n  ✓ Applied {len(dep_marital_updates)} dependent marital status updates.")

    # ── Summary ───────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Members  gender updated    : {len(gender_updates)}")
    print(f"  Members  marital updated   : {len(marital_updates)}")
    print(f"  Deps     gender updated    : {len(dep_gender_updates)}")
    print(f"  Deps     marital updated   : {len(dep_marital_updates)}")
    if not apply:
        print()
        print("  ── DRY RUN — pass --apply to write changes ──")


def main():
    parser = argparse.ArgumentParser(description="Enrich missing gender and marital status.")
    parser.add_argument("--apply", action="store_true", help="Write updates to DB")
    args = parser.parse_args()
    run(apply=args.apply)


if __name__ == "__main__":
    main()