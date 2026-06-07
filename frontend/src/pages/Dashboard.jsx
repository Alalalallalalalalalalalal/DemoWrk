// frontend/src/pages/dashboard.jsx

import { Component, useEffect, useState } from "react";
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
} from "lucide-react";

import { analyticsApi } from "../api/analytics";
import {
  styles as baseStyles,
  TOOLTIP_STYLE,
  COLORS,
  S,
} from "./Dashboardstyles";
import {
  StatCard,
  ChartCard,
  SectionLabel,
  PieLegendCard,
  RoomHighlightCard,
} from "./Dashboardcomponents";
import SeasonFilterBar from "./SeasonFilterBar";
import AmenitySeasonPanel from "./AmenitySeasonPanel";
import SegmentationPanel from "./SegmentationPanel";

/* ─── Sidebar config ─────────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "demographics", label: "Demographics", Icon: Users },
  { id: "visits", label: "Visits & Rooms", Icon: BedDouble },
  { id: "finance", label: "Finance", Icon: DollarSign },
  { id: "reports", label: "Reports", Icon: BookOpen },
  { id: "ml", label: "ML Insights", Icon: Sparkles },
];

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // ---------- all your existing state ----------
  const [membersByCountry, setMembersByCountry] = useState([]);
  const [membersByState, setMembersByState] = useState([]);
  const [membersByGender, setMembersByGender] = useState([]);
  const [membersByAgeGroup, setMembersByAgeGroup] = useState([]);
  const [membersByType, setMembersByType] = useState([]);
  const [membersByStatus, setMembersByStatus] = useState([]);
  const [membersByMaritalStatus, setMembersByMaritalStatus] = useState([]);
  const [newMembersPerYear, setNewMembersPerYear] = useState([]);
  const [averageTenure, setAverageTenure] = useState(null);
  const [bookingsByRoomType, setBookingsByRoomType] = useState([]);
  const [bookingsByMonth, setBookingsByMonth] = useState([]);
  const [averageLengthOfStay, setAverageLengthOfStay] = useState(null);
  const [mostUsedRoomTypes, setMostUsedRoomTypes] = useState([]);
  const [leastUsedRoomTypes, setLeastUsedRoomTypes] = useState([]);
  const [liveInHouseCount, setLiveInHouseCount] = useState(null);
  const [liveInHouseRoster, setLiveInHouseRoster] = useState([]);
  const [spendByMonth, setSpendByMonth] = useState([]);
  const [totalRecentActivitySpend, setTotalRecentActivitySpend] =
    useState(null);
  const [topSpendDescriptions, setTopSpendDescriptions] = useState([]);
  const [totalAmountDue, setTotalAmountDue] = useState(null);
  const [amountDueByPeriod, setAmountDueByPeriod] = useState([]);
  const [totalDependents, setTotalDependents] = useState(null);
  const [dependentsByAgeGroup, setDependentsByAgeGroup] = useState([]);
  const [dependentsPerMember, setDependentsPerMember] = useState([]);
  const [directoryMembers, setDirectoryMembers] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableRows, setTableRows] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [rowLimit, setRowLimit] = useState("25"); // all | 25 | 100
  const [selectedColumn, setSelectedColumn] = useState("");
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState("asc"); // asc | desc
  const [page, setPage] = useState(1);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);

  useEffect(() => {
    analyticsApi
      .dashboardSummary()
      .then((data) => {
        setMembersByCountry(data.membersByCountry ?? []);
        setMembersByState(data.membersByState ?? []);
        setMembersByGender(data.membersByGender ?? []);
        setMembersByAgeGroup(data.membersByAgeGroup ?? []);
        setMembersByType(data.membersByType ?? []);
        setMembersByStatus(data.membersByStatus ?? []);
        setMembersByMaritalStatus(data.membersByMaritalStatus ?? []);
        setNewMembersPerYear(data.newMembersPerYear ?? []);
        setAverageTenure(data.averageTenure ?? null);
        setBookingsByRoomType(data.bookingsByRoomType ?? []);
        setBookingsByMonth(data.bookingsByMonth ?? []);
        setAverageLengthOfStay(data.averageLengthOfStay ?? null);
        setMostUsedRoomTypes(data.mostUsedRoomTypes ?? []);
        setLeastUsedRoomTypes(data.leastUsedRoomTypes ?? []);
        setLiveInHouseCount(data.liveInHouseCount ?? null);
        setLiveInHouseRoster(data.liveInHouseRoster ?? []);
        setSpendByMonth(data.spendByMonth ?? []);
        setTotalRecentActivitySpend(data.totalRecentActivitySpend ?? null);
        setTopSpendDescriptions(data.topSpendDescriptions ?? []);
        setTotalAmountDue(data.totalAmountDue ?? null);
        setAmountDueByPeriod(data.amountDueByPeriod ?? []);
        setTotalDependents(data.totalDependents ?? null);
        setDependentsByAgeGroup(data.dependentsByAgeGroup ?? []);
        setDependentsPerMember(data.dependentsPerMember ?? []);
        setDirectoryMembers(data.directoryMembers ?? []);
      })
      .catch(console.error);

    analyticsApi.getTables().then(setAvailableTables).catch(console.error);
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
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        setTableRows(rows);
        setSelectedColumn(columns[0] ?? "");
        setVisibleColumns(columns);
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

  // ---------- derived values (identical to original) ----------
  const totalMembers = membersByType.reduce((a, b) => a + (b.total || 0), 0);

  const activeTabInfo = TABS.find((t) => t.id === activeTab);

  /* ── use the original styles for inner content ── */
  const styles = baseStyles;

  const getComparableValue = (value) => {
    if (value == null || value === "") return "";

    const numericValue = Number(value);
    if (!Number.isNaN(numericValue) && String(value).trim() !== "") {
      return numericValue;
    }

    const dateValue = Date.parse(value);
    if (!Number.isNaN(dateValue)) {
      return dateValue;
    }

    return String(value).toLowerCase();
  };

  const compareValues = (a, b) => {
    const aValue = getComparableValue(a);
    const bValue = getComparableValue(b);

    if (aValue < bValue) return -1;
    if (aValue > bValue) return 1;
    return 0;
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const toggleVisibleColumn = (column) => {
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((col) => col !== column)
        : [...current, column],
    );
  };

  const reportColumns = tableRows.length > 0 ? Object.keys(tableRows[0]) : [];

  const filteredRows = tableRows.filter((row) => {
    const search = tableSearch.trim().toLowerCase();

    if (!search) return true;
    if (!selectedColumn) return true;

    return String(row[selectedColumn] ?? "")
      .toLowerCase()
      .includes(search);
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortColumn) return 0;

    const result = compareValues(a[sortColumn], b[sortColumn]);

    return sortDirection === "asc" ? result : -result;
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

  return (
    <div style={S.shell}>
      {/* ── Vertical Sidebar ── */}
      <aside style={S.sidebar}>
        <nav>
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <div
                key={id}
                style={S.navItem(active)}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={16} style={S.navIcon(active)} />
                <span style={S.navLabel(active)}>{label}</span>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main style={S.content}>
        <p style={S.pageTitle}>{activeTabInfo?.label}</p>
        <p style={S.pageSub}>
          {activeTab === "overview" &&
            "High-level member, booking and spend summary"}
          {activeTab === "demographics" &&
            "Age, gender, location and household data"}
          {activeTab === "visits" &&
            "Room performance, booking trends and live roster"}
          {activeTab === "finance" &&
            "Outstanding balances and spend breakdown"}
          {activeTab === "reports" && "View reports and filtering"}
          {activeTab === "ml" &&
            "Segmentation, amenity insights and campaign recommendations,  all monetary figures are in $USD"}
        </p>

        {/* ════════ OVERVIEW ════════ */}
        {activeTab === "overview" && (
          <div style={styles.tabContent}>
            <div style={styles.statsGrid}>
              <StatCard
                icon={UserCheck}
                label="Total Members"
                value={totalMembers ? totalMembers.toLocaleString() : "—"}
                hint="All membership types"
              />
              <StatCard
                icon={Activity}
                label="Currently In-House"
                value={liveInHouseCount?.total_in_house ?? 0}
                hint="Live roster"
              />
              <StatCard
                icon={CalendarClock}
                label="Avg. Tenure"
                value={
                  averageTenure?.average_tenure_years != null
                    ? `${Number(averageTenure.average_tenure_years).toFixed(1)} yrs`
                    : "—"
                }
                hint="Across all members"
              />
              <StatCard
                icon={DollarSign}
                label="Outstanding Balance"
                value={
                  totalAmountDue?.total_amount_due != null
                    ? `$${Number(totalAmountDue.total_amount_due).toLocaleString()}`
                    : "—"
                }
                hint="Total dues owed"
              />
              <StatCard
                icon={TrendingUp}
                label="Recent Activity Spend"
                value={
                  totalRecentActivitySpend?.total != null
                    ? `$${Number(totalRecentActivitySpend.total).toLocaleString()}`
                    : "—"
                }
                hint="Latest activity period"
              />
              <StatCard
                icon={Baby}
                label="Total Dependents"
                value={totalDependents?.total_dependents ?? 0}
                hint="Linked to member folios"
              />
              <StatCard
                icon={MapPin}
                label="Countries"
                value={membersByCountry.length || "—"}
                hint="Member markets"
              />
              <StatCard
                icon={BedDouble}
                label="Room Types"
                value={bookingsByRoomType.length || "—"}
                hint="Tracked categories"
              />
            </div>

            <SectionLabel>Member Acquisition</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="New Members per Year"
                description="Growth trend from member-since date"
                span2
              >
                <ResponsiveContainer>
                  <LineChart
                    data={newMembersPerYear}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="year" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#C8976E"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#C8976E" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <PieLegendCard
                title="Member Type Mix"
                description="Category breakdown"
                data={membersByType}
                dataKey="total"
                nameKey="member_type"
              />
            </div>

            <SectionLabel>Bookings &amp; Spend</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Bookings by Month"
                description="Reservation trend over time"
                span2
              >
                <ResponsiveContainer>
                  <LineChart
                    data={bookingsByMonth}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="month" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#5B9EAD"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Spend by Month" description="Revenue trend">
                <ResponsiveContainer>
                  <BarChart
                    data={spendByMonth}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="month" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C8976E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        )}

        {/* ════════ DEMOGRAPHICS ════════ */}
        {activeTab === "demographics" && (
          <div style={styles.tabContent}>
            <SectionLabel>Age / Gender / Status</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Age Groups"
                description="Members by age segment"
              >
                <ResponsiveContainer>
                  <BarChart data={membersByAgeGroup}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="age_group" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C8976E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
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
            <div style={styles.chartsGrid}>
              <ChartCard title="Member Status" description="Active vs Inactive">
                <ResponsiveContainer>
                  <BarChart data={membersByStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="status" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#5B9EAD" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard
                title="New Members per Year"
                description="Acquisition over time"
                span2
              >
                <ResponsiveContainer>
                  <LineChart
                    data={newMembersPerYear}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="year" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#C8976E"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <SectionLabel>Location</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Members by Country"
                description="Geographic distribution"
              >
                <ResponsiveContainer>
                  <BarChart data={membersByCountry}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="country" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C4A24D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard
                title="Members by State"
                description="US state breakdown"
                span2
              >
                <ResponsiveContainer>
                  <BarChart
                    data={membersByState}
                    layout="vertical"
                    margin={{ left: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E8DDD0"
                      horizontal={false}
                    />
                    <XAxis type="number" stroke="#A08070" fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="state"
                      stroke="#A08070"
                      fontSize={11}
                      width={40}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#2D5F6E" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <SectionLabel>Dependents</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Dependents by Age Group"
                description="Linked to member folios"
              >
                <ResponsiveContainer>
                  <BarChart data={dependentsByAgeGroup}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="age_group" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#8B6B4A" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard
                title="Top Members by Dependents"
                description="Members with the most linked dependents"
                span2
              >
                <ResponsiveContainer>
                  <BarChart
                    data={dependentsPerMember}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis
                      dataKey="member_number"
                      stroke="#A08070"
                      fontSize={11}
                      angle={-15}
                      textAnchor="end"
                      height={55}
                    />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar
                      dataKey="total_dependents"
                      fill="#7ABCCC"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        )}

        {/* ════════ VISITS & ROOMS ════════ */}
        {activeTab === "visits" && (
          <div style={styles.tabContent}>
            <div style={styles.statsGrid}>
              <StatCard
                icon={Activity}
                label="Currently In-House"
                value={liveInHouseCount?.total_in_house ?? 0}
                hint="Live count"
              />
              <StatCard
                icon={Clock}
                label="Avg. Length of Stay"
                value={
                  averageLengthOfStay?.average_nights != null
                    ? `${Number(averageLengthOfStay.average_nights).toFixed(1)} nights`
                    : "—"
                }
              />
              <StatCard
                icon={BedDouble}
                label="Room Types"
                value={bookingsByRoomType.length || "—"}
                hint="Tracked categories"
              />
              <StatCard
                icon={TrendingUp}
                label="Total Bookings"
                value={
                  bookingsByMonth
                    .reduce((a, b) => a + (b.total || 0), 0)
                    .toLocaleString() || "—"
                }
                hint="All time"
              />
            </div>

            <SectionLabel>Room Performance</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Bookings by Room Type"
                description="Aggregated check-ins"
                span2
              >
                <ResponsiveContainer>
                  <BarChart data={bookingsByRoomType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis
                      dataKey="room_type"
                      stroke="#A08070"
                      fontSize={11}
                      angle={-15}
                      textAnchor="end"
                      height={55}
                    />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C8976E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <RoomHighlightCard
                most={mostUsedRoomTypes[0]}
                least={leastUsedRoomTypes[0]}
              />
            </div>

            <SectionLabel>Booking Trends</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Bookings by Month"
                description="Monthly reservation trend"
                span2
              >
                <ResponsiveContainer>
                  <LineChart
                    data={bookingsByMonth}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="month" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#5B9EAD"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <SectionLabel>Live In-House Roster</SectionLabel>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <p style={styles.cardTitle}>Currently Checked In</p>
                <p style={styles.cardDesc}>
                  {liveInHouseRoster.length} guests on property
                </p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {["Name", "Member #", "Room Type", "Check-in"].map(
                        (h) => (
                          <th key={h} style={styles.th}>
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {liveInHouseRoster.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{
                            ...styles.td,
                            textAlign: "center",
                            color: "#B09880",
                          }}
                        >
                          No data available
                        </td>
                      </tr>
                    ) : (
                      liveInHouseRoster.map((m, i) => (
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? "transparent" : "#FAF6F0",
                          }}
                        >
                          <td style={styles.td}>
                            <span style={{ fontWeight: 600, color: "#3D2B1F" }}>
                              {m.member_full_name ?? m.member_name ?? "—"}
                            </span>
                          </td>
                          <td style={styles.td}>{m.member_number ?? "—"}</td>
                          <td style={styles.td}>{m.room_type ?? "—"}</td>
                          <td style={styles.td}>
                            {m.check_in_date ?? m.checkin ?? "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════ FINANCE ════════ */}
        {activeTab === "finance" && (
          <div style={styles.tabContent}>
            <div style={styles.statsGrid}>
              <StatCard
                icon={DollarSign}
                label="Outstanding Balance"
                value={
                  totalAmountDue?.total_amount_due != null
                    ? `$${Number(totalAmountDue.total_amount_due).toLocaleString()}`
                    : "—"
                }
                hint="Total dues owed"
              />
              <StatCard
                icon={TrendingUp}
                label="Recent Activity Spend"
                value={
                  totalRecentActivitySpend?.total != null
                    ? `$${Number(totalRecentActivitySpend.total).toLocaleString()}`
                    : "—"
                }
                hint="Latest activity period"
              />
            </div>

            <SectionLabel>Amount Due</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Amount Due by Period"
                description="Outstanding balances over time"
                span2
              >
                <ResponsiveContainer>
                  <BarChart
                    data={amountDueByPeriod}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis
                      dataKey="statement_period"
                      stroke="#A08070"
                      fontSize={11}
                    />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C8976E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <SectionLabel>Spend Breakdown</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Spend by Month"
                description="Revenue trend"
                span2
              >
                <ResponsiveContainer>
                  <BarChart
                    data={spendByMonth}
                    margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="month" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C4A24D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <p style={styles.cardTitle}>Top Spend Descriptions</p>
                  <p style={styles.cardDesc}>Highest activity categories</p>
                </div>
                <div style={{ overflowY: "auto", maxHeight: 260 }}>
                  {topSpendDescriptions.length === 0 ? (
                    <p
                      style={{
                        color: "#B09880",
                        fontSize: 13,
                        fontFamily: "sans-serif",
                      }}
                    >
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
                              ? "1px solid #EDE5D8"
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
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              color: "#fff",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {i + 1}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "#3D2B1F",
                              fontFamily: "sans-serif",
                            }}
                          >
                            {item.description ?? item.name ?? "—"}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#C8976E",
                            fontFamily: "sans-serif",
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
          </div>
        )}

        {/* ════════ REPORTS ════════ */}
        {activeTab === "reports" && (
          <div style={styles.tabContent}>
            <div style={styles.card}>
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
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ddd",
                      minWidth: "250px",
                    }}
                  >
                    <option value="">Select Report</option>
                    {availableTables.map((table) => (
                      <option key={table} value={table}>
                        {table}
                      </option>
                    ))}
                  </select>

                  <select
                    value={rowLimit}
                    onChange={(e) => setRowLimit(e.target.value)}
                    style={{
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ddd",
                    }}
                  >
                    <option value="all">All Rows</option>
                    <option value="25">25 Rows</option>
                    <option value="100">100 Rows</option>
                  </select>

                  {selectedTable && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#A08070",
                        fontFamily: "sans-serif",
                      }}
                    >
                      Showing {paginatedRows.length} of {sortedRows.length} rows
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setColumnPickerOpen((v) => !v)}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                        fontSize: 15,
                      }}
                      title={`Search column: ${selectedColumn || "None"}`}
                    >
                      🔎
                    </button>

                    {columnPickerOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: 45,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #EDE5D8",
                          borderRadius: 8,
                          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                          zIndex: 1000,
                          maxHeight: 240,
                          minWidth: 220,
                          overflowY: "auto",
                          padding: "6px 0",
                        }}
                      >
                        <div
                          style={{
                            padding: "8px 12px",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#A08070",
                            fontFamily: "sans-serif",
                            borderBottom: "1px solid #F1E8DC",
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
                              padding: "8px 12px",
                              cursor: "pointer",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              color:
                                selectedColumn === col ? "#3D2B1F" : "#6D5848",
                              background:
                                selectedColumn === col ? "#FAF6F0" : "#fff",
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

                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setColumnVisibilityOpen((v) => !v)}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                        fontSize: 15,
                      }}
                      title="Choose visible columns"
                    >
                      ☷
                    </button>

                    {columnVisibilityOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: 45,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #EDE5D8",
                          borderRadius: 8,
                          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
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
                              border: "1px solid #EDE5D8",
                              borderRadius: 6,
                              background: "#FAF6F0",
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
                              border: "1px solid #EDE5D8",
                              borderRadius: 6,
                              background: "#fff",
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
                              padding: "6px 4px",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              color: "#5A3E2B",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(col)}
                              onChange={() => toggleVisibleColumn(col)}
                            />
                            {col}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <input
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder={
                      selectedColumn
                        ? `Search ${selectedColumn}…`
                        : "Choose a column to search…"
                    }
                    disabled={!selectedTable || !selectedColumn}
                    style={{
                      ...styles.searchInput,
                      minWidth: 260,
                      opacity: !selectedTable || !selectedColumn ? 0.55 : 1,
                    }}
                  />
                </div>
              </div>

              {selectedTable && (
                <>
                  {totalPages > 1 && rowLimit !== "all" && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        marginBottom: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: "#A08070",
                          fontFamily: "sans-serif",
                        }}
                      >
                        Page {page} of {totalPages}
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          disabled={page === 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          style={{
                            padding: "7px 12px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: page === 1 ? "#F3EDE6" : "#fff",
                            cursor: page === 1 ? "not-allowed" : "pointer",
                          }}
                        >
                          Prev
                        </button>

                        {Array.from(
                          { length: Math.min(totalPages, 5) },
                          (_, i) => {
                            const startPage = Math.min(
                              Math.max(1, page - 2),
                              Math.max(1, totalPages - 4),
                            );
                            return startPage + i;
                          },
                        ).map((pageNumber) => (
                          <button
                            type="button"
                            key={pageNumber}
                            onClick={() => setPage(pageNumber)}
                            style={{
                              padding: "7px 11px",
                              borderRadius: 8,
                              border: "1px solid #ddd",
                              background:
                                page === pageNumber ? "#C8976E" : "#fff",
                              color: page === pageNumber ? "#fff" : "#3D2B1F",
                              cursor: "pointer",
                              fontWeight: page === pageNumber ? 700 : 400,
                            }}
                          >
                            {pageNumber}
                          </button>
                        ))}

                        <button
                          type="button"
                          disabled={page === totalPages}
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                          style={{
                            padding: "7px 12px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background:
                              page === totalPages ? "#F3EDE6" : "#fff",
                            cursor:
                              page === totalPages ? "not-allowed" : "pointer",
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
                      border: "1px solid #EDE5D8",
                      borderRadius: 10,
                    }}
                  >
                    <table style={{ ...styles.table, minWidth: 1200 }}>
                      <thead
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "#FAF6F0",
                          zIndex: 1,
                        }}
                      >
                        <tr>
                          {visibleColumns.length > 0 &&
                            visibleColumns.map((column) => (
                              <th key={column} style={styles.th}>
                                <button
                                  type="button"
                                  onClick={() => handleSort(column)}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    padding: 0,
                                    cursor: "pointer",
                                    color: "inherit",
                                    font: "inherit",
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    textAlign: "left",
                                  }}
                                  title={`Sort by ${column}`}
                                >
                                  <span>{column}</span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color:
                                        sortColumn === column
                                          ? "#C8976E"
                                          : "#CBB8A5",
                                    }}
                                  >
                                    {sortColumn === column
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
                                ...styles.td,
                                textAlign: "center",
                                padding: 40,
                                color: "#B09880",
                              }}
                            >
                              No rows found
                            </td>
                          </tr>
                        ) : visibleColumns.length === 0 ? (
                          <tr>
                            <td
                              style={{
                                ...styles.td,
                                textAlign: "center",
                                padding: 40,
                                color: "#B09880",
                              }}
                            >
                              Choose at least one visible column.
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map((row, index) => (
                            <tr
                              key={index}
                              style={{
                                background:
                                  index % 2 === 0 ? "transparent" : "#FAF6F0",
                              }}
                            >
                              {visibleColumns.map((column) => (
                                <td key={column} style={styles.td}>
                                  {String(row[column] ?? "")}
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

        {/* ════════ ML INSIGHTS ════════ */}
        {activeTab === "ml" && (
          <div style={styles.tabContent}>
            <SectionLabel>Customer Segments</SectionLabel>
            <ErrorBoundary title="Member Segments">
              <SegmentationPanel />
            </ErrorBoundary>

            <SectionLabel>Season Filters</SectionLabel>
            <ErrorBoundary title="Season Filter Bar">
              <SeasonFilterBar />
            </ErrorBoundary>

            <SectionLabel>Amenity Season Analysis</SectionLabel>
            <ErrorBoundary title="Amenity Season Insights">
              <AmenitySeasonPanel />
            </ErrorBoundary>
          </div>
        )}
      </main>
    </div>
  );
}

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
      <div
        style={{
          padding: 20,
          border: "1px solid #EDE5D8",
          borderRadius: 12,
          background: "#FDFAF6",
          color: "#C45B5B",
          fontFamily: "sans-serif",
          fontSize: 13,
        }}
      >
        <strong>{this.props.title} could not render.</strong>
        <div style={{ marginTop: 6 }}>
          {this.state.error?.message ||
            "Check the browser console for details."}
        </div>
      </div>
    );
  }
}
