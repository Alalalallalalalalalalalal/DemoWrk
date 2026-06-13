import { Fragment, useMemo, useState } from "react";
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
  // Internal selected villa state — works even if parent doesn't pass onVillaSelect
  const [localSelected, setLocalSelected] = useState(null);

  const activeVillaName =
    selectedVillaName !== undefined ? selectedVillaName : localSelected;

  const handleVillaSelect = (name) => {
    setLocalSelected((prev) => (prev === name ? null : name));
    if (typeof onVillaSelect === "function") {
      onVillaSelect(activeVillaName === name ? null : name);
    }
  };

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

  const mostVilla = filteredVillas[0] ?? null;
  const leastVilla = filteredVillas.length
    ? [...filteredVillas].sort(
        (a, b) => Number(a.bookings ?? 0) - Number(b.bookings ?? 0),
      )[0]
    : null;

  const selectedVilla =
    filteredVillas.find((v) => v.villa_name === activeVillaName) ?? null;

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

      {/* Bookings by villa bar chart */}
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
      </div>

      {/* Villa table + Most/Least side-by-side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Villa Table */}
        <div
          className="dashboard-card"
          style={{ padding: 0, overflow: "hidden" }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                {[
                  "Villa",
                  "Bookings",
                  "Bedrooms",
                  "Avg Stay",
                  "Revenue",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="dashboard-eyebrow"
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderBottom: `1px solid ${C.border}`,
                      background: C.panel,
                      width: ["30%", "14%", "14%", "16%", "16%", "10%"][i],
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredVillas.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{ padding: 28, textAlign: "center", color: C.muted }}
                  >
                    No villas match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredVillas.map((villa) => {
                  const isActive = activeVillaName === villa.villa_name;
                  return (
                    <Fragment key={villa.villa_name}>
                      <tr
                        onClick={() => handleVillaSelect(villa.villa_name)}
                        style={{
                          cursor: "pointer",
                          background: isActive ? C.panelAlt : "transparent",
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 14px",
                            fontWeight: 700,
                            color: C.text,
                          }}
                        >
                          {villa.villa_name}
                        </td>
                        <td style={{ padding: "10px 14px", color: C.soft }}>
                          {fmt(villa.bookings)}
                        </td>
                        <td style={{ padding: "10px 14px", color: C.soft }}>
                          {bedroomsLabel(villa)}
                        </td>
                        <td style={{ padding: "10px 14px", color: C.soft }}>
                          {num(villa.avg_stay)} nights
                        </td>
                        <td style={{ padding: "10px 14px", color: C.soft }}>
                          {money(villa.revenue)}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            textAlign: "right",
                            color: C.muted,
                            fontSize: 10,
                          }}
                        >
                          {isActive ? "▲" : "▼"}
                        </td>
                      </tr>

                      {/* Inline expanded detail */}
                      {isActive && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              padding: 0,
                              borderBottom: `1px solid ${C.border}`,
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 1fr)",
                                gap: 10,
                                padding: 14,
                                background: C.panel,
                              }}
                            >
                              {[
                                ["Room Nights", fmt(villa.total_nights)],
                                ["Avg Stay", `${num(villa.avg_stay)} nights`],
                                ["Avg Party", num(villa.avg_party_size)],
                                ["Bedrooms", bedroomsLabel(villa)],
                                ["Revenue", money(villa.revenue)],
                                ["Bookings", fmt(villa.bookings)],
                              ].map(([label, val]) => (
                                <div
                                  key={label}
                                  style={{
                                    background: C.bg,
                                    border: `1px solid ${C.border}`,
                                    borderRadius: 12,
                                    padding: "10px 14px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: C.muted,
                                      marginBottom: 3,
                                    }}
                                  >
                                    {label}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 20,
                                      color: C.text,
                                      fontFamily: "'Cormorant Garamond', serif",
                                    }}
                                  >
                                    {val}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Most / Least + ML button */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { villa: mostVilla, label: "Most Booked", accent: C.accent },
            { villa: leastVilla, label: "Least Booked", accent: C.accent3 },
          ].map(({ villa, label, accent }) => (
            <button
              key={label}
              onClick={() =>
                villa?.villa_name && handleVillaSelect(villa.villa_name)
              }
              className="dashboard-card"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderLeft: `3px solid ${accent}`,
                borderRadius: 16,
                width: "100%",
              }}
            >
              <div className="dashboard-eyebrow">{label}</div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 22,
                  color: C.text,
                  margin: "4px 0",
                }}
              >
                {villa?.villa_name ?? "—"}
              </div>
              <div style={{ fontSize: 12, color: C.soft }}>
                {fmt(villa?.bookings)} bookings · {bedroomsLabel(villa)}{" "}
                bedrooms
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <div
                  style={{
                    background: C.panel,
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontSize: 11, color: C.muted }}>
                    Room nights
                  </div>
                  <div style={{ fontSize: 18, color: C.text }}>
                    {fmt(villa?.total_nights)}
                  </div>
                </div>
                <div
                  style={{
                    background: C.panel,
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontSize: 11, color: C.muted }}>Revenue</div>
                  <div style={{ fontSize: 18, color: C.text }}>
                    {money(villa?.revenue)}
                  </div>
                </div>
              </div>
            </button>
          ))}

          <button
            onClick={typeof onGoToML === "function" ? onGoToML : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 15px",
              borderRadius: 14,
              border: `1px dashed ${C.accent2}`,
              background: C.panelAlt,
              color: C.accent,
              fontWeight: 700,
              cursor: "pointer",
              width: "100%",
            }}
          >
            View season × villa insights <ArrowUpRight size={17} />
          </button>
        </div>
      </div>

      {/* Selected villa monthly drilldown charts */}
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
