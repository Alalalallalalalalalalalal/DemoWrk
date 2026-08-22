# backend/postgres/analytics.py
"""
Aggregator module. This used to be one big file containing every analytics
route; it's now split into focused modules:

  dashboard/                 /dashboard-summary (legacy all-in-one widget feed)
  seasons/                   season groups/seasons CRUD, /season-summary, /seasons/{id}/members
  tables/                    /tables, /table/{table_name}, /table/{table_name}/search (report builder)
  ml_insights/                /ml/amenity-season-insights, /ml/member-segments, /ml/segment-config
  villas/                    villa/room/bedroom stats, booked-people, visits-rooms-dashboard, source breakdowns
  demographics/              /demographics-summary, state/category/dimension drilldowns, new-vs-repeat visitor details
  marketing/                 marketing targeting campaigns
  analytics_shared.py        shared get_db / rows / one / SQL-fragment helpers (no routes)

This file just re-exports a single combined `router` so existing code doing
`from postgres.analytics import router` (e.g. in main.py's
`app.include_router(...)`) doesn't need to change.
"""
# backend/postgres/analytics.py

from fastapi import APIRouter

from .dashboard import router as dashboard_router
from .seasons import router as seasons_router
from .tables import router as tables_router
from .ml_insights import router as ml_insights_router
from .villas import router as villas_router
from .demographics import router as demographics_router
from .marketing import router as marketing_router

router = APIRouter()

router.include_router(dashboard_router)
router.include_router(seasons_router)
router.include_router(tables_router)
router.include_router(ml_insights_router)
router.include_router(villas_router)
router.include_router(demographics_router)
router.include_router(marketing_router)