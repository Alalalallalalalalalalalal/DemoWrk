// frontend/src/pages/finance/FinanceTab.jsx
// ─────────────────────────────────────────────────────────────────
// Drop-in Finance tab.  Import and register in Dashboard.jsx:
//
//   import FinanceTab from "./finance/FinanceTab";
//   { id: "finance", label: "Finance", Icon: DollarSign }   ← add to TABS
//   {activeTab === "finance" && <FinanceTab />}              ← add to render
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from "react";
import { financeApi } from "../../api/financeApi";
import FinanceOverview from "./FinanceOverview";
import SourceRevenueTable from "./SourceRevenueTable";
import { MemberGuestRevenueTable, VillaRevenueTable } from "./FinanceTables";
import AmenityRevenueTable from "./AmenityRevenueTable";
import RevenueBreakdownDrawer from "./RevenueBreakdownDrawer";
import CategoryCompBreakdown from "./CategoryCompBreakdown";
import { FinancePeriodFilter, periodToParams, DEFAULT_PERIOD } from "./FinanceShared";

const C = {
  text:   "var(--dashboard-abyssal)",
  muted:  "var(--dashboard-muted)",
  border: "var(--dashboard-border)",
  accent: "var(--dashboard-deep-blue)",
};

// ── Thin section label (reuses dashboard class + local divider) ──
function SectionLabel({ children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "8px 0 4px",
      }}
    >
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: C.muted,
          fontFamily: "sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// ── Inline error ────────────────────────────────────────────────
function InlineError({ message }) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRadius: 12,
        border: `1px solid var(--dashboard-border)`,
        background: "#FFF4F4",
        color: "#C45B5B",
        fontSize: 13,
        fontFamily: "sans-serif",
      }}
    >
      {message}
    </div>
  );
}

// ── Skeleton placeholder ────────────────────────────────────────
function Skeleton({ height = 120 }) {
  return (
    <div
      style={{
        height,
        borderRadius: 18,
        background: "var(--dashboard-panel-alt)",
        animation: "pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}

// ══════════════════════════════════════════════════════════════════
export default function FinanceTab() {
  // ── period filter (year / month) - drives every fetch below ─────
const [period, setPeriod] = useState(DEFAULT_PERIOD);

  // Placeholder year range - there's no "available years" endpoint yet,
  // so this just offers the current year back 6 years. Swap this out for
  // a real source (e.g. whatever DemographicsDateFilter.jsx uses) if one
  // already exists elsewhere in the app, for consistency.
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => current - i);
  }, []);

  // ── data states ────────────────────────────────────────────────
  const [overview,       setOverview]       = useState(null);
  const [sourceBdown,    setSourceBdown]    = useState([]);
  const [memberGuest,    setMemberGuest]    = useState([]);
  const [villaRevenue,   setVillaRevenue]   = useState([]);
  const [amenityRevenue, setAmenityRevenue] = useState([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState([]);
  const [villaNet, setVillaNet] = useState(null);
  const [villaTotals, setVillaTotals] = useState(null);

  // ── loading / error per section ────────────────────────────────
  const [loadingMap, setLoadingMap] = useState({
    overview: true, category: true, source: true, memberGuest: true, villa: true, amenity: true,
  });
  const [errorMap, setErrorMap] = useState({});

  // ── drawer state ───────────────────────────────────────────────
  // `filters` lets a caller seed MULTIPLE filter dimensions at once
  // (e.g. a future CategoryCompBreakdown row representing category +
  // payment bucket together). `drillType`/`drillValue` stay supported
  // for every existing single-dimension call site (villa rows, source
  // rows, customer rows, amenity rows, category/section cards) - the
  // drawer merges both into the same accumulating filter set, and from
  // there the user can pivot ("Browse by…") into further dimensions
  // without losing what's already active.
  const [drawer, setDrawer] = useState({
    open:       false,
    drillType:  null,
    drillValue: null,
    filters:    null,
    midItems:   null,
  });

  const setLoad = (key, val) =>
    setLoadingMap((prev) => ({ ...prev, [key]: val }));
  const setErr  = (key, msg) =>
    setErrorMap((prev) => ({ ...prev, [key]: msg }));

  // ── fetch all sections in parallel, re-run whenever period changes ──
  useEffect(() => {
    const periodParams = periodToParams(period);

    setLoadingMap({
      overview: true, category: true, source: true, memberGuest: true, villa: true, amenity: true,
    });
    setErrorMap({});

    // Overview
    financeApi.overview(periodParams)
      .then(setOverview)
      .catch((e) => setErr("overview", e.message))
      .finally(() => setLoad("overview", false));

    financeApi.categoryCompBreakdown(periodParams)
      .then(setCategoryBreakdown)
      .catch((e) => setErr("category", e.message))
      .finally(() => setLoad("category", false));

    // Source breakdown
    financeApi.sourceBreakdown(periodParams)
      .then(setSourceBdown)
      .catch((e) => setErr("source", e.message))
      .finally(() => setLoad("source", false));

    // Member vs Guest
    financeApi.memberVsGuest(periodParams)
      .then(setMemberGuest)
      .catch((e) => setErr("memberGuest", e.message))
      .finally(() => setLoad("memberGuest", false));

    // Villa revenue
    financeApi.villaRevenue(periodParams)
      .then(setVillaRevenue)
      .catch((e) => setErr("villa", e.message))
      .finally(() => setLoad("villa", false));

    // Amenity revenue
    financeApi.amenityRevenue(periodParams)
      .then(setAmenityRevenue)
      .catch((e) => setErr("amenity", e.message))
      .finally(() => setLoad("amenity", false));

    // Villa net revenue (for CategoryCompBreakdown card)
    // period.year can be the string "All" — only send ?years= for a real 4-digit year
    const yearParam = /^\d{4}$/.test(String(period.year))
      ? { years: String(period.year) }
      : {};
    financeApi.villaStatementTotals(yearParam)
      .then((r) => setVillaTotals(Array.isArray(r) ? (r[0] ?? null) : r))
      .catch((e) => console.error("villaStatementTotals failed:", e));
  }, [period]);

  // ── drawer helpers ─────────────────────────────────────────────
  const openDrawer = useCallback(({ drillType, drillValue, filters = null, midItems = null }) => {
    setDrawer({ open: true, drillType, drillValue, filters, midItems });
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawer((d) => ({ ...d, open: false }));
  }, []);

  // Build mid-items for "Total Revenue" card drill-down - shows the
  // Villas / Amenities / Services split (matching the new overview
  // cards) before going to underlying folio records. Pulled straight
  // from the already-fetched `overview` state - no extra request.
  function buildTotalMidItems() {
    if (!overview) return [];
    return [
      {
        label:      "Villas Revenue",
        sub:        "Gross villa rental revenue before taxes and other deductions - click to drill into individual charges",
        revenue:    overview.villasRevenue,
        drillType:  "category",
        drillValue: "Villa",
      },
      {
        label:      "Amenities Revenue",
        sub:        "Spa, golf, F&B, tennis, boutique, and other amenity charges - click to see folio lines",
        revenue:    overview.amenitiesRevenue,
        drillType:  "section",
        drillValue: "Amenities",
      },
      {
        label:      "Services Revenue",
        sub:        "Commissary, adjustments, and other service lines - click to inspect underlying records",
        revenue:    overview.servicesRevenue,
        drillType:  "section",
        drillValue: "Services",
      },
    ];
  }

  // NOTE: a per-villa "mid items" list used to be hand-built here from
  // the (unfiltered) Villa Revenue table data, but it's gone now -
  // RevenueBreakdownDrawer's "Browse by Villa" pivot replaces it with
  // something strictly better: it calls /finance/drilldown-breakdown
  // scoped to whatever filters are already active (payment, category,
  // source, etc.), so the per-villa numbers shown are always correct
  // for the current drill-down, not just the lifetime villa totals.
  // That pivot is available automatically on every flat-record screen
  // the drawer shows, from every entry point in this file - clicking
  // "Villas Revenue" goes straight to flat category=Villa records, and
  // from there "Browse by → Villa" gives the same filtered per-villa
  // breakdown buildVillaMidItems() used to hand-roll.

  // Handle overview card click
  function handleOverviewCardClick({ drillType, drillValue }) {
    if (drillType === "total") {
      openDrawer({ drillType: "total", drillValue, midItems: buildTotalMidItems() });
    } else {
      openDrawer({ drillType, drillValue });
    }
  }

  // Handle villa table row click - go straight to folio records
  // Villa Revenue table rows always drill into rate_details
  // reservations now (see /finance/villa-reservations), NOT the
  // general folios drilldown every other card/table uses.
  // VillaRevenueTable sends drillType: "villa" (a generic legacy
  // value) - remapped to "villaReservations" here so
  // RevenueBreakdownDrawer's init effect takes the rate_details
  // branch instead of falling through to loadRecords()/folios.
  function handleVillaRowClick({ drillValue }) {
    openDrawer({ drillType: "villaReservations", drillValue });
  }

  return (
    <div className="dashboard-section">
      {/* ── Period filter - applies to every section + the drawer ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 4 }}>
        <FinancePeriodFilter value={period} onChange={setPeriod} years={years} />
      </div>

      {/* ── 1. Overview ───────────────────────────────────────── */}
      <SectionLabel>Revenue Overview</SectionLabel>

      {loadingMap.overview ? (
        <Skeleton height={100} />
      ) : errorMap.overview ? (
        <InlineError message={errorMap.overview} />
      ) : (
        <FinanceOverview data={overview} onCardClick={handleOverviewCardClick} />
      )}

      {/* ── 1.5 Category Comp Breakdown ──────────────────────────────── */}
      <SectionLabel>Collected .vs. Forgone Revenue</SectionLabel>
      
      {loadingMap.category ? (
        <Skeleton height={360} />
      ) : errorMap.category ? (
        <InlineError message={errorMap.category} />
      ) : (
        <CategoryCompBreakdown
          data={categoryBreakdown}
          villaNetRevenue={villaTotals?.netRevenue}
          villaGrossRevenue={villaTotals?.statementGrossRevenue}
          onRowClick={({ drillType, drillValue, filters }) =>
            openDrawer({ drillType, drillValue, filters })
          }
        />
      )}

      {/* ── 2. Revenue by Source ──────────────────────────────── */}
      <SectionLabel>Revenue by Source</SectionLabel>

      {loadingMap.source ? (
        <Skeleton height={320} />
      ) : errorMap.source ? (
        <InlineError message={errorMap.source} />
      ) : (
        <SourceRevenueTable
          data={sourceBdown}
          onRowClick={({ drillType, drillValue }) =>
            openDrawer({ drillType, drillValue })
          }
        />
      )}

      {/* ── 3. Member vs Guest ────────────────────────────────── */}
      <SectionLabel>Member vs Guest Revenue</SectionLabel>

      {loadingMap.memberGuest ? (
        <Skeleton height={200} />
      ) : errorMap.memberGuest ? (
        <InlineError message={errorMap.memberGuest} />
      ) : (
        <MemberGuestRevenueTable
          data={memberGuest}
          onRowClick={({ drillType, drillValue }) =>
            openDrawer({ drillType, drillValue })
          }
        />
      )}

      {/* ── 4. Villa Revenue ──────────────────────────────────── */}
      <SectionLabel>Villa Revenue</SectionLabel>

      {loadingMap.villa ? (
        <Skeleton height={360} />
      ) : errorMap.villa ? (
        <InlineError message={errorMap.villa} />
      ) : (
        <VillaRevenueTable
          data={villaRevenue}
          onRowClick={handleVillaRowClick}
        />
      )}

      {/* ── 5. Amenity Revenue ───────────────────────────────── */}
      <SectionLabel>Amenity Revenue</SectionLabel>

      {loadingMap.amenity ? (
        <Skeleton height={360} />
      ) : errorMap.amenity ? (
        <InlineError message={errorMap.amenity} />
      ) : (
        <AmenityRevenueTable
          data={amenityRevenue}
          onRowClick={({ drillType, drillValue }) =>
            openDrawer({ drillType, drillValue })
          }
        />
      )}

      {/* ── Drill-Down Drawer ─────────────────────────────────── */}
      <RevenueBreakdownDrawer
        open={drawer.open}
        onClose={closeDrawer}
        drillType={drawer.drillType}
        drillValue={drawer.drillValue}
        filters={drawer.filters}
        midItems={drawer.midItems}
        period={period}
      />

      {/* Pulse animation for skeletons */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}