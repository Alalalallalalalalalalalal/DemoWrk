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

export const analyticsApi = {
  // Combined dashboard endpoint
  dashboardSummary: () => fetchData("/analytics/dashboard-summary"),

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
  // Inside the analyticsApi object, add alongside memberSegments:
  getSegmentConfig: () => fetchData("/analytics/ml/segment-config"),
  updateSegmentConfig: (payload) =>
    fetchData("/analytics/ml/segment-config", jsonRequest("PATCH", payload)),

  visitsRoomsDashboard: (params = {}) =>
    fetchData(withQuery("/analytics/visits-rooms-dashboard", params)),

  // frontend/src/api/analytics.js
  villaMonthly: (villa, params = {}) =>
    fetchData(withQuery("/analytics/villa-monthly", { villa, ...params })),
  villaBookings: (villaName, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-bookings", { villa: villaName, ...params }),
    ),

  bedroomBookings: (beds, params = {}) =>
    fetchData(withQuery("/analytics/bedroom-bookings", { beds, ...params })),

  bookedPeople: (kind, params = {}) =>
    fetchData(withQuery("/analytics/booked-people", { kind, ...params })),

  // Villa × business source
  villaSourceBreakdown: (params = {}) =>
    fetchData(withQuery("/analytics/villa-source-breakdown", params)),

  villaSourceBookings: (villa, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-source-bookings", { villa, ...params }),
    ),

  villaSources: (villa = null, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-sources", {
        ...(villa ? { villa } : {}),
        ...params,
      }),
    ),

  villaSourceBedroomBreakdown: (params = {}) =>
    fetchData(withQuery("/analytics/villa-source-bedroom-breakdown", params)),

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
};
