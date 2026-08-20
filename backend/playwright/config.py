"""
config.py — Loads settings from .env file.
"""
import os
from dotenv import load_dotenv

load_dotenv()

USERNAME   = os.getenv("PORTAL_USERNAME")
PASSWORD   = os.getenv("PORTAL_PASSWORD")
PORTAL_URL = os.getenv("PORTAL_URL")
BASE_URL   = os.getenv("BASE_URL")
DATABASE_URL = os.getenv("DATABASE_URL")

_missing = [k for k, v in {
    "PORTAL_USERNAME": USERNAME,
    "PORTAL_PASSWORD": PASSWORD,
    "PORTAL_URL":      PORTAL_URL,
    "BASE_URL":        BASE_URL,
    #"DATABASE_URL":    DATABASE_URL, - for Postgres connection
}.items() if not v]

if _missing:
    raise EnvironmentError(
        f"Missing required environment variables: {', '.join(_missing)}\n"
        "Copy .env.example to .env and fill in your values."
    )

OUTPUT_FOLDER = os.path.dirname(os.path.abspath(__file__))

# Browsers run headless by default; set HEADFUL=1 to watch a scraper run.
HEADFUL = os.getenv("HEADFUL", "").lower() in ("1", "true", "yes")
HEADLESS = not HEADFUL

# ─────────────────────────────────────────────
# DERIVED URLS
# ─────────────────────────────────────────────
SEARCH_REPORT_URL = f"{BASE_URL}/tabs.jsp?g=27&m=Inquiry&s=search"

REPORTS_FOLDER = os.path.join(OUTPUT_FOLDER, "reports")