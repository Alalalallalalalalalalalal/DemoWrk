# Before You Run Anything (from root demowrk folder)

1. pip install -r backend/playwright/requirements.txt
2. playwright install


## Order to run files - Setup

1.  python backend/playwright/member_scraper.py

2.  python backend/playwright/build_journal_profiles.py

3.  python backend/playwright/folio_report.py

4.  python backend/playwright/room_inquiry_scraper.py

5.  python backend/playwright/folio_scraper.py  


6.  python backend/playwright/scrape_rate_revenue.py


7.  python backend/playwright/build_member_map.py --limit 1000        (for testing)

    python backend/playwright/build_member_map.py                     (for full run)


8.  python backend/playwright/journal_scraper.py                    # First 10 members      (for testing)

    python backend/playwright/journal_scraper.py --all              # All members           (for full run)

    python backend/playwright/journal_scraper.py --limit 50         # Custom limit

    python backend/playwright/journal_scraper.py --member 1C        # Single member by number

    python backend/playwright/journal_scraper.py --id 32845         # Single member by portal ID

9. python backend/playwright/cleaner.py (add '--rate-details-only' to load just rate_details)

10. python backend/playwright/member_enricher.py --apply

11. python backend/playwright/overview_sql.py

12. python backend\machinelearning\ml_amenity_seasons.py
13. python backend\machinelearning\season_tables.py
14. python backend\machinelearning\segmentation.py


## Notes: (These files do not affect playwright's function)
1. cleaner.py is untested but I think that may be what you need to push over to Postgres
2. db_schema.sql is created in the playwright folder but it is empty - not sure what the plan is for the schema.

## To run full pipeline from playwright to cleaner.
1. cd to backend (ensure env is activated)
2. type in gitbash/shell: python apscheduler/scheduler.py