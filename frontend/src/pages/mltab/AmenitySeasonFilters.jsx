// frontend/src/pages/mltab/AmenitySeasonFilters.jsx
// ──────────────────────────────────────────
// Small reusable filter controls shared across the AmenitySeasonPanel
// split (date filter, year filter, search box).

import { Search } from "lucide-react";
import { C, select, input, MONTH_NAMES } from "./AmenitySeasonShared";

export function DateFilterControl({ value, onChange, years, label = "Date" }) {
  const update = (patch) => onChange({ ...value, ...patch });
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
  const fieldStyle = { ...select, minWidth: 125 };
  const dateInputStyle = { ...select, minWidth: 145, cursor: "text" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        {label}
      </span>
      <select
        style={fieldStyle}
        value={value.mode}
        onChange={(e) => changeMode(e.target.value)}
      >
        <option value="ym">Year / Month</option>
        <option value="day">Single Day</option>
        <option value="range">Date Range</option>
      </select>

      {value.mode === "ym" && (
        <>
          <select
            style={fieldStyle}
            value={value.year}
            onChange={(e) => update({ year: e.target.value })}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year === "All" ? "All Years" : year}
              </option>
            ))}
          </select>
          <select
            style={fieldStyle}
            value={value.month}
            onChange={(e) => update({ month: e.target.value })}
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
          style={dateInputStyle}
        />
      )}

      {value.mode === "range" && (
        <>
          <input
            type="date"
            value={value.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
            style={dateInputStyle}
          />
          <input
            type="date"
            value={value.endDate}
            onChange={(e) => update({ endDate: e.target.value })}
            style={dateInputStyle}
          />
        </>
      )}
    </div>
  );
}

export function YearFilterControl({ value, onChange, years, label = "Year" }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        {label}
      </span>
      <select
        style={{ ...select, minWidth: 125 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year === "All" ? "All Years" : year}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── SearchInput ────────────────────────────────────────────────── */
export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative" }}>
      <Search
        size={13}
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          color: C.textMuted,
        }}
      />
      <input
        style={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
