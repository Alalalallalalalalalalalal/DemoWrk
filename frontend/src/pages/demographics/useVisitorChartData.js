import { useEffect, useMemo, useState } from "react";

import { analyticsApi } from "../../api/analytics";
import { DEFAULT_VISITOR_FILTER } from "./NewVsRepeatFilterBar";

/* New vs Repeat: maps the "Years shown" label to a span (in years). */
const YEARS_SHOWN_SPAN = {
  "Past 5 years": 5,
  "Past 10 years": 10,
  "Past 15 years": 15,
  "Past 20 years": 20,
};

const toVisitorParams = (filter, currentYr) => {
  if (filter.mode === "range") {
    if (
      !filter.startMonth ||
      !filter.startYear ||
      !filter.endMonth ||
      !filter.endYear
    ) {
      return null;
    }

    return {
      start_year: Number(filter.startYear),
      start_month: Number(filter.startMonth),
      end_year: Number(filter.endYear),
      end_month: Number(filter.endMonth),
    };
  }

  // Year mode
  if (filter.yearsShown === "All years") {
    return {};
  }

  const span = YEARS_SHOWN_SPAN[filter.yearsShown] ?? 10;

  const endYear =
    filter.endingYear === "Latest year" ? currentYr : Number(filter.endingYear);

  const startYear = endYear - span + 1;

  return { start_year: startYear, end_year: endYear };
};

/* New vs Repeat Accounts chart: years-available + chart-data fetch,
   plus the subtitle/axis-interval derivations that depend on them. */
export default function useVisitorChartData(currentYear) {
  const [visitorChartFilter, setVisitorChartFilter] = useState(
    DEFAULT_VISITOR_FILTER,
  );
  const [visitorYearsAvailable, setVisitorYearsAvailable] = useState([]);
  const [visitorChartData, setVisitorChartData] = useState([]);
  const [visitorChartLoading, setVisitorChartLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    analyticsApi
      .newVsRepeatVisitors({})
      .then((data) => {
        if (cancelled) return;

        const rowsArray = Array.isArray(data) ? data : [];

        const uniqueYears = Array.from(
          new Set(
            rowsArray
              .map((row) => Number(row.year))
              .filter((year) => Number.isFinite(year) && year <= currentYear),
          ),
        ).sort((a, b) => b - a);

        setVisitorYearsAvailable(uniqueYears);
      })
      .catch((error) => {
        console.error(
          "Unable to load available years for New vs Repeat chart:",
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentYear]);

  useEffect(() => {
    let cancelled = false;

    const loadVisitorChart = async () => {
      const params = toVisitorParams(visitorChartFilter, currentYear);

      if (params === null) {
        // Custom Range selected but not yet applied — wait.
        return;
      }

      setVisitorChartLoading(true);

      try {
        const data = await analyticsApi.newVsRepeatVisitors(params);

        if (!cancelled) {
          const rowsArray = Array.isArray(data) ? data : [];

          const capped =
            visitorChartFilter.mode === "range"
              ? rowsArray
              : rowsArray.filter((row) => Number(row.year) <= currentYear);

          setVisitorChartData(capped);
        }
      } catch (error) {
        console.error("Unable to load New vs Repeat chart:", error);

        if (!cancelled) {
          setVisitorChartData([]);
        }
      } finally {
        if (!cancelled) {
          setVisitorChartLoading(false);
        }
      }
    };

    loadVisitorChart();

    return () => {
      cancelled = true;
    };
  }, [visitorChartFilter, currentYear]);

  const visitorChartSubtitle = useMemo(() => {
    if (visitorChartLoading && !visitorChartData.length) {
      return "Loading account history…";
    }

    if (!visitorChartData.length) {
      return "No account history available for this range.";
    }

    if (visitorChartFilter.mode === "range") {
      const first = visitorChartData[0];
      const last = visitorChartData[visitorChartData.length - 1];
      const numMonths = visitorChartData.length;

      return (
        `Monthly seasonal trend · ${first.period_label}` +
        `–${last.period_label} · ${numMonths} month${
          numMonths === 1 ? "" : "s"
        }`
      );
    }

    const dataYears = visitorChartData
      .map((row) => Number(row.year))
      .filter((year) => Number.isFinite(year));

    const rangeStart = Math.min(...dataYears);
    const rangeEnd = Math.max(...dataYears);

    if (visitorChartFilter.yearsShown === "All years") {
      return `Showing all available years · ${rangeStart}–${rangeEnd}`;
    }

    return `Showing the ${visitorChartFilter.yearsShown.toLowerCase()} · ${rangeStart}–${rangeEnd}`;
  }, [visitorChartData, visitorChartFilter, visitorChartLoading]);

  const visitorAxisInterval = useMemo(() => {
    const numPoints = visitorChartData.length;

    if (visitorChartFilter.mode === "range") {
      if (numPoints <= 12) return 0;
      if (numPoints <= 18) return 1;
      return 2;
    }

    if (
      visitorChartFilter.mode === "year" &&
      visitorChartFilter.yearsShown === "All years"
    ) {
      return Math.max(0, Math.ceil(numPoints / 12) - 1);
    }

    if (numPoints <= 15) return 0;
    if (numPoints <= 20) return 1;

    return Math.max(1, Math.ceil(numPoints / 12) - 1);
  }, [visitorChartData, visitorChartFilter]);

  return {
    visitorChartFilter,
    setVisitorChartFilter,
    visitorYearsAvailable,
    visitorChartData,
    visitorChartLoading,
    visitorChartSubtitle,
    visitorAxisInterval,
  };
}
