import subprocess
import logging
import logging.handlers
import os
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timedelta
import sys

import psutil

# Three pipelines:
#   PIPELINE          - bootstrap: full run from scratch (up to 1 hour), matches
#                        backend/scraping/scraping-README.md's documented order.
#                        Manual only (python pipeline.py) - not auto-scheduled.
#   FAST_PIPELINE      - production, every 4h: new members + booking/room status
#                        + folio check-in/checkout status and new reservations.
#   OVERNIGHT_PIPELINE - production, every 24h: services + statements.
# journal_scraper.py normally skips accounts already marked done in its
# per-section done-logs (journal_rooms_done.txt etc.) - correct for a one-time
# backfill, wrong for a recurring production job that needs to re-check
# EVERYONE every run. Both production pipelines below pass --force to
# journal_scraper.py so nothing is ever permanently skipped; cleaner.py's
# loaders are all upsert-based, so reloading the freshly-overwritten CSVs is
# safe to repeat every run too.

LOG_DIR = Path(__file__).parent
LOG_FILE = LOG_DIR / "pipeline.log"

_log_handler = logging.handlers.TimedRotatingFileHandler(
    LOG_FILE, when="midnight", backupCount=30, encoding="utf-8"
)
_log_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[_log_handler])

# ─────────────────────────────────────────────
# CROSS-PROCESS LOCK
# ─────────────────────────────────────────────
# The scheduled fast/overnight jobs run as separate threads in the same
# scheduler.py process, but a manual "python pipeline.py" bootstrap run is a
# SEPARATE process — a plain in-memory lock wouldn't stop bootstrap and a
# scheduled job from both driving Playwright against the same portal login
# at once. This lock is a file, so it works across processes too. Staleness
# is checked by asking the OS if the PID that holds it is still alive
# (psutil.pid_exists), not by age, so a legitimately long-running job is
# never killed out from under itself.
LOCK_FILE = LOG_DIR / "pipeline.lock"


class PipelineBusyError(Exception):
    pass


@contextmanager
def pipeline_lock(label):
    if LOCK_FILE.exists():
        try:
            pid_str, held_label, _ts = LOCK_FILE.read_text(encoding="utf-8").split("|", 2)
            pid = int(pid_str)
        except Exception:
            pid, held_label = None, "unknown"

        if pid is not None and psutil.pid_exists(pid):
            logging.warning(f"{label} skipped — {held_label} (pid {pid}) is still running.")
            raise PipelineBusyError(held_label)

        logging.warning(f"Clearing stale lock file (pid {pid} not running, held by {held_label}).")
        LOCK_FILE.unlink(missing_ok=True)

    LOCK_FILE.write_text(f"{os.getpid()}|{label}|{datetime.now().isoformat()}", encoding="utf-8")
    try:
        yield
    finally:
        LOCK_FILE.unlink(missing_ok=True)


# ─────────────────────────────────────────────
# FAILURE ALERTING
# ─────────────────────────────────────────────
# No email/Slack/SMS is configured anywhere in this project, so there's
# nowhere to actually push a notification without new credentials. This is
# the buildable equivalent: after enough CONSECUTIVE failures of the same
# pipeline, write a plainly-named alert file that's easy for a human (or a
# future monitoring script) to check for, separate from the noise of a
# regular log. Cleared automatically the next time that pipeline succeeds.
FAILURE_THRESHOLD = 3


def _alert_file(key):
    return LOG_DIR / f"ALERT_{key}.txt"


def _failcount_file(key):
    return LOG_DIR / f".{key}_failcount"


def _record_result(key, label, success):
    count_path = _failcount_file(key)
    alert_path = _alert_file(key)

    if success:
        count_path.unlink(missing_ok=True)
        alert_path.unlink(missing_ok=True)
        return

    count = 0
    if count_path.exists():
        try:
            count = int(count_path.read_text().strip())
        except ValueError:
            count = 0
    count += 1
    count_path.write_text(str(count))

    if count >= FAILURE_THRESHOLD:
        alert_path.write_text(
            f"{label} has failed {count} times in a row as of {datetime.now().isoformat()}.\n"
            f"See pipeline.log for details. This file clears automatically on the next success.\n"
        )
        logging.critical(f"ALERT: {label} has failed {count} times in a row.")

PIPELINE = [
    #stage for scraping member data
    {
        "name": "member_scraper",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.member_scraper"]
    },
    #stage for member_updates
    {
        "name": "new_member_updater",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.new_member_updater"]
    },
    #stage for building journal profiles
    {
        "name": "build_journal_profiles",
        "command": [
            sys.executable,
            "-m", "scraping.builders.build_journal_profiles"
        ]
    },
    #stage for building folio reports
    {
        "name": "build_folio_reports",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.folio_report"
        ]
    },
    #stage for room inquiry / business source reports
    {
        "name": "room_inquiry_scraper",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.room_inquiry_scraper"
        ]
    },
    #stage for folio scrapper
    {
        "name": "folio_scraper",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.folio_scraper"
        ]
    },
    #stage for rate/revenue scraping
    {
        "name": "scrape_rate_revenue",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.scrape_rate_revenue"
        ]
    },
    #stage for building member map, with skip logic to avoid unnecessary runs
    {
        "name": "build_member_map",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.build_member_map",
        ],
        "skip_if_exists": "scraping/data/member_id_map.csv" # skip this stage if the output file already exists
    },
    #stage for journal updates
    {
        "name": "journal_scraper",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.journal_scraper",
            "--all"
        ]
    },
    #cleaner begins
     {
        "name": "cleaner",
        "command": [
            sys.executable,
            "-m", "scraping.builders.cleaner"
        ]
    },
    #stage for enriching member gender/marital status
    {
        "name": "member_enricher",
        "command": [
            sys.executable,
            "-m", "scraping.builders.member_enricher",
            "--apply"
        ]
    },
    #stage for pushing scraped data into Postgres
    {
        "name": "overview_sql",
        "command": [
            sys.executable,
            "-m", "scraping.reporting.overview_sql"
        ]
    },
    #stage for amenity/season ML tables
    {
        "name": "ml_amenity_seasons",
        "command": [
            sys.executable,
            "machinelearning/ml_amenity_seasons.py"
        ]
    },
    #stage for season summary tables
    {
        "name": "season_tables",
        "command": [
            sys.executable,
            "machinelearning/season_tables.py"
        ]
    },
    #stage for member segmentation
    {
        "name": "segmentation",
        "command": [
            sys.executable,
            "machinelearning/segmentation.py"
        ]
    }
]

# Production, every 4h: new members + booking/room status + folio
# check-in/checkout status and new reservations.
FAST_PIPELINE = [
    # member_scraper.py pulls a fresh timestamped demographics report each
    # run; new_member_updater.py diffs that against the previous one to
    # find new members. Without this stage, new_member_updater has nothing
    # fresh to compare against after the first run and silently stops
    # finding anyone new (member_scraper.py imports new_member_updater but
    # never actually calls it, despite what its own docstring claims).
    {
        "name": "member_scraper",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.member_scraper"
        ]
    },
    {
        "name": "new_member_updater",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.new_member_updater"
        ]
    },
    {
        "name": "journal_scraper_rooms",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.journal_scraper",
            "--all", "--rooms-only", "--force"
        ]
    },
    {
        "name": "cleaner_rooms",
        "command": [
            sys.executable,
            "-m", "scraping.builders.cleaner",
            "--rooms-only"
        ]
    },
]


def folio_status_stages():
    """
    Built fresh per call (not a module-level constant) since it needs the
    CURRENT year/month at run time. folio_report.py --year Y --month M
    bypasses its own done-log for that one period and merges a fresh
    listing into folio_report.csv — this already carries Reservation
    Status (check-in/checkout) AND surfaces any brand-new reservations,
    without needing to visit every reservation's detail page. Then
    folio_scraper.py --all only visits NEW reservations (its existing
    done-log correctly skips everything already scraped in detail) to
    fill in Villa Name/Bedroom Count/Persons/Source/Payment Type for
    those. cleaner.py --folios-only pushes both to Postgres, skipping the
    slow per-member journal walk entirely.

    Covers the current month AND the previous one: folio_report.py's date
    filter is by CHECK-IN date, so a reservation that checked in last
    month but checks out (or otherwise changes status) this month would
    be invisible to a current-month-only refresh. Two listing pulls
    instead of one is cheap; missing a checkout for weeks is not.
    """
    now = datetime.now()
    prev = (now.replace(day=1) - timedelta(days=1))
    periods = [(now.year, now.month), (prev.year, prev.month)]
    return [
        {
            "name": f"folio_report_{y}_{m:02d}",
            "command": [
                sys.executable,
                "-m", "scraping.scrapers.folio_report",
                "--year", str(y), "--month", str(m)
            ]
        }
        for (y, m) in periods
    ] + [
        {
            "name": "folio_scraper_new",
            "command": [
                sys.executable,
                "-m", "scraping.scrapers.folio_scraper",
                "--all"
            ]
        },
        {
            "name": "cleaner_folios",
            "command": [
                sys.executable,
                "-m", "scraping.builders.cleaner",
                "--folios-only"
            ]
        },
    ]

# Production, every 24h: services + statements (new monthly statements land
# here, not in the 4h job).
OVERNIGHT_PIPELINE = [
    {
        "name": "journal_scraper_services_statements",
        "command": [
            sys.executable,
            "-m", "scraping.scrapers.journal_scraper",
            "--all", "--services-only", "--statements-only", "--force"
        ]
    },
    {
        "name": "cleaner_services_statements",
        "command": [
            sys.executable,
            "-m", "scraping.builders.cleaner",
            "--services-and-statements-only"
        ]
    },
]

def run_stage(stage):
    logging.info(f"Starting Stage: {stage['name']}")
    
    # Check if we should skip this stage
    if "skip_if_exists" in stage:
        output_path = Path(stage["skip_if_exists"])
        if output_path.exists():
            logging.info(
                f"Skipping stage {stage['name']} because {output_path} already exists."
            )
            return True
    
    process = subprocess.Popen(
        stage["command"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
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
    
    
def run_pipeline(stages=PIPELINE, label="Pipeline", key="bootstrap"):
    try:
        with pipeline_lock(label):
            logging.info(f"Starting {label} Execution")

            for stage in stages:
                success = run_stage(stage)
                if not success:
                    logging.error(f"{label} halted due to failure in stage: {stage['name']}")
                    _record_result(key, label, success=False)
                    return False

            logging.info(f"All {label} stages completed successfully.")
            _record_result(key, label, success=True)
            return True
    except PipelineBusyError:
        # Another pipeline (possibly a manual bootstrap run in a different
        # process) currently holds the lock — skip this run rather than
        # queue or block; the next scheduled tick will try again.
        return False


def run_fast_pipeline():
    return run_pipeline(FAST_PIPELINE + folio_status_stages(), label="Fast (4h)", key="fast")


def run_overnight_pipeline():
    return run_pipeline(OVERNIGHT_PIPELINE, label="Overnight (24h)", key="overnight")


if __name__ == "__main__":
    run_pipeline()