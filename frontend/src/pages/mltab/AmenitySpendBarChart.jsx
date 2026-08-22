// frontend/src/pages/mltab/AmenitySpendBarChart.jsx
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { C, COLOR_PAID, COLOR_FREE } from "./AmenitySeasonShared";

/* ── AmenitySpendBarChart ────────────────────────────────────────── */
export default function AmenitySpendBarChart({ spendData, onBarClick }) {
  // Aggregate paid revenue and comp value per amenity across all seasons.
  const chartData = useMemo(() => {
    const agg = {};

    (spendData ?? []).forEach((d) => {
      if (!agg[d.amenity]) {
        agg[d.amenity] = {
          amenity: d.amenity,
          revenue: 0,
          free_value: 0,
          total_spend: 0,
        };
      }

      agg[d.amenity].revenue += Number(d.revenue ?? d.total_spend ?? 0);
      agg[d.amenity].free_value += Number(d.free_value ?? 0);
      agg[d.amenity].total_spend += Number(d.total_spend ?? 0);
    });

    return Object.values(agg).sort((a, b) => b.total_spend - a.total_spend);
  }, [spendData]);

  return (
    <div style={{ height: Math.max(220, chartData.length * 36) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 24, right: 24, top: 8, bottom: 26 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#E8DDD0"
            horizontal={false}
          />
          <XAxis
            type="number"
            stroke={C.textMuted}
            fontSize={11}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            label={{
              value: "Paid Revenue + Comp Value (USD)",
              position: "insideBottom",
              offset: -12,
              fill: C.textMuted,
              fontSize: 11,
              fontFamily: "sans-serif",
            }}
          />
          <YAxis
            type="category"
            dataKey="amenity"
            stroke={C.textMuted}
            fontSize={11}
            width={105}
            tick={{ fill: C.textMid }}
            label={{
              value: "Amenity Name",
              angle: -90,
              position: "insideLeft",
              fill: C.textMuted,
              fontSize: 11,
              fontFamily: "sans-serif",
            }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--dashboard-card)",
              border: "1px solid var(--dashboard-border)",
              borderRadius: 8,
              color: "var(--dashboard-abyssal)",
              fontSize: 12,
              fontFamily: "sans-serif",
            }}
            labelStyle={{
              color: "var(--dashboard-abyssal)",
              fontWeight: 700,
            }}
            itemStyle={{
              color: "var(--dashboard-abyssal)",
            }}
            formatter={(v, name) => [
              `$${Number(v).toLocaleString()}`,
              name === "revenue" ? "Paid Revenue" : "Comp Value",
            ]}
          />
          <Bar
            dataKey="revenue"
            stackId="amenitySpend"
            fill={COLOR_PAID}
            cursor="pointer"
            onClick={(d) => d?.amenity && onBarClick && onBarClick(d.amenity)}
          />
          <Bar
            dataKey="free_value"
            stackId="amenitySpend"
            fill={COLOR_FREE}
            radius={[0, 6, 6, 0]}
            cursor="pointer"
            onClick={(d) => d?.amenity && onBarClick && onBarClick(d.amenity)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
