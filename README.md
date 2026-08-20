# DemoWrk

Villa/hospitality analytics dashboard. Playwright scrapers pull data from the booking portal
into Postgres, a FastAPI backend serves it, and a React frontend renders it.

## Prerequisites

- Python 3.11+, Node 18+, a reachable Postgres database
- A `.env` file in the repo root with:

```
PORTAL_USERNAME=...
PORTAL_PASSWORD=...
PORTAL_URL=...
BASE_URL=...
DB_HOST=...
DB_PORT=...
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
```

`HEADFUL=1` is optional — see "Debugging a scraper" below.

## Install

```bash
pip install -r requirements.txt -r backend/requirements.txt
playwright install
cd frontend && npm install
```

## Run the backend API

```bash
cd backend
uvicorn main:app --reload
```

## Run the frontend

```bash
cd frontend
npm run dev
```

## Refresh the data

The scrapers under `backend/playwright/` pull new members, villa stays, folios, rates, and
statements from the portal; `backend/machinelearning/` builds the seasonal/segmentation tables
on top of that. `backend/apscheduler/pipeline.py` runs all of it in the order documented in
[`backend/playwright/playwright-README.md`](backend/playwright/playwright-README.md).

**One-off manual run** (useful for checking for new data right now, e.g. a statement that just
posted):
```bash
cd backend/apscheduler
python pipeline.py
```

**Scheduled run** (repeats every 4 hours, also runs once immediately on startup):
```bash
cd backend/apscheduler
python scheduler.py
```

A full run takes up to an hour. If a stage fails, the pipeline halts there and logs the failure
to `backend/apscheduler/pipeline.log` — later stages don't run on a partial failure.

### Debugging a scraper

All scrapers run headless by default. To watch one run in a visible browser window (e.g. while
fixing a broken selector), set `HEADFUL=1` for that run:

```bash
HEADFUL=1 python playwright/member_scraper.py
```

## Known issues

- **Data lag is expected, not a bug.** The pipeline itself just polls every 4 hours — how fresh
  the *portal's own* data is (e.g. when it publishes a given month's statement) is outside this
  app's control. If a statement or new member hasn't shown up in the portal yet, running the
  pipeline again won't produce it.
- `backend/postgres/scripts/check_villa_revenue_performance.py` and
  `create_performance_indexes.py` are standalone maintenance scripts, not wired into the API.
  Run them with `python -m postgres.scripts.<name>` from `backend/`.
