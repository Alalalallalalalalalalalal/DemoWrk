// frontend/src/pages/GuestRevenueTab.jsx
//
// "Guest Revenue" tab — New vs Repeat guest revenue, trends by month and
// summary averages, exportable to Excel. Backed by
// postgres/analytics_guest_revenue.py, mounted at:
//   GET /analytics/guest-revenue/new-vs-repeat
//   GET /analytics/guest-revenue/new-vs-repeat/summary
//   GET /analytics/guest-revenue/new-vs-repeat/accounts
//   GET /analytics/guest-revenue/new-vs-repeat/account/{member_number}/breakdown
//
// PERIOD FILTER: deliberately does NOT reuse FinancePeriodFilter (which
// offers year/month picking too) — this tab only offers "All Time" and
// "Custom Range" (start/end date), so it has its own small filter here
// instead of touching FinancePeriodFilter itself (that component is
// shared by Finance/Overview, which still need year/month).
//
// DRILLDOWN FLOW:
//   1. Click a bar in "Revenue by Month" (New or Repeat, for that month)
//      -> opens the Accounts drawer: every guest with a stay in that
//         exact bar's month + segment, sorted by revenue.
//   2. Click a guest row in that drawer
//      -> opens the Account Detail drawer on top: that guest's revenue
//         for the SAME period, broken down by source (Villa rental,
//         each amenity/service category). No line-item detail — source
//         totals only.
//   "Back to accounts" returns to step 1 without re-fetching.
//
// The existing monthly trend table's New Stays / Repeat Stays cells are
// ALSO clickable — same accounts drawer, same data, just a second entry
// point into the identical drilldown.
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Download, RefreshCw, TrendingUp, X, ArrowLeft, Info } from "lucide-react";
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
  shadow: "var(--dashboard-shadow-panel)",
  overlay: "var(--dashboard-overlay)",
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

const clickableTd = {
  ...td,
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationColor: "transparent",
};

const dateInputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.textPrimary,
  fontSize: 12,
  fontFamily: "sans-serif",
};

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function pct(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
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

function Metric({ label, value }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
      }}
    >
      <p
        style={{
          margin: "0 0 4px",
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
      <p
        style={{
          margin: 0,
          color: C.textPrimary,
          fontSize: 18,
          fontWeight: 900,
          fontFamily: "sans-serif",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ActionButton({ children, onClick, primary = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonBase,
        background: primary ? C.accent : C.bg,
        color: primary ? "white" : C.accent,
        border: `1px solid ${primary ? C.accent : C.border}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

/* ─── All Time / Custom Range period picker (this tab only) ──────────── */
function PeriodPicker({ mode, onModeChange, startDate, endDate, onStartDate, onEndDate }) {
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
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {modeButton("all", "All Time")}
      {modeButton("custom", "Custom Range")}
      {mode === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
    </div>
  );
}

/* ─── Account Detail drawer (guest's revenue-by-source breakdown) ────── */
function AccountDetailDrawer({ memberNumber, periodParams, periodLabel, onBack, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    analyticsApi
      .guestRevenueAccountBreakdown(memberNumber, periodParams)
      .then(setDetail)
      .catch((err) => setError(err.message || "Failed to load account breakdown."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberNumber]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1200,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(640px, 96vw)",
          height: "100%",
          background: C.bg,
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 22px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <button
              type="button"
              onClick={onBack}
              style={{
                ...buttonBase,
                background: "transparent",
                border: "none",
                padding: 0,
                marginBottom: 8,
                color: C.textMuted,
                fontSize: 11,
              }}
            >
              <ArrowLeft size={13} /> Back to accounts
            </button>
            <p
              style={{
                margin: "0 0 5px",
                color: C.textMuted,
                fontSize: 11,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "sans-serif",
              }}
            >
              {periodLabel}
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 20,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              {detail?.guestName || memberNumber}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                color: C.textMuted,
                fontSize: 12,
                fontFamily: "sans-serif",
              }}
            >
              Member #{memberNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textPrimary,
              borderRadius: 10,
              width: 36,
              height: 36,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
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

          {loading ? (
            <p style={{ color: C.textMuted, fontFamily: "sans-serif" }}>
              Loading breakdown…
            </p>
          ) : detail ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <Metric label="Total Revenue" value={money(detail.totalRevenue)} />
                <Metric label="Stays in Period" value={number(detail.stays)} />
              </div>

              <h3
                style={{
                  margin: "0 0 10px",
                  color: C.textPrimary,
                  fontSize: 14,
                  fontWeight: 900,
                  fontFamily: "sans-serif",
                }}
              >
                Revenue by Source
              </h3>
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Source</th>
                      <th style={th}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.byCategory || []).length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ ...td, textAlign: "center", padding: 24 }}>
                          No revenue found for this period.
                        </td>
                      </tr>
                    ) : (
                      detail.byCategory.map((c) => (
                        <tr key={c.category}>
                          <td style={{ ...td, fontWeight: 800 }}>{c.category}</td>
                          <td style={td}>{money(c.revenue)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/* ─── Accounts drawer (guests in one chart bar / table cell) ─────────── */
function AccountsDrawer({ bucket, periodParams, onClose }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMember, setSelectedMember] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    analyticsApi
      .guestRevenueAccounts({ ...periodParams, guest_status: bucket.guestStatus })
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message || "Failed to load accounts."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket.year, bucket.month, bucket.guestStatus]);

  const periodLabel = `${bucket.periodLabel} · ${bucket.guestStatus}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1100,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(760px, 96vw)",
          height: "100%",
          background: C.bg,
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 22px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                color: C.textMuted,
                fontSize: 11,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "sans-serif",
              }}
            >
              Guest Revenue
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 21,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              {periodLabel} Guests
            </h2>
            <p
              style={{
                margin: "6px 0 0",
                color: C.textMuted,
                fontSize: 12,
                fontFamily: "sans-serif",
              }}
            >
              Click a guest to see what their revenue came from.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textPrimary,
              borderRadius: 10,
              width: 36,
              height: 36,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
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

          {loading ? (
            <p style={{ color: C.textMuted, fontFamily: "sans-serif" }}>
              Loading accounts…
            </p>
          ) : (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Guest</th>
                    <th style={th}>Member #</th>
                    <th style={th}>Stays</th>
                    <th style={th}>Revenue</th>
                    <th style={th}>Last Check-In</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...td, textAlign: "center", padding: 30 }}>
                        No guests found for this period.
                      </td>
                    </tr>
                  ) : (
                    accounts.map((a) => (
                      <tr
                        key={a.memberNumber}
                        onClick={() => setSelectedMember(a.memberNumber)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ ...td, fontWeight: 800 }}>{a.guestName || "—"}</td>
                        <td style={td}>{a.memberNumber}</td>
                        <td style={td}>{number(a.stays)}</td>
                        <td style={td}>{money(a.totalRevenue)}</td>
                        <td style={td}>{formatDate(a.lastCheckIn)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>

      {selectedMember && (
        <AccountDetailDrawer
          memberNumber={selectedMember}
          periodParams={periodParams}
          periodLabel={periodLabel}
          onBack={() => setSelectedMember(null)}
          onClose={onClose}
        />
      )}
    </div>
  );
}

export default function GuestRevenueTab() {
  const [mode, setMode] = useState("all"); // "all" | "custom"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [trend, setTrend] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The bucket (year/month/guestStatus) whose accounts drawer is open —
  // null means closed. Set by clicking a chart bar OR a New/Repeat Stays
  // cell in the trend table below; both funnel into the same drawer.
  const [openBucket, setOpenBucket] = useState(null);

  // Custom range with only one of the two dates filled in is an
  // incomplete selection, not an error — nothing has actually gone
  // wrong yet, the user just isn't done picking. null means "not ready
  // to fetch"; {} or {start_date, end_date} means "ready."
  const currentParams = useMemo(() => {
    if (mode === "all") return {};
    if (startDate && endDate) return { start_date: startDate, end_date: endDate };
    return null;
  }, [mode, startDate, endDate]);

  const load = (params) => {
    setLoading(true);
    setError("");
    Promise.all([
      analyticsApi.guestRevenueNewVsRepeat(params),
      analyticsApi.guestRevenueNewVsRepeatSummary(params),
    ])
      .then(([trendData, summaryData]) => {
        setTrend(Array.isArray(trendData) ? trendData : []);
        setSummary(summaryData || null);
      })
      .catch((err) => {
        setError(err.message || "Failed to load guest revenue data.");
        setTrend([]);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentParams === null) {
      // Incomplete custom range — don't fetch, don't show stale data,
      // don't show an error either (see the info banner below instead).
      setTrend([]);
      setSummary(null);
      setError("");
      setLoading(false);
      return;
    }
    const timeoutId = setTimeout(() => load(currentParams), 400);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParams]);

  const chartData = useMemo(
    () =>
      trend.map((r) => ({
        period: r.periodLabel,
        year: r.year,
        month: r.month,
        "New Revenue": r.newRevenue,
        "Repeat Revenue": r.repeatRevenue,
      })),
    [trend],
  );

  const openAccountsFor = (year, month, periodLabel, guestStatus) => {
    setOpenBucket({ year, month, periodLabel, guestStatus });
  };

  const handleBarClick = (data, guestStatus) => {
    if (!data) return;
    openAccountsFor(data.year, data.month, data.period, guestStatus);
  };

  const exportToExcel = () => {
    if (!trend.length) return;
    const wb = XLSX.utils.book_new();

    const trendRows = trend.map((r) => ({
      Period: r.periodLabel,
      "New Revenue": r.newRevenue,
      "Repeat Revenue": r.repeatRevenue,
      "Total Revenue": r.totalRevenue,
      "New Stays": r.newStays,
      "Repeat Stays": r.repeatStays,
      "New Guests": r.newGuests,
      "Repeat Guests": r.repeatGuests,
      "Avg Revenue / New Stay": r.avgRevenuePerNewStay,
      "Avg Revenue / Repeat Stay": r.avgRevenuePerRepeatStay,
      "Repeat Revenue Share": r.repeatRevenueShare,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(trendRows),
      "Monthly Trend",
    );

    if (summary) {
      const summaryRows = Object.entries(summary).map(([key, value]) => ({
        Metric: key,
        Value: value,
      }));
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(summaryRows),
        "Summary",
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `new_vs_repeat_guest_revenue_${date}.xlsx`);
  };

  // periodParams passed down to the drawers: the SAME year/month as the
  // clicked bucket (not the tab's own top-level filter) — so accounts and
  // their breakdowns always scope to that one bar, regardless of whether
  // the top filter is currently "All Time" or a custom range.
  const bucketParams = openBucket
    ? { year: openBucket.year, month: openBucket.month }
    : null;

  const incompleteCustomRange = mode === "custom" && (!startDate || !endDate);

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
              <TrendingUp size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Guest Revenue
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
              New vs Repeat Guest Revenue
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
              A stay counts as "New" the first time that guest ever checked
              in; every later stay is "Repeat" — based on check-in date
              only, independent of the period filter below. Click a bar or
              a stay count below to see which guests are behind it.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <ActionButton onClick={() => currentParams && load(currentParams)}>
              <RefreshCw size={13} /> Refresh
            </ActionButton>
            <ActionButton primary disabled={!trend.length} onClick={exportToExcel}>
              <Download size={13} /> Export Excel
            </ActionButton>
          </div>
        </div>

        <PeriodPicker
          mode={mode}
          onModeChange={setMode}
          startDate={startDate}
          endDate={endDate}
          onStartDate={setStartDate}
          onEndDate={setEndDate}
        />
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

      {loading ? (
        <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
          Loading guest revenue…
        </div>
      ) : incompleteCustomRange ? null : (
        <>
          {summary && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 18,
              }}
            >
              <Metric label="New Revenue" value={money(summary.newRevenue)} />
              <Metric label="Repeat Revenue" value={money(summary.repeatRevenue)} />
              <Metric label="Total Revenue" value={money(summary.totalRevenue)} />
              <Metric label="Repeat Revenue Share" value={pct(summary.repeatRevenueShare)} />
              <Metric label="New Guests" value={number(summary.newGuests)} />
              <Metric label="Repeat Guests" value={number(summary.repeatGuests)} />
              <Metric
                label="Avg / New Stay"
                value={
                  summary.avgRevenuePerNewStay != null
                    ? money(summary.avgRevenuePerNewStay)
                    : "—"
                }
              />
              <Metric
                label="Avg / Repeat Stay"
                value={
                  summary.avgRevenuePerRepeatStay != null
                    ? money(summary.avgRevenuePerRepeatStay)
                    : "—"
                }
              />
            </div>
          )}

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
              Revenue by Month
            </h3>
            <p
              style={{
                margin: "0 0 14px",
                color: C.textMuted,
                fontSize: 11,
                fontFamily: "sans-serif",
              }}
            >
              Click a bar to see the guests behind it.
            </p>
            {chartData.length === 0 ? (
              <p style={{ color: C.textMuted, fontFamily: "sans-serif" }}>
                No data for the selected period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DDD6CA" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => money(v)} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Legend />
                  <Bar
                    dataKey="New Revenue"
                    fill={C.accent}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(data) => handleBarClick(data, "New")}
                  />
                  <Bar
                    dataKey="Repeat Revenue"
                    fill={C.flame}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(data) => handleBarClick(data, "Repeat")}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {/* Vertical scroll lives HERE, inside a fixed-height
                container, so a long trend table (e.g. the full "All
                Time" range back to Nov 2019) scrolls on its own instead
                of stretching the whole page. The header row's
                position:sticky (see `th` above) keeps column labels
                visible while scrolling within this container. */}
            <div style={{ overflow: "auto", maxHeight: "60vh" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[
                      "Period",
                      "New Revenue",
                      "Repeat Revenue",
                      "Total",
                      "New Stays",
                      "Repeat Stays",
                      "Avg / New",
                      "Avg / Repeat",
                      "Repeat Share",
                    ].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trend.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ ...td, textAlign: "center", padding: 34 }}>
                        No rows for the selected period.
                      </td>
                    </tr>
                  ) : (
                    trend.map((r) => (
                      <tr key={`${r.year}-${r.month}`}>
                        <td style={{ ...td, fontWeight: 800 }}>{r.periodLabel}</td>
                        <td style={td}>{money(r.newRevenue)}</td>
                        <td style={td}>{money(r.repeatRevenue)}</td>
                        <td style={td}>{money(r.totalRevenue)}</td>
                        <td
                          style={clickableTd}
                          onClick={() =>
                            openAccountsFor(r.year, r.month, r.periodLabel, "New")
                          }
                          title="View New guests for this month"
                        >
                          {number(r.newStays)}
                        </td>
                        <td
                          style={clickableTd}
                          onClick={() =>
                            openAccountsFor(r.year, r.month, r.periodLabel, "Repeat")
                          }
                          title="View Repeat guests for this month"
                        >
                          {number(r.repeatStays)}
                        </td>
                        <td style={td}>
                          {r.avgRevenuePerNewStay != null ? money(r.avgRevenuePerNewStay) : "—"}
                        </td>
                        <td style={td}>
                          {r.avgRevenuePerRepeatStay != null
                            ? money(r.avgRevenuePerRepeatStay)
                            : "—"}
                        </td>
                        <td style={td}>{pct(r.repeatRevenueShare)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {openBucket && (
        <AccountsDrawer
          bucket={openBucket}
          periodParams={bucketParams}
          onClose={() => setOpenBucket(null)}
        />
      )}
    </div>
  );
}