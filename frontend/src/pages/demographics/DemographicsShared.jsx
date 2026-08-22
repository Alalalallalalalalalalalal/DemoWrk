import { useState } from "react";
import { Info, X } from "lucide-react";
import { TOOLTIP_STYLE } from "../styles/Dashboardstyles";

/* ─── Shared chart values ───────────────────────────────────── */

export const AX = "#9A8E84";
export const GRID = "#DDD6CA";
export const TIP = TOOLTIP_STYLE;

export const C = {
  bg: "var(--dashboard-card)",
  border: "var(--dashboard-border)",
  text: "var(--dashboard-abyssal)",
  muted: "var(--dashboard-muted)",
  soft: "var(--dashboard-text-soft)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
};

export const CHART_INFO = {
  accountTypes: {
    summary:
      "Shows how member and guest accounts are distributed across the club's different account types.",
    functionality:
      "Switch between Members and Guests, hover for exact totals, and click a bar to open the matching accounts.",
    x: "Number of accounts",
    y: "Account type",
  },
  ageGroups: {
    summary:
      "Groups accounts into age ranges to show the age composition of the club's member and guest population.",
    functionality:
      "Hover over a bar to view the exact number of accounts in each age group.",
    x: "Age group",
    y: "Number of accounts",
  },
  genderSplit: {
    summary:
      "Shows the proportional distribution of accounts by recorded gender.",
    functionality:
      "Hover over a slice or review the legend to compare the gender categories.",
    x: null,
    y: null,
  },
  maritalStatus: {
    summary:
      "Shows how accounts are distributed across the recorded marital-status categories.",
    functionality:
      "Hover over a slice or review the legend to compare marital-status categories.",
    x: null,
    y: null,
  },
  memberGuestStatus: {
    summary: "Compares the current account statuses of members and guests.",
    functionality:
      "Hover for exact totals and click a Member or Guest bar to open accounts with that status.",
    x: "Account status",
    y: "Number of accounts",
  },
  newMembersGuests: {
    summary:
      "Tracks the number of members and guests first added during each year.",
    functionality:
      "Hover over a point for the annual total and use the legend to distinguish members from guests.",
    x: "Year first added",
    y: "Number of new accounts",
  },
  newVsRepeatVisitors: {
    summary:
      "Compares newly acquired accounts with returning accounts over time.",
    functionality:
      "Click a legend item to show or hide a line. Hover for totals or click a point to open matching account records. Use Years shown / Ending year for a rolling annual window, All years for the full history, or switch to Custom Range to inspect a specific month-to-month span (up to 24 months, can cross a calendar year).",
    x: "Period",
    y: "Number of accounts",
  },
  accountsByState: {
    summary: "Shows the geographic distribution of accounts across US states.",
    functionality:
      "Hover a state for its account total, member/guest split and percentages. Select a state to open the accounts associated with it.",
    x: null,
    y: null,
  },
  accountsByCountry: {
    summary: "Shows the countries represented by member and guest accounts.",
    functionality:
      "Choose how many countries to display, hover for exact totals, percentages and the member/guest split, and click a country bar (or Other Countries) to view more detail.",
    x: "Number of accounts",
    y: "Country",
  },
  dependentsByAge: {
    summary:
      "Groups registered dependents into age ranges to show the age composition of linked family accounts.",
    functionality:
      "Hover over a bar to see the exact number of dependents in each age group.",
    x: "Dependent age group",
    y: "Number of dependents",
  },
  dependentsPerHousehold: {
    summary:
      "Shows how households are distributed by their number of registered dependents.",
    functionality:
      "Hover for the household total and click a bar to open households in that group.",
    x: "Dependents in household",
    y: "Number of households",
  },
  topMembersByDependents: {
    summary: "Ranks member accounts with the highest number of registered dependents.",
    functionality:
      "Hover over a bar for the exact dependent count associated with each member account.",
    x: "Member account",
    y: "Number of dependents",
  },
  dataCompleteness: {
    summary:
      "Shows what share of accounts are missing key demographic fields, such as age, gender, country, marital status, and join (since) date.",
    functionality:
      "Hover over a bar to see the exact count and percentage of accounts missing that field.",
    x: "Percent of accounts missing",
    y: "Field",
  },
  householdComposition: {
    summary:
      "Summarizes member households by whether they have any registered dependents, plus the average and largest household sizes.",
    functionality:
      "These are summary statistics calculated across all member accounts.",
    x: null,
    y: null,
  },
  geographicConcentration: {
    summary:
      "Shows how concentrated accounts are geographically — the share coming from the top 5 states and top 5 countries, and the US vs. International account split.",
    functionality:
      "Hover a card for the underlying breakdown; click a card to jump to the related map or chart (Top 5 Countries and International Accounts also switch the country chart's view).",
    x: null,
    y: null,
  },
};

export const MONTHS = [
  "All",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/* ─── Local card wrapper ────────────────────────────────────── */

export function ChartInfo({ id }) {
  const [open, setOpen] = useState(false);
  const info = CHART_INFO[id];

  if (!info) return null;

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="Chart information"
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: open ? C.accent2 : C.muted,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = C.accent2;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = open ? C.accent2 : C.muted;
        }}
      >
        <Info size={15} />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />

          <div
            role="dialog"
            aria-label="Chart explanation"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: 280,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.14)",
              padding: "14px 16px",
              fontSize: 12,
              color: C.soft,
              lineHeight: 1.55,
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chart information"
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
              <X size={13} />
            </button>

            <p
              style={{
                margin: "0 0 10px",
                color: C.text,
                fontSize: 12,
                paddingRight: 16,
              }}
            >
              {info.summary}
            </p>

            {(info.x || info.y) && (
              <div
                style={{
                  borderTop: `1px solid ${C.border}`,
                  paddingTop: 10,
                  marginBottom: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                {info.x && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: C.accent2,
                        minWidth: 14,
                        fontSize: 11,
                      }}
                    >
                      X
                    </span>
                    <span>{info.x}</span>
                  </div>
                )}

                {info.y && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: C.accent,
                        minWidth: 14,
                        fontSize: 11,
                      }}
                    >
                      Y
                    </span>
                    <span>{info.y}</span>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                borderTop: `1px solid ${C.border}`,
                paddingTop: 10,
                color: C.muted,
                fontSize: 11,
              }}
            >
              {info.functionality}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Card({ title, sub, children, action, style }) {
  return (
    <div className="dashboard-card" style={style}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <div className="dashboard-eyebrow">{sub}</div>
          <h2 className="dashboard-card-title">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ─── Lightweight KPI strip for summary stats (household composition) ── */
export function MiniKpiBand({ items }) {
  return (
    <div
      className="dashboard-kpi-band"
      style={{ padding: "18px 24px", marginBottom: 18 }}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            padding: "0 22px",
            borderLeft: index > 0 ? "1px solid #DDD6CA" : "none",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#9A8E84",
            }}
          >
            {item.label}
          </span>

          <span
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 26,
              lineHeight: 1.1,
              color: "#1B2632",
            }}
          >
            {item.value}
          </span>

          {item.detail && (
            <span
              style={{
                fontSize: 11,
                color: "#A35139",
              }}
            >
              {item.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function HoverKpiCard({ label, value, detail, onClick, panel, index }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "0 22px",
        borderLeft: index > 0 ? "1px solid #DDD6CA" : "none",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 4,
          border: "none",
          background: "transparent",
          textAlign: "left",
          fontFamily: "inherit",
          cursor: onClick ? "pointer" : "default",
          padding: "6px 4px",
          borderRadius: 10,
          width: "100%",
          transition: "background 0.16s ease",
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#9A8E84",
          }}
        >
          {label}
        </span>

        <span
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 26,
            lineHeight: 1.1,
            color: "#1B2632",
          }}
        >
          {value}
        </span>

        {detail && (
          <span style={{ fontSize: 11, color: "#A35139" }}>{detail}</span>
        )}
      </button>

      {hovered && panel && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 45,
            width: 300,
            maxHeight: 300,
            overflowY: "auto",
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.16)",
            padding: 12,
            fontSize: 11,
            color: C.text,
          }}
        >
          {panel}
        </div>
      )}
    </div>
  );
}

export function ClickableVisitorDot({
  cx,
  cy,
  payload,
  fill,
  visitorStatus,
  onPointClick,
}) {
  if (cx == null || cy == null || !payload?.period_start || !payload?.period_end) {
    return null;
  }

  const handleClick = (event) => {
    event?.stopPropagation?.();

    onPointClick({
      visitorStatus,
      periodStart: payload.period_start,
      periodEnd: payload.period_end,
      periodLabel: payload.period_label,
    });
  };

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={fill}
      stroke="var(--dashboard-card)"
      strokeWidth={2}
      role="button"
      tabIndex={0}
      aria-label={`View ${visitorStatus} accounts for ${payload.period_label}`}
      style={{
        cursor: "pointer",
      }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick(event);
        }
      }}
    />
  );
}

export const ClickableBarRow = ({ x, y, width, height, payload, onRowClick }) => (
  <rect
    x={x}
    y={y}
    width={width}
    height={height}
    fill="transparent"
    style={{ cursor: "pointer" }}
    onClick={() => onRowClick(payload)}
  />
);

export const ClickableBarColumn = ({
  x,
  y,
  width,
  height,
  payload,
  category,
  onColumnClick,
}) => (
  <rect
    x={x}
    y={y}
    width={width}
    height={height}
    fill="transparent"
    style={{ cursor: "pointer" }}
    onClick={() => (category ? onColumnClick(payload, category) : onColumnClick(payload))}
  />
);
