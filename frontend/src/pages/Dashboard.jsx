// frontend/src/pages/dashboard.jsx

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
  LayoutDashboard,
  Users,
  BookOpen,
  ChevronRight,
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
  DirectoryRow,
} from "./Dashboardcomponents";
import {
  SeasonDetailPanel,
  AmenityDetailPanel,
  MarketingTargetsPanel,
} from "./MlDetailPanel";
import SeasonFilterBar from "./SeasonFilterBar";

/* ─── Sidebar config ─────────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "demographics", label: "Demographics", Icon: Users },
  { id: "visits", label: "Visits & Rooms", Icon: BedDouble },
  { id: "finance", label: "Finance", Icon: DollarSign },
  { id: "directory", label: "Directory", Icon: BookOpen },
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
  const [directorySearch, setDirectorySearch] = useState("");

  // ML Insights now loads from one master backend response, only when the ML tab opens.
  const [mlInsights, setMlInsights] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState(null);
  const [mlSearch, setMlSearch] = useState("");
  const [seasonDetail, setSeasonDetail] = useState(null);
  const [seasonDetailRows, setSeasonDetailRows] = useState([]);
  const [amenityDetail, setAmenityDetail] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  useEffect(() => {
    const safe = (fn, set) =>
      fn()
        .then(set)
        .catch(() => {});
    safe(analyticsApi.membersByCountry, setMembersByCountry);
    safe(analyticsApi.membersByState, setMembersByState);
    safe(analyticsApi.membersByGender, setMembersByGender);
    safe(analyticsApi.membersByAgeGroup, setMembersByAgeGroup);
    safe(analyticsApi.membersByType, setMembersByType);
    safe(analyticsApi.membersByStatus, setMembersByStatus);
    safe(analyticsApi.membersByMaritalStatus, setMembersByMaritalStatus);
    safe(analyticsApi.newMembersPerYear, setNewMembersPerYear);
    safe(analyticsApi.averageTenure, setAverageTenure);
    safe(analyticsApi.bookingsByRoomType, setBookingsByRoomType);
    safe(analyticsApi.bookingsByMonth, setBookingsByMonth);
    safe(analyticsApi.averageLengthOfStay, setAverageLengthOfStay);
    safe(analyticsApi.mostUsedRoomTypes, setMostUsedRoomTypes);
    safe(analyticsApi.leastUsedRoomTypes, setLeastUsedRoomTypes);
    safe(analyticsApi.liveInHouseCount, setLiveInHouseCount);
    safe(analyticsApi.liveInHouseRoster, setLiveInHouseRoster);
    safe(analyticsApi.spendByMonth, setSpendByMonth);
    safe(analyticsApi.totalRecentActivitySpend, setTotalRecentActivitySpend);
    safe(analyticsApi.topSpendDescriptions, setTopSpendDescriptions);
    safe(analyticsApi.totalAmountDue, setTotalAmountDue);
    safe(analyticsApi.amountDueByPeriod, setAmountDueByPeriod);
    safe(analyticsApi.totalDependents, setTotalDependents);
    safe(analyticsApi.dependentsByAgeGroup, setDependentsByAgeGroup);
    safe(analyticsApi.dependentsPerMember, setDependentsPerMember);
    safe(analyticsApi.memberDirectory, setDirectoryMembers);
  }, []);

  useEffect(() => {
    if (activeTab !== "ml" || mlInsights || mlLoading) return;

    setMlLoading(true);
    setMlError(null);

    analyticsApi
      .mlInsights()
      .then(setMlInsights)
      .catch((error) => {
        console.error("Failed to load ML insights", error);
        setMlError("Unable to load ML insights right now.");
      })
      .finally(() => setMlLoading(false));
  }, [activeTab, mlInsights, mlLoading]);

  // ---------- derived values (identical to original) ----------
  const totalMembers = membersByType.reduce((a, b) => a + (b.total || 0), 0);

  const memberSegments = mlInsights?.memberSegments ?? [];
  const segmentSummary = mlInsights?.segmentSummary ?? [];
  const amenityAdoption = mlInsights?.amenityAdoption ?? [];
  const amenitySegments = mlInsights?.amenitySegments ?? [];
  const seasonalVisits = mlInsights?.seasonalVisits ?? [];
  const amenityRevenue = mlInsights?.amenityRevenue ?? [];
  const airportTransferUsers = mlInsights?.airportTransferUsers ?? [];
  const memberAmenityUsage = mlInsights?.memberAmenityUsage ?? [];
  const marketingTargetsByCampaign =
    mlInsights?.marketingTargetsByCampaign ?? [];

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

  const selectedMlMember = memberSegments.find((m) => {
    const q = mlSearch.toLowerCase();
    if (!q) return false;
    return [
      m.member_full_name,
      m.member_number,
      m.segment_name,
      m.member_type,
      m.campaign,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  const selectedMemberAmenityUsage = selectedMlMember
    ? memberAmenityUsage
        .filter(
          (a) =>
            String(a.member_number) === String(selectedMlMember.member_number),
        )
        .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
    : [];

  const seasonOrder = ["Winter", "Spring", "Summer", "Autumn"];
  const getSeason = (monthValue) => {
    const month = Number(String(monthValue).split("-")[1]);
    if ([1, 2, 3].includes(month)) return "Spring";
    if ([4, 5, 6, 7].includes(month)) return "Summer";
    if ([8].includes(month)) return "Late Summer";
    if ([9, 10].includes(month)) return "Autumn";
    return "Winter";
  };

  const seasonalBySeason = Object.values(
    seasonalVisits.reduce((acc, row) => {
      const season = getSeason(row.month);
      if (!acc[season])
        acc[season] = { season, visits: 0, totalStay: 0, months: 0 };
      acc[season].visits += Number(row.visits ?? 0);
      acc[season].totalStay += Number(row.avg_stay ?? 0);
      acc[season].months += 1;
      return acc;
    }, {}),
  )
    .map((s) => ({
      ...s,
      avg_stay: s.months ? Number((s.totalStay / s.months).toFixed(1)) : 0,
    }))
    .sort(
      (a, b) => seasonOrder.indexOf(a.season) - seasonOrder.indexOf(b.season),
    );

  const amenityRevenueReadable = amenityRevenue
    .map((a) => ({
      ...a,
      avg_transaction:
        Number(a.transactions ?? 0) > 0
          ? Number(a.revenue ?? 0) / Number(a.transactions ?? 1)
          : 0,
    }))
    .sort((a, b) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0));

  const segmentScatterData = segmentSummary.map((s) => ({
    segment_name: s.segment_name,
    member_count: Number(s.member_count ?? 0),
    avg_total_spend: Number(s.avg_total_spend ?? 0),
    avg_visits: Number(s.avg_visits ?? 0),
  }));

  const amenityAdoptionReadable = amenityAdoption
    .map((a) => ({ ...a, adoption_score: Number(a.members_using ?? 0) }))
    .sort((a, b) => b.adoption_score - a.adoption_score);

  const amenitySegmentsReadable = amenitySegments
    .map((row) => ({
      ...row,
      segment_label:
        row.amenity_segment ??
        row.segment_name ??
        row.amenity_segment_name ??
        row.cluster_name ??
        "Unassigned",
      member_count_value: Number(row.member_count ?? row.members ?? 0),
      total_amenity_visits_value: Number(
        row.total_amenity_visits ?? row.amenity_visits ?? row.total_visits ?? 0,
      ),
      total_spend_value: Number(
        row.total_spend ?? row.total_amenity_spend ?? row.amenity_spend ?? 0,
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.total_amenity_visits_value ?? 0) -
        Number(a.total_amenity_visits_value ?? 0),
    );

  const airportTransferReadable = airportTransferUsers
    .map((m) => ({
      ...m,
      avg_transfer_spend:
        Number(m.transfers ?? 0) > 0
          ? Number(m.total_spend ?? 0) / Number(m.transfers ?? 1)
          : 0,
    }))
    .sort((a, b) => Number(b.transfers ?? 0) - Number(a.transfers ?? 0));

  const activeTabInfo = TABS.find((t) => t.id === activeTab);

  /* ── use the original styles for inner content ── */
  const styles = baseStyles;

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
          {activeTab === "directory" && "Searchable member and guest records"}
          {activeTab === "ml" &&
            "Segmentation, amenity insights and campaign recommendations"}
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

        {/* ════════ DIRECTORY ════════ */}
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

        {/* ════════ ML INSIGHTS ════════ */}
        {activeTab === "ml" && (
          <div style={styles.tabContent}>
            {/* ── Season detail slide-over ── */}
            {seasonDetail && (
              <SeasonDetailPanel
                season={seasonDetail}
                rows={seasonDetailRows}
                memberAmenityUsage={memberAmenityUsage}
                onClose={() => {
                  setSeasonDetail(null);
                  setSeasonDetailRows([]);
                }}
              />
            )}

            {/* ── Amenity detail slide-over ── */}
            {amenityDetail && (
              <AmenityDetailPanel
                amenity={amenityDetail}
                memberAmenityUsage={memberAmenityUsage}
                memberSegments={memberSegments}
                onClose={() => setAmenityDetail(null)}
              />
            )}

            {/* ── Email promotion modal placeholder ── */}
            {showEmailModal && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(30,18,10,0.55)",
                  zIndex: 2000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onClick={() => setShowEmailModal(false)}
              >
                <div
                  style={{
                    background: "#FDFAF6",
                    borderRadius: 14,
                    padding: "32px 36px",
                    width: "min(480px,90vw)",
                    boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 17,
                      fontWeight: 700,
                      color: "#3D2B1F",
                      fontFamily: "sans-serif",
                    }}
                  >
                    Add Email Promotion
                  </p>
                  <p
                    style={{
                      margin: "0 0 20px",
                      fontSize: 12,
                      color: "#A08070",
                      fontFamily: "sans-serif",
                    }}
                  >
                    This feature is coming soon. You'll be able to compose and
                    schedule targeted campaigns from here.
                  </p>
                  <button
                    style={{
                      padding: "9px 20px",
                      borderRadius: 8,
                      border: "none",
                      background: "#C8976E",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "sans-serif",
                      cursor: "pointer",
                    }}
                    onClick={() => setShowEmailModal(false)}
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}

            {/* ════ Customer Segments ════ */}
            <SectionLabel>Customer Segments</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 14,
                marginBottom: 28,
              }}
            >
              {segmentSummary.map((s, i) => {
                const SEGMENT_COLORS = [
                  "#C8976E",
                  "#5B9EAD",
                  "#C4A24D",
                  "#7B5EA7",
                  "#2D8A5F",
                  "#C45B5B",
                ];
                const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
                return (
                  <div
                    key={s.segment_name ?? i}
                    style={{
                      background: "#FDFAF6",
                      border: `1px solid #EDE5D8`,
                      borderTop: `3px solid ${color}`,
                      borderRadius: 12,
                      padding: "16px 18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.09em",
                        color,
                        fontFamily: "sans-serif",
                      }}
                    >
                      Segment {i + 1}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#3D2B1F",
                        fontFamily: "sans-serif",
                        lineHeight: 1.3,
                      }}
                    >
                      {s.segment_name ?? "Unnamed"}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 26,
                        fontWeight: 700,
                        color: "#3D2B1F",
                        fontFamily: "sans-serif",
                        lineHeight: 1,
                      }}
                    >
                      {s.member_count ?? 0}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: "#A08070",
                        fontFamily: "sans-serif",
                      }}
                    >
                      members
                    </p>
                    <div
                      style={{
                        height: 1,
                        background: "#EDE5D8",
                        margin: "4px 0",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: "#5A3E2B",
                          fontFamily: "sans-serif",
                        }}
                      >
                        Avg spend{" "}
                        <strong>
                          ${Number(s.avg_total_spend ?? 0).toLocaleString()}
                        </strong>
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: "#5A3E2B",
                          fontFamily: "sans-serif",
                        }}
                      >
                        Avg visits{" "}
                        <strong>{Number(s.avg_visits ?? 0).toFixed(1)}</strong>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ════ Member Lookup ════ */}
            <SectionLabel>Member Lookup</SectionLabel>
            <div style={styles.card}>
              <div
                style={{
                  ...styles.cardHeader,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <p style={{ ...styles.cardTitle, margin: 0 }}>Member lookup</p>
              </div>
              <input
                value={mlSearch}
                onChange={(e) => setMlSearch(e.target.value)}
                placeholder="Search by name, member #, segment, or campaign..."
                style={{
                  ...styles.searchInput,
                  maxWidth: 520,
                  marginBottom: 20,
                }}
              />
              {!selectedMlMember ? (
                <p style={styles.cardDesc}>
                  Start typing a member's name to see their personalized
                  profile.
                </p>
              ) : (
                (() => {
                  const favAmenity = selectedMemberAmenityUsage[0];
                  return (
                    <div style={styles.statsGrid}>
                      <StatCard
                        icon={UserCheck}
                        label="Member"
                        value={
                          selectedMlMember.member_full_name ??
                          selectedMlMember.member_number
                        }
                        hint={selectedMlMember.member_type}
                      />
                      <StatCard
                        icon={Sparkles}
                        label="Segment"
                        value={selectedMlMember.segment_name ?? "—"}
                        hint={
                          selectedMlMember.is_active
                            ? "Active member"
                            : "Inactive / at-risk"
                        }
                      />
                      <StatCard
                        icon={DollarSign}
                        label="Total Spend"
                        value={`$${Number(selectedMlMember.total_spend ?? 0).toLocaleString()}`}
                        hint={`Avg. spend $${Number(selectedMlMember.avg_spend ?? 0).toLocaleString()}`}
                      />
                      <StatCard
                        icon={BedDouble}
                        label="Visits"
                        value={selectedMlMember.visit_count ?? 0}
                        hint={`Avg. stay ${Number(selectedMlMember.avg_stay ?? 0).toFixed(1)} nights`}
                      />
                      <StatCard
                        icon={Clock}
                        label="Recency"
                        value={
                          selectedMlMember.days_since_last_visit != null
                            ? `${selectedMlMember.days_since_last_visit} days`
                            : "—"
                        }
                        hint="Since last visit"
                      />
                      <StatCard
                        icon={TrendingUp}
                        label="Campaign"
                        value={selectedMlMember.campaign ?? "—"}
                        hint="Recommended marketing action"
                      />
                      <StatCard
                        icon={Sparkles}
                        label="Favourite Amenity"
                        value={favAmenity?.amenity ?? "—"}
                        hint={
                          favAmenity
                            ? `${favAmenity.usage_count} uses · $${Number(favAmenity.total_spend ?? 0).toLocaleString()} spent`
                            : "No amenity data"
                        }
                      />
                    </div>
                  );
                })()
              )}
            </div>

            {/* ════ General ML Insights ════ */}
            <SectionLabel>General ML Insights</SectionLabel>

            {/* Row 1: Seasonal + Segment value */}
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Seasonal demand"
                description="Click a bar to drill into who visits each season"
              >
                <ResponsiveContainer>
                  <SeasonFilterBar
                    seasonalVisits={seasonalVisits}
                    onSeasonClick={(seasonName, group) => {
                      // map custom groups to their month ranges for the drill-down
                      const season = group?.seasons?.find(
                        (s) => s.season_name === seasonName,
                      );
                      if (!season) return;
                      analyticsApi
                        .seasonalVisitDetails(seasonName)
                        .then((rows) => {
                          setSeasonDetailRows(rows);
                          setSeasonDetail(seasonName);
                        })
                        .catch(() => {});
                    }}
                  />
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Customer segment value"
                description="Average spend per segment"
              >
                <ResponsiveContainer>
                  <BarChart data={segmentScatterData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis
                      dataKey="segment_name"
                      stroke="#A08070"
                      fontSize={11}
                    />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar
                      dataKey="avg_total_spend"
                      fill="#2D5F6E"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Row 2: Amenity adoption + Amenity spend — side by side, full label height */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 20,
              }}
            >
              {/* Amenity adoption */}
              <div
                style={{
                  background: "#FDFAF6",
                  border: "1px solid #EDE5D8",
                  borderRadius: 14,
                  padding: "18px 20px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#3D2B1F",
                      fontFamily: "sans-serif",
                    }}
                  >
                    Amenity adoption
                  </p>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#A08070",
                      fontFamily: "sans-serif",
                    }}
                  >
                    · click bar to see members
                  </span>
                </div>
                <div
                  style={{
                    height: Math.max(260, amenityAdoptionReadable.length * 32),
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={amenityAdoptionReadable}
                      layout="vertical"
                      margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#E8DDD0"
                        horizontal={false}
                      />
                      <XAxis type="number" stroke="#A08070" fontSize={11} />
                      <YAxis
                        type="category"
                        dataKey="amenity"
                        stroke="#A08070"
                        fontSize={11}
                        width={130}
                        tick={{ fill: "#5A3E2B" }}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar
                        dataKey="members_using"
                        fill="#5B9EAD"
                        radius={[0, 6, 6, 0]}
                        cursor="pointer"
                        onClick={(data) => {
                          if (data?.amenity) setAmenityDetail(data.amenity);
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Amenity spend */}
              <div
                style={{
                  background: "#FDFAF6",
                  border: "1px solid #EDE5D8",
                  borderRadius: 14,
                  padding: "18px 20px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#3D2B1F",
                      fontFamily: "sans-serif",
                    }}
                  >
                    Amenity spend ranking
                  </p>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#A08070",
                      fontFamily: "sans-serif",
                    }}
                  >
                    · revenue by amenity
                  </span>
                </div>
                <div
                  style={{
                    height: Math.max(260, amenityRevenueReadable.length * 32),
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={amenityRevenueReadable}
                      layout="vertical"
                      margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#E8DDD0"
                        horizontal={false}
                      />
                      <XAxis type="number" stroke="#A08070" fontSize={11} />
                      <YAxis
                        type="category"
                        dataKey="amenity"
                        stroke="#A08070"
                        fontSize={11}
                        width={130}
                        tick={{ fill: "#5A3E2B" }}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar
                        dataKey="revenue"
                        fill="#D4AF2A"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ════ Targeted Marketing ════ */}
            <SectionLabel>Targeted Marketing</SectionLabel>
            <MarketingTargetsPanel
              memberSegments={memberSegments}
              memberAmenityUsage={memberAmenityUsage}
              onAddPromotion={() => setShowEmailModal(true)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
