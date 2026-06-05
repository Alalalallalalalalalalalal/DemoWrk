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

export const analyticsApi = {
  // Combined dashboard endpoint
  dashboardSummary: () => fetchData("/analytics/dashboard-summary"),

  // Combined ML endpoint
  mlInsights: () => fetchData("/analytics/ml/insights"),

  // Detail drill-downs
  seasonalVisitDetails: (season, limit = 50) =>
    fetchData(
      `/analytics/ml/seasonal-visit-details?season=${encodeURIComponent(
        season,
      )}&limit=${limit}`,
    ),

  // Season groups CRUD
  seasonGroups: () => fetchData("/analytics/ml/season-groups"),

  createSeasonGroup: (body) =>
    fetchData("/analytics/ml/season-groups", jsonRequest("POST", body)),

  updateSeason: (seasonId, body) =>
    fetchData(`/analytics/ml/seasons/${seasonId}`, jsonRequest("PATCH", body)),

  addSeason: (body) =>
    fetchData("/analytics/ml/seasons", jsonRequest("POST", body)),

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

  // Member segments
  memberSegments: () => fetchData("/analytics/ml/member-segments"),
};
