// frontend/src/pages/visits/useVisitsRoomsData.js
//
// Endpoints used:
//   /analytics/visits-rooms-dashboard   ONE call on page load. Returns
//                                       summary, villa_stats,
//                                       bookings_by_bedroom,
//                                       villa_source_breakdown and
//                                       villa_source_bedroom_breakdown.
//
// PERF NOTE (Aug 2026) — read before adding another fetch here:
//   This page used to fire three requests on load: visits-rooms-dashboard,
//   villa-source-breakdown and villa-source-bedroom-breakdown. Each one made
//   the backend rebuild its entire booking base from rate_details, so a
//   single page load cost seven full rebuilds and the page took forever.
//   The two breakdown datasets now ride along inside the dashboard payload.
//   If you need another dataset, add it to that payload rather than adding a
//   fourth request.
//
// PER-VILLA FIGURES — read before changing:
//   villa_paid_free_totals is the authoritative per-villa dataset returned by
//   /analytics/visits-rooms-dashboard.
//   Overall = Overview Villa net amount.
//   Paid    = Overview paid Villa net amount.
//   Free    = rack-rate value from rate_details_with_discount, including
//             zero-charged Paid reservations.
//   Source rows remain useful for source/nights/member drill-downs, but must
//   not replace these authoritative villa totals.
//
// This hook owns the single dashboard fetch plus every derived useMemo that
// shapes/aggregates the raw rows. It takes the page's local UI-selector state
// (period/tab/chart/table selections) as input because several of the memos
// depend on them, and returns everything VisitsRoomsTab and its child
// components need to render.

import { useCallback, useEffect, useMemo, useState } from "react";
import { analyticsApi } from "../../api/analytics";
import { isAbort, periodToParams, sortRows } from "./VisitsRoomsShared";

export function useVisitsRoomsData({
  period,
  tab,
  chartDim,
  chartMetric,
  chartSort,
  tableDim,
  tableFigureMode,
  tableSort,
  query,
}) {
  const [summary, setSummary] = useState({});
  const [villaStats, setVillaStats] = useState([]);
  const [villaPaidFreeTotals, setVillaPaidFreeTotals] = useState([]);
  const [bedroomStats, setBedroomStats] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [bedroomSourceRows, setBedroomSourceRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const params = useMemo(() => periodToParams(period), [period]);

  // ── ONE request for the whole page ────────────────────────────────
  // Debounced 400ms: clicking through years in the date picker used to fire a
  // fresh request on every click with nothing cancelling the previous one, so
  // several piled up in flight, each holding a DB connection until it
  // finished. The AbortController kills whatever is still running when the
  // filter changes again, and also stops a late response overwriting fresher
  // data.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    const timer = setTimeout(() => {
      analyticsApi
        .visitsRoomsDashboard(params, { signal: controller.signal })
        .then((data) => {
          if (cancelled) return;
          setSummary(data?.summary ?? {});
          setVillaStats(
            Array.isArray(data?.villa_stats) ? data.villa_stats : [],
          );
          setVillaPaidFreeTotals(
            Array.isArray(data?.villa_paid_free_totals)
              ? data.villa_paid_free_totals
              : [],
          );
          setBedroomStats(
            Array.isArray(data?.bookings_by_bedroom)
              ? data.bookings_by_bedroom
              : [],
          );
          // These two used to be separate round trips. They now ride along in
          // the same payload — see the perf note at the top of this file.
          setSourceRows(
            Array.isArray(data?.villa_source_breakdown)
              ? data.villa_source_breakdown
              : [],
          );
          setBedroomSourceRows(
            Array.isArray(data?.villa_source_bedroom_breakdown)
              ? data.villa_source_bedroom_breakdown
              : [],
          );
        })
        .catch((err) => {
          if (isAbort(err)) return;
          console.error(err);
          if (!cancelled) setLoadError(err?.message || "Request failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [params]);

  /* villa_stats returns one row per villa AND bedroom_count — that is where
     the bedroom layouts and the published avg stay come from. */
  const villaMeta = useMemo(() => {
    const map = new Map();
    villaStats.forEach((r) => {
      if (!r.villa_name) return;
      if (!map.has(r.villa_name))
        map.set(r.villa_name, { configs: [], stayWeight: 0, bookings: 0 });
      const e = map.get(r.villa_name);
      if (r.bedroom_count != null && !e.configs.includes(r.bedroom_count))
        e.configs.push(r.bedroom_count);
      // villa_stats can repeat whole-villa authoritative booking totals across
      // bedroom-layout rows. Weight avg stay using operational row counts when
      // available so we do not multiply the villa booking count.
      const b = Number(
        (r.rate_detail_rows ?? r.rate_booking_count ?? r.bookings) || 0,
      );
      e.bookings += b;
      e.stayWeight += Number(r.avg_stay || 0) * b;
    });
    map.forEach((e) => {
      e.configs.sort((a, b) => a - b);
      e.avgStay = e.bookings ? e.stayWeight / e.bookings : null;
    });
    return map;
  }, [villaStats]);

  const villaMetricsMap = useMemo(() => {
    const map = new Map();
    villaPaidFreeTotals.forEach((r) => {
      if (!r?.villa_name) return;
      map.set(String(r.villa_name).trim().toLowerCase(), r);
    });
    return map;
  }, [villaPaidFreeTotals]);

  const getVillaMetrics = useCallback(
    (villaName) =>
      villaMetricsMap.get(
        String(villaName || "")
          .trim()
          .toLowerCase(),
      ) ?? null,
    [villaMetricsMap],
  );

  const keepRow = (r) =>
    tab === "overall" || (tab === "paid" ? !r.is_free : r.is_free);

  const villaRows = useMemo(() => {
    const map = new Map();
    sourceRows.filter(keepRow).forEach((r) => {
      const key = r.villa_name || "Unknown villa";
      if (!map.has(key))
        map.set(key, {
          key,
          name: key,
          bookings: 0,
          nights: 0,
          revenue: 0,
          compValue: 0,
          paid: 0,
          comp: 0,
          members: 0,
        });
      const e = map.get(key);
      const b = Number(r.bookings || 0);
      e.bookings += b;
      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);
      if (r.is_free) {
        e.comp += b;
        e.compValue += Number(r.free_value ?? r.total_value ?? 0);
      } else {
        e.paid += b;
        e.revenue += Number(r.revenue || 0);
      }
    });
    return [...map.values()].map((e) => {
      const meta = villaMeta.get(e.name);
      const metrics = getVillaMetrics(e.name);

      const overallBookings = Number(
        metrics?.total_unique_bookings ?? e.bookings,
      );
      const paidBookings = Number(metrics?.paid_unique_bookings ?? e.paid);
      const freeBookings = Number(metrics?.free_unique_bookings ?? e.comp);

      const overallValue = Number(metrics?.overall_total_rental ?? e.revenue);
      const paidValue = Number(metrics?.paid_total_rental ?? e.revenue);
      const freeValue = Number(metrics?.free_total_rental ?? e.compValue);

      return {
        ...e,
        metrics,
        overallBookings,
        paidBookings,
        freeBookings,
        overallValue,
        paidValue,
        freeValue,
        configs: meta?.configs ?? [],
        avgStay: meta?.avgStay ?? (e.bookings ? e.nights / e.bookings : null),
        value:
          tab === "free"
            ? freeValue
            : tab === "paid"
              ? paidValue
              : overallValue,
      };
    });
  }, [sourceRows, tab, villaMeta, getVillaMetrics]);

  // Performance-by-villa has its own Overall / Paid / Free selector.
  // Build this from ALL source rows so changing the page-level tab does not
  // hide villas or alter the figures shown in the performance table.
  const performanceVillaRows = useMemo(() => {
    const map = new Map();

    sourceRows.forEach((r) => {
      const key = r.villa_name || "Unknown villa";

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: key,
          nights: 0,
          members: 0,
          sourcePaidBookings: 0,
          sourceFreeBookings: 0,
        });
      }

      const e = map.get(key);
      const b = Number(r.bookings || 0);

      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);

      if (r.is_free) e.sourceFreeBookings += b;
      else e.sourcePaidBookings += b;
    });

    // Also include any villa that exists in the authoritative metrics even if
    // it has no source-breakdown row for the selected period.
    villaPaidFreeTotals.forEach((m) => {
      const key = m?.villa_name || "Unknown villa";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: key,
          nights: 0,
          members: 0,
          sourcePaidBookings: 0,
          sourceFreeBookings: 0,
        });
      }
    });

    return [...map.values()].map((e) => {
      const metrics = getVillaMetrics(e.name);
      const meta = villaMeta.get(e.name);

      const overallBookings = Number(
        metrics?.total_unique_bookings ??
          e.sourcePaidBookings + e.sourceFreeBookings,
      );
      const paidBookings = Number(
        metrics?.paid_unique_bookings ?? e.sourcePaidBookings,
      );
      const freeBookings = Number(
        metrics?.free_unique_bookings ?? e.sourceFreeBookings,
      );

      return {
        ...e,
        metrics,
        configs: meta?.configs ?? [],
        avgStay:
          meta?.avgStay ??
          (overallBookings ? e.nights / overallBookings : null),
        overallBookings,
        paidBookings,
        freeBookings,
        overallValue: Number(metrics?.overall_total_rental ?? 0),
        paidValue: Number(metrics?.paid_total_rental ?? 0),
        freeValue: Number(metrics?.free_total_rental ?? 0),
        paid: paidBookings,
        comp: freeBookings,
      };
    });
  }, [sourceRows, villaPaidFreeTotals, villaMeta, getVillaMetrics]);

  const bedroomRows = useMemo(() => {
    const stayByBed = new Map(
      bedroomStats.map((r) => [Number(r.beds), Number(r.avg_stay || 0)]),
    );
    const map = new Map();
    bedroomSourceRows.filter(keepRow).forEach((r) => {
      const key = r.bedroom_count ?? "Unknown";
      if (!map.has(key))
        map.set(key, {
          key,
          name: key === "Unknown" ? "Not set" : `${key} bedroom`,
          configs: [Number(key)],
          bookings: 0,
          nights: 0,
          revenue: 0,
          compValue: 0,
          paid: 0,
          comp: 0,
          members: 0,
        });
      const e = map.get(key);
      const b = Number(r.bookings || 0);
      e.bookings += b;
      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);
      if (r.is_free) {
        e.comp += b;
        e.compValue += Number(r.free_value || 0);
      } else {
        e.paid += b;
        e.revenue += Number(r.revenue || 0);
      }
    });
    return [...map.values()].map((e) => ({
      ...e,
      avgStay:
        stayByBed.get(Number(e.key)) ??
        (e.bookings ? e.nights / e.bookings : null),
      value: tab === "free" ? e.compValue : e.revenue,
    }));
  }, [bedroomSourceRows, bedroomStats, tab]);

  // Authoritative villa figures for the currently selected page tab.
  //
  // Booking counts and dollar values come from villa_paid_free_totals.
  // Operational measures such as nights/members still come from the source
  // breakdown so existing drill-down behaviour remains unchanged.
  const activeVillaRows = useMemo(() => {
    const operationalByVilla = new Map(
      villaRows.map((r) => [
        String(r.name || "")
          .trim()
          .toLowerCase(),
        r,
      ]),
    );

    return performanceVillaRows.map((r) => {
      const operational =
        operationalByVilla.get(
          String(r.name || "")
            .trim()
            .toLowerCase(),
        ) ?? null;

      const bookings =
        tab === "paid"
          ? Number(r.paidBookings || 0)
          : tab === "free"
            ? Number(r.freeBookings || 0)
            : Number(r.overallBookings || 0);

      const value =
        tab === "paid"
          ? Number(r.paidValue || 0)
          : tab === "free"
            ? Number(r.freeValue || 0)
            : Number(r.overallValue || 0);

      const nights = Number(operational?.nights ?? 0);

      return {
        ...r,
        bookings,
        value,
        nights,
        members: Number(operational?.members ?? r.members ?? 0),
        avgStay: operational?.avgStay ?? (bookings ? nights / bookings : null),
      };
    });
  }, [performanceVillaRows, villaRows, tab]);

  const totals = useMemo(() => {
    const authoritative = activeVillaRows.reduce(
      (a, r) => ({
        bookings: a.bookings + Number(r.bookings || 0),
        value: a.value + Number(r.value || 0),
      }),
      { bookings: 0, value: 0 },
    );

    const operational = villaRows.reduce(
      (a, r) => ({
        nights: a.nights + Number(r.nights || 0),
        revenue: a.revenue + Number(r.revenue || 0),
        compValue: a.compValue + Number(r.compValue || 0),
      }),
      {
        nights: 0,
        revenue: 0,
        compValue: 0,
      },
    );

    const paid = performanceVillaRows.reduce(
      (s, r) => s + Number(r.paidBookings || 0),
      0,
    );

    const comp = performanceVillaRows.reduce(
      (s, r) => s + Number(r.freeBookings || 0),
      0,
    );

    const unsplit = tab === "overall";

    return {
      ...operational,
      bookings: authoritative.bookings,
      value: authoritative.value,
      paid,
      comp,
      avgStay: unsplit
        ? (summary?.avg_length_of_stay ?? null)
        : authoritative.bookings
          ? operational.nights / authoritative.bookings
          : null,
      avgParty: unsplit ? (summary?.avg_party_size ?? null) : null,
      avgStayDerived: !unsplit,
    };
  }, [activeVillaRows, performanceVillaRows, villaRows, tab, summary]);

  const leaders = useMemo(() => {
    const withBookings = activeVillaRows.filter(
      (r) => Number(r.bookings || 0) > 0,
    );

    const withValue = activeVillaRows.filter((r) => Number(r.value || 0) > 0);

    const byBookings = [...withBookings].sort(
      (a, b) => Number(b.bookings) - Number(a.bookings),
    );

    const byValue = [...withValue].sort(
      (a, b) => Number(b.value) - Number(a.value),
    );

    return {
      mostBooked: byBookings[0],
      leastBooked: byBookings[byBookings.length - 1],
      mostValue: byValue[0],
      leastValue: byValue[byValue.length - 1],
    };
  }, [activeVillaRows]);

  const chartAll = useMemo(() => {
    const rows = chartDim === "villa" ? activeVillaRows : bedroomRows;

    const metricKey = chartMetric === "revenue" ? "value" : chartMetric;

    const arr = rows.map((r) => ({
      ...r,
      label: chartDim === "villa" ? r.name : `${r.key} bed`,
    }));

    arr.sort((a, b) =>
      chartSort === "name"
        ? String(a.label).localeCompare(String(b.label))
        : chartSort === "asc"
          ? Number(a[metricKey] || 0) - Number(b[metricKey] || 0)
          : Number(b[metricKey] || 0) - Number(a[metricKey] || 0),
    );

    return arr;
  }, [activeVillaRows, bedroomRows, chartDim, chartMetric, chartSort]);

  const valueLabel =
    tab === "free"
      ? "Free value"
      : tab === "paid"
        ? "Paid revenue"
        : "Overall revenue";

  const tableRows = useMemo(() => {
    let rows;

    if (tableDim === "villa") {
      rows = performanceVillaRows.map((r) => {
        const value =
          tableFigureMode === "paid"
            ? r.paidValue
            : tableFigureMode === "free"
              ? r.freeValue
              : r.overallValue;

        const bookings =
          tableFigureMode === "paid"
            ? r.paidBookings
            : tableFigureMode === "free"
              ? r.freeBookings
              : r.overallBookings;

        return {
          ...r,
          value,
          bookings,
        };
      });
    } else {
      rows = bedroomRows;
    }

    const searched = query.trim()
      ? rows.filter((r) =>
          String(r.name).toLowerCase().includes(query.trim().toLowerCase()),
        )
      : rows;

    return sortRows(searched, tableSort.col, tableSort.dir);
  }, [
    performanceVillaRows,
    bedroomRows,
    tableDim,
    tableFigureMode,
    query,
    tableSort,
  ]);

  const performanceValueLabel =
    tableDim === "villa"
      ? tableFigureMode === "paid"
        ? "Paid revenue"
        : tableFigureMode === "free"
          ? "Free value"
          : "Overall revenue"
      : valueLabel;

  const tableExport = tableRows.map((r) => ({
    [tableDim === "villa" ? "Villa" : "Bedrooms"]: r.name,
    Bedrooms: r.configs?.join(" / ") ?? "",
    "Displayed Figure": tableDim === "villa" ? tableFigureMode : tab,
    "Displayed Value": r.value,
    "Overall Revenue": tableDim === "villa" ? r.overallValue : "",
    "Paid Revenue": tableDim === "villa" ? r.paidValue : r.revenue,
    "Free Value": tableDim === "villa" ? r.freeValue : r.compValue,
    Bookings: r.bookings,
    Paid: r.paid,
    Comp: r.comp,
    "Nights Spent": r.nights,
    "Avg Stay": r.avgStay == null ? "" : Number(r.avgStay).toFixed(1),
    Members: r.members,
  }));

  return {
    params,
    loading,
    loadError,
    summary,
    villaMeta,
    getVillaMetrics,
    performanceVillaRows,
    totals,
    leaders,
    chartAll,
    tableRows,
    tableExport,
    performanceValueLabel,
    valueLabel,
  };
}
