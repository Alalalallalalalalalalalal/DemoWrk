// frontend/src/pages/mltab/SeasonCapacityCards.jsx
import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronUp, Bed, Home, Download } from "lucide-react";
import {
  C,
  CHART_COLORS,
  card,
  getRowYear,
  getYearOptionsFromRows,
  rowMatchesYear,
  downloadRowsAsCsv,
} from "./AmenitySeasonShared";
import { YearFilterControl } from "./AmenitySeasonFilters";

/* ── SeasonCapacityCards ─────────────────────────────────────────── */
export default function SeasonCapacityCards({ data }) {
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
