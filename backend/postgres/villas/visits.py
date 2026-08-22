"""
Villa visits-dashboard endpoints: the combined visits-tab summary and the
big visits-rooms dashboard bundle. This is the one endpoint that touches
nearly every shared helper, plus its private temp-table materialization
helper and short-TTL in-process cache (used only by this module).
"""

from __future__ import annotations

import os
import threading
import time
from datetime import date as _date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..analytics_shared import get_db, rows, one
from ._shared import (
    resolve_period,
    period_params,
    booking_base_cte,
    booked_people_source_cte,
    villa_income_cte,
    statement_reconciliation_cte,
    villa_paid_free_metrics_cte,
    overview_villa_revenue_ctes,
    source_revenue_cte,
    _visits_summary_sql,
    _villa_stats_sql,
    _bookings_by_bedroom_sql,
    _monthly_revenue_sql,
    _paid_free_totals_sql,
    _source_breakdown_sql,
    _bedroom_breakdown_sql,
)

router = APIRouter()


def _materialize(
    db: Session,
    name: str,
    body_sql: str,
    params: dict,
    index_cols=(),
):
    db.execute(text(f"DROP TABLE IF EXISTS {name}"))
    db.execute(
        text(
            f"CREATE TEMP TABLE {name} "
            f"ON COMMIT DROP AS {body_sql}"
        ),
        params,
    )

    for col in index_cols:
        db.execute(
            text(f"CREATE INDEX ON {name} ({col})")
        )

    db.execute(text(f"ANALYZE {name}"))


# =============================================================================
# Cache
# =============================================================================

_CACHE_TTL = int(
    os.getenv(
        "VILLA_DASHBOARD_CACHE_TTL",
        "60",
    )
)

_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: tuple):
    if _CACHE_TTL <= 0:
        return None

    with _cache_lock:
        hit = _cache.get(key)

        if hit and (
            time.monotonic() - hit[0]
        ) < _CACHE_TTL:
            return hit[1]

        if hit:
            _cache.pop(key, None)

    return None


def _cache_put(key: tuple, value: dict):
    if _CACHE_TTL <= 0:
        return

    with _cache_lock:
        if len(_cache) > 64:
            _cache.clear()

        _cache[key] = (
            time.monotonic(),
            value,
        )


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/visits-tab-summary")
def visits_tab_summary(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    return one(
        db,
        f"""
        WITH
        {booking_base_cte(p)},
        {booked_people_source_cte(p)},
        {villa_income_cte(p)},
        {statement_reconciliation_cte(p)}
        {_visits_summary_sql(
            'booking_base'
        )}
        """,
        period_params(p),
    )


@router.get("/visits-rooms-dashboard")
def visits_rooms_dashboard(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    date: _date | None = Query(default=None),
    start_date: _date | None = Query(default=None),
    end_date: _date | None = Query(default=None),
    villa: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    total_start = time.perf_counter()

    p = resolve_period(
        year,
        month,
        date,
        start_date,
        end_date,
    )

    cache_key = (
        p.start,
        p.end,
        p.month_only,
        villa,
    )

    cached = _cache_get(cache_key)

    if cached is not None:
        print(
            "[PERF] visits dashboard CACHE HIT: "
            f"{time.perf_counter() - total_start:.3f}s"
        )
        return cached

    params = period_params(
        p,
        villa=villa,
    )

    # ---------------------------------------------------------------------
    # 1. Rate-detail operational booking base
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    _materialize(
        db,
        "tmp_booking_base",
        f"""
        WITH
        {booking_base_cte(p)}
        SELECT *
        FROM booking_base
        """,
        params,
        index_cols=(
            "villa_name",
            "bedroom_count",
        ),
    )

    print(
        "[PERF] booking base: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 2. Authoritative per-villa booking/value metrics
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    _materialize(
        db,
        "tmp_villa_metrics",
        f"""
        WITH
        {villa_paid_free_metrics_cte(
            p,
            booking_src="tmp_booking_base",
        )}
        SELECT *
        FROM villa_paid_free_metrics
        """,
        params,
        index_cols=("villa_name",),
    )

    print(
        "[PERF] villa metrics: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 3. Legacy/netted Overview revenue by booking
    #    Retained for bedroom/source breakdown compatibility.
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    _materialize(
        db,
        "tmp_villa_revenue",
        f"""
        WITH
        {overview_villa_revenue_ctes(p)}
        SELECT *
        FROM overview_villa_revenue_by_booking
        """,
        params,
        index_cols=("villa_name",),
    )

    print(
        "[PERF] villa revenue: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 4. Source-breakdown revenue
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    _materialize(
        db,
        "tmp_source_revenue",
        f"""
        WITH
        {source_revenue_cte(p)}
        SELECT *
        FROM villa_revenue
        """,
        params,
        index_cols=("villa_name",),
    )

    print(
        "[PERF] source revenue: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 5. Overall visits summary
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    summary = one(
        db,
        f"""
        WITH
        {booked_people_source_cte(
            p,
            'tmp_booking_base',
        )},
        {villa_income_cte(p)},
        {statement_reconciliation_cte(p)}
        {_visits_summary_sql(
            'tmp_booking_base'
        )}
        """,
        params,
    )

    print(
        "[PERF] summary: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 6. Villa stats
    #    Booking/value fields now come from tmp_villa_metrics.
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    villa_stats_data = rows(
        db,
        _villa_stats_sql(
            "tmp_booking_base",
            "tmp_villa_metrics",
        ),
        {},
    )

    print(
        "[PERF] villa stats: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 7. Bedroom stats
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    bedroom_stats = rows(
        db,
        _bookings_by_bedroom_sql(
            "tmp_booking_base"
        ),
        {},
    )

    print(
        "[PERF] bedroom stats: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 8. Monthly statement Villa Income
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    monthly_revenue_data = rows(
        db,
        f"""
        WITH
        {villa_income_cte(p)}
        {_monthly_revenue_sql(p)}
        """,
        params,
    )

    print(
        "[PERF] monthly revenue: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 9. Authoritative paid/free totals
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    paid_free_totals = rows(
        db,
        _paid_free_totals_sql(
            "tmp_villa_metrics"
        ),
        {
            "villa": villa,
        },
    )

    print(
        "[PERF] paid/free totals: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 10. Source breakdown
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    source_breakdown = rows(
        db,
        _source_breakdown_sql(
            "tmp_booking_base",
            "tmp_source_revenue",
        ),
        {},
    )

    print(
        "[PERF] source breakdown: "
        f"{time.perf_counter() - t:.3f}s"
    )

    # ---------------------------------------------------------------------
    # 11. Bedroom/source breakdown
    # ---------------------------------------------------------------------
    t = time.perf_counter()

    bedroom_source_breakdown = rows(
        db,
        _bedroom_breakdown_sql(
            "tmp_booking_base",
            "tmp_villa_revenue",
        ),
        {},
    )

    print(
        "[PERF] bedroom source breakdown: "
        f"{time.perf_counter() - t:.3f}s"
    )

    selected_villa = villa

    if not selected_villa and villa_stats_data:
        selected_villa = villa_stats_data[0].get(
            "villa_name"
        )

    payload = {
        "summary": summary,
        "villa_stats": villa_stats_data,
        "villa_paid_free_totals": paid_free_totals,
        "bookings_by_bedroom": bedroom_stats,
        "monthly_revenue": monthly_revenue_data,
        "villa_monthly": [],
        "selected_villa": selected_villa,
        "villa_source_breakdown": source_breakdown,
        "villa_source_bedroom_breakdown":
            bedroom_source_breakdown,
    }

    _cache_put(
        cache_key,
        payload,
    )

    print(
        "\n"
        "==============================================\n"
        "[PERF] TOTAL visits dashboard: "
        f"{time.perf_counter() - total_start:.3f}s\n"
        "=============================================="
    )

    return payload
