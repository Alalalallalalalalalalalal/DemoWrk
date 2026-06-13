import { useMemo, useState } from "react";
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
  Clock,
} from "lucide-react";

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

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const money = (v) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div style={{ padding: "0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {Icon && <Icon size={15} color={C.accent2} />}
        <span className="dashboard-eyebrow">{label}</span>
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
  liveInHouseCount,
  liveInHouseRoster = [],
  visitsTabSummary,
  villaStats = [],
  villaMonthly = [],
  bookingsByBedroom = [],
  monthlyRevenue = [],
  leadTimeData = [],
  selectedVillaName,
  onVillaSelect,
  onGoToML,
}) {
  const [year, setYear] = useState("All");
  const [month, setMonth] = useState("All");

  const years = useMemo(() => {
    const all = [...villaStats, ...monthlyRevenue]
      .map((r) => r.year ?? r.booking_year)
      .filter(Boolean);
    return ["All", ...Array.from(new Set(all)).sort((a, b) => b - a)];
  }, [villaStats, monthlyRevenue]);

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

  const filteredVillas = useMemo(() => {
    return villaStats.filter((v) => {
      const y = v.year ?? v.booking_year;
      const m = v.month ?? v.month_name;
      return (
        (year === "All" || String(y) === String(year)) &&
        (month === "All" || String(m) === String(month))
      );
    });
  }, [villaStats, year, month]);

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

      {/* KPI band */}
      <section className="dashboard-kpi-band" style={{ padding: "20px 18px" }}>
        <Stat
          icon={Users}
          label="Total Members Booked"
          value={fmt(visitsTabSummary?.total_members_booked)}
          sub="Unique members"
        />
        <Stat
          icon={Users}
          label="Total Guests Booked"
          value={fmt(visitsTabSummary?.total_guests_booked)}
          sub="From folios"
        />
        <Stat
          icon={CalendarClock}
          label="Average Length of Stay"
          value={`${num(visitsTabSummary?.avg_length_of_stay)} nights`}
          sub="Overall"
        />
        <Stat
          icon={Users}
          label="Average Party Size"
          value={num(visitsTabSummary?.avg_party_size)}
          sub="Guests per booking"
        />
        <Stat
          icon={BedDouble}
          label="Total Room Nights"
          value={fmt(visitsTabSummary?.total_room_nights)}
          sub="Booked nights"
        />
        <Stat
          icon={DollarSign}
          label="Villa Rental Revenue"
          value={money(visitsTabSummary?.villa_rental_revenue)}
          sub="Folio rental spend"
        />
      </section>

      {/* Villa charts */}
      <Card title="Bookings by Villa" sub="Villa types, not generic room types">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: filteredVillas.length * 60, height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredVillas} margin={{ bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="villa_name"
                  stroke={AX}
                  fontSize={11}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={90}
                />
                <YAxis stroke={AX} fontSize={11} />
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
          <div className="dashboard-eyebrow">All Villas</div>
          <h2 className="dashboard-card-title">Villa performance</h2>
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
                      onClick={() => onVillaSelect(villa.villa_name)}
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
              >
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={villaMonthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="month" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
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
              >
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={villaMonthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="month" stroke={AX} fontSize={11} />
                      <YAxis stroke={AX} fontSize={11} />
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
        <Card title="Bookings by Bedroom Count" sub="Bedroom demand">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={bookingsByBedroom}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="beds" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
                <Tooltip contentStyle={TIP} />
                <Bar
                  dataKey="bookings"
                  fill="var(--dashboard-flame)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Average Stay by Bedroom Count" sub="Length of stay">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={bookingsByBedroom}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="beds" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
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
        <Card title="Bookings by Month" sub="Monthly booking trend">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="month" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
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

        <Card title="Villa Rental Revenue by Month" sub="Folio rental revenue">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="month" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
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

      {/* Lead time */}
      <Card title="Lead Time Analysis" sub="Booking creation to check-in">
        <div className="dashboard-grid dashboard-grid-3">
          {leadTimeData.map((row) => (
            <div
              key={row.range}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
                background: C.panel,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Clock size={15} color={C.accent2} />
                <span className="dashboard-eyebrow">{row.range}</span>
              </div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 28,
                  color: C.text,
                  marginTop: 6,
                }}
              >
                {fmt(row.bookings)}
              </div>
              <div style={{ color: C.soft, fontSize: 12 }}>
                {num(row.pct)}% of bookings
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Live roster */}
      <Card
        title="Live In-House Roster"
        sub={`${liveInHouseCount?.total_in_house ?? 0} currently in house`}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr className="dashboard-eyebrow">
                {[
                  "Name",
                  "Member #",
                  "Room / Villa Type",
                  "Check-in",
                  "Check-out",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
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
              {liveInHouseRoster.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ padding: 28, textAlign: "center", color: C.muted }}
                  >
                    No guests currently in house.
                  </td>
                </tr>
              ) : (
                liveInHouseRoster.map((m, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: 10, fontWeight: 700 }}>
                      {m.member_full_name ?? m.member_name ?? "—"}
                    </td>
                    <td style={{ padding: 10 }}>{m.member_number ?? "—"}</td>
                    <td style={{ padding: 10 }}>
                      {m.villa_name ?? m.room_type ?? "—"}
                    </td>
                    <td style={{ padding: 10 }}>{m.check_in_date ?? "—"}</td>
                    <td style={{ padding: 10 }}>{m.check_out_date ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
