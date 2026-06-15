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

/* ── Year / Month filter ─────────────────────────────────────────
   value:    { year: "All" | number, month: "All" | 1-12 }
   onChange: (next) => void
   years:    array of available years (numbers), e.g. [2026,2025,...]
*/
export function FinancePeriodFilter({ value, onChange, years }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        style={select}
        value={value.year}
        onChange={(e) =>
          onChange({ ...value, year: e.target.value === "All" ? "All" : Number(e.target.value) })
        }
      >
        <option value="All">All Years</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        style={select}
        value={value.month}
        onChange={(e) =>
          onChange({ ...value, month: e.target.value === "All" ? "All" : Number(e.target.value) })
        }
      >
        <option value="All">All Months</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      {(value.year !== "All" || value.month !== "All") && (
        <button
          type="button"
          onClick={() => onChange({ year: "All", month: "All" })}
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

/* Convert a {year, month} filter into API params */
export function periodToParams({ year, month }) {
  const params = {};
  if (year !== "All") params.year = year;
  if (month !== "All") params.month = month;
  return params;
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