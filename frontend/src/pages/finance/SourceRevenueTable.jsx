// frontend/src/pages/finance/SourceRevenueTable.jsx

import { useState } from "react";

const C = {
  bg:      "var(--dashboard-card)",
  panel:   "var(--dashboard-panel)",
  panelAlt:"var(--dashboard-panel-alt)",
  border:  "var(--dashboard-border)",
  text:    "var(--dashboard-abyssal)",
  muted:   "var(--dashboard-muted)",
  soft:    "var(--dashboard-text-soft)",
  accent:  "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
};

const FREE_TYPES = new Set(["HA","HF","CU","HC","HR","CM","CO"]);

const money = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

const th = {
  padding: "10px 14px",
  background: C.panelAlt,
  color: C.soft,
  fontWeight: 700,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
  textAlign: "left",
  fontFamily: "sans-serif",
};

const td = {
  padding: "11px 14px",
  borderBottom: `1px solid var(--dashboard-row-border)`,
  color: C.text,
  fontSize: 13,
  verticalAlign: "middle",
  fontFamily: "sans-serif",
};

function TypeBadge({ type }) {
  const isPaid = type && !FREE_TYPES.has(type.toUpperCase());
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: isPaid
          ? "color-mix(in srgb, #2D8A5F 12%, transparent)"
          : "color-mix(in srgb, #D98C2B 12%, transparent)",
        color: isPaid ? "#2D8A5F" : "#D98C2B",
        border: `1px solid ${isPaid
          ? "color-mix(in srgb, #2D8A5F 30%, transparent)"
          : "color-mix(in srgb, #D98C2B 30%, transparent)"}`,
        fontFamily: "sans-serif",
      }}
    >
      {isPaid ? "Paid" : "Comp"}
    </span>
  );
}

export default function SourceRevenueTable({ data, onRowClick }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All"); // All | Paid | Comp

  const filtered = (data ?? []).filter((row) => {
    const isPaid = !FREE_TYPES.has((row.paymentType ?? "").toUpperCase());
    if (filter === "Paid" && !isPaid) return false;
    if (filter === "Comp" && isPaid) return false;
    if (search) {
      const q = search.toLowerCase();
      return (row.source ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const totals = filtered.reduce(
    (acc, r) => ({ revenue: acc.revenue + (r.revenue ?? 0), transactions: acc.transactions + (r.transactions ?? 0) }),
    { revenue: 0, transactions: 0 },
  );

  return (
    <div className="dashboard-card">
      <div className="dashboard-eyebrow">Revenue by Source</div>
      <h2 className="dashboard-card-title">Booking source breakdown</h2>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search source…"
          style={{
            padding: "7px 11px",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12,
            background: C.bg,
            color: C.text,
            outline: "none",
            width: 200,
            fontFamily: "sans-serif",
          }}
        />

        {/* Paid / Comp toggle */}
        <div style={{ display: "flex", gap: 4, background: C.panelAlt, borderRadius: 8, padding: 3 }}>
          {["All", "Paid", "Comp"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                background: filter === f ? C.accent : "transparent",
                color: filter === f ? "#fff" : C.soft,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "sans-serif",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginLeft: "auto" }}>
          {filtered.length} sources · {money(totals.revenue)} · {fmt(totals.transactions)} txn
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Source</th>
              <th style={th}>Type</th>
              <th style={{ ...th, textAlign: "right" }}>Revenue</th>
              <th style={{ ...th, textAlign: "right" }}>Transactions</th>
              <th style={{ ...th, textAlign: "right" }}>Avg / Txn</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: "center", color: C.muted, padding: 32 }}>
                  No data
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={row.source}
                  onClick={() => onRowClick({ drillType: "source", drillValue: row.source })}
                  style={{
                    cursor: "pointer",
                    background: i % 2 === 0 ? "transparent" : C.panel,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.panel)}
                >
                  <td style={{ ...td, fontWeight: 600 }}>{row.source}</td>
                  <td style={td}><TypeBadge type={row.paymentType} /></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: C.accent }}>
                    {money(row.revenue)}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: C.soft }}>
                    {fmt(row.transactions)}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: C.muted }}>
                    {row.transactions ? money((row.revenue ?? 0) / row.transactions) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {/* Totals footer */}
          {filtered.length > 1 && (
            <tfoot>
              <tr style={{ background: C.panelAlt }}>
                <td colSpan={2} style={{ ...td, fontWeight: 700, fontSize: 11, color: C.soft }}>
                  TOTAL
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 800, color: C.accent, fontSize: 14 }}>
                  {money(totals.revenue)}
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: C.soft }}>
                  {fmt(totals.transactions)}
                </td>
                <td style={td} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
