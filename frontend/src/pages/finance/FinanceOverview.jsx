// frontend/src/pages/finance/FinanceOverview.jsx
// Four headline revenue cards with click-to-drill.
// Replaces Paid/Free/Member/Guest (already covered by the Breakdowns
// section below) with the Villas / Amenities / Services split.

import { useState } from "react";
import { TrendingUp, Home, Sparkles, Briefcase, Info, X } from "lucide-react";

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
  v == null ? "-" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// ── Tooltip (i) button ──
function InfoNote({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => {
          // Prevent the card's onClick (drill-down) from firing
          e.stopPropagation();
          setOpen((v) => !v);
        }}
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
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 2,
              zIndex: 50,
              width: 220,
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
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              style={{
                position: "absolute", top: 8, right: 8,
                background: "none", border: "none", cursor: "pointer",
                color: C.muted, padding: 2, display: "flex",
              }}
            >
              <X size={12} />
            </button>
            <p style={{ margin: "0 0 6px", color: C.text, fontWeight: 700, paddingRight: 14 }}>
              {title}
            </p>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewCard({ icon: Icon, label, tooltip, value, accent, onClick }) {
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
        <InfoNote title={label}>
          {tooltip}
        </InfoNote>
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
    </button>
  );
}

export default function FinanceOverview({ data, onCardClick }) {
  if (!data) return null;

  const cards = [
    {
      label: "Total Revenue",
      value: money(data.totalRevenue),
      tooltip: `All villa stays, amenities, and all other services`,
      icon:  TrendingUp,
      accent: C.accent,
      // Special-cased in FinanceTab's handleOverviewCardClick - opens a
      // Villas/Amenities/Services mid-item breakdown instead of going
      // straight to a flat record list.
      drillType: "total",
      drillValue: "Total Revenue",
    },
    {
      label: "Villas Revenue",
      value: money(data.villasRevenue),
      tooltip: "Net villa rental revenue after the statement-based tax/owner deduction treatment reflected in the spend breakdown.",
      icon:  Home,
      accent: "#2D8A5F",
      // transaction_category = 'Villa' - same /drilldown "category"
      // filter the rest of Finance already uses.
      drillType: "category",
      drillValue: "Villa",
    },
    {
      label: "Amenities Revenue",
      value: money(data.amenitiesRevenue),
      tooltip: "Spa, golf, F&B, tennis, boutique, and other amenity charges across all folios",
      icon:  Sparkles,
      accent: "#D98C2B",
      drillType: "section",
      drillValue: "Amenities",
    },
    {
      label: "Services Revenue",
      value: money(data.servicesRevenue),
      tooltip: "Commissary, adjustments, and other service lines outside villa and amenity categories",
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
          tooltip={card.tooltip}
          value={card.value}
          accent={card.accent}
          onClick={() => onCardClick({ drillType: card.drillType, drillValue: card.drillValue })}
        />
      ))}
    </div>
  );
}