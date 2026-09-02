// frontend/src/api/analytics.js
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function fetchData(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch ${endpoint}: ${response.status} ${message}`,
    );
  }

  return response.json();
}

const jsonRequest = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const withQuery = (endpoint, params = {}) => {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${endpoint}?${queryString}` : endpoint;
};

// Small helper so every call can optionally take { signal } for cancellation
// without repeating the same ternary. Passing an empty object to fetch() is
// the same as passing nothing.
const withSignal = (options = {}) =>
  options.signal ? { signal: options.signal } : {};

export const analyticsApi = {
  // Combined dashboard endpoint
  dashboardSummary: () => fetchData("/analytics/dashboard-summary"),

  // ── Guest Revenue ────────────────────────────────────────────────
  guestRevenueNewVsRepeat: (params = {}) =>
    fetchData(withQuery("/analytics/guest-revenue/new-vs-repeat", params)),

  guestRevenueNewVsRepeatSummary: (params = {}) =>
    fetchData(
      withQuery("/analytics/guest-revenue/new-vs-repeat/summary", params),
    ),

  // Accounts behind one chart bar / trend-table cell — requires
  // params.guest_status ("New" or "Repeat") plus the same year/month or
  // start_date/end_date shape the two calls above use.
  guestRevenueAccounts: (params = {}) =>
    fetchData(
      withQuery("/analytics/guest-revenue/new-vs-repeat/accounts", params),
    ),

  // One guest's revenue-by-source breakdown for a given period (same
  // year/month params as guestRevenueAccounts, scoped to that one guest).
  guestRevenueAccountBreakdown: (memberNumber, params = {}) =>
    fetchData(
      withQuery(
        `/analytics/guest-revenue/new-vs-repeat/account/${encodeURIComponent(
          memberNumber,
        )}/breakdown`,
        params,
      ),
    ),

  // Demographics detail endpoints
  demographicsSummary: (params = {}) =>
    fetchData(withQuery("/analytics/demographics-summary", params)),

  stateAccounts: (stateCode, params = {}) =>
    fetchData(
      withQuery(
        `/analytics/state-accounts/${encodeURIComponent(stateCode)}`,
        params,
      ),
    ),

  accountCategoryDetails: (category, params = {}) =>
    fetchData(
      withQuery(
        `/analytics/account-category/${encodeURIComponent(category)}`,
        params,
      ),
    ),

  newVsRepeatVisitors: (params = {}) =>
    fetchData(withQuery("/analytics/new-vs-repeat-visitors", params)),

  newVsRepeatVisitorDetails: ({ visitorStatus, periodStart, periodEnd }) =>
    fetchData(
      withQuery("/analytics/new-vs-repeat-visitors/details", {
        visitor_status: visitorStatus,
        start_date: periodStart,
        end_date: periodEnd,
      }),
    ),

  demographicAccountDetails: ({ dimension, value, category, ...params }) => {
    const query = new URLSearchParams({
      dimension,
      value,
    });

    if (category) {
      query.set("category", category);
    }

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, value);
      }
    });

    return fetchData(
      `/analytics/demographics/account-details?${query.toString()}`,
    );
  },

  // Season endpoints
  seasonSummary: () => fetchData("/analytics/season-summary"),

  seasonMembers: (seasonId) =>
    fetchData(`/analytics/seasons/${seasonId}/members`),

  createSeasonGroup: (payload) =>
    fetchData("/analytics/season-groups", jsonRequest("POST", payload)),

  addSeason: (payload) =>
    fetchData("/analytics/seasons", jsonRequest("POST", payload)),

  updateSeason: (id, payload) =>
    fetchData(`/analytics/seasons/${id}`, jsonRequest("PATCH", payload)),

  deleteSeason: (id) =>
    fetchData(`/analytics/seasons/${id}`, jsonRequest("DELETE", {})),

  deleteSeasonGroup: (id) =>
    fetchData(`/analytics/season-groups/${id}`, jsonRequest("DELETE", {})),

  // Reports
  getTables: () => fetchData("/analytics/tables"),

  getTableData: (table) =>
    fetchData(`/analytics/table/${encodeURIComponent(table)}`),

  searchTable: (table, column, value) =>
    fetchData(
      `/analytics/table/${encodeURIComponent(
        table,
      )}/search?column=${encodeURIComponent(
        column,
      )}&value=${encodeURIComponent(value)}`,
    ),

  amenitySeasonInsights: (params = {}) =>
    fetchData(withQuery("/analytics/ml/amenity-season-insights", params)),

  // Member segments
  memberSegments: () => fetchData("/analytics/ml/member-segments"),
  getSegmentConfig: () => fetchData("/analytics/ml/segment-config"),
  updateSegmentConfig: (payload) =>
    fetchData("/analytics/ml/segment-config", jsonRequest("PATCH", payload)),

  // ── Visits & Rooms ────────────────────────────────────────────────
  //
  // As of the Aug 2026 perf work, this ONE call returns everything the
  // Visits & Rooms page needs on load:
  //   summary, villa_stats, bookings_by_bedroom, villa_paid_free_totals,
  //   monthly_revenue, villa_source_breakdown, villa_source_bedroom_breakdown
  //
  // It used to be three separate calls, and the backend rebuilt its whole
  // booking base for each one. Second arg takes { signal } so a superseded
  // request can be aborted instead of left in flight holding a DB
  // connection — same pattern overviewApi.summary() already uses.
  visitsRoomsDashboard: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/visits-rooms-dashboard", params),
      withSignal(options),
    ),

  villaMonthly: (villa, params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/villa-monthly", { villa, ...params }),
      withSignal(options),
    ),

  villaBookings: (villaName, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-bookings", { villa: villaName, ...params }),
    ),

  bedroomBookings: (beds, params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/bedroom-bookings", { beds, ...params }),
      withSignal(options),
    ),

  bookedPeople: (kind, params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/booked-people", { kind, ...params }),
      withSignal(options),
    ),

  // ── Villa × business source ───────────────────────────────────────
  //
  // KEEP THESE. The Visits page no longer calls villaSourceBreakdown or
  // villaSourceBedroomBreakdown on load (both datasets now arrive inside
  // visitsRoomsDashboard above), but the backend endpoints still exist and
  // removing these client methods breaks any other caller — and broke the
  // Visits page itself while it still referenced them.
  villaSourceBreakdown: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/villa-source-breakdown", params),
      withSignal(options),
    ),

  villaSourceBedroomBreakdown: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/villa-source-bedroom-breakdown", params),
      withSignal(options),
    ),

  // `limit` is optional — the drawer passes one, because a busy villa can
  // return thousands of rows each carrying a nested guests JSON blob.
  villaSourceBookings: (villa, params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/villa-source-bookings", { villa, ...params }),
      withSignal(options),
    ),

  villaSources: (villa = null, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-sources", {
        ...(villa ? { villa } : {}),
        ...params,
      }),
    ),

  // ── Marketing ─────────────────────────────────────────────────────
  marketingCampaigns: (includeInactive = false) =>
    fetchData(
      withQuery("/analytics/ml/marketing-campaigns", {
        include_inactive: includeInactive,
      }),
    ),

  marketingCampaignMembers: (campaignKey, limit = 5000) =>
    fetchData(
      withQuery(`/analytics/ml/marketing-campaigns/${campaignKey}/members`, {
        limit,
      }),
    ),

  createMarketingCampaign: (payload) =>
    fetchData(
      "/analytics/ml/marketing-campaigns",
      jsonRequest("POST", payload),
    ),

  updateMarketingCampaign: (campaignKey, payload) =>
    fetchData(
      `/analytics/ml/marketing-campaigns/${campaignKey}`,
      jsonRequest("PUT", payload),
    ),

  setMarketingCampaignStatus: (campaignKey, isActive) =>
    fetchData(
      `/analytics/ml/marketing-campaigns/${campaignKey}/status`,
      jsonRequest("PATCH", { is_active: isActive }),
    ),

  deleteMarketingCampaign: (campaignKey) =>
    fetchData(`/analytics/ml/marketing-campaigns/${campaignKey}`, {
      method: "DELETE",
    }),

  // ── Lead Time ─────────────────────────────────────────────────────
  //
  // Lead Time = Booking Confirmed Date (Created On) -> Arrival Date
  //
  // Supports:
  //   year
  //   month
  //   date
  //   start_date
  //   end_date
  //   include_cancelled
  //
  // Full/export also support:
  //   search
  //
  // Example:
  //   analyticsApi.leadTimeAverage({ year: 2026 })
  //
  //   analyticsApi.leadTimeTrends({
  //     start_date: "2026-01-01",
  //     end_date: "2026-08-31",
  //   })

  leadTimeAvailableYears: () =>
    fetchData("/analytics/lead-time/available-years"),

  leadTimeAverage: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/lead-time/average", params),
      withSignal(options),
    ),

  leadTimeTrends: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/lead-time/trends", params),
      withSignal(options),
    ),

  leadTimeFull: (params = {}, options = {}) =>
    fetchData(
      withQuery("/analytics/lead-time/full", params),
      withSignal(options),
    ),

  leadTimeExportUrl: (params = {}) =>
    `${API_BASE_URL}${withQuery("/analytics/lead-time/export", params)}`,
};
