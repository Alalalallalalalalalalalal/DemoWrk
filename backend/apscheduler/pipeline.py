import argparse
import os
import subprocess
import logging
from pathlib import Path
import sys

# Windows' default console codepage (cp1252) cannot encode every character a
# scraped villa/member/source name might contain (curly quotes, accented
# characters, etc.). Without this, a single such character anywhere in a
# stage's scraped output crashes that stage's own print() call with
# UnicodeEncodeError, aborting a multi-hour run over one display character.
# errors="replace" is a last-resort safety net: an unmappable character is
# shown as "?" in this process's own console/log rather than crashing it.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

#Full end-to-end pipeline: scrape the portal, load PostgreSQL, rebuild the dashboard's
#database views, then refresh the season/amenity/segmentation analysis. Full run takes up to 1 hour.
#
#Two modes, same sixteen stages:
#  python pipeline.py               update build (default) — skips whatever each stage already
#                                    has on file, except anything still "open" (current month,
#                                    recent reservations/members — see each script's own
#                                    RECENT_ACTIVITY_DAYS logic). This is what scheduler.py runs
#                                    automatically every 4 hours.
#  python pipeline.py --full-build  ignores every stage's done log and re-scrapes everything
#                                    from scratch, including rebuilding member_id_map.csv.
#                                    Intended for a first-time setup or a deliberate full re-sync
#                                    — much slower than an update build.

logging.basicConfig(
    filename="pipeline.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    encoding="utf-8",
)

PIPELINE = [
    #stage for scraping member data
    {
        "name": "member_scraper",
        "command": [
            sys.executable, 
            "playwright/member_scraper.py"]
    },
    #stage for member_updates
    {
        "name": "new_member_updater",
        "command": [
            sys.executable, 
            "playwright/new_member_updater.py"]
    },
    #stage for refreshing room/villa and business-source lookups (used as a
    #fallback by folio_scraper, journal_scraper, and overview_sql; cheap and
    #has no done-log of its own, so it's simply rebuilt fresh every run)
    {
        "name": "room_inquiry_scraper",
        "command": [
            sys.executable,
            "playwright/room_inquiry_scraper.py"
        ]
    },
    #stage for building member map, with skip logic to avoid unnecessary runs
    {
        "name": "build_member_map",
        "command": [
            sys.executable,
            "playwright/build_member_map.py",
        ],
        "skip_if_exists": "playwright/member_id_map.csv", # skip this stage if the output file already exists
        "ignore_skip_on_full_build": True # a full build always rebuilds the member map too
    },
    #stage for building journal profiles
    {
        "name": "build_journal_profiles",
        "command": [
            sys.executable,
            "playwright/build_journal_profiles.py"
        ]
    },
    #stage for journal updates. Also collects booking lead time (Created On,
    #read from the Audit Log dialog nested inside each reservation's popup)
    #while that popup is already open for contact info and rate details —
    #folded in from the former reservation_lead_time_scraper.py stage so
    #every reservation's popup is only opened once, not twice.
    #
    #Runs before build_folio_reports/folio_scraper below, so its own
    #load_recently_active_members() check (journal_scraper.py) reads
    #whatever folio_report.csv is already on disk from a prior run rather
    #than the one this run is about to produce — a soft dependency that
    #degrades gracefully (falls back to normal done-log behavior) and is
    #moot under --full-build anyway, since --force bypasses it.
    {
        "name": "journal_scraper",
        "command": [
            sys.executable,
            "playwright/journal_scraper.py",
            "--all"
        ],
        # --force: ignore journal_done.txt so every member is rescraped, not just new/recent ones
        "full_build_args": ["--force"]
    },
    #stage for building folio reports
    {
        "name": "build_folio_reports",
        "command": [
            sys.executable,
            "playwright/folio_report.py"
        ],
        # --force: re-scrape every period, ignoring folio_report_done.txt
        "full_build_args": ["--force"]
    },
    #stage for folio scrapper
    {
        "name": "folio_scraper",
        "command": [
            sys.executable,
            "playwright/folio_scraper.py"
        ],
        # --reset: clear folio_done.txt before scraping, so every reservation is redone
        "full_build_args": ["--reset"]
    },
    #stage for per-night rate/discount detail (needs folio_report.csv from the
    #stage above); cleaner.py's default run already picks up its output files
    {
        "name": "scrape_rate_revenue",
        "command": [
            sys.executable,
            "playwright/scrape_rate_revenue.py"
        ],
        # --reset: clear rate_details_done.txt so every reservation is redone
        "full_build_args": ["--reset"]
    },
    #cleaner begins
     {
        "name": "cleaner",
        "command": [
            sys.executable,
            "playwright/cleaner.py"
        ],
        # --reload: ignore cleaner_done.txt so every member folder is reloaded into PostgreSQL
        "full_build_args": ["--reload"]
    },
    #stage for backfilling gender/marital-status on any member or dependent
    #whose value is still NULL after this load (safe to run every time — it
    #only ever touches NULL fields, so it's the same command in both modes)
    {
        "name": "member_enricher",
        "command": [
            sys.executable,
            "playwright/member_enricher.py",
            "--apply"
        ]
    },
    #stage for rebuilding the dashboard's database views (required after every load;
    #see backend/playwright/overview_sql.py's own docstring)
    {
        "name": "overview_sql",
        "command": [
            sys.executable,
            "playwright/overview_sql.py"
        ]
    },
    #stage for the Annual Fees tab's villa ownership/dues views (villa_owner_map_mv,
    #villa_dues_lines_mv, refresh_dues_views()); requires the room_lookup table
    #the overview_sql stage above just loaded. See backend/sql/HISTORICAL_DUES_SYNOPSIS.sql
    #for the full reference copy, including the diagnostic queries not run here.
    {
        "name": "historical_dues_synopsis",
        "command": [
            sys.executable,
            "sql/run_historical_dues_synopsis.py"
        ]
    },
    #stage for refreshing season definitions (must run before ml_amenity_seasons/segmentation)
    {
        "name": "season_tables",
        "command": [
            sys.executable,
            "machinelearning/season_tables.py"
        ]
    },
    #stage for amenity/season spend analysis (depends on season_tables; feeds segmentation)
    {
        "name": "ml_amenity_seasons",
        "command": [
            sys.executable,
            "machinelearning/ml_amenity_seasons.py"
        ]
    },
    #stage for member spend/visitor/amenity segmentation (depends on season_tables and ml_amenity_seasons)
    {
        "name": "segmentation",
        "command": [
            sys.executable,
            "machinelearning/segmentation.py"
        ]
    }
]

def run_stage(stage, full_build=False, stage_number=None, total_stages=None):
    if stage_number is not None:
        banner = f"PIPELINE STAGE {stage_number}/{total_stages}: {stage['name']}"
    else:
        banner = f"PIPELINE STAGE: {stage['name']}"
    print("\n" + "#" * 70)
    print(f"# {banner}")
    print("#" * 70)

    logging.info(f"Starting Stage: {stage['name']}")

    # Check if we should skip this stage (a full build always runs every
    # stage, even ones that would normally be skipped, e.g. build_member_map)
    if "skip_if_exists" in stage and not (full_build and stage.get("ignore_skip_on_full_build")):
        output_path = Path(stage["skip_if_exists"])
        if output_path.exists():
            logging.info(
                f"Skipping stage {stage['name']} because {output_path} already exists."
            )
            return True

    command = stage["command"] + (stage.get("full_build_args", []) if full_build else [])

    # PYTHONIOENCODING forces the child stage's own print() calls to encode
    # as UTF-8 instead of the Windows console's default codepage (cp1252),
    # which cannot represent every character a scraped name might contain.
    # encoding/errors below make this process's own read of the child's
    # output equally tolerant, so a stray character is shown as "?" here
    # rather than crashing the read loop.
    stage_env = os.environ.copy()
    stage_env["PYTHONIOENCODING"] = "utf-8"

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=stage_env,
    )

    for line in process.stdout:
        print(line, end="")
        logging.info(line.strip())

    process.wait()

    if process.returncode == 0:
        logging.info(
            f"Stage {stage['name']} completed successfully."
        )
        return True

    else:
        logging.error(
            f"Stage {stage['name']} failed with return code {process.returncode}."
        )
        return False
    
    
def run_pipeline(full_build=False):
    logging.info(f"Starting Pipeline Execution (full_build={full_build})")
    total = len(PIPELINE)

    for i, stage in enumerate(PIPELINE, 1):
        success = run_stage(stage, full_build=full_build, stage_number=i, total_stages=total)
        if not success:
            logging.error(f"Pipeline halted due to failure in stage: {stage['name']}")
            return False

    logging.info("All stages completed successfully.")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run the full scraping/loading/analysis pipeline (see module docstring above)."
    )
    parser.add_argument(
        "--full-build", action="store_true",
        help="Ignore every stage's done log and re-scrape everything from scratch "
             "(including rebuilding member_id_map.csv). Without this flag, an "
             "update build runs instead: fast, and still catches new/recent "
             "activity via each stage's own recency-window logic."
    )
    args = parser.parse_args()
    ok = run_pipeline(full_build=args.full_build)
    sys.exit(0 if ok else 1)