// frontend/src/pages/visits/VisitsChartPanel.jsx
//
// "Bookings/revenue/nights by villa or bedroom count" chart panel, with its
// dimension/metric/sort/limit Segmented controls.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Empty,
  FONT_DISPLAY,
  InfoTip,
  Segmented,
  T,
  TIP_STYLE,
  bedColor,
  money,
  moneyShort,
  n0,
} from "./VisitsRoomsShared";

export default function VisitsChartPanel({
  chartDim,
  setChartDim,
  chartMetric,
  setChartMetric,
  chartSort,
  setChartSort,
  chartLimit,
  setChartLimit,
  chartAll,
  valueLabel,
  selection,
  onSelect,
}) {
  const chartData =
    chartDim === "bedroom" || chartLimit === "all"
      ? chartAll
      : chartAll.slice(0, chartLimit);

  const chartKey = chartMetric === "revenue" ? "value" : chartMetric;

  const barWidth = chartDim === "villa" ? 48 : 96;
  const plotWidth = Math.max(720, chartData.length * barWidth);

  return (
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
                  onClick={(d) => onSelect(d?.payload ?? d)}
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
                        selection && selection.key === d.key ? T.flame : "none"
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
  );
}
