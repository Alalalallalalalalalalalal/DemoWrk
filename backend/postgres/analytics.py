# backend/postgres/analytics.py
"""
Aggregator module. This used to be one big file containing every analytics
route; it's now split into focused modules:

  analytics_dashboard.py     /dashboard-summary (legacy all-in-one widget feed)
  analytics_seasons.py       season groups/seasons CRUD, /season-summary, /seasons/{id}/members
  analytics_tables.py        /tables, /table/{table_name}, /table/{table_name}/search (report builder)
  analytics_ml_insights.py   /ml/amenity-season-insights, /ml/member-segments, /ml/segment-config
  analytics_villas.py        villa/room/bedroom stats, booked-people, visits-rooms-dashboard, source breakdowns
  analytics_demographics.py  /demographics-summary, state/category/dimension drilldowns, new-vs-repeat visitor details
  analytics_shared.py        shared get_db / rows / one / SQL-fragment helpers (no routes)

This file just re-exports a single combined `router` so existing code doing
`from postgres.analytics import router` (e.g. in main.py's
`app.include_router(...)`) doesn't need to change.
"""
# backend/postgres/analytics.py

from fastapi import APIRouter

from .analytics_dashboard import router as dashboard_router
from .analytics_seasons import router as seasons_router
from .analytics_tables import router as tables_router
from .analytics_ml_insights import router as ml_insights_router
from .analytics_villas import router as villas_router
from .analytics_demographics import router as demographics_router
from .analytics_marketing import router as marketing_router
from .analytics_lead_time import router as lead_time_router

router = APIRouter()

router.include_router(dashboard_router)
router.include_router(seasons_router)
router.include_router(tables_router)
router.include_router(ml_insights_router)
router.include_router(villas_router)
router.include_router(demographics_router)
router.include_router(marketing_router)
router.include_router(lead_time_router)