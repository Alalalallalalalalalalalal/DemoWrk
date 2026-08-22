// frontend/src/pages/mltab/MarketingTargetingShared.jsx
// Design tokens and small reusable pieces shared across the Marketing
// Targeting panel's sibling files (CampaignCard, CampaignFormDrawer,
// CampaignDrawer, MarketingTargetingPanel).

export const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  rowBorder: "var(--dashboard-row-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  flame: "var(--dashboard-flame)",
  overlay: "var(--dashboard-overlay)",
  shadow: "var(--dashboard-shadow-panel)",
};

export const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 18,
};

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 800,
  fontFamily: "sans-serif",
  cursor: "pointer",
};

export function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function number(value) {
  return Number(value || 0).toLocaleString();
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function Metric({ label, value }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
      }}
    >
      <p
        style={{
          margin: "0 0 4px",
          color: C.textMuted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "sans-serif",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: 0,
          color: C.textPrimary,
          fontSize: 18,
          fontWeight: 900,
          fontFamily: "sans-serif",
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  danger = false,
  primary = false,
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonBase,
        background: primary ? C.accent : danger ? "rgba(196,91,91,0.09)" : C.bg,
        color: primary ? "white" : danger ? "#9f2f2f" : C.accent,
        border: `1px solid ${danger ? "rgba(196,91,91,0.25)" : primary ? C.accent : C.border}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}
