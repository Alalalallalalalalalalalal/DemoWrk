# backend/postgres/database.py
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "database": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# Build PostgreSQL URL manually
DATABASE_URL = (
    f"postgresql+psycopg2://"
    f"{DB_CONFIG['user']}:{DB_CONFIG['password']}@"
    f"{DB_CONFIG['host']}:{DB_CONFIG['port']}/"
    f"{DB_CONFIG['database']}"
)

# ── Connection pool ──────────────────────────────────────────────────────
# Was pool_size=10, max_overflow=5 (15 connections total). That is tight for
# a dashboard where a single page load could hold three connections at once:
# two or three people browsing simultaneously exhausted the pool, and further
# requests then sat waiting for a free connection with no error and no
# timeout. To the user that looks like "the page never loads" rather than
# "the page is slow" — which is a large part of why Visits & Rooms felt dead
# rather than sluggish.
#
# 20 + 10 = 30 max connections. Check this fits your server's max_connections
# (default 100) minus whatever else connects — the APScheduler pipeline, any
# psql sessions, and one pool PER uvicorn worker process:
#
#   SHOW max_connections;
#   SELECT count(*) FROM pg_stat_activity;
#
# If you run 4 uvicorn workers, this engine is created 4 times = 120 possible
# connections. Either lower these numbers or raise max_connections.
engine = create_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=10,

    # Fail after 30s of waiting for a free connection instead of hanging
    # forever. A visible 500 is far easier to diagnose than a spinner.
    pool_timeout=30,

    pool_pre_ping=True,
    pool_recycle=300,

    # Server-side kill switch: no single query may run longer than 60s. Without
    # this, one pathological query pins a connection indefinitely and slowly
    # starves the pool. Value is in milliseconds.
    connect_args={"options": "-c statement_timeout=60000"},

    # Flip to True temporarily to log every statement SQLAlchemy issues —
    # useful when you want to see exactly how many queries a page load fires.
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()