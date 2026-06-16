/**
 * VillaSourceBreakdown.jsx

 */

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import {
  X,
  Download,
  ChevronDown,
  DollarSign,
  Gift,
  Users,
  BedDouble,
  TrendingUp,
  Filter,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { analyticsApi } from "../../api/analytics";

// ─── Design tokens (mirrors VisitsRoomsTab) ───────────────────────────────
const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  text: "var(--dashboard-abyssal)",
  muted: "var(--dashboard-muted)",
  soft: "var(--dashboard-text-soft)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
};

const AX = "var(--dashboard-muted)";
const GRID = "var(--dashboard-border)";
const TIP = {
  background: "var(--dashboard-abyssal)",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 12,
};
const LABEL_STYLE = {
  fill: "var(--dashboard-muted)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
};

// Paid = deep blue, Free / comp = flame/amber
const COLOR_PAID = "var(--dashboard-deep-blue)";
const COLOR_FREE = "var(--dashboard-flame)";

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d));
const pct = (part, whole, d = 1) =>
  !Number(whole || 0)
    ? "0%"
    : `${((Number(part || 0) / Number(whole || 0)) * 100).toFixed(d)}%`;
const safeFilePart = (v) =>
  String(v || "all")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

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
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    downloadFile(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      `${filenameBase}.csv`,
    );
  } else if (format === "excel") {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  } else if (format === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    const columns = Object.keys(rows[0] ?? {});
    doc.text(filenameBase.replaceAll("_", " "), 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [columns],
      body: rows.map((r) => columns.map((c) => r[c] ?? "")),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 48, 70] },
    });
    doc.save(`${filenameBase}.pdf`);
  }
}

const searchRows = (rows, q) => {
  const term = q.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) =>
    Object.values(row).some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(term),
    ),
  );
};

const sortRows = (rows, key, dir = "asc") => {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a?.[key],
      bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av),
      bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * mult;
    return (
      String(av).localeCompare(String(bv), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * mult
    );
  });
};

// ─── Sub-components ───────────────────────────────────────────────────────
function Select({ label, value, onChange, options }) {
  const optLabel = (o) => {
    if (o === "All") return `All ${label}s`;
    if (o === "asc") return "Ascending";
    if (o === "desc") return "Descending";
    return String(o)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="dashboard-eyebrow">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          background: C.bg,
          color: C.text,
          fontSize: 12,
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {optLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExportMenu({ rows, filenameBase, disabled }) {
  const [open, setOpen] = useState(false);
  const doExport = (fmt) => {
    exportRows(rows, filenameBase, fmt);
    setOpen(false);
  };
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
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
        }}
      >
        <Download size={13} /> Export <ChevronDown size={12} />
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
          ].map(([f, l]) => (
            <button
              key={f}
              type="button"
              onClick={() => doExport(f)}
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
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Source-type pill toggle ──────────────────────────────────────────────
const VIEW_MODES = [
  { key: "overall", label: "Overall", icon: TrendingUp },
  { key: "paid", label: "Paid", icon: DollarSign },
  { key: "free", label: "Free / Comp", icon: Gift },
];

function ViewToggle({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 4,
      }}
    >
      {VIEW_MODES.map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 10,
              border: "none",
              background: active ? C.accent : "transparent",
              color: active ? "#fff" : C.muted,
              fontWeight: active ? 800 : 500,
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── KPI tile ─────────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, sub, meta, highlight, onClick }) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${highlight ? C.accent3 : C.border}`,
        borderRadius: 18,
        padding: "16px 18px",
        background: highlight
          ? "rgba(var(--dashboard-flame-rgb, 210,80,50), 0.06)"
          : C.panel,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 6,
        }}
      >
        {Icon && <Icon size={13} color={highlight ? C.accent3 : C.accent2} />}
        <span className="dashboard-eyebrow">{label}</span>
      </div>
      <div
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 28,
          color: C.text,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>
      )}
      {meta && (
        <div
          style={{
            fontSize: 11,
            color: C.soft,
            marginTop: 8,
            lineHeight: 1.45,
          }}
        >
          {meta}
        </div>
      )}
      {clickable && (
        <div
          style={{
            color: C.accent,
            fontSize: 10,
            fontWeight: 800,
            marginTop: 8,
          }}
        >
          Open breakdown
        </div>
      )}
    </button>
  );
}

function MiniSplitBar({ paid, free }) {
  const total = Number(paid || 0) + Number(free || 0);
  const paidWidth = total ? (Number(paid || 0) / total) * 100 : 0;
  const freeWidth = total ? (Number(free || 0) / total) * 100 : 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          background: C.bg,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ width: `${paidWidth}%`, background: COLOR_PAID }} />
        <div style={{ width: `${freeWidth}%`, background: COLOR_FREE }} />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: C.muted,
          fontSize: 10,
          marginTop: 4,
        }}
      >
        <span>{pct(paid, total)} paid</span>
        <span>{pct(free, total)} free/comp</span>
      </div>
    </div>
  );
}

function ScrollTableShell({ children, maxHeight = 420 }) {
  return (
    <div
      style={{
        overflow: "auto",
        maxHeight,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
      }}
    >
      {children}
    </div>
  );
}

// ─── Booking timeline card (mirrors villa modal in VisitsRoomsTab) ────────
function BookingCard({ booking, index }) {
  const guests = Array.isArray(booking.guests) ? booking.guests : [];
  const primaryName =
    booking.member_full_name ??
    booking.member_name ??
    booking.folio_name ??
    booking.guest_name ??
    "Unknown guest";

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "38px 1fr",
        gap: 14,
        marginBottom: 16,
      }}
    >
      {/* index dot */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: booking.is_free ? C.accent3 : C.accent,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 800,
          zIndex: 1,
          marginTop: 10,
        }}
      >
        {index + 1}
      </div>

      <div
        style={{
          border: `1px solid ${booking.is_free ? C.accent3 : C.border}`,
          background: index === 0 ? C.panelAlt : C.panel,
          borderRadius: 20,
          padding: 18,
          boxShadow: booking.is_free
            ? "0 0 0 2px rgba(210,80,50,0.12)"
            : "0 10px 28px rgba(0,0,0,0.04)",
        }}
      >
        {/* header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 850, color: C.text }}>
                {primaryName}
              </div>
              {/* paid / free badge */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  background: booking.is_free
                    ? "rgba(210,80,50,0.12)"
                    : "rgba(30,80,150,0.10)",
                  color: booking.is_free ? C.accent3 : C.accent,
                  border: `1px solid ${booking.is_free ? C.accent3 : C.accent}`,
                }}
              >
                {booking.is_free ? <Gift size={9} /> : <DollarSign size={9} />}
                {booking.is_free ? "Free / Comp" : "Paid"}
              </span>
            </div>
            <div style={{ color: C.soft, fontSize: 12, marginTop: 4 }}>
              Member #{booking.member_number ?? "—"} · Conf{" "}
              {booking.conf_code ?? "—"}
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
              Source:{" "}
              <strong style={{ color: C.soft }}>
                {booking.source ?? "Unknown"}
              </strong>
              {" · "}
              Payment:{" "}
              <strong style={{ color: C.soft }}>
                {booking.payment_type ?? "—"}
              </strong>
            </div>
          </div>

          <div style={{ textAlign: "right", minWidth: 110 }}>
            <div style={{ fontWeight: 900, color: C.text, fontSize: 18 }}>
              {money(booking.total_amount)}
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>
              {booking.is_free ? "Comp value" : "Paid revenue"}
            </div>
            {booking.is_free && (
              <div
                style={{
                  fontSize: 10,
                  color: C.accent3,
                  fontWeight: 700,
                  marginTop: 2,
                  textTransform: "uppercase",
                }}
              >
                Not counted in revenue
              </div>
            )}
          </div>
        </div>

        {/* stay strip */}
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 10,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 12,
          }}
        >
          <div>
            <div className="dashboard-eyebrow">Check-in</div>
            <div style={{ color: C.text, fontWeight: 800 }}>
              {booking.check_in_date ?? "—"}
            </div>
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: "7px 12px",
              background: C.panelAlt,
              color: C.accent,
              fontWeight: 800,
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            {fmt(booking.nights)} nights · {fmt(booking.persons)} guests
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="dashboard-eyebrow">Check-out</div>
            <div style={{ color: C.text, fontWeight: 800 }}>
              {booking.check_out_date ?? "—"}
            </div>
          </div>
        </div>

        {/* member details grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
            marginTop: 12,
          }}
        >
          {[
            ["Email", booking.email ?? "—"],
            ["Phone", booking.phone ?? "—"],
            ["Address", booking.address ?? "—"],
          ].map(([lbl, val]) => (
            <div
              key={lbl}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 11,
                background: C.bg,
              }}
            >
              <div className="dashboard-eyebrow">{lbl}</div>
              <div
                style={{ color: C.soft, fontSize: 12, wordBreak: "break-word" }}
              >
                {val}
              </div>
            </div>
          ))}
        </div>

        {/* member meta row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            marginTop: 10,
          }}
        >
          {[
            ["Member type", booking.member_type ?? "—"],
            ["Account", booking.member_or_guest ?? "—"],
            ["Bedrooms", booking.bedroom_count ?? "—"],
            ["Villa", booking.villa_name ?? "—"],
          ].map(([lbl, val]) => (
            <div
              key={lbl}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "9px 11px",
                background: C.bg,
              }}
            >
              <div className="dashboard-eyebrow" style={{ fontSize: 9 }}>
                {lbl}
              </div>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>
                {val}
              </div>
            </div>
          ))}
        </div>

        {/* guest manifest */}
        {guests.length > 0 && (
          <div style={{ marginTop: 15 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div className="dashboard-eyebrow">Guest manifest</div>
              <div style={{ color: C.muted, fontSize: 11 }}>
                {guests.length} guest{guests.length === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {guests.map((g, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    padding: "8px 11px",
                    background: g.is_owner ? C.panelAlt : C.bg,
                    color: C.text,
                    fontSize: 12,
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 800 }}>
                    {g.guest_name ?? "Unnamed guest"}
                  </span>
                  <span style={{ color: C.muted }}>
                    {g.is_owner ? "Owner" : "Guest"}
                  </span>
                  {g.room_number && (
                    <span style={{ color: C.soft }}>Room {g.room_number}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────
export default function VillaSourceBreakdown({ years, months }) {
  // ── Filters ──────────────────────────────────────────────────────────────
  const [year, setYear] = useState("All");
  const [month, setMonth] = useState("All");
  const [viewMode, setViewMode] = useState("overall"); // overall | paid | free
  const [sourceFilter, setSourceFilter] = useState("All");
  const [villaChartLimit, setVillaChartLimit] = useState("15");

  const toFilters = (y, m) => ({
    year: y === "All" ? null : Number(y),
    month: m === "All" ? null : months.indexOf(m),
  });
  const activeFilters = useMemo(() => toFilters(year, month), [year, month]);

  // ── Source-breakdown data ─────────────────────────────────────────────────
  const [breakdownRaw, setBreakdownRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allSources, setAllSources] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    analyticsApi
      .villaSourceBreakdown(activeFilters)
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setBreakdownRaw(rows);
        // Derive unique sources for filter
        const srcs = [
          ...new Set(rows.map((r) => r.source || "Unknown")),
        ].sort();
        setAllSources(srcs);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilters]);

  // ── Aggregate: villa-level summary for bar chart ──────────────────────────
  const villaChartData = useMemo(() => {
    // Filter by view mode and source
    let rows = breakdownRaw;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);

    // Roll up to villa level
    const map = new Map();
    rows.forEach((r) => {
      const key = r.villa_name;
      if (!map.has(key)) {
        map.set(key, {
          villa_name: key,
          paid_bookings: 0,
          free_bookings: 0,
          total_bookings: 0,
          revenue: 0,
          free_value: 0,
          total_value: 0,
          total_nights: 0,
          unique_members: 0,
        });
      }
      const e = map.get(key);
      if (r.is_free) {
        e.free_bookings += Number(r.bookings ?? 0);
        e.free_value += Number(r.free_value ?? r.total_value ?? 0);
      } else {
        e.paid_bookings += Number(r.bookings ?? 0);
        e.revenue += Number(r.revenue ?? 0);
      }
      e.total_bookings += Number(r.bookings ?? 0);
      e.total_nights += Number(r.total_nights ?? 0);
      e.total_value += Number(r.total_value ?? 0);
    });
    return [...map.values()].sort(
      (a, b) => b.total_bookings - a.total_bookings,
    );
  }, [breakdownRaw, viewMode, sourceFilter]);

  // ── Source breakdown table (for selected villa) ───────────────────────────
  const [selectedVilla, setSelectedVilla] = useState(null);

  const villaSourceRows = useMemo(() => {
    if (!selectedVilla) return [];
    let rows = breakdownRaw.filter((r) => r.villa_name === selectedVilla);
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    return rows;
  }, [breakdownRaw, selectedVilla, viewMode, sourceFilter]);

  // ── KPIs (view-mode aware) ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let rows = breakdownRaw;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);

    const totalBookings = rows.reduce((s, r) => s + Number(r.bookings ?? 0), 0);
    const totalPaid = rows
      .filter((r) => !r.is_free)
      .reduce((s, r) => s + Number(r.bookings ?? 0), 0);
    const totalFree = rows
      .filter((r) => r.is_free)
      .reduce((s, r) => s + Number(r.bookings ?? 0), 0);
    const revenue = rows
      .filter((r) => !r.is_free)
      .reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const freeValue = rows
      .filter((r) => r.is_free)
      .reduce((s, r) => s + Number(r.free_value ?? 0), 0);
    const totalNights = rows.reduce(
      (s, r) => s + Number(r.total_nights ?? 0),
      0,
    );

    return {
      totalBookings,
      totalPaid,
      totalFree,
      revenue,
      freeValue,
      totalNights,
    };
  }, [breakdownRaw, viewMode, sourceFilter]);

  const visibleVillaChartData = useMemo(() => {
    if (villaChartLimit === "All") return villaChartData;
    return villaChartData.slice(0, Number(villaChartLimit));
  }, [villaChartData, villaChartLimit]);

  const sourceSummaryRows = useMemo(() => {
    let rows = breakdownRaw;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All") {
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    }

    const map = new Map();
    rows.forEach((r) => {
      const source = r.source || "Unknown";
      if (!map.has(source)) {
        map.set(source, {
          source,
          villa_count: new Set(),
          paid_bookings: 0,
          free_bookings: 0,
          total_bookings: 0,
          revenue: 0,
          free_value: 0,
          total_nights: 0,
          unique_members: 0,
        });
      }
      const e = map.get(source);
      if (r.villa_name) e.villa_count.add(r.villa_name);
      if (r.is_free) {
        e.free_bookings += Number(r.bookings ?? 0);
        e.free_value += Number(r.free_value ?? r.total_value ?? 0);
      } else {
        e.paid_bookings += Number(r.bookings ?? 0);
        e.revenue += Number(r.revenue ?? 0);
      }
      e.total_bookings += Number(r.bookings ?? 0);
      e.total_nights += Number(r.total_nights ?? 0);
      e.unique_members += Number(r.unique_members ?? 0);
    });

    return [...map.values()]
      .map((r) => ({ ...r, villa_count: r.villa_count.size }))
      .sort(
        (a, b) => Number(b.total_bookings || 0) - Number(a.total_bookings || 0),
      );
  }, [breakdownRaw, viewMode, sourceFilter]);

  const selectedVillaTotals = useMemo(() => {
    const paid = villaSourceRows.filter((r) => !r.is_free);
    const free = villaSourceRows.filter((r) => r.is_free);
    const totalBookings = villaSourceRows.reduce(
      (s, r) => s + Number(r.bookings ?? 0),
      0,
    );
    const paidBookings = paid.reduce((s, r) => s + Number(r.bookings ?? 0), 0);
    const freeBookings = free.reduce((s, r) => s + Number(r.bookings ?? 0), 0);
    return {
      totalBookings,
      paidBookings,
      freeBookings,
      revenue: paid.reduce((s, r) => s + Number(r.revenue ?? 0), 0),
      freeValue: free.reduce((s, r) => s + Number(r.free_value ?? 0), 0),
      nights: villaSourceRows.reduce(
        (s, r) => s + Number(r.total_nights ?? 0),
        0,
      ),
    };
  }, [villaSourceRows]);

  const sourceInsights = useMemo(() => {
    const rows = villaChartData;
    const nonZeroTotal = rows.filter((r) => Number(r.total_bookings || 0) > 0);
    const nonZeroPaid = rows.filter((r) => Number(r.paid_bookings || 0) > 0);
    const nonZeroFree = rows.filter((r) => Number(r.free_bookings || 0) > 0);
    const nonZeroRevenue = rows.filter((r) => Number(r.revenue || 0) > 0);
    const by = (arr, key, dir = "desc") =>
      [...arr].sort((a, b) =>
        dir === "asc"
          ? Number(a[key] || 0) - Number(b[key] || 0)
          : Number(b[key] || 0) - Number(a[key] || 0),
      )[0] ?? null;
    return {
      mostBooked: by(nonZeroTotal, "total_bookings"),
      leastBooked: by(nonZeroTotal, "total_bookings", "asc"),
      mostPaid: by(nonZeroPaid, "paid_bookings"),
      mostFree: by(nonZeroFree, "free_bookings"),
      mostRevenue: by(nonZeroRevenue, "revenue"),
      mostCompValue: by(
        rows.filter((r) => Number(r.free_value || 0) > 0),
        "free_value",
      ),
    };
  }, [villaChartData]);

  const openAllVillaBreakdown = (mode = viewMode) => {
    setSummaryModalMode(mode);
    setSummaryModalOpen(true);
  };

  // ── Drilldown modal ───────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVilla, setModalVilla] = useState(null);
  const [modalSource, setModalSource] = useState(null);
  const [modalIsFree, setModalIsFree] = useState(null); // null|true|false
  const [modalBookings, setModalBookings] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalYear, setModalYear] = useState("All");
  const [modalMonth, setModalMonth] = useState("All");
  const [modalSearch, setModalSearch] = useState("");
  const [modalSortKey, setModalSortKey] = useState("check_in_date");
  const [modalSortDir, setModalSortDir] = useState("desc");
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryModalMode, setSummaryModalMode] = useState("overall");
  const [summarySearch, setSummarySearch] = useState("");
  const [summarySortKey, setSummarySortKey] = useState("total_bookings");
  const [summarySortDir, setSummarySortDir] = useState("desc");

  const modalFilters = useMemo(
    () => toFilters(modalYear, modalMonth),
    [modalYear, modalMonth],
  );

  // Fetch drilldown when modal is open
  useEffect(() => {
    if (!modalOpen || !modalVilla) return;
    let cancelled = false;
    setModalLoading(true);
    const params = {
      ...modalFilters,
      ...(modalSource !== null && modalSource !== "All"
        ? { source: modalSource }
        : {}),
      ...(modalIsFree !== null ? { is_free: modalIsFree } : {}),
    };
    analyticsApi
      .villaSourceBookings(modalVilla, params)
      .then((data) => {
        if (!cancelled) setModalBookings(Array.isArray(data) ? data : []);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setModalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOpen, modalVilla, modalSource, modalIsFree, modalFilters]);

  const openModal = (villa, source = null, isFree = null) => {
    setModalVilla(villa);
    setModalSource(source);
    setModalIsFree(isFree);
    setModalYear(year);
    setModalMonth(month);
    setModalSearch("");
    setModalOpen(true);
  };

  const filteredModalBookings = useMemo(() => {
    const searched = searchRows(modalBookings, modalSearch);
    return sortRows(searched, modalSortKey, modalSortDir);
  }, [modalBookings, modalSearch, modalSortKey, modalSortDir]);

  const summaryModalRows = useMemo(() => {
    let rows = breakdownRaw;
    if (summaryModalMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (summaryModalMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    const mapped = rows.map((r) => ({
      villa_name: r.villa_name ?? "Unknown villa",
      source: r.source || "Unknown",
      payment_type: r.payment_type ?? "—",
      type: r.is_free ? "Free / Comp" : "Paid",
      total_bookings: Number(r.bookings ?? 0),
      paid_bookings: r.is_free ? 0 : Number(r.bookings ?? 0),
      free_bookings: r.is_free ? Number(r.bookings ?? 0) : 0,
      total_nights: Number(r.total_nights ?? 0),
      revenue: r.is_free ? 0 : Number(r.revenue ?? 0),
      free_value: r.is_free ? Number(r.free_value ?? r.total_value ?? 0) : 0,
      unique_members: Number(r.unique_members ?? 0),
      is_free: r.is_free,
    }));
    return sortRows(
      searchRows(mapped, summarySearch),
      summarySortKey,
      summarySortDir,
    );
  }, [
    breakdownRaw,
    summaryModalMode,
    sourceFilter,
    summarySearch,
    summarySortKey,
    summarySortDir,
  ]);

  // ── Export rows ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];

  const modalExportRows = filteredModalBookings.map((b) => ({
    Villa: b.villa_name ?? "",
    Guest: b.member_full_name || b.member_name || b.guest_name || "",
    "Member #": b.member_number ?? "",
    "Member Type": b.member_type ?? "",
    Account: b.member_or_guest ?? "",
    Email: b.email ?? "",
    Phone: b.phone ?? "",
    Address: b.address ?? "",
    Country: b.country ?? "",
    State: b.state ?? "",
    Source: b.source ?? "",
    "Payment Type": b.payment_type ?? "",
    "Paid / Free": b.is_free ? "Free/Comp" : "Paid",
    "Total Amount": b.total_amount ?? "",
    "Check In": b.check_in_date ?? "",
    "Check Out": b.check_out_date ?? "",
    Nights: b.nights ?? "",
    Guests: b.persons ?? "",
    "Conf Code": b.conf_code ?? "",
    "Reservation Status": b.reservation_status ?? "",
  }));

  const modalFilename = `${safeFilePart(modalVilla)}_source_${safeFilePart(modalSource)}_${safeFilePart(modalIsFree === true ? "free" : modalIsFree === false ? "paid" : "all")}_${safeFilePart(modalYear)}_${today}`;

  const breakdownExportRows = villaSourceRows.map((r) => ({
    Villa: r.villa_name ?? "",
    Source: r.source ?? "",
    "Payment Type": r.payment_type ?? "",
    "Paid / Free": r.is_free ? "Free/Comp" : "Paid",
    Bookings: r.bookings ?? "",
    "Total Nights": r.total_nights ?? "",
    Revenue: r.revenue ?? "",
    "Free Value": r.free_value ?? "",
    "Total Value": r.total_value ?? "",
    "Unique Members": r.unique_members ?? "",
  }));

  const breakdownFilename = `source_breakdown_${safeFilePart(selectedVilla)}_${safeFilePart(year)}_${today}`;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-section">
      {/* ── Section header ──────────────────────────────────────────────── */}
      <div
        className="dashboard-card"
        style={{
          padding: 16,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <div className="dashboard-eyebrow">Visits & Rooms</div>
          <h2 className="dashboard-card-title" style={{ marginBottom: 0 }}>
            Bookings by Business Source
          </h2>
          <p
            style={{
              color: C.muted,
              fontSize: 12,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            Source-level villa performance by paid bookings, free/comp bookings,
            revenue, comp value, room nights, and member counts.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <Select
            label="Year"
            value={year}
            onChange={setYear}
            options={years}
          />
          <Select
            label="Month"
            value={month}
            onChange={setMonth}
            options={months}
          />
        </div>
      </div>

      {/* ── View toggle + source filter ──────────────────────────────────── */}
      <div
        className="dashboard-card"
        style={{
          padding: "14px 18px",
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <ViewToggle
          value={viewMode}
          onChange={(v) => {
            setViewMode(v);
            setSelectedVilla(null);
          }}
        />

        <div
          style={{
            height: 32,
            width: 1,
            background: C.border,
            margin: "0 4px",
          }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Filter size={13} color={C.muted} />
          <span className="dashboard-eyebrow">Source</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.text,
              fontSize: 12,
            }}
          >
            <option value="All">All Sources</option>
            {allSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {sourceFilter !== "All" && (
          <button
            type="button"
            onClick={() => {
              setSourceFilter("All");
              setSelectedVilla(null);
            }}
            style={{
              border: `1px solid ${C.border}`,
              background: C.panelAlt,
              color: C.accent,
              borderRadius: 999,
              padding: "7px 11px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Clear source
          </button>
        )}

        {loading && (
          <span style={{ color: C.muted, fontSize: 12 }}>Loading…</span>
        )}
      </div>

      {/* ── KPI band ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
          gap: 12,
        }}
      >
        <KpiTile
          icon={BedDouble}
          label="Total Bookings"
          value={fmt(kpis.totalBookings)}
          sub="Paid + free/comp bookings"
          meta={`${pct(kpis.totalPaid, kpis.totalBookings)} paid · ${pct(kpis.totalFree, kpis.totalBookings)} free/comp`}
          onClick={() => openAllVillaBreakdown("overall")}
        />
        <KpiTile
          icon={DollarSign}
          label="Paid Bookings"
          value={fmt(kpis.totalPaid)}
          sub="Revenue bookings"
          meta={`${pct(kpis.totalPaid, kpis.totalBookings)} of total bookings`}
          onClick={() => openAllVillaBreakdown("paid")}
        />
        <KpiTile
          icon={Gift}
          label="Free / Comp Stays"
          value={fmt(kpis.totalFree)}
          sub="Non-revenue bookings"
          meta={`${pct(kpis.totalFree, kpis.totalBookings)} of total bookings`}
          highlight={kpis.totalFree > 0}
          onClick={() => openAllVillaBreakdown("free")}
        />
        <KpiTile
          icon={TrendingUp}
          label="Paid Revenue"
          value={money(kpis.revenue)}
          sub="Paid folio value"
          meta="Filtered by current year, month, view, and source."
          onClick={() => openAllVillaBreakdown("paid")}
        />
        <KpiTile
          icon={Gift}
          label="Comp Value"
          value={money(kpis.freeValue)}
          sub="Free/comp value"
          meta="Tracked separately from paid revenue."
          highlight={kpis.freeValue > 0}
          onClick={() => openAllVillaBreakdown("free")}
        />
        <KpiTile
          icon={Users}
          label="Total Room Nights"
          value={fmt(kpis.totalNights)}
          sub="Occupancy impact"
          meta="Includes paid and free/comp nights."
          onClick={() => openAllVillaBreakdown("overall")}
        />
      </div>

      {/* ── Extremes card ────────────────────────────────────────────────── */}
      <div className="dashboard-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div>
            <div className="dashboard-eyebrow">Villa Extremes</div>
            <h2 className="dashboard-card-title">
              Most / Least Booked, Paid, Free/Comp, and Revenue
            </h2>
            <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
              Ranking is based on the active year, month, source, and paid/free
              filter.
            </p>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {[
            [
              "Most Booked",
              sourceInsights.mostBooked,
              "total_bookings",
              "bookings",
            ],
            [
              "Least Booked",
              sourceInsights.leastBooked,
              "total_bookings",
              "bookings",
            ],
            [
              "Most Paid",
              sourceInsights.mostPaid,
              "paid_bookings",
              "paid bookings",
            ],
            [
              "Most Free / Comp",
              sourceInsights.mostFree,
              "free_bookings",
              "free/comp bookings",
            ],
            [
              "Top Revenue",
              sourceInsights.mostRevenue,
              "revenue",
              "paid revenue",
            ],
            [
              "Top Comp Value",
              sourceInsights.mostCompValue,
              "free_value",
              "comp value",
            ],
          ].map(([label, villa, key, suffix]) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                villa?.villa_name && setSelectedVilla(villa.villa_name)
              }
              style={{
                textAlign: "left",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                background: C.panel,
                padding: 14,
                cursor: villa?.villa_name ? "pointer" : "default",
              }}
            >
              <div className="dashboard-eyebrow">{label}</div>
              <div
                style={{
                  color: C.text,
                  fontWeight: 850,
                  fontSize: 16,
                  marginTop: 4,
                }}
              >
                {villa?.villa_name ?? "—"}
              </div>
              <div style={{ color: C.soft, fontSize: 12, marginTop: 4 }}>
                {key === "revenue" || key === "free_value"
                  ? money(villa?.[key])
                  : fmt(villa?.[key])}{" "}
                {suffix}
              </div>
              {villa && (
                <MiniSplitBar
                  paid={villa.paid_bookings}
                  free={villa.free_bookings}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Business source summary ──────────────────────────────────────── */}
      <div className="dashboard-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div>
            <div className="dashboard-eyebrow">Business Source Summary</div>
            <h2 className="dashboard-card-title">Source Performance</h2>
            <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
              Click a source to filter the All Villas chart and villa breakdowns
              by that source.
            </p>
          </div>
        </div>
        <ScrollTableShell maxHeight={340}>
          <table
            style={{
              width: "100%",
              minWidth: 860,
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: C.bg,
                zIndex: 1,
              }}
            >
              <tr className="dashboard-eyebrow">
                {[
                  "Source",
                  "Villas",
                  "Bookings",
                  "Paid",
                  "Free / Comp",
                  "Split",
                  "Paid Revenue",
                  "Comp Value",
                  "Nights",
                  "Members",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign:
                        h === "Source" || h === "Split" ? "left" : "right",
                      padding: "10px",
                      borderBottom: `1px solid ${C.border}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sourceSummaryRows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{ padding: 20, textAlign: "center", color: C.muted }}
                  >
                    No source records for the current filters.
                  </td>
                </tr>
              )}
              {sourceSummaryRows.map((r) => (
                <tr
                  key={r.source}
                  onClick={() => {
                    setSourceFilter(r.source);
                    setSelectedVilla(null);
                  }}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = C.panel)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td style={{ padding: 10, color: C.text, fontWeight: 800 }}>
                    {r.source}
                  </td>
                  <td
                    style={{ padding: 10, textAlign: "right", color: C.soft }}
                  >
                    {fmt(r.villa_count)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      textAlign: "right",
                      color: C.text,
                      fontWeight: 800,
                    }}
                  >
                    {fmt(r.total_bookings)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      textAlign: "right",
                      color: C.accent,
                      fontWeight: 800,
                    }}
                  >
                    {fmt(r.paid_bookings)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      textAlign: "right",
                      color: C.accent3,
                      fontWeight: 800,
                    }}
                  >
                    {fmt(r.free_bookings)}
                  </td>
                  <td style={{ padding: 10, minWidth: 160 }}>
                    <MiniSplitBar
                      paid={r.paid_bookings}
                      free={r.free_bookings}
                    />
                  </td>
                  <td
                    style={{ padding: 10, textAlign: "right", color: C.text }}
                  >
                    {money(r.revenue)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      textAlign: "right",
                      color: C.accent3,
                    }}
                  >
                    {money(r.free_value)}
                  </td>
                  <td
                    style={{ padding: 10, textAlign: "right", color: C.soft }}
                  >
                    {fmt(r.total_nights)}
                  </td>
                  <td
                    style={{ padding: 10, textAlign: "right", color: C.soft }}
                  >
                    {fmt(r.unique_members)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTableShell>
      </div>

      {/* ── Stacked bar chart: paid vs free per villa ─────────────────────── */}
      <div className="dashboard-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div>
            <div className="dashboard-eyebrow">All Villas</div>
            <h2 className="dashboard-card-title">
              {viewMode === "overall"
                ? "Paid vs Free Bookings by Villa"
                : viewMode === "paid"
                  ? "Paid Bookings by Villa"
                  : "Free / Comp Bookings by Villa"}
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <Select
              label="Show"
              value={villaChartLimit}
              onChange={setVillaChartLimit}
              options={["10", "15", "30", "40", "50", "All"]}
            />
            <div
              style={{
                fontSize: 11,
                color: C.muted,
                textAlign: "right",
                maxWidth: 260,
              }}
            >
              Click a bar to select a villa. The selected source filter remains
              applied.
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              minWidth: Math.max(visibleVillaChartData.length * 76, 520),
              height: 320,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={visibleVillaChartData}
                margin={{ top: 8, right: 16, bottom: 90, left: 16 }}
                onClick={(e) => {
                  if (e?.activeLabel) setSelectedVilla(e.activeLabel);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="villa_name"
                  stroke={AX}
                  fontSize={11}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={90}
                  label={{
                    value: "Villa",
                    position: "insideBottom",
                    offset: -20,
                    style: LABEL_STYLE,
                  }}
                />
                <YAxis
                  stroke={AX}
                  fontSize={11}
                  label={{
                    value: "Bookings",
                    angle: -90,
                    position: "insideLeft",
                    offset: 10,
                    dy: 40,
                    style: LABEL_STYLE,
                  }}
                />
                <Tooltip
                  contentStyle={TIP}
                  formatter={(value, name) => [
                    fmt(value),
                    name === "paid_bookings"
                      ? "Paid"
                      : name === "free_bookings"
                        ? "Free/Comp"
                        : name,
                  ]}
                />
                {viewMode !== "free" && (
                  <Bar
                    dataKey="paid_bookings"
                    name="paid_bookings"
                    fill={COLOR_PAID}
                    radius={
                      viewMode === "overall" ? [0, 0, 0, 0] : [6, 6, 0, 0]
                    }
                    stackId="a"
                    cursor="pointer"
                  >
                    {visibleVillaChartData.map((entry) => (
                      <Cell
                        key={entry.villa_name}
                        fill={
                          selectedVilla === entry.villa_name
                            ? "var(--dashboard-truffle)"
                            : COLOR_PAID
                        }
                      />
                    ))}
                  </Bar>
                )}
                {viewMode !== "paid" && (
                  <Bar
                    dataKey="free_bookings"
                    name="free_bookings"
                    fill={COLOR_FREE}
                    radius={[6, 6, 0, 0]}
                    stackId="a"
                    cursor="pointer"
                  >
                    {visibleVillaChartData.map((entry) => (
                      <Cell
                        key={entry.villa_name}
                        fill={
                          selectedVilla === entry.villa_name
                            ? "#e0a060"
                            : COLOR_FREE
                        }
                      />
                    ))}
                  </Bar>
                )}
                {viewMode === "overall" && (
                  <Legend
                    formatter={(value) =>
                      value === "paid_bookings" ? "Paid" : "Free/Comp"
                    }
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Source breakdown table for selected villa ─────────────────────── */}
      {selectedVilla && (
        <div className="dashboard-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 16,
            }}
          >
            <div>
              <div className="dashboard-eyebrow">Selected villa</div>
              <h2 className="dashboard-card-title" style={{ marginBottom: 2 }}>
                {selectedVilla} — Source Breakdown
              </h2>
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                Rows reflect the active source, year, month, and paid/free
                filters.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ExportMenu
                rows={breakdownExportRows}
                filenameBase={breakdownFilename}
                disabled={!breakdownExportRows.length}
              />
              <button
                onClick={() => setSelectedVilla(null)}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  color: C.muted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <KpiTile
              icon={BedDouble}
              label="Villa Bookings"
              value={fmt(selectedVillaTotals.totalBookings)}
              sub="Paid + free/comp"
              meta={`${pct(selectedVillaTotals.paidBookings, selectedVillaTotals.totalBookings)} paid · ${pct(selectedVillaTotals.freeBookings, selectedVillaTotals.totalBookings)} free/comp`}
              onClick={() => openModal(selectedVilla, sourceFilter, null)}
            />
            <KpiTile
              icon={DollarSign}
              label="Villa Paid"
              value={fmt(selectedVillaTotals.paidBookings)}
              sub={money(selectedVillaTotals.revenue)}
              meta="Paid booking records"
              onClick={() => openModal(selectedVilla, sourceFilter, false)}
            />
            <KpiTile
              icon={Gift}
              label="Villa Free / Comp"
              value={fmt(selectedVillaTotals.freeBookings)}
              sub={money(selectedVillaTotals.freeValue)}
              meta="Free/comp booking records"
              highlight={selectedVillaTotals.freeBookings > 0}
              onClick={() => openModal(selectedVilla, sourceFilter, true)}
            />
            <KpiTile
              icon={Users}
              label="Villa Nights"
              value={fmt(selectedVillaTotals.nights)}
              sub="Paid + free/comp nights"
              meta="Occupancy total"
              onClick={() => openModal(selectedVilla, sourceFilter, null)}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <MiniSplitBar
              paid={selectedVillaTotals.paidBookings}
              free={selectedVillaTotals.freeBookings}
            />
          </div>

          <ScrollTableShell maxHeight={420}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr className="dashboard-eyebrow">
                  {[
                    "Source",
                    "Payment Type",
                    "Type",
                    "Bookings",
                    "Nights",
                    "Revenue",
                    "Comp Value",
                    "Members",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign:
                          h === "Source" || h === "Payment Type"
                            ? "left"
                            : "right",
                        padding: "10px 10px",
                        borderBottom: `1px solid ${C.border}`,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {villaSourceRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: C.muted,
                      }}
                    >
                      No records for current filter
                    </td>
                  </tr>
                )}
                {villaSourceRows.map((r, i) => (
                  <tr
                    key={`${r.source}-${r.payment_type}-${r.is_free}-${i}`}
                    onClick={() =>
                      openModal(selectedVilla, r.source, r.is_free)
                    }
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      background: r.is_free
                        ? "rgba(210,80,50,0.05)"
                        : "transparent",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = C.panel)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = r.is_free
                        ? "rgba(210,80,50,0.05)"
                        : "transparent")
                    }
                  >
                    <td
                      style={{
                        padding: "10px 10px",
                        color: C.text,
                        fontWeight: 600,
                      }}
                    >
                      {r.source}
                    </td>
                    <td style={{ padding: "10px 10px", color: C.soft }}>
                      {r.payment_type}
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          background: r.is_free
                            ? "rgba(210,80,50,0.12)"
                            : "rgba(30,80,150,0.10)",
                          color: r.is_free ? C.accent3 : C.accent,
                        }}
                      >
                        {r.is_free ? (
                          <Gift size={9} />
                        ) : (
                          <DollarSign size={9} />
                        )}
                        {r.is_free ? "Free" : "Paid"}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        color: C.soft,
                      }}
                    >
                      {fmt(r.bookings)}
                    </td>
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        color: C.soft,
                      }}
                    >
                      {fmt(r.total_nights)}
                    </td>
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        color: r.is_free ? C.muted : C.text,
                        fontWeight: r.is_free ? 400 : 700,
                      }}
                    >
                      {r.is_free ? "—" : money(r.revenue)}
                    </td>
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        color: r.is_free ? C.accent3 : C.muted,
                        fontWeight: r.is_free ? 700 : 400,
                      }}
                    >
                      {r.is_free ? money(r.free_value) : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        color: C.soft,
                      }}
                    >
                      {fmt(r.unique_members)}
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals footer */}
              {villaSourceRows.length > 0 &&
                (() => {
                  const paid = villaSourceRows.filter((r) => !r.is_free);
                  const free = villaSourceRows.filter((r) => r.is_free);
                  return (
                    <tfoot>
                      <tr
                        style={{
                          background: C.panelAlt,
                          borderTop: `2px solid ${C.border}`,
                          fontWeight: 800,
                        }}
                      >
                        <td
                          style={{ padding: "10px 10px", color: C.text }}
                          colSpan={3}
                        >
                          Totals
                        </td>
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.text,
                          }}
                        >
                          {fmt(
                            villaSourceRows.reduce(
                              (s, r) => s + Number(r.bookings ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.text,
                          }}
                        >
                          {fmt(
                            villaSourceRows.reduce(
                              (s, r) => s + Number(r.total_nights ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.text,
                          }}
                        >
                          {money(
                            paid.reduce(
                              (s, r) => s + Number(r.revenue ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.accent3,
                          }}
                        >
                          {money(
                            free.reduce(
                              (s, r) => s + Number(r.free_value ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.text,
                          }}
                        >
                          —
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
            </table>
          </ScrollTableShell>
        </div>
      )}

      {/* ── Aggregate breakdown modal ───────────────────────────────────── */}
      {summaryModalOpen && (
        <div
          onClick={() => setSummaryModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(8,18,32,0.48)",
            backdropFilter: "blur(3px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(980px, 96vw)",
              height: "100vh",
              background: C.bg,
              borderLeft: `1px solid ${C.border}`,
              boxShadow: "-24px 0 60px rgba(0,0,0,0.22)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                background: C.bg,
                borderBottom: `1px solid ${C.border}`,
                padding: "22px 26px 18px",
              }}
            >
              <button
                onClick={() => setSummaryModalOpen(false)}
                style={{
                  position: "absolute",
                  right: 22,
                  top: 22,
                  border: `1px solid ${C.border}`,
                  background: C.panel,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  cursor: "pointer",
                  color: C.text,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
              <div className="dashboard-eyebrow">Aggregate breakdown</div>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 34,
                  color: C.text,
                  margin: "4px 48px 4px 0",
                  lineHeight: 1,
                }}
              >
                {summaryModalMode === "paid"
                  ? "Paid Bookings"
                  : summaryModalMode === "free"
                    ? "Free / Comp Stays"
                    : "Total Bookings"}
              </h2>
              <div style={{ color: C.muted, fontSize: 12 }}>
                All villas · Source: {sourceFilter} · Year: {year} · Month:{" "}
                {month}
              </div>
            </div>

            <div style={{ padding: 26 }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <input
                  value={summarySearch}
                  onChange={(e) => setSummarySearch(e.target.value)}
                  placeholder="Search villa, source, payment type..."
                  style={{
                    flex: "1 1 260px",
                    padding: "9px 11px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    color: C.text,
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <Select
                  label="Sort"
                  value={summarySortKey}
                  onChange={setSummarySortKey}
                  options={[
                    "villa_name",
                    "source",
                    "payment_type",
                    "total_bookings",
                    "paid_bookings",
                    "free_bookings",
                    "total_nights",
                    "revenue",
                    "free_value",
                    "unique_members",
                  ]}
                />
                <Select
                  label="Order"
                  value={summarySortDir}
                  onChange={setSummarySortDir}
                  options={["asc", "desc"]}
                />
              </div>
              <ScrollTableShell maxHeight={680}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 980,
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      background: C.bg,
                      zIndex: 1,
                    }}
                  >
                    <tr className="dashboard-eyebrow">
                      {[
                        "Villa",
                        "Source",
                        "Payment",
                        "Type",
                        "Bookings",
                        "Paid",
                        "Free / Comp",
                        "Nights",
                        "Revenue",
                        "Comp Value",
                        "Members",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: [
                              "Villa",
                              "Source",
                              "Payment",
                              "Type",
                            ].includes(h)
                              ? "left"
                              : "right",
                            padding: "10px",
                            borderBottom: `1px solid ${C.border}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryModalRows.map((r, i) => (
                      <tr
                        key={`${r.villa_name}-${r.source}-${r.payment_type}-${i}`}
                        onClick={() => {
                          setSummaryModalOpen(false);
                          setSelectedVilla(r.villa_name);
                          openModal(r.villa_name, r.source, r.is_free);
                        }}
                        style={{
                          borderBottom: `1px solid ${C.border}`,
                          cursor: "pointer",
                          background: r.is_free
                            ? "rgba(210,80,50,0.04)"
                            : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: 10,
                            color: C.text,
                            fontWeight: 800,
                          }}
                        >
                          {r.villa_name}
                        </td>
                        <td style={{ padding: 10, color: C.soft }}>
                          {r.source}
                        </td>
                        <td style={{ padding: 10, color: C.soft }}>
                          {r.payment_type}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            color: r.is_free ? C.accent3 : C.accent,
                            fontWeight: 800,
                          }}
                        >
                          {r.type}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.text,
                            fontWeight: 800,
                          }}
                        >
                          {fmt(r.total_bookings)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.accent,
                          }}
                        >
                          {fmt(r.paid_bookings)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.accent3,
                          }}
                        >
                          {fmt(r.free_bookings)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {fmt(r.total_nights)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.text,
                          }}
                        >
                          {money(r.revenue)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.accent3,
                          }}
                        >
                          {money(r.free_value)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {fmt(r.unique_members)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTableShell>
            </div>
          </aside>
        </div>
      )}

      {/* ── Drilldown modal ──────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(8,18,32,0.48)",
            backdropFilter: "blur(3px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(880px, 96vw)",
              height: "100vh",
              background: C.bg,
              borderLeft: `1px solid ${C.border}`,
              boxShadow: "-24px 0 60px rgba(0,0,0,0.22)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Sticky header */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                background: C.bg,
                borderBottom: `1px solid ${C.border}`,
                padding: "22px 26px 18px",
              }}
            >
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  position: "absolute",
                  right: 22,
                  top: 22,
                  border: `1px solid ${C.border}`,
                  background: C.panel,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  cursor: "pointer",
                  color: C.text,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>

              <div className="dashboard-eyebrow">Booking drilldown</div>

              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 34,
                  color: C.text,
                  margin: "4px 48px 4px 0",
                  lineHeight: 1,
                }}
              >
                {modalVilla}
              </h2>

              <div
                style={{ color: C.muted, fontSize: 12, margin: "8px 48px 0 0" }}
              >
                Booking-level records for the selected villa/source/status.
              </div>

              {/* context pills */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                {modalSource && modalSource !== "All" && (
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: C.panelAlt,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                    }}
                  >
                    Source: {modalSource}
                  </span>
                )}
                {modalIsFree !== null && (
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: modalIsFree
                        ? "rgba(210,80,50,0.10)"
                        : "rgba(30,80,150,0.10)",
                      border: `1px solid ${modalIsFree ? C.accent3 : C.accent}`,
                      color: modalIsFree ? C.accent3 : C.accent,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {modalIsFree ? (
                      <Gift size={10} />
                    ) : (
                      <DollarSign size={10} />
                    )}
                    {modalIsFree ? "Free / Comp only" : "Paid only"}
                  </span>
                )}
              </div>

              {/* Modal-level filters */}
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Select
                  label="Year"
                  value={modalYear}
                  onChange={setModalYear}
                  options={years}
                />
                <Select
                  label="Month"
                  value={modalMonth}
                  onChange={setModalMonth}
                  options={months}
                />
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: 26, flex: 1 }}>
              {/* Controls row */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <input
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder="Search bookings…"
                  style={{
                    flex: "1 1 220px",
                    minWidth: 0,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    color: C.text,
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <Select
                  label="Sort"
                  value={modalSortKey}
                  onChange={setModalSortKey}
                  options={[
                    "check_in_date",
                    "check_out_date",
                    "member_full_name",
                    "total_amount",
                    "nights",
                    "source",
                    "payment_type",
                  ]}
                />
                <Select
                  label="Order"
                  value={modalSortDir}
                  onChange={setModalSortDir}
                  options={["asc", "desc"]}
                />
              </div>

              {/* Count + export */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    color: C.muted,
                    fontSize: 12,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    padding: "7px 11px",
                    background: C.panelAlt,
                  }}
                >
                  {modalLoading
                    ? "Loading…"
                    : `${filteredModalBookings.length} of ${modalBookings.length} records`}
                </div>
                <ExportMenu
                  rows={modalExportRows}
                  filenameBase={modalFilename}
                  disabled={modalLoading || !modalExportRows.length}
                />
              </div>

              {/* Booking timeline */}
              {modalLoading ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: C.muted,
                    border: `1px dashed ${C.border}`,
                    borderRadius: 18,
                  }}
                >
                  Loading booking details…
                </div>
              ) : filteredModalBookings.length === 0 ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: C.muted,
                    border: `1px dashed ${C.border}`,
                    borderRadius: 18,
                  }}
                >
                  No bookings found for the current filters.
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  {/* timeline rail */}
                  <div
                    style={{
                      position: "absolute",
                      left: 17,
                      top: 8,
                      bottom: 8,
                      width: 2,
                      background: C.border,
                    }}
                  />
                  {filteredModalBookings.map((b, i) => (
                    <BookingCard key={b.conf_code ?? i} booking={b} index={i} />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
