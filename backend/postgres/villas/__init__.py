# backend/postgres/villas/__init__.py
"""
Aggregator module. This used to be one file (routes.py) containing every
villa route; it's now split into focused modules:

  _shared.py   period resolution, SQL filter builders, CTE builders, and
               aggregate-SQL builders shared across the endpoint modules
               (no routes)
  stats.py     /villa-stats, /villa-monthly
  bookings.py  /bookings-by-bedroom, /bedroom-bookings, /villa-bookings,
               /villa-source-bookings, /villa-source-bedroom-breakdown
  people.py    /booked-people, /booking-summary
  revenue.py   /monthly-revenue, /villa-paid-free-totals,
               /villa-source-breakdown
  visits.py    /visits-tab-summary, /visits-rooms-dashboard

`fees.py` is a separate, already right-sized module and is not part of this
aggregation.

This package just re-exports a single combined `router` so existing code
doing `from .villas import router as villas_router` (in
postgres/analytics.py) doesn't need to change.
"""
from fastapi import APIRouter

from .stats import router as stats_router
from .bookings import router as bookings_router
from .people import router as people_router
from .revenue import router as revenue_router
from .visits import router as visits_router

router = APIRouter()

router.include_router(stats_router)
router.include_router(bookings_router)
router.include_router(people_router)
router.include_router(revenue_router)
router.include_router(visits_router)
