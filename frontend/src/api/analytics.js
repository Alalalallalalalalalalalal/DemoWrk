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

  getTableData: (table, limit = 100, offset = 0) =>
    fetchData(
      `/analytics/table/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`,
    ),

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

  villaStats: (params = {}) =>
    fetchData(withQuery("/analytics/villa-stats", params)),

  villaMonthly: (villaName, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-monthly", { villa: villaName, ...params }),
    ),

  bookingsByBedroom: (params = {}) =>
    fetchData(withQuery("/analytics/bookings-by-bedroom", params)),

  bedroomBookings: (beds, params = {}) =>
    fetchData(withQuery("/analytics/bedroom-bookings", { beds, ...params })),

  monthlyRevenue: (params = {}) =>
    fetchData(withQuery("/analytics/monthly-revenue", params)),

  villaBookings: (villaName, params = {}) =>
    fetchData(
      withQuery("/analytics/villa-bookings", { villa: villaName, ...params }),
    ),
  bookedPeople: (kind, params = {}) =>
    fetchData(withQuery("/analytics/booked-people", { kind, ...params })),
  visitsTabSummary: (params = {}) =>
    fetchData(withQuery("/analytics/visits-tab-summary", params)),
};
