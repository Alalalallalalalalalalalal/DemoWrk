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

The scrapers under `backend/scraping/` pull members, villa stays, folios, rates, services, and
statements from the portal; `backend/machinelearning/` builds the seasonal/segmentation tables
on top of that. There are two modes, defined in `backend/apscheduler/pipeline.py`:

**Bootstrap** — the full run, in the order documented in
[`backend/scraping/scraping-README.md`](backend/scraping/scraping-README.md). Run this once
manually to populate everything from scratch (or to force a full resync). Takes up to an hour.
Not auto-scheduled — nothing runs this for you.
```bash
cd backend/apscheduler
python pipeline.py
```

**Production** — two smaller recurring jobs that keep already-populated data current, instead of
redoing the full bootstrap every time:
- **Fast (every 4h)**: new members + room/booking status (`member_scraper` to pull a fresh
  demographics report, `new_member_updater` to diff it against the previous one, `journal_scraper
  --rooms-only`, `cleaner --rooms-only`), plus folio check-in/checkout status and new
  reservations (`folio_report --year Y --month M` for the current month AND the previous one —
  its filter is by check-in date, so a stay that started last month needs the previous month
  covered too — then `folio_scraper --all`, `cleaner --folios-only`).
- **Overnight (every 24h)**: services + statements (`journal_scraper --services-only
  --statements-only`, `cleaner --services-and-statements-only`) — new monthly statements land
  here, not in the 4h job.

Both re-check every account each run (they pass `--force` to `journal_scraper.py`) rather than
skipping anyone already scraped once — that permanent-skip behavior is correct for the one-time
bootstrap, not for an ongoing refresh.
```bash
cd backend/apscheduler
python scheduler.py
```

If a stage fails, that pipeline run halts there and logs the failure to
`backend/apscheduler/pipeline.log` — later stages in that run don't execute on a partial
failure, but the next scheduled run of that same pipeline still fires on schedule.

**Reliability details:**
- **Logs rotate daily**, 30 days kept (`pipeline.log`/`scheduler.log` plus dated backups) — they
  won't grow forever.
- **Cross-process locking**: a manual bootstrap run and the two scheduled jobs won't ever run at
  the same time — whichever starts first holds `pipeline.lock` until it finishes; the other skips
  that turn and tries again next time. This also protects the two scheduled jobs from drifting
  into overlapping each other if one runs long.
- **Failure alerts**: no email/Slack is configured, so there's nowhere to push a real
  notification — but after 3 consecutive failures of the same pipeline, an `ALERT_<name>.txt`
  file appears in `backend/apscheduler/`, clearing automatically on the next success. Worth
  checking for periodically (or wiring up a real notification once you have somewhere to send
  it).
- **Process supervision**: nothing restarts `scheduler.py` if it crashes or the machine reboots —
  that's outside what Python code can do for itself. Use
  [`backend/apscheduler/run_scheduler.ps1`](backend/apscheduler/run_scheduler.ps1) instead of
  calling `scheduler.py` directly; it restarts automatically on a crash. To also survive a reboot,
  register it as a Windows Task Scheduler task (Action: `powershell.exe -ExecutionPolicy Bypass
  -File run_scheduler.ps1`, Trigger: at startup, "run whether user is logged on or not").

### Debugging a scraper

All scrapers run headless by default. To watch one run in a visible browser window (e.g. while
fixing a broken selector), set `HEADFUL=1` for that run (run as a module, from `backend/`):

```bash
cd backend
HEADFUL=1 python -m scraping.scrapers.member_scraper
```

## Known issues

- **Data lag is expected, not a bug.** The production jobs poll every 4h (rooms/status) or 24h
  (services/statements) — how fresh the *portal's own* data is (e.g. when it publishes a given
  month's statement) is outside this app's control. If a statement or new member hasn't shown up
  in the portal yet, running the pipeline again won't produce it.
- `backend/postgres/scripts/check_villa_revenue_performance.py` and
  `create_performance_indexes.py` are standalone maintenance scripts, not wired into the API.
  Run them with `python -m postgres.scripts.<name>` from `backend/`.
