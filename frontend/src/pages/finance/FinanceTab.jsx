// frontend/src/pages/finance/FinanceTab.jsx
// ─────────────────────────────────────────────────────────────────
// Drop-in Finance tab.  Import and register in Dashboard.jsx:
//
//   import FinanceTab from "./finance/FinanceTab";
//   { id: "finance", label: "Finance", Icon: DollarSign }   ← add to TABS
//   {activeTab === "finance" && <FinanceTab />}              ← add to render
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from "react";
import { financeApi } from "../../api/financeApi";
import FinanceOverview from "./FinanceOverview";
import SourceRevenueTable from "./SourceRevenueTable";
import { MemberGuestRevenueTable, VillaRevenueTable } from "./FinanceTables";
import AmenityRevenueTable from "./AmenityRevenueTable";
import RevenueBreakdownDrawer from "./RevenueBreakdownDrawer";

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
  // ── data states ────────────────────────────────────────────────
  const [overview,       setOverview]       = useState(null);
  const [sourceBdown,    setSourceBdown]    = useState([]);
  const [memberGuest,    setMemberGuest]    = useState([]);
  const [villaRevenue,   setVillaRevenue]   = useState([]);
  const [amenityRevenue, setAmenityRevenue] = useState([]);

  // ── loading / error per section ────────────────────────────────
  const [loadingMap, setLoadingMap] = useState({
    overview: true, source: true, memberGuest: true, villa: true, amenity: true,
  });
  const [errorMap, setErrorMap] = useState({});

  // ── drawer state ───────────────────────────────────────────────
  const [drawer, setDrawer] = useState({
    open:       false,
    drillType:  null,
    drillValue: null,
    midItems:   null,
  });

  const setLoad = (key, val) =>
    setLoadingMap((prev) => ({ ...prev, [key]: val }));
  const setErr  = (key, msg) =>
    setErrorMap((prev) => ({ ...prev, [key]: msg }));

  // ── fetch all sections in parallel ─────────────────────────────
  useEffect(() => {
    // Overview
    financeApi.overview()
      .then(setOverview)
      .catch((e) => setErr("overview", e.message))
      .finally(() => setLoad("overview", false));

    // Source breakdown
    financeApi.sourceBreakdown()
      .then(setSourceBdown)
      .catch((e) => setErr("source", e.message))
      .finally(() => setLoad("source", false));

    // Member vs Guest
    financeApi.memberVsGuest()
      .then(setMemberGuest)
      .catch((e) => setErr("memberGuest", e.message))
      .finally(() => setLoad("memberGuest", false));

    // Villa revenue
    financeApi.villaRevenue()
      .then(setVillaRevenue)
      .catch((e) => setErr("villa", e.message))
      .finally(() => setLoad("villa", false));

    // Amenity revenue
    financeApi.amenityRevenue()
      .then(setAmenityRevenue)
      .catch((e) => setErr("amenity", e.message))
      .finally(() => setLoad("amenity", false));
  }, []);

  // ── drawer helpers ─────────────────────────────────────────────
  const openDrawer = useCallback(({ drillType, drillValue, midItems = null }) => {
    setDrawer({ open: true, drillType, drillValue, midItems });
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawer((d) => ({ ...d, open: false }));
  }, []);

  // Build mid-items for "Total Revenue" card drill-down
  // (shows villa / source / member-guest breakdown before going to folios)
  function buildTotalMidItems() {
    return [
      ...villaRevenue.slice(0, 10).map((v) => ({
        label:      v.villaName,
        sub:        `${(v.totalBookings ?? 0).toLocaleString()} bookings`,
        revenue:    v.revenue,
        count:      v.totalBookings,
        drillType:  "villa",
        drillValue: v.villaName,
      })),
    ];
  }

  // Build villa mid-items from source breakdown
  function buildVillaMidItems() {
    return villaRevenue.map((v) => ({
      label:      v.villaName,
      sub:        `${(v.totalBookings ?? 0).toLocaleString()} bookings · ${(v.roomNights ?? 0).toLocaleString()} nights`,
      revenue:    v.revenue,
      count:      v.totalBookings,
      drillType:  "villa",
      drillValue: v.villaName,
    }));
  }

  // Handle overview card click
  function handleOverviewCardClick({ drillType, drillValue }) {
    if (drillType === "total") {
      openDrawer({ drillType: "total", drillValue, midItems: buildTotalMidItems() });
    } else {
      openDrawer({ drillType, drillValue, midItems: null });
    }
  }

  // Handle villa table row click — go straight to folio records
  function handleVillaRowClick({ drillType, drillValue }) {
    openDrawer({ drillType, drillValue });
  }

  return (
    <div className="dashboard-section">
      {/* ── 1. Overview ───────────────────────────────────────── */}
      <SectionLabel>Revenue Overview</SectionLabel>

      {loadingMap.overview ? (
        <Skeleton height={100} />
      ) : errorMap.overview ? (
        <InlineError message={errorMap.overview} />
      ) : (
        <FinanceOverview data={overview} onCardClick={handleOverviewCardClick} />
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
        midItems={drawer.midItems}
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
