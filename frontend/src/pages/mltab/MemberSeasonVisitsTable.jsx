// frontend/src/pages/mltab/MemberSeasonVisitsTable.jsx
import { useState, useMemo, useEffect } from "react";
import { Download } from "lucide-react";
import {
  C,
  COLOR_PAID,
  COLOR_FREE,
  card,
  select,
  th,
  td,
  pill,
  amenityColor,
  getRowYear,
  createDateFilter,
  rowMatchesDateFilter,
  getDateFilterYearsFromRows,
  dateFilterLabel,
  downloadRowsAsCsv,
  InsightGuide,
} from "./AmenitySeasonShared";
import { SearchInput, DateFilterControl } from "./AmenitySeasonFilters";

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
    { label: "Payment Type", value: visit.payment_type },
    { label: "Check-In", value: visit.check_in_fmt },
    { label: "Check-Out", value: visit.check_out_fmt },
    { label: "Usage Count", value: visit.usage_count },
    {
      label: "Paid Revenue",
      value: `$${Number(visit.revenue ?? 0).toLocaleString()}`,
    },
    {
      label: "Comp Value",
      value: `$${Number(visit.free_value ?? 0).toLocaleString()}`,
    },
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
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
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
                {visit.is_free && (
                  <span
                    style={{
                      padding: "3px 7px",
                      borderRadius: 999,
                      background: COLOR_FREE,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      fontFamily: "sans-serif",
                    }}
                  >
                    Comp
                  </span>
                )}
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
              <div style={{ fontSize: 10, color: C.textMuted }}>
                {visit.is_free ? "COMP VALUE" : "PAID REVENUE"}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: visit.is_free ? COLOR_FREE : C.accent,
                }}
              >
                $
                {Number(
                  visit.is_free
                    ? visit.free_value
                    : (visit.revenue ?? visit.total_spend ?? 0),
                ).toLocaleString()}
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
export default function MemberSeasonVisitsTable({
  data,
  initialSeason = "",
  initialAmenity = "",
  initialYear = "All",
}) {
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState(initialSeason);
  const [amenity, setAmenity] = useState(initialAmenity);
  const [dateFilter, setDateFilter] = useState({
    ...createDateFilter(),
    year: initialYear || "All",
  });
  const [page, setPage] = useState(1);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const PAGE = 30;

  useEffect(() => {
    setPage(1);
  }, [search, season, amenity, dateFilter]);

  useEffect(() => {
    setSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    setAmenity(initialAmenity);
  }, [initialAmenity]);

  useEffect(() => {
    setDateFilter((f) => ({ ...f, year: initialYear || "All" }));
  }, [initialYear]);

  const seasons = useMemo(
    () => ["All", ...new Set(data.map((d) => d.season).filter(Boolean))],
    [data],
  );

  const amenities = useMemo(
    () => ["All", ...new Set(data.map((d) => d.amenity).filter(Boolean))],
    [data],
  );

  const years = useMemo(() => getDateFilterYearsFromRows(data), [data]);

  const filtered = useMemo(() => {
    let rows = data;

    rows = rows.filter((r) => rowMatchesDateFilter(r, dateFilter));

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
  }, [data, search, season, amenity, dateFilter]);

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
      "Payment Type": r.payment_type ?? "",
      Comped: r.is_free ? "Yes" : "No",
      "Check-In Date": r.check_in_fmt ?? "",
      "Check-Out Date": r.check_out_fmt ?? "",
      "Usage Count": r.usage_count ?? "",
      "Paid Revenue (USD)": r.revenue ?? "",
      "Comp Value (USD)": r.free_value ?? "",
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

        <DateFilterControl
          value={dateFilter}
          onChange={setDateFilter}
          years={years}
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

        {(dateFilterLabel(dateFilter) !== "All dates" ||
          season ||
          amenity ||
          search) && (
          <button
            onClick={() => {
              setSearch("");
              setDateFilter(createDateFilter());
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
                  "Payment",
                  "Check-In Date",
                  "Check-Out Date",
                  "Usage Count",
                  "Paid Revenue (USD)",
                  "Comp Value (USD)",
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
                    colSpan={12}
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
                    <td style={td}>
                      <span style={pill(r.is_free ? COLOR_FREE : COLOR_PAID)}>
                        {r.is_free ? "Comp" : "Paid"}
                      </span>
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
                      ${Number(r.revenue ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: COLOR_FREE }}>
                      ${Number(r.free_value ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: C.accent2 }}>
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
