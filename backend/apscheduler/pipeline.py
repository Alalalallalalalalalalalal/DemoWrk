import subprocess
import logging
from pathlib import Path
import sys

#This is a SKELETON for the pipeline. It is very much subject to change as playwright is fixed.
# Some steps in the pipeline may be added, removed, or modified as needed. Full run takes up to 1 hour

logging.basicConfig(
    filename="pipeline.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
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
    #stage for building folio reports
    {
        "name": "build_folio_reports",
        "command": [
            sys.executable,
            "playwright/folio_report.py"
        ]
    },
    #stage for folio scrapper
    {
        "name": "folio_scraper",
        "command": [
            sys.executable,
            "playwright/folio_scraper.py "
        ]
    },
    #stage for building member map, with skip logic to avoid unnecessary runs
    {
        "name": "build_member_map",
        "command": [
            sys.executable,
            "playwright/build_member_map.py",
        ],
        "skip_if_exists": "playwright/member_id_map.csv" # skip this stage if the output file already exists
    },
    #stage for building journal profiles
    {
        "name": "build_journal_profiles",
        "command": [
            sys.executable,
            "playwright/build_journal_profiles.py"
        ]
    },
    #stage for journal updates
    {
        "name": "journal_scraper",
        "command": [
            sys.executable,
            "playwright/journal_scraper.py",
            "--all"
        ]
    },
    #cleaner begins
     {
        "name": "cleaner",
        "command": [
            sys.executable,
            "playwright/cleaner.py"
        ]
    },
    #run ml insights here
    {
        "name": "ml_insights",
        "command": [
            sys.executable,
            "playwright/ml_insights.py"
        ]
    }
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
    
    
def run_pipeline():
    logging.info("Starting Pipeline Execution")
    
    for stage in PIPELINE:
        success = run_stage(stage)
        if not success:
            logging.error(f"Pipeline halted due to failure in stage: {stage['name']}")
            return False
        
    logging.info("All stages completed successfully.")
    return True