// frontend/src/api/overviewApi.js
// ─────────────────────────────────────────────────────────────────
// OVERVIEW TAB — API calls
// All calls hit /overview/... to match the backend router prefix
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
    // [overview] Villa revenue — filterable by villa_payment_type
    villaRevenue: (villa_payment_type) =>
        get("/villa-revenue", { villa_payment_type }),

    // [overview] Monthly revenue — filterable by villa_payment_type
    monthlyRevenue: (villa_payment_type) =>
        get("/monthly-revenue", { villa_payment_type }),

    // [overview] Bedroom bookings — filterable by villa_payment_type
    bedroomBookings: (villa_payment_type) =>
        get("/bedroom-bookings", { villa_payment_type }),

    // [overview] Member vs guest revenue — filterable by villa_payment_type
    memberVsGuest: (villa_payment_type) =>
        get("/member-vs-guest", { villa_payment_type }),

    // [overview] 4-bucket stay classification summary
    stayCategories: () =>
        get("/stay-categories"),
};