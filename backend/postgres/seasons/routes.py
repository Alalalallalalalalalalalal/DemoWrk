# backend/postgres/seasons/routes.py
"""
Season group / season CRUD and the season-summary + season-members lookup
endpoints. Seasons are date-range definitions (e.g. "Winter Peak": Dec 15 -
Jan 5) grouped under a season_group (e.g. "Standard Seasons" vs a user's
custom grouping), used elsewhere (ml_insights) to bucket bookings/spend.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from ..analytics_shared import get_db

router = APIRouter()


@router.get("/season-summary")
def season_summary(db: Session = Depends(get_db)):
    def rows(sql: str):
        return [dict(row) for row in db.execute(text(sql)).mappings().all()]

    season_groups = rows("""
        SELECT
            sg.id,
            sg.group_name,
            sg.group_type,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', s.id,
                        'season_name', s.season_name,
                        'start_month', s.start_month,
                        'start_day', s.start_day,
                        'end_month', s.end_month,
                        'end_day', s.end_day,
                        'is_active', s.is_active
                    )
                    ORDER BY s.start_month, s.start_day
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'
            ) AS seasons
        FROM season_groups sg
        LEFT JOIN seasons s ON s.group_id = sg.id
        WHERE sg.group_type <> 'simple'
        GROUP BY sg.id, sg.group_name, sg.group_type
        ORDER BY sg.id
    """)

    seasonal_visits = rows("""
        SELECT month, visits, avg_stay
        FROM seasonal_visits
        ORDER BY month
    """)

    season_visitors = rows("""
        SELECT season_id, season_name, COUNT(*) AS repeat_visitor_count
        FROM season_visitors
        GROUP BY season_id, season_name
        ORDER BY repeat_visitor_count DESC
    """)

    return {
        "seasonGroups": season_groups,
        "seasonalVisits": seasonal_visits,
        "seasonVisitors": season_visitors,
    }


@router.post("/season-groups")
def create_season_group(payload: dict, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            INSERT INTO season_groups (group_name, group_type)
            VALUES (:group_name, 'custom')
            RETURNING id, group_name, group_type, created_at
        """),
        {"group_name": payload["group_name"]},
    ).mappings().first()
    db.commit()
    return {**dict(row), "seasons": []}


@router.delete("/seasons/{season_id}")
def delete_season(season_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            DELETE FROM seasons
            WHERE id = :season_id
            RETURNING id
        """),
        {"season_id": season_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Season not found")

    db.commit()
    return {"ok": True, "deleted_id": season_id}


@router.delete("/season-groups/{group_id}")
def delete_season_group(group_id: int, db: Session = Depends(get_db)):
    group = db.execute(
        text("""
            SELECT id, group_type
            FROM season_groups
            WHERE id = :group_id
        """),
        {"group_id": group_id},
    ).mappings().first()

    if not group:
        raise HTTPException(status_code=404, detail="Season group not found")

    if group["group_type"] != "custom":
        raise HTTPException(
            status_code=400,
            detail="Only custom season groups can be deleted"
        )

    db.execute(
        text("DELETE FROM seasons WHERE group_id = :group_id"),
        {"group_id": group_id},
    )

    db.execute(
        text("DELETE FROM season_groups WHERE id = :group_id"),
        {"group_id": group_id},
    )

    db.commit()
    return {"ok": True, "deleted_id": group_id}


@router.post("/seasons")
def create_season(payload: dict, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            INSERT INTO seasons
                (group_id, season_name, start_month, start_day, end_month, end_day, is_active)
            VALUES
                (:group_id, :season_name, :start_month, :start_day, :end_month, :end_day, true)
            RETURNING id, group_id, season_name, start_month, start_day, end_month, end_day, is_active
        """),
        payload,
    ).mappings().first()
    db.commit()
    return dict(row)


@router.patch("/seasons/{season_id}")
def update_season(season_id: int, payload: dict, db: Session = Depends(get_db)):
    allowed = {
        "season_name",
        "start_month",
        "start_day",
        "end_month",
        "end_day",
        "is_active",
    }

    updates = {k: v for k, v in payload.items() if k in allowed}

    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_sql = ", ".join([f"{k} = :{k}" for k in updates])

    row = db.execute(
        text(f"""
            UPDATE seasons
            SET {set_sql}, updated_at = NOW()
            WHERE id = :season_id
            RETURNING id, group_id, season_name, start_month, start_day, end_month, end_day, is_active
        """),
        {**updates, "season_id": season_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Season not found")

    db.commit()
    return dict(row)


@router.get("/seasons/{season_id}/members")
def season_members(season_id: int, db: Session = Depends(get_db)):
    season = db.execute(
        text("""
            SELECT id, season_name, start_month, start_day, end_month, end_day
            FROM seasons
            WHERE id = :season_id
        """),
        {"season_id": season_id},
    ).mappings().first()

    if not season:
        raise HTTPException(status_code=404, detail="Season not found")

    result = db.execute(
        text("""
            SELECT DISTINCT
                f.member_number,
                f.conf_code,
                COALESCE(m.member_full_name, f.guest_name, f.folio_name) AS member_full_name,
                f.guest_name,
                f.folio_name,
                m.member_type,
                m.age,
                a.country,
                f.check_in_date,
                f.check_out_date,
                CASE
                    WHEN f.check_in_date IS NOT NULL AND f.check_out_date IS NOT NULL
                    THEN GREATEST(f.check_out_date - f.check_in_date, 0)
                    ELSE NULL
                END AS length_of_stay,
                f.room_number,
                f.villa_name,
                f.bedroom_count,
                f.reservation_status,
                f.transaction_date
            FROM folios f
            LEFT JOIN members m
                ON f.member_number = m.member_number
            LEFT JOIN member_addresses a
                ON f.member_number = a.member_number
            WHERE f.member_number IS NOT NULL
              AND COALESCE(f.check_in_date, f.transaction_date) IS NOT NULL
              AND (
                (
                  (:start_month < :end_month)
                  OR (:start_month = :end_month AND :start_day <= :end_day)
                )
                AND (
                  EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) > :start_month
                  OR (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :start_month
                    AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) >= :start_day
                  )
                )
                AND (
                  EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) < :end_month
                  OR (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :end_month
                    AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) <= :end_day
                  )
                )
                OR
                (
                  (:start_month > :end_month)
                  OR (:start_month = :end_month AND :start_day > :end_day)
                )
                AND (
                  (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) > :start_month
                    OR (
                      EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :start_month
                      AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) >= :start_day
                    )
                  )
                  OR
                  (
                    EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) < :end_month
                    OR (
                      EXTRACT(MONTH FROM COALESCE(f.check_in_date, f.transaction_date)) = :end_month
                      AND EXTRACT(DAY FROM COALESCE(f.check_in_date, f.transaction_date)) <= :end_day
                    )
                  )
                )
              )
            ORDER BY f.check_in_date DESC NULLS LAST, member_full_name
            LIMIT 1000
        """),
        {
            "start_month": season["start_month"],
            "start_day": season["start_day"],
            "end_month": season["end_month"],
            "end_day": season["end_day"],
        },
    ).mappings().all()

    return [dict(row) for row in result]