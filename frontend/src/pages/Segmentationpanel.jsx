/**
 * SegmentationPanel.jsx
 *
 * Drop into dashboard.jsx under ML Insights:
 *   import SegmentationPanel from "./SegmentationPanel";
 *   <SegmentationPanel />
 *
 * Calls: GET /analytics/ml/segmentation
 * Returns: { spenders: [...], visitors: [...], amenities: [...] }
 */

import { useEffect, useState, useMemo } from "react";
import { analyticsApi } from "../api/analytics";
import "./styles.css";

/* ─── colour tokens ─────────────────────────────────────────────── */
const C = {
  bg: "var(--dashboard-card)",
  border: "var(--dashboard-border)",
  muted: "var(--dashboard-muted)",
  text: "var(--dashboard-abyssal)",
  sub: "var(--dashboard-text-soft)",
  accent: "var(--dashboard-deep-blue)",
  teal: "var(--dashboard-flame)",
  gold: "#D98C2B",
  green: "#2D8A5F",
  red: "#C45B5B",
  purple: "#7B5EA7",
  headerBg: "var(--dashboard-panel-alt)",
  rowAlt: "var(--dashboard-panel)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  overlay: "var(--dashboard-overlay)",
  panelShadow: "var(--dashboard-shadow-panel)",
};

const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

/* colour + left-border accent per segment label — no icons */
const SEGMENT_PALETTE = {
  "High Spender": { bg: "var(--dashboard-panel-alt)", accent: C.accent },
  "Medium Spender": {
    bg: "var(--dashboard-panel)",
    accent: C.accent3 ?? C.teal,
  },
  "Low Spender": { bg: "var(--dashboard-card)", accent: C.muted },
  Frequent: { bg: "var(--dashboard-panel-alt)", accent: C.accent },
  Regular: { bg: "var(--dashboard-panel)", accent: C.teal },
  Lapsed: { bg: "#FFF5F5", accent: C.red },
  "Never Visited": { bg: "#F7F4FD", accent: C.purple },
  _default: { bg: "var(--dashboard-panel)", accent: C.teal },
};

const paletteFor = (label) =>
  SEGMENT_PALETTE[label] ?? SEGMENT_PALETTE._default;

/* ─── shared table styles (mirrors AmenitySeasonPanel) ─────────── */
const th = {
  padding: "10px 14px",
  background: C.headerBg,
  color: C.sub,
  fontWeight: 700,
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
  fontFamily: "sans-serif",
};

const td = {
  padding: "10px 14px",
  borderBottom: `1px solid var(--dashboard-row-border)`,
  color: C.text,
  fontSize: 13,
  verticalAlign: "middle",
  fontFamily: "sans-serif",
};

const pill = (color) => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  background: tint(color, 14),
  color,
  border: `1px solid ${tint(color, 32)}`,
  whiteSpace: "nowrap",
  fontFamily: "sans-serif",
});

const select = {
  padding: "7px 10px",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "sans-serif",
  background: C.bg,
  color: C.text,
  outline: "none",
  cursor: "pointer",
};

/* ─── helpers ───────────────────────────────────────────────────── */
const fmt$ = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
};

/* ─── segment type tabs ─────────────────────────────────────────── */
const SEGMENT_TABS = [
  {
    key: "spenders",
    label: "Spenders",
    description: "Ranked by total spending",
  },
  {
    key: "visitors",
    label: "Visitors",
    description: "Visit frequency & recency",
  },
  {
    key: "amenities",
    label: "Amenities",
    description: "Amenity usage by member",
  },
];

/* ══════════════════════════════════════════════════════════════════
   SIDE PANEL
══════════════════════════════════════════════════════════════════ */
function MemberSidePanel({ member, tab, onClose }) {
  if (!member) return null;

  const label =
    tab === "spenders"
      ? member.tier
      : tab === "visitors"
        ? member.visitor_type
        : member.top_amenity;

  const pal = paletteFor(label);

  const rows =
    tab === "spenders"
      ? [
          { label: "Member #", value: member.member_number },
          { label: "Email", value: member.email || "—" },
          { label: "Tier", value: member.tier },
          { label: "Total Spend", value: fmt$(member.net_spend) },
          {
            label: "Categories",
            value: Array.isArray(member.spend_categories)
              ? member.spend_categories.join(", ")
              : member.spend_categories || "—",
          },
          { label: "Last Check-in", value: fmtDate(member.check_in_date) },
          { label: "Check-out", value: fmtDate(member.check_out_date) },
          { label: "Season", value: member.season || "—" },
        ]
      : tab === "visitors"
        ? [
            { label: "Member #", value: member.member_number },
            { label: "Email", value: member.email || "—" },
            { label: "Visitor Type", value: member.visitor_type },
            { label: "Total Visits", value: member.total_reservations ?? "—" },
            { label: "Last Visit", value: fmtDate(member.last_visit) },
            { label: "Last Check-in", value: fmtDate(member.check_in_date) },
            { label: "Last Check-out", value: fmtDate(member.check_out_date) },
            { label: "Season", value: member.season || "—" },
          ]
        : [
            { label: "Member #", value: member.member_number },
            { label: "Email", value: member.email || "—" },
            { label: "Amenity", value: member.top_amenity },
            { label: "Total Spend", value: fmt$(member.total_amenity_spend) },
            {
              label: "Amenity Spend",
              value: fmt$(member.top_amenity_spend) ?? "—",
            },
            { label: "Check-in", value: fmtDate(member.check_in_date) },
            { label: "Check-out", value: fmtDate(member.check_out_date) },
            { label: "Season", value: member.season || "—" },
          ];

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: C.overlay,
          zIndex: 900,
          backdropFilter: "blur(2px)",
        }}
      />

      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(400px, 92vw)",
          background: C.bg,
          boxShadow: C.panelShadow,
          zIndex: 901,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          animation: "slideInRight 0.2s ease",
          borderLeft: `3px solid ${pal.accent}`,
        }}
      >
        {/* header */}
        <div
          style={{
            background: pal.bg,
            borderBottom: `1px solid ${C.border}`,
            padding: "22px 22px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: pal.accent,
                  fontFamily: "sans-serif",
                  marginBottom: 5,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: C.text,
                  fontFamily: "sans-serif",
                  lineHeight: 1.25,
                }}
              >
                {member.name || "Unknown"}
              </div>
            </div>
            {/* close — a plain × with no fuss */}
            <button
              onClick={onClose}
              style={{
                border: `1px solid ${C.border}`,
                background: C.bg,
                color: C.muted,
                fontSize: 14,
                cursor: "pointer",
                padding: "3px 8px",
                borderRadius: 6,
                fontFamily: "sans-serif",
                lineHeight: 1,
              }}
            >
              close
            </button>
          </div>

          {/* KPI pair */}
          <div style={{ marginTop: 14, display: "flex", gap: 24 }}>
            {tab === "spenders" && (
              <>
                <KpiChip
                  label="Total Spend"
                  value={fmt$(member.net_spend)}
                  color={pal.accent}
                />
                <KpiChip
                  label="Season"
                  value={member.season || "—"}
                  color={C.muted}
                />
              </>
            )}
            {tab === "visitors" && (
              <>
                <KpiChip
                  label="Total Visits"
                  value={member.total_reservations ?? "—"}
                  color={pal.accent}
                />
                <KpiChip
                  label="Last Visit"
                  value={fmtDate(member.last_visit)}
                  color={C.muted}
                />
              </>
            )}
            {tab === "amenities" && (
              <>
                <KpiChip
                  label="Total Spend"
                  value={fmt$(member.total_amenity_spend)}
                  color={pal.accent}
                />
                <KpiChip
                  label="Amenity Spend"
                  value={fmt$(member.top_amenity_spend)}
                  color={C.muted}
                />
              </>
            )}
          </div>
        </div>

        {/* detail list */}
        <div style={{ padding: "18px 22px", flex: 1 }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: C.muted,
              fontFamily: "sans-serif",
            }}
          >
            Member Details
          </p>

          {rows.map(({ label: l, value }) => (
            <div
              key={l}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "9px 0",
                borderBottom: `1px solid ${C.border}`,
                gap: 12,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: C.muted,
                  fontFamily: "sans-serif",
                  flexShrink: 0,
                }}
              >
                {l}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: C.text,
                  fontWeight: 600,
                  fontFamily: "sans-serif",
                  textAlign: "right",
                }}
              >
                {String(value ?? "—")}
              </span>
            </div>
          ))}
        </div>

        {/* footer note */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: `1px solid ${C.border}`,
            background: C.rowAlt,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: C.muted,
              fontFamily: "sans-serif",
            }}
          >
            Contact via email or flag for marketing outreach in the ML Insights
            tab.
          </p>
        </div>
      </div>

      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

function KpiChip({ label, value, color }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: C.muted,
          fontFamily: "sans-serif",
          marginBottom: 2,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color,
          fontFamily: "sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SEGMENT SUMMARY CARDS
══════════════════════════════════════════════════════════════════ */
function SegmentCard({ label, count, totalSpend, active, onClick }) {
  const pal = paletteFor(label);
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? pal.bg : C.bg,
        border: `1px solid ${C.border}`,
        borderTop: `3px solid ${active ? pal.accent : C.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s ease",
        minWidth: 130,
        flex: "1 1 130px",
        fontFamily: "sans-serif",
        boxShadow: active
          ? "0 4px 12px rgba(var(--dashboard-deep-blue-rgb), 0.08)"
          : "none",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: active ? pal.accent : C.muted,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1 }}
      >
        {count}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>members</div>
      {totalSpend != null && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.sub }}>
          {fmt$(totalSpend)}
        </div>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MEMBER TABLE ROW — styled like AmenitySeasonPanel
══════════════════════════════════════════════════════════════════ */
function MemberRow({ member, tab, idx, onClick }) {
  const label =
    tab === "spenders"
      ? member.tier
      : tab === "visitors"
        ? member.visitor_type
        : member.top_amenity;

  const pal = paletteFor(label);

  const kpi =
    tab === "spenders"
      ? fmt$(member.net_spend)
      : tab === "visitors"
        ? (member.total_reservations ?? "—")
        : fmt$(member.total_amenity_spend);

  const secondary =
    tab === "spenders"
      ? member.season || "—"
      : tab === "visitors"
        ? fmtDate(member.last_visit)
        : fmt$(member.top_amenity_spend);

  const detail =
    tab === "spenders"
      ? Array.isArray(member.spend_categories)
        ? member.spend_categories.join(", ")
        : ""
      : tab === "visitors"
        ? fmtDate(member.check_in_date)
        : member.top_amenity || "—";

  return (
    <tr
      onClick={onClick}
      style={{
        cursor: "pointer",
        background: idx % 2 === 0 ? "transparent" : C.rowAlt,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = pal.bg)}
      onMouseLeave={(e) =>
        (e.currentTarget.style.background =
          idx % 2 === 0 ? "transparent" : C.rowAlt)
      }
    >
      {/* name */}
      <td style={{ ...td, fontWeight: 600 }}>
        <div>{member.name || "—"}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
          #{member.member_number}
        </div>
      </td>

      {/* segment badge */}
      <td style={td}>
        <span style={pill(pal.accent)}>{label}</span>
      </td>

      {/* primary KPI */}
      <td style={{ ...td, fontWeight: 700, color: C.text }}>{kpi}</td>

      {/* secondary */}
      <td
        style={{
          ...td,
          color: C.sub,
          fontWeight: tab === "amenities" ? 700 : 400,
        }}
      >
        {secondary}
      </td>

      {/* detail */}
      <td
        style={{
          ...td,
          color: C.muted,
          fontSize: 11,
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </td>

      {/* caret */}
      <td style={{ ...td, textAlign: "right", color: C.muted, fontSize: 11 }}>
        ›
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CONTEXT CALLOUT
══════════════════════════════════════════════════════════════════ */
function ContextCallout({ tab, filterLabel, summary }) {
  const msgs = {
    spenders: {
      null: "Members ranked by total spending. Select a tier above to narrow the list, or click any row for full details.",
      "High Spender": `${summary["High Spender"]?.count ?? 0} members driving the most revenue. Strong candidates for premium experience upgrades, private dining, or early access to new services.`,
      "Medium Spender": `${summary["Medium Spender"]?.count ?? 0} members with consistent but moderate spend. Loyalty packages or bundled offers could move some into the top tier.`,
      "Low Spender": `${summary["Low Spender"]?.count ?? 0} members with minimal recorded spend. Consider introductory offers or a guided amenity experience to increase engagement.`,
    },
    visitors: {
      null: "Members grouped by visit frequency and recency. Select a type above to focus the list.",
      Frequent: `${summary["Frequent"]?.count ?? 0} members who return regularly. Well suited for referral programs, member events, or beta access to new facilities.`,
      Regular: `${summary["Regular"]?.count ?? 0} members who visit occasionally. A seasonal invitation or curated package could increase their frequency.`,
      Lapsed: `${summary["Lapsed"]?.count ?? 0} members with no visit in over 18 months. A personalised outreach before renewal time may re-engage them.`,
      "Never Visited": `${summary["Never Visited"]?.count ?? 0} members who have not yet checked in. A direct invitation or complimentary introductory stay would be a natural first step.`,
    },
    amenities: {
      null: "Amenity usage per member. Select a type above to filter, or click any row for full details.",
    },
  };

  const msg = msgs[tab]?.[filterLabel] ?? msgs[tab]?.[null] ?? "";
  if (!msg) return null;

  return (
    <div
      style={{
        background: "#F7F2EC",
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.accent}`,
        borderRadius: 8,
        padding: "11px 14px",
        marginBottom: 16,
        fontSize: 12,
        color: C.sub,
        lineHeight: 1.65,
        fontFamily: "sans-serif",
      }}
    >
      {msg}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PAGINATION BUTTON
══════════════════════════════════════════════════════════════════ */
function PageBtn({ label, active, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 11px",
        borderRadius: 7,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accent : disabled ? "#F3EDE5" : C.bg,
        color: active ? "#fff" : disabled ? C.muted : C.text,
        fontSize: 12,
        fontFamily: "sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: active ? 700 : 400,
      }}
    >
      {label}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */
export default function SegmentationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("spenders");
  const [filterLabel, setFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    analyticsApi
      .memberSegments()

      .then(setData)
      .catch(() => setError("Could not load segmentation data."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setFilter(null);
    setSearch("");
    setPage(1);
  }, [activeTab]);
  useEffect(() => {
    setPage(1);
  }, [search, filterLabel]);

  const rows = useMemo(
    () => (data ? (data[activeTab] ?? []) : []),
    [data, activeTab],
  );

  const summaryMap = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const label =
        activeTab === "spenders"
          ? r.tier
          : activeTab === "visitors"
            ? r.visitor_type
            : (r.amenity_type ?? r.top_amenity);
      if (!label) return;
      if (!map[label]) map[label] = { count: 0, totalSpend: 0 };
      map[label].count++;
      const spend =
        activeTab === "spenders"
          ? r.net_spend
          : activeTab === "amenities"
            ? r.total_spend
            : 0;
      map[label].totalSpend += Number(spend) || 0;
    });
    return map;
  }, [rows, activeTab]);

  const segmentLabels = useMemo(() => Object.keys(summaryMap), [summaryMap]);

  const filteredRows = useMemo(() => {
    let out = rows;
    if (filterLabel) {
      out = out.filter(
        (r) =>
          (activeTab === "spenders"
            ? r.tier
            : activeTab === "visitors"
              ? r.visitor_type
              : (r.amenity_type ?? r.top_amenity)) === filterLabel,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) =>
        [
          r.name,
          r.member_number,
          r.email,
          r.tier,
          r.visitor_type,
          r.amenity_type,
          r.season,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [rows, filterLabel, search, activeTab]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const tableHeaders =
    activeTab === "spenders"
      ? ["Member", "Tier", "Total Spend ($USD)", "Season", "Categories", ""]
      : activeTab === "visitors"
        ? ["Member", "Visitor Type", "Visits", "Last Visit", "Check-in", ""]
        : [
            "Member",
            "Amenity",
            "Total Spend ($USD)",
            "Amenity Spend ($USD)",
            "Amenity Type",
            "",
          ];

  if (loading)
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: C.muted,
          fontFamily: "sans-serif",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );

  if (error)
    return (
      <div
        style={{
          padding: 20,
          color: C.red,
          fontFamily: "sans-serif",
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* ── TYPE NAV ── */}
      <div
        style={{
          display: "flex",
          gap: 2,
          background: "var(--dashboard-border)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 20,
          width: "fit-content",
        }}
      >
        {SEGMENT_TABS.map(({ key, label, description }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              title={description}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "7px 20px",
                cursor: "pointer",
                fontFamily: "sans-serif",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                background: active ? C.bg : "transparent",
                color: active ? C.text : C.muted,
                boxShadow: active ? "0 1px 4px rgba(0,0,0,0.07)" : "none",
                transition: "all 0.13s ease",
                letterSpacing: active ? 0 : "0.01em",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── SEGMENT SUMMARY CARDS ── */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}
      >
        {segmentLabels.map((label) => (
          <SegmentCard
            key={label}
            label={label}
            count={summaryMap[label].count}
            totalSpend={
              activeTab !== "visitors" ? summaryMap[label].totalSpend : null
            }
            active={filterLabel === label}
            onClick={() => setFilter((prev) => (prev === label ? null : label))}
          />
        ))}
      </div>

      {/* ── CALLOUT ── */}
      <ContextCallout
        tab={activeTab}
        filterLabel={filterLabel}
        summary={summaryMap}
      />

      {/* ── SEARCH + COUNT ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, member number, email…"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            fontSize: 12,
            color: C.text,
            background: C.bg,
            outline: "none",
            width: "min(300px, 100%)",
            fontFamily: "sans-serif",
          }}
        />
        <span
          style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}
        >
          {filterLabel
            ? `${filteredRows.length} in ${filterLabel}`
            : `${filteredRows.length} members`}
          {search ? `  ·  matching "${search}"` : ""}
        </span>
      </div>

      {/* ── TABLE ── */}
      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
        }}
      >
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 640,
              fontFamily: "sans-serif",
            }}
          >
            <thead>
              <tr>
                {tableHeaders.map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      ...td,
                      textAlign: "center",
                      padding: 40,
                      color: C.muted,
                    }}
                  >
                    No members found
                  </td>
                </tr>
              ) : (
                pageRows.map((member, i) => (
                  <MemberRow
                    key={member.id ?? `${member.member_number}-${i}`}
                    member={member}
                    tab={activeTab}
                    idx={i}
                    onClick={() => setSelected(member)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PAGINATION ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span
            style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}
          >
            Page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 5 }}>
            <PageBtn
              label="←"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            />
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.min(
                Math.max(1, page - 2),
                Math.max(1, totalPages - 4),
              );
              return start + i;
            }).map((n) => (
              <PageBtn
                key={n}
                label={String(n)}
                active={n === page}
                onClick={() => setPage(n)}
              />
            ))}
            <PageBtn
              label="→"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            />
          </div>
        </div>
      )}

      {/* ── SIDE PANEL ── */}
      {selected && (
        <MemberSidePanel
          member={selected}
          tab={activeTab}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
