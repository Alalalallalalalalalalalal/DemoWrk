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
  LayoutGrid,
  Info,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { analyticsApi } from "../../api/analytics";

// ─── Design tokens ────────────────────────────────────────────────────────────
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

const COLOR_PAID = "var(--dashboard-deep-blue)";
const COLOR_FREE = "var(--dashboard-flame)";

// bedroom palette (7 colours cycle)
const BED_COLORS = [
  "var(--dashboard-deep-blue)",
  "var(--dashboard-flame)",
  "var(--dashboard-truffle)",
  "#6ab0c8",
  "#8ac47a",
  "#c4a04a",
  "#a47ac4",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD`;
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

const dateFilterLabel = (filter) => {
  if (!filter) return "All available data";
  if (filter.mode === "day")
    return filter.date ? `Specific day: ${filter.date}` : "All available data";
  if (filter.mode === "range")
    return filter.startDate && filter.endDate
      ? `Date range: ${filter.startDate} to ${filter.endDate}`
      : "All available data";
  const year = filter.year === "All" ? "All years" : `Year: ${filter.year}`;
  const month =
    filter.month === "All" ? "All months" : `Month: ${filter.month}`;
  return `${year} · ${month}`;
};

function PeriodPill({ label = "Data period", filter }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${C.border}`,
        background: C.panelAlt,
        color: C.soft,
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 800,
      }}
    >
      {label}: {dateFilterLabel(filter)}
    </span>
  );
}

const withExportContext = (rows, context) =>
  rows.map((row) => ({
    "Export Period": context.period,
    "Export Source Filter": context.source,
    "Export View": context.view,
    ...row,
  }));

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

// ─── Sub-components ───────────────────────────────────────────────────────────
function Select({ label, value, onChange, options }) {
  const optLabel = (o) => {
    if (o === "All") return `All ${label}s`;
    if (o === "ym") return "Year / Month";
    if (o === "day") return "Specific Day";
    if (o === "range") return "Date Range";
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

function DateFilterBar({ value, onChange, years, months }) {
  const update = (patch) => onChange({ ...value, ...patch });
  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 12,
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <Select
        label="Mode"
        value={value.mode}
        onChange={(mode) => update({ mode })}
        options={["ym", "day", "range"]}
      />
      {value.mode === "ym" && (
        <>
          <Select
            label="Year"
            value={value.year}
            onChange={(year) => update({ year })}
            options={years}
          />
          <Select
            label="Month"
            value={value.month}
            onChange={(month) => update({ month })}
            options={months}
          />
        </>
      )}
      {value.mode === "day" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dashboard-eyebrow">Date</span>
          <input
            type="date"
            value={value.date}
            onChange={(e) => update({ date: e.target.value })}
            style={inputStyle}
          />
        </label>
      )}
      {value.mode === "range" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="dashboard-eyebrow">Start</span>
            <input
              type="date"
              value={value.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="dashboard-eyebrow">End</span>
            <input
              type="date"
              value={value.endDate}
              onChange={(e) => update({ endDate: e.target.value })}
              style={inputStyle}
            />
          </label>
        </>
      )}
    </div>
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

const METRIC_INFO = {
  "Total Members":
    "Distinct booked member numbers. Member numbers are collected from valid rate_details bookings, linked rooms, and Villa Income statement records, then classified through members.member_or_guest.",
  "Total Members Booked":
    "Distinct booked member numbers. Member numbers are collected from valid rate_details bookings, linked rooms, and Villa Income statement records, then classified through members.member_or_guest.",
  "Total Guests":
    "Guest or party information comes from reservation_guests, grouped by confirmation code. A booking with no guest records defaults to one person.",
  "Total Guests Booked":
    "Distinct booked person numbers classified as Guest through members.member_or_guest.",
  "Total Bookings":
    "One booking equals one unique confirmation code from rate_details. Only the latest valid row is kept; Unposted, cancelled, canceled, and no-show reservations are excluded.",
  "Paid Bookings":
    "Unique valid confirmation codes from rate_details whose payment_type is not classified as free or complimentary.",
  "Free / Comp":
    "Unique valid confirmation codes from rate_details whose payment_type indicates free, comp, complimentary, gratis, or no charge.",
  "Free / Comp Bookings":
    "Unique valid confirmation codes from rate_details whose payment_type indicates free, comp, complimentary, gratis, or no charge.",
  "Paid Revenue":
    "Paid value comes from rate_details.total_rental on the latest valid row for each unique confirmation code. Free and complimentary bookings are excluded.",
  "Comp Value":
    "Complimentary value comes from rate_details.total_rental for bookings classified as free or complimentary. It is tracked separately from paid revenue.",
  "Total Room Nights":
    "Room nights count distinct room_number and rate_date combinations within each valid confirmation code. Stay length is used as a fallback when room-date detail is unavailable.",
  "Villa Bookings":
    "Valid unique confirmation codes from rate_details for the selected villa. Different confirmation codes remain separate even when dates or villa names match.",
  "Villa Paid":
    "Paid valid confirmation codes for the selected villa. The amount shown comes from rate_details.total_rental.",
  "Villa Free / Comp":
    "Free or complimentary valid confirmation codes for the selected villa. The amount shown comes from rate_details.total_rental.",
  "Villa Nights":
    "Room-night occupancy for the selected villa, based on distinct room and rate-date combinations per confirmation code, with stay length used as a fallback.",
  "Most Booked":
    "Villa with the highest count of valid unique confirmation codes in the displayed period and source filter.",
  "Least Booked":
    "Villa with the lowest non-zero count of valid unique confirmation codes in the displayed period and source filter.",
  "Most Paid":
    "Villa with the highest count of valid paid confirmation codes in the displayed period and source filter.",
  "Most Free / Comp":
    "Villa with the highest count of valid free or complimentary confirmation codes in the displayed period and source filter.",
  "Most Booked Bedroom":
    "Bedroom size with the highest count of valid unique confirmation codes.",
  "Most Comp'd Bedroom":
    "Bedroom size with the highest count of valid free or complimentary confirmation codes.",
};

function getMetricInfo(label, suppliedInfo) {
  if (suppliedInfo) return suppliedInfo;
  if (METRIC_INFO[label]) return METRIC_INFO[label];

  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("booking")) return METRIC_INFO["Total Bookings"];
  if (normalized.includes("revenue")) return METRIC_INFO["Paid Revenue"];
  if (normalized.includes("comp") || normalized.includes("free"))
    return METRIC_INFO["Comp Value"];
  if (normalized.includes("night")) return METRIC_INFO["Total Room Nights"];
  if (normalized.includes("member")) return METRIC_INFO["Total Members"];
  if (normalized.includes("guest") || normalized.includes("party"))
    return METRIC_INFO["Total Guests"];
  return "Calculated from the dashboard data for the displayed date range and active filters.";
}

function InfoTip({ label, text }) {
  const [open, setOpen] = useState(false);
  const content = getMetricInfo(label, text);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        marginLeft: "auto",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`How ${label} is calculated`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          padding: 0,
          border: `1px solid ${C.border}`,
          borderRadius: "50%",
          background: C.bg,
          color: C.muted,
          cursor: "help",
        }}
      >
        <Info size={13} />
      </button>

      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 7px)",
            zIndex: 100,
            width: 290,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--dashboard-abyssal)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.5,
            boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  meta,
  info,
  active = false,
  highlight = false,
  onClick,
}) {
  const clickable = Boolean(onClick);
  const selected = active || highlight;
  const activate = () => clickable && onClick();

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (clickable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          activate();
        }
      }}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${selected ? C.accent2 : C.border}`,
        borderRadius: 18,
        padding: "16px 18px",
        background: selected ? C.panelAlt : C.panel,
        cursor: clickable ? "pointer" : "default",
        boxSizing: "border-box",
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
        {Icon && <Icon size={13} color={selected ? C.accent : C.accent2} />}
        <span className="dashboard-eyebrow">{label}</span>
        <InfoTip label={label} text={info} />
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
    </div>
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

function InlineLegend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {[
        ["Paid", COLOR_PAID],
        ["Free / Comp", COLOR_FREE],
      ].map(([label, color]) => (
        <span
          key={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            color: C.soft,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: color,
              display: "inline-block",
            }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

// ─── NEW: Bedroom Distribution mini-bar ───────────────────────────────────────
function BedroomDistBar({ distribution }) {
  if (!distribution)
    return <span style={{ color: C.muted, fontSize: 11 }}>—</span>;
  let parsed = {};
  try {
    parsed =
      typeof distribution === "string"
        ? JSON.parse(distribution)
        : distribution;
  } catch {
    return null;
  }
  const entries = Object.entries(parsed).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const total = entries.reduce((s, [, v]) => s + Number(v), 0);
  if (!total) return null;
  return (
    <div
      style={{
        display: "flex",
        height: 10,
        borderRadius: 999,
        overflow: "hidden",
        gap: 1,
        minWidth: 80,
      }}
    >
      {entries.map(([bed, cnt], i) => (
        <div
          key={bed}
          title={`${bed} bed: ${cnt} (${pct(cnt, total)})`}
          style={{
            width: `${(Number(cnt) / total) * 100}%`,
            background: BED_COLORS[i % BED_COLORS.length],
            minWidth: 4,
          }}
        />
      ))}
    </div>
  );
}

// ─── NEW: Bedroom badge ───────────────────────────────────────────────────────
function BedBadge({ count }) {
  if (count == null) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        background: "rgba(30,80,150,0.08)",
        color: C.accent,
        border: `1px solid ${C.accent}`,
        whiteSpace: "nowrap",
      }}
    >
      <BedDouble size={9} />
      {count} bed
    </span>
  );
}

function SignalMetric({
  label,
  villa,
  value,
  sub,
  split,
  info,
  tiedCount = 0,
  onClick,
  onViewAll,
}) {
  const hasVilla = Boolean(villa);
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.bg,
        borderRadius: 16,
        padding: "13px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 4,
        }}
      >
        <div className="dashboard-eyebrow">{label}</div>
        <InfoTip label={label} text={info} />
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={!hasVilla}
        style={{
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: hasVilla ? "pointer" : "default",
        }}
      >
        <div
          style={{
            color: C.text,
            fontWeight: 850,
            fontSize: 15,
            marginTop: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {villa?.villa_name ?? "—"}
        </div>
        <div style={{ color: C.soft, fontSize: 12, marginTop: 3 }}>{value}</div>
        {split && <div style={{ marginTop: 8 }}>{split}</div>}
        {sub && (
          <div style={{ color: C.muted, fontSize: 10, marginTop: 6 }}>
            {sub}
          </div>
        )}
      </button>
      {tiedCount > 1 && onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          style={{
            marginTop: 8,
            border: "none",
            background: "transparent",
            color: C.accent,
            fontSize: 10,
            fontWeight: 900,
            padding: 0,
            cursor: "pointer",
          }}
        >
          View all {tiedCount} tied villas
        </button>
      )}
    </div>
  );
}

function PortfolioSignals({
  insights,
  periodFilter,
  financeExportRows,
  financeFilename,
  onSelectVilla,
  onOpenFinance,
  onOpenTies,
}) {
  const paid = Number(insights?.mostRevenue?.revenue || 0);
  const comp = Number(insights?.mostCompValue?.free_value || 0);
  const totalValue = paid + comp;
  const periodText = dateFilterLabel(periodFilter);
  const splitFor = (villa) =>
    villa ? (
      <MiniSplitBar paid={villa.paid_bookings} free={villa.free_bookings} />
    ) : null;

  return (
    <div className="dashboard-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div className="dashboard-eyebrow">Booking Highlights</div>
          <h2 className="dashboard-card-title">Villa Source Performance</h2>
          <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
            Key booking, revenue, and comp-value leaders based on the displayed
            period and active source filter.
          </p>
          <div style={{ marginTop: 8 }}>
            <PeriodPill filter={periodFilter} />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <ExportMenu
            rows={financeExportRows}
            filenameBase={financeFilename}
            disabled={!financeExportRows.length}
          />
          <button
            type="button"
            onClick={onOpenFinance}
            style={{
              border: `1px solid ${C.accent2}`,
              background: C.panelAlt,
              color: C.accent,
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Open finance breakdown
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 0.95fr) minmax(320px, 1.35fr)",
          gap: 16,
        }}
      >
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 20,
            background: C.panel,
            padding: 18,
          }}
        >
          <div className="dashboard-eyebrow">
            Highest Revenue Villa vs Highest Comp Value Villa
          </div>
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 30,
              color: C.text,
              marginTop: 4,
            }}
          >
            {money(totalValue)}
          </div>
          <div
            style={{
              color: C.muted,
              fontSize: 11,
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            Based on: {periodText}. Paid revenue uses paid bookings only. Comp
            value uses free/complimentary stays only.
          </div>
          <div style={{ marginTop: 16 }}>
            <MiniSplitBar paid={paid} free={comp} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginTop: 16,
            }}
          >
            {[
              {
                label: "Highest Paid Revenue",
                data: insights?.mostRevenue,
                valueKey: "revenue",
                note: "Paid bookings only",
              },
              {
                label: "Highest Comp Value",
                data: insights?.mostCompValue,
                valueKey: "free_value",
                note: "Free / comp stays only",
              },
            ].map(({ label, data, valueKey, note }) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  data?.villa_name && onSelectVilla(data.villa_name)
                }
                style={{
                  borderTop: `1px solid ${C.border}`,
                  borderLeft: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  paddingTop: 10,
                  background: "transparent",
                  textAlign: "left",
                  cursor: data?.villa_name ? "pointer" : "default",
                }}
              >
                <div className="dashboard-eyebrow">{label}</div>
                <div style={{ color: C.text, fontWeight: 850 }}>
                  {data?.villa_name ?? "—"}
                </div>
                <div style={{ color: C.soft, fontSize: 12 }}>
                  {money(data?.[valueKey])}
                </div>
                {data?.most_common_bedrooms != null && (
                  <div style={{ marginTop: 4 }}>
                    <BedBadge count={data.most_common_bedrooms} />
                  </div>
                )}
                <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
                  {note}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
            gap: 10,
          }}
        >
          {[
            {
              label: "Most Booked",
              villa: insights.mostBooked,
              value: `${fmt(insights.mostBooked?.total_bookings)} bookings`,
              ties: insights.mostBookedTies,
              tiesLabel: "Most Booked Villas",
              sub: "Highest total demand",
            },
            {
              label: "Least Booked",
              villa: insights.leastBooked,
              value: `${fmt(insights.leastBooked?.total_bookings)} bookings`,
              ties: insights.leastBookedTies,
              tiesLabel: "Least Booked Villas",
              sub: "Lowest non-zero demand",
            },
            {
              label: "Most Paid",
              villa: insights.mostPaid,
              value: `${fmt(insights.mostPaid?.paid_bookings)} paid`,
              ties: insights.mostPaidTies,
              tiesLabel: "Most Paid Villas",
              sub: "Highest paid booking count",
            },
            {
              label: "Most Free / Comp",
              villa: insights.mostFree,
              value: `${fmt(insights.mostFree?.free_bookings)} free/comp`,
              ties: insights.mostFreeTies,
              tiesLabel: "Most Free / Comp Villas",
              sub: "Highest comp booking count",
            },
          ].map(({ label, villa, value, ties, tiesLabel, sub }) => (
            <SignalMetric
              key={label}
              label={label}
              villa={villa}
              value={value}
              split={
                villa ? (
                  <MiniSplitBar
                    paid={villa.paid_bookings}
                    free={villa.free_bookings}
                  />
                ) : null
              }
              tiedCount={ties?.length || 0}
              sub={sub}
              onViewAll={() => onOpenTies(tiesLabel, ties)}
              onClick={() =>
                villa?.villa_name && onSelectVilla(villa.villa_name)
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── NEW: Bedroom Intelligence Card ──────────────────────────────────────────
function BedroomIntelligenceCard({
  bedroomData,
  sourceFilter,
  viewMode,
  dateFilter,
  years,
  months,
  onDateChange,
}) {
  const [activeTab, setActiveTab] = useState("paid_free"); // paid_free | source

  const filtered = useMemo(() => {
    let rows = bedroomData;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    return rows;
  }, [bedroomData, viewMode, sourceFilter]);

  // ── Paid vs Free by bedroom ───────────────────────────────────────────────
  const paidFreeByBed = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const bed = r.bedroom_count ?? "Unknown";
      if (!map.has(bed))
        map.set(bed, {
          bedroom_count: bed,
          paid: 0,
          free: 0,
          revenue: 0,
          free_value: 0,
          total_nights: 0,
        });
      const e = map.get(bed);
      if (r.is_free) {
        e.free += Number(r.bookings || 0);
        e.free_value += Number(r.free_value || 0);
      } else {
        e.paid += Number(r.bookings || 0);
        e.revenue += Number(r.revenue || 0);
      }
      e.total_nights += Number(r.total_nights || 0);
    });
    return [...map.values()].sort(
      (a, b) => Number(a.bedroom_count || 99) - Number(b.bedroom_count || 99),
    );
  }, [filtered]);

  // ── Source by bedroom ─────────────────────────────────────────────────────
  const sourceByBed = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const bed = r.bedroom_count ?? "Unknown";
      const src = r.source || "Unknown";
      const key = `${bed}||${src}`;
      if (!map.has(key))
        map.set(key, {
          bedroom_count: bed,
          source: src,
          paid: 0,
          free: 0,
          total: 0,
          revenue: 0,
          free_value: 0,
        });
      const e = map.get(key);
      if (r.is_free) {
        e.free += Number(r.bookings || 0);
        e.free_value += Number(r.free_value || 0);
      } else {
        e.paid += Number(r.bookings || 0);
        e.revenue += Number(r.revenue || 0);
      }
      e.total += Number(r.bookings || 0);
    });
    return [...map.values()].sort((a, b) => {
      const bedDiff =
        Number(a.bedroom_count || 99) - Number(b.bedroom_count || 99);
      return bedDiff !== 0 ? bedDiff : b.total - a.total;
    });
  }, [filtered]);

  // KPIs
  const totalBookings = paidFreeByBed.reduce((s, r) => s + r.paid + r.free, 0);
  const totalPaid = paidFreeByBed.reduce((s, r) => s + r.paid, 0);
  const totalFree = paidFreeByBed.reduce((s, r) => s + r.free, 0);
  const mostPaidBed = [...paidFreeByBed].sort((a, b) => b.paid - a.paid)[0];
  const mostFreeBed = [...paidFreeByBed].sort((a, b) => b.free - a.free)[0];
  const highestCompPct = [...paidFreeByBed].sort((a, b) => {
    const bPct = b.free / (b.paid + b.free) || 0;
    const aPct = a.free / (a.paid + a.free) || 0;
    return bPct - aPct;
  })[0];
  const totalRevenue = paidFreeByBed.reduce((s, r) => s + r.revenue, 0);
  const totalCompVal = paidFreeByBed.reduce((s, r) => s + r.free_value, 0);

  const bedKeys = paidFreeByBed.map((r) => r.bedroom_count);

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setActiveTab(key)}
      style={{
        padding: "7px 14px",
        borderRadius: 10,
        border: "none",
        background: activeTab === key ? C.accent : "transparent",
        color: activeTab === key ? "#fff" : C.muted,
        fontWeight: activeTab === key ? 800 : 500,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="dashboard-card">
      {/* Header */}
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
          <div
            className="dashboard-eyebrow"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <LayoutGrid size={12} /> Bedroom Intelligence
          </div>
          <h2 className="dashboard-card-title">
            Bedroom × Source / Paid–Free Analysis
          </h2>
          <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
            Which bedroom sizes drive paid vs comp bookings, and which sources
            book which sizes.
          </p>
          <div style={{ marginTop: 8 }}>
            <PeriodPill filter={dateFilter} />
          </div>
        </div>
        <DateFilterBar
          value={dateFilter}
          onChange={onDateChange}
          years={years}
          months={months}
        />
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {[
          {
            icon: BedDouble,
            label: "Most Paid Bedroom",
            value:
              mostPaidBed?.bedroom_count != null
                ? `${mostPaidBed.bedroom_count} bed`
                : "—",
            sub: `${fmt(mostPaidBed?.paid)} paid bookings`,
            meta: "Highest revenue-generating size",
          },
          {
            icon: Gift,
            label: "Most Comp'd Bedroom",
            value:
              mostFreeBed?.bedroom_count != null
                ? `${mostFreeBed.bedroom_count} bed`
                : "—",
            sub: `${fmt(mostFreeBed?.free)} free/comp bookings`,
            meta: "Most complimentary stays",
          },

          {
            icon: DollarSign,
            label: "Paid Revenue",
            value: money(totalRevenue),
            sub: "Paid stays only",
            meta: "Across all bedroom sizes",
          },
          {
            icon: Gift,
            label: "Comp Value",
            value: money(totalCompVal),
            sub: "Free/comp stays only",
            meta: "Tracked separately",
          },
          {
            icon: Users,
            label: "Total Bookings",
            value: fmt(totalBookings),
            sub: `${fmt(totalPaid)} paid · ${fmt(totalFree)} free`,
            meta: pct(totalFree, totalBookings) + " comp rate",
          },
        ].map((t) => (
          <KpiTile key={t.label} {...t} />
        ))}
      </div>

      {/* Tab toggle */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 4,
          marginBottom: 16,
        }}
      >
        {tabBtn("paid_free", "Paid vs Free by Bedroom")}
        {tabBtn("source", "Source by Bedroom")}
      </div>

      {/* ── Tab: Paid vs Free by bedroom ───────────────────────────────── */}
      {activeTab === "paid_free" && (
        <div>
          {/* Chart */}
          {paidFreeByBed.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <div
                style={{
                  minWidth: Math.max(paidFreeByBed.length * 90, 400),
                  height: 260,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={paidFreeByBed}
                    margin={{ top: 12, right: 18, bottom: 60, left: 18 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis
                      dataKey="bedroom_count"
                      stroke={AX}
                      fontSize={11}
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                      height={60}
                      label={{
                        value: "Bedrooms",
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
                        name === "paid" ? "Paid" : "Free/Comp",
                      ]}
                    />
                    <Bar
                      dataKey="paid"
                      name="paid"
                      fill={COLOR_PAID}
                      stackId="a"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="free"
                      name="free"
                      fill={COLOR_FREE}
                      stackId="a"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 6 }}>
                <InlineLegend />
              </div>
            </div>
          )}

          {/* Table */}
          <ScrollTableShell maxHeight={320}>
            <table
              style={{
                width: "100%",
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
                    "Bedrooms",
                    "Paid Bookings",
                    "Free / Comp",
                    "Comp %",
                    "Split",
                    "Paid Revenue",
                    "Comp Value",
                    "Nights",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign:
                          h === "Bedrooms" || h === "Split" ? "left" : "right",
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
                {paidFreeByBed.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: C.muted,
                      }}
                    >
                      No data for current filters.
                    </td>
                  </tr>
                )}
                {paidFreeByBed.map((r) => {
                  const total = r.paid + r.free;
                  return (
                    <tr
                      key={r.bedroom_count}
                      style={{ borderBottom: `1px solid ${C.border}` }}
                    >
                      <td style={{ padding: 10 }}>
                        <BedBadge count={r.bedroom_count} />
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          color: C.accent,
                          fontWeight: 800,
                        }}
                      >
                        {fmt(r.paid)}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          color: C.accent3,
                          fontWeight: 800,
                        }}
                      >
                        {fmt(r.free)}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          color: r.free > r.paid ? C.accent3 : C.soft,
                          fontWeight: r.free > r.paid ? 800 : 400,
                        }}
                      >
                        {pct(r.free, total)}
                      </td>
                      <td style={{ padding: 10, minWidth: 140 }}>
                        <MiniSplitBar paid={r.paid} free={r.free} />
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
                        {fmt(r.total_nights)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {paidFreeByBed.length > 0 && (
                <tfoot>
                  <tr
                    style={{
                      background: C.panelAlt,
                      borderTop: `2px solid ${C.border}`,
                      fontWeight: 800,
                    }}
                  >
                    <td style={{ padding: 10, color: C.text }}>Totals</td>
                    <td
                      style={{ padding: 10, textAlign: "right", color: C.text }}
                    >
                      {fmt(totalPaid)}
                    </td>
                    <td
                      style={{ padding: 10, textAlign: "right", color: C.text }}
                    >
                      {fmt(totalFree)}
                    </td>
                    <td
                      style={{ padding: 10, textAlign: "right", color: C.text }}
                    >
                      {pct(totalFree, totalBookings)}
                    </td>
                    <td style={{ padding: 10 }}>
                      <MiniSplitBar paid={totalPaid} free={totalFree} />
                    </td>
                    <td
                      style={{ padding: 10, textAlign: "right", color: C.text }}
                    >
                      {money(totalRevenue)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        textAlign: "right",
                        color: C.accent3,
                      }}
                    >
                      {money(totalCompVal)}
                    </td>
                    <td
                      style={{ padding: 10, textAlign: "right", color: C.text }}
                    >
                      —
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </ScrollTableShell>
        </div>
      )}

      {/* ── Tab: Source by bedroom ─────────────────────────────────────── */}
      {activeTab === "source" && (
        <ScrollTableShell maxHeight={400}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
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
                  "Bedrooms",
                  "Source",
                  "Paid",
                  "Free / Comp",
                  "Total",
                  "Comp %",
                  "Split",
                  "Revenue",
                  "Comp Value",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: ["Bedrooms", "Source", "Split"].includes(h)
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
              {sourceByBed.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{ padding: 20, textAlign: "center", color: C.muted }}
                  >
                    No data for current filters.
                  </td>
                </tr>
              )}
              {sourceByBed.map((r, i) => {
                const total = r.paid + r.free;
                const prevBed = i > 0 ? sourceByBed[i - 1].bedroom_count : null;
                const showBed = r.bedroom_count !== prevBed;
                return (
                  <tr
                    key={`${r.bedroom_count}-${r.source}`}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      background:
                        showBed && i > 0
                          ? "rgba(30,80,150,0.03)"
                          : "transparent",
                    }}
                  >
                    <td style={{ padding: 10 }}>
                      {showBed ? (
                        <BedBadge count={r.bedroom_count} />
                      ) : (
                        <span style={{ color: C.muted, fontSize: 10 }}>↳</span>
                      )}
                    </td>
                    <td style={{ padding: 10, color: C.text, fontWeight: 600 }}>
                      {r.source}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        textAlign: "right",
                        color: C.accent,
                        fontWeight: 800,
                      }}
                    >
                      {fmt(r.paid)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        textAlign: "right",
                        color: C.accent3,
                        fontWeight: 800,
                      }}
                    >
                      {fmt(r.free)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        textAlign: "right",
                        color: C.text,
                        fontWeight: 800,
                      }}
                    >
                      {fmt(r.total)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        textAlign: "right",
                        color: r.free > r.paid ? C.accent3 : C.soft,
                      }}
                    >
                      {pct(r.free, total)}
                    </td>
                    <td style={{ padding: 10, minWidth: 120 }}>
                      <MiniSplitBar paid={r.paid} free={r.free} />
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollTableShell>
      )}
    </div>
  );
}

// ─── BookingCard ──────────────────────────────────────────────────────────────
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 850, color: C.text }}>
                {primaryName}
              </div>
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
              {/* bedroom badge */}
              {booking.bedroom_count != null && (
                <BedBadge count={booking.bedroom_count} />
              )}
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
              {" · "}Payment:{" "}
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

        {/* Stay strip */}
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

        {/* Grid: contact */}
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

        {/* Grid: meta — now includes bedroom_count */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 10,
            marginTop: 10,
          }}
        >
          {[
            ["Member type", booking.member_type ?? "—"],
            ["Account", booking.member_or_guest ?? "—"],
            ["Bedrooms", booking.bedroom_count ?? "—"],
            ["Guests", booking.persons ?? "—"],
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

        {/* Guest manifest */}
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function VillaSourceBreakdown({ years, months }) {
  const createDateFilter = () => ({
    mode: "ym",
    year: "All",
    month: "All",
    date: "",
    startDate: "",
    endDate: "",
  });

  const toDateParams = (filter) => {
    if (filter.mode === "day") return filter.date ? { date: filter.date } : {};
    if (filter.mode === "range")
      return filter.startDate && filter.endDate
        ? { start_date: filter.startDate, end_date: filter.endDate }
        : {};
    return {
      year: filter.year === "All" ? null : Number(filter.year),
      month: filter.month === "All" ? null : months.indexOf(filter.month),
    };
  };

  const dateFilterFilePart = (filter) => {
    if (filter.mode === "day") return filter.date || "all_dates";
    if (filter.mode === "range")
      return filter.startDate && filter.endDate
        ? `${filter.startDate}_to_${filter.endDate}`
        : "all_dates";
    return `${filter.year}_${filter.month}`;
  };

  const [viewMode, setViewMode] = useState("overall");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [villaChartLimit, setVillaChartLimit] = useState("15");

  const [kpiDateFilter, setKpiDateFilter] = useState(createDateFilter);
  const [signalsDateFilter, setSignalsDateFilter] = useState(createDateFilter);
  const [chartDateFilter, setChartDateFilter] = useState(createDateFilter);
  const [sourceSummaryDateFilter, setSourceSummaryDateFilter] =
    useState(createDateFilter);
  const [selectedVillaDateFilter, setSelectedVillaDateFilter] =
    useState(createDateFilter);
  const [bedroomDateFilter, setBedroomDateFilter] = useState(createDateFilter); // NEW

  const kpiFilters = useMemo(
    () => toDateParams(kpiDateFilter),
    [kpiDateFilter],
  );
  const signalsFilters = useMemo(
    () => toDateParams(signalsDateFilter),
    [signalsDateFilter],
  );
  const chartFilters = useMemo(
    () => toDateParams(chartDateFilter),
    [chartDateFilter],
  );
  const sourceSummaryFilters = useMemo(
    () => toDateParams(sourceSummaryDateFilter),
    [sourceSummaryDateFilter],
  );
  const selectedVillaFilters = useMemo(
    () => toDateParams(selectedVillaDateFilter),
    [selectedVillaDateFilter],
  );
  const bedroomFilters = useMemo(
    () => toDateParams(bedroomDateFilter),
    [bedroomDateFilter],
  ); // NEW

  const [kpiRaw, setKpiRaw] = useState([]);
  const [signalsRaw, setSignalsRaw] = useState([]);
  const [chartRaw, setChartRaw] = useState([]);
  const [sourceSummaryRaw, setSourceSummaryRaw] = useState([]);
  const [selectedVillaRaw, setSelectedVillaRaw] = useState([]);
  const [bedroomRaw, setBedroomRaw] = useState([]); // NEW
  const [loading, setLoading] = useState(false);
  const [allSources, setAllSources] = useState([]);

  const loadBreakdown = (filters, setter, setGlobalLoading = false) => {
    let cancelled = false;
    if (setGlobalLoading) setLoading(true);
    analyticsApi
      .villaSourceBreakdown(filters)
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setter(rows);
        const srcs = [
          ...new Set(rows.map((r) => r.source || "Unknown")),
        ].sort();
        setAllSources((current) => [...new Set([...current, ...srcs])].sort());
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled && setGlobalLoading) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  // NEW: load bedroom cross-tab
  const loadBedroomBreakdown = (filters, setter) => {
    let cancelled = false;
    analyticsApi
      .villaSourceBedroomBreakdown(filters)
      .then((data) => {
        if (!cancelled) setter(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => loadBreakdown(kpiFilters, setKpiRaw, true), [kpiFilters]);
  useEffect(
    () => loadBreakdown(signalsFilters, setSignalsRaw),
    [signalsFilters],
  );
  useEffect(() => loadBreakdown(chartFilters, setChartRaw), [chartFilters]);
  useEffect(
    () => loadBreakdown(sourceSummaryFilters, setSourceSummaryRaw),
    [sourceSummaryFilters],
  );
  useEffect(
    () => loadBreakdown(selectedVillaFilters, setSelectedVillaRaw),
    [selectedVillaFilters],
  );
  useEffect(
    () => loadBedroomBreakdown(bedroomFilters, setBedroomRaw),
    [bedroomFilters],
  ); // NEW

  // ── Villa chart data ──────────────────────────────────────────────────────
  const villaChartData = useMemo(() => {
    let rows = chartRaw;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    const map = new Map();
    rows.forEach((r) => {
      const key = r.villa_name;
      if (!map.has(key))
        map.set(key, {
          villa_name: key,
          paid_bookings: 0,
          free_bookings: 0,
          total_bookings: 0,
          revenue: 0,
          free_value: 0,
          total_nights: 0,
        });
      const e = map.get(key);
      if (r.is_free) {
        e.free_bookings += Number(r.bookings ?? 0);
        e.free_value += Number(r.free_value ?? 0);
      } else {
        e.paid_bookings += Number(r.bookings ?? 0);
        e.revenue += Number(r.revenue ?? 0);
      }
      e.total_bookings += Number(r.bookings ?? 0);
      e.total_nights += Number(r.total_nights ?? 0);
    });
    return [...map.values()].sort(
      (a, b) => b.total_bookings - a.total_bookings,
    );
  }, [chartRaw, viewMode, sourceFilter]);

  const [selectedVilla, setSelectedVilla] = useState(null);

  const villaSourceRows = useMemo(() => {
    if (!selectedVilla) return [];
    let rows = selectedVillaRaw.filter((r) => r.villa_name === selectedVilla);
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    return rows;
  }, [selectedVillaRaw, selectedVilla, viewMode, sourceFilter]);

  const kpis = useMemo(() => {
    let rows = kpiRaw;
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
  }, [kpiRaw, viewMode, sourceFilter]);

  const villaStackedChartData = useMemo(() => {
    let rows = chartRaw;
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    const map = new Map();
    rows.forEach((r) => {
      const key = r.villa_name || "Unknown villa";
      if (!map.has(key))
        map.set(key, {
          villa_name: key,
          paid_bookings: 0,
          free_bookings: 0,
          total_bookings: 0,
          revenue: 0,
          free_value: 0,
          total_nights: 0,
        });
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
    });
    return [...map.values()].sort(
      (a, b) => Number(b.total_bookings || 0) - Number(a.total_bookings || 0),
    );
  }, [chartRaw, sourceFilter]);

  const visibleVillaChartData = useMemo(() => {
    if (villaChartLimit === "All") return villaStackedChartData;
    return villaStackedChartData.slice(0, Number(villaChartLimit));
  }, [villaStackedChartData, villaChartLimit]);

  const sourceSummaryRows = useMemo(() => {
    let rows = sourceSummaryRaw;
    if (viewMode === "paid") rows = rows.filter((r) => !r.is_free);
    if (viewMode === "free") rows = rows.filter((r) => r.is_free);
    if (sourceFilter !== "All")
      rows = rows.filter((r) => (r.source || "Unknown") === sourceFilter);
    const map = new Map();
    rows.forEach((r) => {
      const source = r.source || "Unknown";
      if (!map.has(source))
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
  }, [sourceSummaryRaw, viewMode, sourceFilter]);

  const selectedVillaTotals = useMemo(() => {
    const paid = villaSourceRows.filter((r) => !r.is_free);
    const free = villaSourceRows.filter((r) => r.is_free);
    const totalBookings = villaSourceRows.reduce(
      (s, r) => s + Number(r.bookings ?? 0),
      0,
    );
    return {
      totalBookings,
      paidBookings: paid.reduce((s, r) => s + Number(r.bookings ?? 0), 0),
      freeBookings: free.reduce((s, r) => s + Number(r.bookings ?? 0), 0),
      revenue: paid.reduce((s, r) => s + Number(r.revenue ?? 0), 0),
      freeValue: free.reduce((s, r) => s + Number(r.free_value ?? 0), 0),
      nights: villaSourceRows.reduce(
        (s, r) => s + Number(r.total_nights ?? 0),
        0,
      ),
    };
  }, [villaSourceRows]);

  const sourceInsights = useMemo(() => {
    let rawRows = signalsRaw;
    if (sourceFilter !== "All")
      rawRows = rawRows.filter((r) => (r.source || "Unknown") === sourceFilter);
    const map = new Map();
    rawRows.forEach((r) => {
      const key = r.villa_name || "Unknown villa";
      if (!map.has(key))
        map.set(key, {
          villa_name: key,
          paid_bookings: 0,
          free_bookings: 0,
          total_bookings: 0,
          revenue: 0,
          free_value: 0,
          most_common_bedrooms: r.most_common_bedrooms,
        });
      const e = map.get(key);
      if (r.is_free) {
        e.free_bookings += Number(r.bookings ?? 0);
        e.free_value += Number(r.free_value ?? r.total_value ?? 0);
      } else {
        e.paid_bookings += Number(r.bookings ?? 0);
        e.revenue += Number(r.revenue ?? 0);
      }
      e.total_bookings += Number(r.bookings ?? 0);
    });
    const rows = [...map.values()];
    const nonZeroTotal = rows.filter((r) => Number(r.total_bookings || 0) > 0);
    const nonZeroPaid = rows.filter((r) => Number(r.paid_bookings || 0) > 0);
    const nonZeroFree = rows.filter((r) => Number(r.free_bookings || 0) > 0);
    const nonZeroRevenue = rows.filter((r) => Number(r.revenue || 0) > 0);
    const sortMetric = (arr, key, dir = "desc") =>
      [...arr].sort((a, b) =>
        dir === "asc"
          ? Number(a[key] || 0) - Number(b[key] || 0)
          : Number(b[key] || 0) - Number(a[key] || 0),
      );
    const by = (arr, key, dir = "desc") => sortMetric(arr, key, dir)[0] ?? null;
    const tiesFor = (arr, key, dir = "desc") => {
      const top = by(arr, key, dir);
      if (!top) return [];
      const target = Number(top[key] || 0);
      return sortMetric(
        arr.filter((r) => Number(r[key] || 0) === target),
        "villa_name",
        "asc",
      );
    };
    const compRows = rows.filter((r) => Number(r.free_value || 0) > 0);
    return {
      mostBooked: by(nonZeroTotal, "total_bookings"),
      leastBooked: by(nonZeroTotal, "total_bookings", "asc"),
      mostPaid: by(nonZeroPaid, "paid_bookings"),
      mostFree: by(nonZeroFree, "free_bookings"),
      mostRevenue: by(nonZeroRevenue, "revenue"),
      mostCompValue: by(compRows, "free_value"),
      mostBookedTies: tiesFor(nonZeroTotal, "total_bookings"),
      leastBookedTies: tiesFor(nonZeroTotal, "total_bookings", "asc"),
      mostPaidTies: tiesFor(nonZeroPaid, "paid_bookings"),
      mostFreeTies: tiesFor(nonZeroFree, "free_bookings"),
    };
  }, [signalsRaw, sourceFilter]);

  const openAllVillaBreakdown = (mode = viewMode) => {
    setSummaryModalMode(mode);
    setSummaryModalTitleOverride(null);
    setSummaryModalRowsOverride(null);
    setSummaryModalOpen(true);
  };
  const openTiedVillaBreakdown = (title, rows = []) => {
    setSummaryModalMode("overall");
    setSummaryModalTitleOverride(title);
    setSummaryModalRowsOverride(rows);
    setSummaryModalOpen(true);
  };

  // Drilldown modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVilla, setModalVilla] = useState(null);
  const [modalSource, setModalSource] = useState(null);
  const [modalIsFree, setModalIsFree] = useState(null);
  const [modalBedrooms, setModalBedrooms] = useState(null); // NEW
  const [modalBookings, setModalBookings] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalDateFilter, setModalDateFilter] = useState(createDateFilter);
  const [modalSearch, setModalSearch] = useState("");
  const [modalSortKey, setModalSortKey] = useState("check_in_date");
  const [modalSortDir, setModalSortDir] = useState("desc");
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryModalMode, setSummaryModalMode] = useState("overall");
  const [summaryModalDateFilter, setSummaryModalDateFilter] =
    useState(createDateFilter);
  const [summaryModalRaw, setSummaryModalRaw] = useState([]);
  const [summarySearch, setSummarySearch] = useState("");
  const [summarySortKey, setSummarySortKey] = useState("total_bookings");
  const [summarySortDir, setSummarySortDir] = useState("desc");
  const [summaryModalTitleOverride, setSummaryModalTitleOverride] =
    useState(null);
  const [summaryModalRowsOverride, setSummaryModalRowsOverride] =
    useState(null);
  const [modalReturnToSummary, setModalReturnToSummary] = useState(false);

  const modalFilters = useMemo(
    () => toDateParams(modalDateFilter),
    [modalDateFilter],
  );
  const summaryModalFilters = useMemo(
    () => toDateParams(summaryModalDateFilter),
    [summaryModalDateFilter],
  );

  useEffect(() => {
    if (!summaryModalOpen) return undefined;
    return loadBreakdown(summaryModalFilters, setSummaryModalRaw);
  }, [summaryModalOpen, summaryModalFilters]);

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
      ...(modalBedrooms !== null ? { bedrooms: modalBedrooms } : {}), // NEW
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
  }, [
    modalOpen,
    modalVilla,
    modalSource,
    modalIsFree,
    modalBedrooms,
    modalFilters,
  ]);

  const openModal = (
    villa,
    source = null,
    isFree = null,
    returnToSummary = false,
    bedrooms = null,
  ) => {
    setModalVilla(villa);
    setModalSource(source);
    setModalIsFree(isFree);
    setModalBedrooms(bedrooms);
    setModalReturnToSummary(returnToSummary);
    setModalDateFilter(createDateFilter());
    setModalSearch("");
    setModalOpen(true);
  };

  const filteredModalBookings = useMemo(() => {
    const searched = searchRows(modalBookings, modalSearch);
    return sortRows(searched, modalSortKey, modalSortDir);
  }, [modalBookings, modalSearch, modalSortKey, modalSortDir]);

  const summaryModalRows = useMemo(() => {
    let rows = summaryModalRaw;
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
      avg_bedrooms: r.avg_bedrooms != null ? Number(r.avg_bedrooms) : null, // NEW
      most_common_bedrooms: r.most_common_bedrooms ?? null, // NEW
      is_free: r.is_free,
    }));
    return sortRows(
      searchRows(mapped, summarySearch),
      summarySortKey,
      summarySortDir,
    );
  }, [
    summaryModalRaw,
    summaryModalMode,
    sourceFilter,
    summarySearch,
    summarySortKey,
    summarySortDir,
  ]);

  const displayedSummaryModalRows = useMemo(() => {
    if (!summaryModalRowsOverride) return summaryModalRows;
    const mapped = summaryModalRowsOverride.map((r) => ({
      villa_name: r.villa_name ?? "Unknown villa",
      source: "All selected sources",
      payment_type: "—",
      type: "Paid + Free / Comp",
      total_bookings: Number(r.total_bookings ?? 0),
      paid_bookings: Number(r.paid_bookings ?? 0),
      free_bookings: Number(r.free_bookings ?? 0),
      total_nights: Number(r.total_nights ?? 0),
      revenue: Number(r.revenue ?? 0),
      free_value: Number(r.free_value ?? 0),
      unique_members: Number(r.unique_members ?? 0),
      avg_bedrooms: null,
      most_common_bedrooms: null,
      is_free: null,
    }));
    return sortRows(
      searchRows(mapped, summarySearch),
      summarySortKey,
      summarySortDir,
    );
  }, [
    summaryModalRows,
    summaryModalRowsOverride,
    summarySearch,
    summarySortKey,
    summarySortDir,
  ]);

  // Export rows
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
    Bedrooms: b.bedroom_count ?? "", // NEW
    "Total Amount": b.total_amount ?? "",
    "Check In": b.check_in_date ?? "",
    "Check Out": b.check_out_date ?? "",
    Nights: b.nights ?? "",
    Guests: b.persons ?? "",
    "Conf Code": b.conf_code ?? "",
    "Reservation Status": b.reservation_status ?? "",
  }));

  const modalFilename = `${safeFilePart(modalVilla)}_source_${safeFilePart(modalSource)}_${safeFilePart(modalIsFree === true ? "free" : modalIsFree === false ? "paid" : "all")}${modalBedrooms ? `_${modalBedrooms}bed` : ""}_${safeFilePart(dateFilterFilePart(modalDateFilter))}_${today}`;

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
    "Avg Bedrooms": r.avg_bedrooms ?? "", // NEW
    "Most Common Bedrooms": r.most_common_bedrooms ?? "", // NEW
  }));

  const breakdownFilename = `source_breakdown_${safeFilePart(selectedVilla)}_${safeFilePart(dateFilterFilePart(selectedVillaDateFilter))}_${today}`;

  const currentViewLabel =
    viewMode === "paid"
      ? "Paid"
      : viewMode === "free"
        ? "Free / Comp"
        : "Overall";
  const financeExportRows = withExportContext(
    [
      {
        Metric: "Highest Paid Revenue",
        Villa: sourceInsights?.mostRevenue?.villa_name ?? "",
        Value: sourceInsights?.mostRevenue?.revenue ?? "",
        "Paid Bookings": sourceInsights?.mostRevenue?.paid_bookings ?? "",
        "Free / Comp Bookings":
          sourceInsights?.mostRevenue?.free_bookings ?? "",
        "Total Bookings": sourceInsights?.mostRevenue?.total_bookings ?? "",
        Notes: "Paid bookings only",
      },
      {
        Metric: "Highest Comp Value",
        Villa: sourceInsights?.mostCompValue?.villa_name ?? "",
        Value: sourceInsights?.mostCompValue?.free_value ?? "",
        "Paid Bookings": sourceInsights?.mostCompValue?.paid_bookings ?? "",
        "Free / Comp Bookings":
          sourceInsights?.mostCompValue?.free_bookings ?? "",
        "Total Bookings": sourceInsights?.mostCompValue?.total_bookings ?? "",
        Notes: "Free / comp stays only",
      },
    ],
    {
      period: dateFilterLabel(signalsDateFilter),
      source: sourceFilter,
      view: currentViewLabel,
    },
  );
  const financeFilename = `finance_leaders_${safeFilePart(sourceFilter)}_${safeFilePart(dateFilterFilePart(signalsDateFilter))}_${today}`;

  const summaryModalExportRows = withExportContext(
    displayedSummaryModalRows.map((r) => ({
      Villa: r.villa_name,
      Source: r.source,
      Payment: r.payment_type,
      Type: r.type,
      Bookings: r.total_bookings,
      Paid: r.paid_bookings,
      "Free / Comp": r.free_bookings,
      Nights: r.total_nights,
      Revenue: r.revenue,
      "Comp Value": r.free_value,
      Members: r.unique_members,
      "Avg Bedrooms": r.avg_bedrooms ?? "", // NEW
      "Most Common Bedrooms": r.most_common_bedrooms ?? "", // NEW
    })),
    {
      period: dateFilterLabel(summaryModalDateFilter),
      source: sourceFilter,
      view: summaryModalTitleOverride || summaryModalMode,
    },
  );
  const summaryModalFilename = `aggregate_breakdown_${safeFilePart(summaryModalTitleOverride || summaryModalMode)}_${safeFilePart(sourceFilter)}_${safeFilePart(dateFilterFilePart(summaryModalDateFilter))}_${today}`;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-section">
      {/* Section header */}
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
          <div className="dashboard-eyebrow">Visits &amp; Rooms</div>
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
            revenue, comp value, room nights, bedroom size, and member counts.
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
          <span style={{ color: C.muted, fontSize: 12 }}>
            Date filters are scoped to each card, chart, table, and modal.
          </span>
        </div>
      </div>

      {/* View toggle + source filter */}
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

      {/* KPI band */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <PeriodPill filter={kpiDateFilter} />
          <DateFilterBar
            value={kpiDateFilter}
            onChange={setKpiDateFilter}
            years={years}
            months={months}
          />
        </div>
      </div>
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
          active={summaryModalOpen && summaryModalMode === "overall"}
        />
        <KpiTile
          icon={DollarSign}
          label="Paid Bookings"
          value={fmt(kpis.totalPaid)}
          sub="Revenue bookings"
          meta={`${pct(kpis.totalPaid, kpis.totalBookings)} of total bookings`}
          onClick={() => openAllVillaBreakdown("paid")}
          active={summaryModalOpen && summaryModalMode === "paid"}
        />
        <KpiTile
          icon={Gift}
          label="Free / Comp"
          value={fmt(kpis.totalFree)}
          sub="Non-revenue bookings"
          meta={`${pct(kpis.totalFree, kpis.totalBookings)} of total bookings`}
          active={summaryModalOpen && summaryModalMode === "free"}
          onClick={() => openAllVillaBreakdown("free")}
        />
        <KpiTile
          icon={TrendingUp}
          label="Paid Revenue"
          value={money(kpis.revenue)}
          sub="Paid folio value"
          meta="Shows paid revenue beside free/comp value in the breakdown."
          onClick={() => openAllVillaBreakdown("finance")}
          active={summaryModalOpen && summaryModalMode === "finance"}
        />
        <KpiTile
          icon={Gift}
          label="Comp Value"
          value={money(kpis.freeValue)}
          sub="Free/comp value"
          meta="Tracked separately from paid revenue."
          active={summaryModalOpen && summaryModalMode === "free"}
          onClick={() => openAllVillaBreakdown("free")}
        />
        <KpiTile
          icon={Users}
          label="Total Room Nights"
          value={fmt(kpis.totalNights)}
          sub="Occupancy impact"
          meta="Includes paid and free/comp nights."
          onClick={() => openAllVillaBreakdown("overall")}
          active={summaryModalOpen && summaryModalMode === "overall"}
        />
      </div>

      {/* Portfolio signals */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10,
        }}
      >
        <DateFilterBar
          value={signalsDateFilter}
          onChange={setSignalsDateFilter}
          years={years}
          months={months}
        />
      </div>
      <PortfolioSignals
        insights={sourceInsights}
        periodFilter={signalsDateFilter}
        financeExportRows={financeExportRows}
        financeFilename={financeFilename}
        onSelectVilla={setSelectedVilla}
        onOpenFinance={() => openAllVillaBreakdown("finance")}
        onOpenTies={openTiedVillaBreakdown}
      />

      {/* ── BEDROOM INTELLIGENCE CARD (NEW) ──────────────────────────────── */}
      <BedroomIntelligenceCard
        bedroomData={bedroomRaw}
        sourceFilter={sourceFilter}
        viewMode={viewMode}
        dateFilter={bedroomDateFilter}
        years={years}
        months={months}
        onDateChange={setBedroomDateFilter}
      />

      {/* Business source summary */}
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
              Click a source once to filter; click again to clear.
            </p>
            <div style={{ marginTop: 8 }}>
              <PeriodPill filter={sourceSummaryDateFilter} />
            </div>
          </div>
          <DateFilterBar
            value={sourceSummaryDateFilter}
            onChange={setSourceSummaryDateFilter}
            years={years}
            months={months}
          />
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
                    setSourceFilter((current) =>
                      current === r.source ? "All" : r.source,
                    );
                    setSelectedVilla(null);
                  }}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer",
                    background:
                      sourceFilter === r.source ? C.panelAlt : "transparent",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = C.panel)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      sourceFilter === r.source ? C.panelAlt : "transparent")
                  }
                >
                  <td style={{ padding: 10, color: C.text, fontWeight: 800 }}>
                    {r.source}
                    {sourceFilter === r.source ? " ✓" : ""}
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

      {/* Stacked bar chart */}
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
              Paid vs Free / Comp Bookings by Villa
            </h2>
            <PeriodPill filter={chartDateFilter} />
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <DateFilterBar
              value={chartDateFilter}
              onChange={setChartDateFilter}
              years={years}
              months={months}
            />
            <InlineLegend />
            <Select
              label="Show"
              value={villaChartLimit}
              onChange={setVillaChartLimit}
              options={["10", "15", "30", "40", "50", "All"]}
            />
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
                margin={{ top: 12, right: 18, bottom: 120, left: 18 }}
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
                  height={118}
                  label={{
                    value: "Villa",
                    position: "insideBottom",
                    offset: -34,
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
                <Bar
                  dataKey="paid_bookings"
                  name="paid_bookings"
                  fill={COLOR_PAID}
                  radius={[0, 0, 0, 0]}
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
                          ? "#d8b06a"
                          : COLOR_FREE
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Source breakdown side modal for selected villa */}
      {selectedVilla && (
        <div
          onClick={() => setSelectedVilla(null)}
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
              width: "min(920px, 94vw)",
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
              className="dashboard-card"
              style={{
                border: "none",
                borderRadius: 0,
                minHeight: "100vh",
                boxShadow: "none",
              }}
            >
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
                  <h2
                    className="dashboard-card-title"
                    style={{ marginBottom: 2 }}
                  >
                    {selectedVilla} — Source Breakdown
                  </h2>
                  <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                    Rows reflect this table's own date filter plus the active
                    source and paid/free filters.
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <PeriodPill filter={selectedVillaDateFilter} />
                  </div>
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
                  <DateFilterBar
                    value={selectedVillaDateFilter}
                    onChange={setSelectedVillaDateFilter}
                    years={years}
                    months={months}
                  />
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
                  gridTemplateColumns: "repeat(auto-fit, minmax(165px,1fr))",
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
                  active={
                    modalOpen &&
                    modalVilla === selectedVilla &&
                    modalIsFree === null
                  }
                />
                <KpiTile
                  icon={DollarSign}
                  label="Villa Paid"
                  value={fmt(selectedVillaTotals.paidBookings)}
                  sub={money(selectedVillaTotals.revenue)}
                  meta="Paid booking records"
                  onClick={() => openModal(selectedVilla, sourceFilter, false)}
                  active={
                    modalOpen &&
                    modalVilla === selectedVilla &&
                    modalIsFree === false
                  }
                />
                <KpiTile
                  icon={Gift}
                  label="Villa Free / Comp"
                  value={fmt(selectedVillaTotals.freeBookings)}
                  sub={money(selectedVillaTotals.freeValue)}
                  meta="Free/comp booking records"
                  active={
                    modalOpen &&
                    modalVilla === selectedVilla &&
                    modalIsFree === true
                  }
                  onClick={() => openModal(selectedVilla, sourceFilter, true)}
                />
                <KpiTile
                  icon={Users}
                  label="Villa Nights"
                  value={fmt(selectedVillaTotals.nights)}
                  sub="Paid + free/comp nights"
                  meta="Occupancy total"
                  onClick={() => openModal(selectedVilla, sourceFilter, null)}
                  active={
                    modalOpen &&
                    modalVilla === selectedVilla &&
                    modalIsFree === null
                  }
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
                        "Avg Beds",
                        "Bed Dist.",
                        "Nights",
                        "Revenue",
                        "Comp Value",
                        "Members",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: [
                              "Source",
                              "Payment Type",
                              "Bed Dist.",
                            ].includes(h)
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
                          colSpan={10}
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
                          background: "transparent",
                          cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = C.panel)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
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
                        {/* NEW: avg bedrooms */}
                        <td
                          style={{
                            padding: "10px 10px",
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {r.avg_bedrooms != null ? num(r.avg_bedrooms) : "—"}
                        </td>
                        {/* NEW: bedroom distribution bar */}
                        <td style={{ padding: "10px 10px", minWidth: 100 }}>
                          <BedroomDistBar
                            distribution={r.bedroom_distribution}
                          />
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
                                color: C.muted,
                              }}
                            >
                              —
                            </td>
                            <td style={{ padding: "10px 10px" }}></td>
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
          </aside>
        </div>
      )}

      {/* Aggregate breakdown modal */}
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
              width: "min(1020px, 96vw)",
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
                {summaryModalTitleOverride ||
                  (summaryModalMode === "paid"
                    ? "Paid Bookings"
                    : summaryModalMode === "free"
                      ? "Free / Comp Stays"
                      : summaryModalMode === "finance"
                        ? "Revenue and Comp Value"
                        : "Total Bookings")}
              </h2>
              <div style={{ color: C.muted, fontSize: 12 }}>
                All villas · Source: {sourceFilter} ·{" "}
                {dateFilterLabel(summaryModalDateFilter)}
              </div>
              <div style={{ marginTop: 14 }}>
                <DateFilterBar
                  value={summaryModalDateFilter}
                  onChange={setSummaryModalDateFilter}
                  years={years}
                  months={months}
                />
              </div>
            </div>

            <div style={{ padding: 26 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <KpiTile
                  icon={DollarSign}
                  label="Paid Revenue"
                  value={money(
                    displayedSummaryModalRows.reduce(
                      (s, r) => s + Number(r.revenue || 0),
                      0,
                    ),
                  )}
                  sub="Paid rows only"
                  meta="USD"
                />
                <KpiTile
                  icon={Gift}
                  label="Comp Value"
                  value={money(
                    displayedSummaryModalRows.reduce(
                      (s, r) => s + Number(r.free_value || 0),
                      0,
                    ),
                  )}
                  sub="Free / comp rows only"
                  meta="USD"
                />
                <KpiTile
                  icon={BedDouble}
                  label="Paid Bookings"
                  value={fmt(
                    displayedSummaryModalRows.reduce(
                      (s, r) => s + Number(r.paid_bookings || 0),
                      0,
                    ),
                  )}
                  sub="Revenue booking count"
                />
                <KpiTile
                  icon={Gift}
                  label="Free / Comp Bookings"
                  value={fmt(
                    displayedSummaryModalRows.reduce(
                      (s, r) => s + Number(r.free_bookings || 0),
                      0,
                    ),
                  )}
                  sub="Non-revenue booking count"
                />
              </div>
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
                  placeholder="Search villa, source, payment type…"
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
                    "avg_bedrooms",
                  ]}
                />
                <Select
                  label="Order"
                  value={summarySortDir}
                  onChange={setSummarySortDir}
                  options={["asc", "desc"]}
                />
                <ExportMenu
                  rows={summaryModalExportRows}
                  filenameBase={summaryModalFilename}
                  disabled={!summaryModalExportRows.length}
                />
              </div>
              <ScrollTableShell maxHeight={680}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 1080,
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
                        "Avg Beds",
                        "Top Bed",
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
                    {displayedSummaryModalRows.map((r, i) => (
                      <tr
                        key={`${r.villa_name}-${r.source}-${r.payment_type}-${i}`}
                        onClick={() => {
                          setSelectedVilla(r.villa_name);
                          openModal(
                            r.villa_name,
                            summaryModalRowsOverride ? sourceFilter : r.source,
                            summaryModalRowsOverride ? null : r.is_free,
                            true,
                          );
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
                        {/* NEW bedroom columns */}
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {r.avg_bedrooms != null ? num(r.avg_bedrooms) : "—"}
                        </td>
                        <td style={{ padding: 10, textAlign: "right" }}>
                          {r.most_common_bedrooms != null ? (
                            <BedBadge count={r.most_common_bedrooms} />
                          ) : (
                            "—"
                          )}
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

      {/* Drilldown modal */}
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
              {modalReturnToSummary && (
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{
                    border: `1px solid ${C.border}`,
                    background: C.panelAlt,
                    color: C.accent,
                    borderRadius: 999,
                    padding: "7px 11px",
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: "pointer",
                    marginBottom: 10,
                  }}
                >
                  ← Back to aggregate breakdown
                </button>
              )}
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
              <div style={{ marginTop: 8 }}>
                <PeriodPill filter={modalDateFilter} />
              </div>

              {/* Context pills */}
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
                {/* NEW: bedroom filter badge */}
                {modalBedrooms !== null && (
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "rgba(30,80,150,0.08)",
                      border: `1px solid ${C.accent}`,
                      color: C.accent,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <BedDouble size={10} />
                    {modalBedrooms} bedroom only
                  </span>
                )}
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <DateFilterBar
                  value={modalDateFilter}
                  onChange={setModalDateFilter}
                  years={years}
                  months={months}
                />
              </div>
            </div>

            <div style={{ padding: 26, flex: 1 }}>
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
                {/* NEW: bedroom filter */}
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span className="dashboard-eyebrow">Bedrooms</span>
                  <select
                    value={modalBedrooms ?? ""}
                    onChange={(e) =>
                      setModalBedrooms(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      background: C.bg,
                      color: C.text,
                      fontSize: 12,
                    }}
                  >
                    <option value="">All</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} bed
                      </option>
                    ))}
                  </select>
                </label>
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
                    "bedroom_count",
                  ]}
                />
                <Select
                  label="Order"
                  value={modalSortDir}
                  onChange={setModalSortDir}
                  options={["asc", "desc"]}
                />
              </div>
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
