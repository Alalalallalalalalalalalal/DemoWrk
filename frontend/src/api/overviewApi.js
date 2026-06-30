// frontend/src/api/overviewApi.js
// ─────────────────────────────────────────────────────────────────
// OVERVIEW TAB — API calls
// All calls hit /overview/... to match the backend router prefix
// (postgres/overview_analytics.py)
// ─────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function get(endpoint, params = {}, options = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") query.set(k, v);
    });
    const qs = query.toString();
    const url = `${API}/overview${endpoint}${qs ? "?" + qs : ""}`;
    const res = await fetch(url, options.signal ? { signal: options.signal } : undefined);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
}

export const overviewApi = {
    // [overview] Real distinct years that have actual booking check-ins
    // on file — powers the year dropdown in the period filter. Added
    // 2026-06-26 alongside the date-range filtering feature.
    // Backend route: GET /overview/available-years
    availableYears: () => get("/available-years"),

    // [overview] Villa AMENITY revenue (not villa rental — see
    // overview_analytics.py's docstring on this endpoint), ranked per
    // villa. Filterable by booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/villa-amenity-revenue
    // Query param the backend actually reads: overview_payment_type
    villaAmenityRevenue: (paymentType) =>
        get("/villa-amenity-revenue", { overview_payment_type: paymentType }),

    // [overview] Bookings grouped by bedroom count. Filterable by
    // booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/bookings-by-bedroom
    bookingsByBedroom: (paymentType) =>
        get("/bookings-by-bedroom", { overview_payment_type: paymentType }),

    // [overview] Booking-level villa rental revenue by month. Filterable
    // by booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/monthly-revenue
    monthlyRevenue: (paymentType) =>
        get("/monthly-revenue", { overview_payment_type: paymentType }),

    // [overview] TRANSACTION-level revenue by month, split Villa vs
    // Amenity. Filterable by booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/monthly-revenue-by-category
    monthlyRevenueByCategory: (paymentType) =>
        get("/monthly-revenue-by-category", { overview_payment_type: paymentType }),

    // [overview] Member vs guest revenue (booking-level villa rental
    // revenue only). Filterable by booking-level Paid/Free villa-stay
    // type.
    // Backend route: GET /overview/member-vs-guest-revenue
    memberVsGuestRevenue: (paymentType) =>
        get("/member-vs-guest-revenue", { overview_payment_type: paymentType }),

    // [overview] Per-villa booking stats (one row per villa + bedroom
    // count + payment type). Filterable by booking-level Paid/Free
    // villa-stay type.
    // Backend route: GET /overview/villa-stats
    villaStats: (paymentType) =>
        get("/villa-stats", { overview_payment_type: paymentType }),

    // [overview] TRANSACTION-level finance summary, grouped by category
    // (Villa/Amenity) x status (Paid/Free — Anomaly AND Reversed rows
    // excluded, see overview_analytics.py's docstring on this endpoint).
    // Filterable by booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/transaction-finance-summary
    transactionFinanceSummary: (paymentType) =>
        get("/transaction-finance-summary", { overview_payment_type: paymentType }),

    // [overview] Same shape as transactionMemberVsGuestRevenue (below),
    // but split by line_category (Villa/Amenity) too — powers the
    // stacked Villa/Amenity bar on "Member vs guest revenue", matching
    // the convention already used by "Revenue by month". Headline totals
    // (transactions/uniqueAccounts) still come from
    // transactionMemberVsGuestRevenue, not this one — see
    // overview_analytics.py's docstring on this endpoint for why.
    // Backend route: GET /overview/transaction-member-vs-guest-revenue-by-category
    transactionMemberVsGuestRevenueByCategory: (lineStatus) =>
        get("/transaction-member-vs-guest-revenue-by-category", { overview_line_status: lineStatus }),

    // [overview] Total $ + count of charges that were fully reversed in a
    // clean, mutually-unique charge+reversal pair within the same
    // booking — these are excluded from every other Paid/Free total on
    // the page (net cost to the guest was $0), so this is the one place
    // the gross reversed amount is still visible. Powers the "Reversed
    // charges" line on the Finance at a glance card.
    // Backend route: GET /overview/reversals-summary
    // No query params — this isn't filterable by payment type, since a
    // reversal pair's booking-level Paid/Free status doesn't change
    // whether the underlying charge+reversal happened.
    reversalsSummary: () => get("/reversals-summary"),

    // [overview] For FREE villa bookings only: total rack rate (full list
    // price) of nights given away, per villa — NOT money collected. Used
    // by "Top villas by revenue" to show a negative "value given away"
    // figure on the Villa rental revenue metric, for the Free-filtered
    // slice only. The frontend takes max(rack rate, actual revenue
    // collected) before negating, so the rare booking charged at or
    // above rack rate still shows its real dollar value instead of a
    // misleading rack-rate-only number — see OverviewTab.jsx.
    // Backend route: GET /overview/villa-rack-rate-free
    villaRackRateFree: () => get("/villa-rack-rate-free"),

    // [overview] Net total + count of cash advance lines (any line whose
    // description mentions "cash advance") — NOT product/service revenue,
    // so excluded from every Paid/Free/Amenity total elsewhere on the
    // page. Powers the "Cash advance" line on the Finance at a glance
    // card, the same pattern as reversalsSummary above.
    // Backend route: GET /overview/cash-advance-summary
    cashAdvanceSummary: () => get("/cash-advance-summary"),

    // [overview] Net total + count of 'Anomaly' lines (credits/refunds
    // that couldn't be matched cleanly enough to call Reversed) — already
    // excluded from every revenue total elsewhere; powers the
    // "Unexplained anomalies" line on Finance at a glance.
    // Backend route: GET /overview/anomalies-summary
    anomaliesSummary: () => get("/anomalies-summary"),

    // [overview] The individual Anomaly lines themselves, for a
    // reviewable table — see overview_analytics.py's docstring.
    // Backend route: GET /overview/anomalies
    anomalies: () => get("/anomalies"),

    // [overview] One bundled call that returns every dataset the
    // Overview tab needs in a single round trip — this is what
    // dashboard.jsx uses, rather than calling the individual endpoints
    // above one at a time. Pass year/month or start_date/end_date (e.g.
    // via FinanceShared's periodToParams()) to scope every date-aware
    // dataset to a period; omit for all-time, the original behavior.
    // Second arg accepts { signal } for request cancellation — see
    // dashboard.jsx's debounced overview-fetch effect for why this
    // matters (rapid filter changes piling up concurrent in-flight
    // requests was exhausting the DB connection pool).
    // Backend route: GET /overview/summary
    summary: (dateParams = {}, options = {}) => get("/summary", dateParams, options),

    // NOTE: there is no "/stay-categories" (4-bucket stay classification)
    // endpoint on the backend yet — removed rather than left pointing at
    // a route that doesn't exist. If this is still something you want,
    // it needs to be built as a new endpoint in overview_analytics.py
    // first; happy to help design it once you know what the 4 buckets
    // should be.
};