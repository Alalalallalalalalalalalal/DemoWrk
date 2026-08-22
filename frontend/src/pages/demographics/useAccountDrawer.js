import { useMemo, useState } from "react";

import { MONTHS } from "./DemographicsShared";

const toDateParams = (filter) => {
  if (filter.mode === "day") {
    return filter.date ? { date: filter.date } : {};
  }

  if (filter.mode === "range") {
    return filter.startDate && filter.endDate
      ? {
          start_date: filter.startDate,
          end_date: filter.endDate,
        }
      : {};
  }

  return {
    year: filter.year === "All" ? null : Number(filter.year),
    month: filter.month === "All" ? null : MONTHS.indexOf(filter.month),
  };
};

const DEFAULT_DRAWER_DATE_FILTER = {
  mode: "ym",
  year: "All",
  month: "All",
  date: "",
  startDate: "",
  endDate: "",
};

/* State-drawer open/fetch logic shared by every account-type drilldown
   (state map, country chart, account types, status, household, etc). */
export default function useAccountDrawer() {
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const years = useMemo(() => {
    return [
      "All",
      ...Array.from(
        { length: currentYear - 2018 + 1 },
        (_, index) => currentYear - index,
      ),
    ];
  }, [currentYear]);

  const [drawerDateFilter, setDrawerDateFilter] = useState(
    DEFAULT_DRAWER_DATE_FILTER,
  );

  const [accountDrawer, setAccountDrawer] = useState(null);
  const [accountDetails, setAccountDetails] = useState([]);
  const [accountDetailsLoading, setAccountDetailsLoading] = useState(false);
  const [accountDetailsError, setAccountDetailsError] = useState("");

  const loadDrawerAccounts = async (drawer, dateParams = {}) => {
    if (!drawer?.request) return;

    setAccountDetails([]);
    setAccountDetailsError("");
    setAccountDetailsLoading(true);

    try {
      const data = await drawer.request(dateParams);

      setAccountDetails(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(`Unable to load ${drawer.title}:`, error);

      setAccountDetailsError(`${drawer.title} could not be loaded.`);
    } finally {
      setAccountDetailsLoading(false);
    }
  };

  const openAccountDrawer = ({
    title,
    eyebrow,
    emptyMessage,
    exportKey,
    state = null,
    request,
    showDateFilter = true,
  }) => {
    const drawer = {
      state,
      title,
      eyebrow,
      emptyMessage,
      exportKey,
      request,
      showDateFilter,
    };

    setAccountDrawer(drawer);
    setDrawerDateFilter(DEFAULT_DRAWER_DATE_FILTER);

    loadDrawerAccounts(drawer, {});
  };

  const handleDrawerDateChange = (nextFilter) => {
    setDrawerDateFilter(nextFilter);

    if (
      nextFilter.mode === "range" &&
      (!nextFilter.startDate || !nextFilter.endDate)
    ) {
      return;
    }

    if (nextFilter.mode === "day" && !nextFilter.date) {
      return;
    }

    loadDrawerAccounts(accountDrawer, toDateParams(nextFilter));
  };

  const closeAccountDrawer = () => {
    setAccountDrawer(null);
    setAccountDetails([]);
    setAccountDetailsError("");
    setAccountDetailsLoading(false);
  };

  return {
    years,
    drawerDateFilter,
    accountDrawer,
    accountDetails,
    accountDetailsLoading,
    accountDetailsError,
    openAccountDrawer,
    handleDrawerDateChange,
    closeAccountDrawer,
  };
}
