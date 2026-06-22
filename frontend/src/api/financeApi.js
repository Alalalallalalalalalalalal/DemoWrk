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
//
// DRILLDOWN FILTERS
// ──────────────────
// drilldown() and drilldownBreakdown() both accept a `filters` object
// with any combination of: { source, villa, customer, payment, amenity,
// category, section }. Every key that's set is AND'ed together on the
// backend (see _apply_common_filters in finance_backend.py), so the
// drawer can keep merging new dimensions into the same object as the
// user drills deeper instead of replacing the previous filter.
//
// drilldown() also still accepts the original 2-arg call style —
// drilldown(type, value, params) — for any caller that hasn't moved to
// the structured { filters } shape yet.
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

  // ── Flat folio-record drilldown ──────────────────────────────────
  // Two call styles supported:
  //
  //   1. Legacy:  drilldown("villa", "Solaria Villa", periodParams)
  //
  //   2. Structured (preferred — supports stacked filters):
  //      drilldown({
  //        filters: { payment: "free", villa: "Solaria Villa" },
  //        ...periodToParams(period),
  //      })
  //
  // limit used to be a positional 3rd arg (default 200) — for the
  // structured call style it can be passed inside the first argument
  // instead (e.g. { filters, limit: 500, ...periodParams }).
  drilldown: (typeOrOptions, value, params = {}) => {
    let query;
    if (typeof typeOrOptions === "string") {
      query = { type: typeOrOptions, value, limit: 200, ...params };
    } else {
      const { filters = {}, limit = 200, ...rest } = typeOrOptions || {};
      query = { ...filters, limit, ...rest };
    }
    return fetchData(withQuery("/finance/drilldown", query));
  },

  // ── Grouped breakdown for a dimension, scoped by every other active
  // filter — e.g. drilldownBreakdown({ groupBy: "villa", filters: {
  // payment: "free" }, ...periodToParams(period) }) returns
  // free-of-charge revenue PER VILLA, not each villa's all-time total.
  drilldownBreakdown: ({ groupBy, filters = {}, limit, ...periodParams }) =>
    fetchData(
      withQuery("/finance/drilldown-breakdown", {
        group_by: groupBy,
        ...filters,
        ...(limit ? { limit } : {}),
        ...periodParams,
      }),
    ),
};
