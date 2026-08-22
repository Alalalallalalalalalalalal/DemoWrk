// frontend/src/pages/visits/VisitsRoomsTab.jsx
//
// Orchestrator for the Visits & rooms tab. Merged replacement for the
// original VisitsRoomsTab.jsx + VillaSourceBreakdown.jsx.
//
// Owns local UI-selector state only (date period, tab, chart/table
// selectors, drill-down selection) — the dashboard fetch and every derived
// aggregate live in useVisitsRoomsData.js. See that file for the endpoint
// list and perf/reconciliation notes.

import { useMemo, useState } from "react";
import {
  DatePeriod,
  FONT_DISPLAY,
  Segmented,
  T,
  n0,
} from "./VisitsRoomsShared";
import { useVisitsRoomsData } from "./useVisitsRoomsData";
import VisitsSummaryCards from "./VisitsSummaryCards";
import VisitsLeadersRow from "./VisitsLeadersRow";
import VisitsChartPanel from "./VisitsChartPanel";
import VisitsPerformanceTable from "./VisitsPerformanceTable";
import DrillPanel from "./DrillPanel";
import MemberGuestPanel from "./MemberGuestPanel";

export default function VisitsRoomsTab({ selectedVillaName, onVillaSelect }) {
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2018 + 1 }, (_, i) => current - i);
  }, []);

  const [period, setPeriod] = useState({ mode: "all" });
  const [tab, setTab] = useState("overall"); // overall | paid | free

  const [chartDim, setChartDim] = useState("villa");
  const [chartMetric, setChartMetric] = useState("bookings");
  const [chartSort, setChartSort] = useState("desc");
  const [chartLimit, setChartLimit] = useState(30);

  const [tableDim, setTableDim] = useState("villa");
  const [tableFigureMode, setTableFigureMode] = useState("overall");
  const [tableSort, setTableSort] = useState({ col: "value", dir: "desc" });
  const [query, setQuery] = useState("");

  const [selection, setSelection] = useState(null);
  const [splitOpen, setSplitOpen] = useState(false);

  const {
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
  } = useVisitsRoomsData({
    period,
    tab,
    chartDim,
    chartMetric,
    chartSort,
    tableDim,
    tableFigureMode,
    tableSort,
    query,
  });

  const openVilla = (name) => {
    const meta = villaMeta.get(name);
    onVillaSelect?.(name);
    setSelection({
      kind: "villa",
      key: name,
      label: name,
      configs: meta?.configs ?? [],
    });
  };
  const openBedroom = (beds) =>
    setSelection({
      kind: "bedroom",
      key: beds,
      label: `${beds}-bedroom stays`,
    });

  const openFromChart = (d) => {
    if (!d) return;
    if (chartDim === "villa") openVilla(d.key);
    else if (d.key !== "Unknown") openBedroom(d.key);
  };

  return (
    <div className="dashboard-section visits-page">
      <style>{`
        .vr-focus:focus-visible { outline: 2px solid ${T.deep}; outline-offset: 2px; }
        .vr-row:hover { background: ${T.mist}; }
        .vr-lift { transition: box-shadow .18s ease, transform .18s ease; }
        .vr-lift:hover { box-shadow: 0 8px 22px rgba(26,39,51,0.08); }
        .vr-grip { opacity: .55; transition: opacity .15s ease; }
        [role="separator"]:hover .vr-grip { opacity: 1; }
        .vr-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .vr-scroll::-webkit-scrollbar-track { background: ${T.mist}; border-radius: 8px; }
        .vr-scroll::-webkit-scrollbar-thumb { background: #C7D8E4; border-radius: 8px; }
        .vr-scroll::-webkit-scrollbar-thumb:hover { background: ${T.link}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            className="text-xs font-bold uppercase"
            style={{ letterSpacing: "0.12em", color: T.link, fontSize: 11 }}
          >
            Visits &amp; rooms
          </div>
          <h1
            className="visits-page-title"
            style={{
              fontFamily: FONT_DISPLAY,
              color: T.ink,
              margin: "4px 0 0",
              lineHeight: 1,
            }}
          >
            Villa bookings
          </h1>
          <p className="mt-1" style={{ fontSize: 12, color: T.slate }}>
            {loading
              ? "Updating…"
              : `${n0(performanceVillaRows.length)} villas in this period`}
          </p>
        </div>
        <div className="visits-toolbar">
          <Segmented
            value={tab}
            onChange={(v) => {
              setTab(v);
              setSelection(null);
            }}
            options={[
              { value: "overall", label: "Overall" },
              { value: "paid", label: "Paid" },
              { value: "free", label: "Comp" },
            ]}
          />
          <DatePeriod period={period} onChange={setPeriod} years={years} />
        </div>
      </div>

      {/* A failed load used to leave the page silently empty, which looked
          identical to "no bookings in this period". Say which it is. */}
      {loadError && (
        <div
          className="rounded-xl p-3 text-xs"
          style={{
            background: "#FFF4E6",
            color: "#8A5A20",
            border: "1px solid #F5DDBC",
          }}
        >
          Could not load this period: {loadError}
        </div>
      )}

      <VisitsSummaryCards
        tab={tab}
        summary={summary}
        totals={totals}
        period={period}
        onOpenSplit={() => setSplitOpen(true)}
      />

      <VisitsLeadersRow leaders={leaders} tab={tab} onOpenVilla={openVilla} />

      <VisitsChartPanel
        chartDim={chartDim}
        setChartDim={setChartDim}
        chartMetric={chartMetric}
        setChartMetric={setChartMetric}
        chartSort={chartSort}
        setChartSort={setChartSort}
        chartLimit={chartLimit}
        setChartLimit={setChartLimit}
        chartAll={chartAll}
        valueLabel={valueLabel}
        selection={selection}
        onSelect={openFromChart}
      />

      <VisitsPerformanceTable
        tableDim={tableDim}
        setTableDim={setTableDim}
        tableFigureMode={tableFigureMode}
        setTableFigureMode={setTableFigureMode}
        tableSort={tableSort}
        setTableSort={setTableSort}
        query={query}
        setQuery={setQuery}
        tableRows={tableRows}
        performanceValueLabel={performanceValueLabel}
        tableExport={tableExport}
        period={period}
        selectedVillaName={selectedVillaName}
        openVilla={openVilla}
        openBedroom={openBedroom}
      />

      {/* Panels mount only while open — nothing dereferences a cleared selection. */}
      {selection && (
        <DrillPanel
          selection={selection}
          tab={tab}
          params={params}
          period={period}
          onClose={() => setSelection(null)}
          onOpenVilla={openVilla}
          villaMetrics={
            selection.kind === "villa" ? getVillaMetrics(selection.key) : null
          }
        />
      )}

      {splitOpen && (
        <MemberGuestPanel
          params={params}
          period={period}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </div>
  );
}
