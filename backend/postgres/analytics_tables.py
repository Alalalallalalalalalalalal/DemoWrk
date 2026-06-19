# backend/postgres/analytics_tables.py
"""
Generic table-browsing endpoints used by the report builder UI: lists which
tables are exposable, dumps a whole allowed table, or does a simple
ILIKE search on one column of an allowed table.

All three endpoints share the same allow-list to prevent arbitrary table
access via the `table_name` path param.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from .analytics_shared import get_db

router = APIRouter()

# Ordered list — this exact order is the API response for GET /tables,
# so it's kept as a list (not a set) to match the original endpoint output.
ALLOWED_TABLES_LIST = [
    "amenity_season_spend",
    "dependent_addresses",
    "dependent_phones",
    "dependents",
    "folios",
    "interests",
    "member_addresses",
    "member_amenity_profile",
    "member_amenity_season_visits",
    "member_phones",
    "member_seasons",
    "members",
    "recent_activity",
    "reservation_guests",
    "rooms",
    "season_groups",
    "season_villa_bedroom_summary",
    "seasonal_visitors",
    "seasonal_visits",
    "seasons",
    "segment_amenities",
    "segment_spenders",
    "segment_visitors",
    "services",
    "statements",
]

# Set form for fast membership checks (table_name not in ALLOWED_TABLES).
ALLOWED_TABLES = set(ALLOWED_TABLES_LIST)


@router.get("/tables")
def get_tables(db: Session = Depends(get_db)):
    return ALLOWED_TABLES_LIST


@router.get("/table/{table_name}")
def get_table_data(table_name: str, db: Session = Depends(get_db)):
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail="Invalid table")

    result = db.execute(
        text(f"SELECT * FROM {table_name}")
    ).mappings().all()

    return [dict(row) for row in result]


@router.get("/table/{table_name}/search")
def search_table(
    table_name: str,
    column: str,
    value: str,
    db: Session = Depends(get_db)
):
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail="Invalid table")

    result = db.execute(
        text(f"""
            SELECT *
            FROM {table_name}
            WHERE CAST({column} AS TEXT) ILIKE :value
            LIMIT 100
        """),
        {"value": f"%{value}%"}
    ).mappings().all()

    return [dict(row) for row in result]