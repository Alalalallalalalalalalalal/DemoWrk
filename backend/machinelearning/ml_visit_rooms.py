"""
backend/machinelearning/ml_visit_rooms.py
─────────────────────────────────────────────
Builds visit / room analytics tables for the dashboard.

Goal
────
Keep the heavy reservation, guest/member, villa, bedroom, monthly,
and folio rental calculations in one backend pipeline so API routes
can simply read prepared tables.

Tables written to PostgreSQL
─────────────────────────────
  visit_room_summary_kpis
      One-row executive KPI summary: total bookings, member bookings,
      guest bookings, avg stay, avg party size, room nights, villa revenue.

  visit_room_member_guest_breakdown
      Per customer segment: Member / Guest / Unknown with booking count,
      room nights, avg stay, avg party size, villa rental revenue.

  visit_room_member_type_breakdown
      Per member_type: total bookings, unique members, room nights,
      avg stay, avg party size, villa rental revenue.

  visit_room_guest_type_breakdown
      Per derived guest_type: owner guest, rental guest, member guest,
      outside guest, unknown guest.

  visit_room_villa_performance
      Per villa: bookings, room nights, avg stay, avg party size,
      bedroom count, revenue, ranking flags for most/least booked.

  visit_room_bedroom_breakdown
      Per bedroom_count: bookings, room nights, avg stay,
      avg party size, villa rental revenue.

  visit_room_monthly_trends
      Per month: bookings, member bookings, guest bookings, room nights,
      avg stay, avg party size, villa rental revenue.

  visit_room_folio_rental_transactions
      Cleaned folio transactions where description appears to be villa rental.
      Useful for detailed drilldown and QA.

Run standalone:
    python ml_visit_rooms.py
    python ml_visit_rooms.py --dry-run
    python ml_visit_rooms.py --recreate
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        required = ["DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_NAME"]
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            raise EnvironmentError(f"Missing env vars: {missing}")
        url = (
            f"postgresql+psycopg2://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
            f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
        )
        _engine = create_engine(url)
    return _engine


def _query(sql: str, params: dict | None = None) -> pd.DataFrame:
    with get_engine().connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def _save(df: pd.DataFrame, table: str) -> None:
    df.to_sql(table, get_engine(), if_exists="replace", index=False)
    log.info("Saved %-42s  (%d rows)", table, len(df))


def _safe_div(num, den):
    return num / den.replace({0: pd.NA})


# ─── Folio Classification ─────────────────────────────────────────────────────

VILLA_RENTAL_RE = re.compile(
    r"\b(villa\s*rental|villa|rental|room\s*charge|accommodation|lodging)\b",
    re.IGNORECASE,
)


def is_villa_rental(description: str | None) -> bool:
    if pd.isna(description):
        return False
    return bool(VILLA_RENTAL_RE.search(str(description)))


# ─── Data Loaders ─────────────────────────────────────────────────────────────


def _load_base_stays() -> pd.DataFrame:
    """
    One row per reservation / stay.

    Folios are treated as the strongest source because they contain villa_name,
    bedroom_count, persons, source, payment_type, and reservation_status.
    Rooms are joined as a fallback for room_type/status when available.
    Members provide member-vs-guest and member_type context.
    Reservation guests help identify owner/member/rental guest context.
    """
    df = _query("""
        WITH folio_stays AS (
            SELECT
                COALESCE(NULLIF(TRIM(conf_code), ''), reservation_folio_id, folio_num) AS booking_key,
                conf_code,
                member_number,
                NULLIF(TRIM(guest_name), '') AS guest_name,
                MIN(check_in_date) AS check_in_date,
                MAX(check_out_date) AS check_out_date,
                MAX(NULLIF(TRIM(room_number), '')) AS room_number,
                MAX(NULLIF(TRIM(villa_name), '')) AS villa_name,
                MAX(bedroom_count) AS bedroom_count,
                MAX(persons) AS persons,
                MAX(NULLIF(TRIM(source), '')) AS source,
                MAX(NULLIF(TRIM(payment_type), '')) AS payment_type,
                MAX(NULLIF(TRIM(reservation_status), '')) AS reservation_status,
                MAX(balance_due) AS balance_due
            FROM folios
            WHERE check_in_date IS NOT NULL
               OR check_out_date IS NOT NULL
               OR conf_code IS NOT NULL
            GROUP BY
                COALESCE(NULLIF(TRIM(conf_code), ''), reservation_folio_id, folio_num),
                conf_code,
                member_number,
                NULLIF(TRIM(guest_name), '')
        ),
        guest_rollup AS (
            SELECT
                conf_code,
                member_number,
                COUNT(*) AS attached_guest_count,
                BOOL_OR(COALESCE(is_owner, FALSE)) AS has_owner_guest,
                STRING_AGG(DISTINCT NULLIF(TRIM(guest_name), ''), ', ') AS attached_guest_names
            FROM reservation_guests
            GROUP BY conf_code, member_number
        )
        SELECT
            fs.booking_key,
            fs.conf_code,
            fs.member_number,
            COALESCE(NULLIF(TRIM(m.member_full_name), ''), NULLIF(TRIM(m.member_name), '')) AS member_name,
            fs.guest_name,
            m.member_or_guest,
            m.member_type,
            m.status AS member_status,
            fs.check_in_date,
            fs.check_out_date,
            COALESCE(NULLIF(TRIM(r.room_type), ''), fs.villa_name) AS room_type,
            COALESCE(NULLIF(TRIM(r.room_number), ''), fs.room_number) AS room_number,
            fs.villa_name,
            fs.bedroom_count,
            fs.persons,
            fs.source,
            fs.payment_type,
            COALESCE(fs.reservation_status, r.status) AS reservation_status,
            fs.balance_due,
            gr.attached_guest_count,
            gr.has_owner_guest,
            gr.attached_guest_names
        FROM folio_stays fs
        LEFT JOIN members m
            ON fs.member_number = m.member_number
        LEFT JOIN rooms r
            ON fs.member_number = r.member_number
           AND fs.conf_code = r.confirmation_code
        LEFT JOIN guest_rollup gr
            ON fs.conf_code = gr.conf_code
           AND fs.member_number = gr.member_number
    """)

    date_cols = ["check_in_date", "check_out_date"]
    for col in date_cols:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    df["nights"] = (df["check_out_date"] - df["check_in_date"]).dt.days
    df["nights"] = df["nights"].clip(lower=0).fillna(0).astype(int)
    df["persons"] = pd.to_numeric(df["persons"], errors="coerce")
    df["bedroom_count"] = pd.to_numeric(df["bedroom_count"], errors="coerce")
    df["balance_due"] = pd.to_numeric(df["balance_due"], errors="coerce").fillna(0)
    df["attached_guest_count"] = pd.to_numeric(df["attached_guest_count"], errors="coerce").fillna(0).astype(int)
    df["has_owner_guest"] = df["has_owner_guest"].fillna(False).astype(bool)

    df["customer_segment"] = df.apply(_derive_customer_segment, axis=1)
    df["guest_type"] = df.apply(_derive_guest_type, axis=1)

    log.info("Loaded base stays: %d rows", len(df))
    return df


def _load_villa_rental_transactions() -> pd.DataFrame:
    df = _query("""
        SELECT
            folio_key,
            transaction_date,
            description,
            amount,
            folio_num,
            folio_name,
            conf_code,
            member_number,
            guest_name,
            check_in_date,
            check_out_date,
            room_number,
            villa_name,
            bedroom_count,
            persons,
            source,
            payment_type,
            reservation_status
        FROM folios
        WHERE description IS NOT NULL
    """)
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce")
    df["check_in_date"] = pd.to_datetime(df["check_in_date"], errors="coerce")
    df["check_out_date"] = pd.to_datetime(df["check_out_date"], errors="coerce")
    df["is_villa_rental"] = df["description"].apply(is_villa_rental)
    rental_df = df[df["is_villa_rental"]].copy()
    log.info("Villa rental folio rows: %d of %d", len(rental_df), len(df))
    return rental_df


# ─── Derivations ──────────────────────────────────────────────────────────────


def _derive_customer_segment(row: pd.Series) -> str:
    raw = str(row.get("member_or_guest") or "").strip().lower()
    if raw == "member":
        return "Member"
    if raw == "guest":
        return "Guest"

    member_number = row.get("member_number")
    member_type = row.get("member_type")
    guest_name = row.get("guest_name")

    if pd.notna(member_type) and str(member_type).strip():
        return "Member"
    if pd.notna(member_number) and str(member_number).strip() and pd.isna(guest_name):
        return "Member"
    if pd.notna(guest_name) and str(guest_name).strip():
        return "Guest"
    return "Unknown"


def _derive_guest_type(row: pd.Series) -> str:
    if _derive_customer_segment(row) != "Guest":
        return "Not Guest"

    source = str(row.get("source") or "").lower()
    payment_type = str(row.get("payment_type") or "").lower()
    has_owner = bool(row.get("has_owner_guest"))
    member_number = row.get("member_number")

    if has_owner or "owner" in source:
        return "Owner Guest"
    if "rental" in source or "rental" in payment_type:
        return "Rental Guest"
    if pd.notna(member_number) and str(member_number).strip():
        return "Member Guest"
    return "Outside Guest"


def _booking_count(df: pd.DataFrame) -> int:
    return int(df["booking_key"].nunique())


def _revenue_by_booking(rental_df: pd.DataFrame) -> pd.DataFrame:
    if rental_df.empty:
        return pd.DataFrame(columns=["booking_key", "villa_rental_revenue"])
    temp = rental_df.copy()
    temp["booking_key"] = temp["conf_code"].fillna(temp["folio_num"])
    return (
        temp.groupby("booking_key", dropna=False)["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "villa_rental_revenue"})
    )


def _attach_revenue(stays_df: pd.DataFrame, rental_df: pd.DataFrame) -> pd.DataFrame:
    rev = _revenue_by_booking(rental_df)
    df = stays_df.merge(rev, on="booking_key", how="left")
    df["villa_rental_revenue"] = pd.to_numeric(df["villa_rental_revenue"], errors="coerce").fillna(0)
    return df


# ─── Builders ─────────────────────────────────────────────────────────────────


def build_visit_room_summary_kpis(stays_df: pd.DataFrame) -> pd.DataFrame:
    total_bookings = stays_df["booking_key"].nunique()
    result = pd.DataFrame([{
        "total_bookings": int(total_bookings),
        "member_bookings": int(stays_df.loc[stays_df["customer_segment"] == "Member", "booking_key"].nunique()),
        "guest_bookings": int(stays_df.loc[stays_df["customer_segment"] == "Guest", "booking_key"].nunique()),
        "unknown_bookings": int(stays_df.loc[stays_df["customer_segment"] == "Unknown", "booking_key"].nunique()),
        "total_room_nights": int(stays_df["nights"].sum()),
        "avg_stay_nights": round(float(stays_df["nights"].mean() or 0), 2),
        "avg_party_size": round(float(stays_df["persons"].mean() or 0), 2),
        "villa_rental_revenue": round(float(stays_df["villa_rental_revenue"].sum()), 2),
        "avg_revenue_per_booking": round(float(stays_df["villa_rental_revenue"].sum() / total_bookings), 2) if total_bookings else 0,
        "open_balance_due": round(float(stays_df["balance_due"].sum()), 2),
    }])
    _save(result, "visit_room_summary_kpis")
    return result


def _generic_breakdown(df: pd.DataFrame, group_col: str) -> pd.DataFrame:
    agg = (
        df.groupby(group_col, dropna=False)
        .agg(
            total_bookings=("booking_key", "nunique"),
            unique_members=("member_number", "nunique"),
            total_room_nights=("nights", "sum"),
            avg_stay_nights=("nights", "mean"),
            avg_party_size=("persons", "mean"),
            villa_rental_revenue=("villa_rental_revenue", "sum"),
            avg_balance_due=("balance_due", "mean"),
        )
        .reset_index()
    )
    agg[group_col] = agg[group_col].fillna("Unknown")
    for col in ["avg_stay_nights", "avg_party_size", "villa_rental_revenue", "avg_balance_due"]:
        agg[col] = agg[col].round(2)
    return agg.sort_values("total_bookings", ascending=False)


def build_member_guest_breakdown(stays_df: pd.DataFrame) -> pd.DataFrame:
    result = _generic_breakdown(stays_df, "customer_segment")
    _save(result, "visit_room_member_guest_breakdown")
    return result


def build_member_type_breakdown(stays_df: pd.DataFrame) -> pd.DataFrame:
    df = stays_df[stays_df["customer_segment"] == "Member"].copy()
    df["member_type"] = df["member_type"].fillna("Unknown Member Type")
    result = _generic_breakdown(df, "member_type")
    _save(result, "visit_room_member_type_breakdown")
    return result


def build_guest_type_breakdown(stays_df: pd.DataFrame) -> pd.DataFrame:
    df = stays_df[stays_df["customer_segment"] == "Guest"].copy()
    df["guest_type"] = df["guest_type"].fillna("Unknown Guest Type")
    result = _generic_breakdown(df, "guest_type")
    _save(result, "visit_room_guest_type_breakdown")
    return result


def build_villa_performance(stays_df: pd.DataFrame) -> pd.DataFrame:
    df = stays_df.copy()
    df["villa_name"] = df["villa_name"].fillna(df["room_type"]).fillna("Unknown Villa")
    result = _generic_breakdown(df, "villa_name")

    bed_mode = (
        df[df["bedroom_count"].notna()]
        .groupby("villa_name")["bedroom_count"]
        .agg(lambda s: int(s.mode().iloc[0]) if not s.mode().empty else None)
        .reset_index()
        .rename(columns={"bedroom_count": "most_common_bedroom_count"})
    )
    result = result.merge(bed_mode, on="villa_name", how="left")

    max_bookings = result["total_bookings"].max() if not result.empty else 0
    min_bookings = result["total_bookings"].min() if not result.empty else 0
    result["is_most_booked"] = result["total_bookings"] == max_bookings
    result["is_least_booked"] = result["total_bookings"] == min_bookings
    result["booking_rank"] = result["total_bookings"].rank(method="dense", ascending=False).astype(int)

    _save(result.sort_values(["total_bookings", "villa_rental_revenue"], ascending=False), "visit_room_villa_performance")
    return result


def build_bedroom_breakdown(stays_df: pd.DataFrame) -> pd.DataFrame:
    df = stays_df[stays_df["bedroom_count"].notna()].copy()
    df["bedroom_count"] = df["bedroom_count"].astype(int).astype(str) + " Bedroom"
    result = _generic_breakdown(df, "bedroom_count")
    _save(result, "visit_room_bedroom_breakdown")
    return result


def build_monthly_trends(stays_df: pd.DataFrame) -> pd.DataFrame:
    df = stays_df[stays_df["check_in_date"].notna()].copy()
    df["booking_month"] = df["check_in_date"].dt.to_period("M").astype(str)
    result = (
        df.groupby("booking_month")
        .agg(
            total_bookings=("booking_key", "nunique"),
            member_bookings=("customer_segment", lambda s: int((s == "Member").sum())),
            guest_bookings=("customer_segment", lambda s: int((s == "Guest").sum())),
            total_room_nights=("nights", "sum"),
            avg_stay_nights=("nights", "mean"),
            avg_party_size=("persons", "mean"),
            villa_rental_revenue=("villa_rental_revenue", "sum"),
            open_balance_due=("balance_due", "sum"),
        )
        .reset_index()
        .sort_values("booking_month")
    )
    for col in ["avg_stay_nights", "avg_party_size", "villa_rental_revenue", "open_balance_due"]:
        result[col] = result[col].round(2)
    _save(result, "visit_room_monthly_trends")
    return result


def build_folio_rental_transactions(rental_df: pd.DataFrame) -> pd.DataFrame:
    df = rental_df.copy()
    df["transaction_month"] = df["transaction_date"].dt.to_period("M").astype(str)
    df["amount"] = df["amount"].round(2)
    _save(df.drop(columns=["is_villa_rental"], errors="ignore"), "visit_room_folio_rental_transactions")
    return df


# ─── Main Pipeline ────────────────────────────────────────────────────────────


def build_visit_room_tables(*, dry_run: bool = False, recreate: bool = False) -> None:
    log.info("=== Visit / Room analytics pipeline starting ===")

    stays_df = _load_base_stays()
    rental_df = _load_villa_rental_transactions()
    stays_df = _attach_revenue(stays_df, rental_df)

    if stays_df.empty:
        log.error("No stay/reservation rows found — aborting.")
        return

    if dry_run:
        log.info("[DRY RUN] Would build:")
        log.info("  visit_room_summary_kpis                 1 row")
        log.info("  visit_room_member_guest_breakdown       ~%d rows", stays_df["customer_segment"].nunique())
        log.info("  visit_room_member_type_breakdown        ~%d rows", stays_df["member_type"].nunique())
        log.info("  visit_room_guest_type_breakdown         ~%d rows", stays_df["guest_type"].nunique())
        log.info("  visit_room_villa_performance            ~%d rows", stays_df["villa_name"].nunique())
        log.info("  visit_room_bedroom_breakdown            ~%d rows", stays_df["bedroom_count"].nunique())
        log.info("  visit_room_monthly_trends               ~%d rows", stays_df["check_in_date"].dt.to_period("M").nunique())
        log.info("  visit_room_folio_rental_transactions    %d rows", len(rental_df))
        return

    build_visit_room_summary_kpis(stays_df)
    build_member_guest_breakdown(stays_df)
    build_member_type_breakdown(stays_df)
    build_guest_type_breakdown(stays_df)
    build_villa_performance(stays_df)
    build_bedroom_breakdown(stays_df)
    build_monthly_trends(stays_df)
    build_folio_rental_transactions(rental_df)

    log.info("=== Visit / Room analytics pipeline complete ===")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build visit / room analytics tables.")
    parser.add_argument("--dry-run", action="store_true", help="Read data but do not write tables")
    parser.add_argument("--recreate", action="store_true", help="Reserved for compatibility")
    args = parser.parse_args()
    build_visit_room_tables(dry_run=args.dry_run, recreate=args.recreate)


if __name__ == "__main__":
    main()
