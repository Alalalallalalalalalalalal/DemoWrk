// frontend/src/pages/finance/FinanceShared.jsx
import { useState } from "react";
import { Info, X } from "lucide-react";

const C = {
  bg:      "var(--dashboard-card)",
  panelAlt:"var(--dashboard-panel-alt)",
  border:  "var(--dashboard-border)",
  text:    "var(--dashboard-abyssal)",
  muted:   "var(--dashboard-muted)",
  accent:  "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
};

const select = {
  padding: "7px 10px",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "sans-serif",
  background: C.bg,
  color: C.text,
  outline: "none",
  cursor: "pointer",
};

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

/* ── Period filter — shared default shape ────────────────────────
   mode: "all" | "yearMonth" | "range"
   year / month:        used when mode === "yearMonth" ("All" or number)
   startDate / endDate: used when mode === "range" ("YYYY-MM-DD" strings)
*/
export const DEFAULT_PERIOD = {
  mode: "all",
  year: "All",
  month: "All",
  startDate: "",
  endDate: "",
};

const MODE_OPTIONS = [
  { key: "all",       label: "All Time" },
  { key: "yearMonth",  label: "Year / Month" },
  { key: "range",      label: "Custom Range" },
];

function ModePill({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 3,
      }}
    >
      {MODE_OPTIONS.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              padding: "6px 11px",
              borderRadius: 7,
              border: "none",
              background: active ? C.accent : "transparent",
              color: active ? "#fff" : C.muted,
              fontWeight: active ? 700 : 500,
              fontSize: 11.5,
              cursor: "pointer",
              fontFamily: "sans-serif",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Period filter ────────────────────────────────────────────────
   value:    DEFAULT_PERIOD-shaped object
   onChange: (next) => void
   years:    array of available years (numbers), e.g. [2026,2025,...]
              — only used in "yearMonth" mode
*/
export function FinancePeriodFilter({ value, onChange, years }) {
  const period = value ?? DEFAULT_PERIOD;
  const mode = period.mode ?? "all";

  const setMode = (nextMode) => {
    if (nextMode === "all") {
      onChange({ ...DEFAULT_PERIOD });
    } else {
      onChange({ ...period, mode: nextMode });
    }
  };

  const isActive =
    (mode === "yearMonth" && (period.year !== "All" || period.month !== "All")) ||
    (mode === "range" && (period.startDate || period.endDate));

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <ModePill value={mode} onChange={setMode} />

      {mode === "yearMonth" && (
        <>
          <select
            style={select}
            value={period.year}
            onChange={(e) =>
              onChange({
                ...period,
                year: e.target.value === "All" ? "All" : Number(e.target.value),
              })
            }
          >
            <option value="All">All Years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            style={select}
            value={period.month}
            onChange={(e) =>
              onChange({
                ...period,
                month: e.target.value === "All" ? "All" : Number(e.target.value),
              })
            }
          >
            <option value="All">All Months</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </>
      )}

      {mode === "range" && (
        <>
          <input
            type="date"
            style={select}
            value={period.startDate ?? ""}
            max={period.endDate || undefined}
            onChange={(e) => onChange({ ...period, startDate: e.target.value })}
          />
          <span style={{ color: C.muted, fontSize: 12, fontFamily: "sans-serif" }}>to</span>
          <input
            type="date"
            style={select}
            value={period.endDate ?? ""}
            min={period.startDate || undefined}
            onChange={(e) => onChange({ ...period, endDate: e.target.value })}
          />
        </>
      )}

      {isActive && (
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_PERIOD })}
          style={{
            ...select,
            color: C.muted,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/* Convert a period object into API params for financeApi.* calls.
   Mirrors the backend's mutually-exclusive priority: a custom range wins
   over year/month, "all" sends nothing (matches pre-filter behavior). */
export function periodToParams(period) {
  if (!period) return {};
  const mode = period.mode ?? "all";

  if (mode === "range") {
    const params = {};
    if (period.startDate) params.start_date = period.startDate;
    if (period.endDate) params.end_date = period.endDate;
    return params;
  }

  if (mode === "yearMonth") {
    const params = {};
    if (period.year !== "All") params.year = period.year;
    if (period.month !== "All") params.month = period.month;
    return params;
  }

  return {};
}

/* ── Table info tooltip ──────────────────────────────────────────
   Small (i) button that pops a short description of the table —
   what it shows and how to interact with it.
*/
export function TableInfo({ title, description, tips = [] }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Table information"
        style={{
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: open ? C.accent2 : C.muted,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Info size={14} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: 280,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
              padding: "14px 16px",
              fontSize: 12,
              color: C.muted,
              lineHeight: 1.55,
              fontFamily: "sans-serif",
            }}
          >
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute", top: 8, right: 8,
                background: "none", border: "none", cursor: "pointer",
                color: C.muted, padding: 2, display: "flex",
              }}
            >
              <X size={13} />
            </button>
            <p style={{ margin: "0 0 8px", color: C.text, fontWeight: 700, paddingRight: 16 }}>
              {title}
            </p>
            <p style={{ margin: tips.length ? "0 0 10px" : 0 }}>{description}</p>
            {tips.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}