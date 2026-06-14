// frontend/src/api/financeApi.js
// ─────────────────────────────────────────────────────────────────
// Finance API — prefix matches your existing /analytics/... pattern.
// Backend router should use:  prefix="/finance"
// ─────────────────────────────────────────────────────────────────

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

export const financeApi = {
  overview: () => fetchData("/finance/overview"),
  sourceBreakdown: () => fetchData("/finance/source-breakdown"),
  memberVsGuest: () => fetchData("/finance/member-vs-guest"),
  villaRevenue: () => fetchData("/finance/villa-revenue"),
  amenityRevenue: () => fetchData("/finance/amenity-revenue"),

  drilldown: (type, value, limit = 200) =>
    fetchData(withQuery("/finance/drilldown", { type, value, limit })),
};
