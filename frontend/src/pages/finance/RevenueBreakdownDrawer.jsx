// frontend/src/pages/finance/RevenueBreakdownDrawer.jsx
// Right-side slide-over drawer for drill-down folio records.
//
// Changes from original:
// • No total revenue shown in header (avoids misleading negative sums)
// • Drawer is resizable via drag handle on left edge
// • FolioTable has year + month filters
// • Clicking a row expands member contact details (email, phone, city, country)
// • Info tooltip on FolioTable explains what the table shows
// • Records ordered highest amount first (done in backend)

import { useEffect, useRef, useState, useMemo } from "react";
import {
  X,
  ChevronRight,
  Info,
  Mail,
  Phone,
  MapPin,
  Download,
  ChevronDown,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { financeApi } from "../../api/financeApi";

const C = {
  bg:      "var(--dashboard-card)",
  panel:   "var(--dashboard-panel)",
  panelAlt:"var(--dashboard-panel-alt)",
  border:  "var(--dashboard-border)",
  text:    "var(--dashboard-abyssal)",
  muted:   "var(--dashboard-muted)",
  soft:    "var(--dashboard-text-soft)",
  accent:  "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
};

const money = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

const MONTHS = ["All","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];


// ---Exported component only below this line---
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function exportRows(rows, filenameBase, format) {
  if (!rows.length) return;

  if (format === "csv") {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    downloadFile(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      `${filenameBase}.csv`,
    );
  }

  if (format === "excel") {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
    XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
  }

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    const columns = Object.keys(rows[0] ?? {});

    doc.text(filenameBase.replaceAll("_", " "), 14, 14);

    autoTable(doc, {
      startY: 20,
      head: [columns],
      body: rows.map((row) => columns.map((col) => row[col] ?? "")),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 48, 70] },
    });

    doc.save(`${filenameBase}.pdf`);
  }
}

const safeFilePart = (value) =>
  String(value || "all")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const exportButtonStyle = (disabled) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 10,
  border: `1px solid ${C.accent2}`,
  background: C.panelAlt,
  color: C.accent,
  fontSize: 12,
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
});

function ExportMenu({ rows, filenameBase, disabled }) {
  const [open, setOpen] = useState(false);

  const doExport = (format) => {
    exportRows(rows, filenameBase, format);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={exportButtonStyle(disabled)}
      >
        <Download size={13} />
        Export
        <ChevronDown size={12} />
      </button>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            minWidth: 130,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            boxShadow: "0 10px 26px rgba(0,0,0,0.14)",
            overflow: "hidden",
          }}
        >
          {[
            ["csv", "CSV"],
            ["excel", "Excel"],
            ["pdf", "PDF"],
          ].map(([format, label]) => (
            <button
              key={format}
              type="button"
              onClick={() => doExport(format)}
              style={{
                display: "block",
                width: "100%",
                padding: "9px 12px",
                border: "none",
                background: "transparent",
                color: C.text,
                textAlign: "left",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small info tooltip ──────────────────────────────────────────
function InfoTip({ title, description, tips = [] }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-flex"}}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Table information"
        style={{
          background: "none", border: "none", padding: 4,
          cursor: "pointer", color: open ? C.accent2 : C.muted,
          display: "flex", alignItems: "center",
        }}
      >
        <Info size={14} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
          <div
            style={{
              position: "fixed", top: 170, right: 350, zIndex: 2000,
              width: 280, background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
              padding: "14px 16px", fontSize: 12, color: C.muted,
              lineHeight: 1.55, fontFamily: "sans-serif",
            }}
          >
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute", top: 8, right: 8, background: "none",
                border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex",
              }}
            >
              <X size={13} />
            </button>
            <p style={{ margin: "0 0 8px", color: C.text, fontWeight: 700, paddingRight: 16 }}>
              {title}
            </p>
            <p style={{ margin: tips.length ? "0 0 10px" : 0 }}>{description}</p>
            {tips.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}


// ── Breadcrumb trail ────────────────────────────────────────────
function Breadcrumbs({ trail, onNavigate }) {
  if (!trail.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
      {trail.map((crumb, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <ChevronRight size={12} color={C.muted} />}
          <button
            onClick={() => onNavigate(i)}
            style={{
              background: "none", border: "none",
              cursor: i < trail.length - 1 ? "pointer" : "default",
              padding: "2px 6px", borderRadius: 6, fontSize: 12,
              fontWeight: i === trail.length - 1 ? 700 : 400,
              color: i === trail.length - 1 ? C.text : C.accent,
              fontFamily: "sans-serif",
              textDecoration: i < trail.length - 1 ? "underline" : "none",
            }}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </div>
  );
}


// ── Folio records table ─────────────────────────────────────────
function FolioTable({ rows }) {
  const [search,      setSearch]      = useState("");
  const [yearFilter,  setYearFilter]  = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [expandedRow, setExpandedRow] = useState(null);

  // Build year options from row data
  const years = useMemo(() => {
    const ys = Array.from(
      new Set(rows.map((r) => r.transactionDate?.slice(0, 4)).filter(Boolean))
    ).sort().reverse();
    return ["All", ...ys];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // Year filter
      if (yearFilter !== "All" && !r.transactionDate?.startsWith(yearFilter)) return false;
      // Month filter
      if (monthFilter !== "All") {
        const mo = MONTHS.indexOf(monthFilter); // 1-based since MONTHS[0]="All"
        const rowMo = r.transactionDate
          ? parseInt(r.transactionDate.split("-")[1], 10)
          : null;
        if (rowMo !== mo) return false;
      }
      // Text search
      if (search) {
        const q = search.toLowerCase();
        return [r.description, r.folioName, r.memberNumber, r.guestName, r.villaName, r.confCode]
          .some((v) => v && String(v).toLowerCase().includes(q));
      }
      return true;
    });
  }, [rows, yearFilter, monthFilter, search]);

  const thStyle = {
    padding: "9px 12px", background: C.panelAlt, color: C.soft,
    fontWeight: 700, fontSize: 10, textTransform: "uppercase",
    letterSpacing: "0.07em", borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 2,
    textAlign: "left", fontFamily: "sans-serif",
  };

  const tdStyle = {
    padding: "9px 12px", borderBottom: `1px solid var(--dashboard-row-border)`,
    color: C.text, fontSize: 12, verticalAlign: "top", fontFamily: "sans-serif",
  };

  const selectStyle = {
    padding: "6px 9px", border: `1px solid ${C.border}`, borderRadius: 7,
    fontSize: 12, background: C.bg, color: C.text, outline: "none",
    fontFamily: "sans-serif", cursor: "pointer",
  };

  return (
    <div>
      {/* Table header with info tooltip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "sans-serif" }}>
          Transaction Records
        </span>
        <InfoTip
          title="Folio Transaction Records"
          description="Individual charge lines from the folios table matching the selected filter. Ordered highest amount first."
          tips={[
            "Click any row to see member contact details",
            "Use the search bar to filter by description, folio name, member number, or villa",
            "Filter by year and month using the dropdowns above the table",
          ]}
        />
      </div>

      {/* Filters row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, folio, member…"
          style={{
            flex: "1 1 200px", minWidth: 180,
            padding: "7px 11px", border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 12, background: C.bg, color: C.text, outline: "none",
            fontFamily: "sans-serif",
          }}
        />

        {/* Year filter */}
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={selectStyle}>
          {years.map((y) => (
            <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>
          ))}
        </select>

        {/* Month filter */}
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} style={selectStyle}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>
          ))}
        </select>

        {/* Clear filters */}
        {(yearFilter !== "All" || monthFilter !== "All" || search) && (
          <button
            onClick={() => { setSearch(""); setYearFilter("All"); setMonthFilter("All"); }}
            style={{ ...selectStyle, color: C.muted }}
          >
            Clear
          </button>
        )}

        <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginLeft: "auto" }}>
          {filtered.length} records
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Folio / Conf</th>
                <th style={thStyle}>Member / Guest</th>
                <th style={thStyle}>Villa</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: C.muted, padding: 32 }}>
                    No records found
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <>
                    <tr
                      key={r.folioKey ?? i}
                      onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      style={{
                        cursor: "pointer",
                        background: i % 2 === 0 ? "transparent" : C.panel,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          expandedRow === i ? C.panelAlt : i % 2 === 0 ? "transparent" : C.panel)
                      }
                    >
                      <td style={{ ...tdStyle, whiteSpace: "nowrap", color: C.muted }}>
                        {r.transactionDate ?? "—"}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 220, wordBreak: "break-word" }}>
                        {r.description ?? "—"}
                      </td>
                      <td style={{ ...tdStyle, color: C.muted, fontSize: 11 }}>
                        <div>{r.folioNum ?? "—"}</div>
                        <div style={{ color: C.accent }}>{r.confCode ?? ""}</div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{r.folioName ?? r.guestName ?? "—"}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {r.memberNumber ? `#${r.memberNumber}` : "Guest"}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: C.soft }}>{r.villaName ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.accent }}>
                        {money(r.amount)}
                      </td>
                    </tr>

                    {/* Expandable member contact row */}
                    {expandedRow === i && (
                      <tr key={`${r.folioKey ?? i}-contact`}>
                        <td
                          colSpan={6}
                          style={{
                            padding: "8px 14px 14px 14px",
                            background: C.panelAlt,
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12 }}>
                            {r.memberEmail && (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.soft }}>
                                <Mail size={12} color={C.muted} />
                                <a
                                  href={`mailto:${r.memberEmail}`}
                                  style={{ color: C.accent, textDecoration: "underline" }}
                                >
                                  {r.memberEmail}
                                </a>
                              </span>
                            )}
                            {r.memberPhone && (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.soft }}>
                                <Phone size={12} color={C.muted} />
                                {r.memberPhone}
                              </span>
                            )}
                            {(r.memberCity || r.memberCountry) && (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.soft }}>
                                <MapPin size={12} color={C.muted} />
                                {[r.memberCity, r.memberCountry].filter(Boolean).join(", ")}
                              </span>
                            )}
                            {!r.memberEmail && !r.memberPhone && !r.memberCity && !r.memberCountry && (
                              <span style={{ color: C.muted, fontStyle: "italic" }}>
                                No contact details on file for this member
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Mid-level breakdown list ─────────────────────────────────────
function BreakdownList({ items, onDrill }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => onDrill(item)}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 10,
            background: i % 2 === 0 ? C.bg : C.panel, cursor: "pointer",
            textAlign: "left", transition: "background 0.12s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.bg : C.panel)}
        >
          <div>
            <div style={{ fontWeight: 600, color: C.text, fontSize: 13, fontFamily: "sans-serif" }}>
              {item.label}
            </div>
            {item.sub && (
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginTop: 2 }}>
                {item.sub}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, color: C.accent, fontSize: 14, fontFamily: "sans-serif" }}>
              {money(item.revenue)}
            </span>
            {item.count != null && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>
                {fmt(item.count)} txn
              </span>
            )}
            <ChevronRight size={14} color={C.muted} />
          </div>
        </button>
      ))}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// DRAWER  –  exported component
// ══════════════════════════════════════════════════════════════════
export default function RevenueBreakdownDrawer({
  open,
  onClose,
  drillType,
  drillValue,
  midItems,
}) {
  const [trail,           setTrail]           = useState([]);
  const [folioRows,       setFolioRows]       = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [showFolios,      setShowFolios]      = useState(false);
  const [currentMidItems, setCurrentMidItems] = useState(midItems ?? []);

  // ── Resizable drawer ─────────────────────────────────────────────
  const MIN_WIDTH  = 460;
  const MAX_WIDTH  = () => Math.floor(window.innerWidth * 0.96);
  const [drawerWidth, setDrawerWidth] = useState(820);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onDragStart = (e) => {
    isDragging.current  = true;
    dragStartX.current  = e.clientX;
    dragStartW.current  = drawerWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor    = "ew-resize";
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const next  = Math.min(Math.max(dragStartW.current + delta, MIN_WIDTH), MAX_WIDTH());
      setDrawerWidth(next);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current          = false;
      document.body.style.userSelect = "";
      document.body.style.cursor    = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [drawerWidth]);

  // ── Reset when drawer opens with new context ─────────────────────
  useEffect(() => {
    if (!open) return;
    setTrail([{ label: drillValue ?? "Breakdown", drillType, drillValue }]);
    setFolioRows([]);
    setError(null);
    setShowFolios(false);
    setCurrentMidItems(midItems ?? []);

    if (!midItems || midItems.length === 0) {
      loadFolios(drillType, drillValue);
    }
  }, [open, drillType, drillValue]);

  async function loadFolios(type, value) {
    setLoading(true);
    setError(null);
    try {
      const data = await financeApi.drilldown(type, value);
      setFolioRows(data);
      setShowFolios(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function drillIntoItem(item) {
    setTrail((prev) => [
      ...prev,
      { label: item.label, drillType: item.drillType, drillValue: item.drillValue },
    ]);
    loadFolios(item.drillType, item.drillValue);
  }

  function navigateTrail(idx) {
    const crumb    = trail[idx];
    const newTrail = trail.slice(0, idx + 1);
    setTrail(newTrail);
    if (idx === 0 && currentMidItems.length > 0) {
      setShowFolios(false);
      setFolioRows([]);
    } else {
      loadFolios(crumb.drillType, crumb.drillValue);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "var(--dashboard-overlay)",
          zIndex: 900, backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: drawerWidth,
          background: C.bg,
          boxShadow: "var(--dashboard-shadow-panel)",
          zIndex: 901,
          display: "flex", flexDirection: "column",
          borderLeft: `3px solid ${C.accent2}`,
          // smooth resize feel
          transition: isDragging.current ? "none" : "width 0.05s",
        }}
      >
        {/* ── Drag handle on left edge ── */}
        <div
          onMouseDown={onDragStart}
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 6,
            cursor: "ew-resize", zIndex: 10,
            // subtle visual hint on hover
          }}
          title="Drag to resize"
        />

        {/* ── Header ── */}
        <div
          style={{
            padding: "22px 26px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="dashboard-eyebrow">Revenue Breakdown</div>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 28, color: C.text, margin: "4px 0 0", lineHeight: 1.15,
                }}
              >
                {trail[trail.length - 1]?.label ?? drillValue}
              </h2>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Record count — no total sum to avoid confusing negatives */}
              {showFolios && (
                <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>
                  {folioRows.length} records
                </span>
              )}
              <ExportMenu
                rows={showFolios ? folioRows : currentMidItems}
                filenameBase={`revenue_breakdown_${safeFilePart(trail[trail.length - 1]?.label ?? drillValue ?? "all")}`}
                disabled={!(showFolios ? folioRows.length : currentMidItems.length)}
              />
              <button
                onClick={onClose}
                style={{
                  width: 36, height: 36, borderRadius: 999,
                  border: `1px solid ${C.border}`, background: C.bg,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", color: C.soft,
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Resize hint */}
          <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>
            Drag the left edge to resize this panel.
          </p>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 26px 32px" }}>
          <Breadcrumbs trail={trail} onNavigate={navigateTrail} />

          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontFamily: "sans-serif" }}>
              Loading records…
            </div>
          )}

          {error && (
            <div style={{ padding: 16, color: "#C45B5B", fontSize: 13, fontFamily: "sans-serif" }}>
              {error}
            </div>
          )}

          {!loading && !error && !showFolios && currentMidItems.length > 0 && (
            <>
              <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginBottom: 14 }}>
                Select a category below to see underlying folio records.
              </p>
              <BreakdownList items={currentMidItems} onDrill={drillIntoItem} />
            </>
          )}

          {!loading && !error && showFolios && (
            <FolioTable rows={folioRows} />
          )}
        </div>
      </aside>
    </>
  );
}