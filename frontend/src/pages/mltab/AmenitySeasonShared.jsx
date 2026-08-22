// frontend/src/pages/mltab/AmenitySeasonShared.jsx
// ──────────────────────────────────────────
// Design tokens, shared micro-styles, row/date utilities, and small
// reusable pieces shared across the AmenitySeasonPanel split.
//
// NOTE: SeasonFilterBar.jsx defines a very similar `C` token object /
// InsightGuide / date-filter helpers of its own. That is intentional —
// this file's copies are NOT deduped against SeasonFilterBar's.

import * as XLSX from "xlsx";

/* ── Design tokens (match existing dashboard palette) ──────────── */
export const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  borderHover: "var(--dashboard-truffle)",
  rowBorder: "var(--dashboard-row-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  textLight: "var(--dashboard-oatmeal)",
  accent: "var(--dashboard-deep-blue)",
  accentLight: "var(--dashboard-panel-alt)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
  teal: "var(--dashboard-flame)",
  gold: "#D98C2B",
  green: "#2D8A5F",
  purple: "#7B5EA7",
  red: "#C45B5B",
  rowAlt: "var(--dashboard-panel)",
  headerBg: "var(--dashboard-panel-alt)",
  overlay: "var(--dashboard-overlay)",
  panelShadow: "var(--dashboard-shadow-panel)",
};

export const COLOR_PAID = "var(--dashboard-deep-blue)";
export const COLOR_FREE = "var(--dashboard-flame)";

export const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

export const AMENITY_COLORS = {
  Spa: "#7B5EA7",
  Golf: "#2D8A5F",
  Grill: "#C45B5B",
  Bar: "#D98C2B",
  Restaurant: "var(--dashboard-truffle)",
  Tennis: "var(--dashboard-flame)",
  Boutique: "var(--dashboard-deep-blue)",
  Commissary: "#8A6F8F",
};
export const amenityColor = (name) => AMENITY_COLORS[name] ?? C.textMuted;

export const CHART_COLORS = Object.values(AMENITY_COLORS);
export const MONTH_NAMES = [
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

/* ── Shared micro-styles ────────────────────────────────────────── */
export const pill = (color) => ({
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

export const input = {
  padding: "7px 12px 7px 34px",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "sans-serif",
  background: C.bg,
  color: C.textPrimary,
  outline: "none",
  width: 220,
};

export const select = {
  padding: "7px 10px",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "sans-serif",
  background: C.bg,
  color: C.textPrimary,
  outline: "none",
  cursor: "pointer",
};

export const th = {
  padding: "10px 14px",
  background: C.headerBg,
  color: C.textMid,
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
};

export const td = {
  padding: "10px 14px",
  borderBottom: `1px solid ${C.rowBorder}`,
  color: C.textPrimary,
  fontSize: 13,
  verticalAlign: "middle",
};

export const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: "18px 20px",
};

export const sectionTitle = {
  margin: "0 0 14px",
  fontSize: 14,
  fontWeight: 700,
  color: C.textPrimary,
  fontFamily: "sans-serif",
};

export const TOOLTIP_STYLE = {
  background: C.textPrimary,
  border: "none",
  borderRadius: 8,
  color: C.bg,
  fontSize: 12,
  fontFamily: "sans-serif",
};

export function getRowDateValue(row) {
  return (
    row?.check_in_date ??
    row?.transaction_date ??
    row?.ref_date ??
    row?.date ??
    row?.month ??
    row?.check_in_fmt ??
    null
  );
}

export function normalizeDateOnly(value) {
  if (!value) return "";
  const raw = String(value);
  const direct = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (direct) {
    const y = direct[1];
    const m = String(direct[2]).padStart(2, "0");
    const d = String(direct[3] ?? "01").padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getRowDateParts(row) {
  const iso = normalizeDateOnly(getRowDateValue(row));
  if (!iso) return {};
  const [year, month, day] = iso.split("-").map(Number);
  return { iso, year, month, day };
}

export function createDateFilter() {
  return {
    mode: "ym", // ym | day | range
    year: "All",
    month: "All",
    date: "",
    startDate: "",
    endDate: "",
  };
}

export function rowMatchesDateFilter(row, filter) {
  if (!filter) return true;
  const parts = getRowDateParts(row);

  if (filter.mode === "day") {
    return !filter.date || parts.iso === filter.date;
  }

  if (filter.mode === "range") {
    if (!filter.startDate || !filter.endDate) return true;
    return (
      Boolean(parts.iso) &&
      parts.iso >= filter.startDate &&
      parts.iso <= filter.endDate
    );
  }

  if (filter.year !== "All" && parts.year !== Number(filter.year)) return false;
  if (filter.month !== "All" && parts.month !== Number(filter.month))
    return false;
  return true;
}

export function getDateFilterYearsFromRows(rows = []) {
  const found = Array.from(
    new Set(rows.map((row) => getRowDateParts(row).year).filter(Boolean)),
  ).sort((a, b) => b - a);
  const currentYear = new Date().getFullYear();
  return [
    "All",
    ...(found.length
      ? found
      : Array.from(
          { length: currentYear - 2018 + 1 },
          (_, i) => currentYear - i,
        )),
  ];
}

export function dateFilterLabel(filter) {
  if (!filter) return "All dates";
  if (filter.mode === "day") return filter.date || "All dates";
  if (filter.mode === "range") {
    return filter.startDate && filter.endDate
      ? `${filter.startDate} to ${filter.endDate}`
      : "All dates";
  }
  if (filter.year === "All" && filter.month === "All") return "All dates";
  const monthLabel =
    filter.month === "All"
      ? "All months"
      : MONTH_NAMES[Number(filter.month) - 1];
  return `${filter.year === "All" ? "All years" : filter.year} / ${monthLabel}`;
}

export function getRowYear(row) {
  const directYear =
    row?.year ?? row?.Year ?? row?.booking_year ?? row?.check_in_year;

  if (directYear) return Number(directYear);

  const rawDate =
    row?.check_in_date ??
    row?.transaction_date ??
    row?.ref_date ??
    row?.check_in_fmt;

  if (!rawDate) return null;

  const match = String(rawDate).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function rowMatchesYear(row, year) {
  if (year === "All") return true;
  return String(getRowDateParts(row).year ?? getRowYear(row)) === String(year);
}

export function getYearOptionsFromRows(rows = []) {
  return [
    "All",
    ...Array.from(new Set(rows.map((row) => getRowYear(row)).filter(Boolean)))
      .sort((a, b) => b - a)
      .map(String),
  ];
}

export function downloadRowsAsCsv(rows, filename) {
  if (!rows.length) return;

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/* ── InsightGuide: visible, UX-friendly chart/table explanation ─── */
export function InsightGuide({
  title,
  description,
  meta = [],
  action,
  compact = false,
}) {
  return (
    <div
      style={{
        marginBottom: compact ? 12 : 16,
        padding: compact ? "12px 14px" : "14px 16px",
        borderRadius: 12,
        background:
          "linear-gradient(135deg, var(--dashboard-panel-alt) 0%, var(--dashboard-card) 100%)",
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${C.accent}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 420px", minWidth: 260 }}>
          <p
            style={{
              margin: "0 0 5px",
              fontSize: compact ? 13 : 14,
              fontWeight: 800,
              color: C.textPrimary,
              fontFamily: "sans-serif",
            }}
          >
            {title}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.55,
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            {description}
          </p>
        </div>

        {action && (
          <div
            style={{
              flex: "0 1 260px",
              padding: "8px 10px",
              borderRadius: 10,
              background: C.bg,
              border: `1px dashed ${C.borderHover}`,
              color: C.accent,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.4,
              fontFamily: "sans-serif",
            }}
          >
            {action}
          </div>
        )}
      </div>

      {meta.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 12,
          }}
        >
          {meta.map((item) => (
            <span
              key={`${item.label}-${item.value}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 9px",
                borderRadius: 999,
                background: C.bg,
                border: `1px solid ${C.border}`,
                color: C.textMid,
                fontSize: 11,
                fontFamily: "sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              <strong style={{ color: C.textPrimary }}>{item.label}:</strong>
              {item.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
