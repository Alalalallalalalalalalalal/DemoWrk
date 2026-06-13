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
      <div className="dashboard-grid dashboard-grid-main">
        <Card
          title="Bookings by Villa"
          sub="Villa types, not generic room types"
        >
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={filteredVillas}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="villa_name"
                  stroke={AX}
                  fontSize={11}
                  angle={-20}
                  textAnchor="end"
                  height={70}
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
        </Card>

        <Card
          title="Most / Least Booked Villa"
          sub="Click through to ML Insights"
        >
          {[mostVilla, leastVilla].map((villa, i) => (
            <button
              key={`${villa?.villa_name}-${i}`}
              onClick={() => {
                if (villa?.villa_name) onVillaSelect(villa.villa_name);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                background: i === 0 ? C.panelAlt : C.panel,
                padding: 16,
                marginBottom: 12,
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
                {fmt(villa?.bookings)} bookings · {villa?.bedroom_count ?? "—"}{" "}
                bedrooms
              </div>
            </button>
          ))}

          <button
            onClick={onGoToML}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
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
      </div>

      {/* Villa cards */}
      <div className="dashboard-grid dashboard-grid-3">
        {filteredVillas.map((villa) => {
          const active = villa.villa_name === selectedVillaName;

          return (
            <button
              key={villa.villa_name}
              onClick={() => onVillaSelect(villa.villa_name)}
              className="dashboard-card"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderTop: active
                  ? `4px solid ${C.accent2}`
                  : `1px solid ${C.border}`,
              }}
            >
              <div className="dashboard-eyebrow">Villa</div>
              <h3
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 24,
                  color: C.text,
                  margin: "4px 0 12px",
                }}
              >
                {villa.villa_name}
              </h3>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  fontSize: 12,
                  color: C.soft,
                }}
              >
                <b>Bookings: {fmt(villa.bookings)}</b>
                <b>Bedrooms: {villa.bedroom_count ?? "—"}</b>
                <span>Room nights: {fmt(villa.total_nights)}</span>
                <span>Avg stay: {num(villa.avg_stay)} nights</span>
                <span>Avg party: {num(villa.avg_party_size)}</span>
                <span>Revenue: {money(villa.revenue)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected villa drilldown */}
      {selectedVilla && (
        <div className="dashboard-grid dashboard-grid-main">
          <Card
            title={`${selectedVilla.villa_name} Monthly Bookings`}
            sub="Selected villa drill-down"
          >
            <div style={{ height: 240 }}>
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
            title={`${selectedVilla.villa_name} Rental Revenue`}
            sub="Monthly villa revenue"
          >
            <div style={{ height: 240 }}>
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
        </div>
      )}

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
