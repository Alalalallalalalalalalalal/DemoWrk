# backend/postgres/demographics/__init__.py
"""
Aggregator module. This used to be one file (routes.py) containing every
demographics route; it's now split into focused modules:

  summary.py      /demographics-summary (filterable demographic summary feed)
  accounts.py     state/category/dimension account drilldowns
  visitors.py     new-vs-repeat visitor classification and details

This package just re-exports a single combined `router` so existing code
doing `from .demographics import router as demographics_router` (in
postgres/analytics.py) doesn't need to change.
"""
from fastapi import APIRouter

from .summary import router as summary_router
from .accounts import router as accounts_router
from .visitors import router as visitors_router

router = APIRouter()

router.include_router(summary_router)
router.include_router(accounts_router)
router.include_router(visitors_router)
