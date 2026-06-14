// frontend/src/pages/dashboard.jsx

// Palette: Palladian #EEE9DF · Oatmeal #C9C1B1 · DeepBlue #2C3B4D
//          Flame #FFB162 · Truffle #A35139 · Abyssal #1B2632

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Component, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
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
} from "lucide-react";
import { analyticsApi } from "../api/analytics";
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
import "./styles/styles.css";
import VisitsRoomsTab from "./visits/VisitsRoomsTab";

/* ─── Sidebar nav config ─────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "demographics", label: "Demographics", Icon: Users },
  { id: "visits", label: "Visits & Rooms", Icon: BedDouble },
  { id: "finance", label: "Finance", Icon: DollarSign },
  { id: "reports", label: "Reports", Icon: BookOpen },
  { id: "ml", label: "ML Insights", Icon: Sparkles },
];

const SUB = {
  overview: "High-level member, booking and spend summary",
  demographics: "Age, gender, location and household data",
  visits: "Room performance, booking trends and live roster",
  finance: "Outstanding balances and spend breakdown",
  reports: "View and filter raw report data",
  ml: "Segmentation, amenity insights and campaign recommendations — all monetary figures in $USD",
};

/* ─── Recharts shared props ──────────────────────────────────── */
const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = TOOLTIP_STYLE;

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [activeSeasonGroup, setActiveSeasonGroup] = useState(null);

  const [membersByCountry, setMembersByCountry] = useState([]);
  const [membersByState, setMembersByState] = useState([]);
  const [membersByGender, setMembersByGender] = useState([]);
  const [membersByAgeGroup, setMembersByAgeGroup] = useState([]);
  const [membersByType, setMembersByType] = useState([]);
  const [accountsByType, setAccountsByType] = useState([]);
  const [accountTypeView, setAccountTypeView] = useState("Member");
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
  const [totalAmountDue, setTotalAmountDue] = useState(null);
  const [amountDueByPeriod, setAmountDueByPeriod] = useState([]);
  const [totalDependents, setTotalDependents] = useState(null);
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

  const [villaStats, setVillaStats] = useState([]);
  const [villaMonthly, setVillaMonthly] = useState([]);
  const [bookingsByBedroom, setBookingsByBedroom] = useState([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState([]);

  const [visitsTabSummary, setVisitsTabSummary] = useState(null);
  const [selectedVillaName, setSelectedVillaName] = useState(null);

  useEffect(() => {
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
        setTotalAmountDue(data.totalAmountDue ?? null);
        setAmountDueByPeriod(data.amountDueByPeriod ?? []);
        setTotalDependents(data.totalDependents ?? null);
        setDependentsByAgeGroup(data.dependentsByAgeGroup ?? []);
        setDependentsPerMember(data.dependentsPerMember ?? []);
      })

      .catch(console.error);

    analyticsApi.getTables().then(setAvailableTables).catch(console.error);

    analyticsApi.villaStats().then(setVillaStats).catch(console.error);
    analyticsApi
      .bookingsByBedroom()
      .then(setBookingsByBedroom)
      .catch(console.error);
    analyticsApi.monthlyRevenue().then(setMonthlyRevenue).catch(console.error);

    analyticsApi
      .visitsTabSummary()
      .then(setVisitsTabSummary)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedVillaName) return;

    analyticsApi
      .villaMonthly(selectedVillaName)
      .then(setVillaMonthly)
      .catch(console.error);
  }, [selectedVillaName]);

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

  const visibleAccountTypes = accountsByType.filter(
    (item) => item.account_category?.trim() === accountTypeView,
  );

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
          <div className="dashboard-section dashboard-section-lg">
            {/* KPI band */}
            <section
              className="dashboard-kpi-band"
              style={{ padding: "24px 28px" }}
            >
              {[
                {
                  label: "Total Members",
                  value: totalMembers ? totalMembers.toLocaleString() : "—",
                  delta: "All membership types",
                },

                {
                  label: "Avg. Tenure",
                  value:
                    averageTenure?.average_tenure_years != null
                      ? `${Number(averageTenure.average_tenure_years).toFixed(1)} yrs`
                      : "—",
                  delta: "Across all members",
                },
                {
                  label: "Outstanding Balance",
                  value:
                    totalAmountDue?.total_amount_due != null
                      ? `$${Number(totalAmountDue.total_amount_due).toLocaleString()}`
                      : "—",
                  delta: "Total dues owed",
                },
              ].map((k, i) => (
                <div
                  key={k.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "0 24px",
                    borderLeft: i > 0 ? "1px solid #DDD6CA" : "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "#9A8E84",
                    }}
                  >
                    {k.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 32,
                      lineHeight: 1.1,
                      color: "#1B2632",
                    }}
                  >
                    {k.value}
                  </span>
                  <span style={{ fontSize: 11, color: "#A35139" }}>
                    {k.delta}
                  </span>
                </div>
              ))}
            </section>

            {/* Main grid */}
            <div className="dashboard-grid dashboard-grid-main">
              {/* Member acquisition card */}
              <div className="dashboard-card">
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#9A8E84",
                    marginBottom: 4,
                  }}
                >
                  Member Acquisition
                </div>
                <h2 className="dashboard-card-title dashboard-card-title-lg">
                  New members per year
                </h2>
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <LineChart
                      data={newMembersPerYear}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="year" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#FFB162"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "#FFB162" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Satisfaction ring — deep navy card */}
              <div
                style={{
                  borderRadius: 24,
                  background: "#013A59",
                  padding: 24,
                  color: "#EEE9DF",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "#3783ac95",
                        marginBottom: 4,
                      }}
                    >
                      Member Type Mix
                    </div>
                    <div
                      style={{
                        fontFamily: "'Cormorant Garamond', serif",
                        fontSize: 20,
                        color: "#EEE9DF",
                      }}
                    >
                      Breakdown
                    </div>
                  </div>
                  <MoreHorizontal
                    style={{
                      width: 16,
                      height: 16,
                      color: "rgba(238,233,223,0.45)",
                    }}
                  />
                </div>
                <div style={{ flex: 1, marginTop: 12 }}>
                  {membersByType.slice(0, 5).map((t, i) => {
                    const max = Math.max(
                      ...membersByType.map((x) => x.total || 0),
                      1,
                    );
                    const pct = Math.round(((t.total || 0) / max) * 100);
                    return (
                      <div key={i} style={{ marginBottom: 12 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 11,
                            marginBottom: 4,
                            color: "rgba(238,233,223,0.75)",
                          }}
                        >
                          <span>{t.member_type ?? t.name ?? "—"}</span>
                          <span style={{ color: "#FFB162", fontWeight: 600 }}>
                            {(t.total || 0).toLocaleString()}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 4,
                            background: "rgba(238,233,223,0.1)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: COLORS[i % COLORS.length],
                              borderRadius: 2,
                              transition: "width 0.4s",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  {[
                    { l: "Countries", v: membersByCountry.length || "—" },
                    { l: "Room Types", v: bookingsByRoomType.length || "—" },
                  ].map((m) => (
                    <div
                      key={m.l}
                      style={{
                        borderRadius: 12,
                        border: "1px solid #022132",
                        background: "#023652",
                        padding: "10px 12px",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'Cormorant Garamond', serif",
                          fontSize: 24,
                          color: "#EEE9DF",
                        }}
                      >
                        {m.v}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "rgba(238,233,223,0.5)",
                          marginTop: 2,
                        }}
                      >
                        {m.l}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bookings + Spend row */}
            <div className="dashboard-grid dashboard-grid-main">
              <div className="dashboard-card">
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#9A8E84",
                    marginBottom: 4,
                  }}
                >
                  Bookings &amp; Spend
                </div>
                <h2 className="dashboard-card-title dashboard-card-title-lg">
                  Bookings by month
                </h2>
                <div className="dashboard-chart dashboard-chart-180">
                  <ResponsiveContainer>
                    <LineChart
                      data={bookingsByMonth}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="month" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#2C3B4D"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="dashboard-card">
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#9A8E84",
                    marginBottom: 4,
                  }}
                >
                  Revenue
                </div>
                <h2 className="dashboard-card-title dashboard-card-title-lg">
                  Spend by month
                </h2>
                <div className="dashboard-chart dashboard-chart-180">
                  <ResponsiveContainer>
                    <BarChart
                      data={spendByMonth}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="month" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#FFB162"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════ DEMOGRAPHICS ════ */}
        {activeTab === "demographics" && (
          <div className="dashboard-section">
            <Card
              title="Account Types"
              sub="Distribution of member and guest account types"
            >
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  padding: 4,
                  marginBottom: 14,
                  background: "#EEE9DF",
                  borderRadius: 10,
                  width: "fit-content",
                }}
              >
                <button
                  type="button"
                  onClick={() => setAccountTypeView("Member")}
                  style={{
                    border: "none",
                    borderRadius: 7,
                    padding: "7px 14px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      accountTypeView === "Member" ? "#2C3B4D" : "transparent",
                    color: accountTypeView === "Member" ? "#FFFFFF" : "#2C3B4D",
                    transition: "all 0.2s ease",
                  }}
                >
                  Members
                </button>
                <button
                  type="button"
                  onClick={() => setAccountTypeView("Guest")}
                  style={{
                    border: "none",
                    borderRadius: 7,
                    padding: "7px 14px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      accountTypeView === "Guest" ? "#2C3B4D" : "transparent",
                    color: accountTypeView === "Guest" ? "#FFFFFF" : "#2C3B4D",
                    transition: "all 0.2s ease",
                  }}
                >
                  Guests
                </button>
              </div>
              <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={visibleAccountTypes}
                    layout="vertical"
                    margin={{
                      top: 2,
                      right: 20,
                      bottom: 2,
                    }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID}
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      stroke={AX}
                      fontSize={11}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="member_type"
                      stroke={AX}
                      fontSize={10}
                      width={210}
                      interval={0}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={TIP}
                      formatter={(value) => [
                        Number(value).toLocaleString(),
                        accountTypeView === "Member" ? "Members" : "Guests",
                      ]}
                    />
                    <Bar
                      dataKey="total"
                      name="Accounts"
                      fill={
                        accountTypeView === "Member" ? "#FFB162" : "#5B8FA8"
                      }
                      radius={[0, 6, 6, 0]}
                      maxBarSize={20}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <SectionLabel>Age / Gender / Status</SectionLabel>
            <div className="dashboard-grid dashboard-grid-3">
              <Card title="Age Groups" sub="Accounts by age segment">
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart data={membersByAgeGroup}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="age_group" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#FFB162"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <PieLegendCard
                title="Gender Split"
                description="Male vs Female"
                data={membersByGender}
                dataKey="total"
                nameKey="gender"
              />
              <PieLegendCard
                title="Marital Status"
                description="Household composition"
                data={membersByMaritalStatus}
                dataKey="total"
                nameKey="marital_status"
              />
            </div>
            <SectionLabel>Member Status &amp; Tenure</SectionLabel>
            <div className="dashboard-grid dashboard-grid-side">
              <Card
                title="Member & Guest Status"
                sub="Status comparison between members and guests"
              >
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart
                      data={membersByStatus}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                      barGap={4}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="status" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={TIP} />
                      <Legend
                        wrapperStyle={{
                          fontSize: 11,
                          paddingTop: 6,
                        }}
                      />
                      <Bar
                        dataKey="members"
                        name="Members"
                        fill="#FFB162"
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey="guests"
                        name="Guests"
                        fill="#5B8FA8"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card
                title="New Members & Guests per Year"
                sub="Member and guest acquisition over time"
              >
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <LineChart
                      data={newMembersPerYear}
                      margin={{ top: 5, right: 12, bottom: 5, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="year"
                        stroke={AX}
                        fontSize={11}
                        allowDecimals={false}
                      />
                      <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={TIP} />
                      <Legend
                        wrapperStyle={{
                          fontSize: 11,
                          paddingTop: 6,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="members"
                        name="Members"
                        stroke="#FFB162"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="guests"
                        name="Guests"
                        stroke="#5B8FA8"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
            <SectionLabel>Location</SectionLabel>
            <div className="dashboard-grid dashboard-grid-side">
              <Card title="Accounts by Country" sub="Geographic distribution">
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart data={membersByCountry}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="country" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#C4A24D"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Accounts by State" sub="US state breakdown">
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart
                      data={membersByState}
                      layout="vertical"
                      margin={{ left: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                        horizontal={false}
                      />
                      <XAxis type="number" stroke={AX} fontSize={11} />
                      <YAxis
                        type="category"
                        dataKey="state"
                        stroke={AX}
                        fontSize={11}
                        width={40}
                      />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#2C3B4D"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
            <SectionLabel>Dependents</SectionLabel>
            <div className="dashboard-grid dashboard-grid-side">
              <Card
                title="Dependents by Age Group"
                sub="Linked to member folios"
              >
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart data={dependentsByAgeGroup}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="age_group" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#A35139"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card
                title="Top Accounts by Dependents"
                sub="Accounts with the most linked dependents"
              >
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart
                      data={dependentsPerMember}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="member_number"
                        stroke={AX}
                        fontSize={11}
                        angle={-15}
                        textAnchor="end"
                        height={55}
                      />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total_dependents"
                        fill="#5B8FA8"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "visits" && (
          <VisitsRoomsTab
            visitsTabSummary={visitsTabSummary}
            villaStats={villaStats}
            villaMonthly={villaMonthly}
            bookingsByBedroom={bookingsByBedroom}
            monthlyRevenue={monthlyRevenue}
            selectedVillaName={selectedVillaName}
            onVillaSelect={setSelectedVillaName}
            onGoToML={() => setActiveTab("ml")}
          />
        )}

        {/* ════ FINANCE ════ */}
        {activeTab === "finance" && (
          <div className="dashboard-section">
            <section className="dashboard-kpi-band dashboard-kpi-band-2">
              {[
                {
                  label: "Outstanding Balance",
                  value:
                    totalAmountDue?.total_amount_due != null
                      ? `$${Number(totalAmountDue.total_amount_due).toLocaleString()}`
                      : "—",
                  delta: "Total dues owed",
                },
                {
                  label: "Recent Activity Spend",
                  value:
                    totalRecentActivitySpend?.total != null
                      ? `$${Number(totalRecentActivitySpend.total).toLocaleString()}`
                      : "—",
                  delta: "Latest activity period",
                },
              ].map((k, i) => (
                <div
                  key={k.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "0 20px",
                    borderLeft: i > 0 ? "1px solid #DDD6CA" : "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "#9A8E84",
                    }}
                  >
                    {k.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 32,
                      lineHeight: 1.1,
                      color: "#1B2632",
                    }}
                  >
                    {k.value}
                  </span>
                  <span style={{ fontSize: 11, color: "#A35139" }}>
                    {k.delta}
                  </span>
                </div>
              ))}
            </section>

            <div className="dashboard-grid dashboard-grid-main dashboard-grid-gap-sm">
              <Card
                title="Amount Due by Period"
                sub="Outstanding balances over time"
              >
                <div className="dashboard-chart dashboard-chart-200">
                  <ResponsiveContainer>
                    <BarChart
                      data={amountDueByPeriod}
                      margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="statement_period"
                        stroke={AX}
                        fontSize={11}
                      />
                      <YAxis stroke={AX} fontSize={11} />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="total"
                        fill="#A35139"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Top spend list */}
              <div className="dashboard-card">
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#9A8E84",
                    marginBottom: 4,
                  }}
                >
                  Top Spend
                </div>
                <h2
                  style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontSize: 20,
                    color: "#1B2632",
                    margin: "0 0 16px",
                  }}
                >
                  Activity categories
                </h2>
                <div style={{ overflowY: "auto", maxHeight: 220 }}>
                  {topSpendDescriptions.length === 0 ? (
                    <p style={{ color: "#B0A496", fontSize: 13 }}>
                      No data available
                    </p>
                  ) : (
                    topSpendDescriptions.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 0",
                          borderBottom:
                            i < topSpendDescriptions.length - 1
                              ? "1px solid #EAE3DA"
                              : "none",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              background: COLORS[i % COLORS.length],
                              display: "grid",
                              placeItems: "center",
                              fontSize: 10,
                              color: "#fff",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {i + 1}
                          </span>
                          <span style={{ fontSize: 12, color: "#1B2632" }}>
                            {item.description ?? item.name ?? "—"}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#FFB162",
                          }}
                        >
                          ${Number(item.total ?? 0).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <Card title="Spend by Month" sub="Revenue trend">
              <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer>
                  <BarChart
                    data={spendByMonth}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="month" stroke={AX} fontSize={11} />
                    <YAxis stroke={AX} fontSize={11} />
                    <Tooltip contentStyle={TIP} />
                    <Bar dataKey="total" fill="#FFB162" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

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

        {/* ════ ML INSIGHTS ════ */}
        {activeTab === "ml" && (
          <div className="dashboard-section">
            <SectionLabel>Customer Segments</SectionLabel>
            <ErrorBoundary title="Member Segments">
              <SegmentationPanel />
            </ErrorBoundary>
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
