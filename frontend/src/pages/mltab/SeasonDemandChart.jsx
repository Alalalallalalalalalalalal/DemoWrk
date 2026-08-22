// frontend/src/pages/mltab/SeasonDemandChart.jsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TOOLTIP_STYLE } from "../styles/Dashboardstyles";
import { C } from "./SeasonFilterShared";

export default function SeasonDemandChart({ chartData, activeGroup, onBarClick }) {
  return (
    <>
      <div style={{ height: Math.max(240, 220), marginTop: 4 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            style={{ cursor: "pointer" }}
            margin={{ top: 10, right: 24, left: 12, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
            <XAxis
              dataKey="season"
              stroke="var(--dashboard-muted)"
              fontSize={11}
              label={{
                value: "Season Name",
                position: "insideBottom",
                offset: -12,
                fill: "var(--dashboard-muted)",
                fontSize: 11,
              }}
            />
            <YAxis
              stroke="var(--dashboard-muted)"
              fontSize={11}
              label={{
                value: "Total Visits",
                angle: -90,
                position: "insideLeft",
                fill: "var(--dashboard-muted)",
                fontSize: 11,
              }}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [
                Number(value).toLocaleString(),
                name === "visits" ? "Total Visits" : name,
              ]}
              labelFormatter={(label) => `Season: ${label}`}
            />
            <Bar
              dataKey="visits"
              fill="var(--dashboard-deep-blue)"
              radius={[6, 6, 0, 0]}
              cursor="pointer"
              onClick={(data) => onBarClick(data)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p
        style={{
          fontSize: 11,
          color: C.textMuted,
          fontFamily: "sans-serif",
          margin: 0,
          lineHeight: 1.45,
        }}
      >
        Showing <strong>{activeGroup?.group_name ?? "—"}</strong>
        {activeGroup &&
          ` · ${activeGroup.seasons.filter((s) => s.is_active).length} of ${activeGroup.seasons.length} seasons active`}
        {activeGroup &&
          " · active seasons are included in the chart; disabled seasons are hidden from the bar totals."}
      </p>
    </>
  );
}
