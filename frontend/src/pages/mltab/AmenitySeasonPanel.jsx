// frontend/src/pages/AmenitySeasonPanel.jsx
// ──────────────────────────────────────────
// Full-page analytics panel for Amenity × Season cross-analysis.
// Replaces the old inline amenity adoption + spend charts in the ML tab.
//
// Props
//   data          – { amenitySeasonSpend, memberAmenityProfile,
//                     memberAmenitySeasonVisits, seasonVillaBedroom }
//   onMemberClick – optional callback(member_id) for cross-panel navigation
//   onClose       – optional callback for slide-over mode (pass null for inline)

import { useState, useMemo, useRef, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  X,
  ChevronDown,
  ChevronUp,
  Search,
  Bed,
  Home,
  TrendingUp,
  Users,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { analyticsApi } from "../../api/analytics";

/* ── Design tokens (match existing dashboard palette) ──────────── */
const C = {
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

const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

const AMENITY_COLORS = {
  Spa: "#7B5EA7",
  Golf: "#2D8A5F",
  Grill: "#C45B5B",
  Bar: "#D98C2B",
  Restaurant: "var(--dashboard-truffle)",
  Tennis: "var(--dashboard-flame)",
  Boutique: "var(--dashboard-deep-blue)",
  Commissary: "#8A6F8F",
};
const amenityColor = (name) => AMENITY_COLORS[name] ?? C.textMuted;

const CHART_COLORS = Object.values(AMENITY_COLORS);

/* ── Shared micro-styles ────────────────────────────────────────── */
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

const input = {
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

const select = {
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

const th = {
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

const td = {
  padding: "10px 14px",
  borderBottom: `1px solid ${C.rowBorder}`,
  color: C.textPrimary,
  fontSize: 13,
  verticalAlign: "middle",
};

const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: "18px 20px",
};

const sectionTitle = {
  margin: "0 0 14px",
  fontSize: 14,
  fontWeight: 700,
  color: C.textPrimary,
  fontFamily: "sans-serif",
};

const TOOLTIP_STYLE = {
  background: C.textPrimary,
  border: "none",
  borderRadius: 8,
  color: C.bg,
  fontSize: 12,
  fontFamily: "sans-serif",
};

function getRowYear(row) {
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

function rowMatchesYear(row, year) {
  if (year === "All") return true;
  return String(getRowYear(row)) === String(year);
}

function getYearOptionsFromRows(rows = []) {
  return [
    "All",
    ...Array.from(new Set(rows.map((row) => getRowYear(row)).filter(Boolean)))
      .sort((a, b) => b - a)
      .map(String),
  ];
}

function YearFilterControl({ value, onChange, years, label = "Year" }) {
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
function SearchInput({ value, onChange, placeholder }) {
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

/* ── StatMini ───────────────────────────────────────────────────── */
function StatMini({ icon: Icon, label, value, color = C.accent }) {
  return (
    <div
      style={{
        ...card,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: tint(color, 12),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={16} color={color} />
      </div>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: C.textMuted,
            fontFamily: "sans-serif",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 700,
            color: C.textPrimary,
            fontFamily: "sans-serif",
          }}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/* ── SectionDivider ─────────────────────────────────────────────── */
function SectionDivider({ children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "28px 0 16px",
      }}
    >
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.textMuted,
          fontFamily: "sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

/* ── InsightGuide: visible, UX-friendly chart/table explanation ─── */
function InsightGuide({
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

/* ── AmenitySeasonHeatmap ───────────────────────────────────────── */
function AmenitySeasonHeatmap({ data, onCellClick }) {
  const seasons = useMemo(
    () => [...new Set(data.map((d) => d.season))],
    [data],
  );
  const amenities = useMemo(
    () => [...new Set(data.map((d) => d.amenity))],
    [data],
  );

  const lookup = useMemo(() => {
    const m = {};

    data.forEach((d) => {
      const key = `${d.amenity}||${d.season}`;

      if (!m[key]) {
        m[key] = {
          ...d,
          total_spend: 0,
          transaction_count: 0,
        };
      }

      m[key].total_spend += Number(d.total_spend ?? 0);
      m[key].transaction_count += Number(d.transaction_count ?? 0);
    });

    return m;
  }, [data]);

  const maxSpend = useMemo(
    () =>
      Math.max(
        ...Object.values(lookup).map((d) => Number(d.total_spend ?? 0)),
        1,
      ),
    [lookup],
  );

  if (!seasons.length)
    return (
      <p style={{ color: C.textMuted, fontSize: 13, fontFamily: "sans-serif" }}>
        No data available.
      </p>
    );

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontFamily: "sans-serif",
          fontSize: 12,
          width: "100%",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...th,
                background: "transparent",
                border: "none",
                width: 110,
              }}
            >
              {" "}
            </th>
            {seasons.map((s) => (
              <th key={s} style={{ ...th, textAlign: "center", minWidth: 90 }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {amenities.map((amenity) => (
            <tr key={amenity}>
              <td
                style={{
                  ...td,
                  fontWeight: 700,
                  paddingLeft: 4,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span style={pill(amenityColor(amenity))}>{amenity}</span>
              </td>
              {seasons.map((season) => {
                const cell = lookup[`${amenity}||${season}`];
                const intensity = cell ? cell.total_spend / maxSpend : 0;
                const bg = cell
                  ? `rgba(var(--dashboard-deep-blue-rgb), ${0.08 + intensity * 0.55})`
                  : "transparent";
                return (
                  <td
                    key={season}
                    onClick={() =>
                      cell && onCellClick && onCellClick(amenity, season)
                    }
                    style={{
                      ...td,
                      textAlign: "center",
                      background: bg,
                      cursor: cell ? "pointer" : "default",
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: `1px solid ${C.border}`,
                      transition: "background 0.15s",
                    }}
                    title={
                      cell
                        ? `${amenity} × ${season}: $${Number(cell.total_spend).toLocaleString()}`
                        : "No data"
                    }
                  >
                    {cell ? (
                      <div>
                        <div style={{ fontWeight: 700, color: C.textPrimary }}>
                          ${Number(cell.total_spend / 1000).toFixed(1)}k
                        </div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>
                          {cell.transaction_count} txn
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: C.textLight }}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        Revenue intensity increases with darker shading. Select any populated
        cell to view the matching member visits, usage count, and spend details
        below.
      </p>
    </div>
  );
}

/* ── MemberAmenityProfileTable ──────────────────────────────────── */
function MemberAmenityProfileTable({ data }) {
  const [search, setSearch] = useState("");
  const [amenity, setAmenity] = useState("All");
  const [period, setPeriod] = useState("4");
  const [sort, setSort] = useState({ col: "total_amenity_spend", dir: "desc" });
  const [page, setPage] = useState(1);
  const PAGE = 25;

  const amenities = useMemo(
    () => ["All", ...new Set(data.map((d) => d.top_amenity).filter(Boolean))],
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data;

    if (period !== "All") {
      const years = data
        .map((r) => getRowYear(r))
        .filter(Boolean)
        .sort((a, b) => b - a);

      const latestYear = years[0];

      if (latestYear) {
        const minYear = latestYear - Number(period) + 1;
        rows = rows.filter((r) => {
          const year = getRowYear(r);
          return year && year >= minYear && year <= latestYear;
        });
      }
    }

    if (amenity !== "All") rows = rows.filter((r) => r.top_amenity === amenity);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.member_full_name ?? "").toLowerCase().includes(q) ||
          String(r.member_id ?? "")
            .toLowerCase()
            .includes(q),
      );
    }

    return [...rows].sort((a, b) => {
      const av = a[sort.col] ?? 0;
      const bv = b[sort.col] ?? 0;
      return sort.dir === "asc" ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
    });
  }, [data, search, amenity, period, sort]);

  const totalPages = Math.ceil(filtered.length / PAGE);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

  const exportFilteredProfiles = () => {
    const rows = filtered.map((r) => ({
      Year: getRowYear(r) ?? "",
      "Member Name": r.member_full_name ?? "",
      "Member ID": r.member_id ?? "",
      "Preferred Amenity": r.top_amenity ?? "",
      "Preferred Amenity Spend (USD)": r.top_amenity_spend ?? "",
      "Total Amenity Spend (USD)": r.total_amenity_spend ?? "",
    }));

    const date = new Date().toISOString().split("T")[0];
    downloadRowsAsCsv(rows, `member_amenity_profiles_${date}.csv`);
  };

  const sortBy = (col) =>
    setSort((s) => ({
      col,
      dir: s.col === col && s.dir === "desc" ? "asc" : "desc",
    }));

  const SortIcon = ({ col }) =>
    sort.col === col ? (
      sort.dir === "asc" ? (
        <ChevronUp size={11} />
      ) : (
        <ChevronDown size={11} />
      )
    ) : null;

  return (
    <div style={card}>
      <InsightGuide
        compact
        title="Member Amenity Profiles"
        description="Highlights each member’s preferred amenity based on spend and compares that amount against their total amenity spending across all amenities visited."
        meta={[
          { label: "Primary Measure", value: "Top Amenity Spend (USD)" },
          { label: "Comparison", value: "Total Amenity Spend (USD)" },
          { label: "Best Used For", value: "Member preference analysis" },
        ]}
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name or ID…"
        />

        <select
          style={select}
          value={amenity}
          onChange={(e) => {
            setAmenity(e.target.value);
            setPage(1);
          }}
        >
          {amenities.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>

        <select
          style={select}
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setPage(1);
          }}
        >
          <option value="4">Last 4 Years</option>
          <option value="3">Last 3 Years</option>
          <option value="2">Last 2 Years</option>
          <option value="1">Latest Year</option>
          <option value="All">All Years</option>
        </select>

        <button
          onClick={exportFilteredProfiles}
          disabled={filtered.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.borderHover}`,
            background: C.panelAlt,
            color: C.accent,
            fontSize: 12,
            fontWeight: 700,
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "sans-serif",
          }}
        >
          <Download size={13} />
          Export Filtered
        </button>

        <span
          style={{
            fontSize: 12,
            color: C.textMuted,
            fontFamily: "sans-serif",
            marginLeft: "auto",
          }}
        >
          {filtered.length} members
        </span>
      </div>

      <div
        style={{
          overflowX: "auto",
          borderRadius: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "sans-serif",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={th}>Year</th>
                <th style={th}>Member Name</th>
                <th style={th}>Member ID</th>
                <th style={th}>Preferred Amenity</th>
                <th
                  style={{ ...th, cursor: "pointer" }}
                  onClick={() => sortBy("top_amenity_spend")}
                >
                  Preferred Amenity Spend (USD){" "}
                  <SortIcon col="top_amenity_spend" />
                </th>
                <th
                  style={{ ...th, cursor: "pointer" }}
                  onClick={() => sortBy("total_amenity_spend")}
                >
                  Total Amenity Spend (USD){" "}
                  <SortIcon col="total_amenity_spend" />
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      ...td,
                      textAlign: "center",
                      color: C.textMuted,
                      padding: 32,
                    }}
                  >
                    No records found
                  </td>
                </tr>
              ) : (
                visible.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      background: i % 2 === 0 ? "transparent" : C.rowAlt,
                    }}
                  >
                    <td style={{ ...td, color: C.textMuted }}>
                      {getRowYear(r) ?? "—"}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.member_full_name ?? "—"}
                    </td>
                    <td style={{ ...td, color: C.textMuted, fontSize: 11 }}>
                      {r.member_id ?? "—"}
                    </td>
                    <td style={td}>
                      {r.top_amenity ? (
                        <span style={pill(amenityColor(r.top_amenity))}>
                          {r.top_amenity}
                        </span>
                      ) : (
                        <span style={{ color: C.textLight }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: C.accent }}>
                      ${Number(r.top_amenity_spend ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: C.accent2 }}>
                      ${Number(r.total_amenity_spend ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.bg,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ← Prev
          </button>
          <span
            style={{
              fontSize: 12,
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.bg,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function downloadRowsAsCsv(rows, filename) {
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

function VisitSidePanel({ visit, onClose }) {
  if (!visit) return null;

  const rows = [
    { label: "Member ID", value: visit.member_id },
    { label: "Email", value: visit.email },
    { label: "Telephone", value: visit.telephone },
    { label: "Address", value: visit.address },
    { label: "Country", value: visit.country },
    { label: "State", value: visit.state },
    { label: "Title", value: visit.title },
    { label: "DOB", value: visit.dob },
    { label: "Season", value: visit.season },
    { label: "Amenity", value: visit.amenity },
    { label: "Check-In", value: visit.check_in_fmt },
    { label: "Check-Out", value: visit.check_out_fmt },
    { label: "Usage Count", value: visit.usage_count },
    {
      label: "Total Spend",
      value: `$${Number(visit.total_spend ?? 0).toLocaleString()}`,
    },
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
          width: "min(420px, 92vw)",
          background: C.bg,
          boxShadow: C.panelShadow,
          zIndex: 901,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          borderLeft: `3px solid ${amenityColor(visit.amenity)}`,
        }}
      >
        <div
          style={{
            background: C.panelAlt,
            borderBottom: `1px solid ${C.border}`,
            padding: "22px 22px 18px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: amenityColor(visit.amenity),
                  fontFamily: "sans-serif",
                  marginBottom: 5,
                }}
              >
                {visit.amenity || "Amenity Visit"}
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: C.textPrimary,
                  fontFamily: "sans-serif",
                  lineHeight: 1.25,
                }}
              >
                {visit.member_full_name || "Unknown Member"}
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                border: `1px solid ${C.border}`,
                background: C.bg,
                color: C.textMuted,
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

          <div style={{ marginTop: 14, display: "flex", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted }}>SPEND</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>
                ${Number(visit.total_spend ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted }}>SEASON</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.teal }}>
                {visit.season || "—"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 22px", flex: 1 }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            Visit & Member Details
          </p>

          {rows.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "9px 0",
                borderBottom: `1px solid ${C.border}`,
                gap: 12,
              }}
            >
              <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
              <span
                style={{
                  fontSize: 12,
                  color: C.textPrimary,
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {String(value ?? "—")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── MemberSeasonVisitsTable ────────────────────────────────────── */
function MemberSeasonVisitsTable({
  data,
  initialSeason = "",
  initialAmenity = "",
  initialYear = "All",
}) {
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState(initialSeason);
  const [amenity, setAmenity] = useState(initialAmenity);
  const [year, setYear] = useState(initialYear || "All");
  const [page, setPage] = useState(1);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const PAGE = 30;

  useEffect(() => {
    setPage(1);
  }, [search, season, amenity, year]);

  useEffect(() => {
    setSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    setAmenity(initialAmenity);
  }, [initialAmenity]);

  useEffect(() => {
    setYear(initialYear || "All");
  }, [initialYear]);

  const seasons = useMemo(
    () => ["All", ...new Set(data.map((d) => d.season).filter(Boolean))],
    [data],
  );

  const amenities = useMemo(
    () => ["All", ...new Set(data.map((d) => d.amenity).filter(Boolean))],
    [data],
  );

  const years = useMemo(
    () => [
      "All",
      ...Array.from(new Set(data.map((d) => getRowYear(d)).filter(Boolean)))
        .sort((a, b) => b - a)
        .map(String),
    ],
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data;

    if (year !== "All") {
      rows = rows.filter((r) => String(getRowYear(r)) === String(year));
    }

    if (season !== "All" && season)
      rows = rows.filter((r) => r.season === season);

    if (amenity !== "All" && amenity)
      rows = rows.filter((r) => r.amenity === amenity);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.member_full_name ?? "").toLowerCase().includes(q) ||
          String(r.member_id ?? "")
            .toLowerCase()
            .includes(q),
      );
    }

    return rows;
  }, [data, search, season, amenity, year]);

  const totalPages = Math.ceil(filtered.length / PAGE);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

  const exportFilteredVisits = () => {
    const rows = filtered.map((r) => ({
      Year: getRowYear(r) ?? "",
      "Member Name": r.member_full_name ?? "",
      "Member ID": r.member_id ?? "",
      Email: r.email ?? "",
      Telephone: r.telephone ?? "",
      Address: r.address ?? "",
      Country: r.country ?? "",
      State: r.state ?? "",
      Title: r.title ?? "",
      DOB: r.dob ?? "",
      "Business Season": r.season ?? "",
      Amenity: r.amenity ?? "",
      "Check-In Date": r.check_in_fmt ?? "",
      "Check-Out Date": r.check_out_fmt ?? "",
      "Usage Count": r.usage_count ?? "",
      "Total Spend (USD)": r.total_spend ?? "",
    }));

    const date = new Date().toISOString().split("T")[0];
    downloadRowsAsCsv(rows, `amenity_season_visits_${date}.csv`);
  };

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 620px" }}>
          <InsightGuide
            compact
            title="Season Visit × Amenity Usage"
            description="Displays detailed member amenity activity by season and stay period. Each row represents a member’s interaction with an amenity, including visit dates, usage count, and total spend."
            meta={[
              {
                label: "Filter By",
                value: "Year, season, amenity, member, or ID",
              },
              { label: "Table Grain", value: "Member stay × amenity" },
              { label: "Spend", value: "Total Spend (USD)" },
            ]}
          />
        </div>
        <span
          style={{ fontSize: 12, color: C.textMuted, fontFamily: "sans-serif" }}
        >
          {filtered.length} records
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or ID…"
        />

        <select
          style={select}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y === "All" ? "All Years" : y}
            </option>
          ))}
        </select>

        <select
          style={select}
          value={season || "All"}
          onChange={(e) =>
            setSeason(e.target.value === "All" ? "" : e.target.value)
          }
        >
          {seasons.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <select
          style={select}
          value={amenity || "All"}
          onChange={(e) =>
            setAmenity(e.target.value === "All" ? "" : e.target.value)
          }
        >
          {amenities.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>

        {(year !== "All" || season || amenity || search) && (
          <button
            onClick={() => {
              setSearch("");
              setYear("All");
              setSeason("");
              setAmenity("");
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textMuted,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "sans-serif",
            }}
          >
            Clear filters
          </button>
        )}

        <button
          onClick={exportFilteredVisits}
          disabled={filtered.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.borderHover}`,
            background: C.panelAlt,
            color: C.accent,
            fontSize: 12,
            fontWeight: 700,
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "sans-serif",
          }}
        >
          <Download size={13} />
          Export Filtered
        </button>
      </div>

      <div
        style={{
          overflowX: "auto",
          borderRadius: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "sans-serif",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                {[
                  "Year",
                  "Member Name",
                  "Member ID",
                  "Business Season",
                  "Amenity",
                  "Check-In Date",
                  "Check-Out Date",
                  "Usage Count",
                  "Total Spend (USD)",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...td,
                      textAlign: "center",
                      color: C.textMuted,
                      padding: 32,
                    }}
                  >
                    No records found
                  </td>
                </tr>
              ) : (
                visible.map((r, i) => (
                  <tr
                    key={i}
                    onClick={() => setSelectedVisit(r)}
                    style={{
                      cursor: "pointer",
                      background: i % 2 === 0 ? "transparent" : C.rowAlt,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = C.accentLight)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background =
                        i % 2 === 0 ? "transparent" : C.rowAlt)
                    }
                  >
                    <td style={{ ...td, color: C.textMuted }}>
                      {getRowYear(r) ?? "—"}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.member_full_name ?? "—"}
                    </td>
                    <td style={{ ...td, color: C.textMuted, fontSize: 11 }}>
                      {r.member_id ?? "—"}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 12,
                          color: C.textMid,
                          fontWeight: 600,
                        }}
                      >
                        {r.season ?? "—"}
                      </span>
                    </td>
                    <td style={td}>
                      {r.amenity ? (
                        <span style={pill(amenityColor(r.amenity))}>
                          {r.amenity}
                        </span>
                      ) : (
                        <span style={{ color: C.textLight }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        ...td,
                        fontSize: 12,
                        color: C.textMid,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.check_in_fmt ?? "—"}
                    </td>
                    <td
                      style={{
                        ...td,
                        fontSize: 12,
                        color: C.textMid,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.check_out_fmt ?? "—"}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {r.usage_count ?? "—"}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: C.accent }}>
                      ${Number(r.total_spend ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <VisitSidePanel
        visit={selectedVisit}
        onClose={() => setSelectedVisit(null)}
      />

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.bg,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ← Prev
          </button>
          <span
            style={{
              fontSize: 12,
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.bg,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/* ── SeasonCapacityCards ─────────────────────────────────────────── */
function SeasonCapacityCards({ data }) {
  const [expanded, setExpanded] = useState(null);
  const [year, setYear] = useState("All");

  const years = useMemo(() => getYearOptionsFromRows(data), [data]);

  useEffect(() => {
    if (!years.includes(year)) {
      setYear("All");
    }
  }, [year, years]);

  const filteredData = useMemo(
    () => data.filter((row) => rowMatchesYear(row, year)),
    [data, year],
  );

  useEffect(() => {
    setExpanded(null);
  }, [filteredData]);

  if (!data?.length)
    return (
      <p style={{ color: C.textMuted, fontSize: 13, fontFamily: "sans-serif" }}>
        No capacity data available.
      </p>
    );

  const parseDist = (raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      return {};
    }
  };

  const exportSeasonCapacity = () => {
    const rows = filteredData.map((r) => ({
      Year: getRowYear(r) ?? "",
      Season: r.season ?? "",
      "Total Bookings": r.total_bookings ?? "",
      "Total Nights": r.total_nights ?? "",
      "Average Nights": r.avg_nights ?? "",
      "Unique Members": r.unique_members ?? "",
      "Top Villa": r.top_villa ?? "",
      "Top Bedroom Count": r.top_bedroom_count ?? "",
      "Bedroom Distribution": r.bedroom_distribution ?? "",
    }));

    const date = new Date().toISOString().split("T")[0];
    downloadRowsAsCsv(rows, `season_villa_bedroom_summary_${date}.csv`);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <YearFilterControl value={year} onChange={setYear} years={years} />
        <button
          onClick={exportSeasonCapacity}
          disabled={!filteredData.length}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.borderHover}`,
            background: C.panelAlt,
            color: C.accent,
            fontSize: 12,
            fontWeight: 700,
            cursor: !filteredData.length ? "not-allowed" : "pointer",
            fontFamily: "sans-serif",
          }}
        >
          <Download size={13} />
          Export Summary
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))",
          gap: 14,
        }}
      >
        {filteredData.map((s, i) => {
          const dist = parseDist(s.bedroom_distribution);
          const isOpen = expanded === i;
          const distEntries = Object.entries(dist).sort(
            (a, b) => Number(b[1]) - Number(a[1]),
          );
          const year = getRowYear(s);

          return (
            <div
              key={`${year ?? "all"}-${s.season}-${i}`}
              style={{
                ...card,
                borderTop: `3px solid ${CHART_COLORS[i % CHART_COLORS.length]}`,
                cursor: "pointer",
              }}
              onClick={() => setExpanded(isOpen ? null : i)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
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
                  {s.season} {year ? `· ${year}` : ""}
                </p>
                {isOpen ? (
                  <ChevronUp size={14} color={C.textMuted} />
                ) : (
                  <ChevronDown size={14} color={C.textMuted} />
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: isOpen ? 14 : 0,
                }}
              >
                {[
                  {
                    label: "Bookings",
                    value: s.total_bookings?.toLocaleString() ?? "—",
                  },
                  {
                    label: "Nights",
                    value: s.total_nights?.toLocaleString() ?? "—",
                  },
                  {
                    label: "Avg Stay",
                    value: s.avg_nights != null ? `${s.avg_nights}n` : "—",
                  },
                  {
                    label: "Members",
                    value: s.unique_members?.toLocaleString() ?? "—",
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      background: C.headerBg,
                      borderRadius: 8,
                      padding: "6px 10px",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        color: C.textMuted,
                        fontFamily: "sans-serif",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }}
                    >
                      {label}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 700,
                        color: C.textPrimary,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {isOpen && (
                <div
                  style={{
                    borderTop: `1px solid ${C.border}`,
                    paddingTop: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {s.top_villa && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Home size={14} color={C.accent} />
                      <div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 10,
                            color: C.textMuted,
                          }}
                        >
                          Most Requested Villa
                        </p>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                          {s.top_villa}
                        </p>
                      </div>
                    </div>
                  )}

                  {s.top_bedroom_count != null && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Bed size={14} color={C.teal} />
                      <div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 10,
                            color: C.textMuted,
                          }}
                        >
                          Most Booked Bedroom Count
                        </p>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                          {s.top_bedroom_count} bedrooms
                        </p>
                      </div>
                    </div>
                  )}

                  {distEntries.length > 0 && (
                    <div>
                      <p
                        style={{
                          margin: "0 0 6px",
                          fontSize: 10,
                          color: C.textMuted,
                        }}
                      >
                        Bedroom Distribution
                      </p>

                      {distEntries.map(([bedrooms, count]) => {
                        const maxCount = Math.max(
                          ...distEntries.map((e) => Number(e[1])),
                        );
                        const pct = Math.round(
                          (Number(count) / maxCount) * 100,
                        );

                        return (
                          <div
                            key={bedrooms}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 5,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: C.textMid,
                                width: 70,
                              }}
                            >
                              {bedrooms} bed
                            </span>
                            <div
                              style={{
                                flex: 1,
                                height: 8,
                                background: C.border,
                                borderRadius: 4,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: C.teal,
                                  borderRadius: 4,
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: C.textMuted,
                                width: 28,
                                textAlign: "right",
                              }}
                            >
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── AmenitySpendBarChart ────────────────────────────────────────── */
function AmenitySpendBarChart({ spendData, onBarClick }) {
  // Aggregate total spend per amenity across all seasons
  const chartData = useMemo(() => {
    const agg = {};
    (spendData ?? []).forEach((d) => {
      agg[d.amenity] = (agg[d.amenity] ?? 0) + d.total_spend;
    });
    return Object.entries(agg)
      .map(([amenity, total_spend]) => ({ amenity, total_spend }))
      .sort((a, b) => b.total_spend - a.total_spend);
  }, [spendData]);

  return (
    <div style={{ height: Math.max(220, chartData.length * 36) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 24, right: 24, top: 8, bottom: 26 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#E8DDD0"
            horizontal={false}
          />
          <XAxis
            type="number"
            stroke={C.textMuted}
            fontSize={11}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            label={{
              value: "Total Revenue (USD)",
              position: "insideBottom",
              offset: -12,
              fill: C.textMuted,
              fontSize: 11,
              fontFamily: "sans-serif",
            }}
          />
          <YAxis
            type="category"
            dataKey="amenity"
            stroke={C.textMuted}
            fontSize={11}
            width={105}
            tick={{ fill: C.textMid }}
            label={{
              value: "Amenity Name",
              angle: -90,
              position: "insideLeft",
              fill: C.textMuted,
              fontSize: 11,
              fontFamily: "sans-serif",
            }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--dashboard-card)",
              border: "1px solid var(--dashboard-border)",
              borderRadius: 8,
              color: "var(--dashboard-abyssal)",
              fontSize: 12,
              fontFamily: "sans-serif",
            }}
            labelStyle={{
              color: "var(--dashboard-abyssal)",
              fontWeight: 700,
            }}
            itemStyle={{
              color: "var(--dashboard-abyssal)",
            }}
            formatter={(v) => [`$${Number(v).toLocaleString()}`, "Total Spend"]}
          />
          <Bar
            dataKey="total_spend"
            radius={[0, 6, 6, 0]}
            cursor="pointer"
            onClick={(d) => d?.amenity && onBarClick && onBarClick(d.amenity)}
          >
            {chartData.map((entry) => (
              <Cell key={entry.amenity} fill={amenityColor(entry.amenity)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SummaryStats({ amenitySeasonSpend, memberAmenityProfile }) {
  const [year, setYear] = useState("All");
  const years = useMemo(
    () =>
      getYearOptionsFromRows([...amenitySeasonSpend, ...memberAmenityProfile]),
    [amenitySeasonSpend, memberAmenityProfile],
  );

  useEffect(() => {
    if (!years.includes(year)) setYear("All");
  }, [year, years]);

  const filteredAmenitySeasonSpend = useMemo(
    () => amenitySeasonSpend.filter((row) => rowMatchesYear(row, year)),
    [amenitySeasonSpend, year],
  );

  const filteredMemberAmenityProfile = useMemo(
    () => memberAmenityProfile.filter((row) => rowMatchesYear(row, year)),
    [memberAmenityProfile, year],
  );

  const totalAmenitySpend = useMemo(
    () => filteredAmenitySeasonSpend.reduce((s, d) => s + d.total_spend, 0),
    [filteredAmenitySeasonSpend],
  );

  const totalTxns = useMemo(
    () =>
      filteredAmenitySeasonSpend.reduce((s, d) => s + d.transaction_count, 0),
    [filteredAmenitySeasonSpend],
  );

  const uniqueMembers = useMemo(
    () => new Set(filteredMemberAmenityProfile.map((m) => m.member_id)).size,
    [filteredMemberAmenityProfile],
  );

  const topAmenity = useMemo(() => {
    if (!filteredAmenitySeasonSpend.length) return "—";
    const agg = {};
    filteredAmenitySeasonSpend.forEach((d) => {
      agg[d.amenity] = (agg[d.amenity] ?? 0) + d.total_spend;
    });
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  }, [filteredAmenitySeasonSpend]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <YearFilterControl value={year} onChange={setYear} years={years} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          gap: 12,
        }}
      >
        <StatMini
          icon={TrendingUp}
          label="Total Amenity Revenue"
          color={C.accent}
          value={`$${Number(totalAmenitySpend).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <StatMini
          icon={Users}
          label="Members Using Amenities"
          color={C.teal}
          value={uniqueMembers.toLocaleString()}
        />
        <StatMini
          icon={TrendingUp}
          label="Transactions"
          color={C.gold}
          value={totalTxns.toLocaleString()}
        />
        <StatMini
          icon={TrendingUp}
          label="Top Earning Amenity"
          color={amenityColor(topAmenity)}
          value={topAmenity}
        />
      </div>
    </div>
  );
}

function AmenityRevenueSection({ data, onBarClick }) {
  const [year, setYear] = useState("All");
  const years = useMemo(() => getYearOptionsFromRows(data), [data]);

  useEffect(() => {
    if (!years.includes(year)) setYear("All");
  }, [year, years]);

  const filteredData = useMemo(
    () => data.filter((row) => rowMatchesYear(row, year)),
    [data, year],
  );

  return (
    <div style={card}>
      <InsightGuide
        title="Amenity Revenue Ranking"
        description="Ranks amenities by total revenue generated during the selected year. Use this chart to quickly identify the strongest-performing amenities and compare revenue contribution across amenity categories."
        meta={[
          { label: "X-Axis", value: "Total Revenue (USD)" },
          { label: "Y-Axis", value: "Amenity Name" },
          { label: "Sort Order", value: "Highest to lowest revenue" },
        ]}
        action="Select a bar to filter the visit table by amenity."
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <YearFilterControl value={year} onChange={setYear} years={years} />
      </div>
      <AmenitySpendBarChart
        spendData={filteredData}
        onBarClick={(amenity) => onBarClick(amenity, year)}
      />
    </div>
  );
}

function AmenityHeatmapSection({ data, onCellClick }) {
  const [year, setYear] = useState("All");
  const years = useMemo(() => getYearOptionsFromRows(data), [data]);

  useEffect(() => {
    if (!years.includes(year)) setYear("All");
  }, [year, years]);

  const filteredData = useMemo(
    () => data.filter((row) => rowMatchesYear(row, year)),
    [data, year],
  );

  return (
    <div style={card}>
      <InsightGuide
        title="Amenity Spend Heatmap"
        description="Shows how total amenity revenue changes across business seasons. Each cell represents one amenity during one season, making it easy to spot seasonal demand patterns and high-value amenity periods."
        meta={[
          { label: "Columns", value: "Business Seasons" },
          { label: "Rows", value: "Amenity Names" },
          { label: "Cell Value", value: "Total Revenue (USD)" },
          { label: "Color", value: "Darker shading = higher revenue" },
        ]}
        action="Select a cell to filter the visit table by both season and amenity."
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <YearFilterControl value={year} onChange={setYear} years={years} />
      </div>
      <AmenitySeasonHeatmap
        data={filteredData}
        onCellClick={(amenity, season) => onCellClick(amenity, season, year)}
      />
    </div>
  );
}

/* ── Main exported component ─────────────────────────────────────── */
export default function AmenitySeasonPanel({ seasonGroupId = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [drillAmenity, setDrillAmenity] = useState("");
  const [drillSeason, setDrillSeason] = useState("");
  const [drillYear, setDrillYear] = useState("All");
  const visitsRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(null);
    setDrillAmenity("");
    setDrillSeason("");
    setDrillYear("All");

    analyticsApi
      .amenitySeasonInsights({ group_id: seasonGroupId })
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch((err) => {
        console.error("Amenity season insights failed:", err);

        if (mounted) {
          setError("Unable to load amenity season insights.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [seasonGroupId]);

  const {
    amenitySeasonSpend = [],
    memberAmenityProfile = [],
    memberAmenitySeasonVisits = [],
    seasonVillaBedroom = [],
  } = data ?? {};

  const handleCellClick = (amenity, season, year = "All") => {
    setDrillAmenity(amenity);
    setDrillSeason(season);
    setDrillYear(year || "All");
    setTimeout(
      () =>
        visitsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  const handleBarClick = (amenity, year = "All") => {
    setDrillAmenity(amenity);
    setDrillSeason("");
    setDrillYear(year || "All");
    setTimeout(
      () =>
        visitsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  if (loading)
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        Loading amenity insights…
      </div>
    );

  if (error)
    return (
      <div
        style={{
          padding: 20,
          color: "#C45B5B",
          fontSize: 13,
          fontFamily: "sans-serif",
        }}
      >
        {error}
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Summary stat row ── */}
      <SummaryStats
        amenitySeasonSpend={amenitySeasonSpend}
        memberAmenityProfile={memberAmenityProfile}
      />

      {/* ── Spend by amenity bar ── */}
      <AmenityRevenueSection
        data={amenitySeasonSpend}
        onBarClick={handleBarClick}
      />

      {/* ── Heatmap ── */}
      <AmenityHeatmapSection
        data={amenitySeasonSpend}
        onCellClick={handleCellClick}
      />

      <SectionDivider>Member Profiles</SectionDivider>

      {/* ── Member amenity profile table ── */}
      <MemberAmenityProfileTable data={memberAmenityProfile} />

      <SectionDivider>Visit Details</SectionDivider>

      {/* ── Season visits table (drill-down target) ── */}
      <div ref={visitsRef}>
        {(drillAmenity || drillSeason || drillYear !== "All") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "10px 14px",
              background: C.panelAlt,
              borderRadius: 10,
              border: `1px solid ${C.borderHover}`,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: C.accent,
                fontFamily: "sans-serif",
                fontWeight: 600,
              }}
            >
              Filtered by:
            </span>
            {drillAmenity && (
              <span style={pill(amenityColor(drillAmenity))}>
                {drillAmenity}
              </span>
            )}
            {drillSeason && (
              <span style={{ ...pill("#5B9EAD") }}>{drillSeason}</span>
            )}
            {drillYear !== "All" && (
              <span style={{ ...pill(C.gold) }}>{drillYear}</span>
            )}
            <button
              onClick={() => {
                setDrillAmenity("");
                setDrillSeason("");
                setDrillYear("All");
              }}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.textMuted,
              }}
              title="Clear filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <MemberSeasonVisitsTable
          data={memberAmenitySeasonVisits}
          initialSeason={drillSeason}
          initialAmenity={drillAmenity}
          initialYear={drillYear}
        />
      </div>

      <SectionDivider>Capacity Planning</SectionDivider>

      {/* ── Villa / bedroom season cards ── */}
      <div style={card}>
        <InsightGuide
          title="Season Villa & Bedroom Summary"
          description="Provides seasonal accommodation performance metrics, including booking volume, average length of stay, member counts, preferred villa selections, and bedroom demand patterns."
          meta={[
            { label: "Card Level", value: "Season and year" },
            {
              label: "Key Metrics",
              value: "Bookings, nights, average stay, and members",
            },
            {
              label: "Expanded View",
              value: "Villa preference and bedroom distribution",
            },
          ]}
          action="Select a season card to expand detailed accommodation demand insights."
        />
        <SeasonCapacityCards data={seasonVillaBedroom} />
      </div>
    </div>
  );
}
