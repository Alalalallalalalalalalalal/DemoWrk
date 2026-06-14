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
} from "lucide-react";
import { analyticsApi } from "../../api/analytics";

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
  bookingsByVilla: {
    summary:
      "Shows total confirmed bookings per villa across all time (or the selected year/month filter).",
    functionality:
      "Hover a bar for exact booking count. Use the Year/Month filters above to narrow the view. Click a villa in the table below to drill into its monthly detail.",
    x: "Villa name",
    y: "Number of confirmed bookings",
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
      "Shows rental revenue earned by the selected villa for each calendar month.",
    functionality:
      "Hover a bar for the exact monthly revenue figure. Revenue counts only folio lines matching villa, room, rental, or accommodation descriptions.",
    x: "Month (Jan–Dec)",
    y: "Rental revenue in USD",
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
    summary:
      "Shows the average length of stay for each bedroom count, helping identify whether party size correlates with longer visits.",
    functionality:
      "Hover a bar for the average nights figure. Drawn from the same folio dataset as the bookings chart — cancelled and no-show reservations are excluded.",
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
    summary:
      "Shows total villa rental revenue by month across all villas, revealing which months drive the most income.",
    functionality:
      "Hover a bar for the exact monthly revenue. Revenue is summed from folio lines matching villa, room, rental, or accommodation keywords — service charges and fees are excluded.",
    x: "Month (Jan–Dec)",
    y: "Rental revenue in USD",
  },

  villaTable: {
    summary:
      "Ranks all villas by total confirmed bookings and surfaces key performance metrics side by side.",
    functionality:
      "Click any row to open a full booking timeline for that villa in a side panel. The active row is highlighted. Filtered by the Year/Month selectors at the top.",
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
          {/* backdrop to close */}
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
            {/* close */}
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

            {/* summary */}
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

            {/* axes */}
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

            {/* functionality */}
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

// ────────────────────────────────────────────────────────────────────────────

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

function Stat({ icon: Icon, label, value, sub, onClick }) {
  const clickable = Boolean(onClick);

  return (
    <div style={{ padding: "0 18px" }}>
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
            {o === "All" ? `All ${label}s` : o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function VisitsRoomsTab({
  selectedVillaName,
  onVillaSelect,
  onGoToML,
}) {
  const [year, setYear] = useState("All");
  const [month, setMonth] = useState("All");

  const [summaryData, setSummaryData] = useState({});
  const [villaStatsData, setVillaStatsData] = useState([]);
  const [villaMonthlyData, setVillaMonthlyData] = useState([]);
  const [bookingsByBedroomData, setBookingsByBedroomData] = useState([]);
  const [monthlyRevenueData, setMonthlyRevenueData] = useState([]);
  const [visitsDataLoading, setVisitsDataLoading] = useState(false);

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

  const activeFilters = useMemo(
    () => ({
      year: year === "All" ? null : Number(year),
      month: month === "All" ? null : months.indexOf(month),
    }),
    [year, month],
  );

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

  useEffect(() => {
    let cancelled = false;

    async function loadFilteredData() {
      setVisitsDataLoading(true);

      try {
        const [summary, stats, bedroomStats, revenueByMonth] =
          await Promise.all([
            analyticsApi.visitsTabSummary(activeFilters),
            analyticsApi.villaStats(activeFilters),
            analyticsApi.bookingsByBedroom(activeFilters),
            analyticsApi.monthlyRevenue(activeFilters),
          ]);

        if (cancelled) return;

        setSummaryData(summary ?? {});
        setVillaStatsData(Array.isArray(stats) ? stats : []);
        setBookingsByBedroomData(
          Array.isArray(bedroomStats) ? bedroomStats : [],
        );
        setMonthlyRevenueData(
          Array.isArray(revenueByMonth) ? revenueByMonth : [],
        );
      } catch (err) {
        console.error(err);
        // Keep the last good data on screen instead of clearing the tab.
      } finally {
        if (!cancelled) setVisitsDataLoading(false);
      }
    }

    loadFilteredData();

    return () => {
      cancelled = true;
    };
  }, [activeFilters]);

  const filteredVillas = villaStatsData;

  const mostVilla = filteredVillas[0];
  const leastVilla = filteredVillas.length
    ? [...filteredVillas].sort(
        (a, b) => Number(a.bookings ?? 0) - Number(b.bookings ?? 0),
      )[0]
    : null;

  const selectedVilla =
    filteredVillas.find((v) => v.villa_name === selectedVillaName) ??
    mostVilla ??
    null;

  useEffect(() => {
    let cancelled = false;
    const villaName = selectedVilla?.villa_name;

    async function loadVillaMonthly() {
      if (!villaName) {
        setVillaMonthlyData([]);
        return;
      }

      try {
        const data = await analyticsApi.villaMonthly(villaName, activeFilters);
        if (!cancelled) setVillaMonthlyData(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setVillaMonthlyData([]);
      }
    }

    loadVillaMonthly();

    return () => {
      cancelled = true;
    };
  }, [selectedVilla?.villa_name, activeFilters]);

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

  const [villaModalOpen, setVillaModalOpen] = useState(false);
  const [villaBookings, setVillaBookings] = useState([]);
  const [villaBookingsLoading, setVillaBookingsLoading] = useState(false);

  const openVillaModal = async (villaName) => {
    if (!villaName) return;

    onVillaSelect(villaName);
    setVillaModalOpen(true);
    setVillaBookingsLoading(true);

    try {
      const data = await analyticsApi.villaBookings(villaName, activeFilters);
      setVillaBookings(data);
    } catch (err) {
      console.error(err);
      setVillaBookings([]);
    } finally {
      setVillaBookingsLoading(false);
    }
  };

  const [bedroomModalOpen, setBedroomModalOpen] = useState(false);
  const [selectedBedroom, setSelectedBedroom] = useState(null);
  const [bedroomBookings, setBedroomBookings] = useState([]);
  const [bedroomBookingsLoading, setBedroomBookingsLoading] = useState(false);

  const openBedroomModal = async (beds) => {
    if (!beds) return;

    setSelectedBedroom(beds);
    setBedroomModalOpen(true);
    setBedroomBookingsLoading(true);

    try {
      const data = await analyticsApi.bedroomBookings(beds, activeFilters);
      setBedroomBookings(data);
    } catch (err) {
      console.error(err);
      setBedroomBookings([]);
    } finally {
      setBedroomBookingsLoading(false);
    }
  };

  const [peopleModalOpen, setPeopleModalOpen] = useState(false);
  const [peopleKind, setPeopleKind] = useState("members");
  const [peopleRows, setPeopleRows] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleYear, setPeopleYear] = useState(year);
  const [peopleMonth, setPeopleMonth] = useState(month);

  const peopleFilters = useMemo(
    () => ({
      year: peopleYear === "All" ? null : Number(peopleYear),
      month: peopleMonth === "All" ? null : months.indexOf(peopleMonth),
    }),
    [peopleYear, peopleMonth],
  );

  const loadPeopleRows = async (kind, filters = peopleFilters) => {
    setPeopleLoading(true);
    try {
      const data = await analyticsApi.bookedPeople(kind, filters);
      setPeopleRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setPeopleRows([]);
    } finally {
      setPeopleLoading(false);
    }
  };

  const openPeopleModal = async (kind) => {
    setPeopleKind(kind);
    setPeopleYear(year);
    setPeopleMonth(month);
    setPeopleModalOpen(true);

    const filters = {
      year: year === "All" ? null : Number(year),
      month: month === "All" ? null : months.indexOf(month),
    };

    await loadPeopleRows(kind, filters);
  };

  useEffect(() => {
    if (!peopleModalOpen) return;
    loadPeopleRows(peopleKind, peopleFilters);
  }, [peopleKind, peopleFilters, peopleModalOpen]);

  return (
    <div className="dashboard-section">
      {/* Filters */}
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
            Villa booking performance
          </h2>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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

      {visitsDataLoading && (
        <div style={{ color: C.muted, fontSize: 12, padding: "0 4px" }}>
          Updating visits and rooms data…
        </div>
      )}

      {/* KPI band */}
      <section className="dashboard-kpi-band" style={{ padding: "20px 18px" }}>
        <Stat
          icon={Users}
          label="Total Members Booked"
          value={fmt(summaryData?.total_members_booked)}
          sub="Unique members"
          onClick={() => openPeopleModal("members")}
        />

        <Stat
          icon={Users}
          label="Total Guests Booked"
          value={fmt(summaryData?.total_guests_booked)}
          sub="From folios"
          onClick={() => openPeopleModal("guests")}
        />
        <Stat
          icon={CalendarClock}
          label="Average Length of Stay"
          value={`${num(summaryData?.avg_length_of_stay)} nights`}
          sub="Overall"
        />
        <Stat
          icon={Users}
          label="Average Party Size"
          value={num(summaryData?.avg_party_size)}
          sub="Guests per booking"
        />
        <Stat
          icon={BedDouble}
          label="Total Room Nights"
          value={fmt(summaryData?.total_room_nights)}
          sub="Booked nights"
        />
        <Stat
          icon={DollarSign}
          label="Villa Rental Revenue"
          value={money(summaryData?.villa_rental_revenue)}
          sub="Folio rental spend"
        />
      </section>

      {/* Villa charts */}
      <Card
        title="Bookings by Villa"
        action={<ChartInfo id="bookingsByVilla" />}
      >
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              minWidth: Math.max(filteredVillas.length * 60, 420),
              height: 320,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={filteredVillas}
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
          {[mostVilla, leastVilla].map((villa, i) => (
            <button
              key={`${villa?.villa_name}-${i}`}
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
              <div className="dashboard-eyebrow">
                {i === 0 ? "Most Booked" : "Least Booked"}
              </div>
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

      {/* Villa table + drilldown side by side */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Villa table */}
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
            <ChartInfo id="villaTable" />
          </div>
          <div style={{ overflowY: "auto", maxHeight: 480, marginTop: 8 }}>
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
                  {["Villa", "Bookings", "Nights", "Avg Stay", "Revenue"].map(
                    (h) => (
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
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredVillas.map((villa) => {
                  const active = villa.villa_name === selectedVillaName;
                  return (
                    <tr
                      key={villa.villa_name}
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
                        if (!active) e.currentTarget.style.background = C.panel;
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
              <Card
                title={`${selectedVilla.villa_name} — Monthly Bookings`}
                sub="Selected villa drill-down"
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
                title={`${selectedVilla.villa_name} — Rental Revenue`}
                sub="Monthly villa revenue"
                action={<ChartInfo id="villaMonthlyRevenue" />}
              >
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={villaMonthlyData}
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

      {/* Bedroom + monthly revenue */}
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

      {/* side modals */}

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
              {peopleKind === "members" ? "Members booked" : "Guests booked"}
            </div>

            <h2 className="dashboard-card-title">
              {peopleKind === "members"
                ? "Total Members Booked"
                : "Total Guests Booked"}
            </h2>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <Select
                label="Year"
                value={peopleYear}
                onChange={setPeopleYear}
                options={years}
              />
              <Select
                label="Month"
                value={peopleMonth}
                onChange={setPeopleMonth}
                options={months}
              />
            </div>

            <div style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
              {peopleRows.length} records
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
                    {peopleRows.map((p, i) => {
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
                              color: !p.member_or_guest ? C.accent3 : C.soft,
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
                      <th key={h} style={{ textAlign: "left", padding: 10 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bedroomBookings.map((b) => (
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
                      <td style={{ padding: 10 }}>{b.check_in_date || "—"}</td>
                      <td style={{ padding: 10 }}>{b.check_out_date || "—"}</td>
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
            </div>

            <div style={{ padding: 26 }}>
              {/* Summary tiles */}
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
                  ["Guests", fmt(selectedVilla.total_guests), "Total guests"],
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
                    <div style={{ color: C.muted, fontSize: 11 }}>{sub}</div>
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
                  style={{
                    color: C.muted,
                    fontSize: 12,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    padding: "7px 11px",
                    background: C.panelAlt,
                  }}
                >
                  {villaBookings.length} records
                </div>
              </div>

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

                  {villaBookings.map((b, index) => {
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
                        {/* date dot */}
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

                        {/* booking card */}
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
                                Member #{b.member_number ?? "—"} · Confirmation{" "}
                                {b.conf_code ?? "—"}
                              </div>
                            </div>

                            <div
                              style={{
                                textAlign: "right",
                                minWidth: 100,
                              }}
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
                              {fmt(b.nights)} nights · {fmt(b.persons)} guests
                            </div>

                            <div style={{ textAlign: "right" }}>
                              <div className="dashboard-eyebrow">Check-out</div>
                              <div style={{ color: C.text, fontWeight: 800 }}>
                                {b.check_out_date ?? "—"}
                              </div>
                            </div>
                          </div>

                          {/* contact row */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 10,
                              marginTop: 12,
                            }}
                          >
                            <div
                              style={{
                                border: `1px solid ${C.border}`,
                                borderRadius: 14,
                                padding: 11,
                                background: C.bg,
                              }}
                            >
                              <div className="dashboard-eyebrow">Email</div>
                              <div
                                style={{
                                  color: C.soft,
                                  fontSize: 12,
                                  wordBreak: "break-word",
                                }}
                              >
                                {b.email ?? "—"}
                              </div>
                            </div>

                            <div
                              style={{
                                border: `1px solid ${C.border}`,
                                borderRadius: 14,
                                padding: 11,
                                background: C.bg,
                              }}
                            >
                              <div className="dashboard-eyebrow">Phone</div>
                              <div style={{ color: C.soft, fontSize: 12 }}>
                                {b.phone ?? "—"}
                              </div>
                            </div>
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
                                <div className="dashboard-eyebrow">
                                  Guest manifest
                                </div>
                                <div style={{ color: C.muted, fontSize: 11 }}>
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
    </div>
  );
}
