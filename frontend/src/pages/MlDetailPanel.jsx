// /frontend/src/pages/MlDetailPanel.jsx

import { X, ArrowLeft, User, MapPin, Calendar, Tag, Mail } from "lucide-react";
import { useMemo, useState } from "react";

/* ─────────────────────────────────────────────
   Shared table styles
───────────────────────────────────────────── */
const T = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(30,18,10,0.55)",
    zIndex: 1000,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  panel: {
    width: "min(1180px, 98vw)",
    height: "100vh",
    background: "#FDFAF6",
    display: "flex",
    flexDirection: "column",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
    overflow: "hidden",
  },
  header: {
    padding: "24px 34px 20px",
    borderBottom: "1px solid #EDE5D8",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    position: "sticky",
    top: 0,
    background: "#FDFAF6",
    zIndex: 10,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "#3D2B1F",
    fontFamily: "sans-serif",
  },
  sub: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "#A08070",
    fontFamily: "sans-serif",
  },
  closeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: "1px solid #EDE5D8",
    background: "transparent",
    cursor: "pointer",
    color: "#7A5C45",
    flexShrink: 0,
  },
  body: { padding: "22px 34px 42px", overflowY: "auto", flex: 1, minHeight: 0 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "sans-serif",
    fontSize: 13,
  },
  th: {
    padding: "12px 14px",
    background: "#F4EDE4",
    color: "#7A5C45",
    fontWeight: 700,
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: "1px solid #EDE5D8",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #F0E8DE",
    color: "#3D2B1F",
    verticalAlign: "top",
  },
  badge: (color) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 600,
    background: color + "22",
    color: color,
    border: `1px solid ${color}44`,
    marginRight: 4,
    marginBottom: 2,
    whiteSpace: "nowrap",
  }),
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  filterInput: {
    padding: "7px 12px",
    border: "1px solid #DDD0C4",
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "sans-serif",
    background: "#FDFAF6",
    color: "#3D2B1F",
    outline: "none",
    width: 260,
  },
  count: {
    fontSize: 12,
    color: "#A08070",
    fontFamily: "sans-serif",
    marginLeft: "auto",
  },
  emailBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    borderRadius: 8,
    border: "1px solid #C8976E",
    background: "#FDF6F0",
    color: "#C8976E",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "sans-serif",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};

const MONTH_NAMES = [
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

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function getDateParts(value) {
  if (!value) return {};
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return {};
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

const CAMPAIGN_COLORS = {
  "Win-Back": "#C8976E",
  "Loyalty Reward": "#2D8A5F",
  Upsell: "#5B9EAD",
  "Re-engage": "#C4A24D",
  "VIP Nurture": "#7B5EA7",
  "New Member Welcome": "#3D7ABF",
};

function getCampaignColor(name) {
  for (const [key, val] of Object.entries(CAMPAIGN_COLORS)) {
    if (name && name.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "#8B7B70";
}

function getMemberNumber(row) {
  return row?.member_number ?? row?.member_id ?? row?.id ?? null;
}

function getMemberName(row) {
  return (
    row?.member_full_name ??
    row?.member_name ??
    row?.full_name ??
    row?.name ??
    null
  );
}

function memberKey(row) {
  const value = getMemberNumber(row);
  return value == null ? "" : String(value);
}

/* ─────────────────────────────────────────────
   SeasonDetailPanel
   Props: season, rows (from /ml/seasonal-visit-details),
          memberAmenityUsage, onClose
───────────────────────────────────────────── */
export function SeasonDetailPanel({
  season,
  rows,
  memberAmenityUsage,
  onClose,
}) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState({
    year: "",
    month: "",
    day: "",
  });

  const years = useMemo(() => {
    return Array.from(
      new Set(
        (rows || [])
          .map((r) => getDateParts(r.check_in_date).year)
          .filter(Boolean),
      ),
    ).sort((a, b) => b - a);
  }, [rows]);

  const amenityMap = {};
  (memberAmenityUsage || []).forEach((a) => {
    const key = memberKey(a);
    if (!amenityMap[key]) amenityMap[key] = [];
    amenityMap[key].push(a.amenity);
  });

  const filtered = (rows || []).filter((r) => {
    const parts = getDateParts(r.check_in_date);

    if (dateFilter.year && parts.year !== Number(dateFilter.year)) {
      return false;
    }
    if (dateFilter.month && parts.month !== Number(dateFilter.month)) {
      return false;
    }
    if (dateFilter.day && parts.day !== Number(dateFilter.day)) {
      return false;
    }

    if (!search) return true;
    const q = search.toLowerCase();
    return [
      getMemberName(r),
      getMemberNumber(r),
      r.country,
      r.member_type,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  return (
    <div
      style={T.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={T.panel}>
        <div style={T.header}>
          <div>
            <p style={T.title}>{season} — Member Visits</p>
            <p style={T.sub}>{rows.length} visits · click outside to close</p>
          </div>
          <button style={T.closeBtn} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div style={T.body}>
          <div style={T.filterRow}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, country, type…"
              style={T.filterInput}
            />

            <select
              value={dateFilter.year}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, year: e.target.value }))
              }
              style={{ ...T.filterInput, width: 110 }}
            >
              <option value="">Any year</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={dateFilter.month}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, month: e.target.value }))
              }
              style={{ ...T.filterInput, width: 120 }}
            >
              <option value="">Any month</option>
              {MONTH_NAMES.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>

            <select
              value={dateFilter.day}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, day: e.target.value }))
              }
              style={{ ...T.filterInput, width: 100 }}
            >
              <option value="">Any day</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>

            <button
              type="button"
              style={{
                padding: "7px 12px",
                border: "1px solid #DDD0C4",
                borderRadius: 8,
                background: "#FDFAF6",
                color: "#7A6050",
                fontSize: 12,
                fontFamily: "sans-serif",
                cursor: "pointer",
              }}
              onClick={() => setDateFilter({ year: "", month: "", day: "" })}
            >
              Clear dates
            </button>

            <span style={T.count}>{filtered.length} records</span>
          </div>
          <div
            style={{
              overflow: "auto",
              maxHeight: "calc(100vh - 250px)",
              borderRadius: 10,
              border: "1px solid #EDE5D8",
            }}
          >
            <table style={T.table}>
              <thead>
                <tr>
                  {[
                    "Member",
                    "ID",
                    "Type",
                    "Age",
                    "Country",
                    "Check-in",
                    "Check-out",
                    "Stay",
                    "Room",
                    "Amenities Used",
                  ].map((h) => (
                    <th key={h} style={T.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      style={{
                        ...T.td,
                        textAlign: "center",
                        color: "#B09880",
                        padding: 40,
                      }}
                    >
                      No records found
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => {
                    const amenities = amenityMap[memberKey(r)] || [];
                    return (
                      <tr
                        key={i}
                        style={{
                          background: i % 2 === 0 ? "transparent" : "#FAF6F0",
                        }}
                      >
                        <td style={{ ...T.td, fontWeight: 600 }}>
                          {getMemberName(r) ?? "—"}
                        </td>
                        <td style={{ ...T.td, color: "#A08070", fontSize: 11 }}>
                          {getMemberNumber(r) ?? "—"}
                        </td>
                        <td style={T.td}>{r.member_type ?? "—"}</td>
                        <td style={{ ...T.td, textAlign: "center" }}>
                          {r.age ?? "—"}
                        </td>
                        <td style={T.td}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <MapPin size={10} color="#B09880" />
                            {r.country ?? "—"}
                          </div>
                        </td>
                        <td style={T.td}>{r.check_in_date ?? "—"}</td>
                        <td style={T.td}>{r.check_out_date ?? "—"}</td>
                        <td style={{ ...T.td, textAlign: "center" }}>
                          {r.length_of_stay != null
                            ? `${r.length_of_stay}n`
                            : "—"}
                        </td>
                        <td style={T.td}>{r.room_type ?? "—"}</td>
                        <td style={T.td}>
                          {amenities.length === 0 ? (
                            <span style={{ color: "#C4B0A0" }}>—</span>
                          ) : (
                            amenities.map((a, j) => (
                              <span key={j} style={T.badge("#5B9EAD")}>
                                {a}
                              </span>
                            ))
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   AmenityDetailPanel
   Props: amenity, memberAmenityUsage, memberSegments, onClose
───────────────────────────────────────────── */
export function AmenityDetailPanel({
  amenity,
  memberAmenityUsage,
  memberSegments,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const segmentMap = {};
  (memberSegments || []).forEach((m) => {
    segmentMap[memberKey(m)] = m;
  });

  const rows = (memberAmenityUsage || [])
    .filter((a) => a.amenity === amenity)
    .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0));

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const seg = segmentMap[memberKey(r)];
    return [
      getMemberName(r),
      getMemberNumber(r),
      seg?.segment_name,
      seg?.campaign,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  return (
    <div
      style={T.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={T.panel}>
        <div style={T.header}>
          <div>
            <p style={T.title}>{amenity} — Members</p>
            <p style={T.sub}>{rows.length} members used this amenity</p>
          </div>
          <button style={T.closeBtn} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div style={T.body}>
          <div style={T.filterRow}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, segment, campaign…"
              style={T.filterInput}
            />
            <span style={T.count}>{filtered.length} records</span>
          </div>
          <div
            style={{
              overflow: "auto",
              maxHeight: "calc(100vh - 250px)",
              borderRadius: 10,
              border: "1px solid #EDE5D8",
            }}
          >
            <table style={T.table}>
              <thead>
                <tr>
                  {[
                    "Member",
                    "ID",
                    "Uses",
                    "Spend",
                    "Segment",
                    "Campaign",
                    "Active",
                  ].map((h) => (
                    <th key={h} style={T.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        ...T.td,
                        textAlign: "center",
                        color: "#B09880",
                        padding: 40,
                      }}
                    >
                      No records found
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => {
                    const seg = segmentMap[memberKey(r)];
                    const campaigns = seg?.campaign
                      ? seg.campaign.split(",").map((s) => s.trim())
                      : [];
                    return (
                      <tr
                        key={i}
                        style={{
                          background: i % 2 === 0 ? "transparent" : "#FAF6F0",
                        }}
                      >
                        <td style={{ ...T.td, fontWeight: 600 }}>
                          {getMemberName(r) ?? "—"}
                        </td>
                        <td style={{ ...T.td, color: "#A08070", fontSize: 11 }}>
                          {getMemberNumber(r) ?? "—"}
                        </td>
                        <td style={{ ...T.td, textAlign: "center" }}>
                          {r.usage_count ?? "—"}
                        </td>
                        <td
                          style={{ ...T.td, fontWeight: 600, color: "#C8976E" }}
                        >
                          {r.total_spend != null
                            ? `$${Number(r.total_spend).toLocaleString()}`
                            : "—"}
                        </td>
                        <td style={T.td}>{seg?.segment_name ?? "—"}</td>
                        <td style={T.td}>
                          {campaigns.length === 0 ? (
                            <span style={{ color: "#C4B0A0" }}>—</span>
                          ) : (
                            campaigns.map((c, j) => (
                              <span
                                key={j}
                                style={T.badge(getCampaignColor(c))}
                              >
                                {c}
                              </span>
                            ))
                          )}
                        </td>
                        <td style={{ ...T.td, textAlign: "center" }}>
                          <span
                            style={{
                              color: seg?.is_active ? "#2D8A5F" : "#C4B0A0",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {seg?.is_active ? "Yes" : "No"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MarketingTargetsPanel  (full section, not a slide-over)
   Props: memberSegments, memberAmenityUsage, seasonalVisits,
          seasonalVisitRows (keyed by season), onAddPromotion
───────────────────────────────────────────── */
export function MarketingTargetsPanel({
  memberSegments,
  memberAmenityUsage,
  onAddPromotion,
}) {
  const [filterSegment, setFilterSegment] = useState("All");
  const [filterCampaign, setFilterCampaign] = useState("All");
  const [search, setSearch] = useState("");

  // Build amenity map: member_number -> top amenity
  const topAmenityMap = {};
  const amenitySpendMap = {};
  (memberAmenityUsage || []).forEach((a) => {
    const key = memberKey(a);
    if (
      !amenitySpendMap[key] ||
      Number(a.total_spend) > Number(amenitySpendMap[key].spend)
    ) {
      amenitySpendMap[key] = {
        amenity: a.amenity,
        spend: Number(a.total_spend ?? 0),
      };
    }
  });
  Object.entries(amenitySpendMap).forEach(([k, v]) => {
    topAmenityMap[k] = v.amenity;
  });

  // Unique segments + campaigns
  const segments = [
    "All",
    ...Array.from(
      new Set(
        (memberSegments || []).map((m) => m.segment_name).filter(Boolean),
      ),
    ),
  ];
  const allCampaigns = (memberSegments || []).flatMap((m) =>
    m.campaign ? m.campaign.split(",").map((s) => s.trim()) : [],
  );
  const campaigns = ["All", ...Array.from(new Set(allCampaigns)).sort()];

  const rows = (memberSegments || []).filter((m) => {
    if (filterSegment !== "All" && m.segment_name !== filterSegment)
      return false;
    if (filterCampaign !== "All") {
      const cList = m.campaign
        ? m.campaign.split(",").map((s) => s.trim())
        : [];
      if (!cList.includes(filterCampaign)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return [
        getMemberName(m),
        getMemberNumber(m),
        m.segment_name,
        m.campaign,
      ].some((v) => v && String(v).toLowerCase().includes(q));
    }
    return true;
  });

  const selectStyle = {
    padding: "7px 10px",
    border: "1px solid #DDD0C4",
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "sans-serif",
    background: "#FDFAF6",
    color: "#3D2B1F",
    outline: "none",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        background: "#FDFAF6",
        border: "1px solid #EDE5D8",
        borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: "#3D2B1F",
              fontFamily: "sans-serif",
            }}
          >
            Targeted Marketing
          </p>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 12,
              color: "#A08070",
              fontFamily: "sans-serif",
            }}
          >
            {rows.length} members · each member may have multiple campaigns
          </p>
        </div>
        <button style={T.emailBtn} onClick={onAddPromotion}>
          <Mail size={13} />
          Add Email Promotion
        </button>
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, number, campaign…"
          style={{ ...T.filterInput, width: 200 }}
        />
        <select
          value={filterSegment}
          onChange={(e) => setFilterSegment(e.target.value)}
          style={selectStyle}
        >
          {segments.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterCampaign}
          onChange={(e) => setFilterCampaign(e.target.value)}
          style={selectStyle}
        >
          {campaigns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span
          style={{
            fontSize: 12,
            color: "#A08070",
            fontFamily: "sans-serif",
            marginLeft: "auto",
          }}
        >
          {rows.length} of {memberSegments?.length ?? 0} members
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          overflowX: "auto",
          borderRadius: 10,
          border: "1px solid #EDE5D8",
        }}
      >
        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <table style={{ ...T.table, minWidth: 780 }}>
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: "#F4EDE4",
                zIndex: 1,
              }}
            >
              <tr>
                {[
                  "Member",
                  "ID",
                  "Segment",
                  "Campaigns",
                  "Top Amenity",
                  "Spend",
                  "Visits",
                  "Active",
                  "Last Visit",
                ].map((h) => (
                  <th key={h} style={T.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...T.td,
                      textAlign: "center",
                      color: "#B09880",
                      padding: 40,
                    }}
                  >
                    No members match
                  </td>
                </tr>
              ) : (
                rows.map((m, i) => {
                  const campaigns = m.campaign
                    ? m.campaign.split(",").map((s) => s.trim())
                    : [];
                  const favAmenity = topAmenityMap[memberKey(m)];
                  return (
                    <tr
                      key={i}
                      style={{
                        background: i % 2 === 0 ? "transparent" : "#FAF6F0",
                      }}
                    >
                      <td style={{ ...T.td, fontWeight: 600 }}>
                        {getMemberName(m) ?? "—"}
                      </td>
                      <td style={{ ...T.td, color: "#A08070", fontSize: 11 }}>
                        {getMemberNumber(m) ?? "—"}
                      </td>
                      <td style={T.td}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 9px",
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 600,
                            background: "#EDE5D8",
                            color: "#5A3E2B",
                          }}
                        >
                          {m.segment_name ?? "—"}
                        </span>
                      </td>
                      <td style={T.td}>
                        {campaigns.length === 0 ? (
                          <span style={{ color: "#C4B0A0" }}>—</span>
                        ) : (
                          campaigns.map((c, j) => (
                            <span key={j} style={T.badge(getCampaignColor(c))}>
                              {c}
                            </span>
                          ))
                        )}
                      </td>
                      <td style={T.td}>
                        {favAmenity ? (
                          <span style={T.badge("#5B9EAD")}>{favAmenity}</span>
                        ) : (
                          <span style={{ color: "#C4B0A0" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{ ...T.td, fontWeight: 600, color: "#C8976E" }}
                      >
                        {m.total_spend != null
                          ? `$${Number(m.total_spend).toLocaleString()}`
                          : "—"}
                      </td>
                      <td style={{ ...T.td, textAlign: "center" }}>
                        {m.visit_count ?? "—"}
                      </td>
                      <td style={{ ...T.td, textAlign: "center" }}>
                        <span
                          style={{
                            color: m.is_active ? "#2D8A5F" : "#C4B0A0",
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {m.is_active ? "✓" : "—"}
                        </span>
                      </td>
                      <td style={{ ...T.td, fontSize: 11, color: "#A08070" }}>
                        {m.days_since_last_visit != null
                          ? `${m.days_since_last_visit}d ago`
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
