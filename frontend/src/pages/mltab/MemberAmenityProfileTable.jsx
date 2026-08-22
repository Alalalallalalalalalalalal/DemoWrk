// frontend/src/pages/mltab/MemberAmenityProfileTable.jsx
import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import {
  C,
  card,
  select,
  th,
  td,
  pill,
  amenityColor,
  getRowYear,
  downloadRowsAsCsv,
  InsightGuide,
} from "./AmenitySeasonShared";
import { SearchInput } from "./AmenitySeasonFilters";

/* ── MemberAmenityProfileTable ──────────────────────────────────── */
export default function MemberAmenityProfileTable({ data }) {
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
