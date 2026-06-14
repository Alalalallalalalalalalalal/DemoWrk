// frontend/src/pages/finance/FinanceTables.jsx
// Contains MemberGuestRevenueTable and VillaRevenueTable

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

const money = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

const MEMBER_COLORS = { Member: "var(--dashboard-deep-blue)", Guest: "var(--dashboard-flame)" };

const baseTh = {
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

const baseTd = {
  padding: "11px 14px",
  borderBottom: `1px solid var(--dashboard-row-border)`,
  color: C.text,
  fontSize: 13,
  verticalAlign: "middle",
  fontFamily: "sans-serif",
};

// ════════════════════════════════════════════════════════
// MemberGuestRevenueTable
// ════════════════════════════════════════════════════════
export function MemberGuestRevenueTable({ data, onRowClick }) {
  const total = (data ?? []).reduce((s, r) => s + (r.revenue ?? 0), 0);

  return (
    <div className="dashboard-card">
      <div className="dashboard-eyebrow">Customer Type</div>
      <h2 className="dashboard-card-title">Member vs Guest revenue</h2>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={baseTh}>Customer Type</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Revenue</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Share</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Transactions</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Unique Accounts</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...baseTd, textAlign: "center", color: C.muted, padding: 32 }}>
                  No data
                </td>
              </tr>
            ) : (
              (data ?? []).map((row, i) => {
                const share = total ? ((row.revenue ?? 0) / total) * 100 : 0;
                const color = MEMBER_COLORS[row.customerType] ?? C.accent;
                return (
                  <tr
                    key={row.customerType}
                    onClick={() => onRowClick({ drillType: "customer", drillValue: row.customerType })}
                    style={{ cursor: "pointer", background: i % 2 === 0 ? "transparent" : C.panel }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.panel)
                    }
                  >
                    <td style={baseTd}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 10, height: 10, borderRadius: 3,
                            background: color, flexShrink: 0, display: "inline-block",
                          }}
                        />
                        <span style={{ fontWeight: 700 }}>{row.customerType}</span>
                      </div>
                      <div style={{ marginTop: 6, height: 4, background: C.border, borderRadius: 2 }}>
                        <div
                          style={{
                            width: `${share.toFixed(1)}%`, height: "100%",
                            background: color, borderRadius: 2,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", fontWeight: 700, color: C.accent, fontSize: 15 }}>
                      {money(row.revenue)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {share.toFixed(1)}%
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {fmt(row.transactions)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.muted }}>
                      {fmt(row.uniqueAccounts)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════
// VillaRevenueTable
// ════════════════════════════════════════════════════════
export function VillaRevenueTable({ data, onRowClick }) {
  const maxRevenue = Math.max(...(data ?? []).map((r) => r.revenue ?? 0), 1);

  return (
    <div className="dashboard-card">
      <div className="dashboard-eyebrow">Accommodation</div>
      <h2 className="dashboard-card-title">Villa revenue breakdown</h2>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={baseTh}>Villa</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Revenue</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Bookings</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Room Nights</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Avg Stay</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Member</th>
              <th style={{ ...baseTh, textAlign: "right" }}>Guest</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...baseTd, textAlign: "center", color: C.muted, padding: 32 }}>
                  No data
                </td>
              </tr>
            ) : (
              (data ?? []).map((row, i) => {
                const barW = ((row.revenue ?? 0) / maxRevenue) * 100;
                return (
                  <tr
                    key={row.villaName}
                    onClick={() => onRowClick({ drillType: "villa", drillValue: row.villaName })}
                    style={{ cursor: "pointer", background: i % 2 === 0 ? "transparent" : C.panel }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.panel)
                    }
                  >
                    <td style={baseTd}>
                      <div style={{ fontWeight: 600 }}>{row.villaName}</div>
                      <div style={{ marginTop: 5, height: 3, background: C.border, borderRadius: 2 }}>
                        <div
                          style={{
                            width: `${barW.toFixed(1)}%`, height: "100%",
                            background: C.accent2, borderRadius: 2,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", fontWeight: 700, color: C.accent }}>
                      {money(row.revenue)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {fmt(row.totalBookings)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {fmt(row.roomNights)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.muted }}>
                      {row.avgStay ? `${Number(row.avgStay).toFixed(1)}n` : "—"}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {fmt(row.memberBookings)}
                    </td>
                    <td style={{ ...baseTd, textAlign: "right", color: C.soft }}>
                      {fmt(row.guestBookings)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
