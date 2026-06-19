// frontend/src/api/overviewApi.js
// ─────────────────────────────────────────────────────────────────
// OVERVIEW TAB — API calls
// All calls hit /overview/... to match the backend router prefix
// (postgres/overview_analytics.py)
// ─────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function get(endpoint, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") query.set(k, v);
    });
    const qs = query.toString();
    const url = `${API}/overview${endpoint}${qs ? "?" + qs : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
}

export const overviewApi = {
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
    // (Villa/Amenity) x status (Paid/Free — Anomaly rows excluded).
    // Filterable by booking-level Paid/Free villa-stay type.
    // Backend route: GET /overview/transaction-finance-summary
    transactionFinanceSummary: (paymentType) =>
        get("/transaction-finance-summary", { overview_payment_type: paymentType }),

    // [overview] One bundled call that returns every dataset the
    // Overview tab needs in a single round trip — this is what
    // dashboard.jsx actually uses today, rather than calling the
    // individual endpoints above one at a time.
    // Backend route: GET /overview/summary
    summary: () => get("/summary"),

    // NOTE: there is no "/stay-categories" (4-bucket stay classification)
    // endpoint on the backend yet — removed rather than left pointing at
    // a route that doesn't exist. If this is still something you want,
    // it needs to be built as a new endpoint in overview_analytics.py
    // first; happy to help design it once you know what the 4 buckets
    // should be.
};