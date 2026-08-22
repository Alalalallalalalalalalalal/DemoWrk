# backend/postgres/finance/__init__.py
"""
Aggregator module. This used to be one file (routes.py) containing every
finance route; it's now split into focused modules:

  overview.py     /overview (Total / Villas / Amenities / Services cards)
  villas.py       category-comp-breakdown, villa forgone/reconciliation/
                  statement-totals, per-villa revenue table, reservations
  breakdowns.py   source-breakdown, member-vs-guest, amenity-revenue, and
                  the composable /drilldown + /drilldown-breakdown pair

This package just re-exports a single combined `router` so existing code
doing `from postgres.finance import router as finance_router` (in
main.py) doesn't need to change.
"""
from fastapi import APIRouter

from .overview import router as overview_router
from .villas import router as villas_router
from .breakdowns import router as breakdowns_router

router = APIRouter()

router.include_router(overview_router)
router.include_router(villas_router)
router.include_router(breakdowns_router)
