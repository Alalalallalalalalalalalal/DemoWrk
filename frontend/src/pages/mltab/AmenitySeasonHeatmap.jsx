// frontend/src/pages/mltab/AmenitySeasonHeatmap.jsx
import { useMemo } from "react";
import {
  C,
  COLOR_PAID,
  COLOR_FREE,
  pill,
  th,
  td,
  amenityColor,
} from "./AmenitySeasonShared";

/* ── AmenitySeasonHeatmap ───────────────────────────────────────── */
export default function AmenitySeasonHeatmap({ data, onCellClick }) {
  const seasons = useMemo(
    () => [...new Set(data.map((d) => d.season))],
    [data],
  );
  const amenities = useMemo(
    () => [...new Set(data.map((d) => d.amenity))],
    [data],
  );

  const lookup = useMemo(() => {
    const m = {};

    data.forEach((d) => {
      const key = `${d.amenity}||${d.season}`;

      if (!m[key]) {
        m[key] = {
          ...d,
          revenue: 0,
          free_value: 0,
          total_spend: 0,
          transaction_count: 0,
        };
      }

      m[key].revenue += Number(d.revenue ?? d.total_spend ?? 0);
      m[key].free_value += Number(d.free_value ?? 0);
      m[key].total_spend += Number(d.total_spend ?? 0);
      m[key].transaction_count += Number(d.transaction_count ?? 0);
    });

    return m;
  }, [data]);

  const maxSpend = useMemo(
    () =>
      Math.max(
        ...Object.values(lookup).map((d) => Number(d.total_spend ?? 0)),
        1,
      ),
    [lookup],
  );

  if (!seasons.length)
    return (
      <p style={{ color: C.textMuted, fontSize: 13, fontFamily: "sans-serif" }}>
        No data available.
      </p>
    );

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontFamily: "sans-serif",
          fontSize: 12,
          width: "100%",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...th,
                background: "transparent",
                border: "none",
                width: 110,
              }}
            >
              {" "}
            </th>
            {seasons.map((s) => (
              <th key={s} style={{ ...th, textAlign: "center", minWidth: 90 }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {amenities.map((amenity) => (
            <tr key={amenity}>
              <td
                style={{
                  ...td,
                  fontWeight: 700,
                  paddingLeft: 4,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span style={pill(amenityColor(amenity))}>{amenity}</span>
              </td>
              {seasons.map((season) => {
                const cell = lookup[`${amenity}||${season}`];
                const intensity = cell ? cell.total_spend / maxSpend : 0;
                const bg = cell
                  ? `rgba(var(--dashboard-deep-blue-rgb), ${0.08 + intensity * 0.55})`
                  : "transparent";
                const paid = Number(cell?.revenue ?? 0);
                const free = Number(cell?.free_value ?? 0);
                const splitTotal = paid + free;
                const paidWidth = splitTotal ? (paid / splitTotal) * 100 : 0;
                const freeWidth = splitTotal ? (free / splitTotal) * 100 : 0;
                return (
                  <td
                    key={season}
                    onClick={() =>
                      cell && onCellClick && onCellClick(amenity, season)
                    }
                    style={{
                      ...td,
                      textAlign: "center",
                      background: bg,
                      cursor: cell ? "pointer" : "default",
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: `1px solid ${C.border}`,
                      transition: "background 0.15s",
                    }}
                    title={
                      cell
                        ? `${amenity} × ${season}: $${Number(cell.total_spend).toLocaleString()}`
                        : "No data"
                    }
                  >
                    {cell ? (
                      <div>
                        <div style={{ fontWeight: 700, color: C.textPrimary }}>
                          ${Number(cell.total_spend / 1000).toFixed(1)}k
                        </div>
                        <div
                          style={{
                            height: 5,
                            borderRadius: 999,
                            overflow: "hidden",
                            display: "flex",
                            background: C.border,
                            margin: "4px auto",
                            maxWidth: 62,
                          }}
                          title={`Paid: $${paid.toLocaleString()} | Comp: $${free.toLocaleString()}`}
                        >
                          <div
                            style={{
                              width: `${paidWidth}%`,
                              background: COLOR_PAID,
                            }}
                          />
                          <div
                            style={{
                              width: `${freeWidth}%`,
                              background: COLOR_FREE,
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>
                          {cell.transaction_count} txn
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: C.textLight }}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        Revenue intensity increases with darker shading. Select any populated
        cell to view the matching member visits, usage count, and spend details
        below.
      </p>
    </div>
  );
}
