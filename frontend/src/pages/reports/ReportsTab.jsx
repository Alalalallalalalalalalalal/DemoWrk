// frontend/src/pages/reports/ReportsTab.jsx
//
// Extracted from Dashboard.jsx: the fully self-contained "Reports" tab —
// table picker, row-limit picker, column search/visibility picker,
// CSV/Excel/PDF export menu, pagination, sortable table. Zero coupling to
// the rest of Dashboard's state (doesn't touch dashboard-summary/overview
// data) — needs no props from Dashboard.

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { analyticsApi } from "../../api/analytics";

export default function ReportsTab() {
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableRows, setTableRows] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [rowLimit, setRowLimit] = useState("25");
  const [selectedColumn, setSelectedColumn] = useState("");
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);

  useEffect(() => {
    analyticsApi.getTables().then(setAvailableTables).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedTable) {
      setTableRows([]);
      setSelectedColumn("");
      setVisibleColumns([]);
      setSortColumn("");
      setPage(1);
      return;
    }
    analyticsApi
      .getTableData(selectedTable)
      .then((data) => {
        const rows = Array.isArray(data) ? data : [];
        const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
        setTableRows(rows);
        setSelectedColumn(cols[0] ?? "");
        setVisibleColumns(cols);
        setSortColumn("");
        setSortDirection("asc");
        setPage(1);
        setTableSearch("");
      })
      .catch(console.error);
  }, [selectedTable]);

  useEffect(() => {
    setPage(1);
  }, [
    tableSearch,
    selectedColumn,
    selectedTable,
    rowLimit,
    sortColumn,
    sortDirection,
  ]);

  const getCV = (v) => {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (!isNaN(n) && String(v).trim() !== "") return n;
    const d = Date.parse(v);
    if (!isNaN(d)) return d;
    return String(v).toLowerCase();
  };
  const cmp = (a, b) => {
    const av = getCV(a),
      bv = getCV(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  };
  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };
  const toggleCol = (col) =>
    setVisibleColumns((c) =>
      c.includes(col) ? c.filter((x) => x !== col) : [...c, col],
    );

  const reportColumns = tableRows.length > 0 ? Object.keys(tableRows[0]) : [];
  const filteredRows = tableRows.filter((row) => {
    const s = tableSearch.trim().toLowerCase();
    if (!s || !selectedColumn) return true;
    return String(row[selectedColumn] ?? "")
      .toLowerCase()
      .includes(s);
  });
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortColumn) return 0;
    const r = cmp(a[sortColumn], b[sortColumn]);
    return sortDirection === "asc" ? r : -r;
  });
  const totalPages =
    rowLimit === "all"
      ? 1
      : Math.max(1, Math.ceil(sortedRows.length / Number(rowLimit)));
  const paginatedRows =
    rowLimit === "all"
      ? sortedRows
      : sortedRows.slice(
        (page - 1) * Number(rowLimit),
        page * Number(rowLimit),
      );

  const getExportRows = () =>
    sortedRows.map((row) => {
      const o = {};
      visibleColumns.forEach((c) => {
        o[c] = row[c] ?? "";
      });
      return o;
    });
  const fileName = (ext) =>
    `${selectedTable || "report"}_${new Date().toISOString().split("T")[0]}.${ext}`;

  const exportToCSV = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const blob = new Blob([XLSX.utils.sheet_to_csv(ws)], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName("csv");
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportToExcel = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      selectedTable || "Report",
    );
    XLSX.writeFile(wb, fileName("xlsx"));
  };
  const exportToPDF = () => {
    const rows = getExportRows();
    if (!rows.length) return;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4",
    });
    doc.setFontSize(14);
    doc.text(`${selectedTable || "Report"} Export`, 40, 35);
    autoTable(doc, {
      head: [visibleColumns],
      body: rows.map((r) => visibleColumns.map((c) => String(r[c] ?? ""))),
      startY: 50,
      styles: { fontSize: 7, cellPadding: 4 },
      headStyles: { fillColor: [44, 59, 77] },
    });
    doc.save(fileName("pdf"));
  };

  return (
    <div className="dashboard-section dashboard-section-sm">
      <div className="dashboard-card dashboard-card-roomy">
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              style={{
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid #DDD6CA",
                background: "#F7F3EC",
                color: "#1B2632",
                fontSize: 13,
                minWidth: 240,
                cursor: "pointer",
              }}
            >
              <option value="">Select Report</option>
              {availableTables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={rowLimit}
              onChange={(e) => setRowLimit(e.target.value)}
              style={{
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid #DDD6CA",
                background: "#F7F3EC",
                color: "#1B2632",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <option value="all">All Rows</option>
              <option value="25">25 Rows</option>
              <option value="100">100 Rows</option>
            </select>
            {selectedTable && (
              <span style={{ fontSize: 12, color: "#9A8E84" }}>
                {paginatedRows.length} of {sortedRows.length} rows
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {/* Column picker */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setColumnPickerOpen((v) => !v)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: "1px solid #DDD6CA",
                  background: "#F7F3EC",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "grid",
                  placeItems: "center",
                }}
                title="Search column"
              >
                🔎
              </button>
              {columnPickerOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 44,
                    right: 0,
                    background: "#FDFAF6",
                    border: "1px solid #DDD6CA",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    zIndex: 1000,
                    maxHeight: 240,
                    minWidth: 220,
                    overflowY: "auto",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#9A8E84",
                      borderBottom: "1px solid #EAE3DA",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Search in column
                  </div>
                  {reportColumns.map((col) => (
                    <div
                      key={col}
                      onClick={() => {
                        setSelectedColumn(col);
                        setColumnPickerOpen(false);
                      }}
                      style={{
                        padding: "8px 14px",
                        cursor: "pointer",
                        fontSize: 12,
                        color:
                          selectedColumn === col ? "#1B2632" : "#5A4E45",
                        background:
                          selectedColumn === col
                            ? "#F2EDE4"
                            : "transparent",
                        fontWeight: selectedColumn === col ? 700 : 400,
                      }}
                    >
                      {selectedColumn === col ? "✓ " : ""}
                      {col}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Column visibility */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setColumnVisibilityOpen((v) => !v)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: "1px solid #DDD6CA",
                  background: "#F7F3EC",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "grid",
                  placeItems: "center",
                }}
                title="Column visibility"
              >
                ☷
              </button>
              {columnVisibilityOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 44,
                    right: 0,
                    background: "#FDFAF6",
                    border: "1px solid #DDD6CA",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    zIndex: 1000,
                    maxHeight: 280,
                    minWidth: 240,
                    overflowY: "auto",
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setVisibleColumns(reportColumns)}
                      style={{
                        fontSize: 11,
                        border: "1px solid #DDD6CA",
                        borderRadius: 6,
                        background: "#F2EDE4",
                        padding: "5px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleColumns([])}
                      style={{
                        fontSize: 11,
                        border: "1px solid #DDD6CA",
                        borderRadius: 6,
                        background: "#F7F3EC",
                        padding: "5px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  {reportColumns.map((col) => (
                    <label
                      key={col}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 4px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col)}
                        onChange={() => toggleCol(col)}
                      />
                      {col}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Export */}
            {selectedTable && sortedRows.length > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setExportMenu((o) => !o)}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    border: "1px solid #DDD6CA",
                    background: "#F7F3EC",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                  }}
                  title="Export"
                >
                  <Download style={{ width: 16, height: 16 }} />
                </button>
                {exportMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: 44,
                      left: 0,
                      background: "#FDFAF6",
                      border: "1px solid #DDD6CA",
                      borderRadius: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      zIndex: 1000,
                      minWidth: 140,
                    }}
                  >
                    {[
                      ["CSV", exportToCSV],
                      ["Excel", exportToExcel],
                      ["PDF", exportToPDF],
                    ].map(([label, fn]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          fn();
                          setExportMenu(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "9px 16px",
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: 13,
                          color: "#1B2632",
                          border: "none",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search */}
            <div style={{ position: "relative" }}>
              <Search
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 14,
                  height: 14,
                  color: "#9A8E84",
                }}
              />
              <input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder={
                  selectedColumn
                    ? `Search ${selectedColumn}…`
                    : "Choose a column…"
                }
                disabled={!selectedTable || !selectedColumn}
                style={{
                  height: 38,
                  width: 240,
                  paddingLeft: 32,
                  paddingRight: 12,
                  border: "1px solid #DDD6CA",
                  borderRadius: 10,
                  fontSize: 13,
                  background: "#F7F3EC",
                  color: "#1B2632",
                  opacity: !selectedTable || !selectedColumn ? 0.5 : 1,
                }}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {selectedTable && (
          <>
            {totalPages > 1 && rowLimit !== "all" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, color: "#9A8E84" }}>
                  Page {page} of {totalPages}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #DDD6CA",
                      background: "#F7F3EC",
                      cursor: page === 1 ? "not-allowed" : "pointer",
                      opacity: page === 1 ? 0.45 : 1,
                      fontSize: 13,
                    }}
                  >
                    Prev
                  </button>
                  {Array.from(
                    { length: Math.min(totalPages, 5) },
                    (_, i) => {
                      const s = Math.min(
                        Math.max(1, page - 2),
                        Math.max(1, totalPages - 4),
                      );
                      return s + i;
                    },
                  ).map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setPage(n)}
                      style={{
                        padding: "6px 11px",
                        borderRadius: 8,
                        border: "1px solid #DDD6CA",
                        background: page === n ? "#2C3B4D" : "#F7F3EC",
                        color: page === n ? "#FFB162" : "#1B2632",
                        cursor: "pointer",
                        fontWeight: page === n ? 700 : 400,
                        fontSize: 13,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={page === totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #DDD6CA",
                      background: "#F7F3EC",
                      cursor:
                        page === totalPages ? "not-allowed" : "pointer",
                      opacity: page === totalPages ? 0.45 : 1,
                      fontSize: 13,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <div
              style={{
                overflowX: "auto",
                border: "1px solid #DDD6CA",
                borderRadius: 14,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  minWidth: 1200,
                }}
              >
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#F2EDE4",
                    zIndex: 1,
                  }}
                >
                  <tr>
                    {visibleColumns.map((col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "#7A6E63",
                          borderBottom: "2px solid #DDD6CA",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            color: "inherit",
                            font: "inherit",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {col}{" "}
                          <span
                            style={{
                              fontSize: 10,
                              color:
                                sortColumn === col
                                  ? "#FFB162"
                                  : "#B0A496",
                            }}
                          >
                            {sortColumn === col
                              ? sortDirection === "asc"
                                ? "▲"
                                : "▼"
                              : "↕"}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(visibleColumns.length, 1)}
                        style={{
                          textAlign: "center",
                          padding: 40,
                          color: "#B0A496",
                        }}
                      >
                        No rows found
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <tr
                        key={idx}
                        style={{
                          background:
                            idx % 2 === 0 ? "transparent" : "#F2EDE4",
                          borderBottom: "1px solid #EAE3DA",
                        }}
                      >
                        {visibleColumns.map((col) => (
                          <td
                            key={col}
                            style={{
                              padding: "10px 14px",
                              color: "#2C3B4D",
                            }}
                          >
                            {String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
