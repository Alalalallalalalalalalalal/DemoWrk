from apscheduler.schedulers.blocking import BlockingScheduler
from pipeline import run_pipeline
import logging
from datetime import datetime

logging.basicConfig(
    filename="scheduler.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

scheduler = BlockingScheduler()

scheduler.add_job(
    run_pipeline,
    trigger='interval',
    #run immediately on startup
    next_run_time=datetime.now(),
    hours=4, # run every 4 hours for now, can adjust as needed
    # prevents overlapping runs
    max_instances=1,
    # if scheduler misses execution while offline
    coalesce=True,
    # optional grace period if scheduler was late in starting the job
    misfire_grace_time=300
)

logging.info("Scheduler started.")

try:
    scheduler.start()
except (KeyboardInterrupt, SystemExit):
    logging.info("Scheduler stopped.")