# Before You Run Anything (from root demowrk folder)

1. pip install -r backend/scraping/requirements.txt
2. playwright install


## Order to run files - Setup

`backend/scraping/` is a real Python package now (subfolders `scrapers/`,
`builders/`, `reporting/` — `config.py`/`login.py` stay at its top level).
Every command below is run as a module with `-m`, from inside `backend/`:

    cd backend

1.  python -m scraping.scrapers.member_scraper

2.  python -m scraping.builders.build_journal_profiles

3.  python -m scraping.scrapers.folio_report

4.  python -m scraping.scrapers.room_inquiry_scraper

5.  python -m scraping.scrapers.folio_scraper


6.  python -m scraping.scrapers.scrape_rate_revenue


7.  python -m scraping.scrapers.build_member_map --limit 1000        (for testing)

    python -m scraping.scrapers.build_member_map                     (for full run)


8.  python -m scraping.scrapers.journal_scraper                    # First 10 members      (for testing)

    python -m scraping.scrapers.journal_scraper --all              # All members           (for full run)

    python -m scraping.scrapers.journal_scraper --limit 50         # Custom limit

    python -m scraping.scrapers.journal_scraper --member 1C        # Single member by number

    python -m scraping.scrapers.journal_scraper --id 32845         # Single member by portal ID

    python -m scraping.scrapers.journal_scraper --all --rooms-only     # Rooms + rate_details only, all accounts (incl. guests) — resumable, own done-log
    python -m scraping.scrapers.journal_scraper --all --services-only  # Services only
    python -m scraping.scrapers.journal_scraper --all --statements-only # Statements only

    (rates_backfill.py is retired — --rooms-only replaces it, including guest accounts)

9. python -m scraping.builders.cleaner (add '--rate-details-only' to load just rate_details)

10. python -m scraping.builders.member_enricher --apply

11. python -m scraping.reporting.overview_sql

12. python machinelearning\ml_amenity_seasons.py
13. python machinelearning\season_tables.py
14. python machinelearning\segmentation.py


## Notes: (These files do not affect scraping's function)
1. cleaner.py is untested but I think that may be what you need to push over to Postgres
2. db_schema.sql is created in the scraping folder but it is empty - not sure what the plan is for the schema.

## To run full pipeline from scraping to cleaner.
1. cd to backend (ensure env is activated)
2. type in gitbash/shell: python apscheduler/scheduler.py