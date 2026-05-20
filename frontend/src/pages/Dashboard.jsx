import { useEffect, useState } from "react";
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
  CircleDot,
  DollarSign,
  CalendarClock,
  Baby,
  MapPin,
  TrendingUp,
  Clock,
} from "lucide-react";

import { analyticsApi } from "../api/analytics";
import { styles, TOOLTIP_STYLE, COLORS } from "./dashboardStyles";
import {
  StatCard,
  ChartCard,
  SectionLabel,
  PieLegendCard,
  RoomHighlightCard,
  DirectoryRow,
} from "./DashboardComponents";

const TAB_LABELS = {
  overview: "Overview",
  demographics: "Demographics",
  visits: "Visits & Rooms",
  finance: "Finance",
  directory: "Directory",
  ml: "ML Insights",
};

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // Members
  const [membersByCountry, setMembersByCountry] = useState([]);
  const [membersByState, setMembersByState] = useState([]);
  const [membersByGender, setMembersByGender] = useState([]);
  const [membersByAgeGroup, setMembersByAgeGroup] = useState([]);
  const [membersByType, setMembersByType] = useState([]);
  const [membersByStatus, setMembersByStatus] = useState([]);
  const [membersByMaritalStatus, setMembersByMaritalStatus] = useState([]);
  const [newMembersPerYear, setNewMembersPerYear] = useState([]);
  const [averageTenure, setAverageTenure] = useState(null);

  // Bookings / rooms
  const [bookingsByRoomType, setBookingsByRoomType] = useState([]);
  const [bookingsByMonth, setBookingsByMonth] = useState([]);
  const [averageLengthOfStay, setAverageLengthOfStay] = useState(null);
  const [mostUsedRoomTypes, setMostUsedRoomTypes] = useState([]);
  const [leastUsedRoomTypes, setLeastUsedRoomTypes] = useState([]);

  // Live
  const [liveInHouseCount, setLiveInHouseCount] = useState(null);
  const [liveInHouseRoster, setLiveInHouseRoster] = useState([]);

  // Spend
  const [spendByMonth, setSpendByMonth] = useState([]);
  const [totalRecentActivitySpend, setTotalRecentActivitySpend] =
    useState(null);
  const [topSpendDescriptions, setTopSpendDescriptions] = useState([]);

  // Finance
  const [totalAmountDue, setTotalAmountDue] = useState(null);
  const [amountDueByPeriod, setAmountDueByPeriod] = useState([]);

  // Dependents
  const [totalDependents, setTotalDependents] = useState(null);
  const [dependentsByAgeGroup, setDependentsByAgeGroup] = useState([]);
  const [dependentsPerMember, setDependentsPerMember] = useState([]);

  // Directory
  const [directoryMembers, setDirectoryMembers] = useState([]);
  const [directorySearch, setDirectorySearch] = useState("");

  useEffect(() => {
    analyticsApi
      .membersByCountry()
      .then(setMembersByCountry)
      .catch(() => {});
    analyticsApi
      .membersByState()
      .then(setMembersByState)
      .catch(() => {});
    analyticsApi
      .membersByGender()
      .then(setMembersByGender)
      .catch(() => {});
    analyticsApi
      .membersByAgeGroup()
      .then(setMembersByAgeGroup)
      .catch(() => {});
    analyticsApi
      .membersByType()
      .then(setMembersByType)
      .catch(() => {});
    analyticsApi
      .membersByStatus()
      .then(setMembersByStatus)
      .catch(() => {});
    analyticsApi
      .membersByMaritalStatus()
      .then(setMembersByMaritalStatus)
      .catch(() => {});
    analyticsApi
      .newMembersPerYear()
      .then(setNewMembersPerYear)
      .catch(() => {});
    analyticsApi
      .averageTenure()
      .then(setAverageTenure)
      .catch(() => {});

    analyticsApi
      .bookingsByRoomType()
      .then(setBookingsByRoomType)
      .catch(() => {});
    analyticsApi
      .bookingsByMonth()
      .then(setBookingsByMonth)
      .catch(() => {});
    analyticsApi
      .averageLengthOfStay()
      .then(setAverageLengthOfStay)
      .catch(() => {});
    analyticsApi
      .mostUsedRoomTypes()
      .then(setMostUsedRoomTypes)
      .catch(() => {});
    analyticsApi
      .leastUsedRoomTypes()
      .then(setLeastUsedRoomTypes)
      .catch(() => {});

    analyticsApi
      .liveInHouseCount()
      .then(setLiveInHouseCount)
      .catch(() => {});
    analyticsApi
      .liveInHouseRoster()
      .then(setLiveInHouseRoster)
      .catch(() => {});

    analyticsApi
      .spendByMonth()
      .then(setSpendByMonth)
      .catch(() => {});
    analyticsApi
      .totalRecentActivitySpend()
      .then(setTotalRecentActivitySpend)
      .catch(() => {});
    analyticsApi
      .topSpendDescriptions()
      .then(setTopSpendDescriptions)
      .catch(() => {});

    analyticsApi
      .totalAmountDue()
      .then(setTotalAmountDue)
      .catch(() => {});
    analyticsApi
      .amountDueByPeriod()
      .then(setAmountDueByPeriod)
      .catch(() => {});

    analyticsApi
      .totalDependents()
      .then(setTotalDependents)
      .catch(() => {});
    analyticsApi
      .dependentsByAgeGroup()
      .then(setDependentsByAgeGroup)
      .catch(() => {});
    analyticsApi
      .dependentsPerMember()
      .then(setDependentsPerMember)
      .catch(() => {});

    analyticsApi
      .memberDirectory()
      .then(setDirectoryMembers)
      .catch(() => {});
  }, []);

  const totalMembers = membersByType.reduce((a, b) => a + (b.total || 0), 0);

  const filteredDirectory = directoryMembers.filter((m) => {
    const q = directorySearch.toLowerCase();
    if (!q) return true;
    return [
      m.member_name,
      m.member_number,
      m.member_type,
      m.status,
      m.city,
      m.state,
      m.country,
      m.occupation,
      m.employer,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  return (
    <div style={styles.root}>
      <main style={styles.main}>
        {/* ── Tab nav ── */}
        <div style={styles.tabRow}>
          {Object.keys(TAB_LABELS).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                ...styles.tab,
                ...(activeTab === t ? styles.tabActive : styles.tabInactive),
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ════════════════════ OVERVIEW ════════════════════ */}
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

        {/* ════════════════════ DEMOGRAPHICS ════════════════════ */}
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

        {/* ════════════════════ VISITS & ROOMS ════════════════════ */}
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

        {/* ════════════════════ FINANCE ════════════════════ */}
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

        {/* ════════════════════ DIRECTORY ════════════════════ */}
        {activeTab === "directory" && (
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
                <div>
                  <p style={styles.cardTitle}>All members &amp; guests</p>
                  <p style={styles.cardDesc}>
                    {filteredDirectory.length} of {directoryMembers.length}{" "}
                    records
                  </p>
                </div>
                <div style={{ position: "relative", width: 300 }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#B09880",
                      pointerEvents: "none",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </span>
                  <input
                    value={directorySearch}
                    onChange={(e) => setDirectorySearch(e.target.value)}
                    placeholder="Search name, number, city, occupation…"
                    style={styles.searchInput}
                  />
                </div>
              </div>

              <div
                style={{
                  overflowX: "auto",
                  borderRadius: 10,
                  border: "1px solid #EDE5D8",
                }}
              >
                <div style={{ maxHeight: 600, overflowY: "auto" }}>
                  <table style={{ ...styles.table, minWidth: 900 }}>
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        background: "#FDFAF6",
                        zIndex: 1,
                      }}
                    >
                      <tr>
                        {[
                          "Member",
                          "Type",
                          "Status",
                          "In-house",
                          "Age / Gender",
                          "Location",
                          "Occupation",
                          "Tenure",
                          "Dependents",
                          "Balance",
                        ].map((h) => (
                          <th key={h} style={styles.th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDirectory.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            style={{
                              ...styles.td,
                              textAlign: "center",
                              color: "#B09880",
                              padding: 40,
                            }}
                          >
                            No data available
                          </td>
                        </tr>
                      ) : (
                        filteredDirectory.map((m, i) => (
                          <DirectoryRow
                            key={m.member_number ?? i}
                            m={m}
                            i={i}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════ ML INSIGHTS ════════════════════ */}
        {activeTab === "ml" && (
          <div style={styles.tabContent}>
            <div style={styles.card}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "80px 0",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: "#F5EFE6",
                    border: "1px solid #E8DDD0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 20,
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C8976E"
                    strokeWidth="1.5"
                  >
                    <path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4z" />
                    <path d="M12 10v4M8 14h8M6 18h12M4 22h16" />
                    <circle cx="6" cy="12" r="2" />
                    <circle cx="18" cy="12" r="2" />
                    <path d="M8 12H6M18 12h-6" />
                  </svg>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 17,
                    fontWeight: 600,
                    color: "#3D2B1F",
                  }}
                >
                  ML Insights
                </p>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 13,
                    color: "#9C7B65",
                    fontFamily: "sans-serif",
                    maxWidth: 380,
                    lineHeight: 1.6,
                  }}
                >
                  Machine learning models and predictive analytics will appear
                  here. Coming soon.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
