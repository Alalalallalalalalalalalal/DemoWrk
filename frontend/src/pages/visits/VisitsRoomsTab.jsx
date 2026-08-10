// frontend/src/pages/visits/VisitsRoomsTab.jsx
//
// Merged replacement for VisitsRoomsTab.jsx + VillaSourceBreakdown.jsx.
//
// Endpoints used:
//   /analytics/visits-rooms-dashboard   ONE call on page load. Returns
//                                       summary, villa_stats,
//                                       bookings_by_bedroom,
//                                       villa_source_breakdown and
//                                       villa_source_bedroom_breakdown.
//   /analytics/villa-source-bookings    villa drill-down records (panel only)
//   /analytics/bedroom-bookings         bedroom drill-down records (panel only)
//   /analytics/villa-monthly            trend inside the villa panel
//   /analytics/booked-people            member vs guest split (panel only)
//
// PERF NOTE (Aug 2026) — read before adding another fetch here:
//   This page used to fire three requests on load: visits-rooms-dashboard,
//   villa-source-breakdown and villa-source-bedroom-breakdown. Each one made
//   the backend rebuild its entire booking base from rate_details, so a
//   single page load cost seven full rebuilds and the page took forever.
//   The two breakdown datasets now ride along inside the dashboard payload.
//   If you need another dataset, add it to that payload rather than adding a
//   fourth request.

// PER-VILLA FIGURES — read before changing:
//   villa_paid_free_totals is the authoritative per-villa dataset returned by
//   /analytics/visits-rooms-dashboard.
//   Overall = Overview Villa net amount.
//   Paid    = Overview paid Villa net amount.
//   Free    = rack-rate value from rate_details_with_discount, including
//             zero-charged Paid reservations.
//   Source rows remain useful for source/nights/member drill-downs, but must
//   not replace these authoritative villa totals.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  Users,
  CalendarDays,
  CalendarClock,
  Moon,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  X,
  Info,
  Download,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { analyticsApi } from "../../api/analytics";

const T = {
  ink: "#1A2733", // headline text, panel headers
  deep: "#003A59", // primary blue: chart bars, revenue figures
  flame: "#FFB063", // single accent: comp, selection, highlights
  mist: "#F4F9FD", // page-level tint, chips, table hover
  card: "#FFFFFF",
  line: "#E1EAF2",
  lineSoft: "#EDF3F8",
  muted: "#5D7284", // label text
  slate: "#93A7B6", // tertiary text
  link: "#3D7898", // card sub-labels
};

// Sequential ramp, light → deep, with flame reserved for the largest layout.
const BED_COLOR = {
  1: "#D6E4EE",
  2: "#B0CADB",
  3: "#85AEC7",
  4: "#5590B0",
  5: "#2A6C8F",
  6: "#003A59",
  7: "#1A2733",
  8: "#FFB063",
};
const bedColor = (b) => BED_COLOR[b] || "#B0CADB";

const FONT_DISPLAY = "'Cormorant Garamond', 'Iowan Old Style', Georgia, serif";
const FONT_NUM = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const MONTHS = [
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

// Guest records fetched per villa drill-down. The panel prints "n of m", so a
// cap reads honestly. Backend accepts up to 20000; omit to go unbounded.
const DRILL_RECORD_LIMIT = 2000;

const TIP_STYLE = {
  border: `1px solid ${T.line}`,
  borderRadius: 10,
  background: "#fff",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(26,39,51,0.12)",
};

/* ══════════════════════════════════════════════════════════════════════════
   Formatters + helpers
   ═════════════════════════════════════════════════════════════════════════ */

const n0 = (v) => (v == null ? "—" : Math.round(Number(v)).toLocaleString());
const n1 = (v) => (v == null ? "—" : Number(v).toFixed(1));
const money = (v) =>
  v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;
const moneyShort = (v) => {
  const x = Number(v || 0);
  if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (Math.abs(x) >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${Math.round(x)}`;
};
const pct = (part, whole) =>
  !Number(whole || 0)
    ? "0%"
    : `${Math.round((Number(part || 0) / Number(whole)) * 100)}%`;

const isoToNum = (iso) => Number(String(iso).replace(/-/g, ""));
const fmtISO = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

const safeFilePart = (v) =>
  String(v || "all")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

/* Ignore AbortError — it only means a newer request superseded this one. */
const isAbort = (err) => err?.name === "AbortError";

/* Period: {mode:'all'} | {mode:'year',year} | {mode:'month',year,month} | {mode:'range',from,to} */

const periodText = (p) => {
  if (!p || p.mode === "all") return "All time";
  if (p.mode === "year") return String(p.year);
  if (p.mode === "month") return `${MONTHS[p.month]} ${p.year}`;
  return `${fmtISO(p.from)} – ${fmtISO(p.to)}`;
};

const periodToParams = (p) => {
  if (!p || p.mode === "all") return {};
  if (p.mode === "year") return { year: p.year };
  if (p.mode === "month") return { year: p.year, month: p.month + 1 };
  return { start_date: p.from, end_date: p.to };
};

const periodFilePart = (p) => {
  if (!p || p.mode === "all") return "all_dates";
  if (p.mode === "year") return String(p.year);
  if (p.mode === "month") return `${p.year}_${MONTHS[p.month]}`;
  return `${p.from}_to_${p.to}`;
};

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

const sortRows = (rows, key, dir = "desc") => {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "")
      return (an - bn) * mult;
    return (
      String(av).localeCompare(String(bv), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * mult
    );
  });
};

/* Exports ────────────────────────────────────────────────────────────── */

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
    downloadFile(
      new Blob([XLSX.utils.sheet_to_csv(ws)], {
        type: "text/csv;charset=utf-8;",
      }),
      `${filenameBase}.csv`,
    );
  } else if (format === "excel") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Export");
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
      headStyles: { fillColor: [0, 58, 89] },
    });
    doc.save(`${filenameBase}.pdf`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   UI atoms
   ═════════════════════════════════════════════════════════════════════════ */

function Segmented({ value, onChange, options, size = "md" }) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap items-center rounded-xl"
      style={{ background: T.mist, border: `1px solid ${T.line}`, padding: 3 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`vr-focus rounded-full font-medium ${
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"
            }`}
            style={{
              background: active ? T.deep : "transparent",
              color: active ? "#fff" : T.muted,
              border: "none",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-2">
      <span
        className="text-xs font-semibold uppercase"
        style={{ letterSpacing: "0.07em", color: T.muted }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="vr-focus"
        style={{
          padding: "6px 10px",
          borderRadius: 999,
          border: `1px solid ${T.line}`,
          background: T.mist,
          color: T.ink,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const INFO = {
  chart:
    "Bars count valid unique bookings, or nights / revenue when you switch the metric. Bar colour is the villa's smallest bedroom layout. Select a bar to open that villa's full record.",
  table:
    "For villas, use the Overall / Paid / Free selector to choose the authoritative booking and value figures. Overall and Paid come from the Overview Villa ledger; Free is the rack-rate value of complimentary or zero-charged stays.",
  reconcile:
    "Statement Villa Income is the owner-payout total from statement_details. It is a separate reconciliation figure and will not equal booking-level folio revenue.",
  split:
    "Member and guest bookings are attributed through members.member_or_guest. Bookings with no member number cannot be attributed, so the two figures may not sum to total bookings.",
};

function InfoTip({ id }) {
  const [open, setOpen] = useState(false);
  const text = INFO[id];
  if (!text) return null;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="How this is calculated"
        onClick={() => setOpen((v) => !v)}
        className="vr-focus"
        style={{
          border: "none",
          background: "none",
          padding: 3,
          cursor: "pointer",
          color: open ? T.deep : T.slate,
          display: "flex",
        }}
      >
        <Info size={14} />
      </button>
      {open && (
        <>
          <span
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <span
            role="tooltip"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: 290,
              padding: "11px 13px",
              borderRadius: 12,
              background: T.ink,
              color: "#fff",
              fontSize: 11,
              lineHeight: 1.55,
              boxShadow: "0 10px 26px rgba(26,39,51,0.22)",
            }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}

function DatePeriod({ period, onChange, years }) {
  const [open, setOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(period.year ?? years[0]);
  const [from, setFrom] = useState(period.from || "");
  const [to, setTo] = useState(period.to || "");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rangeReady = Boolean(from && to);
  const applyRange = () => {
    if (!rangeReady) return;
    const [a, b] = isoToNum(from) <= isoToNum(to) ? [from, to] : [to, from];
    onChange({ mode: "range", from: a, to: b });
    setOpen(false);
  };

  const chipStyle = (active) => ({
    background: active ? T.deep : T.mist,
    color: active ? "#fff" : T.ink,
    border: `1px solid ${active ? T.deep : T.line}`,
    cursor: "pointer",
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="vr-focus inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
        style={{
          background: T.deep,
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        <CalendarDays size={14} style={{ color: T.flame }} />
        Date period: {periodText(period)}
        <ChevronDown
          size={15}
          style={{
            color: T.flame,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .18s ease",
          }}
        />
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 20 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="rounded-xl p-4"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 8px)",
              zIndex: 30,
              width: 320,
              background: "#fff",
              border: `1px solid ${T.line}`,
              boxShadow: "0 14px 40px rgba(26,39,51,0.16)",
            }}
          >
            <div
              className="mb-3 text-xs font-semibold uppercase"
              style={{ letterSpacing: "0.08em", color: T.muted }}
            >
              Custom period
            </div>

            <button
              type="button"
              onClick={() => {
                onChange({ mode: "all" });
                setOpen(false);
              }}
              className="vr-focus mb-4 w-full rounded-lg py-2 text-sm font-medium"
              style={chipStyle(period.mode === "all")}
            >
              All time
            </button>

            <div className="mb-2 text-xs" style={{ color: T.muted }}>
              Year
            </div>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {years.map((y) => {
                const on = period.mode === "year" && period.year === y;
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setDraftYear(y);
                      onChange({ mode: "year", year: y });
                    }}
                    className="vr-focus rounded-md px-2.5 py-1 text-sm"
                    style={{
                      background: on ? T.flame : T.mist,
                      color: T.ink,
                      border: `1px solid ${on ? T.flame : T.line}`,
                      fontFamily: FONT_NUM,
                      fontWeight: on ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {y}
                  </button>
                );
              })}
            </div>

            <div className="mb-2 text-xs" style={{ color: T.muted }}>
              Month in{" "}
              <select
                value={draftYear}
                onChange={(e) => setDraftYear(Number(e.target.value))}
                className="vr-focus"
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.ink,
                  fontFamily: FONT_NUM,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((m, i) => {
                const on =
                  period.mode === "month" &&
                  period.month === i &&
                  period.year === draftYear;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onChange({ mode: "month", year: draftYear, month: i });
                      setOpen(false);
                    }}
                    className="vr-focus rounded-md text-xs"
                    style={{ ...chipStyle(on), padding: "5px 0" }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

            <div
              className="my-4"
              style={{ borderTop: `1px solid ${T.line}` }}
            />

            <div className="mb-2 text-xs" style={{ color: T.muted }}>
              Exact dates{" "}
              <span style={{ color: T.slate }}>(e.g. 1–30 May)</span>
            </div>
            <div className="flex items-center gap-2">
              {[
                ["From", from, setFrom],
                ["To", to, setTo],
              ].map(([label, val, set]) => (
                <label key={label} style={{ flex: 1 }}>
                  <span
                    className="mb-1 block"
                    style={{ fontSize: 10, color: T.slate }}
                  >
                    {label}
                  </span>
                  <input
                    type="date"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className="vr-focus w-full rounded-md px-2 py-1.5 text-xs"
                    style={{
                      background: T.mist,
                      color: T.ink,
                      border: `1px solid ${T.line}`,
                      fontFamily: FONT_NUM,
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={applyRange}
              disabled={!rangeReady}
              className="vr-focus mt-3 w-full rounded-lg py-2 text-sm font-medium"
              style={{
                background: rangeReady ? T.ink : T.mist,
                color: rangeReady ? "#fff" : T.slate,
                border: `1px solid ${rangeReady ? T.ink : T.line}`,
                cursor: rangeReady ? "pointer" : "not-allowed",
              }}
            >
              Apply date range
            </button>
            <p className="mt-2" style={{ color: T.slate, fontSize: 10 }}>
              Bookings are counted by check-in date.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ExportMenu({ rows, filenameBase, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="vr-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
        style={{
          border: `1px solid ${T.line}`,
          background: T.mist,
          color: T.ink,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <Download size={13} /> Export <ChevronDown size={11} />
      </button>
      {open && !disabled && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 19 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 20,
              minWidth: 130,
              background: "#fff",
              border: `1px solid ${T.line}`,
              borderRadius: 10,
              boxShadow: "0 10px 26px rgba(26,39,51,0.14)",
              overflow: "hidden",
            }}
          >
            {[
              ["csv", "CSV"],
              ["excel", "Excel"],
              ["pdf", "PDF"],
            ].map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  exportRows(rows, filenameBase, f);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "9px 12px",
                  border: "none",
                  background: "transparent",
                  color: T.ink,
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, unit, note, icon: Icon, onClick }) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={onClick ? "vr-focus vr-lift" : "vr-lift"}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${T.line}`,
        borderRadius: 18,
        background: T.mist,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        cursor: onClick ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: T.muted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {Icon && <Icon size={13} />}
        {label}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 5,
        }}
      >
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            color: T.ink,
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>

        {unit && (
          <span
            style={{
              color: T.muted,
              fontSize: 11,
            }}
          >
            {unit}
          </span>
        )}
      </div>

      {note && (
        <div
          style={{
            color: T.muted,
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={note}
        >
          {note}
        </div>
      )}
    </Tag>
  );
}

function LeaderCard({
  label,
  name,
  primary,
  secondary,
  tone,
  icon: Icon,
  onOpen,
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="vr-focus vr-lift w-full text-left"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 16,
        padding: "18px 20px",
        cursor: "pointer",
      }}
    >
      <div
        className="flex items-center gap-1.5 text-xs font-bold uppercase"
        style={{ letterSpacing: "0.1em", color: T.muted, fontSize: 11 }}
      >
        <Icon size={13} style={{ color: tone }} />
        {label}
      </div>
      <div
        className="mt-3 truncate"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          lineHeight: 1.15,
          color: T.ink,
        }}
      >
        {name || "—"}
      </div>
      <div
        className="mt-2"
        style={{ fontFamily: FONT_NUM, fontSize: 13, color: T.deep }}
      >
        {primary}
      </div>
      <div className="mt-0.5" style={{ fontSize: 12, color: T.slate }}>
        {secondary}
      </div>
    </button>
  );
}

function SortHeader({ label, col, sort, setSort, align = "right" }) {
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

function ConfigSwatch({ configs }) {
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

function SplitBar({
  leftLabel,
  left,
  rightLabel,
  right,
  leftColor = T.deep,
  rightColor = T.flame,
}) {
  const total = Number(left || 0) + Number(right || 0) || 1;
  return (
    <div>
      <div
        className="flex overflow-hidden rounded-full"
        style={{ height: 10, background: T.mist }}
      >
        <div
          style={{ width: `${(left / total) * 100}%`, background: leftColor }}
        />
        <div
          style={{ width: `${(right / total) * 100}%`, background: rightColor }}
        />
      </div>
      <div
        className="mt-2 flex justify-between text-xs"
        style={{ color: T.muted }}
      >
        <span>
          <span
            className="mr-1.5 inline-block rounded-full align-middle"
            style={{ width: 8, height: 8, background: leftColor }}
          />
          {leftLabel} {n0(left)} · {pct(left, total)}
        </span>
        <span>
          {rightLabel} {n0(right)} · {pct(right, total)}
          <span
            className="ml-1.5 inline-block rounded-full align-middle"
            style={{ width: 8, height: 8, background: rightColor }}
          />
        </span>
      </div>
    </div>
  );
}

function ScrollShell({ children, maxHeight = 400 }) {
  return (
    <div
      className="vr-scroll"
      style={{
        overflow: "auto",
        maxHeight,
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        background: T.card,
      }}
    >
      {children}
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3
          className="text-xs font-bold uppercase"
          style={{ letterSpacing: "0.1em", color: T.ink, fontSize: 11 }}
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return (
    <div
      style={{
        padding: 34,
        textAlign: "center",
        color: T.slate,
        fontSize: 13,
        border: `1px dashed ${T.line}`,
        borderRadius: 14,
      }}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SidePanel — drag the left edge to resize, or use the expand button
   ═════════════════════════════════════════════════════════════════════════ */

const MIN_PANEL = 360;

function SidePanel({ eyebrow, title, subtitle, onClose, children }) {
  const [width, setWidth] = useState(() =>
    Math.min(900, Math.max(MIN_PANEL, Math.round(window.innerWidth * 0.62))),
  );
  const [expanded, setExpanded] = useState(false);
  const restoreWidth = useRef(width);
  const dragging = useRef(false);

  const maxWidth = () =>
    Math.max(0, window.innerWidth - (window.innerWidth <= 640 ? 0 : 24));

  const onPointerDown = useCallback((e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragging.current) return;
    const next = Math.min(
      Math.max(window.innerWidth - e.clientX, MIN_PANEL),
      maxWidth(),
    );
    setWidth(next);
    setExpanded(false);
  }, []);

  const endDrag = useCallback((e) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  const toggleExpand = () => {
    if (expanded) {
      setWidth(restoreWidth.current);
      setExpanded(false);
    } else {
      restoreWidth.current = width;
      setWidth(maxWidth());
      setExpanded(true);
    }
  };

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const handleResize = () => {
      setWidth((current) => Math.min(current, maxWidth()));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 900,
          background: "rgba(26,39,51,0.42)",
        }}
        onClick={onClose}
      />
      <aside
        className="visits-side-panel"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 901,
          width,
          maxWidth: "100vw",
          background: T.mist,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-24px 0 60px rgba(26,39,51,0.24)",
        }}
      >
        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={toggleExpand}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 10,
            marginLeft: -5,
            cursor: "col-resize",
            zIndex: 5,
            touchAction: "none",
          }}
        >
          <div
            className="vr-grip"
            style={{
              position: "absolute",
              left: 5,
              top: 0,
              bottom: 0,
              width: 3,
              background: T.flame,
            }}
          />
        </div>

        <header
          className="flex items-start justify-between gap-4"
          style={{ background: T.ink, padding: "20px 22px" }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="text-xs font-bold uppercase"
              style={{ letterSpacing: "0.1em", color: T.flame, fontSize: 11 }}
            >
              {eyebrow}
            </div>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 30,
                color: "#fff",
                margin: "4px 0 0",
                lineHeight: 1.1,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <div className="mt-1" style={{ fontSize: 12, color: "#9FC0D2" }}>
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleExpand}
              className="vr-focus"
              style={{
                borderRadius: 999,
                padding: 7,
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
              aria-label={expanded ? "Shrink panel" : "Expand panel"}
              title={expanded ? "Shrink panel" : "Expand panel"}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="vr-focus"
              style={{
                borderRadius: 999,
                padding: 7,
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div
          className="vr-scroll visits-panel-body"
          style={{ flex: 1, overflowY: "auto" }}
        >
          {children}
        </div>
      </aside>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Drill-down panel — villa or bedroom count
   ═════════════════════════════════════════════════════════════════════════ */

function DrillPanel({
  selection,
  tab,
  params,
  period,
  onClose,
  onOpenVilla,
  villaMetrics,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trend, setTrend] = useState([]);
  const [groupBy, setGroupBy] = useState("month");
  const [sort, setSort] = useState({ col: "check_in_date", dir: "desc" });
  const [search, setSearch] = useState("");

  const isVilla = selection.kind === "villa";
  const selKey = selection.key;
  const selLabel = selection.label;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setSearch("");

    const load = isVilla
      ? analyticsApi.villaSourceBookings(
          selKey,
          {
            ...params,
            ...(tab === "paid" ? { is_free: false } : {}),
            ...(tab === "free" ? { is_free: true } : {}),
            limit: DRILL_RECORD_LIMIT,
          },
          { signal: controller.signal },
        )
      : analyticsApi.bedroomBookings(selKey, params, {
          signal: controller.signal,
        });

    load
      .then((data) => {
        if (!cancelled) setRecords(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        console.error(err);
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selKey, isVilla, tab, params]);

  useEffect(() => {
    if (!isVilla) {
      setTrend([]);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const trendParams = groupBy === "year" ? {} : params;
    analyticsApi
      .villaMonthly(
        selKey,
        { group_by: groupBy, ...trendParams },
        { signal: controller.signal },
      )
      .then((data) => {
        if (!cancelled) setTrend(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        console.error(err);
        if (!cancelled) setTrend([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selKey, isVilla, groupBy, params]);

  const amountOf = (r) => Number(r.total_amount ?? r.revenue ?? 0);

  const totals = useMemo(() => {
    const bookings = records.length;
    const nights = records.reduce((s, r) => s + Number(r.nights || 0), 0);
    const guests = records.reduce((s, r) => s + Number(r.persons || 0), 0);
    const paidRows = records.filter((r) => !r.is_free);
    const compRows = records.filter((r) => r.is_free);
    return {
      bookings,
      nights,
      revenue: paidRows.reduce((s, r) => s + amountOf(r), 0),
      compValue: compRows.reduce((s, r) => s + amountOf(r), 0),
      avgStay: bookings ? nights / bookings : null,
      avgParty: bookings ? guests / bookings : null,
      paid: paidRows.length,
      comp: compRows.length,
      hasFreeFlag: records.some((r) => r.is_free !== undefined),
    };
  }, [records]);

  const breakdown = useMemo(() => {
    const key = isVilla ? "bedroom_count" : "villa_name";
    const map = new Map();
    records.forEach((r) => {
      const k = r[key] ?? "Unknown";
      if (!map.has(k))
        map.set(k, {
          key: k,
          bookings: 0,
          nights: 0,
          value: 0,
          guests: 0,
          paid: 0,
          comp: 0,
        });
      const e = map.get(k);
      e.bookings += 1;
      e.nights += Number(r.nights || 0);
      e.guests += Number(r.persons || 0);
      e.value += amountOf(r);
      if (r.is_free) e.comp += 1;
      else e.paid += 1;
    });
    const arr = [...map.values()];
    return isVilla
      ? arr.sort((a, b) => Number(a.key) - Number(b.key))
      : arr.sort((a, b) => b.bookings - a.bookings);
  }, [records, isVilla]);

  const visibleRecords = useMemo(
    () => sortRows(searchRows(records, search), sort.col, sort.dir),
    [records, search, sort],
  );

  const exportData = visibleRecords.map((r) => ({
    Selection: selLabel,
    Guest: r.member_full_name || r.member_name || r.guest_name || "",
    "Member #": r.member_number ?? "",
    Email: r.email ?? "",
    Phone: r.phone ?? "",
    Country: r.country ?? "",
    Villa: r.villa_name ?? "",
    Bedrooms: r.bedroom_count ?? "",
    Source: r.source ?? "",
    "Paid / Comp": r.is_free === undefined ? "" : r.is_free ? "Comp" : "Paid",
    Value: amountOf(r),
    "Check In": r.check_in_date ?? "",
    "Check Out": r.check_out_date ?? "",
    Nights: r.nights ?? "",
    Guests: r.persons ?? "",
    "Conf Code": r.conf_code ?? "",
  }));

  const authoritativeVillaMetrics = isVilla ? villaMetrics : null;

  const overviewValue = Number(
    authoritativeVillaMetrics?.overall_total_rental ?? 0,
  );
  const paidValue = Number(authoritativeVillaMetrics?.paid_total_rental ?? 0);
  const freeValue = Number(authoritativeVillaMetrics?.free_total_rental ?? 0);

  return (
    <SidePanel
      eyebrow={`${isVilla ? "Villa" : "Bedroom layout"} · ${
        tab === "overall"
          ? "All bookings"
          : tab === "paid"
            ? "Paid only"
            : "Comp only"
      }`}
      title={selLabel}
      subtitle={`${periodText(period)}${
        isVilla && selection.configs?.length
          ? ` · lets as ${selection.configs.join(" / ")} bedrooms`
          : ""
      }`}
      onClose={onClose}
    >
      {isVilla ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Overall revenue", money(overviewValue)],
              ["Paid revenue", money(paidValue)],
              ["Free value", money(freeValue)],
              [
                "Bookings",
                n0(
                  authoritativeVillaMetrics?.total_unique_bookings ??
                    totals.bookings,
                ),
              ],
              [
                "Avg stay",
                totals.avgStay == null ? "—" : `${n1(totals.avgStay)} n`,
              ],
              [
                "Avg party",
                totals.avgParty == null ? "—" : n1(totals.avgParty),
              ],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  className="text-xs font-bold uppercase"
                  style={{
                    letterSpacing: "0.08em",
                    color: T.muted,
                    fontSize: 10,
                  }}
                >
                  {l}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 24,
                    color: l === "Free value" ? "#B07B33" : T.ink,
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-3 rounded-lg p-3 text-xs"
            style={{
              background: "#FFF4E6",
              color: "#8A5A20",
              border: "1px solid #F5DDBC",
              lineHeight: 1.5,
            }}
          >
            <b>Free value</b> is not cash collected. It is the rack-rate value
            of complimentary stays, including reservations marked Paid where the
            complete charged total was zero.
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                tab === "free" ? "Comp value" : "Revenue",
                money(tab === "free" ? totals.compValue : totals.revenue),
              ],
              ["Bookings", n0(totals.bookings)],
              [
                "Avg stay",
                totals.avgStay == null ? "—" : `${n1(totals.avgStay)} n`,
              ],
              [
                "Avg party",
                totals.avgParty == null ? "—" : n1(totals.avgParty),
              ],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  className="text-xs font-bold uppercase"
                  style={{
                    letterSpacing: "0.08em",
                    color: T.muted,
                    fontSize: 10,
                  }}
                >
                  {l}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 24,
                    color: T.ink,
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          {tab === "free" && (
            <div
              className="mt-3 rounded-lg p-3 text-xs"
              style={{
                background: "#FFF4E6",
                color: "#8A5A20",
                border: "1px solid #F5DDBC",
              }}
            >
              Comp stays bill nothing. The figure above is the rack value of{" "}
              {n0(totals.nights)} room nights given away.
            </div>
          )}
        </>
      )}

      {breakdown.length > 0 && (
        <Section
          title={
            isVilla
              ? "By bedroom layout"
              : `Villas at this size (${breakdown.length})`
          }
        >
          {isVilla ? (
            <div style={{ display: "grid", gap: 8 }}>
              {breakdown.map((c) => (
                <div
                  key={c.key}
                  style={{
                    background: T.card,
                    border: `1px solid ${T.line}`,
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="flex items-center gap-2"
                      style={{ color: T.ink, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: bedColor(Number(c.key)),
                          display: "inline-block",
                        }}
                      />
                      {c.key === "Unknown"
                        ? "Bedroom count not set"
                        : `${c.key} bedroom`}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT_NUM,
                        color: T.deep,
                        fontSize: 13,
                      }}
                    >
                      {money(c.value)}
                    </span>
                  </div>
                  <div
                    className="flex flex-wrap"
                    style={{ gap: "4px 18px", fontSize: 12, color: T.slate }}
                  >
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n0(c.bookings)}
                      </b>{" "}
                      bookings
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n0(c.nights)}
                      </b>{" "}
                      nights
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n1(c.nights / (c.bookings || 1))}
                      </b>{" "}
                      avg stay
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n1(c.guests / (c.bookings || 1))}
                      </b>{" "}
                      avg party
                    </span>
                    {tab === "overall" && totals.hasFreeFlag && (
                      <span>
                        <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                          {n0(c.paid)}
                        </b>{" "}
                        paid ·{" "}
                        <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                          {n0(c.comp)}
                        </b>{" "}
                        comp
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ScrollShell maxHeight={260}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <tbody>
                  {breakdown.map((v) => (
                    <tr
                      key={v.key}
                      className="vr-row"
                      onClick={() => onOpenVilla(v.key)}
                      style={{
                        borderTop: `1px solid ${T.line}`,
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "9px 12px", color: T.ink }}>
                        {v.key}
                      </td>
                      <td
                        style={{
                          padding: "9px 8px",
                          textAlign: "right",
                          color: T.slate,
                          fontFamily: FONT_NUM,
                        }}
                      >
                        {n0(v.bookings)}
                      </td>
                      <td
                        style={{
                          padding: "9px 12px",
                          textAlign: "right",
                          color: T.deep,
                          fontFamily: FONT_NUM,
                        }}
                      >
                        {moneyShort(v.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollShell>
          )}
        </Section>
      )}

      {isVilla && (
        <Section
          title={`Bookings by ${groupBy === "year" ? "year" : "month"}`}
          action={
            <Segmented
              size="sm"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          }
        >
          <div
            style={{
              background: T.card,
              border: `1px solid ${T.line}`,
              borderRadius: 14,
              padding: 12,
              height: 220,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trend}
                margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke={T.lineSoft} />
                <XAxis
                  dataKey={groupBy === "year" ? "year" : "month"}
                  tick={{ fill: T.slate, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: T.slate, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={TIP_STYLE}
                  cursor={{ fill: "rgba(0,58,89,0.05)" }}
                />
                <Bar dataKey="bookings" fill={T.deep} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {groupBy === "year" && (
            <p className="mt-2" style={{ fontSize: 12, color: T.slate }}>
              Yearly view ignores the page date period so the trend stays
              comparable.
            </p>
          )}
        </Section>
      )}

      {tab === "overall" &&
        totals.hasFreeFlag &&
        totals.paid + totals.comp > 0 && (
          <Section title="Paid vs comp split">
            <div
              style={{
                background: T.card,
                border: `1px solid ${T.line}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <SplitBar
                leftLabel="Paid"
                left={totals.paid}
                rightLabel="Comp"
                right={totals.comp}
              />
            </div>
          </Section>
        )}

      <Section
        title={`Guest records · ${n0(visibleRecords.length)} of ${n0(records.length)}`}
        action={
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: T.card, border: `1px solid ${T.line}` }}
            >
              <Search size={13} style={{ color: T.slate }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records"
                className="vr-focus"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  width: 130,
                  fontSize: 12,
                  color: T.ink,
                }}
              />
            </div>
            <ExportMenu
              rows={exportData}
              filenameBase={`${safeFilePart(selLabel)}_records_${safeFilePart(periodFilePart(period))}`}
              disabled={loading || !exportData.length}
            />
          </div>
        }
      >
        {loading ? (
          <Empty>Loading booking records…</Empty>
        ) : !records.length ? (
          <Empty>
            No bookings match the current period and payment filters.
          </Empty>
        ) : (
          <ScrollShell maxHeight={420}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                minWidth: 720,
              }}
            >
              <thead>
                <tr>
                  {[
                    ["Guest", "member_full_name", "left"],
                    isVilla
                      ? ["Beds", "bedroom_count", "right"]
                      : ["Villa", "villa_name", "left"],
                    ["Check in", "check_in_date", "right"],
                    ["Nights", "nights", "right"],
                    ["Party", "persons", "right"],
                    isVilla ? ["Source", "source", "left"] : null,
                    ["Value", isVilla ? "total_amount" : "revenue", "right"],
                  ]
                    .filter(Boolean)
                    .map(([label, col, align]) => (
                      <th
                        key={col}
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                          background: T.card,
                          borderBottom: `1px solid ${T.line}`,
                          padding: "9px 10px",
                        }}
                      >
                        <SortHeader
                          label={label}
                          col={col}
                          sort={sort}
                          setSort={setSort}
                          align={align}
                        />
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((r, i) => (
                  <tr
                    key={r.conf_code ?? i}
                    className="vr-row"
                    style={{ borderTop: `1px solid ${T.lineSoft}` }}
                  >
                    <td
                      style={{
                        padding: "9px 10px",
                        color: T.ink,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.member_full_name ||
                        r.member_name ||
                        r.guest_name ||
                        "—"}
                      <div style={{ color: T.slate, fontSize: 10 }}>
                        #{r.member_number ?? "—"} · {r.conf_code ?? "—"}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: isVilla ? "right" : "left",
                        color: T.muted,
                        fontFamily: isVilla ? FONT_NUM : "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isVilla
                        ? (r.bedroom_count ?? "—")
                        : (r.villa_name ?? "—")}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.check_in_date ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(r.nights)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(r.persons)}
                    </td>
                    {isVilla && (
                      <td
                        style={{
                          padding: "9px 10px",
                          color: T.muted,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.source ?? "—"}
                      </td>
                    )}
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        fontFamily: FONT_NUM,
                        color: r.is_free ? "#B07B33" : T.deep,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {money(amountOf(r))}
                      {r.is_free && (
                        <div style={{ fontSize: 9, color: T.slate }}>comp</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollShell>
        )}
        {isVilla && records.length >= DRILL_RECORD_LIMIT && (
          <p className="mt-2" style={{ fontSize: 12, color: "#B07B33" }}>
            Showing the {n0(DRILL_RECORD_LIMIT)} most recent bookings. Narrow
            the date period to see earlier stays.
          </p>
        )}
        {!isVilla && (
          <p className="mt-2" style={{ fontSize: 12, color: T.slate }}>
            Bedroom records come from /bedroom-bookings, which does not carry
            the paid/comp flag — this list shows every payment type. Open a
            villa for the split.
          </p>
        )}
      </Section>
    </SidePanel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Member vs guest panel — opened from the Total bookings card
   ═════════════════════════════════════════════════════════════════════════ */

function MemberGuestPanel({ params, period, onClose }) {
  const [data, setData] = useState({ members: [], guests: [] });
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("members");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ col: "bookings", dir: "desc" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled([
      analyticsApi.bookedPeople("members", params, {
        signal: controller.signal,
      }),
      analyticsApi.bookedPeople("guests", params, {
        signal: controller.signal,
      }),
    ])
      .then(([m, g]) => {
        if (cancelled) return;
        setData({
          members:
            m.status === "fulfilled" && Array.isArray(m.value) ? m.value : [],
          guests:
            g.status === "fulfilled" && Array.isArray(g.value) ? g.value : [],
        });
        if (m.status === "rejected" && !isAbort(m.reason))
          console.error(m.reason);
        if (g.status === "rejected" && !isAbort(g.reason))
          console.error(g.reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [params]);

  const roll = (rows) =>
    rows.reduce(
      (a, r) => ({
        accounts: a.accounts + 1,
        bookings: a.bookings + Number(r.bookings || 0),
        nights: a.nights + Number(r.nights || 0),
      }),
      { accounts: 0, bookings: 0, nights: 0 },
    );

  const memberTotals = useMemo(() => roll(data.members), [data.members]);
  const guestTotals = useMemo(() => roll(data.guests), [data.guests]);

  const rows = kind === "members" ? data.members : data.guests;
  const visible = useMemo(
    () => sortRows(searchRows(rows, search), sort.col, sort.dir),
    [rows, search, sort],
  );

  const exportData = visible.map((p) => ({
    Account: kind === "members" ? "Member" : "Guest",
    Name: p.member_full_name || p.member_name || p.folio_guest_name || "",
    "Member #": p.member_number ?? "",
    "Member Type": p.member_type ?? "",
    Email: p.email ?? "",
    Phone: p.phone ?? "",
    Country: p.country ?? "",
    State: p.state ?? "",
    Bookings: p.bookings ?? "",
    Nights: p.nights ?? "",
    "First In": p.first_check_in ?? "",
    "Last Out": p.last_check_out ?? "",
  }));

  return (
    <SidePanel
      eyebrow="Total bookings · member vs guest"
      title="Who booked"
      subtitle={periodText(period)}
      onClose={onClose}
    >
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.line}`,
          borderRadius: 16,
          padding: 18,
        }}
      >
        <SplitBar
          leftLabel="Member bookings"
          left={memberTotals.bookings}
          rightLabel="Guest bookings"
          right={guestTotals.bookings}
          leftColor={T.deep}
          rightColor={T.flame}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Members", memberTotals, T.deep],
            ["Guests", guestTotals, T.flame],
          ].map(([label, t, tone]) => (
            <div
              key={label}
              style={{
                border: `1px solid ${T.line}`,
                borderLeft: `3px solid ${tone}`,
                borderRadius: 12,
                padding: 14,
                background: T.mist,
              }}
            >
              <div
                className="text-xs font-bold uppercase"
                style={{
                  letterSpacing: "0.09em",
                  color: T.muted,
                  fontSize: 10,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 26,
                  color: T.ink,
                  marginTop: 4,
                }}
              >
                {n0(t.bookings)}{" "}
                <span style={{ fontSize: 13, color: T.slate }}>bookings</span>
              </div>
              <div style={{ fontSize: 12, color: T.link, marginTop: 2 }}>
                {n0(t.accounts)} accounts · {n0(t.nights)} nights
              </div>
            </div>
          ))}
        </div>
        <p
          className="mt-3 flex items-center gap-1"
          style={{ fontSize: 12, color: T.slate }}
        >
          Bookings without a member number can't be attributed to either side.
          <InfoTip id="split" />
        </p>
      </div>

      <Section
        title={`${kind === "members" ? "Member" : "Guest"} accounts · ${n0(visible.length)} of ${n0(
          rows.length,
        )}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setSearch("");
              }}
              options={[
                { value: "members", label: "Members" },
                { value: "guests", label: "Guests" },
              ]}
            />
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: T.card, border: `1px solid ${T.line}` }}
            >
              <Search size={13} style={{ color: T.slate }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people"
                className="vr-focus"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  width: 130,
                  fontSize: 12,
                  color: T.ink,
                }}
              />
            </div>
            <ExportMenu
              rows={exportData}
              filenameBase={`${kind}_booked_${safeFilePart(periodFilePart(period))}`}
              disabled={loading || !exportData.length}
            />
          </div>
        }
      >
        {loading ? (
          <Empty>Loading people…</Empty>
        ) : !rows.length ? (
          <Empty>No {kind} booked in this period.</Empty>
        ) : (
          <ScrollShell maxHeight={460}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                minWidth: 720,
              }}
            >
              <thead>
                <tr>
                  {[
                    ["Name", "member_full_name", "left"],
                    ["Member #", "member_number", "right"],
                    ["Type", "member_type", "left"],
                    ["Bookings", "bookings", "right"],
                    ["Nights", "nights", "right"],
                    ["First in", "first_check_in", "right"],
                    ["Last out", "last_check_out", "right"],
                  ].map(([label, col, align]) => (
                    <th
                      key={col}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                        background: T.card,
                        borderBottom: `1px solid ${T.line}`,
                        padding: "9px 10px",
                      }}
                    >
                      <SortHeader
                        label={label}
                        col={col}
                        sort={sort}
                        setSort={setSort}
                        align={align}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <tr
                    key={p.member_number ?? i}
                    className="vr-row"
                    style={{ borderTop: `1px solid ${T.lineSoft}` }}
                  >
                    <td style={{ padding: "9px 10px", color: T.ink }}>
                      {p.member_full_name ||
                        p.member_name ||
                        p.folio_guest_name ||
                        "Unknown"}
                      {p.email && (
                        <div style={{ color: T.slate, fontSize: 10 }}>
                          {p.email}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {p.member_number ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        color: p.member_type ? T.muted : "#B07B33",
                        fontWeight: p.member_type ? 400 : 700,
                      }}
                    >
                      {p.member_type ?? "Not set"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(p.bookings)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(p.nights)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.first_check_in ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.last_check_out ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollShell>
        )}
      </Section>
    </SidePanel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Page
   ═════════════════════════════════════════════════════════════════════════ */

export default function VisitsRoomsTab({ selectedVillaName, onVillaSelect }) {
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2018 + 1 }, (_, i) => current - i);
  }, []);

  const [period, setPeriod] = useState({ mode: "all" });
  const [tab, setTab] = useState("overall"); // overall | paid | free

  const [chartDim, setChartDim] = useState("villa");
  const [chartMetric, setChartMetric] = useState("bookings");
  const [chartSort, setChartSort] = useState("desc");
  const [chartLimit, setChartLimit] = useState(30);

  const [tableDim, setTableDim] = useState("villa");
  const [tableFigureMode, setTableFigureMode] = useState("overall");
  const [tableSort, setTableSort] = useState({ col: "value", dir: "desc" });
  const [query, setQuery] = useState("");

  const [selection, setSelection] = useState(null);
  const [splitOpen, setSplitOpen] = useState(false);

  const [summary, setSummary] = useState({});
  const [villaStats, setVillaStats] = useState([]);
  const [villaPaidFreeTotals, setVillaPaidFreeTotals] = useState([]);
  const [bedroomStats, setBedroomStats] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [bedroomSourceRows, setBedroomSourceRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const params = useMemo(() => periodToParams(period), [period]);

  // ── ONE request for the whole page ────────────────────────────────
  // Debounced 400ms: clicking through years in the date picker used to fire a
  // fresh request on every click with nothing cancelling the previous one, so
  // several piled up in flight, each holding a DB connection until it
  // finished. The AbortController kills whatever is still running when the
  // filter changes again, and also stops a late response overwriting fresher
  // data.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    const timer = setTimeout(() => {
      analyticsApi
        .visitsRoomsDashboard(params, { signal: controller.signal })
        .then((data) => {
          if (cancelled) return;
          setSummary(data?.summary ?? {});
          setVillaStats(
            Array.isArray(data?.villa_stats) ? data.villa_stats : [],
          );
          setVillaPaidFreeTotals(
            Array.isArray(data?.villa_paid_free_totals)
              ? data.villa_paid_free_totals
              : [],
          );
          setBedroomStats(
            Array.isArray(data?.bookings_by_bedroom)
              ? data.bookings_by_bedroom
              : [],
          );
          // These two used to be separate round trips. They now ride along in
          // the same payload — see the perf note at the top of this file.
          setSourceRows(
            Array.isArray(data?.villa_source_breakdown)
              ? data.villa_source_breakdown
              : [],
          );
          setBedroomSourceRows(
            Array.isArray(data?.villa_source_bedroom_breakdown)
              ? data.villa_source_bedroom_breakdown
              : [],
          );
        })
        .catch((err) => {
          if (isAbort(err)) return;
          console.error(err);
          if (!cancelled) setLoadError(err?.message || "Request failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [params]);

  /* villa_stats returns one row per villa AND bedroom_count — that is where
     the bedroom layouts and the published avg stay come from. */
  const villaMeta = useMemo(() => {
    const map = new Map();
    villaStats.forEach((r) => {
      if (!r.villa_name) return;
      if (!map.has(r.villa_name))
        map.set(r.villa_name, { configs: [], stayWeight: 0, bookings: 0 });
      const e = map.get(r.villa_name);
      if (r.bedroom_count != null && !e.configs.includes(r.bedroom_count))
        e.configs.push(r.bedroom_count);
      // villa_stats can repeat whole-villa authoritative booking totals across
      // bedroom-layout rows. Weight avg stay using operational row counts when
      // available so we do not multiply the villa booking count.
      const b = Number(
        (r.rate_detail_rows ?? r.rate_booking_count ?? r.bookings) || 0,
      );
      e.bookings += b;
      e.stayWeight += Number(r.avg_stay || 0) * b;
    });
    map.forEach((e) => {
      e.configs.sort((a, b) => a - b);
      e.avgStay = e.bookings ? e.stayWeight / e.bookings : null;
    });
    return map;
  }, [villaStats]);

  const villaMetricsMap = useMemo(() => {
    const map = new Map();
    villaPaidFreeTotals.forEach((r) => {
      if (!r?.villa_name) return;
      map.set(String(r.villa_name).trim().toLowerCase(), r);
    });
    return map;
  }, [villaPaidFreeTotals]);

  const getVillaMetrics = useCallback(
    (villaName) =>
      villaMetricsMap.get(
        String(villaName || "")
          .trim()
          .toLowerCase(),
      ) ?? null,
    [villaMetricsMap],
  );

  const keepRow = (r) =>
    tab === "overall" || (tab === "paid" ? !r.is_free : r.is_free);

  const villaRows = useMemo(() => {
    const map = new Map();
    sourceRows.filter(keepRow).forEach((r) => {
      const key = r.villa_name || "Unknown villa";
      if (!map.has(key))
        map.set(key, {
          key,
          name: key,
          bookings: 0,
          nights: 0,
          revenue: 0,
          compValue: 0,
          paid: 0,
          comp: 0,
          members: 0,
        });
      const e = map.get(key);
      const b = Number(r.bookings || 0);
      e.bookings += b;
      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);
      if (r.is_free) {
        e.comp += b;
        e.compValue += Number(r.free_value ?? r.total_value ?? 0);
      } else {
        e.paid += b;
        e.revenue += Number(r.revenue || 0);
      }
    });
    return [...map.values()].map((e) => {
      const meta = villaMeta.get(e.name);
      const metrics = getVillaMetrics(e.name);

      const overallBookings = Number(
        metrics?.total_unique_bookings ?? e.bookings,
      );
      const paidBookings = Number(metrics?.paid_unique_bookings ?? e.paid);
      const freeBookings = Number(metrics?.free_unique_bookings ?? e.comp);

      const overallValue = Number(metrics?.overall_total_rental ?? e.revenue);
      const paidValue = Number(metrics?.paid_total_rental ?? e.revenue);
      const freeValue = Number(metrics?.free_total_rental ?? e.compValue);

      return {
        ...e,
        metrics,
        overallBookings,
        paidBookings,
        freeBookings,
        overallValue,
        paidValue,
        freeValue,
        configs: meta?.configs ?? [],
        avgStay: meta?.avgStay ?? (e.bookings ? e.nights / e.bookings : null),
        value:
          tab === "free"
            ? freeValue
            : tab === "paid"
              ? paidValue
              : overallValue,
      };
    });
  }, [sourceRows, tab, villaMeta, getVillaMetrics]);

  // Performance-by-villa has its own Overall / Paid / Free selector.
  // Build this from ALL source rows so changing the page-level tab does not
  // hide villas or alter the figures shown in the performance table.
  const performanceVillaRows = useMemo(() => {
    const map = new Map();

    sourceRows.forEach((r) => {
      const key = r.villa_name || "Unknown villa";

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: key,
          nights: 0,
          members: 0,
          sourcePaidBookings: 0,
          sourceFreeBookings: 0,
        });
      }

      const e = map.get(key);
      const b = Number(r.bookings || 0);

      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);

      if (r.is_free) e.sourceFreeBookings += b;
      else e.sourcePaidBookings += b;
    });

    // Also include any villa that exists in the authoritative metrics even if
    // it has no source-breakdown row for the selected period.
    villaPaidFreeTotals.forEach((m) => {
      const key = m?.villa_name || "Unknown villa";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: key,
          nights: 0,
          members: 0,
          sourcePaidBookings: 0,
          sourceFreeBookings: 0,
        });
      }
    });

    return [...map.values()].map((e) => {
      const metrics = getVillaMetrics(e.name);
      const meta = villaMeta.get(e.name);

      const overallBookings = Number(
        metrics?.total_unique_bookings ??
          e.sourcePaidBookings + e.sourceFreeBookings,
      );
      const paidBookings = Number(
        metrics?.paid_unique_bookings ?? e.sourcePaidBookings,
      );
      const freeBookings = Number(
        metrics?.free_unique_bookings ?? e.sourceFreeBookings,
      );

      return {
        ...e,
        metrics,
        configs: meta?.configs ?? [],
        avgStay:
          meta?.avgStay ??
          (overallBookings ? e.nights / overallBookings : null),
        overallBookings,
        paidBookings,
        freeBookings,
        overallValue: Number(metrics?.overall_total_rental ?? 0),
        paidValue: Number(metrics?.paid_total_rental ?? 0),
        freeValue: Number(metrics?.free_total_rental ?? 0),
        paid: paidBookings,
        comp: freeBookings,
      };
    });
  }, [sourceRows, villaPaidFreeTotals, villaMeta, getVillaMetrics]);

  const bedroomRows = useMemo(() => {
    const stayByBed = new Map(
      bedroomStats.map((r) => [Number(r.beds), Number(r.avg_stay || 0)]),
    );
    const map = new Map();
    bedroomSourceRows.filter(keepRow).forEach((r) => {
      const key = r.bedroom_count ?? "Unknown";
      if (!map.has(key))
        map.set(key, {
          key,
          name: key === "Unknown" ? "Not set" : `${key} bedroom`,
          configs: [Number(key)],
          bookings: 0,
          nights: 0,
          revenue: 0,
          compValue: 0,
          paid: 0,
          comp: 0,
          members: 0,
        });
      const e = map.get(key);
      const b = Number(r.bookings || 0);
      e.bookings += b;
      e.nights += Number(r.total_nights || 0);
      e.members += Number(r.unique_members || 0);
      if (r.is_free) {
        e.comp += b;
        e.compValue += Number(r.free_value || 0);
      } else {
        e.paid += b;
        e.revenue += Number(r.revenue || 0);
      }
    });
    return [...map.values()].map((e) => ({
      ...e,
      avgStay:
        stayByBed.get(Number(e.key)) ??
        (e.bookings ? e.nights / e.bookings : null),
      value: tab === "free" ? e.compValue : e.revenue,
    }));
  }, [bedroomSourceRows, bedroomStats, tab]);

  // Authoritative villa figures for the currently selected page tab.
  //
  // Booking counts and dollar values come from villa_paid_free_totals.
  // Operational measures such as nights/members still come from the source
  // breakdown so existing drill-down behaviour remains unchanged.
  const activeVillaRows = useMemo(() => {
    const operationalByVilla = new Map(
      villaRows.map((r) => [
        String(r.name || "")
          .trim()
          .toLowerCase(),
        r,
      ]),
    );

    return performanceVillaRows.map((r) => {
      const operational =
        operationalByVilla.get(
          String(r.name || "")
            .trim()
            .toLowerCase(),
        ) ?? null;

      const bookings =
        tab === "paid"
          ? Number(r.paidBookings || 0)
          : tab === "free"
            ? Number(r.freeBookings || 0)
            : Number(r.overallBookings || 0);

      const value =
        tab === "paid"
          ? Number(r.paidValue || 0)
          : tab === "free"
            ? Number(r.freeValue || 0)
            : Number(r.overallValue || 0);

      const nights = Number(operational?.nights ?? 0);

      return {
        ...r,
        bookings,
        value,
        nights,
        members: Number(operational?.members ?? r.members ?? 0),
        avgStay: operational?.avgStay ?? (bookings ? nights / bookings : null),
      };
    });
  }, [performanceVillaRows, villaRows, tab]);

  const totals = useMemo(() => {
    const authoritative = activeVillaRows.reduce(
      (a, r) => ({
        bookings: a.bookings + Number(r.bookings || 0),
        value: a.value + Number(r.value || 0),
      }),
      { bookings: 0, value: 0 },
    );

    const operational = villaRows.reduce(
      (a, r) => ({
        nights: a.nights + Number(r.nights || 0),
        revenue: a.revenue + Number(r.revenue || 0),
        compValue: a.compValue + Number(r.compValue || 0),
      }),
      {
        nights: 0,
        revenue: 0,
        compValue: 0,
      },
    );

    const paid = performanceVillaRows.reduce(
      (s, r) => s + Number(r.paidBookings || 0),
      0,
    );

    const comp = performanceVillaRows.reduce(
      (s, r) => s + Number(r.freeBookings || 0),
      0,
    );

    const unsplit = tab === "overall";

    return {
      ...operational,
      bookings: authoritative.bookings,
      value: authoritative.value,
      paid,
      comp,
      avgStay: unsplit
        ? (summary?.avg_length_of_stay ?? null)
        : authoritative.bookings
          ? operational.nights / authoritative.bookings
          : null,
      avgParty: unsplit ? (summary?.avg_party_size ?? null) : null,
      avgStayDerived: !unsplit,
    };
  }, [activeVillaRows, performanceVillaRows, villaRows, tab, summary]);

  const leaders = useMemo(() => {
    const withBookings = activeVillaRows.filter(
      (r) => Number(r.bookings || 0) > 0,
    );

    const withValue = activeVillaRows.filter((r) => Number(r.value || 0) > 0);

    const byBookings = [...withBookings].sort(
      (a, b) => Number(b.bookings) - Number(a.bookings),
    );

    const byValue = [...withValue].sort(
      (a, b) => Number(b.value) - Number(a.value),
    );

    return {
      mostBooked: byBookings[0],
      leastBooked: byBookings[byBookings.length - 1],
      mostValue: byValue[0],
      leastValue: byValue[byValue.length - 1],
    };
  }, [activeVillaRows]);

  const chartAll = useMemo(() => {
    const rows = chartDim === "villa" ? activeVillaRows : bedroomRows;

    const metricKey = chartMetric === "revenue" ? "value" : chartMetric;

    const arr = rows.map((r) => ({
      ...r,
      label: chartDim === "villa" ? r.name : `${r.key} bed`,
    }));

    arr.sort((a, b) =>
      chartSort === "name"
        ? String(a.label).localeCompare(String(b.label))
        : chartSort === "asc"
          ? Number(a[metricKey] || 0) - Number(b[metricKey] || 0)
          : Number(b[metricKey] || 0) - Number(a[metricKey] || 0),
    );

    return arr;
  }, [activeVillaRows, bedroomRows, chartDim, chartMetric, chartSort]);

  const chartData =
    chartDim === "bedroom" || chartLimit === "all"
      ? chartAll
      : chartAll.slice(0, chartLimit);

  const chartKey = chartMetric === "revenue" ? "value" : chartMetric;

  const valueLabel =
    tab === "free"
      ? "Free value"
      : tab === "paid"
        ? "Paid revenue"
        : "Overall revenue";

  const tableRows = useMemo(() => {
    let rows;

    if (tableDim === "villa") {
      rows = performanceVillaRows.map((r) => {
        const value =
          tableFigureMode === "paid"
            ? r.paidValue
            : tableFigureMode === "free"
              ? r.freeValue
              : r.overallValue;

        const bookings =
          tableFigureMode === "paid"
            ? r.paidBookings
            : tableFigureMode === "free"
              ? r.freeBookings
              : r.overallBookings;

        return {
          ...r,
          value,
          bookings,
        };
      });
    } else {
      rows = bedroomRows;
    }

    const searched = query.trim()
      ? rows.filter((r) =>
          String(r.name).toLowerCase().includes(query.trim().toLowerCase()),
        )
      : rows;

    return sortRows(searched, tableSort.col, tableSort.dir);
  }, [
    performanceVillaRows,
    bedroomRows,
    tableDim,
    tableFigureMode,
    query,
    tableSort,
  ]);

  const performanceValueLabel =
    tableDim === "villa"
      ? tableFigureMode === "paid"
        ? "Paid revenue"
        : tableFigureMode === "free"
          ? "Free value"
          : "Overall revenue"
      : valueLabel;

  const tableExport = tableRows.map((r) => ({
    [tableDim === "villa" ? "Villa" : "Bedrooms"]: r.name,
    Bedrooms: r.configs?.join(" / ") ?? "",
    "Displayed Figure": tableDim === "villa" ? tableFigureMode : tab,
    "Displayed Value": r.value,
    "Overall Revenue": tableDim === "villa" ? r.overallValue : "",
    "Paid Revenue": tableDim === "villa" ? r.paidValue : r.revenue,
    "Free Value": tableDim === "villa" ? r.freeValue : r.compValue,
    Bookings: r.bookings,
    Paid: r.paid,
    Comp: r.comp,
    "Nights Spent": r.nights,
    "Avg Stay": r.avgStay == null ? "" : Number(r.avgStay).toFixed(1),
    Members: r.members,
  }));

  const openVilla = (name) => {
    const meta = villaMeta.get(name);
    onVillaSelect?.(name);
    setSelection({
      kind: "villa",
      key: name,
      label: name,
      configs: meta?.configs ?? [],
    });
  };
  const openBedroom = (beds) =>
    setSelection({
      kind: "bedroom",
      key: beds,
      label: `${beds}-bedroom stays`,
    });

  const openFromChart = (d) => {
    if (!d) return;
    if (chartDim === "villa") openVilla(d.key);
    else if (d.key !== "Unknown") openBedroom(d.key);
  };

  const barWidth = chartDim === "villa" ? 48 : 96;
  const plotWidth = Math.max(720, chartData.length * barWidth);

  return (
    <div className="dashboard-section visits-page">
      <style>{`
        .vr-focus:focus-visible { outline: 2px solid ${T.deep}; outline-offset: 2px; }
        .vr-row:hover { background: ${T.mist}; }
        .vr-lift { transition: box-shadow .18s ease, transform .18s ease; }
        .vr-lift:hover { box-shadow: 0 8px 22px rgba(26,39,51,0.08); }
        .vr-grip { opacity: .55; transition: opacity .15s ease; }
        [role="separator"]:hover .vr-grip { opacity: 1; }
        .vr-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .vr-scroll::-webkit-scrollbar-track { background: ${T.mist}; border-radius: 8px; }
        .vr-scroll::-webkit-scrollbar-thumb { background: #C7D8E4; border-radius: 8px; }
        .vr-scroll::-webkit-scrollbar-thumb:hover { background: ${T.link}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            className="text-xs font-bold uppercase"
            style={{ letterSpacing: "0.12em", color: T.link, fontSize: 11 }}
          >
            Visits &amp; rooms
          </div>
          <h1
            className="visits-page-title"
            style={{
              fontFamily: FONT_DISPLAY,
              color: T.ink,
              margin: "4px 0 0",
              lineHeight: 1,
            }}
          >
            Villa bookings
          </h1>
          <p className="mt-1" style={{ fontSize: 12, color: T.slate }}>
            {loading
              ? "Updating…"
              : `${n0(performanceVillaRows.length)} villas in this period`}
          </p>
        </div>
        <div className="visits-toolbar">
          <Segmented
            value={tab}
            onChange={(v) => {
              setTab(v);
              setSelection(null);
            }}
            options={[
              { value: "overall", label: "Overall" },
              { value: "paid", label: "Paid" },
              { value: "free", label: "Comp" },
            ]}
          />
          <DatePeriod period={period} onChange={setPeriod} years={years} />
        </div>
      </div>

      {/* A failed load used to leave the page silently empty, which looked
          identical to "no bookings in this period". Say which it is. */}
      {loadError && (
        <div
          className="rounded-xl p-3 text-xs"
          style={{
            background: "#FFF4E6",
            color: "#8A5A20",
            border: "1px solid #F5DDBC",
          }}
        >
          Could not load this period: {loadError}
        </div>
      )}

      {/* ── Revenue banner ─────────────────────────────────────────────── */}
      <div
        className="visits-revenue-banner flex flex-wrap items-end justify-between gap-6"
        style={{
          background: T.ink,
          borderRadius: 18,
          color: "#fff",
        }}
      >
        <div>
          <div
            className="text-xs font-bold uppercase"
            style={{ letterSpacing: "0.12em", color: T.flame, fontSize: 11 }}
          >
            {tab === "free" ? "Total comp value" : "Total villa revenue"}
          </div>
          <div
            className="visits-revenue-value"
            style={{
              fontFamily: FONT_DISPLAY,
              lineHeight: 1,
              marginTop: 10,
            }}
          >
            {money(
              tab === "overall" ? summary?.villa_rental_revenue : totals.value,
            )}
          </div>
        </div>
        <div style={{ fontSize: 14, color: "#A8C6D8", maxWidth: 420 }}>
          {tab === "free"
            ? "Comp stays bill nothing — this is the rack value of the rooms given away."
            : `${n0(totals.bookings)} bookings · ${periodText(period)}`}
          {tab === "overall" && (
            <div className="mt-2" style={{ fontSize: 12 }}>
              Villa Income from owner statements
            </div>
          )}
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <div className="visits-summary-grid">
        <StatCard
          label="Total bookings"
          value={n0(totals.bookings)}
          note={
            tab === "overall"
              ? "Member vs guest split — open"
              : `${tab === "paid" ? "Paid" : "Comp"} bookings only`
          }
          icon={CalendarDays}
          onClick={() => setSplitOpen(true)}
        />
        <StatCard
          label="Total room nights"
          value={n0(totals.nights)}
          note="Occupied room-date nights"
          icon={Moon}
        />
        <StatCard
          label="Avg length of stay"
          value={totals.avgStay == null ? "—" : n1(totals.avgStay)}
          unit="nights"
          note={
            totals.avgStayDerived
              ? "Nights ÷ bookings for this filter"
              : "Nights per booking"
          }
          icon={CalendarClock}
        />
        <StatCard
          label="Avg party size"
          value={totals.avgParty == null ? "—" : n1(totals.avgParty)}
          unit={totals.avgParty == null ? "" : "guests"}
          note={
            totals.avgParty == null
              ? "Not published per payment type"
              : "People per booking"
          }
          icon={Users}
        />
      </div>

      {/* ── Leaders ────────────────────────────────────────────────────── */}
      <div className="visits-leader-grid">
        <LeaderCard
          label="Most booked"
          tone={T.deep}
          icon={TrendingUp}
          name={leaders.mostBooked?.name}
          primary={
            leaders.mostBooked
              ? `${n0(leaders.mostBooked.bookings)} bookings`
              : "—"
          }
          secondary={
            leaders.mostBooked
              ? `${n0(leaders.mostBooked.nights)} nights spent`
              : ""
          }
          onOpen={() =>
            leaders.mostBooked && openVilla(leaders.mostBooked.name)
          }
        />
        <LeaderCard
          label="Least booked"
          tone="#B0CADB"
          icon={TrendingDown}
          name={leaders.leastBooked?.name}
          primary={
            leaders.leastBooked
              ? `${n0(leaders.leastBooked.bookings)} bookings`
              : "—"
          }
          secondary={
            leaders.leastBooked
              ? `${n0(leaders.leastBooked.nights)} nights spent`
              : ""
          }
          onOpen={() =>
            leaders.leastBooked && openVilla(leaders.leastBooked.name)
          }
        />
        <LeaderCard
          label={
            tab === "free"
              ? "Most free value"
              : tab === "paid"
                ? "Most paid revenue"
                : "Most overall revenue"
          }
          tone={T.flame}
          icon={ArrowUpRight}
          name={leaders.mostValue?.name}
          primary={leaders.mostValue ? money(leaders.mostValue.value) : "—"}
          secondary={
            leaders.mostValue
              ? `${n0(leaders.mostValue.bookings)} bookings`
              : ""
          }
          onOpen={() => leaders.mostValue && openVilla(leaders.mostValue.name)}
        />
        <LeaderCard
          label={
            tab === "free"
              ? "Least free value"
              : tab === "paid"
                ? "Least paid revenue"
                : "Least overall revenue"
          }
          tone="#85AEC7"
          icon={ArrowDownRight}
          name={leaders.leastValue?.name}
          primary={leaders.leastValue ? money(leaders.leastValue.value) : "—"}
          secondary={
            leaders.leastValue
              ? `${n0(leaders.leastValue.bookings)} bookings`
              : ""
          }
          onOpen={() =>
            leaders.leastValue && openVilla(leaders.leastValue.name)
          }
        />
      </div>

      {/* ── Chart ──────────────────────────────────────────────────────── */}
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
              {chartMetric === "bookings"
                ? "Bookings"
                : chartMetric === "revenue"
                  ? valueLabel
                  : "Nights"}{" "}
              by {chartDim === "villa" ? "villa" : "bedroom count"}
            </h2>
            <p className="mt-0.5" style={{ fontSize: 12, color: T.slate }}>
              Select a bar to open its full record. Scroll sideways for the
              rest.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={chartDim}
              onChange={setChartDim}
              options={[
                { value: "villa", label: "Villa" },
                { value: "bedroom", label: "Bedrooms" },
              ]}
            />
            <Segmented
              size="sm"
              value={chartMetric}
              onChange={setChartMetric}
              options={[
                { value: "bookings", label: "Bookings" },
                { value: "revenue", label: valueLabel },
                { value: "nights", label: "Nights" },
              ]}
            />
            <Segmented
              size="sm"
              value={chartSort}
              onChange={setChartSort}
              options={[
                { value: "desc", label: "High–low" },
                { value: "asc", label: "Low–high" },
                { value: "name", label: "A–Z" },
              ]}
            />
            {chartDim === "villa" && (
              <Segmented
                size="sm"
                value={chartLimit}
                onChange={setChartLimit}
                options={[
                  { value: 10, label: "Top 10" },
                  { value: 30, label: "Top 30" },
                  { value: 60, label: "Top 60" },
                  { value: "all", label: `All ${chartAll.length}` },
                ]}
              />
            )}
            <InfoTip id="chart" />
          </div>
        </div>

        {!chartData.length ? (
          <Empty>
            No bookings match the current period and payment filters.
          </Empty>
        ) : (
          <div
            className="vr-scroll"
            style={{ overflowX: "auto", paddingBottom: 4 }}
          >
            <div style={{ width: plotWidth, height: 460 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{
                    top: 10,
                    right: 10,
                    left: 0,
                    bottom: chartDim === "villa" ? 70 : 10,
                  }}
                >
                  <CartesianGrid vertical={false} stroke={T.lineSoft} />
                  <XAxis
                    dataKey="label"
                    interval={0}
                    angle={chartDim === "villa" ? -40 : 0}
                    textAnchor={chartDim === "villa" ? "end" : "middle"}
                    height={chartDim === "villa" ? 92 : 34}
                    tick={{ fill: T.muted, fontSize: 11 }}
                    axisLine={{ stroke: T.line }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: T.muted, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tickFormatter={(v) =>
                      chartMetric === "revenue" ? moneyShort(v) : n0(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0,58,89,0.05)" }}
                    contentStyle={TIP_STYLE}
                    formatter={(v) => [
                      chartMetric === "revenue" ? money(v) : n0(v),
                      chartMetric === "revenue" ? valueLabel : chartMetric,
                    ]}
                  />
                  <Bar
                    dataKey={chartKey}
                    radius={[5, 5, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => openFromChart(d?.payload ?? d)}
                  >
                    {chartData.map((d) => (
                      <Cell
                        key={d.key}
                        fill={
                          chartDim === "bedroom"
                            ? bedColor(Number(d.key))
                            : bedColor(
                                d.configs?.length
                                  ? Math.min(...d.configs)
                                  : null,
                              )
                        }
                        stroke={
                          selection && selection.key === d.key
                            ? T.flame
                            : "none"
                        }
                        strokeWidth={3}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div
          className="mt-3 flex flex-wrap items-center"
          style={{ gap: "4px 16px" }}
        >
          <span style={{ fontSize: 12, color: T.slate }}>
            {chartDim === "villa"
              ? "Bar colour = villa's smallest bedroom layout"
              : "Bar colour = bedroom count"}
          </span>
          {[2, 3, 4, 5, 6, 7].map((b) => (
            <span
              key={b}
              className="flex items-center gap-1.5"
              style={{ fontSize: 12, color: T.muted }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: bedColor(b),
                  display: "inline-block",
                }}
              />
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* ── Performance table ──────────────────────────────────────────── */}
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
                      {tableDim === "villa" &&
                        tableFigureMode === "overall" && (
                          <div style={{ fontSize: 10, color: T.slate }}>
                            {n0(r.paidBookings)} paid · {n0(r.freeBookings)}{" "}
                            free
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

      {/* Panels mount only while open — nothing dereferences a cleared selection. */}
      {selection && (
        <DrillPanel
          selection={selection}
          tab={tab}
          params={params}
          period={period}
          onClose={() => setSelection(null)}
          onOpenVilla={openVilla}
          villaMetrics={
            selection.kind === "villa" ? getVillaMetrics(selection.key) : null
          }
        />
      )}

      {splitOpen && (
        <MemberGuestPanel
          params={params}
          period={period}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </div>
  );
}
