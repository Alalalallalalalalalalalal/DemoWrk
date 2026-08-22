import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { analyticsApi } from "../../api/analytics";
import { SectionLabel } from "../styles/Dashboardcomponents";
import NewVsRepeatFilterBar from "./NewVsRepeatFilterBar";
import {
  AX,
  GRID,
  TIP,
  C,
  Card,
  ChartInfo,
  ClickableBarColumn,
  ClickableVisitorDot,
} from "./DemographicsShared";

/* ─── Member status and growth ──────────────────────── */
export default function MemberGrowthSection({
  membersByStatus,
  newMembersPerYear,
  openAccountDrawer,
  visitorChartFilter,
  setVisitorChartFilter,
  visitorYearsAvailable,
  visitorChartData,
  visitorChartLoading,
  visitorChartSubtitle,
  visitorAxisInterval,
}) {
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  /* New vs Repeat Accounts chart - interactive legend */
  const [activeVisitorLines, setActiveVisitorLines] = useState({
    total_new: true,
    total_repeat: true,
  });

  const handleStatusClick = (entry, category) => {
    const row = entry?.payload ?? entry;
    const status = row?.status;

    if (!status) return;

    openAccountDrawer({
      title: `${category} Accounts — ${status}`,
      eyebrow: "Account status details",
      emptyMessage: `No ${category.toLowerCase()} accounts were found with the status ${status}.`,
      exportKey: `${category}-${status}`,
      request: (dateParams = {}) =>
        analyticsApi.demographicAccountDetails({
          dimension: "status",
          value: status,
          category,
          ...dateParams,
        }),
    });
  };

  const handleLegendClick = ({ dataKey }) => {
    if (!dataKey) return;

    setActiveVisitorLines((previous) => ({
      ...previous,
      [dataKey]: !previous[dataKey],
    }));
  };

  const handleVisitorPointClick = ({
    visitorStatus,
    periodStart,
    periodEnd,
    periodLabel,
  }) => {
    openAccountDrawer({
      title: `${visitorStatus} Accounts — ` + periodLabel,
      eyebrow: "Account details",
      emptyMessage: `No ${visitorStatus.toLowerCase()} accounts were found for ${periodLabel}.`,
      exportKey: `${visitorStatus.toLowerCase()}-visitors-` + periodLabel,
      showDateFilter: false,
      request: () =>
        analyticsApi.newVsRepeatVisitorDetails({
          visitorStatus,
          periodStart,
          periodEnd,
        }),
    });
  };

  return (
    <>
      <SectionLabel>Member Status &amp; Growth</SectionLabel>
      <div className="dashboard-grid dashboard-grid-side">
        <Card
          title="Member & Guest Status"
          sub="Status comparison between members and guests"
          action={<ChartInfo id="memberGuestStatus" />}
        >
          <div className="dashboard-chart dashboard-chart-200">
            <ResponsiveContainer>
              <BarChart
                data={membersByStatus}
                margin={{
                  top: 5,
                  right: 12,
                  bottom: 0,
                  left: 0,
                }}
                barGap={4}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="status" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={TIP} />
                <Legend
                  wrapperStyle={{
                    fontSize: 11,
                    paddingTop: 6,
                  }}
                />

                <Bar
                  dataKey="members"
                  name="Members"
                  fill="#FFB162"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) => handleStatusClick(entry, "Member")}
                  background={(props) => (
                    <ClickableBarColumn
                      {...props}
                      category="Member"
                      onColumnClick={handleStatusClick}
                    />
                  )}
                />

                <Bar
                  dataKey="guests"
                  name="Guests"
                  fill="var(--dashboard-truffle)"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) => handleStatusClick(entry, "Guest")}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card
          title="New Members & Guests per Year"
          sub="Member and guest acquisition over time"
          action={<ChartInfo id="newMembersGuests" />}
        >
          <div className="dashboard-chart dashboard-chart-200">
            <ResponsiveContainer>
              <LineChart
                data={newMembersPerYear}
                margin={{
                  top: 5,
                  right: 12,
                  bottom: 5,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="year"
                  stroke={AX}
                  fontSize={11}
                  allowDecimals={false}
                />
                <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={TIP} />
                <Legend
                  wrapperStyle={{
                    fontSize: 11,
                    paddingTop: 6,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="members"
                  name="Members"
                  stroke="#FFB162"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="guests"
                  name="Guests"
                  stroke="var(--dashboard-truffle)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div>
        <Card
          title="New vs Repeat Guests & Members"
          sub={visitorChartSubtitle}
          action={<ChartInfo id="newVsRepeatVisitors" />}
        >
          <NewVsRepeatFilterBar
            value={visitorChartFilter}
            onChange={setVisitorChartFilter}
            yearsAvailable={visitorYearsAvailable}
            currentYear={currentYear}
          />

          {visitorChartLoading && (
            <div
              style={{
                color: C.muted,
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              Updating chart…
            </div>
          )}

          <div
            className="dashboard-chart"
            style={{
              height: 280,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={visitorChartData}
                margin={{
                  top: 10,
                  right: 20,
                  bottom: 10,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />

                <XAxis
                  dataKey="period_label"
                  stroke={AX}
                  fontSize={11}
                  interval={visitorAxisInterval}
                />

                <YAxis stroke={AX} fontSize={11} allowDecimals={false} />

                <Tooltip
                  contentStyle={TIP}
                  labelFormatter={(label) => label}
                  formatter={(value, name) => [Number(value).toLocaleString(), name]}
                />

                <Legend
                  onClick={handleLegendClick}
                  wrapperStyle={{
                    fontSize: 11,
                    paddingTop: 8,
                    cursor: "pointer",
                  }}
                  formatter={(value, entry) => {
                    const isActive = activeVisitorLines[entry.dataKey];

                    return (
                      <span
                        style={{
                          color: isActive ? C.text : C.muted,
                          opacity: isActive ? 1 : 0.45,
                          textDecoration: isActive ? "none" : "line-through",
                        }}
                      >
                        {value}
                      </span>
                    );
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="total_new"
                  name="New"
                  stroke={activeVisitorLines.total_new ? "#FFB162" : "transparent"}
                  strokeWidth={2.5}
                  connectNulls
                  dot={
                    activeVisitorLines.total_new
                      ? (props) => (
                          <ClickableVisitorDot
                            {...props}
                            fill="#FFB162"
                            visitorStatus="New"
                            onPointClick={handleVisitorPointClick}
                          />
                        )
                      : false
                  }
                  activeDot={false}
                />

                <Line
                  type="monotone"
                  dataKey="total_repeat"
                  name="Repeat"
                  stroke={
                    activeVisitorLines.total_repeat
                      ? "var(--dashboard-truffle)"
                      : "transparent"
                  }
                  strokeWidth={2.5}
                  connectNulls
                  dot={
                    activeVisitorLines.total_repeat
                      ? (props) => (
                          <ClickableVisitorDot
                            {...props}
                            fill="var(--dashboard-truffle)"
                            visitorStatus="Repeat"
                            onPointClick={handleVisitorPointClick}
                          />
                        )
                      : false
                  }
                  activeDot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}
