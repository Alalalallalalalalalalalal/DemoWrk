"""
lead_time_report.py — Analytics/export layer on top of
reservation_lead_time.csv (produced by reservation_lead_time_scraper.py).

Computes booking lead time (Created On -> Arrival Date) as:
  - Full raw data
  - Overall / by-year / custom-date-range averages
  - Monthly and yearly trends
  - Exportable to a single .xlsx with separate sheets

Usage:
    # Full report, all years
    python lead_time_report.py

    # Just 2025
    python lead_time_report.py --year 2025

    # Custom date range (filters on arrival_date)
    python lead_time_report.py --start 2025-01-01 --end 2025-06-30

    # Custom output path
    python lead_time_report.py --year 2025 --out reports/lead_time_2025.xlsx
"""

import os
import argparse
import pandas as pd

from config import OUTPUT_FOLDER

REPORTS_FOLDER = os.path.join(OUTPUT_FOLDER, "reports")
LEAD_TIME_CSV  = os.path.join(REPORTS_FOLDER, "reservation_lead_time.csv")
DEFAULT_REPORT = os.path.join(REPORTS_FOLDER, "lead_time_report.xlsx")


def load_lead_time_data(csv_path=LEAD_TIME_CSV):
    """Load the raw scrape output and coerce types for analysis."""
    if not os.path.exists(csv_path):
        raise FileNotFoundError(
            f"{csv_path} not found — run reservation_lead_time_scraper.py first."
        )

    df = pd.read_csv(csv_path)
    df["arrival_date"]   = pd.to_datetime(df["arrival_date"], errors="coerce")
    df["created_on"]     = pd.to_datetime(df["created_on"], errors="coerce")
    df["lead_time_days"] = pd.to_numeric(df["lead_time_days"], errors="coerce")

    # Drop rows we couldn't compute a lead time for (missing/unparsed dates),
    # but keep them visible in the raw sheet by loading full_df separately.
    return df


def filter_by_range(df, year=None, start=None, end=None):
    """Filter rows by arrival_date — either a single year or a custom range."""
    out = df.copy()
    if year:
        out = out[out["arrival_date"].dt.year == int(year)]
    if start:
        out = out[out["arrival_date"] >= pd.to_datetime(start)]
    if end:
        out = out[out["arrival_date"] <= pd.to_datetime(end)]
    return out


def compute_lead_time_stats(df):
    """
    Returns (summary_dict, monthly_trend_df, yearly_trend_df).
    Only rows with a valid lead_time_days are used for the numeric stats.
    """
    valid = df.dropna(subset=["lead_time_days", "arrival_date"])

    summary = {
        "reservations_with_lead_time": int(len(valid)),
        "reservations_total":          int(len(df)),
        "avg_lead_time_days":          round(valid["lead_time_days"].mean(), 1) if len(valid) else None,
        "median_lead_time_days":       valid["lead_time_days"].median() if len(valid) else None,
        "min_lead_time_days":          valid["lead_time_days"].min() if len(valid) else None,
        "max_lead_time_days":          valid["lead_time_days"].max() if len(valid) else None,
    }

    if len(valid):
        monthly = (
            valid.set_index("arrival_date")
                 .resample("MS")["lead_time_days"]
                 .agg(["count", "mean", "median"])
                 .rename(columns={"mean": "avg_lead_time_days", "median": "median_lead_time_days"})
                 .reset_index()
                 .rename(columns={"arrival_date": "month"})
        )
        monthly["avg_lead_time_days"] = monthly["avg_lead_time_days"].round(1)

        yearly = (
            valid.assign(year=valid["arrival_date"].dt.year)
                 .groupby("year")["lead_time_days"]
                 .agg(["count", "mean", "median", "min", "max"])
                 .rename(columns={"mean": "avg_lead_time_days", "median": "median_lead_time_days"})
                 .reset_index()
        )
        yearly["avg_lead_time_days"] = yearly["avg_lead_time_days"].round(1)
    else:
        monthly = pd.DataFrame(columns=["month", "count", "avg_lead_time_days", "median_lead_time_days"])
        yearly  = pd.DataFrame(columns=["year", "count", "avg_lead_time_days", "median_lead_time_days", "min", "max"])

    return summary, monthly, yearly


def export_lead_time_report(df, summary, monthly, yearly, out_path=DEFAULT_REPORT):
    """Write a multi-sheet .xlsx: Raw Data, Summary, Monthly Trend, Yearly Trend."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Raw Data", index=False)
        pd.DataFrame([summary]).to_excel(writer, sheet_name="Summary", index=False)
        monthly.to_excel(writer, sheet_name="Monthly Trend", index=False)
        yearly.to_excel(writer, sheet_name="Yearly Trend", index=False)
    print(f"Report exported → {out_path}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Booking lead-time analytics report.")
    parser.add_argument("--year", help="Restrict to a single arrival year, e.g. 2025")
    parser.add_argument("--start", help="Custom range start date (YYYY-MM-DD), on arrival_date")
    parser.add_argument("--end", help="Custom range end date (YYYY-MM-DD), on arrival_date")
    parser.add_argument("--out", default=DEFAULT_REPORT, help="Output .xlsx path")
    args = parser.parse_args()

    df = load_lead_time_data()
    df = filter_by_range(df, year=args.year, start=args.start, end=args.end)

    summary, monthly, yearly = compute_lead_time_stats(df)

    print("=" * 60)
    print("Lead Time Summary")
    print("=" * 60)
    for k, v in summary.items():
        print(f"  {k:32s}: {v}")
    print()
    print("Yearly Trend:")
    print(yearly.to_string(index=False) if len(yearly) else "  (no data)")

    export_lead_time_report(df, summary, monthly, yearly, out_path=args.out)


if __name__ == "__main__":
    main()
