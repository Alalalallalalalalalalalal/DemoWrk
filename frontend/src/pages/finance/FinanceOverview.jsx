// frontend/src/pages/finance/FinanceOverview.jsx
// Four headline revenue cards with click-to-drill.
// Replaces Paid/Free/Member/Guest (already covered by the Breakdowns
// section below) with the Villas / Amenities / Services split.

import { TrendingUp, Home, Sparkles, Briefcase } from "lucide-react";

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

function OverviewCard({ icon: Icon, label, value, sub, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "1 1 160px",
        minWidth: 150,
        textAlign: "left",
        padding: "18px 20px",
        border: `1px solid ${C.border}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 18,
        background: C.bg,
        cursor: "pointer",
        transition: "box-shadow 0.15s, background 0.15s",
        boxShadow: "var(--dashboard-shadow-soft)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.bg)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={15} color={accent} />
        </div>
        <span className="dashboard-eyebrow">{label}</span>
      </div>

      <div
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 28,
          color: C.text,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: "sans-serif" }}>
        {sub}
      </div>
    </button>
  );
}

export default function FinanceOverview({ data, onCardClick }) {
  if (!data) return null;

  const cards = [
    {
      label: "Total Revenue",
      value: money(data.totalRevenue),
      sub:   `${(data.totalTransactions ?? 0).toLocaleString()} transactions: paid villa stays + amenities + services`,
      icon:  TrendingUp,
      accent: C.accent,
      // Special-cased in FinanceTab's handleOverviewCardClick — opens a
      // Villas/Amenities/Services mid-item breakdown instead of going
      // straight to a flat record list.
      drillType: "total",
      drillValue: "Total Revenue",
    },
    {
      label: "Villas Revenue",
      value: money(data.villasRevenue),
      sub:   "Villa rental bookings",
      icon:  Home,
      accent: "#2D8A5F",
      // transaction_category = 'Villa' — same /drilldown "category"
      // filter the rest of Finance already uses.
      drillType: "category",
      drillValue: "Villa",
    },
    {
      label: "Amenities Revenue",
      value: money(data.amenitiesRevenue),
      sub:   "Spa, golf, dining & more",
      icon:  Sparkles,
      accent: "#D98C2B",
      drillType: "section",
      drillValue: "Amenities",
    },
    {
      label: "Services Revenue",
      value: money(data.servicesRevenue),
      sub:   "All other service charges",
      icon:  Briefcase,
      accent: C.accent2,
      drillType: "section",
      drillValue: "Services",
    },
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {cards.map((card) => (
        <OverviewCard
          key={card.label}
          icon={card.icon}
          label={card.label}
          value={card.value}
          sub={card.sub}
          accent={card.accent}
          onClick={() => onCardClick({ drillType: card.drillType, drillValue: card.drillValue })}
        />
      ))}
    </div>
  );
}