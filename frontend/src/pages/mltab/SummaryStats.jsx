// frontend/src/pages/mltab/SummaryStats.jsx
import { useState, useMemo, useEffect } from "react";
import { TrendingUp, Users } from "lucide-react";
import {
  C,
  card,
  tint,
  amenityColor,
  getYearOptionsFromRows,
  rowMatchesYear,
} from "./AmenitySeasonShared";
import { YearFilterControl } from "./AmenitySeasonFilters";

/* ── StatMini ───────────────────────────────────────────────────── */
function StatMini({ icon: Icon, label, value, color = C.accent }) {
  return (
    <div
      style={{
        ...card,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: tint(color, 12),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={16} color={color} />
      </div>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: C.textMuted,
            fontFamily: "sans-serif",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 700,
            color: C.textPrimary,
            fontFamily: "sans-serif",
          }}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export default function SummaryStats({
  amenitySeasonSpend,
  memberAmenityProfile,
}) {
  const [year, setYear] = useState("All");
  const years = useMemo(
    () =>
      getYearOptionsFromRows([...amenitySeasonSpend, ...memberAmenityProfile]),
    [amenitySeasonSpend, memberAmenityProfile],
  );

  useEffect(() => {
    if (!years.includes(year)) setYear("All");
  }, [year, years]);

  const filteredAmenitySeasonSpend = useMemo(
    () => amenitySeasonSpend.filter((row) => rowMatchesYear(row, year)),
    [amenitySeasonSpend, year],
  );

  const filteredMemberAmenityProfile = useMemo(
    () => memberAmenityProfile.filter((row) => rowMatchesYear(row, year)),
    [memberAmenityProfile, year],
  );

  const totalAmenitySpend = useMemo(
    () => filteredAmenitySeasonSpend.reduce((s, d) => s + d.total_spend, 0),
    [filteredAmenitySeasonSpend],
  );

  const totalTxns = useMemo(
    () =>
      filteredAmenitySeasonSpend.reduce((s, d) => s + d.transaction_count, 0),
    [filteredAmenitySeasonSpend],
  );

  const uniqueMembers = useMemo(
    () => new Set(filteredMemberAmenityProfile.map((m) => m.member_id)).size,
    [filteredMemberAmenityProfile],
  );

  const topAmenity = useMemo(() => {
    if (!filteredAmenitySeasonSpend.length) return "—";
    const agg = {};
    filteredAmenitySeasonSpend.forEach((d) => {
      agg[d.amenity] = (agg[d.amenity] ?? 0) + d.total_spend;
    });
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  }, [filteredAmenitySeasonSpend]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <YearFilterControl value={year} onChange={setYear} years={years} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          gap: 12,
        }}
      >
        <StatMini
          icon={TrendingUp}
          label="Total Amenity Revenue"
          color={C.accent}
          value={`$${Number(totalAmenitySpend).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <StatMini
          icon={Users}
          label="Members Using Amenities"
          color={C.teal}
          value={uniqueMembers.toLocaleString()}
        />
        <StatMini
          icon={TrendingUp}
          label="Transactions"
          color={C.gold}
          value={totalTxns.toLocaleString()}
        />
        <StatMini
          icon={TrendingUp}
          label="Top Earning Amenity"
          color={amenityColor(topAmenity)}
          value={topAmenity}
        />
      </div>
    </div>
  );
}
