// frontend/src/pages/mltab/CampaignCard.jsx
import { useState } from "react";
import { Edit3, Info, Trash2 } from "lucide-react";
import { C, card, money, number, Metric, ActionButton } from "./MarketingTargetingShared";

const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

export default function CampaignCard({ campaign, onOpen, onEdit, onToggle, onDelete }) {
  const [showInfo, setShowInfo] = useState(false);
  const inactive = campaign.isActive === false;

  return (
    <div
      onClick={() => !inactive && onOpen(campaign)}
      style={{
        ...card,
        display: "flex",
        flexDirection: "column",
        minHeight: 248,
        borderTop: `4px solid ${inactive ? C.textMuted : C.accent}`,
        cursor: inactive ? "default" : "pointer",
        position: "relative",
        opacity: inactive ? 0.62 : 1,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 9px",
              borderRadius: 999,
              background: tint(inactive ? C.textMuted : C.accent, 12),
              color: inactive ? C.textMuted : C.accent,
              fontSize: 11,
              fontWeight: 800,
              fontFamily: "sans-serif",
            }}
          >
            {campaign.category}
            {inactive ? " · Disabled" : ""}
          </span>
          <h3
            style={{
              margin: "10px 0 6px",
              color: C.textPrimary,
              fontSize: 17,
              fontWeight: 900,
              fontFamily: "sans-serif",
            }}
          >
            {campaign.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowInfo((v) => !v);
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: C.panelAlt,
            color: C.accent,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label="Campaign info"
        >
          <Info size={16} />
        </button>
      </div>

      {showInfo && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 58,
            right: 16,
            width: 280,
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.bg,
            color: C.textMid,
            boxShadow: C.shadow,
            fontSize: 12,
            lineHeight: 1.45,
            fontFamily: "sans-serif",
            zIndex: 5,
          }}
        >
          <strong style={{ color: C.textPrimary }}>What it means:</strong>
          <div style={{ marginTop: 5 }}>
            {campaign.description || "No description added."}
          </div>
          <div style={{ marginTop: 10, color: C.textMuted }}>
            Click the card to view the audience and export members.
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        <Metric label="Targets" value={number(campaign.memberCount)} />
        <Metric label="Emails" value={number(campaign.emailableCount)} />
        <Metric label="Potential" value={money(campaign.potentialRevenue)} />
        <Metric label="Avg Lifetime" value={money(campaign.avgLifetimeSpend)} />
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: "auto",
          paddingTop: 14,
        }}
      >
        <ActionButton onClick={() => onEdit(campaign)}>
          <Edit3 size={13} /> Edit
        </ActionButton>
        <ActionButton onClick={() => onToggle(campaign)}>
          {inactive ? "Enable" : "Disable"}
        </ActionButton>
        <ActionButton danger onClick={() => onDelete(campaign)}>
          <Trash2 size={13} /> Delete
        </ActionButton>
      </div>
    </div>
  );
}
