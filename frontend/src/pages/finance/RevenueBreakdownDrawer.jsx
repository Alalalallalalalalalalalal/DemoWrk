// frontend/src/pages/finance/RevenueBreakdownDrawer.jsx
// Right-side slide-over drawer for drill-down folio records.
//
// FILTER PROPAGATION
// ───────────────────
// The drawer now tracks one accumulating `filters` object for the
// whole session instead of a single drillType/drillValue pair. Every
// time the user drills deeper - clicking a mid-item, picking a row
// from a "browse by…" breakdown, or following a breadcrumb - the new
// dimension is MERGED into whatever was already active, never
// replacing it. So "Free -> Villas" (click the Free payment-type
// entry point, then choose to browse by villa) shows each villa's
// FREE revenue, and clicking a specific villa from there narrows to
// free + that villa, both filters preserved.
//
// Active filters are shown as removable chips in the header. Removing
// one drops that dimension and re-fetches with the rest intact.
//
// A "Browse by…" pivot bar sits above the flat record table, offering
// any of villa / source / category / customer that isn't already
// pinned - this is what lets ANY entry point (a summary card, a
// source row, a payment-type row, etc.) pivot into a per-villa (or
// per-source, per-category, per-customer) view without losing the
// filters that got the user there. This generalizes the same
// mechanism the "Free -> Villas" example asks for to every drilldown.
//
// Other changes kept from the original implementation:
// • No total revenue shown in header (avoids misleading negative sums)
// • Drawer is resizable via drag handle on left edge
// • FolioTable has year + month filters
// • Clicking a row expands member contact details (email, phone, city, country)
// • Info tooltip on FolioTable explains what the table shows
// • Records ordered highest amount first (done in backend)
// • Accepts a `period` prop ({ year, month } from FinanceTab's period
//   filter) and forwards it to the financeApi calls this drawer makes.
//   Intentionally NOT a dependency of the open/reset effect - changing
//   the period elsewhere while the drawer is open won't reset an
//   in-progress drill-down trail. Close + reopen to pick up a new period.

import { useEffect, useRef, useState, useMemo } from "react";
import {
  X,
  ChevronRight,
  ChevronLeft,
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
import { periodToParams, DEFAULT_PERIOD } from "./FinanceShared";

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
  v == null ? "-" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmt = (v) => (v == null ? "-" : Number(v).toLocaleString());

const MONTHS = ["All","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Rows per page for the "browse by…" breakdown table. The backend
// replaced its old hard cap (50 default / 200 max) with real
// Prev/Next paging — this is just the page size we request.
const BREAKDOWN_PAGE_SIZE = 25;


// ── Filter-dimension metadata (shared by chips + pivot bar) ────────
const FILTER_LABELS = {
  source:   "Source",
  villa:    "Villa",
  customer: "Customer",
  payment:  "Payment",
  amenity:  "Amenity",
  category: "Category",
  section:  "Section",
};

const formatFilterValue = (key, value) => {
  if (key === "payment") return value === "free" ? "Free" : "Paid";
  return value;
};

// Dimensions offered in the "Browse by…" pivot bar. Payment/amenity/
// section are entry-point filters (set by the card or row that opened
// the drawer) rather than pivot targets, so they're left out here -
// villa/source/category/customer are the ones worth re-slicing by.
const PIVOT_DIMENSIONS = [
  { key: "villa",    label: "Villa" },
  { key: "source",   label: "Source" },
  { key: "category", label: "Category" },
  { key: "customer", label: "Customer" },
];

// Maps the legacy {drillType, drillValue} shape - still emitted by
// SourceRevenueTable, AmenityRevenueTable, FinanceTables, etc. - onto
// the structured filter dict the backend understands. Centralizing
// this here means none of those child components need to change.
function legacyDrillToPatch(drillType, drillValue) {
  if (!drillType || drillType === "total") return {};
  if (drillType === "paid") return { payment: "paid" };
  if (drillType === "free" || drillType === "complimentary") return { payment: "free" };
  return { [drillType]: drillValue };
}


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
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
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


// ── Active filter chips - the net set of filters applied right now,
// independent of how many breadcrumb hops it took to build them ──
function FilterChips({ filters, onRemove }) {
  const entries = Object.entries(filters || {}).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {entries.map(([key, value]) => (
        <span
          key={key}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 6px 4px 10px", borderRadius: 999,
            background: C.panelAlt, border: `1px solid ${C.border}`,
            fontSize: 11, color: C.text, fontFamily: "sans-serif",
          }}
        >
          <span style={{
            color: C.muted, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.05em", fontSize: 9,
          }}>
            {FILTER_LABELS[key] ?? key}
          </span>
          {formatFilterValue(key, value)}
          <button
            onClick={() => onRemove(key)}
            aria-label={`Remove ${FILTER_LABELS[key] ?? key} filter`}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: C.muted, display: "flex", padding: 2, borderRadius: 999,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.accent3)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}


// ── "Browse by…" pivot bar - re-slice the current filtered set by a
// dimension that isn't already pinned ───────────────────────────
function PivotBar({ filters, onPivot, dimensionKeys = null }) {
  const candidates = dimensionKeys
    ? PIVOT_DIMENSIONS.filter((d) => dimensionKeys.includes(d.key))
    : PIVOT_DIMENSIONS;
  const available = candidates.filter((d) => filters?.[d.key] == null);
  if (available.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>Browse by</span>
      {available.map((d) => (
        <button
          key={d.key}
          onClick={() => onPivot(d.key)}
          style={{
            padding: "5px 12px", borderRadius: 999,
            border: `1px solid ${C.accent2}`, background: "transparent",
            color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer",
            fontFamily: "sans-serif",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {d.label}
        </button>
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
          description="Raw charge lines posted to member and guest folios, filtered by every active dimension shown above. Each row is one line item - a single villa night, a spa treatment, a restaurant charge, or a service fee. Sorted largest amount first."
          tips={[
            "Click a row to reveal the member's email, phone, and home location on file",
            "Search by charge description, folio number, member number, confirmation code, or villa name to find specific transactions",
            "Year and month filters narrow to a specific billing period while preserving all other active filters above",
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
                        {r.transactionDate ?? "-"}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 220, wordBreak: "break-word" }}>
                        {r.description ?? "-"}
                      </td>
                      <td style={{ ...tdStyle, color: C.muted, fontSize: 11 }}>
                        <div>{r.folioNum ?? "-"}</div>
                        <div style={{ color: C.accent }}>{r.confCode ?? ""}</div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{r.folioName ?? r.guestName ?? "-"}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {r.memberNumber ? `#${r.memberNumber}` : "Guest"}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: C.soft }}>{r.villaName ?? "-"}</td>
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


// ── Reservation-level drill-in for ONE villa — rate_details-sourced,
// NOT a folio line-item list. Parallel to FolioTable but different
// grain/fields: one row per reservation (check-in/out, total_rental,
// guest, room), not one row per billing charge. Used only when
// stepData.kind === "reservations" (see the villaReservations
// drillType branch below) — never mixed with FolioTable's rows, since
// the shapes don't match.
function ReservationTable({ rows }) {
  const [search,      setSearch]      = useState("");
  const [yearFilter,  setYearFilter]  = useState("All");
  const [expandedRow, setExpandedRow] = useState(null);

  const years = useMemo(() => {
    const ys = Array.from(
      new Set(rows.map((r) => r.checkInDate?.slice(0, 4)).filter(Boolean))
    ).sort().reverse();
    return ["All", ...ys];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (yearFilter !== "All" && !r.checkInDate?.startsWith(yearFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return [r.guestName, r.memberNumber, r.confCode, r.reservationId, r.roomNumber, r.source, r.villaName]
          .some((v) => v && String(v).toLowerCase().includes(q));
      }
      return true;
    });
  }, [rows, yearFilter, search]);

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "sans-serif" }}>
          Reservations
        </span>
        <InfoTip
          title="Villa Reservations"
          description="Individual paid, posted reservations - one villa or the whole portfolio depending on how you got here - sourced from rate_details (the same table and dedup logic behind the Villa Revenue total), not folio billing lines. Each row is one reservation, not one charge."
          tips={[
            "Click a row to reveal the member's email, phone, and home location on file",
            "Search by guest name, member number, confirmation code, room, or source to find a specific reservation",
            "Year filter narrows to a specific check-in year",
          ]}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search guest, member, conf code, room…"
          style={{
            flex: "1 1 200px", minWidth: 180,
            padding: "7px 11px", border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 12, background: C.bg, color: C.text, outline: "none",
            fontFamily: "sans-serif",
          }}
        />
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={selectStyle}>
          {years.map((y) => (
            <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>
          ))}
        </select>
        {(yearFilter !== "All" || search) && (
          <button
            onClick={() => { setSearch(""); setYearFilter("All"); }}
            style={{ ...selectStyle, color: C.muted }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginLeft: "auto" }}>
          {filtered.length} reservations
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 860 }}>
            <thead>
              <tr>
                <th style={thStyle}>Check-in → Check-out</th>
                <th style={thStyle}>Nights</th>
                <th style={thStyle}>Guest / Member</th>
                <th style={thStyle}>Villa</th>
                <th style={thStyle}>Conf Code</th>
                <th style={thStyle}>Source</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Total Rental</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: C.muted, padding: 32 }}>
                    No reservations found
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <>
                    <tr
                      key={r.reservationId ?? i}
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
                        {r.checkInDate ?? "-"} → {r.checkOutDate ?? "-"}
                      </td>
                      <td style={tdStyle}>{r.nights ?? "-"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{r.guestName ?? "-"}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {r.memberNumber ? `#${r.memberNumber}` : "Guest"}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: C.soft }}>{r.villaName ?? "-"}</td>
                      <td style={{ ...tdStyle, color: C.accent }}>{r.confCode ?? "-"}</td>
                      <td style={{ ...tdStyle, color: C.soft }}>{r.source ?? "-"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.accent }}>
                        {money(r.totalRental)}
                      </td>
                    </tr>

                    {expandedRow === i && (
                      <tr key={`${r.reservationId ?? i}-contact`}>
                        <td
                          colSpan={7}
                          style={{
                            padding: "8px 14px 14px 14px",
                            background: C.panelAlt,
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12 }}>
                            {r.roomNumber && (
                              <span style={{ color: C.soft }}>Room {r.roomNumber}</span>
                            )}
                            {r.reservationStatus && (
                              <span style={{ color: C.soft }}>{r.reservationStatus}</span>
                            )}
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


// ── Mid-level breakdown list - used both for FinanceTab-supplied
// static mid items (e.g. Total Revenue's Villas/Amenities/Services
// split) and for dynamically-fetched "browse by…" breakdowns ──────
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

// Prev/Next paging for the breakdown table - replaces the backend's
// old hard row cap (was 50 default / 200 max, now real pagination).
function BreakdownPagination({ page, totalPages, totalItems, onChange }) {
  const atFirst = page <= 1;
  const atLast  = page >= totalPages;
  const btnStyle = (disabled) => ({
    display: "flex", alignItems: "center", gap: 4,
    padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8,
    background: C.bg, cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1, fontSize: 12, color: C.text, fontFamily: "sans-serif",
  });
  return (
    <div
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>
        {fmt(totalItems)} total
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => onChange(page - 1)} disabled={atFirst} style={btnStyle(atFirst)}>
          <ChevronLeft size={14} /> Prev
        </button>
        <span style={{ fontSize: 12, color: C.soft, fontFamily: "sans-serif" }}>
          Page {page} of {totalPages}
        </span>
        <button onClick={() => onChange(page + 1)} disabled={atLast} style={btnStyle(atLast)}>
          Next <ChevronRight size={14} />
        </button>
      </div>
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
  filters: initialFilters = null,  // optional - lets a caller seed >1 dimension atomically
  midItems,
  period = DEFAULT_PERIOD,
}) {
  // `trail` holds one entry per navigation step. Each entry's `filters`
  // is the FULL cumulative filter set active at that point (not just
  // what was added at that step) - that's what makes breadcrumb
  // navigation a simple "jump to this snapshot" instead of a replay.
  //
  // step.mode: "staticMid" | "breakdown" | "records"
  const [trail, setTrail] = useState([]);
  const [stepData, setStepData] = useState({ kind: null, rows: [], groupBy: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const currentFilters = trail.length ? trail[trail.length - 1].filters : {};

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

  // ── Data loaders ───────────────────────────────────────────────
  // Villa-scoped filters (category='Villa' or section='Villa') route
  // to rate_details instead of folios - matches the same is_villa_scoped
  // rule the backend already uses for /drilldown-breakdown. This is
  // the ONE place that decision is made, so every caller that funnels
  // through loadRecords (initial open, the "Total -> Villas Revenue"
  // mid-item, a per-villa row picked from "Browse by Villa", breadcrumb
  // navigation, filter-chip removal) gets it automatically - no need
  // to special-case each entry point separately.
  //
  // payment='free' is explicitly excluded: /villa-reservations only
  // returns Paid+Posted reservations, it has no concept of Forgone
  // Revenue. A villa-scoped click that's ALSO filtered to free/comped
  // stays on the folios path rather than silently showing paid
  // reservations under a "forgone" label (or an empty list).
  function isVillaScopedFilters(filters) {
    if (!filters || filters.payment === "free") return false;
    return filters.category === "Villa" || filters.section === "Villa";
  }

  async function loadRecords(filters) {
    if (isVillaScopedFilters(filters)) {
      // filters.villa, if set (e.g. a specific row picked from "Browse
      // by Villa" while already Villa-scoped), narrows to one villa;
      // otherwise this is the whole portfolio.
      return loadVillaReservations(filters.villa);
    }
    setLoading(true);
    setError(null);
    try {
      const data = await financeApi.drilldown({ filters, ...periodToParams(period) });
      setStepData({ kind: "records", rows: data, groupBy: null });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // rate_details-sourced, NOT folios - see finance_backend.py's
  // /villa-reservations. `villaName` is optional: omitted means every
  // villa (portfolio-wide), e.g. clicking the top-level "Villas
  // Revenue" card. Called directly for the explicit villaReservations
  // drillType (a Villa Revenue table row click), and indirectly via
  // loadRecords()'s isVillaScopedFilters() check for every other
  // Villa-scoped entry point on the dashboard.
  async function loadVillaReservations(villaName) {
    setLoading(true);
    setError(null);
    try {
      const data = await financeApi.villaReservations({
        villa: villaName || undefined,
        ...periodToParams(period),
      });
      setStepData({ kind: "reservations", rows: data, groupBy: null });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // The backend now returns a paginated envelope
  // { items, page, pageSize, totalItems, totalPages } instead of a
  // bare array - see financeApi.js. `page` defaults to 1 (first load
  // / any pivot); breadcrumb navigation and Prev/Next both pass the
  // page they want explicitly.
  async function loadBreakdown(groupBy, filters, page = 1) {
    setLoading(true);
    setError(null);
    try {
      const data = await financeApi.drilldownBreakdown({
        groupBy,
        filters,
        page,
        pageSize: BREAKDOWN_PAGE_SIZE,
        ...periodToParams(period),
      });
      setStepData({
        kind: "breakdown",
        groupBy,
        page: data.page,
        totalPages: data.totalPages,
        totalItems: data.totalItems,
        rows: data.items.map((r) => ({
          label: r.label,
          revenue: r.revenue,
          count: r.transactions,
        })),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Reset when drawer opens with new context ─────────────────────
  // Intentionally NOT keyed on `period` - see file header comment.
  const initialFiltersKey = initialFilters ? JSON.stringify(initialFilters) : "";
  useEffect(() => {
    if (!open) return;

    const rootLabel = drillValue ?? "Breakdown";
    setError(null);

    // villaReservations is a distinct drillType from the generic
    // "villa" filter dimension (used elsewhere for folios-based
    // pivoting/filtering). It's set only when a Villa Revenue table
    // row is clicked directly - see FinanceTab.jsx's
    // handleVillaRowClick. No filters object, no legacyDrillToPatch:
    // this is always a single villa, rate_details-sourced, no pivot
    // dimensions apply (source/customer/amenity don't exist on
    // rate_details).
    if (drillType === "villaReservations") {
      const rootStep = { label: rootLabel, filters: { villa: drillValue }, mode: "reservations" };
      setTrail([rootStep]);
      loadVillaReservations(drillValue);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return;
    }

    const rootFilters = { ...legacyDrillToPatch(drillType, drillValue), ...(initialFilters || {}) };

    if (midItems && midItems.length > 0) {
      const rootStep = { label: rootLabel, filters: rootFilters, mode: "staticMid", items: midItems };
      setTrail([rootStep]);
      setStepData({ kind: "staticMid", rows: midItems, groupBy: null });
      setLoading(false);
    } else {
      const rootStep = { label: rootLabel, filters: rootFilters, mode: "records" };
      setTrail([rootStep]);
      loadRecords(rootFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drillType, drillValue, initialFiltersKey]);

  // ── Drill from a static mid item (e.g. Total Revenue's 3 cards) ──
  function drillIntoStaticItem(item) {
    const patch = legacyDrillToPatch(item.drillType, item.drillValue);
    const newFilters = { ...currentFilters, ...patch };
    const newStep = { label: item.label, filters: newFilters, mode: "records" };
    setTrail((prev) => [...prev, newStep]);
    loadRecords(newFilters);
  }

  // ── Drill from a dynamically-fetched "browse by…" breakdown row ──
  function drillIntoBreakdownItem(item) {
    const groupBy = stepData.groupBy;
    const newFilters = { ...currentFilters, [groupBy]: item.label };
    const newStep = { label: item.label, filters: newFilters, mode: "records" };
    setTrail((prev) => [...prev, newStep]);
    loadRecords(newFilters);
  }

  // ── Pivot the current (filtered) record set into a breakdown by a
  // new dimension - this is the "Free -> Villas" mechanism: filters
  // stay exactly as they are, we just re-group by villa ──────────
  function pivotBreakdown(groupBy) {
    const dim = PIVOT_DIMENSIONS.find((d) => d.key === groupBy);
    const newStep = {
      label: `By ${dim?.label ?? groupBy}`,
      filters: currentFilters,
      mode: "breakdown",
      groupBy,
      page: 1,
    };
    setTrail((prev) => [...prev, newStep]);
    loadBreakdown(groupBy, currentFilters, 1);
  }

  function navigateTrail(idx) {
    const step = trail[idx];
    setTrail(trail.slice(0, idx + 1));
    if (step.mode === "staticMid") {
      setStepData({ kind: "staticMid", rows: step.items, groupBy: null });
    } else if (step.mode === "breakdown") {
      loadBreakdown(step.groupBy, step.filters, step.page || 1);
    } else if (step.mode === "reservations") {
      loadVillaReservations(step.filters.villa);
    } else {
      loadRecords(step.filters);
    }
  }

  // Prev/Next on the breakdown table - re-fetches the same groupBy +
  // filters at a different page, and keeps the trail step's `page` in
  // sync so jumping back to this step via the breadcrumb returns to
  // the page the user was actually on, not back to page 1.
  function changeBreakdownPage(newPage) {
    const totalPages = stepData.totalPages || 1;
    if (newPage < 1 || newPage > totalPages) return;
    loadBreakdown(stepData.groupBy, currentFilters, newPage);
    setTrail((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.mode !== "breakdown") return prev;
      return [...prev.slice(0, -1), { ...last, page: newPage }];
    });
  }

  // ── Remove a single active filter dimension, keeping everything
  // else, and drop back to a flat record view for the reduced set ──
  function removeFilter(key) {
    const { [key]: _removed, ...rest } = currentFilters;
    const rootLabel = trail[0]?.label ?? "Breakdown";
    const newStep = { label: rootLabel, filters: rest, mode: "records" };
    setTrail([newStep]);
    loadRecords(rest);
  }

  if (!open) return null;

  const showFolios = stepData.kind === "records";
  const showReservations = stepData.kind === "reservations";
  const exportRowsData = stepData.rows;

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
              {/* Record count - no total sum to avoid confusing negatives */}
              {(showFolios || showReservations) && (
                <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>
                  {exportRowsData.length} {showReservations ? "reservations" : "records"}
                </span>
              )}
              <ExportMenu
                rows={exportRowsData}
                filenameBase={`revenue_breakdown_${safeFilePart(trail[trail.length - 1]?.label ?? drillValue ?? "all")}`}
                disabled={!exportRowsData.length}
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

          {/* Active filters - net set applied right now */}
          <div style={{ marginTop: 12 }}>
            <FilterChips filters={currentFilters} onRemove={removeFilter} />
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

          {!loading && !error && stepData.kind === "staticMid" && (
            <>
              <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginBottom: 14 }}>
                Select a category below to see underlying folio records.
              </p>
              <BreakdownList items={stepData.rows} onDrill={drillIntoStaticItem} />
            </>
          )}

          {!loading && !error && stepData.kind === "breakdown" && (
            <>
              <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginBottom: 14 }}>
                {stepData.rows.length === 0
                  ? "No matching records for the active filters."
                  : "Select a row to see its underlying folio records."}
              </p>
              <BreakdownList items={stepData.rows} onDrill={drillIntoBreakdownItem} />
              {stepData.totalPages > 1 && (
                <BreakdownPagination
                  page={stepData.page}
                  totalPages={stepData.totalPages}
                  totalItems={stepData.totalItems}
                  onChange={changeBreakdownPage}
                />
              )}
            </>
          )}

          {!loading && !error && showFolios && (
            <>
              <PivotBar filters={currentFilters} onPivot={pivotBreakdown} />
              <FolioTable rows={stepData.rows} />
            </>
          )}

          {/* rate_details-sourced, not folios. Only "villa" is offered
              here - source/customer/amenity aren't rate_details columns.
              PivotBar hides itself automatically once filters.villa is
              already set (i.e. this is already a single villa's
              reservations, e.g. reached via the villaReservations
              drillType) - "browse by villa" only makes sense from the
              portfolio-wide (all villas) view. */}
          {!loading && !error && showReservations && (
            <>
              <PivotBar filters={currentFilters} onPivot={pivotBreakdown} dimensionKeys={["villa"]} />
              <ReservationTable rows={stepData.rows} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}