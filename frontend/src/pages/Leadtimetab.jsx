// frontend/src/pages/LeadTimeTab.jsx
//
// "Lead Time" tab — Booking Confirmed Date vs Arrival Date. Backed by
// postgres/analytics_lead_time.py, mounted at:
//   GET /analytics/lead-time/available-years
//   GET /analytics/lead-time/average
//   GET /analytics/lead-time/trends
//   GET /analytics/lead-time/full
//   GET /analytics/lead-time/export
//
// FILTER: All Time / a specific Year (populated from real data via
// leadTimeAvailableYears) / Custom Range — mirrors the All Time / Custom
// Range picker already used in GuestRevenueTab.jsx, with the Year option
// added since the backend accepts year directly and it's the filter this
// data set is most often sliced by (a single arrival season).
//
// THREE VIEWS, one filter:
//   Average — KPI cards (reservation count, avg/median/min/max lead time,
//             same-day bookings, calculation coverage) + a bucketed bar
//             chart (0-7 / 8-30 / 31-90 / 91+ days).
//   Trends  — monthly avg/median lead time as a line chart, with the same
//             numbers in a scrollable table underneath.
//   Full    — every reservation in scope, paginated server-side, with a
//             live search box (member #, conf code, guest name, room #,
//             status) and sortable-by-arrival ordering already applied
//             on the backend.
//
// EXPORT: hits /lead-time/export directly (full filtered CSV, not just
// the loaded page) rather than re-serializing whatever page of `full` is
// currently in memory — the backend does the same query, unpaginated.
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Download,
  RefreshCw,
  Clock,
  Search,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { analyticsApi } from "../api/analytics";

const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  accent: "var(--dashboard-deep-blue)",
  flame: "var(--dashboard-flame)",
};

const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 18,
};

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 800,
  fontFamily: "sans-serif",
  cursor: "pointer",
  border: "none",
};

const th = {
  padding: "10px 12px",
  background: C.panelAlt,
  color: C.textMid,
  fontWeight: 800,
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const td = {
  padding: "9px 12px",
  borderBottom: `1px solid ${C.border}`,
  color: C.textPrimary,
  fontSize: 13,
  whiteSpace: "nowrap",
};

const selectStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.textPrimary,
  fontSize: 12,
  fontFamily: "sans-serif",
};

const dateInputStyle = { ...selectStyle };

function days(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} d`;
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function pct(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function Metric({ label, value, hint }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 4,
        }}
      >
        <p
          style={{
            margin: 0,
            color: C.textMuted,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "sans-serif",
          }}
        >
          {label}
        </p>
        {hint && (
          <span
            title={hint}
            style={{
              display: "inline-flex",
              color: C.textMuted,
              cursor: "default",
            }}
          >
            <Info size={12} />
          </span>
        )}
      </div>
      <p
        style={{
          margin: 0,
          color: C.textPrimary,
          fontSize: 20,
          fontWeight: 900,
          fontFamily: "sans-serif",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary = false,
  disabled = false,
  as = "button",
  href,
}) {
  const style = {
    ...buttonBase,
    background: primary ? C.accent : C.bg,
    color: primary ? "white" : C.accent,
    border: `1px solid ${primary ? C.accent : C.border}`,
    opacity: disabled ? 0.55 : 1,
    pointerEvents: disabled ? "none" : "auto",
    textDecoration: "none",
  };
  if (as === "a") {
    return (
      <a href={href} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

/* ─── segmented view switch (Average / Trends / Full) ────────────────── */
function ViewSwitch({ view, onChange }) {
  const options = [
    ["average", "Average"],
    ["trends", "Trends"],
    ["full", "Full"],
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          style={{
            border: "none",
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 800,
            fontFamily: "sans-serif",
            cursor: "pointer",
            background: view === value ? C.accent : C.bg,
            color: view === value ? "white" : C.textMid,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── All Time / Year / Custom Range filter bar ───────────────────────── */
function PeriodPicker({
  mode,
  onModeChange,
  year,
  onYearChange,
  years,
  startDate,
  endDate,
  onStartDate,
  onEndDate,
  includeCancelled,
  onIncludeCancelled,
}) {
  const modeButton = (value, label) => (
    <button
      type="button"
      onClick={() => onModeChange(value)}
      style={{
        ...buttonBase,
        background: mode === value ? C.accent : C.bg,
        color: mode === value ? "white" : C.accent,
        border: `1px solid ${mode === value ? C.accent : C.border}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {modeButton("all", "All Time")}
      {modeButton("year", "Year")}
      {modeButton("custom", "Custom Range")}

      {mode === "year" && (
        <select
          value={year ?? ""}
          onChange={(e) => onYearChange(Number(e.target.value))}
          style={selectStyle}
        >
          {years.length === 0 && <option value="">No years found</option>}
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}

      {mode === "custom" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: C.textMid,
              fontFamily: "sans-serif",
            }}
          >
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDate(e.target.value)}
              style={dateInputStyle}
            />
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: C.textMid,
              fontFamily: "sans-serif",
            }}
          >
            To
            <input
              type="date"
              value={endDate}
              onChange={(e) => onEndDate(e.target.value)}
              style={dateInputStyle}
            />
          </label>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: C.textMid,
          fontFamily: "sans-serif",
          marginLeft: 4,
        }}
      >
        <input
          type="checkbox"
          checked={includeCancelled}
          onChange={(e) => onIncludeCancelled(e.target.checked)}
        />
        Include cancelled / no-shows
      </label>
    </div>
  );
}

/* ─── Average view ─────────────────────────────────────────────────── */
function AverageView({ data, loading }) {
  if (loading) {
    return (
      <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
        Loading averages…
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
        No data for the selected period.
      </div>
    );
  }

  const bucketData = [
    { bucket: "0–7 days", count: data.buckets["0-7"] },
    { bucket: "8–30 days", count: data.buckets["8-30"] },
    { bucket: "31–90 days", count: data.buckets["31-90"] },
    { bucket: "91+ days", count: data.buckets["91+"] },
  ];

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <Metric label="Reservations" value={number(data.reservationCount)} />
        <Metric
          label="Calculation Coverage"
          value={pct(data.calculationCoverage)}
          hint="Share of reservations with both a Created On timestamp and a computed lead time."
        />
        <Metric
          label="Average Lead Time"
          value={days(data.averageLeadTimeDays)}
        />
        <Metric
          label="Median Lead Time"
          value={days(data.medianLeadTimeDays)}
        />
        <Metric
          label="Shortest Lead Time"
          value={days(data.minimumLeadTimeDays)}
        />
        <Metric
          label="Longest Lead Time"
          value={days(data.maximumLeadTimeDays)}
        />
        <Metric
          label="Same-Day Bookings"
          value={number(data.sameDayBookings)}
        />
        <Metric
          label="Missing Created On"
          value={number(data.missingCreatedCount)}
          hint="Reservations arriving in this period whose booking-confirmed timestamp wasn't captured, so no lead time could be computed."
        />
      </div>

      <div style={card}>
        <h3
          style={{
            margin: "0 0 4px",
            color: C.textPrimary,
            fontSize: 15,
            fontWeight: 900,
            fontFamily: "sans-serif",
          }}
        >
          Reservations by Lead Time
        </h3>
        <p
          style={{
            margin: "0 0 14px",
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "sans-serif",
          }}
        >
          How far ahead guests booked, grouped into ranges.
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={bucketData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDD6CA" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v) => number(v)} />
            <Bar
              dataKey="count"
              name="Reservations"
              fill={C.accent}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/* ─── Trends view ──────────────────────────────────────────────────── */
function TrendsView({ rows, loading }) {
  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        period: r.label,
        Average: r.averageLeadTimeDays,
        Median: r.medianLeadTimeDays,
      })),
    [rows],
  );

  if (loading) {
    return (
      <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
        Loading trends…
      </div>
    );
  }

  return (
    <>
      <div style={{ ...card, marginBottom: 18 }}>
        <h3
          style={{
            margin: "0 0 4px",
            color: C.textPrimary,
            fontSize: 15,
            fontWeight: 900,
            fontFamily: "sans-serif",
          }}
        >
          Lead Time by Arrival Month
        </h3>
        <p
          style={{
            margin: "0 0 14px",
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "sans-serif",
          }}
        >
          Average and median days between booking and arrival, grouped by the
          month guests arrived.
        </p>
        {chartData.length === 0 ? (
          <p style={{ color: C.textMuted, fontFamily: "sans-serif" }}>
            No data for the selected period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDD6CA" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}d`} />
              <Tooltip formatter={(v) => days(v)} />
              <Legend />
              <Line
                type="monotone"
                dataKey="Average"
                stroke={C.accent}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="Median"
                stroke={C.flame}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "50vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Period",
                  "Reservations",
                  "Avg Lead Time",
                  "Median Lead Time",
                  "Min",
                  "Max",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{ ...td, textAlign: "center", padding: 34 }}
                  >
                    No rows for the selected period.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.year}-${r.monthNum}`}>
                    <td style={{ ...td, fontWeight: 800 }}>{r.label}</td>
                    <td style={td}>{number(r.reservationCount)}</td>
                    <td style={td}>{days(r.averageLeadTimeDays)}</td>
                    <td style={td}>{days(r.medianLeadTimeDays)}</td>
                    <td style={td}>{days(r.minimumLeadTimeDays)}</td>
                    <td style={td}>{days(r.maximumLeadTimeDays)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─── Full view (paginated + searched reservation table) ─────────────── */
function FullView({ params }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState({
    items: [],
    totalItems: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, params]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    analyticsApi
      .leadTimeFull(
        {
          ...params,
          search: debouncedSearch || undefined,
          page,
          page_size: pageSize,
        },
        { signal: controller.signal },
      )
      .then((data) => setPageData(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err.message || "Failed to load reservations.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, debouncedSearch, page]);

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${C.border}`,
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            margin: 0,
            color: C.textMuted,
            fontSize: 12,
            fontFamily: "sans-serif",
          }}
        >
          {number(pageData.totalItems)} reservation
          {pageData.totalItems === 1 ? "" : "s"} in this period
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "6px 10px",
            background: C.panelAlt,
          }}
        >
          <Search size={13} color={C.textMuted} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member #, conf. code, guest, room, status"
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              color: C.textPrimary,
              fontSize: 12,
              width: 260,
              fontFamily: "sans-serif",
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            margin: 16,
            color: "#9f2f2f",
            background: "rgba(196,91,91,0.08)",
            padding: 12,
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ overflow: "auto", maxHeight: "56vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                "Member #",
                "Conf. Code",
                "Guest",
                "Room #",
                "Booked On",
                "Check-In",
                "Check-Out",
                "Lead Time",
                "Status",
              ].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={9}
                  style={{ ...td, textAlign: "center", padding: 30 }}
                >
                  Loading…
                </td>
              </tr>
            ) : pageData.items.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{ ...td, textAlign: "center", padding: 30 }}
                >
                  No reservations found.
                </td>
              </tr>
            ) : (
              pageData.items.map((r) => (
                <tr key={r.confirmationCode + r.checkInDate}>
                  <td style={td}>{r.memberNumber || "—"}</td>
                  <td style={{ ...td, fontWeight: 800 }}>
                    {r.confirmationCode}
                  </td>
                  <td style={td}>{r.guestName || "—"}</td>
                  <td style={td}>{r.roomNumber || "—"}</td>
                  <td style={td}>{formatDateTime(r.createdOn)}</td>
                  <td style={td}>{formatDate(r.checkInDate)}</td>
                  <td style={td}>{formatDate(r.checkOutDate)}</td>
                  <td style={td}>
                    {r.leadTimeDays != null ? days(r.leadTimeDays) : "—"}
                  </td>
                  <td style={td}>{r.reservationStatus || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{ fontSize: 12, color: C.textMuted, fontFamily: "sans-serif" }}
        >
          Page {pageData.page || page} of {pageData.totalPages || 1}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionButton
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft size={13} /> Prev
          </ActionButton>
          <ActionButton
            onClick={() =>
              setPage((p) => Math.min(pageData.totalPages || 1, p + 1))
            }
            disabled={page >= (pageData.totalPages || 1)}
          >
            Next <ChevronRight size={13} />
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/* ─── Main tab ─────────────────────────────────────────────────────── */
export default function Leadtimetab() {
  const [mode, setMode] = useState("all"); // "all" | "year" | "custom"
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);

  const [view, setView] = useState("average"); // "average" | "trends" | "full"

  const [average, setAverage] = useState(null);
  const [trendRows, setTrendRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    analyticsApi
      .leadTimeAvailableYears()
      .then((ys) => {
        const list = Array.isArray(ys) ? ys : [];
        setYears(list);
        setYear((prev) => prev ?? list[0] ?? new Date().getFullYear());
      })
      .catch(console.error);
  }, []);

  // Custom range with only one date filled in isn't ready to fetch yet —
  // that's an incomplete selection, not an error.
  const params = useMemo(() => {
    const base = { include_cancelled: includeCancelled };
    if (mode === "all") return base;
    if (mode === "year") return year ? { ...base, year } : null;
    if (startDate && endDate)
      return { ...base, start_date: startDate, end_date: endDate };
    return null;
  }, [mode, year, startDate, endDate, includeCancelled]);

  const incompleteCustomRange = mode === "custom" && (!startDate || !endDate);

  const load = (p) => {
    setLoading(true);
    setError("");
    Promise.all([
      analyticsApi.leadTimeAverage(p),
      analyticsApi.leadTimeTrends(p),
    ])
      .then(([avg, trends]) => {
        setAverage(avg || null);
        setTrendRows(Array.isArray(trends) ? trends : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to load lead time data.");
        setAverage(null);
        setTrendRows([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (params === null) {
      setAverage(null);
      setTrendRows([]);
      setError("");
      setLoading(false);
      return;
    }
    const timeoutId = setTimeout(() => load(params), 350);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const exportHref = params ? analyticsApi.leadTimeExportUrl(params) : null;

  return (
    <div className="dashboard-section dashboard-section-sm">
      <div style={{ ...card, marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 6px",
                color: C.flame,
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "sans-serif",
              }}
            >
              <Clock
                size={13}
                style={{ verticalAlign: "-2px", marginRight: 6 }}
              />
              Lead Time
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 22,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              Booking Confirmed vs Arrival Date
            </h2>
            <p
              style={{
                margin: "6px 0 0",
                color: C.textMuted,
                fontSize: 12,
                fontFamily: "sans-serif",
                maxWidth: 640,
              }}
            >
              Lead time is the number of days between when a reservation was
              booked and when the guest arrives. Filtered by arrival date — a
              custom range or year covers reservations checking in during that
              window, regardless of when they were booked.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <ActionButton onClick={() => params && load(params)}>
              <RefreshCw size={13} /> Refresh
            </ActionButton>
            <ActionButton
              as="a"
              href={exportHref || undefined}
              primary
              disabled={!exportHref}
            >
              <Download size={13} /> Export CSV
            </ActionButton>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <PeriodPicker
            mode={mode}
            onModeChange={setMode}
            year={year}
            onYearChange={setYear}
            years={years}
            startDate={startDate}
            endDate={endDate}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            includeCancelled={includeCancelled}
            onIncludeCancelled={setIncludeCancelled}
          />
          <ViewSwitch view={view} onChange={setView} />
        </div>
      </div>

      {incompleteCustomRange && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: C.textMid,
            background: C.panelAlt,
          }}
        >
          <Info size={16} style={{ flexShrink: 0, color: C.accent }} />
          <span style={{ fontSize: 13, fontFamily: "sans-serif" }}>
            Select both a starting date and an end date to view this range.
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            color: "#9f2f2f",
            background: "rgba(196,91,91,0.08)",
          }}
        >
          {error}
        </div>
      )}

      {incompleteCustomRange ? null : view === "full" ? (
        <FullView params={params} />
      ) : view === "trends" ? (
        <TrendsView rows={trendRows} loading={loading} />
      ) : (
        <AverageView data={average} loading={loading} />
      )}
    </div>
  );
}
