// frontend/src/pages/finance/CategoryCompBreakdown.jsx
//
// SECTION TABS (Villa / Amenities / Services) choose which rows are in
// play. The "Villa stay type" toggle then filters WITHIN that section by
// whether the booking's villa stay was comped (villa_payment_type) — this
// is what lets you answer "do guests whose villa stay was free still pay
// for spa/golf/F&B, or are we comping those too."
//
// Bucket meaning (per line item, see backend for exact rule):
//   collected   -> charge actually billed
//   given_away  -> charge entered as a comp (Villa section uses
//                  villa_payment_type; Amenities/Services use the line's
//                  own transaction_payment_type/payment_type)
//   reversed    -> reversal/write-off line
//
// DATA CONTRACT from financeApi.categoryCompBreakdown():
//   [{ section, category, villaPaymentType, bucket, amount, transactions, uniqueAccounts }]

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
        style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: open ? C.accent2 : C.muted, display: "flex" }}
      >
        <Info size={13} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 280,
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

function KpiStrip({ totals }) {
  const blendedRate = pct(totals.givenAway, totals.collected + totals.givenAway);
  const cards = [
    { label: "Collected", value: money(totals.collected), color: C.green, tip: "Sum of charges in this section that actually billed." },
    { label: "Given Away", value: money(totals.givenAway), color: C.accent3, tip: "Sum of charges in this section entered as comped — for Villa this is villa_payment_type = Free, for everything else it's the line's own payment type." },
    { label: "Reversed / Written Off", value: money(totals.reversed), color: C.red, tip: "Sum of reversal lines in this section." },
    { label: "Give-Away Rate", value: blendedRate, color: C.accent, tip: "Given Away ÷ (Collected + Given Away), within this section and filter." },
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

function CategoryCard({ row, onRowClick }) {
  const rate = pct(row.givenAway, row.collected + row.givenAway);
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
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>Collected</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.green, fontFamily: "sans-serif" }}>{money(row.collected)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>Given Away</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.accent3, fontFamily: "sans-serif" }}>{money(row.givenAway)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, fontFamily: "sans-serif" }}>Rate</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.soft, fontFamily: "sans-serif" }}>{rate}</div>
        </div>
      </div>

      <MiniSplitBar collected={row.collected} givenAway={row.givenAway} />
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
    return bySection.filter((r) => r.villaPaymentType === match);
  }, [data, section, villaStayFilter]);

  const categoryRows = useMemo(() => {
    const map = new Map();
    sectionRows.forEach((r) => {
      if (!map.has(r.category)) {
        map.set(r.category, { category: r.category, collected: 0, givenAway: 0, reversed: 0, transactions: 0, uniqueAccounts: 0 });
      }
      const e = map.get(r.category);
      const amt = Number(r.amount || 0);
      if (r.bucket === "collected") e.collected += amt;
      else if (r.bucket === "given_away") e.givenAway += amt;
      else if (r.bucket === "reversed") e.reversed += Math.abs(amt);
      e.transactions += Number(r.transactions || 0);
      e.uniqueAccounts += Number(r.uniqueAccounts || 0);
    });
    return [...map.values()].sort((a, b) => (b.collected + b.givenAway) - (a.collected + a.givenAway));
  }, [sectionRows]);

  const totals = categoryRows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      givenAway: acc.givenAway + r.givenAway,
      reversed: acc.reversed + r.reversed,
    }),
    { collected: 0, givenAway: 0, reversed: 0 },
  );

  return (
    <div className="dashboard-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div className="dashboard-eyebrow">Spend Breakdown</div>
          <h2 className="dashboard-card-title" style={{ marginBottom: 4 }}>Collected vs. given away</h2>
          <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", margin: 0, maxWidth: 560 }}>
            Pick a section, then optionally isolate guests whose villa stay itself
            was comped to see whether they still spend on amenities or services.
          </p>
        </div>
        <Pill options={VILLA_STAY_OPTIONS} value={villaStayFilter} onChange={setVillaStayFilter} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Pill options={SECTION_TABS} value={section} onChange={setSection} />
      </div>

      <KpiStrip totals={totals} />
      <CategoryCards rows={categoryRows} onRowClick={onRowClick} />

      <p style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginTop: 10, lineHeight: 1.5 }}>
        <strong style={{ color: C.soft }}>Reading this table:</strong> in the{" "}
        <strong>Villa</strong> tab, "Given Away" is what the rental would have
        billed had the stay not been comped (driven by villa_payment_type). In{" "}
        <strong>Amenities</strong> and <strong>Services</strong>, it's charges
        entered as comped on that specific line. "Given Away" only catches
        charges that were actually entered as a comp — it can't see value that
        was simply never rung up. Click any row to see the underlying folio lines.
      </p>
    </div>
  );
}