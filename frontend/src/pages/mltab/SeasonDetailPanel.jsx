// frontend/src/pages/mltab/SeasonDetailPanel.jsx
// Season member drill-down modal, extracted verbatim from the bottom of the
// original SeasonFilterBar.jsx (getDateParts/getMemberNumber/getMemberName
// helpers + the MODAL style object + the SeasonDetailPanel component itself).
import { useState } from "react";
import { X, MapPin } from "lucide-react";
import { C, MONTH_NAMES, DAY_OPTIONS } from "./SeasonFilterShared";

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

const MODAL = {
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
    background: C.bg,
    display: "flex",
    flexDirection: "column",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
    overflow: "hidden",
  },
  header: {
    padding: "24px 34px 20px",
    borderBottom: "1px solid var(--dashboard-border)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    position: "sticky",
    top: 0,
    background: C.bg,
    zIndex: 10,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: C.textPrimary,
    fontFamily: "sans-serif",
  },
  sub: {
    margin: "4px 0 0",
    fontSize: 12,
    color: C.textMuted,
    fontFamily: "sans-serif",
  },
  closeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: `1px solid ${C.border}`,
    background: "transparent",
    cursor: "pointer",
    color: "var(--dashboard-text-soft)",
    flexShrink: 0,
  },
  body: {
    padding: "22px 34px 42px",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  filterInput: {
    padding: "7px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "sans-serif",
    background: C.bg,
    color: C.textPrimary,
    outline: "none",
    width: 260,
  },
  count: {
    fontSize: 12,
    color: C.textMuted,
    fontFamily: "sans-serif",
    marginLeft: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "sans-serif",
    fontSize: 13,
  },
  th: {
    padding: "12px 14px",
    background: C.panelAlt,
    color: "var(--dashboard-text-soft)",
    fontWeight: 700,
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: "1px solid var(--dashboard-border)",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--dashboard-row-border)",
    color: C.textPrimary,
    verticalAlign: "top",
  },
};

export default function SeasonDetailPanel({ season, rows = [], onClose }) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState({
    year: "",
    month: "",
    day: "",
  });

  const years = Array.from(
    new Set(
      rows.map((r) => getDateParts(r.check_in_date).year).filter(Boolean),
    ),
  ).sort((a, b) => b - a);

  const filtered = rows.filter((r) => {
    const parts = getDateParts(r.check_in_date);

    if (dateFilter.year && parts.year !== Number(dateFilter.year)) return false;
    if (dateFilter.month && parts.month !== Number(dateFilter.month))
      return false;
    if (dateFilter.day && parts.day !== Number(dateFilter.day)) return false;

    if (!search) return true;
    const q = search.toLowerCase();
    return [
      getMemberName(r),
      getMemberNumber(r),
      r.country,
      r.member_type,
      r.room_type,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  return (
    <div
      style={MODAL.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={MODAL.panel}>
        <div style={MODAL.header}>
          <div>
            <p style={MODAL.title}>{season || "Season"} — Member Visits</p>
            <p style={MODAL.sub}>
              Detailed member visit records for the selected season. Use the
              filters below to narrow results by member, country, room, year,
              month, or day.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 10,
              }}
            >
              {[
                { label: "Table Rows", value: "Individual member stays" },
                { label: "Date Fields", value: "Check-in and check-out" },
                { label: "Search", value: "Name, ID, country, type, or room" },
              ].map((m) => (
                <span
                  key={m.label}
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
          </div>
          <button type="button" style={MODAL.closeBtn} onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div style={MODAL.body}>
          <div style={MODAL.filterRow}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ID, country, room…"
              style={MODAL.filterInput}
            />

            <select
              value={dateFilter.year}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, year: e.target.value }))
              }
              style={{ ...MODAL.filterInput, width: 110 }}
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
              style={{ ...MODAL.filterInput, width: 120 }}
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
              style={{ ...MODAL.filterInput, width: 100 }}
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
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: C.bg,
                color: C.textMid,
                fontSize: 12,
                fontFamily: "sans-serif",
                cursor: "pointer",
              }}
              onClick={() => setDateFilter({ year: "", month: "", day: "" })}
            >
              Clear dates
            </button>

            <span style={MODAL.count}>{filtered.length} records</span>
          </div>

          <div
            style={{
              overflow: "auto",
              maxHeight: "calc(100vh - 290px)",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
            }}
          >
            <table style={MODAL.table}>
              <thead>
                <tr>
                  {[
                    "Member Name",
                    "Member ID",
                    "Member Type",
                    "Age",
                    "Country",
                    "Check-In Date",
                    "Check-Out Date",
                    "Stay Length",
                    "Room Type",
                  ].map((h) => (
                    <th key={h} style={MODAL.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        ...MODAL.td,
                        textAlign: "center",
                        color: "#B09880",
                        padding: 40,
                      }}
                    >
                      No records found
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr
                      key={i}
                      style={{
                        background:
                          i % 2 === 0
                            ? "transparent"
                            : "var(--dashboard-panel)",
                      }}
                    >
                      <td style={{ ...MODAL.td, fontWeight: 600 }}>
                        {getMemberName(r) ?? "—"}
                      </td>
                      <td
                        style={{
                          ...MODAL.td,
                          color: C.textMuted,
                          fontSize: 11,
                        }}
                      >
                        {getMemberNumber(r) ?? "—"}
                      </td>
                      <td style={MODAL.td}>{r.member_type ?? "—"}</td>
                      <td style={{ ...MODAL.td, textAlign: "center" }}>
                        {r.age ?? "—"}
                      </td>
                      <td style={MODAL.td}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <MapPin size={10} color="#B09880" />
                          {r.country ?? "—"}
                        </span>
                      </td>
                      <td style={MODAL.td}>{r.check_in_date ?? "—"}</td>
                      <td style={MODAL.td}>{r.check_out_date ?? "—"}</td>
                      <td style={{ ...MODAL.td, textAlign: "center" }}>
                        {r.length_of_stay != null
                          ? `${r.length_of_stay}n`
                          : "—"}
                      </td>
                      <td style={MODAL.td}>{r.room_type ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
