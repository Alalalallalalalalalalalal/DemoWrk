import { useMemo, useRef } from "react";

import StateAccountsModal from "./StateAccountsModal";
import DateFilterBar from "./DemographicsDateFilter";

import { MONTHS } from "./DemographicsShared";
import useVisitorChartData from "./useVisitorChartData";
import useDemographicsSummaries from "./useDemographicsSummaries";
import useAccountDrawer from "./useAccountDrawer";

import DemographicsKpiBand from "./DemographicsKpiBand";
import AccountTypesSection from "./AccountTypesSection";
import AgeGenderMaritalSection from "./AgeGenderMaritalSection";
import MemberGrowthSection from "./MemberGrowthSection";
import GeographicSection from "./GeographicSection";
import HouseholdSection from "./HouseholdSection";

/* ─── Demographics tab ──────────────────────────────────────── */

export default function DemographicsTab({
  membersByCountry = [],
  membersByState = [],
  membersByGender = [],
  membersByAgeGroup = [],
  accountsByType = [],
  membersByStatus = [],
  membersByMaritalStatus = [],
  newMembersPerYear = [],
  totalDependents = null,
  dependentsByAgeGroup = [],
  dependentsPerHousehold = [],
  dependentsPerMember = [],
}) {
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const {
    years,
    drawerDateFilter,
    accountDrawer,
    accountDetails,
    accountDetailsLoading,
    accountDetailsError,
    openAccountDrawer,
    handleDrawerDateChange,
    closeAccountDrawer,
  } = useAccountDrawer();

  const {
    visitorChartFilter,
    setVisitorChartFilter,
    visitorYearsAvailable,
    visitorChartData,
    visitorChartLoading,
    visitorChartSubtitle,
    visitorAxisInterval,
  } = useVisitorChartData(currentYear);

  const { completeness, householdSummary, geoConcentration, extraSummaryLoading } =
    useDemographicsSummaries();

  /* Shared with GeographicSection so the KPI band's "Countries Represented"
     card can scroll straight to the Accounts by Country chart. */
  const countryChartRef = useRef(null);
  const scrollToCountryChart = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        countryChartRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  };

  return (
    <>
      <div className="dashboard-section">
        <DemographicsKpiBand
          membersByCountry={membersByCountry}
          accountsByType={accountsByType}
          totalDependents={totalDependents}
          completeness={completeness}
          extraSummaryLoading={extraSummaryLoading}
          openAccountDrawer={openAccountDrawer}
          scrollToCountryChart={scrollToCountryChart}
        />

        <AccountTypesSection
          accountsByType={accountsByType}
          openAccountDrawer={openAccountDrawer}
        />

        <AgeGenderMaritalSection
          membersByAgeGroup={membersByAgeGroup}
          membersByGender={membersByGender}
          membersByMaritalStatus={membersByMaritalStatus}
        />

        <MemberGrowthSection
          membersByStatus={membersByStatus}
          newMembersPerYear={newMembersPerYear}
          openAccountDrawer={openAccountDrawer}
          visitorChartFilter={visitorChartFilter}
          setVisitorChartFilter={setVisitorChartFilter}
          visitorYearsAvailable={visitorYearsAvailable}
          visitorChartData={visitorChartData}
          visitorChartLoading={visitorChartLoading}
          visitorChartSubtitle={visitorChartSubtitle}
          visitorAxisInterval={visitorAxisInterval}
        />

        <GeographicSection
          membersByState={membersByState}
          membersByCountry={membersByCountry}
          geoConcentration={geoConcentration}
          extraSummaryLoading={extraSummaryLoading}
          openAccountDrawer={openAccountDrawer}
          countryChartRef={countryChartRef}
        />

        <HouseholdSection
          dependentsByAgeGroup={dependentsByAgeGroup}
          dependentsPerHousehold={dependentsPerHousehold}
          dependentsPerMember={dependentsPerMember}
          householdSummary={householdSummary}
          extraSummaryLoading={extraSummaryLoading}
          openAccountDrawer={openAccountDrawer}
        />
      </div>

      {/* State-account drawer */}
      <StateAccountsModal
        isOpen={Boolean(accountDrawer)}
        state={accountDrawer?.state ?? null}
        title={accountDrawer?.title ?? ""}
        eyebrow={accountDrawer?.eyebrow ?? "Account details"}
        emptyMessage={accountDrawer?.emptyMessage ?? ""}
        exportKey={accountDrawer?.exportKey ?? "accounts"}
        accounts={accountDetails}
        loading={accountDetailsLoading}
        error={accountDetailsError}
        onClose={closeAccountDrawer}
        dateFilter={drawerDateFilter}
        onDateFilterChange={handleDrawerDateChange}
        years={years}
        months={MONTHS}
        showDateFilter={accountDrawer?.showDateFilter !== false}
      />
    </>
  );
}
