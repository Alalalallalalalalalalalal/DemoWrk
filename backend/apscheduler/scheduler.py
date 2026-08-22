from apscheduler.schedulers.blocking import BlockingScheduler
from pipeline import run_fast_pipeline, run_overnight_pipeline
import logging
import logging.handlers
from pathlib import Path
from datetime import datetime, timedelta

_log_handler = logging.handlers.TimedRotatingFileHandler(
    Path(__file__).parent / "scheduler.log", when="midnight", backupCount=30, encoding="utf-8"
)
_log_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[_log_handler])

# Two recurring production jobs — see pipeline.py for what each covers.
# The full bootstrap pipeline (PIPELINE / run_pipeline()) is intentionally
# NOT scheduled here: run it manually once (python pipeline.py) to populate
# everything from scratch, then let these two keep it current.
scheduler = BlockingScheduler()

scheduler.add_job(
    run_fast_pipeline,
    id="fast_pipeline",
    trigger='interval',
    #run immediately on startup
    next_run_time=datetime.now(),
    hours=4,
    # prevents overlapping runs
    max_instances=1,
    # if scheduler misses execution while offline
    coalesce=True,
    # optional grace period if scheduler was late in starting the job
    misfire_grace_time=300
)

scheduler.add_job(
    run_overnight_pipeline,
    id="overnight_pipeline",
    trigger='interval',
    # offset from the fast job's startup so they don't both launch subprocesses
    # at the exact same instant
    next_run_time=datetime.now() + timedelta(minutes=1),
    hours=24,
    max_instances=1,
    coalesce=True,
    misfire_grace_time=1800
)

logging.info("Scheduler started.")

try:
    scheduler.start()
except (KeyboardInterrupt, SystemExit):
    logging.info("Scheduler stopped.")
except Exception:
    # Log the crash reason before the process dies, so a restart wrapper
    # (see run_scheduler.ps1) has something to diagnose from.
    logging.exception("Scheduler crashed unexpectedly.")
    raise