// frontend/src/pages/dashboard.jsx

// Palette: Palladian #EEE9DF · Oatmeal #C9C1B1 · DeepBlue #2C3B4D
//          Flame #FFB162 · Truffle #A35139 · Abyssal #1B2632

import { useState } from "react";
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
  Bell,
  ArrowUpRight,
  ChevronDown,
  MoreHorizontal,
  Settings,
  PartyPopper,
  Home,
} from "lucide-react";
import AnnualFeesTab from "./annual-fees/AnnualFeesTab";
import { FinancePeriodFilter } from "./finance/FinanceShared";
import { COLORS, TOOLTIP_STYLE } from "./styles/Dashboardstyles";
import {
  StatCard,
  ChartCard,
  SectionLabel,
  PieLegendCard,
  RoomHighlightCard,
  Card,
  ErrorBoundary,
} from "./styles/Dashboardcomponents";
import SeasonFilterBar from "./mltab/SeasonFilterBar";
import AmenitySeasonPanel from "./mltab/AmenitySeasonPanel";
import SegmentationPanel from "./mltab/Segmentationpanel";
import MarketingTargetingPanel from "./mltab/MarketingTargetingPanel";
import "./styles/styles.css";
import VisitsRoomsTab from "./visits/VisitsRoomsTab";
import DemographicsTab from "./demographics/DemographicsTab";
import FinanceTab from "./finance/FinanceTab";
import ReportsTab from "./reports/ReportsTab";
import { useDashboardData } from "./useDashboardData";

//Overview tab components
import OverviewTab from "./overview/OverviewTab";

/* ─── Sidebar nav config ─────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "demographics", label: "Demographics", Icon: Users },
  { id: "visits", label: "Visits & Rooms", Icon: BedDouble },
  { id: "finance", label: "Finance", Icon: DollarSign },
  { id: "reports", label: "Reports", Icon: BookOpen },
  { id: "market", label: "Marketing Targeting", Icon: PartyPopper },
  { id: "ml", label: "ML Insights", Icon: Sparkles },
  { id: "annual_fees", label: "Annual Fees", Icon: Home },
];

const SUB = {
  overview: "High-level member, booking and spend summary",
  demographics: "Age, gender, location and household data",
  visits: "Room performance, booking trends and live roster",
  finance: "Outstanding balances and spend breakdown",
  reports: "View and filter raw report data",
  market: "Analysis and Insights on market Targeting",
  ml: "Segmentation, amenity insights and campaign recommendations — all monetary figures in $USD",
  annual_fees: "Maintenance, Capital Expenditure and membership dues billed per villa",
};

/* ─── Recharts shared props ──────────────────────────────────── */
const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = TOOLTIP_STYLE;

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [activeSeasonGroup, setActiveSeasonGroup] = useState(null);

  const {
    overviewPeriod,
    setOverviewPeriod,
    overviewYears,

    membersByCountry,
    membersByState,
    membersByGender,
    membersByAgeGroup,
    membersByType,
    accountsByType,
    membersByStatus,
    membersByMaritalStatus,
    newMembersPerYear,
    averageTenure,
    bookingsByRoomType,
    bookingsByMonth,
    averageLengthOfStay,
    mostUsedRoomTypes,

    totalRecentActivitySpend,
    topSpendDescriptions,
    totalDependents,
    dependentsPerHousehold,
    dependentsByAgeGroup,
    dependentsPerMember,

    selectedVillaName,
    setSelectedVillaName,
    villaStats,
    visitsTabSummary,
    bedroomBookings,
    villaRevenue,
    transactionFinanceSummary,
    transactionMemberVsGuestRevenue,
    transactionMemberVsGuestRevenueByCategory,
    villaAmenityRevenue,
    monthlyRevenueByCategory,
    reversalsSummary,
    villaRackRateFree,
    cashAdvanceSummary,
    anomaliesSummary,
    anomalies,
    tipsSummary,
    internalTransfersSummary,
    paymentsSummary,
    paymentCorrectionsSummary,
    memberDuesSummary,
    emailOnFile,
    rackRateSummary,
  } = useDashboardData();

  const totalMembers = membersByType.reduce((a, b) => a + (b.total || 0), 0);

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
          <VisitsRoomsTab
            selectedVillaName={selectedVillaName}
            onVillaSelect={setSelectedVillaName}
            onGoToML={() => setActiveTab("ml")}
          />
        )}

        {/* ════ FINANCE ════ */}
        {activeTab === "finance" && <FinanceTab />}


        {/* ════ ANNUAL FEES ════ */}
        {activeTab === "annual_fees" && <AnnualFeesTab />}

        {/* ════ REPORTS ════ */}
        {activeTab === "reports" && <ReportsTab />}

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
