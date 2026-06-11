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
} from "lucide-react";
import { analyticsApi } from "../api/analytics";

/* ── Design tokens (match existing dashboard palette) ──────────── */
const C = {
  bg: "#FDFAF6",
  border: "#EDE5D8",
  borderHover: "#C8976E",
  textPrimary: "#3D2B1F",
  textMid: "#5A3E2B",
  textMuted: "#A08070",
  textLight: "#C4B0A0",
  accent: "#C8976E",
  accentLight: "#FDF6F0",
  teal: "#5B9EAD",
  gold: "#C4A24D",
  green: "#2D8A5F",
  purple: "#7B5EA7",
  red: "#C45B5B",
  rowAlt: "#FAF6F0",
  headerBg: "#F4EDE4",
};

const AMENITY_COLORS = {
  Spa: "#7B5EA7",
  Golf: "#2D8A5F",
  Grill: "#C45B5B",
  Bar: "#C4A24D",
  Restaurant: "#C8976E",
  Tennis: "#5B9EAD",
  Boutique: "#1e0e5a",
  Commissary: "#a8799d",
};
const amenityColor = (name) => AMENITY_COLORS[name] ?? "#8B7B70";

const CHART_COLORS = Object.values(AMENITY_COLORS);

/* ── Shared micro-styles ────────────────────────────────────────── */
const pill = (color) => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  background: color + "22",
  color,
  border: `1px solid ${color}44`,
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
  color: "#7A5C45",
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
  borderBottom: `1px solid #F0E8DE`,
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
  background: "#3D2B1F",
  border: "none",
  borderRadius: 8,
  color: "#F5EEE6",
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
          background: color + "18",
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
        background: "linear-gradient(135deg, #FDF6F0 0%, #FDFAF6 100%)",
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
                  ? `rgba(200,151,110,${0.08 + intensity * 0.62})`
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
  const [sort, setSort] = useState({ col: "total_amenity_spend", dir: "desc" });
  const [page, setPage] = useState(1);
  const PAGE = 25;

  const amenities = useMemo(
    () => ["All", ...new Set(data.map((d) => d.top_amenity).filter(Boolean))],
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data;
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
  }, [data, search, amenity, sort]);

  const totalPages = Math.ceil(filtered.length / PAGE);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

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

      {/* Filters */}
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

      {/* Table */}
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
                    colSpan={5}
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
                    <td style={{ ...td, fontWeight: 600, color: C.gold }}>
                      ${Number(r.total_amenity_spend ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
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

/* ── MemberSeasonVisitsTable ────────────────────────────────────── */
function MemberSeasonVisitsTable({
  data,
  initialSeason = "",
  initialAmenity = "",
}) {
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState(initialSeason);
  const [amenity, setAmenity] = useState(initialAmenity);
  const [page, setPage] = useState(1);
  const PAGE = 30;

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, season, amenity]);
  // Sync external drill-down
  useEffect(() => {
    setSeason(initialSeason);
  }, [initialSeason]);
  useEffect(() => {
    setAmenity(initialAmenity);
  }, [initialAmenity]);

  const seasons = useMemo(
    () => ["All", ...new Set(data.map((d) => d.season).filter(Boolean))],
    [data],
  );
  const amenities = useMemo(
    () => ["All", ...new Set(data.map((d) => d.amenity).filter(Boolean))],
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data;
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
  }, [data, search, season, amenity]);

  const totalPages = Math.ceil(filtered.length / PAGE);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

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

      {/* Filters */}
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
        {(season || amenity || search) && (
          <button
            onClick={() => {
              setSearch("");
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
      </div>

      {/* Table */}
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
                    colSpan={8}
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

      {/* Pagination */}
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

  useEffect(() => {
    setExpanded(null);
  }, [data]);

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

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))",
        gap: 14,
      }}
    >
      {data.map((s, i) => {
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
                        style={{ margin: 0, fontSize: 10, color: C.textMuted }}
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
                        style={{ margin: 0, fontSize: 10, color: C.textMuted }}
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
                      const pct = Math.round((Number(count) / maxCount) * 100);

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
              background: "#FDFAF6",
              border: "1px solid #EDE5D8",
              borderRadius: 8,
              color: "#3D2B1F",
              fontSize: 12,
              fontFamily: "sans-serif",
            }}
            labelStyle={{
              color: "#3D2B1F",
              fontWeight: 700,
            }}
            itemStyle={{
              color: "#3D2B1F",
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

/* ── Main exported component ─────────────────────────────────────── */
export default function AmenitySeasonPanel({ seasonGroupId = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [drillAmenity, setDrillAmenity] = useState("");
  const [drillSeason, setDrillSeason] = useState("");
  const [selectedYear, setSelectedYear] = useState("All");
  const visitsRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(null);
    setDrillAmenity("");
    setDrillSeason("");

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

  const yearOptions = useMemo(() => {
    const years = new Set();

    [
      ...amenitySeasonSpend,
      ...memberAmenityProfile,
      ...memberAmenitySeasonVisits,
      ...seasonVillaBedroom,
    ].forEach((row) => {
      const year = getRowYear(row);
      if (year) years.add(year);
    });

    return [
      "All",
      ...Array.from(years)
        .sort((a, b) => b - a)
        .map(String),
    ];
  }, [
    amenitySeasonSpend,
    memberAmenityProfile,
    memberAmenitySeasonVisits,
    seasonVillaBedroom,
  ]);

  useEffect(() => {
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear("All");
    }
  }, [selectedYear, yearOptions]);

  useEffect(() => {
    setDrillAmenity("");
    setDrillSeason("");
  }, [selectedYear]);

  const filteredAmenitySeasonSpend = useMemo(
    () => amenitySeasonSpend.filter((row) => rowMatchesYear(row, selectedYear)),
    [amenitySeasonSpend, selectedYear],
  );

  const filteredMemberAmenityProfile = useMemo(
    () =>
      memberAmenityProfile.filter((row) => rowMatchesYear(row, selectedYear)),
    [memberAmenityProfile, selectedYear],
  );

  const filteredMemberAmenitySeasonVisits = useMemo(
    () =>
      memberAmenitySeasonVisits.filter((row) =>
        rowMatchesYear(row, selectedYear),
      ),
    [memberAmenitySeasonVisits, selectedYear],
  );

  const filteredSeasonVillaBedroom = useMemo(
    () => seasonVillaBedroom.filter((row) => rowMatchesYear(row, selectedYear)),
    [seasonVillaBedroom, selectedYear],
  );

  // Summary stats
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

  const handleCellClick = (amenity, season) => {
    setDrillAmenity(amenity);
    setDrillSeason(season);
    setTimeout(
      () =>
        visitsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  const handleBarClick = (amenity) => {
    setDrillAmenity(amenity);
    setDrillSeason("");
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
      <div
        style={{
          ...card,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
        }}
      >
        <div>
          <p style={{ ...sectionTitle, marginBottom: 2 }}>
            Amenity year filter
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            Applies to cards, revenue ranking, heatmap, and visit details.
          </p>
        </div>
        <select
          style={{ ...select, minWidth: 130 }}
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year === "All" ? "All Years" : year}
            </option>
          ))}
        </select>
      </div>

      {/* ── Summary stat row ── */}
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

      {/* ── Spend by amenity bar ── */}
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
        <AmenitySpendBarChart
          spendData={filteredAmenitySeasonSpend}
          onBarClick={handleBarClick}
        />
      </div>

      {/* ── Heatmap ── */}
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
        <AmenitySeasonHeatmap
          data={filteredAmenitySeasonSpend}
          onCellClick={handleCellClick}
        />
      </div>

      <SectionDivider>Member Profiles</SectionDivider>

      {/* ── Member amenity profile table ── */}
      <MemberAmenityProfileTable data={filteredMemberAmenityProfile} />

      <SectionDivider>Visit Details</SectionDivider>

      {/* ── Season visits table (drill-down target) ── */}
      <div ref={visitsRef}>
        {(drillAmenity || drillSeason) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "10px 14px",
              background: C.accentLight,
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
            <button
              onClick={() => {
                setDrillAmenity("");
                setDrillSeason("");
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
          data={filteredMemberAmenitySeasonVisits}
          initialSeason={drillSeason}
          initialAmenity={drillAmenity}
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
        <SeasonCapacityCards data={filteredSeasonVillaBedroom} />
      </div>
    </div>
  );
}
