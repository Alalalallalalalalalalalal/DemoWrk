


###### Before You Run Anything (from root demowrk folder)

1. pip install -r backend/playwright/requirements.txt
2. playwright install


##### Order to run files - Setup

1.  python backend/playwright/member_scraper.py

2.  python backend/playwright/build_member_map.py --limit 1000        (for testing)
    python backend/playwright/build_member_map.py                     (for full run)

3.  python backend/playwright/build_journal_profiles.py

4.  python backend/playwright/journal_scraper.py                    # First 10 members      (for testing)
    python backend/playwright/journal_scraper.py --all              # All members           (for full run)
    python backend/playwright/journal_scraper.py --limit 50         # Custom limit
    python backend/playwright/journal_scraper.py --member 1C        # Single member by number
    python backend/playwright/journal_scraper.py --id 32845         # Single member by portal ID


# Notes: (These files do not affect playwright's function)
1. cleaner.py is untested but I think that may be what you need to push over to Postgres
2. db_schema.sql is created in the playwright folder but it is empty - not sure what the plan is for the schema.