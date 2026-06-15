// frontend/src/pages/finance/FinanceOverview.jsx
// Four headline revenue cards with click-to-drill.
// Complimentary card removed — payment_type is 'Free' or 'Paid' direct values.

import { DollarSign, Users, UserCheck, TrendingUp } from "lucide-react";

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
      sub:   `${(data.totalTransactions ?? 0).toLocaleString()} transactions`,
      icon:  TrendingUp,
      accent: C.accent,
      drillType: "total",
      drillValue: "Total Revenue",
    },
    {
      label: "Paid Revenue",
      value: money(data.paidRevenue),
      sub:   "Paid bookings",
      icon:  DollarSign,
      accent: "#2D8A5F",
      drillType: "paid",
      drillValue: "Paid Revenue",
    },
    {
      label: "Free / Comp Value",
      value: money(data.freeValue),
      sub:   "Free bookings",
      icon:  DollarSign,
      accent: "#D98C2B",
      drillType: "free",
      drillValue: "Free / Comp Value",
    },
    {
      label: "Member Revenue",
      value: money(data.memberRevenue),
      sub:   "From member folios",
      icon:  UserCheck,
      accent: C.accent2,
      drillType: "member",
      drillValue: "Member Revenue",
    },
    {
      label: "Guest Revenue",
      value: money(data.guestRevenue),
      sub:   "From guest folios",
      icon:  Users,
      accent: C.accent3,
      drillType: "guest",
      drillValue: "Guest Revenue",
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