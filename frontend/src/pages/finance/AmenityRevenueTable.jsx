// frontend/src/pages/finance/AmenityRevenueTable.jsx
// Row click  → drill into folio records (opens drawer)
// ▼/▲ button → expand/collapse season sub-rows (independent of drill)

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
};

const AMENITY_COLORS = {
  Spa:        "#7B5EA7",
  Golf:       "#2D8A5F",
  Grill:      "#C45B5B",
  Bar:        "#D98C2B",
  Restaurant: "var(--dashboard-truffle)",
  Tennis:     "var(--dashboard-flame)",
  Boutique:   "var(--dashboard-deep-blue)",
  Commissary: "#8A6F8F",
  Other:      "var(--dashboard-muted)",
};

const amenityColor = (name) => AMENITY_COLORS[name] ?? C.muted;

const money = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

const th = {
  padding: "10px 14px", background: C.panelAlt, color: C.soft,
  fontWeight: 700, fontSize: 10, textTransform: "uppercase",
  letterSpacing: "0.07em", borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 2,
  textAlign: "left", fontFamily: "sans-serif",
};
const td = {
  padding: "11px 14px",
  borderBottom: `1px solid var(--dashboard-row-border)`,
  color: C.text, fontSize: 13, verticalAlign: "top", fontFamily: "sans-serif",
};

export default function AmenityRevenueTable({ data, onRowClick }) {
  const [expanded, setExpanded] = useState(null);

  const maxRevenue = Math.max(...(data ?? []).map((r) => r.revenue ?? 0), 1);

  return (
    <div className="dashboard-card">
      <div className="dashboard-eyebrow">Amenities</div>
      <h2 className="dashboard-card-title">Amenity revenue &amp; season breakdown</h2>
      <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginBottom: 14, marginTop: -8 }}>
        Each row is one amenity category — spa, golf, F&amp;B, tennis, boutique, and others. Revenue is the
        total of all charges posted under that category in the selected period. Click a row to inspect the
        individual folio lines behind the figure. Use <strong>▼</strong> to compare performance across high,
        shoulder, and low season without leaving this view.
      </p>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Amenity</th>
              <th style={{ ...th, textAlign: "right" }}>Revenue</th>
              <th style={{ ...th, textAlign: "right" }}>Transactions</th>
              <th style={{ ...th, textAlign: "right" }}>Seasons</th>
              {/* expand button column — no header text */}
              <th style={{ ...th, width: 48, textAlign: "center" }} />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: "center", color: C.muted, padding: 32 }}>
                  No data
                </td>
              </tr>
            ) : (
              (data ?? []).map((row, i) => {
                const color     = amenityColor(row.amenity);
                const barW      = ((row.revenue ?? 0) / maxRevenue) * 100;
                const isOpen    = expanded === row.amenity;
                const hasSeasons = row.seasons?.length > 0;

                return (
                  <>
                    <tr
                      key={row.amenity}
                      style={{
                        cursor: "pointer",
                        background: i % 2 === 0 ? "transparent" : C.panel,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.panel)
                      }
                      // Row click → drill only, never expand
                      onClick={() => onRowClick({ drillType: "amenity", drillValue: row.amenity })}
                    >
                      {/* Amenity name + bar */}
                      <td style={{ ...td, borderBottom: isOpen ? "none" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 10, height: 10, borderRadius: 3,
                              background: color, flexShrink: 0, display: "inline-block",
                            }}
                          />
                          <span style={{ fontWeight: 600 }}>{row.amenity}</span>
                        </div>
                        <div style={{ marginTop: 6, height: 3, background: C.border, borderRadius: 2 }}>
                          <div
                            style={{
                              width: `${barW.toFixed(1)}%`, height: "100%",
                              background: color, borderRadius: 2,
                            }}
                          />
                        </div>
                      </td>

                      {/* Revenue */}
                      <td style={{
                        ...td, textAlign: "right", fontWeight: 700,
                        color: C.accent, borderBottom: isOpen ? "none" : undefined,
                      }}>
                        {money(row.revenue)}
                      </td>

                      {/* Transactions */}
                      <td style={{
                        ...td, textAlign: "right", color: C.soft,
                        borderBottom: isOpen ? "none" : undefined,
                      }}>
                        {fmt(row.transactions)}
                      </td>

                      {/* Season count */}
                      <td style={{
                        ...td, textAlign: "right", color: C.muted,
                        borderBottom: isOpen ? "none" : undefined,
                      }}>
                        {row.seasonCount ?? (hasSeasons ? row.seasons.length : "—")}
                      </td>

                      {/* Expand/collapse button — stopPropagation so it doesn't also drill */}
                      <td style={{
                        ...td, textAlign: "center",
                        borderBottom: isOpen ? "none" : undefined,
                        padding: "11px 8px",
                      }}>
                        {hasSeasons && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // prevent row drill-click
                              setExpanded(isOpen ? null : row.amenity);
                            }}
                            title={isOpen ? "Collapse seasons" : "Expand seasons"}
                            style={{
                              background: isOpen ? C.panelAlt : "transparent",
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              cursor: "pointer",
                              padding: "3px 8px",
                              fontSize: 11,
                              color: C.muted,
                              fontFamily: "sans-serif",
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                          >
                            {isOpen ? "▲" : "▼"}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Season sub-rows — shown when expanded, independent of drill */}
                    {isOpen && hasSeasons && (
                      <tr key={`${row.amenity}-seasons`}>
                        <td
                          colSpan={5}
                          style={{
                            padding: "0 14px 12px 48px",
                            background: C.panelAlt,
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr>
                                {["Season", "Revenue", "Transactions"].map((h, hi) => (
                                  <th
                                    key={h}
                                    style={{
                                      ...th, background: "transparent", padding: "7px 10px",
                                      textAlign: hi > 0 ? "right" : "left",
                                    }}
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {row.seasons.map((s) => (
                                <tr key={s.season}>
                                  <td style={{ ...td, padding: "7px 10px", fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                                    {s.season}
                                  </td>
                                  <td style={{
                                    ...td, padding: "7px 10px", textAlign: "right",
                                    fontWeight: 600, color: C.accent, fontSize: 12,
                                    borderBottom: `1px solid ${C.border}`,
                                  }}>
                                    {money(s.revenue)}
                                  </td>
                                  <td style={{
                                    ...td, padding: "7px 10px", textAlign: "right",
                                    color: C.muted, fontSize: 12,
                                    borderBottom: `1px solid ${C.border}`,
                                  }}>
                                    {fmt(s.transactions)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}