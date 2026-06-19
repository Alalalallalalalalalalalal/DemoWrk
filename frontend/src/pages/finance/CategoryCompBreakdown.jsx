// frontend/src/pages/finance/CategoryCompBreakdown.jsx
//
// Answers the question Lead actually wants answered: "for each spend
// category (Villa, F&B, Golf, Spa, etc.), how much did we actually collect
// vs. give away — and does that change if we isolate guests whose villa
// stay itself was comped from guests who paid for theirs?"
//
// TWO LAYERS, KEPT DELIBERATELY SEPARATE (do not collapse into one toggle):
//
//   villaPaymentType  -> booking-level INTENT. Was the whole stay comped
//   at the time it was booked (source = Complimentary, owner comp, etc.)?
//   This is the one filter below ("Villa stay type"). A comped villa stay
//   where the guest still drops real money on golf/spa/F&B is a working
//   loss-leader, not lost revenue — this filter is what lets you isolate
//   that story from "are we discounting too much."
//
//   bucket            -> line-item OUTCOME. For one specific charge, did
//   it actually collect money (collected), was it entered as a giveaway
//   up front (given_away), or was it reversed/written off after the fact
//   (reversed)? These three are always shown side by side as columns
//   instead of behind a second toggle — see the note in the chat reply
//   this file shipped with for why that reads better than a second filter.
//
// DATA CONTRACT expected from financeApi.categoryCompBreakdown():
//   [{ category, villaPaymentType, bucket, amount, transactions, uniqueAccounts }]
//   bucket is one of "collected" | "given_away" | "reversed"
//
// Drilldown: clicking a row calls onRowClick({ drillType: "category",
// drillValue: category }) — wire this straight into FinanceTab's existing
// openDrawer/RevenueBreakdownDrawer, exactly like SourceRevenueTable,
// AmenityRevenueTable, and FinanceTables already do. No new drawer needed.

import { useMemo, useState } from "react";
import { Info, X } from "lucide-react";

const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  rowBorder: "var(--dashboard-row-border)",
  text: "var(--dashboard-abyssal)",
  muted: "var(--dashboard-muted)",
  soft: "var(--dashboard-text-soft)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
  green: "#2D8A5F",
  red: "#C45B5B",
};

// Reuses the same category vocabulary as AmenityRevenueTable.jsx, extended
// to cover the non-amenity categories that show up in transaction_category
// (Villa, F&B, Adjustment, Reversal) since this table spans all of them.
const CATEGORY_COLORS = {
  Villa: "var(--dashboard-deep-blue)",
  "F&B": "var(--dashboard-truffle)",
  Golf: "#2D8A5F",
  Spa: "#7B5EA7",
  Tennis: "var(--dashboard-flame)",
  Boutique: "#D98C2B",
  Commissary: "#8A6F8F",
  Adjustment: "#C45B5B",
  Reversal: "#9A8E84",
  Other: "var(--dashboard-muted)",
};
const categoryColor = (name) => CATEGORY_COLORS[name] ?? C.muted;

const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const pct = (part, whole) =>
  !Number(whole)
    ? "—"
    : `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`;

const VILLA_STAY_OPTIONS = [
  { key: "overall", label: "Overall" },
  { key: "paid", label: "Paid Villa Stay" },
  { key: "free", label: "Free / Comp Villa Stay" },
];

function VillaStayToggle({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 4,
      }}
    >
      {VILLA_STAY_OPTIONS.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
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

function MiniSplitBar({ collected, givenAway }) {
  const total = Number(collected || 0) + Number(givenAway || 0);
  const collectedW = total ? (Number(collected || 0) / total) * 100 : 0;
  const givenW = total ? (Number(givenAway || 0) / total) * 100 : 0;
  return (
    <div
      style={{
        display: "flex",
        height: 7,
        borderRadius: 999,
        overflow: "hidden",
        background: C.bg,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ width: `${collectedW}%`, background: C.green }} />
      <div style={{ width: `${givenW}%`, background: C.accent3 }} />
    </div>
  );
}

function InfoNote({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="info"
        style={{
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: open ? C.accent2 : C.muted,
          display: "flex",
        }}
      >
        <Info size={13} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: 280,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              boxShadow: "0 8px 28px rgba(0,0,0,0.14)",
              padding: "12px 14px",
              fontSize: 12,
              color: C.soft,
              lineHeight: 1.55,
              fontFamily: "sans-serif",
            }}
          >
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.muted,
                padding: 2,
                display: "flex",
              }}
            >
              <X size={12} />
            </button>
            <p
              style={{
                margin: "0 0 6px",
                color: C.text,
                fontWeight: 700,
                paddingRight: 14,
              }}
            >
              {title}
            </p>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export default function CategoryCompBreakdown({ data, onRowClick }) {
  const [villaStayFilter, setVillaStayFilter] = useState("overall");

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (villaStayFilter === "overall") return rows;
    const match = villaStayFilter === "paid" ? "Paid" : "Free";
    return rows.filter((r) => r.villaPaymentType === match);
  }, [data, villaStayFilter]);

  const categoryRows = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      if (!map.has(r.category)) {
        map.set(r.category, {
          category: r.category,
          collected: 0,
          givenAway: 0,
          reversed: 0,
          transactions: 0,
          uniqueAccounts: 0,
        });
      }
      const e = map.get(r.category);
      const amt = Number(r.amount || 0);
      if (r.bucket === "collected") e.collected += amt;
      else if (r.bucket === "given_away") e.givenAway += amt;
      else if (r.bucket === "reversed") e.reversed += Math.abs(amt);
      e.transactions += Number(r.transactions || 0);
      // NOTE: summed across buckets/villa-stay rows, same caveat as
      // elsewhere in this dashboard (OverviewTab's uniqueAccounts note) —
      // a member with both collected and given-away lines in one category
      // gets counted in both, so this is an upper bound, not a precise
      // distinct count. Fine for a relative size signal in this table;
      // query the backend directly if an exact count is ever needed.
      e.uniqueAccounts += Number(r.uniqueAccounts || 0);
    });
    return [...map.values()].sort(
      (a, b) => b.collected + b.givenAway - (a.collected + a.givenAway),
    );
  }, [filtered]);

  const totals = categoryRows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      givenAway: acc.givenAway + r.givenAway,
      reversed: acc.reversed + r.reversed,
    }),
    { collected: 0, givenAway: 0, reversed: 0 },
  );

  const blendedRate = pct(totals.givenAway, totals.collected + totals.givenAway);

  return (
    <div className="dashboard-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <div className="dashboard-eyebrow">Spend Category</div>
          <h2 className="dashboard-card-title" style={{ marginBottom: 4 }}>
            Collected vs. given away, by category
          </h2>
          <p
            style={{
              fontSize: 12,
              color: C.muted,
              fontFamily: "sans-serif",
              margin: 0,
              maxWidth: 560,
            }}
          >
            "Villa stay type" filters which bookings count at all — isolate
            guests whose stay itself was comped to see whether they still
            spend on amenities. Collected and Given Away are always shown
            side by side so the give-away rate is visible without a second
            toggle.
          </p>
        </div>
        <VillaStayToggle value={villaStayFilter} onChange={setVillaStayFilter} />
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          {
            label: "Collected",
            value: money(totals.collected),
            color: C.green,
            tip: "Sum of charges across every category where the line item actually collected money.",
          },
          {
            label: "Given Away",
            value: money(totals.givenAway),
            color: C.accent3,
            tip: "Sum of charges entered as non-collecting (comp/discount) at the time of the charge — before any later reversal.",
          },
          {
            label: "Reversed / Written Off",
            value: money(totals.reversed),
            color: C.red,
            tip: 'Sum of reversal lines. These often land in their own "Reversal" category rather than the category of the original charge — see the note below the table.',
          },
          {
            label: "Blended Give-Away Rate",
            value: blendedRate,
            color: C.accent,
            tip: "Given Away ÷ (Collected + Given Away), across all categories in the current filter.",
          },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              border: `1px solid ${C.border}`,
              borderTop: `3px solid ${k.color}`,
              borderRadius: 14,
              padding: "12px 14px",
              background: C.panel,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span className="dashboard-eyebrow">{k.label}</span>
              <InfoNote title={k.label}>{k.tip}</InfoNote>
            </div>
            <div
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 24,
                color: C.text,
              }}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Category table */}
      <div
        style={{
          overflowX: "auto",
          borderRadius: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {[
                "Category",
                "Collected",
                "Given Away",
                "Give-Away Rate",
                "Split",
                "Transactions",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 14px",
                    background: C.panelAlt,
                    color: C.soft,
                    fontWeight: 700,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    borderBottom: `1px solid ${C.border}`,
                    textAlign:
                      h === "Category" || h === "Split" ? "left" : "right",
                    whiteSpace: "nowrap",
                    fontFamily: "sans-serif",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoryRows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: 32, textAlign: "center", color: C.muted }}
                >
                  No data
                </td>
              </tr>
            ) : (
              categoryRows.map((row, i) => {
                const rate = pct(row.givenAway, row.collected + row.givenAway);
                return (
                  <tr
                    key={row.category}
                    onClick={() =>
                      onRowClick({ drillType: "category", drillValue: row.category })
                    }
                    style={{
                      cursor: "pointer",
                      background: i % 2 === 0 ? "transparent" : C.panel,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.panel)
                    }
                  >
                    <td
                      style={{
                        padding: "11px 14px",
                        fontWeight: 600,
                        color: C.text,
                        fontFamily: "sans-serif",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 3,
                            background: categoryColor(row.category),
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                        {row.category}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "11px 14px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: C.green,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {money(row.collected)}
                    </td>
                    <td
                      style={{
                        padding: "11px 14px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: C.accent3,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {money(row.givenAway)}
                    </td>
                    <td
                      style={{
                        padding: "11px 14px",
                        textAlign: "right",
                        color: C.soft,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {rate}
                    </td>
                    <td style={{ padding: "11px 14px", minWidth: 130 }}>
                      <MiniSplitBar collected={row.collected} givenAway={row.givenAway} />
                    </td>
                    <td
                      style={{
                        padding: "11px 14px",
                        textAlign: "right",
                        color: C.muted,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {fmt(row.transactions)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {categoryRows.length > 1 && (
            <tfoot>
              <tr style={{ background: C.panelAlt }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 11, color: C.soft, fontFamily: "sans-serif" }}>
                  TOTAL
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.green, fontFamily: "sans-serif" }}>
                  {money(totals.collected)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.accent3, fontFamily: "sans-serif" }}>
                  {money(totals.givenAway)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: C.soft, fontFamily: "sans-serif" }}>
                  {blendedRate}
                </td>
                <td style={{ padding: "10px 14px" }} />
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: C.soft, fontFamily: "sans-serif" }}>
                  {fmt(categoryRows.reduce((s, r) => s + r.transactions, 0))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p
        style={{
          fontSize: 11,
          color: C.muted,
          fontFamily: "sans-serif",
          marginTop: 10,
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: C.soft }}>Reading this table:</strong> "Given
        Away" only catches charges that were entered as a comp at the point
        of sale — it can't see value that was simply never rung up, since
        there's no line item to total in that case. Reversed/written-off
        dollars often land under their own "Reversal" or "Adjustment" row
        rather than the category the original charge came from, so a
        category's true give-away rate can be slightly understated when its
        charges get reversed often. Click any row to see the underlying
        folio lines.
      </p>
    </div>
  );
}
