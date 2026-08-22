// frontend/src/pages/useDashboardData.js
//
// Extracted from Dashboard.jsx: the ~40-state/2-fetch data blob that gets
// fanned out as props to OverviewTab/DemographicsTab/VisitsRoomsTab/etc.
// Pure data-fetching + state — no tab-switching/orchestration state here
// (activeTab/activeSeasonGroup stay in Dashboard.jsx since they control
// which tab's JSX renders, not data passed down to a tab).

import { useEffect, useState } from "react";
import { analyticsApi } from "../api/analytics";
import { overviewApi } from "../api/overviewApi";
import { periodToParams, DEFAULT_PERIOD } from "./finance/FinanceShared";

export function useDashboardData() {
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
  const [internalTransfersSummary, setInternalTransfersSummary] = useState(null);
  const [paymentsSummary, setPaymentsSummary] = useState(null);
  const [paymentCorrectionsSummary, setPaymentCorrectionsSummary] = useState(null);
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
          setInternalTransfersSummary(data.overviewInternalTransfersSummary ?? null);
          setPaymentsSummary(data.overviewPaymentsSummary ?? null);
          setPaymentCorrectionsSummary(data.overviewPaymentCorrectionsSummary ?? null);
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

  return {
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
    leastUsedRoomTypes,

    spendByMonth,
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
  };
}
