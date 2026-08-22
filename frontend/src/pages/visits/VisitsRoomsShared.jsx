// frontend/src/pages/visits/VisitsRoomsShared.jsx
//
// Design tokens, formatters/helpers, export helpers, and generic UI atoms
// shared across the visits/rooms tab pieces (VisitsRoomsTab.jsx and its
// siblings in this folder).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Download,
  Info,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ══════════════════════════════════════════════════════════════════════════
   Design tokens
   ═════════════════════════════════════════════════════════════════════════ */

export const T = {
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
export const BED_COLOR = {
  1: "#D6E4EE",
  2: "#B0CADB",
  3: "#85AEC7",
  4: "#5590B0",
  5: "#2A6C8F",
  6: "#003A59",
  7: "#1A2733",
  8: "#FFB063",
};
export const bedColor = (b) => BED_COLOR[b] || "#B0CADB";

export const FONT_DISPLAY =
  "'Cormorant Garamond', 'Iowan Old Style', Georgia, serif";
export const FONT_NUM =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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

export const TIP_STYLE = {
  border: `1px solid ${T.line}`,
  borderRadius: 10,
  background: "#fff",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(26,39,51,0.12)",
};

/* ══════════════════════════════════════════════════════════════════════════
   Formatters + helpers
   ═════════════════════════════════════════════════════════════════════════ */

export const n0 = (v) =>
  v == null ? "—" : Math.round(Number(v)).toLocaleString();
export const n1 = (v) => (v == null ? "—" : Number(v).toFixed(1));
export const money = (v) =>
  v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;
export const moneyShort = (v) => {
  const x = Number(v || 0);
  if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (Math.abs(x) >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${Math.round(x)}`;
};
export const pct = (part, whole) =>
  !Number(whole || 0)
    ? "0%"
    : `${Math.round((Number(part || 0) / Number(whole)) * 100)}%`;

export const isoToNum = (iso) => Number(String(iso).replace(/-/g, ""));
export const fmtISO = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

export const safeFilePart = (v) =>
  String(v || "all")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

/* Ignore AbortError — it only means a newer request superseded this one. */
export const isAbort = (err) => err?.name === "AbortError";

/* Period: {mode:'all'} | {mode:'year',year} | {mode:'month',year,month} | {mode:'range',from,to} */

export const periodText = (p) => {
  if (!p || p.mode === "all") return "All time";
  if (p.mode === "year") return String(p.year);
  if (p.mode === "month") return `${MONTHS[p.month]} ${p.year}`;
  return `${fmtISO(p.from)} – ${fmtISO(p.to)}`;
};

export const periodToParams = (p) => {
  if (!p || p.mode === "all") return {};
  if (p.mode === "year") return { year: p.year };
  if (p.mode === "month") return { year: p.year, month: p.month + 1 };
  return { start_date: p.from, end_date: p.to };
};

export const periodFilePart = (p) => {
  if (!p || p.mode === "all") return "all_dates";
  if (p.mode === "year") return String(p.year);
  if (p.mode === "month") return `${p.year}_${MONTHS[p.month]}`;
  return `${p.from}_to_${p.to}`;
};

export const searchRows = (rows, q) => {
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

export const sortRows = (rows, key, dir = "desc") => {
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

export function exportRows(rows, filenameBase, format) {
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

export function Segmented({ value, onChange, options, size = "md" }) {
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

export function Field({ label, value, onChange, options }) {
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

export function InfoTip({ id }) {
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

export function DatePeriod({ period, onChange, years }) {
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

export function ExportMenu({ rows, filenameBase, disabled }) {
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

export function ScrollShell({ children, maxHeight = 400 }) {
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

export function Section({ title, action, children }) {
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

export function Empty({ children }) {
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

export function SidePanel({ eyebrow, title, subtitle, onClose, children }) {
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

export function SplitBar({
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
