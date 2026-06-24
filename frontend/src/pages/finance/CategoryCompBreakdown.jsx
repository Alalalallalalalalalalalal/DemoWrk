// frontend/src/pages/finance/CategoryCompBreakdown.jsx
//
// SECTION TABS (Villa / Amenities / Services) choose which rows are in
// play. The "Villa stay type" toggle then filters WITHIN that section by
// whether the booking's villa stay was comped (payment_type) — this
// is what lets you answer "do guests whose villa stay was free still pay
// for spa/golf/F&B, or are we comping those too."
//
// Bucket meaning (per line item, see backend for exact rule):
//   collected         -> charge actually billed
//   forgone_revenue   -> charge that was never collected (renamed from
//                        "given_away"). For the Villa section, this is
//                        now sourced from rate_details
//                        (SUM(original_amount) where payment_type =
//                        'Free', excluding Villa Lolita / Wonderland),
//                        NOT from folios. Amenities/Services keep the
//                        original folio-comp logic — only the label
//                        and field name changed.
//   reversed          -> reversal/write-off line
//
// DATA CONTRACT from financeApi.categoryCompBreakdown():
//   [{ section, category, PaymentType, bucket, amount, transactions,
//      uniqueAccounts, missingRateCount?, calculationCoverage? }]
//   missingRateCount / calculationCoverage only appear on the single
//   synthetic Villa "forgone_revenue" row — they're data-quality
//   companions to that figure, not part of every row.

import { useMemo, useState } from "react";
import { Info, X } from "lucide-react";

const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  text: "var(--dashboard-abyssal)",
  muted: "var(--dashboard-muted)",
  soft: "var(--dashboard-text-soft)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
  green: "#2D8A5F",
  red: "#C45B5B",
};

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
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const pct = (part, whole) =>
  !Number(whole) ? "—" : `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`;

const SECTION_TABS = [
  { key: "Villa", label: "Villa" },
  { key: "Amenities", label: "Amenities" },
  { key: "Services", label: "Services" },
];

const VILLA_STAY_OPTIONS = [
  { key: "overall", label: "Overall" },
  { key: "paid", label: "Paid Villa Stay" },
  { key: "free", label: "Free / Comp Villa Stay" },
];

function Pill({ options, value, onChange }) {
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
      {options.map(({ key, label }) => {
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

function MiniSplitBar({ collected, forgoneRevenue }) {
  const total = Number(collected || 0) + Number(forgoneRevenue || 0);
  const collectedW = total ? (Number(collected || 0) / total) * 100 : 0;
  const forgoneW = total ? (Number(forgoneRevenue || 0) / total) * 100 : 0;
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
      <div style={{ width: `${forgoneW}%`, background: C.accent3 }} />
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
        style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: open ? C.accent2 : C.muted, display: "flex" }}
      >
        <Info size={13} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 2, zIndex: 50, width: 180,
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
              boxShadow: "0 8px 28px rgba(0,0,0,0.14)", padding: "12px 14px", fontSize: 12,
              color: C.soft, lineHeight: 1.55, fontFamily: "sans-serif",
            }}
          >
            <button onClick={() => setOpen(false)} style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex" }}>
              <X size={12} />
            </button>
            <p style={{ margin: "0 0 6px", color: C.text, fontWeight: 700, paddingRight: 14 }}>{title}</p>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function KpiStrip({ totals, section }) {
  const blendedRate = pct(totals.forgoneRevenue, totals.collected + totals.forgoneRevenue);

  const forgoneTip =
    section === "Villa"
      ? "The rack-rate value of complimentary villa stays, drawn from rate_details.original_amount where payment_type = 'Free'. Represents room revenue the club chose not to charge. Villa Lolita and Wonderland are excluded as they operate under separate pricing arrangements."
      : "Amenity and service charges individually entered as comps on the folio line. Only captures waivers explicitly posted — value the club never rang up at all is not visible here.";

  const cards = [
    {
      label: "Collected",
      value: money(totals.collected),
      color: C.green,
      tip: "Revenue posted to folios and actually billed — the club's earned income for this section within the active period and filters.",
    },
    {
      label: "Forgone Revenue",
      value: money(Math.abs(totals.forgoneRevenue)),
      color: C.accent3,
      tip: forgoneTip,
    },
    {
      label: "Other (Payments, Adj.)",
      value: money(totals.other),
      color: C.muted,
      tip: "Payments applied against outstanding member balances and non-revenue adjustment entries. These reduce what's owed but are not income — excluded from all revenue figures.",
    },
    {
      label: "Reversed / Written Off",
      value: money(Math.abs(totals.reversed) + Math.abs(totals.other)),
      color: C.red,
      tip: "Charge reversals and write-offs — transactions that were posted and then corrected or cancelled. Excluded from all revenue totals.",
    },
    {
      label: "Forgone Rate",
      value: blendedRate,
      color: C.accent,
      tip: "Forgone Revenue as a share of total bookable value (Collected + Forgone). A 30% rate means the club waived $1 in every $3 of potential revenue across this section and the active filters.",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
      {cards.map((k) => (
        <div key={k.label} style={{ border: `1px solid ${C.border}`, borderTop: `3px solid ${k.color}`, borderRadius: 14, padding: "12px 14px", background: C.panel }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span className="dashboard-eyebrow">{k.label}</span>
            <InfoNote title={k.label}>{k.tip}</InfoNote>
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: C.text }}>{k.value}</div>
        </div>
      ))}
    </div>
  );
}

function CoverageNote({ missingRateCount, calculationCoverage }) {
  if (!missingRateCount) return null;
  const coveragePct = calculationCoverage == null ? "—" : `${(calculationCoverage * 100).toFixed(1)}%`;
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${C.accent3}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 12,
        fontSize: 12,
        color: C.soft,
        fontFamily: "sans-serif",
        background: C.panel,
      }}
    >
      <strong style={{ color: C.text }}>{fmt(missingRateCount)} complimentary villa stay(s)</strong> had no{" "}
      <code>original_amount</code> on record in rate_details and are excluded from the Forgone Revenue total.
      This typically indicates stays that were booked outside the standard rate structure.{" "}
      Calculation coverage: <strong style={{ color: C.text }}>{coveragePct}</strong> of free stays are included in the figure above.
    </div>
  );
}

function CategoryCard({ row, onRowClick }) {
  const rate = pct(row.forgoneRevenue, row.collected + row.forgoneRevenue);
  return (
    <button
      type="button"
      onClick={() => onRowClick({ drillType: "category", drillValue: row.category })}
      style={{
        textAlign: "left", cursor: "pointer", border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${categoryColor(row.category)}`, borderRadius: 14,
        background: C.panel, padding: "14px 16px", display: "flex", flexDirection: "column",
        gap: 10, transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.panelAlt; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = C.panel; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: "sans-serif" }}>{row.category}</span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>{fmt(row.transactions)} txns</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>
            {row.collected === 0 && row.forgoneRevenue === 0 ? "Amount" : "Collected"}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.green, fontFamily: "sans-serif" }}>
            {row.collected === 0 && row.forgoneRevenue === 0
              ? money(row.other || row.reversed)
              : money(row.collected)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>
            {row.collected === 0 && row.forgoneRevenue === 0 ? "" : "Forgone Revenue"}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.accent3, fontFamily: "sans-serif" }}>
            {row.collected === 0 && row.forgoneRevenue === 0 ? "" : money(row.forgoneRevenue)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>Rate</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.soft, fontFamily: "sans-serif" }}>{rate}</div>
        </div>
      </div>

      <MiniSplitBar collected={row.collected} forgoneRevenue={row.forgoneRevenue} />
    </button>
  );
}

function CategoryCards({ rows, onRowClick }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 14 }}>
        No data
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {rows.map((row) => (
        <CategoryCard key={row.category} row={row} onRowClick={onRowClick} />
      ))}
    </div>
  );
}

export default function CategoryCompBreakdown({ data, onRowClick }) {
  const [section, setSection] = useState("Villa");
  const [villaStayFilter, setVillaStayFilter] = useState("overall");

  const sectionRows = useMemo(() => {
    const rows = (data ?? []).filter((r) => r.category !== "Laundry");
    const bySection = rows.filter((r) => r.section === section);
    if (villaStayFilter === "overall") return bySection;
    const match = villaStayFilter === "paid" ? "Paid" : "Free";
    return bySection.filter((r) => r.PaymentType === match);
  }, [data, section, villaStayFilter]);

  const { categoryRows, missingRateCount, calculationCoverage } = useMemo(() => {
    const map = new Map();
    let missing = 0;
    let coverage = null;
    sectionRows.forEach((r) => {
      if (!map.has(r.category)) {
        map.set(r.category, { category: r.category, collected: 0, forgoneRevenue: 0, reversed: 0, other: 0, transactions: 0, uniqueAccounts: 0 });
      }
      const e = map.get(r.category);
      const amt = Number(r.amount || 0);
      if (r.bucket === "collected") e.collected += amt;
      else if (r.bucket === "forgone_revenue") {
        e.forgoneRevenue += amt;
        // missingRateCount / calculationCoverage only live on the
        // single synthetic Villa forgone-revenue row — pick them up
        // directly rather than trying to aggregate a percentage.
        if (r.missingRateCount != null) missing += Number(r.missingRateCount);
        if (r.calculationCoverage != null) coverage = r.calculationCoverage;
      }
      else if (r.bucket === "reversed") e.reversed +=amt;
      else if (r.bucket === "other") e.other += amt; 
      e.transactions += Number(r.transactions || 0);
      e.uniqueAccounts += Number(r.uniqueAccounts || 0);
    });
    const rows = [...map.values()].sort((a, b) => (b.collected + b.forgoneRevenue) - (a.collected + a.forgoneRevenue));
    return { categoryRows: rows, missingRateCount: missing, calculationCoverage: coverage };
  }, [sectionRows]);

  const totals = categoryRows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      forgoneRevenue: acc.forgoneRevenue + r.forgoneRevenue,
      reversed: acc.reversed + r.reversed,
      other: acc.other + r.other,
    }),
    { collected: 0, forgoneRevenue: 0, reversed: 0, other: 0},
  );

  return (
    <div className="dashboard-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div className="dashboard-eyebrow">Spend Breakdown</div>
          <h2 className="dashboard-card-title" style={{ marginBottom: 4 }}>Collected vs. Forgone Revenue</h2>
          <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", margin: 0, maxWidth: 560 }}>
            Choose a revenue section, then optionally filter by whether the guest's villa stay was paid or
            complimentary. This reveals whether comped-room guests offset the forgone room revenue through
            amenity and service spend — or whether the entire visit was effectively gifted.
          </p>
        </div>
        <Pill options={VILLA_STAY_OPTIONS} value={villaStayFilter} onChange={setVillaStayFilter} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Pill options={SECTION_TABS} value={section} onChange={setSection} />
      </div>

      {section === "Villa" && (
        <CoverageNote missingRateCount={missingRateCount} calculationCoverage={calculationCoverage} />
      )}

      <KpiStrip totals={totals} section={section} />
      <CategoryCards rows={categoryRows} onRowClick={onRowClick} />

      <p style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginTop: 10, lineHeight: 1.5 }}>
        <strong style={{ color: C.soft }}>How to read this:</strong> Villa Forgone Revenue is the rack-rate
        value of complimentary stays drawn from rate_details — what the club would have earned if those nights
        were sold at standard rates. Amenity and Service Forgone Revenue reflects charges individually entered
        as comps on the folio line; spend the club never posted is not captured. Use the{" "}
        <strong>Villa Stay Type</strong> filter to isolate guests with comped rooms and assess whether their
        amenity and service spend offsets the lost room revenue. Click any category card to see the
        underlying folio lines.
      </p>
    </div>
  );
}