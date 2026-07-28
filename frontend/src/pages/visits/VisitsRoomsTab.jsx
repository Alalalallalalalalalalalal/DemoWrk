import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  BedDouble,
  Users,
  CalendarClock,
  DollarSign,
  ArrowUpRight,
  X,
  Info,
  Download,
  ChevronDown,
  LayoutDashboard,
  Tag,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { analyticsApi } from "../../api/analytics";
import VillaSourceBreakdown from "./VillaSourceBreakdown";

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
  textTransform: "uppercase",
};

// ─── Chart info tooltips ────────────────────────────────────────────────────

const CHART_INFO = {
  totalMembersBooked: {
    summary:
      "Counts unique member numbers associated with villa activity during the selected period.",
    functionality:
      "Member numbers are collected from valid Rate Details bookings, Rooms records, and Villa Income Statement Details, then classified through the Members table. Repeat activity by the same member is counted once.",
    x: null,
    y: null,
  },
  totalGuestsBooked: {
    summary:
      "Counts unique guest account numbers associated with villa activity during the selected period.",
    functionality:
      "Guest classification comes from the Members table. A guest account appearing on multiple bookings is counted once. This is not the total number of people who stayed.",
    x: null,
    y: null,
  },
  averageLengthOfStay: {
    summary: "Shows the average number of nights per valid villa booking.",
    functionality:
      "Stay length is calculated from the earliest check-in date to the latest check-out date for each unique confirmation code, then averaged across all included bookings.",
    x: null,
    y: null,
  },
  averagePartySize: {
    summary: "Shows the average number of people attached to each booking.",
    functionality:
      "Party size comes from Reservation Guests records linked by confirmation code. Bookings without guest records default to one person.",
    x: null,
    y: null,
  },
  totalRoomNights: {
    summary: "Adds occupied room-date combinations across valid bookings.",
    functionality:
      "Each distinct room and rate date counts as one room night. Where detailed room-date records are unavailable, the booking stay length is used as a fallback.",
    x: null,
    y: null,
  },
  villaRentalRevenue: {
    summary: "Shows villa income for the selected period.",
    functionality:
      "The amount is summed from Owner Payout Total in the Statement Villa Income Summary table. It is separate from booking Total Rental values in Rate Details.",
    x: null,
    y: null,
  },
  bookingsByVilla: {
    summary: "Shows valid unique bookings by villa and bedroom configuration.",
    functionality:
      "Each confirmation code is counted once using its latest Rate Details record. Unposted, cancelled, and no-show reservations are excluded. Hover a bar for the exact booking count.",
    x: "Villa name",
    y: "Number of valid bookings",
  },
  villaMonthlyBookings: {
    summary:
      "Breaks down how bookings for the selected villa are distributed across calendar months.",
    functionality:
      "Hover a point for the exact monthly booking count. Change the selected villa by clicking a different row in the performance table.",
    x: "Month (Jan–Dec)",
    y: "Number of bookings",
  },
  villaMonthlyRevenue: {
    summary:
      "Shows paid booking value for the selected villa by calendar month.",
    functionality:
      "The value is based on Total Rental from valid Rate Details bookings not classified as free or complimentary. Hover a bar for the exact monthly amount.",
    x: "Month (Jan–Dec)",
    y: "Paid booking value in USD",
  },
  bookingsByBedroom: {
    summary:
      "Compares booking volume across different bedroom configurations to reveal which villa sizes are most in demand.",
    functionality:
      "Hover a bar for exact booking count per bedroom tier. Use alongside the avg-stay chart to understand whether larger villas attract longer stays.",
    x: "Number of bedrooms",
    y: "Number of confirmed bookings",
  },
  avgStayByBedroom: {
    summary: "Shows the average length of stay for each bedroom configuration.",
    functionality:
      "Stay length is calculated from check-in to check-out for each unique confirmation code in Rate Details. Unposted, cancelled, and no-show reservations are excluded.",
    x: "Number of bedrooms",
    y: "Average stay in nights",
  },
  bookingsByMonth: {
    summary:
      "Tracks booking volume month-by-month across all villas to surface seasonal demand patterns.",
    functionality:
      "Hover a point for the exact monthly count. This chart uses check-in date as the reference, so a booking confirmed in March for a June stay appears in June.",
    x: "Month (Jan–Dec)",
    y: "Number of confirmed bookings",
  },
  revenueByMonth: {
    summary: "Shows villa income by month across all villas.",
    functionality:
      "The amount is summed from Owner Payout Total in the Statement Villa Income Summary table. Hover a bar for the exact monthly total.",
    x: "Month (Jan–Dec)",
    y: "Villa income in USD",
  },

  villaTable: {
    summary:
      "Ranks villas using valid unique bookings and compares bedrooms, bookings, room nights, average stay, and paid booking value.",
    functionality:
      "Bookings are deduplicated by confirmation code from Rate Details. Room Nights count occupied room-date combinations, while Revenue includes paid Total Rental only. Click a row to open its booking timeline.",
    x: null,
    y: null,
  },
};

function ChartInfo({ id }) {
  const [open, setOpen] = useState(false);
  const info = CHART_INFO[id];
  if (!info) return null;

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Chart information"
        style={{
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: open ? C.accent2 : C.muted,
          display: "flex",
          alignItems: "center",
          borderRadius: 6,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = C.accent2)}
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = open ? C.accent2 : C.muted)
        }
      >
        <Info size={15} />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: 280,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
              padding: "14px 16px",
              fontSize: 12,
              color: C.soft,
              lineHeight: 1.55,
            }}
          >
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.muted,
                padding: 2,
                display: "flex",
              }}
            >
              <X size={13} />
            </button>

            <p
              style={{
                margin: "0 0 10px",
                color: C.text,
                fontSize: 12,
                paddingRight: 16,
              }}
            >
              {info.summary}
            </p>

            {(info.x || info.y) && (
              <div
                style={{
                  borderTop: `1px solid ${C.border}`,
                  paddingTop: 10,
                  marginBottom: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                {info.x && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: C.accent2,
                        minWidth: 14,
                        fontSize: 11,
                      }}
                    >
                      X
                    </span>
                    <span>{info.x}</span>
                  </div>
                )}
                {info.y && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: C.accent,
                        minWidth: 14,
                        fontSize: 11,
                      }}
                    >
                      Y
                    </span>
                    <span>{info.y}</span>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                borderTop: `1px solid ${C.border}`,
                paddingTop: 10,
                color: C.muted,
                fontSize: 11,
              }}
            >
              {info.functionality}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Export helpers ─────────────────────────────────────────────────────────

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

// ─── Table utilities ─────────────────────────────────────────────────────────

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
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * mult;
    return (
      String(av).localeCompare(String(bv), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * mult
    );
  });
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

// ─── UI primitives ────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, sub, onClick, infoId }) {
  const clickable = Boolean(onClick);
  return (
    <div style={{ padding: "0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={onClick}
          disabled={!clickable}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: clickable ? "pointer" : "default",
            color: "inherit",
          }}
        >
          {Icon && <Icon size={15} color={C.accent2} />}
          <span
            className="dashboard-eyebrow"
            style={{
              textDecoration: clickable ? "underline" : "none",
              textUnderlineOffset: 3,
            }}
          >
            {label}
          </span>
        </button>
        {infoId && <ChartInfo id={infoId} />}
      </div>
      <div
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 28,
          color: C.text,
          marginTop: 5,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>
    </div>
  );
}

function Card({ title, sub, children, action }) {
  return (
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
          <div className="dashboard-eyebrow">{sub}</div>
          <h2 className="dashboard-card-title">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const optionLabel = (option, label) => {
  if (option === "All") return `All ${label}s`;
  if (option === "asc") return "Ascending";
  if (option === "desc") return "Descending";
  return String(option)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

function Select({ label, value, onChange, options }) {
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
            {optionLabel(o, label)}
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

  const changeMode = (mode) => {
    onChange({
      mode,
      year: value.year ?? "All",
      month: value.month ?? "All",
      date: value.date ?? "",
      startDate: value.startDate ?? "",
      endDate: value.endDate ?? "",
    });
  };

  return (
    <div
      style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}
    >
      <Select
        label="Mode"
        value={value.mode}
        onChange={changeMode}
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
function TableControls({
  search,
  onSearchChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
  sortOptions,
  placeholder = "Search table...",
}) {
  return (
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
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder}
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
        value={sortKey}
        onChange={onSortKeyChange}
        options={sortOptions}
      />
      <Select
        label="Order"
        value={sortDir}
        onChange={onSortDirChange}
        options={["asc", "desc"]}
      />
    </div>
  );
}

// ─── Top-level view toggle ────────────────────────────────────────────────────

const TOP_VIEWS = [
  {
    key: "overall",
    label: "Overall",
    icon: LayoutDashboard,
    desc: "Full villa booking performance",
  },
  {
    key: "sources",
    label: "Booking Sources",
    icon: Tag,
    desc: "Business-source performance, paid vs. free/comp, trends, and drill-downs",
  },
];

function TopViewToggle({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 4,
      }}
    >
      {TOP_VIEWS.map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 18px",
              borderRadius: 12,
              border: "none",
              background: active ? C.accent : "transparent",
              color: active ? "#fff" : C.muted,
              fontWeight: active ? 800 : 500,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.18s",
              letterSpacing: active ? "0.01em" : "0",
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VisitsRoomsTab({
  selectedVillaName,
  onVillaSelect,
  onGoToML,
}) {
  // ── Shared constants ──────────────────────────────────────────────────────
  const months = [
    "All",
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

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [
      "All",
      ...Array.from(
        { length: currentYear - 2018 + 1 },
        (_, i) => currentYear - i,
      ),
    ];
  }, []);

  const createDateFilter = () => ({
    mode: "ym", // ym | day | range
    year: "All",
    month: "All",
    date: "",
    startDate: "",
    endDate: "",
  });

  const toDateParams = (filter) => {
    if (filter.mode === "day") {
      return filter.date ? { date: filter.date } : {};
    }

    if (filter.mode === "range") {
      return filter.startDate && filter.endDate
        ? { start_date: filter.startDate, end_date: filter.endDate }
        : {};
    }

    return {
      year: filter.year === "All" ? null : Number(filter.year),
      month: filter.month === "All" ? null : months.indexOf(filter.month),
    };
  };

  const dateFilterFilePart = (filter) => {
    if (filter.mode === "day") return filter.date || "all_dates";
    if (filter.mode === "range") {
      return filter.startDate && filter.endDate
        ? `${filter.startDate}_to_${filter.endDate}`
        : "all_dates";
    }
    return `${filter.year}_${filter.month}`;
  };

  // ── Top-level view ────────────────────────────────────────────────────────
  const [topView, setTopView] = useState("overall");

  // ── Tab-level data ────────────────────────────────────────────────────────
  const [summaryData, setSummaryData] = useState({});
  const [villaChartData, setVillaChartData] = useState([]);
  const [villaTableData, setVillaTableData] = useState([]);
  const [villaMonthlyData, setVillaMonthlyData] = useState([]);
  const [bookingsByBedroomData, setBookingsByBedroomData] = useState([]);
  const [monthlyRevenueData, setMonthlyRevenueData] = useState([]);
  const [visitsDataLoading, setVisitsDataLoading] = useState(false);

  const [summaryFilter, setSummaryFilter] = useState(createDateFilter);
  const [villaChartFilter, setVillaChartFilter] = useState(createDateFilter);
  const [villaTableFilter, setVillaTableFilter] = useState(createDateFilter);
  const [selectedVillaChartFilter, setSelectedVillaChartFilter] =
    useState(createDateFilter);
  const [bedroomChartFilter, setBedroomChartFilter] =
    useState(createDateFilter);
  const [monthlyChartFilter, setMonthlyChartFilter] =
    useState(createDateFilter);

  const [villaTableSearch, setVillaTableSearch] = useState("");
  const [villaTableSortKey, setVillaTableSortKey] = useState("bookings");
  const [villaTableSortDir, setVillaTableSortDir] = useState("desc");

  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleSortKey, setPeopleSortKey] = useState("bookings");
  const [peopleSortDir, setPeopleSortDir] = useState("desc");

  const [bedroomSearch, setBedroomSearch] = useState("");
  const [bedroomSortKey, setBedroomSortKey] = useState("check_in_date");
  const [bedroomSortDir, setBedroomSortDir] = useState("desc");

  const [villaBookingSearch, setVillaBookingSearch] = useState("");
  const [villaBookingSortKey, setVillaBookingSortKey] =
    useState("check_in_date");
  const [villaBookingSortDir, setVillaBookingSortDir] = useState("desc");

  const summaryFilters = useMemo(
    () => toDateParams(summaryFilter),
    [summaryFilter],
  );
  const villaChartFilters = useMemo(
    () => toDateParams(villaChartFilter),
    [villaChartFilter],
  );
  const villaTableFilters = useMemo(
    () => toDateParams(villaTableFilter),
    [villaTableFilter],
  );
  const selectedVillaChartFilters = useMemo(
    () => toDateParams(selectedVillaChartFilter),
    [selectedVillaChartFilter],
  );
  const bedroomChartFilters = useMemo(
    () => toDateParams(bedroomChartFilter),
    [bedroomChartFilter],
  );
  const monthlyChartFilters = useMemo(
    () => toDateParams(monthlyChartFilter),
    [monthlyChartFilter],
  );

  useEffect(() => {
    if (topView !== "overall") return;
    let cancelled = false;
    async function loadSummary() {
      setVisitsDataLoading(true);
      try {
        const data = await analyticsApi.visitsRoomsDashboard(summaryFilters);
        if (cancelled) return;
        setSummaryData(data?.summary ?? {});
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setVisitsDataLoading(false);
      }
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [summaryFilters, topView]);

  useEffect(() => {
    if (topView !== "overall") return;
    let cancelled = false;
    async function loadVillaChart() {
      try {
        const data = await analyticsApi.visitsRoomsDashboard(villaChartFilters);
        if (cancelled) return;
        setVillaChartData(
          Array.isArray(data?.villa_stats) ? data.villa_stats : [],
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) setVillaChartData([]);
      }
    }
    loadVillaChart();
    return () => {
      cancelled = true;
    };
  }, [villaChartFilters, topView]);

  useEffect(() => {
    if (topView !== "overall") return;
    let cancelled = false;
    async function loadVillaTable() {
      try {
        const data = await analyticsApi.visitsRoomsDashboard(villaTableFilters);
        if (cancelled) return;
        setVillaTableData(
          Array.isArray(data?.villa_stats) ? data.villa_stats : [],
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) setVillaTableData([]);
      }
    }
    loadVillaTable();
    return () => {
      cancelled = true;
    };
  }, [villaTableFilters, topView]);

  useEffect(() => {
    if (topView !== "overall") return;
    let cancelled = false;
    async function loadBedroomCharts() {
      try {
        const data =
          await analyticsApi.visitsRoomsDashboard(bedroomChartFilters);
        if (cancelled) return;
        setBookingsByBedroomData(
          Array.isArray(data?.bookings_by_bedroom)
            ? data.bookings_by_bedroom
            : [],
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) setBookingsByBedroomData([]);
      }
    }
    loadBedroomCharts();
    return () => {
      cancelled = true;
    };
  }, [bedroomChartFilters, topView]);

  useEffect(() => {
    if (topView !== "overall") return;
    let cancelled = false;
    async function loadMonthlyTrends() {
      try {
        const data =
          await analyticsApi.visitsRoomsDashboard(monthlyChartFilters);
        if (cancelled) return;
        setMonthlyRevenueData(
          Array.isArray(data?.monthly_revenue) ? data.monthly_revenue : [],
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) setMonthlyRevenueData([]);
      }
    }
    loadMonthlyTrends();
    return () => {
      cancelled = true;
    };
  }, [monthlyChartFilters, topView]);

  const [villaMonthlyGroupBy, setVillaMonthlyGroupBy] = useState("month");

  const villaMonthlyFilters =
    villaMonthlyGroupBy === "year"
      ? { ...selectedVillaChartFilters, year: null, month: null }
      : selectedVillaChartFilters;

  useEffect(() => {
    if (!selectedVillaName || topView !== "overall") return;
    let cancelled = false;
    async function loadSelectedVillaMonthly() {
      try {
        const data = await analyticsApi.villaMonthly(selectedVillaName, {
          group_by: villaMonthlyGroupBy,
          ...villaMonthlyFilters,
        });
        if (cancelled) return;
        setVillaMonthlyData(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setVillaMonthlyData([]);
      }
    }
    loadSelectedVillaMonthly();
    return () => {
      cancelled = true;
    };
  }, [
    selectedVillaName,
    selectedVillaChartFilters,
    villaMonthlyGroupBy,
    topView,
  ]);

  const tableVillas = villaTableData;

  const filteredTableVillas = useMemo(() => {
    const searched = searchRows(tableVillas, villaTableSearch);
    return sortRows(searched, villaTableSortKey, villaTableSortDir);
  }, [tableVillas, villaTableSearch, villaTableSortKey, villaTableSortDir]);

  const chartVillas = villaChartData;

  const villaBookingCount = (v) => Number(v?.bookings ?? 0);

  const bookingCounts = chartVillas.map(villaBookingCount);
  const positiveBookingCounts = bookingCounts.filter((n) => n > 0);

  const mostBookingValue = bookingCounts.length
    ? Math.max(...bookingCounts)
    : null;

  const leastBookingValue = positiveBookingCounts.length
    ? Math.min(...positiveBookingCounts)
    : null;

  const mostVillaTies =
    mostBookingValue == null
      ? []
      : chartVillas.filter((v) => villaBookingCount(v) === mostBookingValue);

  const leastVillaTies =
    leastBookingValue == null
      ? []
      : chartVillas.filter((v) => villaBookingCount(v) === leastBookingValue);

  const mostVilla = mostVillaTies[0] ?? null;
  const leastVilla = leastVillaTies[0] ?? null;

  const selectedVilla =
    tableVillas.find((v) => v.villa_name === selectedVillaName) ??
    mostVilla ??
    null;

  const bedroomsLabel = (villa) => {
    if (!villa) return "—";
    if (villa.bedroom_counts) {
      return String(villa.bedroom_counts)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(", ");
    }
    return villa.bedroom_count ?? "—";
  };

  // ── Villa modal ───────────────────────────────────────────────────────────
  const [villaModalOpen, setVillaModalOpen] = useState(false);
  const [villaBookings, setVillaBookings] = useState([]);
  const [villaBookingsLoading, setVillaBookingsLoading] = useState(false);
  const [villaModalFilter, setVillaModalFilter] = useState(createDateFilter);

  const villaModalFilters = useMemo(
    () => toDateParams(villaModalFilter),
    [villaModalFilter],
  );

  useEffect(() => {
    if (!villaModalOpen || !selectedVillaName) return;
    let cancelled = false;
    async function load() {
      setVillaBookingsLoading(true);
      try {
        const data = await analyticsApi.villaBookings(
          selectedVillaName,
          villaModalFilters,
        );
        if (!cancelled) setVillaBookings(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setVillaBookings([]);
      } finally {
        if (!cancelled) setVillaBookingsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [villaModalOpen, selectedVillaName, villaModalFilters]);

  const openVillaModal = (villaName) => {
    if (!villaName) return;
    onVillaSelect(villaName);
    setVillaModalFilter(createDateFilter());
    setVillaModalOpen(true);
  };

  // ── Bedroom modal ─────────────────────────────────────────────────────────
  const [bedroomModalOpen, setBedroomModalOpen] = useState(false);
  const [selectedBedroom, setSelectedBedroom] = useState(null);
  const [bedroomBookings, setBedroomBookings] = useState([]);
  const [bedroomBookingsLoading, setBedroomBookingsLoading] = useState(false);
  const [bedroomModalFilter, setBedroomModalFilter] =
    useState(createDateFilter);

  const bedroomModalFilters = useMemo(
    () => toDateParams(bedroomModalFilter),
    [bedroomModalFilter],
  );

  useEffect(() => {
    if (!bedroomModalOpen || !selectedBedroom) return;
    let cancelled = false;
    async function load() {
      setBedroomBookingsLoading(true);
      try {
        const data = await analyticsApi.bedroomBookings(
          selectedBedroom,
          bedroomModalFilters,
        );
        if (!cancelled) setBedroomBookings(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setBedroomBookings([]);
      } finally {
        if (!cancelled) setBedroomBookingsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bedroomModalOpen, selectedBedroom, bedroomModalFilters]);

  const openBedroomModal = (beds) => {
    if (!beds) return;
    setSelectedBedroom(beds);
    setBedroomModalFilter(createDateFilter());
    setBedroomModalOpen(true);
  };

  // ── People modal ──────────────────────────────────────────────────────────
  const [peopleModalOpen, setPeopleModalOpen] = useState(false);
  const [peopleKind, setPeopleKind] = useState("members");
  const [peopleRows, setPeopleRows] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleFilter, setPeopleFilter] = useState(createDateFilter);

  const peopleFilters = useMemo(
    () => toDateParams(peopleFilter),
    [peopleFilter],
  );

  useEffect(() => {
    if (!peopleModalOpen) return;
    let cancelled = false;
    async function load() {
      setPeopleLoading(true);
      try {
        const data = await analyticsApi.bookedPeople(peopleKind, peopleFilters);
        if (!cancelled) setPeopleRows(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setPeopleRows([]);
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [peopleModalOpen, peopleKind, peopleFilters]);

  const openPeopleModal = (kind) => {
    setPeopleKind(kind);
    setPeopleFilter(createDateFilter());
    setPeopleModalOpen(true);
  };

  const filteredPeopleRows = useMemo(() => {
    const searched = searchRows(peopleRows, peopleSearch);
    return sortRows(searched, peopleSortKey, peopleSortDir);
  }, [peopleRows, peopleSearch, peopleSortKey, peopleSortDir]);

  const filteredBedroomBookings = useMemo(() => {
    const searched = searchRows(bedroomBookings, bedroomSearch);
    return sortRows(searched, bedroomSortKey, bedroomSortDir);
  }, [bedroomBookings, bedroomSearch, bedroomSortKey, bedroomSortDir]);

  const filteredVillaBookings = useMemo(() => {
    const searched = searchRows(villaBookings, villaBookingSearch);
    return sortRows(searched, villaBookingSortKey, villaBookingSortDir);
  }, [
    villaBookings,
    villaBookingSearch,
    villaBookingSortKey,
    villaBookingSortDir,
  ]);

  const today = new Date().toISOString().split("T")[0];

  const villaBedroomLabel = (villa) =>
    villa?.bedroom_count != null && villa?.bedroom_count !== ""
      ? villa.bedroom_count
      : bedroomsLabel(villa);

  const villaPerformanceRows = filteredTableVillas.map((v) => ({
    Villa: v.villa_name ?? "",
    Bedrooms: villaBedroomLabel(v),
    Bookings: v.bookings ?? "",
    "Room Nights": v.total_nights ?? "",
    "Avg Stay": v.avg_stay ?? "",
    Revenue: v.revenue ?? "",
  }));

  const villaPerformanceFilename = `villa_performance_by_bedroom_${safeFilePart(dateFilterFilePart(villaTableFilter))}_${today}`;

  const peopleExportRows = filteredPeopleRows.map((p) => ({
    Name:
      p.member_full_name ||
      p.member_name ||
      p.folio_guest_name ||
      p.guest_name ||
      "",
    Title: p.title ?? p.prefix ?? "",
    Email: p.email ?? "",
    Phone: p.phone ?? p.telephone ?? p.phone_number ?? "",
    Address: p.address ?? "",
    Country: p.country ?? "",
    State: p.state ?? "",
    "Member #": p.member_number ?? "",
    "Member Type": p.member_type ?? "",
    Account: p.member_or_guest ?? "",
    Bookings: p.bookings ?? "",
    Nights: p.nights ?? "",
    "First In": p.first_check_in ?? "",
    "Last Out": p.last_check_out ?? "",
  }));

  const peopleFilename = `${peopleKind}_booked_${safeFilePart(dateFilterFilePart(peopleFilter))}_${today}`;

  const bedroomExportRows = filteredBedroomBookings.map((b) => ({
    Bedroom: selectedBedroom ?? "",
    Who: b.member_full_name || b.member_name || b.guest_name || "",
    Title: b.title ?? b.prefix ?? "",
    Email: b.email ?? "",
    Phone: b.phone ?? b.telephone ?? b.phone_number ?? "",
    Address: b.address ?? "",
    Country: b.country ?? "",
    State: b.state ?? "",
    Villa: b.villa_name ?? "",
    "Check In": b.check_in_date ?? "",
    "Check Out": b.check_out_date ?? "",
    Nights: b.nights ?? "",
    Guests: b.persons ?? "",
    "Confirmation Code": b.conf_code ?? "",
  }));

  const bedroomFilename = `${safeFilePart(selectedBedroom)}_bedroom_bookings_${safeFilePart(dateFilterFilePart(bedroomModalFilter))}_${today}`;

  const villaBookingRows = filteredVillaBookings.map((b) => ({
    Villa: selectedVillaName ?? "",
    Guest: b.member_full_name || b.member_name || b.guest_name || "",
    Title: b.title ?? b.prefix ?? "",
    Email: b.email ?? "",
    Phone: b.phone ?? b.telephone ?? b.phone_number ?? "",
    Address: b.address ?? "",
    Country: b.country ?? "",
    State: b.state ?? "",
    "Member #": b.member_number ?? "",
    "Confirmation Code": b.conf_code ?? "",
    Revenue: b.revenue ?? "",
    "Check In": b.check_in_date ?? "",
    "Check Out": b.check_out_date ?? "",
    Nights: b.nights ?? "",
    Guests: b.persons ?? "",
    "Guest Manifest": Array.isArray(b.guests)
      ? b.guests
          .map((g) => g.name || g.guest_name || g.full_name || "")
          .filter(Boolean)
          .join(", ")
      : "",
  }));

  const villaBookingFilename = `${safeFilePart(selectedVillaName)}_bookings_${safeFilePart(dateFilterFilePart(villaModalFilter))}_${today}`;

  // ─────────────────────────────────────────────────────────────────────────
  const [villaChartLimit, setVillaChartLimit] = useState("15");

  const visibleVillaChartData = useMemo(() => {
    if (villaChartLimit === "All") return chartVillas;
    return chartVillas.slice(0, Number(villaChartLimit));
  }, [chartVillas, villaChartLimit]);

  //---------------------

  const [tieModalOpen, setTieModalOpen] = useState(false);
  const [tieModalTitle, setTieModalTitle] = useState("");
  const [tieModalRows, setTieModalRows] = useState([]);

  const openTieModal = (title, rows) => {
    setTieModalTitle(title);
    setTieModalRows(rows);
    setTieModalOpen(true);
  };

  ///--------------

  /// ----------
  return (
    <div className="dashboard-section">
      {/* ── Top section: header + view toggle ──────────────────────────────── */}
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
          <div className="dashboard-eyebrow">Villa Performance & Demand</div>
          <h2 className="dashboard-card-title" style={{ marginBottom: 0 }}>
            Villa Analytics
          </h2>
          <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0" }}>
            {topView === "overall"
              ? "KPIs, villa rankings, monthly bookings, revenue trends, bedroom analytics, and detailed performance."
              : "Business-source cards, paid vs. free/comp performance, source trends, drill-downs, and marketing signals."}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          <TopViewToggle value={topView} onChange={setTopView} />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* OVERALL VIEW                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {topView === "overall" && (
        <>
          {visitsDataLoading && (
            <div style={{ color: C.muted, fontSize: 12, padding: "0 4px" }}>
              Updating visits and rooms data…
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <DateFilterBar
              value={summaryFilter}
              onChange={setSummaryFilter}
              years={years}
              months={months}
            />
          </div>

          {/* KPI band */}
          <section
            className="dashboard-kpi-band"
            style={{ padding: "20px 18px" }}
          >
            <Stat
              icon={Users}
              label="Total Members Booked"
              value={fmt(summaryData?.total_members_booked)}
              sub="Unique member accounts"
              infoId="totalMembersBooked"
              onClick={() => openPeopleModal("members")}
            />
            <Stat
              icon={Users}
              label="Total Guests Booked"
              value={fmt(summaryData?.total_guests_booked)}
              sub="Unique guest accounts"
              infoId="totalGuestsBooked"
              onClick={() => openPeopleModal("guests")}
            />
            <Stat
              icon={CalendarClock}
              label="Average Length of Stay"
              value={`${num(summaryData?.avg_length_of_stay)} nights`}
              sub="Nights per booking"
              infoId="averageLengthOfStay"
            />
            <Stat
              icon={Users}
              label="Average Party Size"
              value={num(summaryData?.avg_party_size)}
              sub="People per booking"
              infoId="averagePartySize"
            />
            <Stat
              icon={BedDouble}
              label="Total Room Nights"
              value={fmt(summaryData?.total_room_nights)}
              sub="Occupied room-date nights"
              infoId="totalRoomNights"
            />
            <Stat
              icon={DollarSign}
              label="Villa Rental Revenue"
              value={money(summaryData?.villa_rental_revenue)}
              sub="Villa income total"
              infoId="villaRentalRevenue"
            />
          </section>

          {/* Villa charts */}
          <Card
            title="Bookings by Villa"
            action={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Select
                  label="Show"
                  value={villaChartLimit}
                  onChange={setVillaChartLimit}
                  options={["10", "15", "30", "40", "50", "All"]}
                />
                <ChartInfo id="bookingsByVilla" />
              </div>
            }
          >
            <DateFilterBar
              value={villaChartFilter}
              onChange={setVillaChartFilter}
              years={years}
              months={months}
            />
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  minWidth: Math.max(visibleVillaChartData.length * 60, 420),
                  height: 320,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={visibleVillaChartData}
                    margin={{ top: 8, right: 16, bottom: 90, left: 16 }}
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
                    <Tooltip contentStyle={TIP} />
                    <Bar
                      dataKey="bookings"
                      fill="var(--dashboard-flame)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>

          <Card
            title="Most / Least Booked Villa"
            sub="Click through to ML Insights"
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { villa: mostVilla, label: "Most Booked", ties: mostVillaTies },
                {
                  villa: leastVilla,
                  label: "Least Booked",
                  ties: leastVillaTies,
                },
              ].map(({ villa, label, ties }, i) => (
                <button
                  key={`${label}-${villa?.villa_name ?? i}`}
                  type="button"
                  onClick={() => {
                    if (villa?.villa_name) onVillaSelect(villa.villa_name);
                  }}
                  style={{
                    flex: "1 1 200px",
                    textAlign: "left",
                    border: `1px solid ${C.border}`,
                    borderRadius: 16,
                    background: i === 0 ? C.panelAlt : C.panel,
                    padding: 16,
                    cursor: "pointer",
                  }}
                >
                  <div className="dashboard-eyebrow">{label}</div>
                  <div
                    style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 24,
                      color: C.text,
                    }}
                  >
                    {villa?.villa_name ?? "—"}
                  </div>
                  <div style={{ color: C.soft, fontSize: 12 }}>
                    {fmt(villa?.bookings)} bookings · {bedroomsLabel(villa)}{" "}
                    bedrooms
                  </div>

                  {ties.length > 1 && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        openTieModal(`${label} Villas`, ties);
                      }}
                      style={{
                        marginTop: 8,
                        color: C.accent,
                        fontSize: 11,
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      View all {ties.length} tied villas
                    </div>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={onGoToML}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                marginTop: 12,
                padding: "13px 15px",
                borderRadius: 14,
                border: `1px dashed ${C.accent2}`,
                background: C.panelAlt,
                color: C.accent,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              View season × villa insights
              <ArrowUpRight size={17} />
            </button>
          </Card>

          {/* Villa table + drilldown */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div
              className="dashboard-card"
              style={{ flex: "0 0 420px", minWidth: 0 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div className="dashboard-eyebrow">All Villas</div>
                  <h2 className="dashboard-card-title">Villa performance</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ExportMenu
                    rows={villaPerformanceRows}
                    filenameBase={villaPerformanceFilename}
                    disabled={!villaPerformanceRows.length}
                  />
                  <ChartInfo id="villaTable" />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 10,
                  marginBottom: 10,
                }}
              >
                <DateFilterBar
                  value={villaTableFilter}
                  onChange={setVillaTableFilter}
                  years={years}
                  months={months}
                />
              </div>

              <TableControls
                search={villaTableSearch}
                onSearchChange={setVillaTableSearch}
                sortKey={villaTableSortKey}
                onSortKeyChange={setVillaTableSortKey}
                sortDir={villaTableSortDir}
                onSortDirChange={setVillaTableSortDir}
                sortOptions={[
                  "villa_name",
                  "bedroom_count",
                  "bookings",
                  "total_nights",
                  "avg_stay",
                  "revenue",
                ]}
                placeholder="Search villas..."
              />

              <div style={{ overflowY: "auto", maxHeight: 567, marginTop: 8 }}>
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
                        "Villa",
                        "Bedrooms",
                        "Bookings",
                        "Room Nights",
                        "Avg Stay",
                        "Revenue",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: h === "Villa" ? "left" : "right",
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
                    {filteredTableVillas.map((villa) => {
                      const active = villa.villa_name === selectedVillaName;
                      return (
                        <tr
                          key={`${villa.villa_name}-${villaBedroomLabel(villa)}`}
                          onClick={() => openVillaModal(villa.villa_name)}
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                            background: active ? C.panelAlt : "transparent",
                            borderLeft: active
                              ? `3px solid ${C.accent2}`
                              : "3px solid transparent",
                            cursor: "pointer",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            if (!active)
                              e.currentTarget.style.background = C.panel;
                          }}
                          onMouseLeave={(e) => {
                            if (!active)
                              e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <td
                            style={{
                              padding: "10px 10px",
                              fontWeight: active ? 700 : 400,
                              color: C.text,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {villa.villa_name}
                          </td>
                          <td
                            style={{
                              padding: "10px 10px",
                              textAlign: "right",
                              color: C.soft,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {villaBedroomLabel(villa)}
                          </td>
                          <td
                            style={{
                              padding: "10px 10px",
                              textAlign: "right",
                              color: C.soft,
                            }}
                          >
                            {fmt(villa.bookings)}
                          </td>
                          <td
                            style={{
                              padding: "10px 10px",
                              textAlign: "right",
                              color: C.soft,
                            }}
                          >
                            {fmt(villa.total_nights)}
                          </td>
                          <td
                            style={{
                              padding: "10px 10px",
                              textAlign: "right",
                              color: C.soft,
                            }}
                          >
                            {num(villa.avg_stay)}n
                          </td>
                          <td
                            style={{
                              padding: "10px 10px",
                              textAlign: "right",
                              color: C.soft,
                            }}
                          >
                            {money(villa.revenue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drilldown charts */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {selectedVilla ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginBottom: 2,
                    }}
                  >
                    <Select
                      label="Group by"
                      value={villaMonthlyGroupBy}
                      onChange={setVillaMonthlyGroupBy}
                      options={["month", "year"]}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <DateFilterBar
                      value={selectedVillaChartFilter}
                      onChange={setSelectedVillaChartFilter}
                      years={years}
                      months={months}
                    />
                  </div>
                  <Card
                    title={`${selectedVilla.villa_name} — ${villaMonthlyGroupBy === "year" ? "Yearly" : "Monthly"} Bookings`}
                    sub={`Selected villa drill-down by ${villaMonthlyGroupBy}`}
                    action={<ChartInfo id="villaMonthlyBookings" />}
                  >
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer>
                        <LineChart
                          data={villaMonthlyData}
                          margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                          <XAxis
                            dataKey={
                              villaMonthlyGroupBy === "year" ? "year" : "month"
                            }
                            stroke={AX}
                            fontSize={11}
                            label={{
                              value:
                                villaMonthlyGroupBy === "year"
                                  ? "Year"
                                  : "Month",
                              position: "insideBottom",
                              offset: -10,
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
                              dy: 30,
                              style: LABEL_STYLE,
                            }}
                          />
                          <Tooltip contentStyle={TIP} />
                          <Line
                            type="monotone"
                            dataKey="bookings"
                            stroke="var(--dashboard-deep-blue)"
                            strokeWidth={2.5}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>

                  <Card
                    title={`${selectedVilla.villa_name} — ${villaMonthlyGroupBy === "year" ? "Yearly" : "Monthly"} Rental Revenue`}
                    sub={`${villaMonthlyGroupBy === "year" ? "Yearly" : "Monthly"} villa revenue`}
                    action={<ChartInfo id="villaMonthlyRevenue" />}
                  >
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer>
                        <LineChart
                          data={villaMonthlyData}
                          margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                          <XAxis
                            dataKey={
                              villaMonthlyGroupBy === "year" ? "year" : "month"
                            }
                            stroke={AX}
                            fontSize={11}
                            label={{
                              value:
                                villaMonthlyGroupBy === "year"
                                  ? "Year"
                                  : "Month",
                              position: "insideBottom",
                              offset: -10,
                              style: LABEL_STYLE,
                            }}
                          />
                          <YAxis
                            stroke={AX}
                            fontSize={11}
                            label={{
                              value: "Revenue ($)",
                              angle: -90,
                              position: "insideLeft",
                              offset: 10,
                              dy: 40,
                              style: LABEL_STYLE,
                            }}
                          />
                          <Tooltip contentStyle={TIP} />
                          <Line
                            type="monotone"
                            dataKey="revenue"
                            stroke="var(--dashboard-truffle)"
                            strokeWidth={2.5}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </>
              ) : (
                <div
                  className="dashboard-card"
                  style={{
                    height: "100%",
                    minHeight: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.muted,
                    fontSize: 13,
                  }}
                >
                  Select a villa to see monthly detail
                </div>
              )}
            </div>
          </div>

          {/* Bedroom */}
          <div>
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "flex-end",
                paddingBottom: 10,
              }}
            >
              <DateFilterBar
                value={bedroomChartFilter}
                onChange={setBedroomChartFilter}
                years={years}
                months={months}
              />
            </div>

            <div className="dashboard-grid dashboard-grid-main">
              <Card
                title="Bookings by Bedroom Count"
                sub="Bedroom demand"
                action={<ChartInfo id="bookingsByBedroom" />}
              >
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={bookingsByBedroomData}
                      margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="beds"
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Bedrooms",
                          position: "insideBottom",
                          offset: -10,
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
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="bookings"
                        fill="var(--dashboard-flame)"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) => openBedroomModal(entry?.beds)}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card
                title="Average Stay by Bedroom Count"
                sub="Length of stay"
                action={<ChartInfo id="avgStayByBedroom" />}
              >
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={bookingsByBedroomData}
                      margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="beds"
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Bedrooms",
                          position: "insideBottom",
                          offset: -10,
                          style: LABEL_STYLE,
                        }}
                      />
                      <YAxis
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Nights",
                          angle: -90,
                          position: "insideLeft",
                          offset: 10,
                          dy: 30,
                          style: LABEL_STYLE,
                        }}
                      />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="avg_stay"
                        fill="var(--dashboard-deep-blue)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>

          {/* Monthly revenue */}
          <div>
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "flex-end",
                paddingBottom: 10,
              }}
            >
              <DateFilterBar
                value={monthlyChartFilter}
                onChange={setMonthlyChartFilter}
                years={years}
                months={months}
              />
            </div>

            <div className="dashboard-grid dashboard-grid-main">
              <Card
                title="Bookings by Month"
                sub="Monthly booking trend"
                action={<ChartInfo id="bookingsByMonth" />}
              >
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={monthlyRevenueData}
                      margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="month"
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Month",
                          position: "insideBottom",
                          offset: -10,
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
                      <Tooltip contentStyle={TIP} />
                      <Line
                        type="monotone"
                        dataKey="bookings"
                        stroke="var(--dashboard-deep-blue)"
                        strokeWidth={2.5}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card
                title="Villa Rental Revenue by Month"
                sub="Folio rental revenue"
                action={<ChartInfo id="revenueByMonth" />}
              >
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={monthlyRevenueData}
                      margin={{ top: 8, right: 16, bottom: 28, left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis
                        dataKey="month"
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Month",
                          position: "insideBottom",
                          offset: -10,
                          style: LABEL_STYLE,
                        }}
                      />
                      <YAxis
                        stroke={AX}
                        fontSize={11}
                        label={{
                          value: "Revenue ($)",
                          angle: -90,
                          position: "insideLeft",
                          offset: 10,
                          dy: 40,
                          style: LABEL_STYLE,
                        }}
                      />
                      <Tooltip contentStyle={TIP} />
                      <Bar
                        dataKey="revenue"
                        fill="var(--dashboard-truffle)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>

          {/* ── People modal ───────────────────────────────────────────────── */}
          {peopleModalOpen && (
            <div
              onClick={() => setPeopleModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(8, 18, 32, 0.48)",
                zIndex: 1000,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(820px, 96vw)",
                  height: "100vh",
                  background: C.bg,
                  borderLeft: `1px solid ${C.border}`,
                  overflowY: "auto",
                  padding: 26,
                }}
              >
                <button onClick={() => setPeopleModalOpen(false)}>
                  <X size={18} />
                </button>
                <div className="dashboard-eyebrow">
                  {peopleKind === "members"
                    ? "Members booked"
                    : "Guests booked"}
                </div>
                <h2 className="dashboard-card-title">
                  {peopleKind === "members"
                    ? "Total Members Booked"
                    : "Total Guests Booked"}
                </h2>

                <DateFilterBar
                  value={peopleFilter}
                  onChange={setPeopleFilter}
                  years={years}
                  months={months}
                />

                <TableControls
                  search={peopleSearch}
                  onSearchChange={setPeopleSearch}
                  sortKey={peopleSortKey}
                  onSortKeyChange={setPeopleSortKey}
                  sortDir={peopleSortDir}
                  onSortDirChange={setPeopleSortDir}
                  sortOptions={[
                    "member_full_name",
                    "member_number",
                    "member_type",
                    "member_or_guest",
                    "bookings",
                    "nights",
                    "first_check_in",
                    "last_check_out",
                  ]}
                  placeholder="Search people..."
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    {filteredPeopleRows.length} of {peopleRows.length} records
                  </div>
                  <ExportMenu
                    rows={peopleExportRows}
                    filenameBase={peopleFilename}
                    disabled={peopleLoading || !peopleExportRows.length}
                  />
                </div>

                {peopleLoading ? (
                  <div style={{ color: C.muted }}>Loading people...</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
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
                            "Name",
                            "Member #",
                            "Member Type",
                            "Account",
                            "Bookings",
                            "Nights",
                            "First In",
                            "Last Out",
                          ].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: h === "Name" ? "left" : "right",
                                padding: "10px",
                                borderBottom: `1px solid ${C.border}`,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPeopleRows.map((p, i) => {
                          const name =
                            p.member_full_name ||
                            p.member_name ||
                            p.folio_guest_name ||
                            p.guest_name ||
                            "Unknown";
                          const missingMemberType = !p.member_type;
                          return (
                            <tr
                              key={`${name}-${p.member_number ?? i}`}
                              style={{
                                background: missingMemberType
                                  ? "rgba(255, 193, 7, 0.14)"
                                  : "transparent",
                                borderTop: `1px solid ${C.border}`,
                              }}
                            >
                              <td style={{ padding: "10px", color: C.text }}>
                                {name}
                                {missingMemberType && (
                                  <div
                                    style={{
                                      marginTop: 4,
                                      color: C.accent3,
                                      fontSize: 10,
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.05em",
                                    }}
                                  >
                                    Member type is null
                                  </div>
                                )}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: C.soft,
                                }}
                              >
                                {p.member_number ?? "—"}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: missingMemberType ? C.accent3 : C.soft,
                                  fontWeight: missingMemberType ? 800 : 400,
                                }}
                              >
                                {p.member_type ?? "NULL"}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: !p.member_or_guest
                                    ? C.accent3
                                    : C.soft,
                                  fontWeight: !p.member_or_guest ? 800 : 400,
                                }}
                              >
                                {p.member_or_guest ?? "NULL"}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: C.soft,
                                }}
                              >
                                {fmt(p.bookings)}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: C.soft,
                                }}
                              >
                                {fmt(p.nights)}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: C.soft,
                                }}
                              >
                                {p.first_check_in ?? "—"}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  color: C.soft,
                                }}
                              >
                                {p.last_check_out ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </aside>
            </div>
          )}

          {/* ── Bedroom modal ──────────────────────────────────────────────── */}
          {bedroomModalOpen && (
            <div
              onClick={() => setBedroomModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(8, 18, 32, 0.48)",
                zIndex: 1000,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(760px, 96vw)",
                  height: "100vh",
                  background: C.bg,
                  borderLeft: `1px solid ${C.border}`,
                  overflowY: "auto",
                  padding: 26,
                }}
              >
                <button onClick={() => setBedroomModalOpen(false)}>
                  <X size={18} />
                </button>
                <div className="dashboard-eyebrow">Bedroom booking profile</div>
                <h2 className="dashboard-card-title">
                  {selectedBedroom} Bedroom Bookings
                </h2>

                <DateFilterBar
                  value={bedroomModalFilter}
                  onChange={setBedroomModalFilter}
                  years={years}
                  months={months}
                />

                <TableControls
                  search={bedroomSearch}
                  onSearchChange={setBedroomSearch}
                  sortKey={bedroomSortKey}
                  onSortKeyChange={setBedroomSortKey}
                  sortDir={bedroomSortDir}
                  onSortDirChange={setBedroomSortDir}
                  sortOptions={[
                    "member_full_name",
                    "villa_name",
                    "check_in_date",
                    "check_out_date",
                    "nights",
                    "persons",
                  ]}
                  placeholder="Search bedroom bookings..."
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    {bedroomBookingsLoading
                      ? null
                      : `${filteredBedroomBookings.length} of ${bedroomBookings.length} records`}
                  </div>
                  <ExportMenu
                    rows={bedroomExportRows}
                    filenameBase={bedroomFilename}
                    disabled={
                      bedroomBookingsLoading || !bedroomExportRows.length
                    }
                  />
                </div>

                {bedroomBookingsLoading ? (
                  <div style={{ color: C.muted }}>Loading bookings…</div>
                ) : (
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
                          "Who",
                          "Villa",
                          "Check in",
                          "Check out",
                          "Nights",
                          "Guests",
                        ].map((h) => (
                          <th
                            key={h}
                            style={{ textAlign: "left", padding: 10 }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBedroomBookings.map((b) => (
                        <tr
                          key={b.conf_code}
                          style={{ borderTop: `1px solid ${C.border}` }}
                        >
                          <td style={{ padding: 10 }}>
                            {b.member_full_name ||
                              b.member_name ||
                              b.guest_name ||
                              "—"}
                          </td>
                          <td style={{ padding: 10 }}>{b.villa_name || "—"}</td>
                          <td style={{ padding: 10 }}>
                            {b.check_in_date || "—"}
                          </td>
                          <td style={{ padding: 10 }}>
                            {b.check_out_date || "—"}
                          </td>
                          <td style={{ padding: 10 }}>{fmt(b.nights)}</td>
                          <td style={{ padding: 10 }}>{fmt(b.persons)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </aside>
            </div>
          )}

          {/* ── Villa modal ────────────────────────────────────────────────── */}
          {villaModalOpen && selectedVilla && (
            <div
              onClick={() => setVillaModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(8, 18, 32, 0.48)",
                zIndex: 1000,
                display: "flex",
                justifyContent: "flex-end",
                backdropFilter: "blur(3px)",
              }}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(860px, 96vw)",
                  height: "100vh",
                  background: C.bg,
                  borderLeft: `1px solid ${C.border}`,
                  boxShadow: "-24px 0 60px rgba(0,0,0,0.22)",
                  overflowY: "auto",
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
                    onClick={() => setVillaModalOpen(false)}
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
                    }}
                  >
                    <X size={18} />
                  </button>
                  <div className="dashboard-eyebrow">Villa booking profile</div>
                  <h2
                    style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 38,
                      color: C.text,
                      margin: "4px 48px 4px 0",
                      lineHeight: 1,
                    }}
                  >
                    {selectedVilla.villa_name}
                  </h2>
                  <div style={{ color: C.soft, fontSize: 13 }}>
                    {fmt(selectedVilla.bookings)} bookings ·{" "}
                    {fmt(selectedVilla.total_nights)} room nights ·{" "}
                    {money(selectedVilla.revenue)} revenue
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <DateFilterBar
                      value={villaModalFilter}
                      onChange={setVillaModalFilter}
                      years={years}
                      months={months}
                    />
                  </div>
                </div>

                <div style={{ padding: 26 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 12,
                      marginBottom: 24,
                    }}
                  >
                    {[
                      ["Bookings", fmt(selectedVilla.bookings), "Total stays"],
                      ["Revenue", money(selectedVilla.revenue), "Rental spend"],
                      [
                        "Avg Stay",
                        `${num(selectedVilla.avg_stay)}n`,
                        "Per booking",
                      ],
                      [
                        "Guests",
                        fmt(selectedVilla.total_guests),
                        "Total guests",
                      ],
                      ["Bedrooms", bedroomsLabel(selectedVilla), "Villa setup"],
                      [
                        "Members",
                        fmt(selectedVilla.unique_members),
                        "Unique members",
                      ],
                    ].map(([label, value, sub]) => (
                      <div
                        key={label}
                        style={{
                          border: `1px solid ${C.border}`,
                          background: C.panel,
                          borderRadius: 18,
                          padding: 16,
                        }}
                      >
                        <div className="dashboard-eyebrow">{label}</div>
                        <div
                          style={{
                            fontFamily: "'Cormorant Garamond', serif",
                            color: C.text,
                            fontSize: 28,
                            marginTop: 4,
                          }}
                        >
                          {value}
                        </div>
                        <div style={{ color: C.muted, fontSize: 11 }}>
                          {sub}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "end",
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div className="dashboard-eyebrow">Booking timeline</div>
                      <h3
                        style={{
                          color: C.text,
                          margin: "4px 0 0",
                          fontSize: 22,
                        }}
                      >
                        People who booked this villa
                      </h3>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
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
                        {filteredVillaBookings.length} of {villaBookings.length}{" "}
                        records
                      </div>
                      <ExportMenu
                        rows={villaBookingRows}
                        filenameBase={villaBookingFilename}
                        disabled={
                          villaBookingsLoading || !villaBookingRows.length
                        }
                      />
                    </div>
                  </div>

                  <TableControls
                    search={villaBookingSearch}
                    onSearchChange={setVillaBookingSearch}
                    sortKey={villaBookingSortKey}
                    onSortKeyChange={setVillaBookingSortKey}
                    sortDir={villaBookingSortDir}
                    onSortDirChange={setVillaBookingSortDir}
                    sortOptions={[
                      "member_full_name",
                      "member_number",
                      "conf_code",
                      "check_in_date",
                      "check_out_date",
                      "nights",
                      "persons",
                      "revenue",
                    ]}
                    placeholder="Search villa bookings..."
                  />

                  {villaBookingsLoading ? (
                    <div
                      style={{
                        padding: 34,
                        textAlign: "center",
                        color: C.muted,
                        border: `1px dashed ${C.border}`,
                        borderRadius: 18,
                      }}
                    >
                      Loading booking details...
                    </div>
                  ) : villaBookings.length === 0 ? (
                    <div
                      style={{
                        padding: 34,
                        textAlign: "center",
                        color: C.muted,
                        border: `1px dashed ${C.border}`,
                        borderRadius: 18,
                      }}
                    >
                      No booking details found.
                    </div>
                  ) : filteredVillaBookings.length === 0 ? (
                    <div
                      style={{
                        padding: 34,
                        textAlign: "center",
                        color: C.muted,
                        border: `1px dashed ${C.border}`,
                        borderRadius: 18,
                      }}
                    >
                      No matching booking details found.
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
                      {filteredVillaBookings.map((b, index) => {
                        const guests = Array.isArray(b.guests) ? b.guests : [];
                        const primaryName =
                          b.member_full_name ??
                          b.member_name ??
                          b.guest_name ??
                          "Unknown guest";
                        return (
                          <div
                            key={b.conf_code ?? index}
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
                                background: C.accent2,
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
                                border: `1px solid ${C.border}`,
                                background: index === 0 ? C.panelAlt : C.panel,
                                borderRadius: 20,
                                padding: 18,
                                boxShadow: "0 10px 28px rgba(0,0,0,0.04)",
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
                                      fontSize: 18,
                                      fontWeight: 850,
                                      color: C.text,
                                    }}
                                  >
                                    {primaryName}
                                  </div>
                                  <div
                                    style={{
                                      color: C.soft,
                                      fontSize: 12,
                                      marginTop: 4,
                                    }}
                                  >
                                    Member #{b.member_number ?? "—"} ·
                                    Confirmation {b.conf_code ?? "—"}
                                  </div>
                                </div>
                                <div
                                  style={{ textAlign: "right", minWidth: 100 }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 900,
                                      color: C.text,
                                      fontSize: 18,
                                    }}
                                  >
                                    {money(b.revenue)}
                                  </div>
                                  <div style={{ color: C.muted, fontSize: 11 }}>
                                    revenue
                                  </div>
                                </div>
                              </div>

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
                                  <div className="dashboard-eyebrow">
                                    Check-in
                                  </div>
                                  <div
                                    style={{ color: C.text, fontWeight: 800 }}
                                  >
                                    {b.check_in_date ?? "—"}
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
                                  {fmt(b.nights)} nights · {fmt(b.persons)}{" "}
                                  guests
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div className="dashboard-eyebrow">
                                    Check-out
                                  </div>
                                  <div
                                    style={{ color: C.text, fontWeight: 800 }}
                                  >
                                    {b.check_out_date ?? "—"}
                                  </div>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: 10,
                                  marginTop: 12,
                                }}
                              >
                                {[
                                  ["Email", b.email ?? "—"],
                                  ["Phone", b.phone ?? "—"],
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
                                    <div className="dashboard-eyebrow">
                                      {lbl}
                                    </div>
                                    <div
                                      style={{
                                        color: C.soft,
                                        fontSize: 12,
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      {val}
                                    </div>
                                  </div>
                                ))}
                              </div>

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
                                    <div className="dashboard-eyebrow">
                                      Guest manifest
                                    </div>
                                    <div
                                      style={{ color: C.muted, fontSize: 11 }}
                                    >
                                      {guests.length} guest
                                      {guests.length === 1 ? "" : "s"}
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexWrap: "wrap",
                                      gap: 8,
                                    }}
                                  >
                                    {guests.map((g, i) => (
                                      <div
                                        key={`${b.conf_code}-${i}`}
                                        style={{
                                          border: `1px solid ${C.border}`,
                                          borderRadius: 999,
                                          padding: "8px 11px",
                                          background: g.is_owner
                                            ? C.panelAlt
                                            : C.bg,
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
                                          <span style={{ color: C.soft }}>
                                            Room {g.room_number}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}

          {/* ── Tied villas modal ─────────────────────────────────────────── */}
          {tieModalOpen && (
            <div
              onClick={() => setTieModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(8, 18, 32, 0.48)",
                zIndex: 1000,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(620px, 96vw)",
                  height: "100vh",
                  background: C.bg,
                  borderLeft: `1px solid ${C.border}`,
                  overflowY: "auto",
                  padding: 26,
                }}
              >
                <button onClick={() => setTieModalOpen(false)}>
                  <X size={18} />
                </button>

                <div className="dashboard-eyebrow">Tied villas</div>
                <h2 className="dashboard-card-title">{tieModalTitle}</h2>

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
                        "Villa",
                        "Bedrooms",
                        "Bookings",
                        "Nights",
                        "Revenue",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: h === "Villa" ? "left" : "right",
                            padding: 10,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {tieModalRows.map((villa) => (
                      <tr
                        key={villa.villa_name}
                        onClick={() => {
                          setTieModalOpen(false);
                          openVillaModal(villa.villa_name);
                        }}
                        style={{
                          borderTop: `1px solid ${C.border}`,
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ padding: 10, color: C.text }}>
                          {villa.villa_name}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {villaBedroomLabel(villa)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {fmt(villa.bookings)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {fmt(villa.total_nights)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            color: C.soft,
                          }}
                        >
                          {money(villa.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </aside>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SOURCES VIEW                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {topView === "sources" && (
        <VillaSourceBreakdown years={years} months={months} />
      )}
    </div>
  );
}
