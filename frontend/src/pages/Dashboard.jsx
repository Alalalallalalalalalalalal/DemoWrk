import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Users,
  UserCheck,
  BedDouble,
  Sparkles,
  Activity,
  CircleDot,
  DollarSign,
  CalendarClock,
  Percent,
  Baby,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { analyticsApi } from "../api/analytics";

/* ─── Design tokens ──────────────────────────────────────────── */
const COLORS = [
  "#C8976E",
  "#5B9EAD",
  "#2D5F6E",
  "#C4A24D",
  "#8B6B4A",
  "#7ABCCC",
];
const TOOLTIP_STYLE = {
  background: "#FDFAF6",
  border: "1px solid #E8DDD0",
  borderRadius: 10,
  fontSize: 12,
  color: "#3D2B1F",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
};

/* ─── Sub-components ─────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div style={styles.statCard}>
      <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
        <p style={styles.statLabel}>{label}</p>
        <p style={styles.statValue}>{value}</p>
        {hint && <p style={styles.statHint}>{hint}</p>}
      </div>
      <div style={{ ...styles.statIcon, flexShrink: 0 }}>
        <Icon size={18} color="#C8976E" />
      </div>
    </div>
  );
}

function ChartCard({ title, description, children, span2 }) {
  return (
    <div style={{ ...styles.card, ...(span2 ? styles.span2 : {}) }}>
      <div style={styles.cardHeader}>
        <p style={styles.cardTitle}>{title}</p>
        {description && <p style={styles.cardDesc}>{description}</p>}
      </div>
      <div style={{ height: 260 }}>{children}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={styles.sectionLabel}>
      <span style={styles.sectionLabelLine} />
      <span style={styles.sectionLabelText}>{children}</span>
      <span style={styles.sectionLabelLine} />
    </div>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  const [membersByCountry, setMembersByCountry] = useState([]);
  const [membersByState, setMembersByState] = useState([]);
  const [membersByGender, setMembersByGender] = useState([]);
  const [membersByAgeGroup, setMembersByAgeGroup] = useState([]);
  const [membersByType, setMembersByType] = useState([]);
  const [membersByStatus, setMembersByStatus] = useState([]);
  const [bookingsByRoomType, setBookingsByRoomType] = useState([]);
  const [bookingsByMonth, setBookingsByMonth] = useState([]);
  const [averageLengthOfStay, setAverageLengthOfStay] = useState(null);
  const [spendByMonth, setSpendByMonth] = useState([]);
  const [totalAmountDue, setTotalAmountDue] = useState(null);
  const [dependentsByAgeGroup, setDependentsByAgeGroup] = useState([]);

  useEffect(() => {
    analyticsApi.membersByCountry().then(setMembersByCountry);
    analyticsApi.membersByState().then(setMembersByState);
    analyticsApi.membersByGender().then(setMembersByGender);
    analyticsApi.membersByAgeGroup().then(setMembersByAgeGroup);
    analyticsApi.membersByType().then(setMembersByType);
    analyticsApi.membersByStatus().then(setMembersByStatus);
    analyticsApi.bookingsByRoomType().then(setBookingsByRoomType);
    analyticsApi.bookingsByMonth().then(setBookingsByMonth);
    analyticsApi.averageLengthOfStay().then(setAverageLengthOfStay);
    analyticsApi.spendByMonth().then(setSpendByMonth);
    analyticsApi.totalAmountDue().then(setTotalAmountDue);
    analyticsApi.dependentsByAgeGroup().then(setDependentsByAgeGroup);
  }, []);

  const tabs = ["overview", "demographics", "visits", "directory"];

  return (
    <div style={styles.root}>
      <main style={styles.main}>
        {/* Tabs */}
        <div style={styles.tabRow}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                ...styles.tab,
                ...(activeTab === t ? styles.tabActive : styles.tabInactive),
              }}
            >
              {t === "visits"
                ? "Visits & Rooms"
                : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div style={styles.tabContent}>
            <div style={styles.statsGrid}>
              <StatCard
                icon={UserCheck}
                label="Members"
                value={
                  membersByType.reduce((a, b) => a + (b.total || 0), 0) || "—"
                }
                hint="Primary holders"
              />
              <StatCard
                icon={Users}
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
              <StatCard
                icon={DollarSign}
                label="Outstanding Balance"
                value={
                  totalAmountDue?.total_amount_due != null
                    ? `$${Number(totalAmountDue.total_amount_due).toLocaleString()}`
                    : "—"
                }
                hint="Accounts with dues"
              />
            </div>

            <SectionLabel>Member Analytics</SectionLabel>
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
                      stroke="#C8976E"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#C8976E" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <div style={{ ...styles.card }}>
                <div style={styles.cardHeader}>
                  <p style={styles.cardTitle}>Member Type Mix</p>
                  <p style={styles.cardDesc}>Category breakdown</p>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    height: 260,
                  }}
                >
                  {/* Pie chart — fixed width so it doesn't squash */}
                  <div style={{ flex: "0 0 180px", height: "100%" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={membersByType}
                          dataKey="total"
                          nameKey="member_type"
                          outerRadius={80}
                          innerRadius={44}
                          paddingAngle={2}
                        >
                          {membersByType.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Custom legend beside the chart */}
                  <div
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      maxHeight: 260,
                      paddingRight: 4,
                    }}
                  >
                    {membersByType.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            background: COLORS[i % COLORS.length],
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "#5A3E2B",
                            fontFamily: "'Helvetica Neue', Arial, sans-serif",
                            lineHeight: 1.3,
                          }}
                        >
                          {item.member_type}
                        </span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: "#9C7B65",
                            fontWeight: 600,
                            fontFamily: "'Helvetica Neue', Arial, sans-serif",
                          }}
                        >
                          {item.total}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <SectionLabel>Spend Analytics</SectionLabel>
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
                    <Bar dataKey="total" fill="#C8976E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        )}

        {/* ── DEMOGRAPHICS ── */}
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

              <ChartCard title="Gender Split" description="Male vs Female">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={membersByGender}
                      dataKey="total"
                      nameKey="gender"
                      outerRadius={90}
                      innerRadius={50}
                      paddingAngle={2}
                    >
                      {membersByGender.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#7A6050" }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Member Status" description="Active vs inactive">
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
            </div>

            <SectionLabel>Location Analytics</SectionLabel>
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
            </div>
          </div>
        )}

        {/* ── VISITS & ROOMS ── */}
        {activeTab === "visits" && (
          <div style={styles.tabContent}>
            <div style={styles.statsGrid}>
              <StatCard
                icon={CalendarClock}
                label="Avg. Length of Stay"
                value={`${averageLengthOfStay?.average_nights ?? "—"} nights`}
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
                  bookingsByMonth.reduce((a, b) => a + (b.total || 0), 0) || "—"
                }
                hint="All time"
              />
              <StatCard
                icon={MapPin}
                label="Markets"
                value={membersByCountry.length || "—"}
                hint="Countries"
              />
            </div>

            <SectionLabel>Room Analytics</SectionLabel>
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

              <ChartCard
                title="Bookings by Month"
                description="Monthly reservation trend"
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

            <SectionLabel>Spend</SectionLabel>
            <div style={styles.chartsGrid}>
              <ChartCard
                title="Spend by Month"
                description="Revenue over time"
                span2
              >
                <ResponsiveContainer>
                  <BarChart data={spendByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
                    <XAxis dataKey="month" stroke="#A08070" fontSize={11} />
                    <YAxis stroke="#A08070" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="total" fill="#C4A24D" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        )}

        {/* ── DIRECTORY ── */}
        {activeTab === "directory" && (
          <div style={styles.tabContent}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <p style={styles.cardTitle}>Member Directory</p>
                <p style={styles.cardDesc}>
                  Full member search &amp; table coming soon
                </p>
              </div>
              <div style={styles.directoryPlaceholder}>
                <Users size={40} color="#D4C4B0" />
                <p style={{ marginTop: 16, color: "#A08070", fontSize: 14 }}>
                  Directory will be added after analytics charts are complete.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Styles ─────────────────────────────────────────────────── */
const styles = {
  root: {
    minHeight: "100vh",
    background: "#F5EFE6",
    fontFamily: "'Georgia', 'Times New Roman', serif",
  },
  header: {
    background: "#FDFAF6",
    borderBottom: "1px solid #E8DDD0",
    backdropFilter: "blur(8px)",
  },
  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "18px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBrand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "#3D2B1F",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: "#3D2B1F",
    letterSpacing: "0.02em",
  },
  headerSub: {
    margin: 0,
    fontSize: 11,
    color: "#9C7B65",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  liveBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#F5EFE6",
    border: "1px solid #E8DDD0",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 11,
    color: "#7A6050",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  main: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "28px 28px 60px",
  },
  tabRow: {
    display: "flex",
    gap: 4,
    marginBottom: 28,
    background: "#EDE5D8",
    borderRadius: 10,
    padding: 4,
    width: "fit-content",
  },
  tab: {
    padding: "8px 20px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontWeight: 500,
    transition: "all 0.15s ease",
    letterSpacing: "0.01em",
  },
  tabActive: {
    background: "#FDFAF6",
    color: "#3D2B1F",
    boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
  },
  tabInactive: {
    background: "transparent",
    color: "#9C7B65",
  },
  tabContent: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  },
  statCard: {
    background: "#FDFAF6",
    border: "1px solid #E8DDD0",
    borderRadius: 14,
    padding: "20px 22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
    minWidth: 0,
    overflow: "hidden",
  },
  statLabel: {
    margin: 0,
    fontSize: 10,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontWeight: 600,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: "#9C7B65",
  },
  statValue: {
    margin: "6px 0 4px",
    fontSize: 24,
    fontWeight: 700,
    color: "#3D2B1F",
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    wordBreak: "break-word",
    overflowWrap: "break-word",
  },
  statHint: {
    margin: 0,
    fontSize: 11,
    color: "#B09880",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  statIcon: {
    background: "#F5EFE6",
    borderRadius: 9,
    padding: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
  },
  card: {
    background: "#FDFAF6",
    border: "1px solid #E8DDD0",
    borderRadius: 14,
    padding: "20px 22px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
  },
  span2: {
    gridColumn: "span 2",
  },
  cardHeader: {
    marginBottom: 16,
  },
  cardTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "#3D2B1F",
  },
  cardDesc: {
    margin: "3px 0 0",
    fontSize: 11,
    color: "#9C7B65",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "4px 0",
  },
  sectionLabelLine: {
    flex: 1,
    height: 1,
    background: "#E8DDD0",
  },
  sectionLabelText: {
    fontSize: 10,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#B09880",
    whiteSpace: "nowrap",
  },
  directoryPlaceholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 0",
    color: "#C4B0A0",
  },
};
