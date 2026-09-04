// frontend/src/pages/dashboard.jsx

// Palette: Palladian #EEE9DF · Oatmeal #C9C1B1 · DeepBlue #2C3B4D
//          Flame #FFB162 · Truffle #A35139 · Abyssal #1B2632

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Component, useEffect, useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  UserCheck,
  BedDouble,
  Sparkles,
  Activity,
  DollarSign,
  CalendarClock,
  Baby,
  MapPin,
  TrendingUp,
  Clock,
  LayoutDashboard,
  Users,
  BookOpen,
  Download,
  Search,
  Bell,
  ArrowUpRight,
  ChevronDown,
  MoreHorizontal,
  Settings,
  PartyPopper,
  Home,
} from "lucide-react";
import VillaFeesTab from "./VillaFeesTab";
import { analyticsApi } from "../api/analytics";
import { overviewApi } from "../api/overviewApi";
import {
  FinancePeriodFilter,
  periodToParams,
  DEFAULT_PERIOD,
} from "./finance/FinanceShared";
import { COLORS, TOOLTIP_STYLE } from "./styles/Dashboardstyles";
import {
  StatCard,
  ChartCard,
  SectionLabel,
  PieLegendCard,
  RoomHighlightCard,
} from "./styles/Dashboardcomponents";
import SeasonFilterBar from "./mltab/SeasonFilterBar";
import AmenitySeasonPanel from "./mltab/AmenitySeasonPanel";
import SegmentationPanel from "./mltab/Segmentationpanel";
import MarketingTargetingPanel from "./mltab/MarketingTargetingPanel";
import "./styles/styles.css";
import VisitsRoomsTab from "./visits/VisitsRoomsTab";
import DemographicsTab from "./demographics/DemographicsTab";
import FinanceTab from "./finance/FinanceTab";
import Leadtimetab from "./Leadtimetab";

//Overview tab components
import OverviewTab from "./OverviewTab";

// New vs Repeat Guest Revenue — its own tab (not nested inside Marketing)
import GuestRevenueTab from "./GuestRevenueTab";

/* ─── Sidebar nav config ─────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "demographics", label: "Demographics", Icon: Users },
  { id: "visits", label: "Visits & Rooms", Icon: BedDouble },
  { id: "finance", label: "Finance", Icon: DollarSign },
  { id: "reports", label: "Reports", Icon: BookOpen },
  { id: "market", label: "Marketing Targeting", Icon: PartyPopper },
  { id: "ml", label: "ML Insights", Icon: Sparkles },
  { id: "villa_fees", label: "Annual Fees", Icon: Home },
];

const SUB = {
  overview: "High-level member, booking and spend summary",
  demographics: "Age, gender, location and household data",
  visits: "Room performance, booking trends and live roster",
  finance: "Outstanding balances and spend breakdown",
  reports: "View and filter raw report data",
  market: "Analysis and Insights on market Targeting",
  ml: "Segmentation, amenity insights and campaign recommendations — all monetary figures in $USD",
  villa_fees:
    "Maintenance, Capital Expenditure and membership dues billed per villa",
};

/* ─── Recharts shared props ──────────────────────────────────── */
const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = TOOLTIP_STYLE;

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [activeSeasonGroup, setActiveSeasonGroup] = useState(null);

  // Overview tab date-range filter (added 2026-06-26) — reuses the exact
  // same shape/component the Finance tab already uses (FinanceShared.jsx),
  // so the two tabs' period pickers stay visually and behaviorally
  // identical instead of drifting into two slightly different filters.
  const [overviewPeriod, setOverviewPeriod] = useState(DEFAULT_PERIOD);
  const [overviewYears, setOverviewYears] = useState([]);

  const [membersByCountry, setMembersByCountry] = useState([]);
  const [membersByState, setMembersByState] = useState([]);
  const [membersByGender, setMembersByGender] = useState([]);
  const [membersByAgeGroup, setMembersByAgeGroup] = useState([]);
  const [membersByType, setMembersByType] = useState([]);
  const [accountsByType, setAccountsByType] = useState([]);
  const [membersByStatus, setMembersByStatus] = useState([]);
  const [membersByMaritalStatus, setMembersByMaritalStatus] = useState([]);
  const [newMembersPerYear, setNewMembersPerYear] = useState([]);
  const [averageTenure, setAverageTenure] = useState(null);
  const [bookingsByRoomType, setBookingsByRoomType] = useState([]);
  const [bookingsByMonth, setBookingsByMonth] = useState([]);
  const [averageLengthOfStay, setAverageLengthOfStay] = useState(null);
  const [mostUsedRoomTypes, setMostUsedRoomTypes] = useState([]);
  const [leastUsedRoomTypes, setLeastUsedRoomTypes] = useState([]);

  const [spendByMonth, setSpendByMonth] = useState([]);
  const [totalRecentActivitySpend, setTotalRecentActivitySpend] =
    useState(null);
  const [topSpendDescriptions, setTopSpendDescriptions] = useState([]);
  const [totalDependents, setTotalDependents] = useState(null);
  const [dependentsPerHousehold, setDependentsPerHousehold] = useState([]);
  const [dependentsByAgeGroup, setDependentsByAgeGroup] = useState([]);
  const [dependentsPerMember, setDependentsPerMember] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableRows, setTableRows] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [rowLimit, setRowLimit] = useState("25");
  const [selectedColumn, setSelectedColumn] = useState("");
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);

  const [selectedVillaName, setSelectedVillaName] = useState(null);
  const [villaStats, setVillaStats] = useState([]);
  const [visitsTabSummary, setVisitsTabSummary] = useState(null);
  const [bedroomBookings, setBedroomBookings] = useState([]);
  const [villaRevenue, setVillaRevenue] = useState([]);
  const [transactionFinanceSummary, setTransactionFinanceSummary] = useState(
    [],
  );
  const [transactionMemberVsGuestRevenue, setTransactionMemberVsGuestRevenue] =
    useState([]);
  const [
    transactionMemberVsGuestRevenueByCategory,
    setTransactionMemberVsGuestRevenueByCategory,
  ] = useState([]);
  const [villaAmenityRevenue, setVillaAmenityRevenue] = useState([]);
  const [monthlyRevenueByCategory, setMonthlyRevenueByCategory] = useState([]);
  const [reversalsSummary, setReversalsSummary] = useState(null);
  const [villaRackRateFree, setVillaRackRateFree] = useState([]);
  const [cashAdvanceSummary, setCashAdvanceSummary] = useState(null);
  const [anomaliesSummary, setAnomaliesSummary] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [tipsSummary, setTipsSummary] = useState(null);
  const [internalTransfersSummary, setInternalTransfersSummary] =
    useState(null);
  const [paymentsSummary, setPaymentsSummary] = useState(null);
  const [paymentCorrectionsSummary, setPaymentCorrectionsSummary] =
    useState(null);
  // Added 2026-07-17 — three datasets OverviewTab already consumed via
  // props that were never wired up here (their backend endpoints didn't
  // exist until the same day; see overview_analytics.py):
  //   memberDuesSummary — member dues added to Combined total
  //   emailOnFile       — "With email on file" on Members at a glance
  //   rackRateSummary   — Rack ADR / Effective discount on Bookings at a glance
  const [memberDuesSummary, setMemberDuesSummary] = useState(null);
  const [emailOnFile, setEmailOnFile] = useState(null);
  const [rackRateSummary, setRackRateSummary] = useState(null);

  useEffect(() => {
    // ── Non-Overview data: members by country/state/gender/age, dependents
    // breakdowns, spend history, etc. Unchanged — still served by the
    // original /analytics/dashboard-summary endpoint. ──────────────────
    analyticsApi
      .dashboardSummary()
      .then((data) => {
        setMembersByCountry(data.membersByCountry ?? []);
        setMembersByState(data.membersByState ?? []);
        setMembersByGender(data.membersByGender ?? []);
        setMembersByAgeGroup(data.membersByAgeGroup ?? []);
        setMembersByType(data.membersByType ?? []);
        setAccountsByType(data.accountsByType ?? []);
        setMembersByStatus(data.membersByStatus ?? []);
        setMembersByMaritalStatus(data.membersByMaritalStatus ?? []);
        setNewMembersPerYear(data.newMembersPerYear ?? []);
        setAverageTenure(data.averageTenure ?? null);
        setBookingsByRoomType(data.bookingsByRoomType ?? []);
        setBookingsByMonth(data.bookingsByMonth ?? []);
        setAverageLengthOfStay(data.averageLengthOfStay ?? null);
        setMostUsedRoomTypes(data.mostUsedRoomTypes ?? []);
        setLeastUsedRoomTypes(data.leastUsedRoomTypes ?? []);

        setSpendByMonth(data.spendByMonth ?? []);
        setTotalRecentActivitySpend(data.totalRecentActivitySpend ?? null);
        setTopSpendDescriptions(data.topSpendDescriptions ?? []);
        setDependentsByAgeGroup(data.dependentsByAgeGroup ?? []);
        setDependentsPerMember(data.dependentsPerMember ?? []);
        setDependentsPerHousehold(data.dependentsPerHousehold ?? []);
        // NOTE: totalDependents is intentionally NOT set here anymore — it
        // comes from /overview/summary below, so there's only one writer.
        // totalAmountDue / amountDueByPeriod used to follow the same
        // pattern but were removed entirely on 2026-08-13 — OverviewTab.jsx
        // stopped reading them back on 2026-07-01 (statements no longer
        // generate from folios), and overview_analytics.py's /summary
        // bundle was still computing both on every page load for no
        // reader. See overview_analytics.py's /overview/summary docstring.
      })
      .catch(console.error);

    analyticsApi.getTables().then(setAvailableTables).catch(console.error);
  }, []);

  // ── Overview tab: single bundled fetch from the standalone overview
  // module (postgres/overview_analytics.py, mounted at /overview).
  // Replaces the old separate calls to:
  //   /analytics/villa-stats
  //   /analytics/visits-tab-summary
  //   /analytics/bookings-by-bedroom
  //   /analytics/monthly-revenue
  //   /finance/member-vs-guest
  //   /finance/villa-revenue
  // Also includes the newer TRANSACTION-LEVEL (per net line-item, villa +
  // amenity combined) Paid/Free data used by the Finance at a glance and
  // Member vs guest revenue cards — see overview_transaction_lines in
  // overview_views.sql for what powers these. Includes
  // overviewReversalsSummary, overviewCashAdvanceSummary,
  // overviewAnomaliesSummary/overviewAnomalies, and overviewVillaRackRateFree.
  //
  // Split into its OWN effect (added 2026-06-26), separate from the
  // dashboard-summary/demographics-summary/tables fetch above, and keyed
  // on [overviewPeriod] — so changing the date filter only re-fetches the
  // Overview tab's own data, not the whole dashboard's unrelated sections.
  //
  // Debounced + cancellable: rapid filter changes (e.g. clicking through
  // several years while testing) used to fire a new request immediately
  // on every change, with nothing cancelling the previous one — several
  // requests could end up in flight at once, each holding a DB
  // connection, which exhausted the connection pool and made the page
  // look like it wasn't responding to the filter at all, when really most
  // of the requests were just failing/timing out. The 400ms debounce
  // waits for the user to stop changing the filter before fetching at
  // all; the AbortController cancels whatever request is still in flight
  // if the filter changes again before it resolves, instead of letting it
  // pile up or (worse) land late and overwrite fresher data with stale
  // data.
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      overviewApi
        .summary(periodToParams(overviewPeriod), { signal: controller.signal })
        .then((data) => {
          setVillaStats(data.overviewVillaStats ?? []);
          setVisitsTabSummary(data.overviewVisitsSummary ?? null);
          setBedroomBookings(data.overviewBookingsByBedroom ?? []);
          setTransactionFinanceSummary(
            data.overviewTransactionFinanceSummary ?? [],
          );
          setTransactionMemberVsGuestRevenue(
            data.overviewTransactionMemberVsGuestRevenue ?? [],
          );
          setTransactionMemberVsGuestRevenueByCategory(
            data.overviewTransactionMemberVsGuestRevenueByCategory ?? [],
          );
          setVillaAmenityRevenue(data.overviewVillaAmenityRevenue ?? []);
          setMonthlyRevenueByCategory(
            data.overviewMonthlyRevenueByCategory ?? [],
          );
          setTotalDependents(data.overviewDependents ?? null);
          setReversalsSummary(data.overviewReversalsSummary ?? null);
          setVillaRackRateFree(data.overviewVillaRackRateFree ?? []);
          setCashAdvanceSummary(data.overviewCashAdvanceSummary ?? null);
          setAnomaliesSummary(data.overviewAnomaliesSummary ?? null);
          setAnomalies(data.overviewAnomalies ?? []);
          setTipsSummary(data.overviewTipsSummary ?? null);
          setInternalTransfersSummary(
            data.overviewInternalTransfersSummary ?? null,
          );
          setPaymentsSummary(data.overviewPaymentsSummary ?? null);
          setPaymentCorrectionsSummary(
            data.overviewPaymentCorrectionsSummary ?? null,
          );
          setMemberDuesSummary(data.overviewMemberDuesSummary ?? null);
          setEmailOnFile(data.overviewEmailOnFile ?? null);
          setRackRateSummary(data.overviewRackRateSummary ?? null);
          // villaRevenue (rental-revenue-per-villa) is no longer fetched —
          // "Top villas by revenue" now uses villaAmenityRevenue instead.
          setVillaRevenue([]);
        })
        .catch((err) => {
          // AbortError means a NEWER request superseded this one — that's
          // expected and not a real error, so don't log it.
          if (err?.name === "AbortError") return;
          console.error(err);
        });
    }, 400);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [overviewPeriod]);

  // Real distinct years with booking activity, for the year dropdown in
  // the Overview tab's period filter — fetched once, not period-dependent
  // (the years list itself doesn't change based on which period is
  // currently selected).
  useEffect(() => {
    overviewApi.availableYears().then(setOverviewYears).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedTable) {
      setTableRows([]);
      setSelectedColumn("");
      setVisibleColumns([]);
      setSortColumn("");
      setPage(1);
      return;
    }
    analyticsApi
      .getTableData(selectedTable)
      .then((data) => {
        const rows = Array.isArray(data) ? data : [];
        const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
        setTableRows(rows);
        setSelectedColumn(cols[0] ?? "");
        setVisibleColumns(cols);
        setSortColumn("");
        setSortDirection("asc");
        setPage(1);
        setTableSearch("");
      })
      .catch(console.error);
  }, [selectedTable]);

  useEffect(() => {
    setPage(1);
  }, [
    tableSearch,
    selectedColumn,
    selectedTable,
    rowLimit,
    sortColumn,
    sortDirection,
  ]);

  const totalMembers = membersByType.reduce((a, b) => a + (b.total || 0), 0);

  const getCV = (v) => {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (!isNaN(n) && String(v).trim() !== "") return n;
    const d = Date.parse(v);
    if (!isNaN(d)) return d;
    return String(v).toLowerCase();
  };
  const cmp = (a, b) => {
    const av = getCV(a),
      bv = getCV(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  };
  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };
  const toggleCol = (col) =>
    setVisibleColumns((c) =>
      c.includes(col) ? c.filter((x) => x !== col) : [...c, col],
    );

  const reportColumns = tableRows.length > 0 ? Object.keys(tableRows[0]) : [];
  const filteredRows = tableRows.filter((row) => {
    const s = tableSearch.trim().toLowerCase();
    if (!s || !selectedColumn) return true;
    return String(row[selectedColumn] ?? "")
      .toLowerCase()
      .includes(s);
  });
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortColumn) return 0;
    const r = cmp(a[sortColumn], b[sortColumn]);
    return sortDirection === "asc" ? r : -r;
  });
  const totalPages =
    rowLimit === "all"
      ? 1
      : Math.max(1, Math.ceil(sortedRows.length / Number(rowLimit)));
  const paginatedRows =
    rowLimit === "all"
      ? sortedRows
      : sortedRows.slice(
          (page - 1) * Number(rowLimit),
          page * Number(rowLimit),
        );

  const getExportRows = () =>
    sortedRows.map((row) => {
      const o = {};
      visibleColumns.forEach((c) => {
        o[c] = row[c] ?? "";
      });
      return o;
    });
  const fileName = (ext) =>
    `${selectedTable || "report"}_${new Date().toISOString().split("T")[0]}.${ext}`;

  const exportToCSV = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const blob = new Blob([XLSX.utils.sheet_to_csv(ws)], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName("csv");
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportToExcel = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      selectedTable || "Report",
    );
    XLSX.writeFile(wb, fileName("xlsx"));
  };
  const exportToPDF = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4",
    });
    doc.setFontSize(14);
    doc.text(`${selectedTable || "Report"} Export`, 40, 35);
    autoTable(doc, {
      head: [visibleColumns],
      body: rows.map((r) => visibleColumns.map((c) => String(r[c] ?? ""))),
      startY: 50,
      styles: { fontSize: 7, cellPadding: 4 },
      headStyles: { fillColor: [44, 59, 77] },
    });
    doc.save(fileName("pdf"));
  };

  return (
    <div className="dashboard-shell">
      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside className="dashboard-sidebar hidden lg:flex w-64 shrink-0 flex-col gap-1 border-r px-5 py-7">
        {/* Nav */}
        <div className="mb-8 flex items-center gap-3"></div>

        <nav className="flex flex-col gap-1.5">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`dashboard-nav-button flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors text-left w-full ${active ? "is-active" : ""}`}
              >
                <Icon className="dashboard-nav-icon" />
                <span className="dashboard-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="dashboard-main flex-1 px-6 py-7 lg:px-10">
        {/* Topbar */}
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-copy">
            <h1 className="dashboard-page-title">
              {activeTab === "overview"
                ? "Overview"
                : TABS.find((t) => t.id === activeTab)?.label}
            </h1>
            <p className="dashboard-page-subtitle">{SUB[activeTab]}</p>
          </div>
          <div className="dashboard-topbar-actions">
            <button className="dashboard-icon-button">
              <Bell style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </header>
        {/* ════ OVERVIEW ════ */}
        {activeTab === "overview" && (
          <OverviewTab
            onNavigateToTab={setActiveTab}
            period={overviewPeriod}
            onPeriodChange={setOverviewPeriod}
            years={overviewYears}
            membersByType={membersByType}
            membersByStatus={membersByStatus}
            membersByCountry={membersByCountry}
            membersByState={membersByState}
            membersByMaritalStatus={membersByMaritalStatus}
            averageTenure={averageTenure}
            averageLengthOfStay={averageLengthOfStay}
            bookingsByMonth={bookingsByMonth}
            bookingsByRoomType={bookingsByRoomType}
            mostUsedRoomTypes={mostUsedRoomTypes}
            totalDependents={totalDependents}
            dependentsPerMember={dependentsPerMember}
            totalRecentActivitySpend={totalRecentActivitySpend}
            topSpendDescriptions={topSpendDescriptions}
            directoryMembers={[]}
            villaStats={villaStats}
            visitsTabSummary={visitsTabSummary}
            bedroomBookings={bedroomBookings}
            villaRevenue={villaRevenue}
            transactionFinanceSummary={transactionFinanceSummary}
            transactionMemberVsGuestRevenue={transactionMemberVsGuestRevenue}
            transactionMemberVsGuestRevenueByCategory={
              transactionMemberVsGuestRevenueByCategory
            }
            villaAmenityRevenue={villaAmenityRevenue}
            monthlyRevenueByCategory={monthlyRevenueByCategory}
            reversalsSummary={reversalsSummary}
            villaRackRateFree={villaRackRateFree}
            cashAdvanceSummary={cashAdvanceSummary}
            anomaliesSummary={anomaliesSummary}
            anomalies={anomalies}
            tipsSummary={tipsSummary}
            internalTransfersSummary={internalTransfersSummary}
            paymentsSummary={paymentsSummary}
            paymentCorrectionsSummary={paymentCorrectionsSummary}
            memberDuesSummary={memberDuesSummary}
            emailOnFile={emailOnFile}
            rackRateSummary={rackRateSummary}
            newMembersPerYear={newMembersPerYear}
          />
        )}
        {/* ════ DEMOGRAPHICS ════ */}
        {activeTab === "demographics" && (
          <DemographicsTab
            membersByCountry={membersByCountry}
            membersByState={membersByState}
            membersByGender={membersByGender}
            membersByAgeGroup={membersByAgeGroup}
            accountsByType={accountsByType}
            membersByStatus={membersByStatus}
            membersByMaritalStatus={membersByMaritalStatus}
            newMembersPerYear={newMembersPerYear}
            totalDependents={totalDependents}
            dependentsByAgeGroup={dependentsByAgeGroup}
            dependentsPerHousehold={dependentsPerHousehold}
            dependentsPerMember={dependentsPerMember}
          />
        )}
        {activeTab === "visits" && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "40px" }}
          >
            <VisitsRoomsTab
              selectedVillaName={selectedVillaName}
              onVillaSelect={setSelectedVillaName}
              onGoToML={() => setActiveTab("ml")}
            />

            <ErrorBoundary title="Lead Time">
              <Leadtimetab />
            </ErrorBoundary>
          </div>
        )}

        {/* ════ FINANCE ════ */}
        {activeTab === "finance" && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "40px" }}
          >
            <FinanceTab />

            <ErrorBoundary title="Guest Revenue">
              <GuestRevenueTab />
            </ErrorBoundary>
          </div>
        )}
        {/* ════ VILLA FEES (TEST) ════ */}
        {activeTab === "villa_fees" && <VillaFeesTab />}

        {/* ════ REPORTS ════ */}
        {activeTab === "reports" && (
          <div className="dashboard-section dashboard-section-sm">
            <div className="dashboard-card dashboard-card-roomy">
              {/* Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                  marginBottom: 20,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <select
                    value={selectedTable}
                    onChange={(e) => setSelectedTable(e.target.value)}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid #DDD6CA",
                      background: "#F7F3EC",
                      color: "#1B2632",
                      fontSize: 13,
                      minWidth: 240,
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Select Report</option>
                    {availableTables.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rowLimit}
                    onChange={(e) => setRowLimit(e.target.value)}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid #DDD6CA",
                      background: "#F7F3EC",
                      color: "#1B2632",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <option value="all">All Rows</option>
                    <option value="25">25 Rows</option>
                    <option value="100">100 Rows</option>
                  </select>
                  {selectedTable && (
                    <span style={{ fontSize: 12, color: "#9A8E84" }}>
                      {paginatedRows.length} of {sortedRows.length} rows
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Column picker */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setColumnPickerOpen((v) => !v)}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        border: "1px solid #DDD6CA",
                        background: "#F7F3EC",
                        cursor: "pointer",
                        fontSize: 14,
                        display: "grid",
                        placeItems: "center",
                      }}
                      title="Search column"
                    >
                      🔎
                    </button>
                    {columnPickerOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: 44,
                          right: 0,
                          background: "#FDFAF6",
                          border: "1px solid #DDD6CA",
                          borderRadius: 12,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                          zIndex: 1000,
                          maxHeight: 240,
                          minWidth: 220,
                          overflowY: "auto",
                        }}
                      >
                        <div
                          style={{
                            padding: "8px 14px",
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#9A8E84",
                            borderBottom: "1px solid #EAE3DA",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                          }}
                        >
                          Search in column
                        </div>
                        {reportColumns.map((col) => (
                          <div
                            key={col}
                            onClick={() => {
                              setSelectedColumn(col);
                              setColumnPickerOpen(false);
                            }}
                            style={{
                              padding: "8px 14px",
                              cursor: "pointer",
                              fontSize: 12,
                              color:
                                selectedColumn === col ? "#1B2632" : "#5A4E45",
                              background:
                                selectedColumn === col
                                  ? "#F2EDE4"
                                  : "transparent",
                              fontWeight: selectedColumn === col ? 700 : 400,
                            }}
                          >
                            {selectedColumn === col ? "✓ " : ""}
                            {col}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Column visibility */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setColumnVisibilityOpen((v) => !v)}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        border: "1px solid #DDD6CA",
                        background: "#F7F3EC",
                        cursor: "pointer",
                        fontSize: 14,
                        display: "grid",
                        placeItems: "center",
                      }}
                      title="Column visibility"
                    >
                      ☷
                    </button>
                    {columnVisibilityOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: 44,
                          right: 0,
                          background: "#FDFAF6",
                          border: "1px solid #DDD6CA",
                          borderRadius: 12,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                          zIndex: 1000,
                          maxHeight: 280,
                          minWidth: 240,
                          overflowY: "auto",
                          padding: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            marginBottom: 8,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setVisibleColumns(reportColumns)}
                            style={{
                              fontSize: 11,
                              border: "1px solid #DDD6CA",
                              borderRadius: 6,
                              background: "#F2EDE4",
                              padding: "5px 8px",
                              cursor: "pointer",
                            }}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setVisibleColumns([])}
                            style={{
                              fontSize: 11,
                              border: "1px solid #DDD6CA",
                              borderRadius: 6,
                              background: "#F7F3EC",
                              padding: "5px 8px",
                              cursor: "pointer",
                            }}
                          >
                            Clear
                          </button>
                        </div>
                        {reportColumns.map((col) => (
                          <label
                            key={col}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "5px 4px",
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(col)}
                              onChange={() => toggleCol(col)}
                            />
                            {col}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Export */}
                  {selectedTable && sortedRows.length > 0 && (
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setExportMenu((o) => !o)}
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          border: "1px solid #DDD6CA",
                          background: "#F7F3EC",
                          cursor: "pointer",
                          display: "grid",
                          placeItems: "center",
                        }}
                        title="Export"
                      >
                        <Download style={{ width: 16, height: 16 }} />
                      </button>
                      {exportMenu && (
                        <div
                          style={{
                            position: "absolute",
                            top: 44,
                            left: 0,
                            background: "#FDFAF6",
                            border: "1px solid #DDD6CA",
                            borderRadius: 12,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                            zIndex: 1000,
                            minWidth: 140,
                          }}
                        >
                          {[
                            ["CSV", exportToCSV],
                            ["Excel", exportToExcel],
                            ["PDF", exportToPDF],
                          ].map(([label, fn]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                fn();
                                setExportMenu(false);
                              }}
                              style={{
                                width: "100%",
                                padding: "9px 16px",
                                background: "transparent",
                                textAlign: "left",
                                cursor: "pointer",
                                fontSize: 13,
                                color: "#1B2632",
                                border: "none",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Search */}
                  <div style={{ position: "relative" }}>
                    <Search
                      style={{
                        position: "absolute",
                        left: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 14,
                        height: 14,
                        color: "#9A8E84",
                      }}
                    />
                    <input
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder={
                        selectedColumn
                          ? `Search ${selectedColumn}…`
                          : "Choose a column…"
                      }
                      disabled={!selectedTable || !selectedColumn}
                      style={{
                        height: 38,
                        width: 240,
                        paddingLeft: 32,
                        paddingRight: 12,
                        border: "1px solid #DDD6CA",
                        borderRadius: 10,
                        fontSize: 13,
                        background: "#F7F3EC",
                        color: "#1B2632",
                        opacity: !selectedTable || !selectedColumn ? 0.5 : 1,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              {selectedTable && (
                <>
                  {totalPages > 1 && rowLimit !== "all" && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        marginBottom: 14,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#9A8E84" }}>
                        Page {page} of {totalPages}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          disabled={page === 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid #DDD6CA",
                            background: "#F7F3EC",
                            cursor: page === 1 ? "not-allowed" : "pointer",
                            opacity: page === 1 ? 0.45 : 1,
                            fontSize: 13,
                          }}
                        >
                          Prev
                        </button>
                        {Array.from(
                          { length: Math.min(totalPages, 5) },
                          (_, i) => {
                            const s = Math.min(
                              Math.max(1, page - 2),
                              Math.max(1, totalPages - 4),
                            );
                            return s + i;
                          },
                        ).map((n) => (
                          <button
                            type="button"
                            key={n}
                            onClick={() => setPage(n)}
                            style={{
                              padding: "6px 11px",
                              borderRadius: 8,
                              border: "1px solid #DDD6CA",
                              background: page === n ? "#2C3B4D" : "#F7F3EC",
                              color: page === n ? "#FFB162" : "#1B2632",
                              cursor: "pointer",
                              fontWeight: page === n ? 700 : 400,
                              fontSize: 13,
                            }}
                          >
                            {n}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={page === totalPages}
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid #DDD6CA",
                            background: "#F7F3EC",
                            cursor:
                              page === totalPages ? "not-allowed" : "pointer",
                            opacity: page === totalPages ? 0.45 : 1,
                            fontSize: 13,
                          }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      overflowX: "auto",
                      border: "1px solid #DDD6CA",
                      borderRadius: 14,
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                        minWidth: 1200,
                      }}
                    >
                      <thead
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "#F2EDE4",
                          zIndex: 1,
                        }}
                      >
                        <tr>
                          {visibleColumns.map((col) => (
                            <th
                              key={col}
                              style={{
                                textAlign: "left",
                                padding: "10px 14px",
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                color: "#7A6E63",
                                borderBottom: "2px solid #DDD6CA",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => handleSort(col)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  cursor: "pointer",
                                  color: "inherit",
                                  font: "inherit",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                {col}{" "}
                                <span
                                  style={{
                                    fontSize: 10,
                                    color:
                                      sortColumn === col
                                        ? "#FFB162"
                                        : "#B0A496",
                                  }}
                                >
                                  {sortColumn === col
                                    ? sortDirection === "asc"
                                      ? "▲"
                                      : "▼"
                                    : "↕"}
                                </span>
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={Math.max(visibleColumns.length, 1)}
                              style={{
                                textAlign: "center",
                                padding: 40,
                                color: "#B0A496",
                              }}
                            >
                              No rows found
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map((row, idx) => (
                            <tr
                              key={idx}
                              style={{
                                background:
                                  idx % 2 === 0 ? "transparent" : "#F2EDE4",
                                borderBottom: "1px solid #EAE3DA",
                              }}
                            >
                              {visibleColumns.map((col) => (
                                <td
                                  key={col}
                                  style={{
                                    padding: "10px 14px",
                                    color: "#2C3B4D",
                                  }}
                                >
                                  {String(row[col] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {/* ════ MARKET TARGETING ════ */}
        {activeTab === "market" && (
          <div className="dashboard-section">
            <SectionLabel>Customer Segments</SectionLabel>
            <ErrorBoundary title="Member Segments">
              <SegmentationPanel />
            </ErrorBoundary>

            <SectionLabel>Marketing Targeting</SectionLabel>
            <ErrorBoundary title="Marketing Targeting ">
              <MarketingTargetingPanel />
            </ErrorBoundary>
          </div>
        )}
        {/* ════ ML INSIGHTS ════ */}
        {activeTab === "ml" && (
          <div className="dashboard-section">
            <SectionLabel>Season Filters</SectionLabel>
            <ErrorBoundary title="Season Filter Bar">
              <SeasonFilterBar onSeasonGroupChange={setActiveSeasonGroup} />
            </ErrorBoundary>
            <SectionLabel>Amenity Season Analysis</SectionLabel>
            <ErrorBoundary title="Amenity Season Insights">
              <AmenitySeasonPanel seasonGroupId={activeSeasonGroup?.id} />
            </ErrorBoundary>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Reusable Card wrapper ──────────────────────────────────── */
function Card({ title, sub, children }) {
  return (
    <div className="dashboard-card">
      <div className="dashboard-eyebrow">{sub}</div>
      <h2 className="dashboard-card-title">{title}</h2>
      {children}
    </div>
  );
}

/* ─── Error boundary ─────────────────────────────────────────── */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`${this.props.title} crashed:`, error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dashboard-error">
        <strong>{this.props.title} could not render.</strong>
        <div className="dashboard-error-message">
          {this.state.error?.message ||
            "Check the browser console for details."}
        </div>
      </div>
    );
  }
}
