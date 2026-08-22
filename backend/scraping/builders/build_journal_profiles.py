"""
build_journal_profiles.py — Split demographics and dependents CSVs
into per-member journal folders.

Reads the downloaded report CSVs and writes one profile CSV and
one dependents CSV per member into their journal folder.

Folder naming matches journal_scraper.py:
  - Unique member numbers (1C, 22A)        → journal/1C/
  - Generic labels (Guests, Dependent)     → journal/Guests_35849/

Requires:
  - member_id_map.csv        (from build_member_map.py)
  - member_demographics_*.csv (from member_scraper.py)
  - member_dependents_*.csv   (from member_scraper.py)

Usage:
    python build_journal_profiles.py
    python build_journal_profiles.py --demo path/to/demo.csv --dept path/to/dept.csv
"""
import os
import csv
import glob
import argparse

from ..config import OUTPUT_FOLDER, REPORTS_FOLDER, DATA_FOLDER

# ─────────────────────────────────────────────
MAP_FILE       = os.path.join(DATA_FOLDER, "member_id_map.csv")
JOURNAL_FOLDER = os.path.join(OUTPUT_FOLDER, "journal")
GENERIC_LABELS = {"Guests", "Dependent", "Guest", "Staff"}
# ─────────────────────────────────────────────


def get_folder_name(member_number, member_id):
    """Match folder naming from journal_scraper.py."""
    if member_number in GENERIC_LABELS:
        return f"{member_number}_{member_id}"
    return member_number


def load_member_map(filepath):
    """Load member_id_map.csv → dict of member_number: member_id."""
    mapping = {}
    with open(filepath, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            mapping[row["member_number"]] = row["member_id"]
    return mapping


def find_latest_csv(folder, pattern):
    """Find the most recently created CSV matching a glob pattern."""
    files = glob.glob(os.path.join(folder, pattern))
    if not files:
        return None
    return max(files, key=os.path.getctime)


def save_member_csv(folder_name, suffix, rows, fieldnames):
    """Save rows to journal/{folder_name}/{folder_name}_{suffix}.csv"""
    if not rows:
        return None
    folder = os.path.join(JOURNAL_FOLDER, folder_name)
    os.makedirs(folder, exist_ok=True)
    filepath = os.path.join(folder, f"{folder_name}_{suffix}.csv")
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return filepath


def build_profiles(demo_file, member_map):
    """
    Split demographics CSV into per-member profile CSVs.
    Each row in the demographics CSV is one member.
    Member Number column is used to match to the map.
    """
    print(f"\nBuilding profiles from: {os.path.basename(demo_file)}")
    saved = 0
    skipped = 0
    unknown = 0

    with open(demo_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        for row in reader:
            member_number = row.get("Member Number", "").strip()
            if not member_number:
                continue

            # Look up member_id from map
            member_id = member_map.get(member_number)
            if not member_id:
                # Member not in map — still save using member_number as folder
                folder_name = member_number
                unknown += 1
            else:
                folder_name = get_folder_name(member_number, member_id)

            fp = save_member_csv(folder_name, "profile", [row], fieldnames)
            if fp:
                saved += 1
            else:
                skipped += 1

    print(f"  Saved: {saved} profiles")
    if unknown:
        print(f"  Not in map (saved anyway): {unknown}")
    if skipped:
        print(f"  Skipped (no data): {skipped}")


def build_dependents(dept_file, member_map):
    """
    Split dependents CSV into per-member dependents CSVs.
    Groups dependent rows by Member Number.
    Each member gets one dependents CSV with all their dependents.
    """
    print(f"\nBuilding dependents from: {os.path.basename(dept_file)}")

    # Group rows by member number
    member_rows = {}
    fieldnames_ref = None

    with open(dept_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames_ref = reader.fieldnames
        for row in reader:
            member_number = row.get("Member Number", "").strip()
            if not member_number:
                continue
            if member_number not in member_rows:
                member_rows[member_number] = []
            member_rows[member_number].append(row)

    saved = 0
    for member_number, rows in member_rows.items():
        member_id = member_map.get(member_number)
        if member_id:
            folder_name = get_folder_name(member_number, member_id)
        else:
            folder_name = member_number

        fp = save_member_csv(folder_name, "dependents", rows, fieldnames_ref)
        if fp:
            saved += 1

    print(f"  Saved: {saved} dependent files")


def main():
    parser = argparse.ArgumentParser(
        description="Split report CSVs into per-member journal folders."
    )
    parser.add_argument("--demo", type=str, default=None,
                        help="Path to demographics CSV (auto-detects latest if not set)")
    parser.add_argument("--dept", type=str, default=None,
                        help="Path to dependents CSV (auto-detects latest if not set)")
    args = parser.parse_args()

    print("=" * 60)
    print("Journal Profile Builder")
    print("=" * 60)

    # Load member map
    if not os.path.exists(MAP_FILE):
        print(f"WARNING: {MAP_FILE} not found. Folders will use member numbers only.")
        member_map = {}
    else:
        member_map = load_member_map(MAP_FILE)
        print(f"Loaded {len(member_map)} members from map.")

    # Find CSVs
    demo_file = args.demo or find_latest_csv(REPORTS_FOLDER, "member_demographics_*.csv")
    dept_file = args.dept or find_latest_csv(REPORTS_FOLDER, "member_dependents_*.csv")

    if not demo_file:
        print("ERROR: No demographics CSV found. Run member_scraper.py first.")
        return
    if not dept_file:
        print("ERROR: No dependents CSV found. Run member_scraper.py first.")
        return

    print(f"Demographics: {os.path.basename(demo_file)}")
    print(f"Dependents:   {os.path.basename(dept_file)}")
    print(f"Output:       {JOURNAL_FOLDER}")

    # Build profiles
    build_profiles(demo_file, member_map)

    # Build dependents
    build_dependents(dept_file, member_map)

    print("\n" + "=" * 60)
    print("Done. Check journal/ folder for per-member CSVs.")
    print("=" * 60)


if __name__ == "__main__":
    main()