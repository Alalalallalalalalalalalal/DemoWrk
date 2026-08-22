// frontend/src/pages/visits/VisitsPerformanceTable.jsx
//
// Sortable/searchable "Performance by villa or bedroom count" table.

import { ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  Empty,
  ExportMenu,
  Field,
  FONT_DISPLAY,
  FONT_NUM,
  InfoTip,
  ScrollShell,
  Segmented,
  T,
  bedColor,
  money,
  n0,
  n1,
  periodFilePart,
  safeFilePart,
} from "./VisitsRoomsShared";

export function SortHeader({ label, col, sort, setSort, align = "right" }) {
  const active = sort.col === col;
  return (
    <button
      type="button"
      onClick={() =>
        setSort({ col, dir: active && sort.dir === "desc" ? "asc" : "desc" })
      }
      className="vr-focus flex w-full items-center gap-1 text-xs font-semibold uppercase"
      style={{
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        letterSpacing: "0.06em",
        color: active ? T.ink : T.muted,
        background: "none",
        border: "none",
        padding: "2px 0",
        cursor: "pointer",
      }}
    >
      {label}
      {active ? (
        sort.dir === "desc" ? (
          <ArrowDown size={12} style={{ color: T.flame }} />
        ) : (
          <ArrowUp size={12} style={{ color: T.flame }} />
        )
      ) : (
        <ArrowDown size={12} style={{ color: "#C7D4DE" }} />
      )}
    </button>
  );
}

export function ConfigSwatch({ configs }) {
  const list = configs?.length ? configs : [null];
  return (
    <span
      className="flex flex-col overflow-hidden rounded-full"
      style={{ width: 6, height: 28 }}
    >
      {list.map((c, i) => (
        <span key={`${c}-${i}`} style={{ flex: 1, background: bedColor(c) }} />
      ))}
    </span>
  );
}

export default function VisitsPerformanceTable({
  tableDim,
  setTableDim,
  tableFigureMode,
  setTableFigureMode,
  tableSort,
  setTableSort,
  query,
  setQuery,
  tableRows,
  performanceValueLabel,
  tableExport,
  period,
  selectedVillaName,
  openVilla,
  openBedroom,
}) {
  return (
    <div
      className="visits-panel-card"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 18,
        minWidth: 0,
      }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: T.ink,
              margin: 0,
            }}
          >
            Performance by {tableDim === "villa" ? "villa" : "bedroom count"}
          </h2>
          <p className="mt-0.5" style={{ fontSize: 12, color: T.slate }}>
            {n0(tableRows.length)} row{tableRows.length === 1 ? "" : "s"}
            {query.trim() ? ` matching “${query}”` : ""} · select a row for
            its full record
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={tableDim}
            onChange={(v) => {
              setTableDim(v);
              setQuery("");
            }}
            options={[
              { value: "villa", label: "Villa" },
              { value: "bedroom", label: "Bedrooms" },
            ]}
          />

          {tableDim === "villa" && (
            <Segmented
              size="sm"
              value={tableFigureMode}
              onChange={setTableFigureMode}
              options={[
                { value: "overall", label: "Overall" },
                { value: "paid", label: "Paid" },
                { value: "free", label: "Free" },
              ]}
            />
          )}

          <ExportMenu
            rows={tableExport}
            filenameBase={`villa_performance_${tableDim}_${safeFilePart(periodFilePart(period))}`}
            disabled={!tableExport.length}
          />
          <InfoTip id="table" />
        </div>
      </div>

      {/* Sort + search controls */}
      <div
        className="visits-toolbar mb-4"
        style={{
          background: T.mist,
          border: `1px solid ${T.line}`,
          borderRadius: 14,
          padding: "10px 14px",
        }}
      >
        <Field
          label="Sort by"
          value={tableSort.col}
          onChange={(col) => setTableSort((s) => ({ ...s, col }))}
          options={[
            ["value", performanceValueLabel],
            ["bookings", "Bookings"],
            ["nights", "Nights spent"],
            ["avgStay", "Avg stay"],
            ["members", "Members"],
            ["name", tableDim === "villa" ? "Villa name" : "Bedroom size"],
          ]}
        />
        <Field
          label="Order"
          value={tableSort.dir}
          onChange={(dir) => setTableSort((s) => ({ ...s, dir }))}
          options={[
            ["desc", "Descending"],
            ["asc", "Ascending"],
          ]}
        />
        <div
          className="ml-auto flex items-center gap-2 rounded-full px-3 py-1.5"
          style={{ background: T.card, border: `1px solid ${T.line}` }}
        >
          <Search size={14} style={{ color: T.slate }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tableDim === "villa" ? "Search villas" : "Search bedroom size"
            }
            className="vr-focus"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              width: 160,
              fontSize: 13,
              color: T.ink,
            }}
          />
        </div>
      </div>

      {!tableRows.length ? (
        <Empty>
          {query.trim()
            ? `Nothing matches “${query}”. Clear the search to see everything.`
            : "No rows for the current period and payment filters."}
        </Empty>
      ) : (
        <ScrollShell maxHeight={460}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 780,
            }}
          >
            <thead>
              <tr>
                {[
                  [
                    tableDim === "villa" ? "Villa" : "Bedrooms",
                    "name",
                    "left",
                  ],
                  [performanceValueLabel, "value", "right"],
                  ["Bookings", "bookings", "right"],
                  ["Nights spent", "nights", "right"],
                  ["Avg stay", "avgStay", "right"],
                  ["Members", "members", "right"],
                ].map(([label, col, align]) => (
                  <th
                    key={col}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: T.card,
                      borderBottom: `2px solid ${T.line}`,
                      padding: "10px 12px",
                    }}
                  >
                    <SortHeader
                      label={label}
                      col={col}
                      sort={tableSort}
                      setSort={setTableSort}
                      align={align}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={r.key}
                  className="vr-row"
                  onClick={() =>
                    tableDim === "villa"
                      ? openVilla(r.name)
                      : r.key !== "Unknown" && openBedroom(r.key)
                  }
                  style={{
                    borderBottom: `1px solid ${T.lineSoft}`,
                    cursor: "pointer",
                    background:
                      tableDim === "villa" && r.name === selectedVillaName
                        ? T.mist
                        : "transparent",
                  }}
                >
                  <td style={{ padding: "11px 12px" }}>
                    <div className="flex items-center gap-3">
                      <ConfigSwatch configs={r.configs} />
                      <div>
                        <div style={{ fontSize: 13, color: T.ink }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: T.slate }}>
                          {tableDim === "villa"
                            ? r.configs?.length
                              ? `${r.configs.join(" / ")} bedroom${r.configs.length > 1 ? " layouts" : ""}`
                              : "Bedroom count not set"
                            : `${n0(r.members)} member accounts`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "11px 12px",
                      textAlign: "right",
                      fontFamily: FONT_NUM,
                      fontSize: 13,
                      color:
                        tableDim === "villa" && tableFigureMode === "free"
                          ? "#B07B33"
                          : T.deep,
                    }}
                  >
                    {money(r.value)}
                  </td>
                  <td
                    style={{
                      padding: "11px 12px",
                      textAlign: "right",
                      fontFamily: FONT_NUM,
                      fontSize: 13,
                      color: T.ink,
                    }}
                  >
                    {n0(r.bookings)}
                    {tableDim === "villa" && tableFigureMode === "overall" && (
                      <div style={{ fontSize: 10, color: T.slate }}>
                        {n0(r.paidBookings)} paid · {n0(r.freeBookings)} free
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "11px 12px",
                      textAlign: "right",
                      fontFamily: FONT_NUM,
                      fontSize: 13,
                      color: T.ink,
                    }}
                  >
                    {n0(r.nights)}
                  </td>
                  <td
                    style={{
                      padding: "11px 12px",
                      textAlign: "right",
                      fontFamily: FONT_NUM,
                      fontSize: 13,
                      color: T.muted,
                    }}
                  >
                    {r.avgStay == null ? "—" : n1(r.avgStay)}
                  </td>
                  <td
                    style={{
                      padding: "11px 12px",
                      textAlign: "right",
                      fontFamily: FONT_NUM,
                      fontSize: 13,
                      color: T.muted,
                    }}
                  >
                    {n0(r.members)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollShell>
      )}

      <p
        className="mt-3 flex items-center gap-1"
        style={{ fontSize: 12, color: T.slate }}
      >
        {tableDim === "villa"
          ? tableFigureMode === "free"
            ? "Free value is rack-rate economic value, not cash collected."
            : "Overall and Paid revenue use the Overview Villa net ledger."
          : "Money is the netted Overview ledger, so this page ties out to Finance."}
        <InfoTip id="reconcile" />
      </p>
    </div>
  );
}
