// frontend/src/pages/mltab/SeasonFilterShared.jsx
// Design tokens + small reusable pieces shared across the SeasonFilterBar
// split (SeasonFilterBar, useSeasonGroups, SeasonGroupTabs, SeasonChips,
// SeasonFormPanel, AddGroupPanel, SeasonDemandChart, SeasonDetailPanel).
//
// NOTE: this file intentionally duplicates its own copy of the `C` token
// object / date-filter helpers rather than sharing them with
// AmenitySeasonPanel.jsx (which defines a similar-looking set) — that
// cross-file dedup is out of scope here.

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

export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

export const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  rowBorder: "var(--dashboard-row-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  textLight: "var(--dashboard-oatmeal)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
  panelShadow: "var(--dashboard-shadow-panel)",
  overlay: "var(--dashboard-overlay)",
  red: "#C45B5B",
};

export const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

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
  const raw =
    row?.check_in_date ??
    row?.transaction_date ??
    row?.ref_date ??
    row?.date ??
    row?.month ??
    null;
  const iso = normalizeDateOnly(raw);
  if (!iso) return {};
  const [year, month, day] = iso.split("-").map(Number);
  return { iso, year, month, day };
}

export function rowMatchesDateFilter(row, filter) {
  if (!filter) return true;
  const parts = getRowDateParts(row);
  if (filter.mode === "day") return !filter.date || parts.iso === filter.date;
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

export function toDateParams(filter) {
  if (filter.mode === "day") return filter.date ? { date: filter.date } : {};
  if (filter.mode === "range") {
    return filter.startDate && filter.endDate
      ? { start_date: filter.startDate, end_date: filter.endDate }
      : {};
  }
  return {
    year: filter.year === "All" ? null : Number(filter.year),
    month: filter.month === "All" ? null : Number(filter.month),
  };
}

export function dateFilterLabel(filter) {
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

export function DateFilterBar({ value, onChange, years }) {
  const update = (patch) => onChange({ ...value, ...patch });
  const inputStyle = {
    padding: "6px 8px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    background: C.bg,
    color: C.textPrimary,
    outline: "none",
    fontFamily: "sans-serif",
  };
  const changeMode = (mode) => {
    onChange({
      mode,
      year: value.year ?? "All",
      month: value.month ?? "All",
      date: value.date ?? "",
      startDate: value.startDate ?? "",
      endDate: value.endDate ?? "",
    });
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: C.textMuted,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          fontFamily: "sans-serif",
        }}
      >
        Custom Date
      </span>
      <select
        value={value.mode}
        onChange={(e) => changeMode(e.target.value)}
        style={inputStyle}
      >
        <option value="ym">Year / Month</option>
        <option value="day">Single Day</option>
        <option value="range">Date Range</option>
      </select>
      {value.mode === "ym" && (
        <>
          <select
            value={value.year}
            onChange={(e) => update({ year: e.target.value })}
            style={inputStyle}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year === "All" ? "All Years" : year}
              </option>
            ))}
          </select>
          <select
            value={value.month}
            onChange={(e) => update({ month: e.target.value })}
            style={inputStyle}
          >
            <option value="All">All Months</option>
            {MONTH_NAMES.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </>
      )}
      {value.mode === "day" && (
        <input
          type="date"
          value={value.date}
          onChange={(e) => update({ date: e.target.value })}
          style={inputStyle}
        />
      )}
      {value.mode === "range" && (
        <>
          <input
            type="date"
            value={value.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
            style={inputStyle}
          />
          <input
            type="date"
            value={value.endDate}
            onChange={(e) => update({ endDate: e.target.value })}
            style={inputStyle}
          />
        </>
      )}
    </div>
  );
}

export function formatSeasonRange(season) {
  return `${MONTH_NAMES[season.start_month - 1]} ${season.start_day}–${
    MONTH_NAMES[season.end_month - 1]
  } ${season.end_day}`;
}

export function monthsInRange(startMonth, startDay, endMonth, endDay) {
  const months = new Set();
  // wrap-around ranges (e.g. Dec→Jan)
  if (startMonth <= endMonth) {
    for (let m = startMonth; m <= endMonth; m++) months.add(m);
  } else {
    for (let m = startMonth; m <= 12; m++) months.add(m);
    for (let m = 1; m <= endMonth; m++) months.add(m);
  }
  return months;
}

export function aggregateByGroup(seasonalVisits, seasons) {
  // seasons = array of {season_name, start_month, start_day, end_month, end_day, is_active}
  const activeSeasonsFiltered = seasons.filter((s) => s.is_active);
  return activeSeasonsFiltered.map((s) => {
    const months = monthsInRange(
      s.start_month,
      s.start_day,
      s.end_month,
      s.end_day,
    );
    let visits = 0,
      totalStay = 0,
      count = 0;
    seasonalVisits.forEach((row) => {
      const m = Number(String(row.month).split("-")[1]);
      if (months.has(m)) {
        visits += Number(row.visits ?? 0);
        totalStay += Number(row.avg_stay ?? 0);
        count++;
      }
    });
    return {
      season: s.season_name,
      season_id: s.id,
      visits,
      avg_stay: count ? Number((totalStay / count).toFixed(1)) : 0,
    };
  });
}

export function InsightGuide({ title, description, meta = [], action }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: C.textPrimary,
            fontFamily: "sans-serif",
          }}
        >
          {title}
        </p>
        {action && (
          <span
            style={{
              padding: "4px 9px",
              borderRadius: 999,
              background: C.panelAlt,
              border: `1px solid ${tint(C.accent, 32)}`,
              color: C.accent,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "sans-serif",
            }}
          >
            {action}
          </span>
        )}
      </div>

      <p
        style={{
          margin: "6px 0 10px",
          fontSize: 12,
          lineHeight: 1.55,
          color: C.textMuted,
          fontFamily: "sans-serif",
          maxWidth: 980,
        }}
      >
        {description}
      </p>

      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {meta.map((m) => (
            <span
              key={`${m.label}-${m.value}`}
              style={{
                padding: "5px 9px",
                borderRadius: 999,
                background: C.panelAlt,
                border: `1px solid ${C.border}`,
                fontSize: 11,
                color: C.textMid,
                fontFamily: "sans-serif",
              }}
            >
              <strong>{m.label}:</strong> {m.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared panel styling (originally computed inside SeasonFilterBar's
// component body, but it only ever derives from `C` — no props/state —
// so it can safely live at module scope and be shared by every sibling
// that renders a tab, chip, or form panel). ──
export const S = {
  wrap: {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: "18px 20px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  header: { display: "flex", alignItems: "center", gap: 6 },
  title: {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    color: C.textPrimary,
    fontFamily: "sans-serif",
  },
  note: { fontSize: 11, color: C.textMuted, fontFamily: "sans-serif" },
  tabRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  tab: (active) => ({
    padding: "5px 13px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: "1.5px solid",
    fontFamily: "sans-serif",
    borderColor: active ? C.accent : C.border,
    background: active ? C.accent : C.bg,
    color: active ? C.bg : C.textMid,
  }),
  addGroupBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: `1.5px dashed ${C.accent2}`,
    color: C.accent,
    background: "transparent",
    fontFamily: "sans-serif",
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: (enabled) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px 3px 12px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    border: `1px solid ${C.border}`,
    background: C.panel,
    color: C.textMid,
    fontFamily: "sans-serif",
    opacity: enabled ? 1 : 0.4,
  }),
  chipBtn: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: C.textMuted,
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    background: C.panelAlt,
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  input: {
    flex: 1,
    padding: "6px 10px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    background: C.bg,
    color: C.textPrimary,
    outline: "none",
    fontFamily: "sans-serif",
  },
  select: {
    padding: "6px 8px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    background: C.bg,
    color: C.textPrimary,
    outline: "none",
  },
  saveBtn: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: C.accent,
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
  cancelBtn: {
    padding: "6px 14px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.textMid,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
};
