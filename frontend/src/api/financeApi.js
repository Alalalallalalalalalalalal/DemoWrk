// frontend/src/api/financeApi.js
// ─────────────────────────────────────────────────────────────────
// Finance API — prefix matches your existing /analytics/... pattern.
// Backend router should use:  prefix="/finance"
//
// Every endpoint now accepts an optional params object supporting the
// shared backend date filter: { year, month, date, start_date, end_date }.
// Pass periodToParams(period) from FinanceShared.jsx straight through.
//
// NOTE: date / start_date / end_date must be 'YYYY-MM-DD' strings (or
// omitted) — don't pass raw JS Date objects, URLSearchParams.set() will
// stringify them with .toString() (e.g. "Sat Jun 20 2026 00:00:00 GMT...")
// which the backend's date parser won't accept.
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
  overview: (params = {}) => fetchData(withQuery("/finance/overview", params)),

  sourceBreakdown: (params = {}) =>
    fetchData(withQuery("/finance/source-breakdown", params)),

  memberVsGuest: (params = {}) =>
    fetchData(withQuery("/finance/member-vs-guest", params)),

  villaRevenue: (params = {}) =>
    fetchData(withQuery("/finance/villa-revenue", params)),

  amenityRevenue: (params = {}) =>
    fetchData(withQuery("/finance/amenity-revenue", params)),

  categoryCompBreakdown: (params = {}) =>
    fetchData(withQuery("/finance/category-comp-breakdown", params)),

  // params may include { limit, year, month, date, start_date, end_date }.
  // limit used to be a positional 3rd arg (default 200) — it's now nested
  // inside params instead. No current call site passes a bare number here.
  drilldown: (type, value, params = {}) =>
    fetchData(
      withQuery("/finance/drilldown", {
        type,
        value,
        limit: 200,
        ...params,
      }),
    ),
};
