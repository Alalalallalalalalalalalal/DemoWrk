// frontend/src/api/villaFeesApi.js
// API client for the Villa Fees tab, including the dues history endpoints.

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function fetchData(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(
            `Failed to fetch ${endpoint}: ${response.status} ${message}`,
        );
    }
    return response.json();
}

export const villaFeesApi = {
    // ── single-year villa fee overview (existing tab) ──
    years: () => fetchData("/analytics/villa-fees/years"),
    summary: (year) => fetchData(`/analytics/villa-fees/summary?year=${year}`),
    byVilla: (year) => fetchData(`/analytics/villa-fees/by-villa?year=${year}`),
    report: (year) => fetchData(`/analytics/villa-fees/report?year=${year}`),

    // ── dues history (all years) ──
    historyByYear: () => fetchData("/analytics/villa-fees/history-by-year"),
    historyBySize: () => fetchData("/analytics/villa-fees/history-by-size"),
    historyVillasPerYear: () =>
        fetchData("/analytics/villa-fees/history-villas-per-year"),
};