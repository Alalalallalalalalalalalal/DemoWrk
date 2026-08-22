// frontend/src/pages/mltab/AmenitySeasonPanel.jsx
// ──────────────────────────────────────────
// Full-page analytics panel for Amenity × Season cross-analysis.
// Replaces the old inline amenity adoption + spend charts in the ML tab.
//
// Props
//   data          – { amenitySeasonSpend, memberAmenityProfile,
//                     memberAmenitySeasonVisits, seasonVillaBedroom }
//   onMemberClick – optional callback(member_id) for cross-panel navigation
//   onClose       – optional callback for slide-over mode (pass null for inline)
//
// Orchestrator only: state/handlers for this panel live here, composing the
// extracted pieces below (siblings in this folder) plus the data hook.

import { useState, useMemo, useRef, useEffect } from "react";
import { X } from "lucide-react";
import useAmenitySeasonData from "./useAmenitySeasonData";
import {
  C,
  card,
  select,
  createDateFilter,
  rowMatchesDateFilter,
  getDateFilterYearsFromRows,
  dateFilterLabel,
  getYearOptionsFromRows,
  rowMatchesYear,
  pill,
  amenityColor,
  InsightGuide,
} from "./AmenitySeasonShared";
import { DateFilterControl, YearFilterControl } from "./AmenitySeasonFilters";
import AmenitySeasonHeatmap from "./AmenitySeasonHeatmap";
import AmenitySpendBarChart from "./AmenitySpendBarChart";
import MemberAmenityProfileTable from "./MemberAmenityProfileTable";
import MemberSeasonVisitsTable from "./MemberSeasonVisitsTable";
import SeasonCapacityCards from "./SeasonCapacityCards";
import SummaryStats from "./SummaryStats";

/* ── SectionDivider ─────────────────────────────────────────────── */
function SectionDivider({ children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "28px 0 16px",
      }}
    >
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.textMuted,
          fontFamily: "sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function AmenityRevenueSection({ data, onBarClick }) {
  const [year, setYear] = useState("All");
  const years = useMemo(() => getYearOptionsFromRows(data), [data]);

  useEffect(() => {
    if (!years.includes(year)) setYear("All");
  }, [year, years]);

  const filteredData = useMemo(
    () => data.filter((row) => rowMatchesYear(row, year)),
    [data, year],
  );

  return (
    <div style={card}>
      <InsightGuide
        title="Amenity Revenue Ranking"
        description="Ranks amenities by total revenue generated during the selected year. Use this chart to quickly identify the strongest-performing amenities and compare revenue contribution across amenity categories."
        meta={[
          { label: "X-Axis", value: "Total Revenue (USD)" },
          { label: "Y-Axis", value: "Amenity Name" },
          { label: "Sort Order", value: "Highest to lowest revenue" },
        ]}
        action="Select a bar to filter the visit table by amenity."
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <YearFilterControl value={year} onChange={setYear} years={years} />
      </div>
      <AmenitySpendBarChart
        spendData={filteredData}
        onBarClick={(amenity) => onBarClick(amenity, year)}
      />
    </div>
  );
}
function AmenityHeatmapSection({ data, onCellClick }) {
  const [dateFilter, setDateFilter] = useState(createDateFilter());
  const [season, setSeason] = useState("All");

  const dateYears = useMemo(() => getDateFilterYearsFromRows(data), [data]);

  const dateFilteredData = useMemo(
    () => data.filter((row) => rowMatchesDateFilter(row, dateFilter)),
    [data, dateFilter],
  );

  const seasons = useMemo(
    () => [
      "All",
      ...new Set(dateFilteredData.map((d) => d.season).filter(Boolean)),
    ],
    [dateFilteredData],
  );

  useEffect(() => {
    if (!seasons.includes(season)) setSeason("All");
  }, [season, seasons]);

  const filteredData = useMemo(
    () =>
      season === "All"
        ? dateFilteredData
        : dateFilteredData.filter((row) => row.season === season),
    [dateFilteredData, season],
  );

  // Only ym-mode carries a clean "year" for the drilldown table below;
  // day/range filters still work on the heatmap itself, they just don't
  // pre-seed the visit table's year selector.
  const drillYear = dateFilter.mode === "ym" ? dateFilter.year : "All";

  return (
    <div style={card}>
      <InsightGuide
        title="Amenity Spend Heatmap"
        description="Shows how total amenity revenue changes across business seasons. Each cell represents one amenity during one season, making it easy to spot seasonal demand patterns and high-value amenity periods."
        meta={[
          { label: "Columns", value: "Business Seasons" },
          { label: "Rows", value: "Amenity Names" },
          { label: "Cell Value", value: "Total Revenue (USD)" },
          { label: "Color", value: "Darker shading = higher revenue" },
        ]}
        action="Select a cell to filter the visit table by both season and amenity."
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <DateFilterControl
          value={dateFilter}
          onChange={setDateFilter}
          years={dateYears}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: C.textMuted,
              fontFamily: "sans-serif",
            }}
          >
            Season
          </span>
          <select
            style={select}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All Seasons" : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AmenitySeasonHeatmap
        data={filteredData}
        onCellClick={(amenity, seasonName) =>
          onCellClick(amenity, seasonName, drillYear)
        }
      />
    </div>
  );
}

/* ── Main exported component ─────────────────────────────────────── */
export default function AmenitySeasonPanel({ seasonGroupId = null }) {
  const { data, loading, error } = useAmenitySeasonData(seasonGroupId);

  const [drillAmenity, setDrillAmenity] = useState("");
  const [drillSeason, setDrillSeason] = useState("");
  const [drillYear, setDrillYear] = useState("All");
  const [dateFilter, setDateFilter] = useState(createDateFilter());
  const visitsRef = useRef(null);

  useEffect(() => {
    setDrillAmenity("");
    setDrillSeason("");
    setDrillYear("All");
  }, [seasonGroupId]);

  const {
    amenitySeasonSpend = [],
    memberAmenityProfile = [],
    memberAmenitySeasonVisits = [],
    seasonVillaBedroom = [],
  } = data ?? {};

  const dateYears = useMemo(
    () =>
      getDateFilterYearsFromRows([
        ...amenitySeasonSpend,
        ...memberAmenityProfile,
        ...memberAmenitySeasonVisits,
        ...seasonVillaBedroom,
      ]),
    [
      amenitySeasonSpend,
      memberAmenityProfile,
      memberAmenitySeasonVisits,
      seasonVillaBedroom,
    ],
  );

  const filteredAmenitySeasonSpend = useMemo(
    () =>
      amenitySeasonSpend.filter((row) => rowMatchesDateFilter(row, dateFilter)),
    [amenitySeasonSpend, dateFilter],
  );

  const filteredMemberAmenityProfile = useMemo(
    () =>
      memberAmenityProfile.filter((row) =>
        rowMatchesDateFilter(row, dateFilter),
      ),
    [memberAmenityProfile, dateFilter],
  );

  const filteredMemberAmenitySeasonVisits = useMemo(
    () =>
      memberAmenitySeasonVisits.filter((row) =>
        rowMatchesDateFilter(row, dateFilter),
      ),
    [memberAmenitySeasonVisits, dateFilter],
  );

  const filteredSeasonVillaBedroom = useMemo(
    () =>
      seasonVillaBedroom.filter((row) => rowMatchesDateFilter(row, dateFilter)),
    [seasonVillaBedroom, dateFilter],
  );

  const handleCellClick = (amenity, season, year = "All") => {
    setDrillAmenity(amenity);
    setDrillSeason(season);
    setDrillYear(year || "All");
    setTimeout(
      () =>
        visitsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  const handleBarClick = (amenity, year = "All") => {
    setDrillAmenity(amenity);
    setDrillSeason("");
    setDrillYear(year || "All");
    setTimeout(
      () =>
        visitsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  if (loading)
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: C.textMuted,
          fontFamily: "sans-serif",
        }}
      >
        Loading amenity insights…
      </div>
    );

  if (error)
    return (
      <div
        style={{
          padding: 20,
          color: "#C45B5B",
          fontSize: 13,
          fontFamily: "sans-serif",
        }}
      >
        {error}
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          ...card,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <DateFilterControl
          value={dateFilter}
          onChange={setDateFilter}
          years={dateYears}
          label="Custom Date"
        />
        <span
          style={{ fontSize: 12, color: C.textMuted, fontFamily: "sans-serif" }}
        >
          Showing: {dateFilterLabel(dateFilter)}
        </span>
      </div>

      {/* ── Summary stat row ── */}
      <SummaryStats
        amenitySeasonSpend={filteredAmenitySeasonSpend}
        memberAmenityProfile={filteredMemberAmenityProfile}
      />

      {/* ── Spend by amenity bar ── */}
      <AmenityRevenueSection
        data={filteredAmenitySeasonSpend}
        onBarClick={handleBarClick}
      />

      {/* ── Heatmap ── */}
      <AmenityHeatmapSection
        data={filteredAmenitySeasonSpend}
        onCellClick={handleCellClick}
      />

      <SectionDivider>Member Profiles</SectionDivider>

      {/* ── Member amenity profile table ── */}
      <MemberAmenityProfileTable data={filteredMemberAmenityProfile} />

      <SectionDivider>Visit Details</SectionDivider>

      {/* ── Season visits table (drill-down target) ── */}
      <div ref={visitsRef}>
        {(drillAmenity || drillSeason || drillYear !== "All") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "10px 14px",
              background: C.panelAlt,
              borderRadius: 10,
              border: `1px solid ${C.borderHover}`,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: C.accent,
                fontFamily: "sans-serif",
                fontWeight: 600,
              }}
            >
              Filtered by:
            </span>
            {drillAmenity && (
              <span style={pill(amenityColor(drillAmenity))}>
                {drillAmenity}
              </span>
            )}
            {drillSeason && (
              <span style={{ ...pill("#5B9EAD") }}>{drillSeason}</span>
            )}
            {drillYear !== "All" && (
              <span style={{ ...pill(C.gold) }}>{drillYear}</span>
            )}
            <button
              onClick={() => {
                setDrillAmenity("");
                setDrillSeason("");
                setDrillYear("All");
              }}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.textMuted,
              }}
              title="Clear filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <MemberSeasonVisitsTable
          data={filteredMemberAmenitySeasonVisits}
          initialSeason={drillSeason}
          initialAmenity={drillAmenity}
          initialYear={drillYear}
        />
      </div>

      <SectionDivider>Capacity Planning</SectionDivider>

      {/* ── Villa / bedroom season cards ── */}
      <div style={card}>
        <InsightGuide
          title="Season Villa & Bedroom Summary"
          description="Provides seasonal accommodation performance metrics, including booking volume, average length of stay, member counts, preferred villa selections, and bedroom demand patterns."
          meta={[
            { label: "Card Level", value: "Season and year" },
            {
              label: "Key Metrics",
              value: "Bookings, nights, average stay, and members",
            },
            {
              label: "Expanded View",
              value: "Villa preference and bedroom distribution",
            },
          ]}
          action="Select a season card to expand detailed accommodation demand insights."
        />
        <SeasonCapacityCards data={filteredSeasonVillaBedroom} />
      </div>
    </div>
  );
}
