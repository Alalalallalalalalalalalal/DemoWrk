import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { analyticsApi } from "../api/analytics";
import { TOOLTIP_STYLE } from "./Dashboardstyles";
import { X, MapPin } from "lucide-react";
import "./styles.css";

const MONTH_NAMES = [
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

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  rowBorder: "var(--dashboard-row-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  textLight: "var(--dashboard-oatmeal)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
  panelShadow: "var(--dashboard-shadow-panel)",
  overlay: "var(--dashboard-overlay)",
  red: "#C45B5B",
};

const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

function formatSeasonRange(season) {
  return `${MONTH_NAMES[season.start_month - 1]} ${season.start_day}–${
    MONTH_NAMES[season.end_month - 1]
  } ${season.end_day}`;
}

function monthsInRange(startMonth, startDay, endMonth, endDay) {
  const months = new Set();
  // wrap-around ranges (e.g. Dec→Jan)
  if (startMonth <= endMonth) {
    for (let m = startMonth; m <= endMonth; m++) months.add(m);
  } else {
    for (let m = startMonth; m <= 12; m++) months.add(m);
    for (let m = 1; m <= endMonth; m++) months.add(m);
  }
  return months;
}

function aggregateByGroup(seasonalVisits, seasons) {
  // seasons = array of {season_name, start_month, start_day, end_month, end_day, is_active}
  const activeSeasonsFiltered = seasons.filter((s) => s.is_active);
  return activeSeasonsFiltered.map((s) => {
    const months = monthsInRange(
      s.start_month,
      s.start_day,
      s.end_month,
      s.end_day,
    );
    let visits = 0,
      totalStay = 0,
      count = 0;
    seasonalVisits.forEach((row) => {
      const m = Number(String(row.month).split("-")[1]);
      if (months.has(m)) {
        visits += Number(row.visits ?? 0);
        totalStay += Number(row.avg_stay ?? 0);
        count++;
      }
    });
    return {
      season: s.season_name,
      season_id: s.id,
      visits,
      avg_stay: count ? Number((totalStay / count).toFixed(1)) : 0,
    };
  });
}

function InsightGuide({ title, description, meta = [], action }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: C.textPrimary,
            fontFamily: "sans-serif",
          }}
        >
          {title}
        </p>
        {action && (
          <span
            style={{
              padding: "4px 9px",
              borderRadius: 999,
              background: C.panelAlt,
              border: `1px solid ${tint(C.accent, 32)}`,
              color: C.accent,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "sans-serif",
            }}
          >
            {action}
          </span>
        )}
      </div>

      <p
        style={{
          margin: "6px 0 10px",
          fontSize: 12,
          lineHeight: 1.55,
          color: C.textMuted,
          fontFamily: "sans-serif",
          maxWidth: 980,
        }}
      >
        {description}
      </p>

      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {meta.map((m) => (
            <span
              key={`${m.label}-${m.value}`}
              style={{
                padding: "5px 9px",
                borderRadius: 999,
                background: C.panelAlt,
                border: `1px solid ${C.border}`,
                fontSize: 11,
                color: C.textMid,
                fontFamily: "sans-serif",
              }}
            >
              <strong>{m.label}:</strong> {m.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SeasonFilterBar({
  onSeasonClick,
  onSeasonGroupChange,
}) {
  const [groups, setGroups] = useState([]);
  const [seasonalVisits, setSeasonalVisits] = useState([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const [editingSeason, setEditingSeason] = useState(null); // {season, groupIdx}
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showAddSeason, setShowAddSeason] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newSeason, setNewSeason] = useState({
    season_name: "",
    start_month: 1,
    start_day: 1,
    end_month: 3,
    end_day: 31,
  });
  const [editForm, setEditForm] = useState({});

  const [selectedSeasonName, setSelectedSeasonName] = useState("");
  const [seasonDetailRows, setSeasonDetailRows] = useState([]);
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [seasonModalLoading, setSeasonModalLoading] = useState(false);
  const [seasonModalError, setSeasonModalError] = useState("");

  useEffect(() => {
    analyticsApi
      .seasonSummary()
      .then((data) => {
        const visibleGroups = (data?.seasonGroups ?? []).filter(
          (group) => group.group_type !== "simple",
        );

        setGroups(visibleGroups);
        setSeasonalVisits(data?.seasonalVisits ?? []);
        setActiveGroupIdx(0);
        onSeasonGroupChange?.(visibleGroups[0] ?? null);
      })
      .catch(() => {});
  }, [onSeasonGroupChange]);

  const activeGroup = groups[activeGroupIdx];
  const chartData = activeGroup
    ? aggregateByGroup(seasonalVisits, activeGroup.seasons)
    : [];

  async function toggleSeason(season) {
    if (!activeGroup) return;

    const saved = await analyticsApi.updateSeason(season.id, {
      is_active: !season.is_active,
    });
    const nextGroup = {
      ...activeGroup,
      seasons: activeGroup.seasons.map((s) =>
        s.id === season.id ? { ...s, ...saved } : s,
      ),
    };

    setGroups((prev) =>
      prev.map((g, gi) => (gi === activeGroupIdx ? nextGroup : g)),
    );
    onSeasonGroupChange?.(nextGroup);
  }

  async function saveEdit() {
    if (!activeGroup || !editingSeason) return;

    const saved = await analyticsApi.updateSeason(
      editingSeason.season.id,
      editForm,
    );
    const nextGroup = {
      ...activeGroup,
      seasons: activeGroup.seasons.map((s) =>
        s.id === editingSeason.season.id ? { ...s, ...saved } : s,
      ),
    };

    setGroups((prev) =>
      prev.map((g, gi) => (gi === activeGroupIdx ? nextGroup : g)),
    );
    onSeasonGroupChange?.(nextGroup);
    setEditingSeason(null);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const created = await analyticsApi.createSeasonGroup({
      group_name: newGroupName.trim(),
    });
    setGroups((prev) => {
      setActiveGroupIdx(prev.length);
      onSeasonGroupChange?.(created);
      return [...prev, created];
    });
    setNewGroupName("");
    setShowAddGroup(false);
  }

  async function addSeason() {
    if (!newSeason.season_name.trim() || !activeGroup) return;
    const created = await analyticsApi.addSeason({
      ...newSeason,
      group_id: activeGroup.id,
    });
    const nextGroup = {
      ...activeGroup,
      seasons: [...activeGroup.seasons, created],
    };

    setGroups((prev) =>
      prev.map((g, gi) => (gi === activeGroupIdx ? nextGroup : g)),
    );
    onSeasonGroupChange?.(nextGroup);
    setNewSeason({
      season_name: "",
      start_month: 1,
      start_day: 1,
      end_month: 3,
      end_day: 31,
    });
    setShowAddSeason(false);
  }

  async function openSeasonMembers(data) {
    if (!data?.season_id) {
      setSelectedSeasonName(data?.season ?? "Season");
      setSeasonDetailRows([]);
      setSeasonModalError("Missing season id for this bar.");
      setSeasonModalOpen(true);
      return;
    }

    setSelectedSeasonName(data.season ?? "");
    setSeasonDetailRows([]);
    setSeasonModalError("");
    setSeasonModalOpen(true);
    setSeasonModalLoading(true);

    try {
      const rows = await analyticsApi.seasonMembers(data.season_id);
      setSeasonDetailRows(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Failed to load season member details:", error);
      setSeasonModalError(
        "Unable to load members for this season. Check /analytics/seasons/{season_id}/members.",
      );
    } finally {
      setSeasonModalLoading(false);
    }

    if (onSeasonClick) {
      onSeasonClick(data.season, activeGroup, {
        season_id: data.season_id ?? null,
      });
    }
  }

  async function deleteSeason(season) {
    if (!window.confirm(`Delete ${season.season_name}?`)) return;

    await analyticsApi.deleteSeason(season.id);

    const nextGroup = {
      ...activeGroup,
      seasons: activeGroup.seasons.filter((s) => s.id !== season.id),
    };

    setGroups((prev) =>
      prev.map((g, gi) => (gi === activeGroupIdx ? nextGroup : g)),
    );

    onSeasonGroupChange?.(nextGroup);
  }

  async function deleteGroup(group) {
    if (group.group_type !== "custom") return;
    if (!window.confirm(`Delete group ${group.group_name}?`)) return;

    await analyticsApi.deleteSeasonGroup(group.id);

    const nextGroups = groups.filter((g) => g.id !== group.id);
    setGroups(nextGroups);
    setActiveGroupIdx(0);
    onSeasonGroupChange?.(nextGroups[0] ?? null);
  }

  const S = {
    wrap: {
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: "18px 20px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    },
    header: { display: "flex", alignItems: "center", gap: 6 },
    title: {
      margin: 0,
      fontSize: 13,
      fontWeight: 700,
      color: C.textPrimary,
      fontFamily: "sans-serif",
    },
    note: { fontSize: 11, color: C.textMuted, fontFamily: "sans-serif" },
    tabRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
    tab: (active) => ({
      padding: "5px 13px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      border: "1.5px solid",
      fontFamily: "sans-serif",
      borderColor: active ? C.accent : C.border,
      background: active ? C.accent : C.bg,
      color: active ? C.bg : C.textMid,
    }),
    addGroupBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "5px 12px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      border: `1.5px dashed ${C.accent2}`,
      color: C.accent,
      background: "transparent",
      fontFamily: "sans-serif",
    },
    chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
    chip: (enabled) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 10px 3px 12px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      border: `1px solid ${C.border}`,
      background: C.panel,
      color: C.textMid,
      fontFamily: "sans-serif",
      opacity: enabled ? 1 : 0.4,
    }),
    chipBtn: {
      width: 18,
      height: 18,
      borderRadius: "50%",
      border: "none",
      cursor: "pointer",
      background: "transparent",
      color: C.textMuted,
      fontSize: 11,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    panel: {
      background: C.panelAlt,
      borderRadius: 10,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    },
    input: {
      flex: 1,
      padding: "6px 10px",
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      fontSize: 12,
      background: C.bg,
      color: C.textPrimary,
      outline: "none",
      fontFamily: "sans-serif",
    },
    select: {
      padding: "6px 8px",
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      fontSize: 12,
      background: C.bg,
      color: C.textPrimary,
      outline: "none",
    },
    saveBtn: {
      padding: "6px 14px",
      borderRadius: 8,
      border: "none",
      background: C.accent,
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "sans-serif",
    },
    cancelBtn: {
      padding: "6px 14px",
      borderRadius: 8,
      border: `1px solid ${C.border}`,
      background: C.bg,
      color: C.textMid,
      fontSize: 12,
      cursor: "pointer",
      fontFamily: "sans-serif",
    },
  };

  return (
    <>
      <div style={S.wrap}>
        <div style={S.header}>
          <InsightGuide
            title="Seasonal Demand"
            description="Shows total member visits across the active seasons in the selected season group. You can add, edit, disable, or delete seasons, and the chart updates to reflect the active seasonal definitions. Custom season groups let you create alternative business-season views without changing the existing drill-down workflow."
            meta={[
              { label: "X-Axis", value: "Season Name" },
              { label: "Y-Axis", value: "Total Visits" },
              {
                label: "Season Chips",
                value: "Enable, disable, edit, or delete seasons",
              },
              {
                label: "Custom Groups",
                value: "Create alternate season definitions",
              },
            ]}
            action="Select a bar to view visiting members"
          />
        </div>
        {/* Group tabs */}
        <div style={S.tabRow}>
          {groups.map((g, i) => (
            <div
              key={g.id}
              style={S.tab(i === activeGroupIdx)}
              onClick={() => {
                setActiveGroupIdx(i);
                onSeasonGroupChange?.(g);
                setEditingSeason(null);
                setShowAddGroup(false);
                setShowAddSeason(false);
              }}
            >
              {g.group_name}
              {g.group_type === "custom" && (
                <>
                  <span
                    style={{
                      marginLeft: 5,
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 8,
                      background: tint(C.accent, 14),
                      color: C.accent,
                      border: `1px solid ${tint(C.accent, 32)}`,
                    }}
                  >
                    custom
                  </span>

                  <button
                    type="button"
                    style={{
                      marginLeft: 6,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: C.red,
                    }}
                    title="Delete group"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteGroup(g);
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          <button
            style={S.addGroupBtn}
            onClick={() => {
              setShowAddGroup((v) => !v);
              setShowAddSeason(false);
              setEditingSeason(null);
            }}
          >
            + Add group
          </button>
        </div>

        {/* Season chips */}
        {activeGroup && (
          <div style={S.chipRow}>
            {activeGroup.seasons.map((s) => (
              <div key={s.id} style={S.chip(s.is_active)}>
                <span>{s.season_name}</span>
                <span
                  style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}
                >
                  {formatSeasonRange(s)}
                </span>
                <span style={{ display: "flex", gap: 2, marginLeft: 2 }}>
                  <button
                    style={S.chipBtn}
                    title={s.is_active ? "Disable" : "Enable"}
                    onClick={() => toggleSeason(s)}
                  >
                    {s.is_active ? "◑" : "○"}
                  </button>
                  <button
                    style={S.chipBtn}
                    title="Edit"
                    onClick={() => {
                      setEditingSeason({ season: s });
                      setEditForm({
                        season_name: s.season_name,
                        start_month: s.start_month,
                        start_day: s.start_day,
                        end_month: s.end_month,
                        end_day: s.end_day,
                      });
                      setShowAddGroup(false);
                      setShowAddSeason(false);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    style={S.chipBtn}
                    title="Delete"
                    onClick={() => deleteSeason(s)}
                  >
                    🗑
                  </button>
                </span>
              </div>
            ))}
            {activeGroup.group_type !== "simple" && (
              <button
                style={{ ...S.addGroupBtn, fontSize: 11, padding: "3px 10px" }}
                onClick={() => {
                  setShowAddSeason((v) => !v);
                  setEditingSeason(null);
                  setShowAddGroup(false);
                }}
              >
                + Add season
              </button>
            )}
          </div>
        )}

        {/* Edit season panel */}
        {editingSeason && (
          <div style={S.panel}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.textPrimary,
                margin: "0 0 4px",
                fontFamily: "sans-serif",
              }}
            >
              Edit: {editingSeason.season.season_name}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={S.input}
                placeholder="Season name"
                value={editForm.season_name ?? ""}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, season_name: e.target.value }))
                }
              />
              <select
                style={S.select}
                value={editForm.start_month ?? 1}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    start_month: Number(e.target.value),
                  }))
                }
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                style={S.select}
                value={editForm.start_day ?? 1}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    start_day: Number(e.target.value),
                  }))
                }
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span
                style={{
                  fontSize: 11,
                  color: C.textMuted,
                  alignSelf: "center",
                }}
              >
                →
              </span>
              <select
                style={S.select}
                value={editForm.end_month ?? 3}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    end_month: Number(e.target.value),
                  }))
                }
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                style={S.select}
                value={editForm.end_day ?? 31}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    end_day: Number(e.target.value),
                  }))
                }
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.saveBtn} onClick={saveEdit}>
                Save
              </button>
              <button
                style={S.cancelBtn}
                onClick={() => setEditingSeason(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add season panel (business/custom groups) */}
        {showAddSeason && (
          <div style={S.panel}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.textPrimary,
                margin: "0 0 4px",
                fontFamily: "sans-serif",
              }}
            >
              New season
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={S.input}
                placeholder="Season name"
                value={newSeason.season_name}
                onChange={(e) =>
                  setNewSeason((s) => ({ ...s, season_name: e.target.value }))
                }
              />
              <select
                style={S.select}
                value={newSeason.start_month}
                onChange={(e) =>
                  setNewSeason((s) => ({
                    ...s,
                    start_month: Number(e.target.value),
                  }))
                }
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                style={S.select}
                value={newSeason.start_day}
                onChange={(e) =>
                  setNewSeason((s) => ({
                    ...s,
                    start_day: Number(e.target.value),
                  }))
                }
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span
                style={{
                  fontSize: 11,
                  color: C.textMuted,
                  alignSelf: "center",
                }}
              >
                →
              </span>
              <select
                style={S.select}
                value={newSeason.end_month}
                onChange={(e) =>
                  setNewSeason((s) => ({
                    ...s,
                    end_month: Number(e.target.value),
                  }))
                }
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                style={S.select}
                value={newSeason.end_day}
                onChange={(e) =>
                  setNewSeason((s) => ({
                    ...s,
                    end_day: Number(e.target.value),
                  }))
                }
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.saveBtn} onClick={addSeason}>
                Add
              </button>
              <button
                style={S.cancelBtn}
                onClick={() => setShowAddSeason(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add group panel */}
        {showAddGroup && (
          <div style={S.panel}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.textPrimary,
                margin: "0 0 4px",
                fontFamily: "sans-serif",
              }}
            >
              New season group
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={S.input}
                placeholder="Group name (e.g. Peak Periods)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createGroup()}
              />
              <button style={S.saveBtn} onClick={createGroup}>
                Create
              </button>
              <button
                style={S.cancelBtn}
                onClick={() => setShowAddGroup(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Chart */}
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
                onClick={(data) => openSeasonMembers(data)}
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
      </div>

      {seasonModalOpen && (
        <SeasonDetailPanel
          season={selectedSeasonName}
          rows={seasonModalError ? [] : seasonDetailRows}
          memberAmenityUsage={[]}
          onClose={() => {
            setSeasonModalOpen(false);
            setSelectedSeasonName("");
            setSeasonDetailRows([]);
            setSeasonModalError("");
          }}
        />
      )}

      {seasonModalOpen && (seasonModalLoading || seasonModalError) && (
        <div
          style={{
            position: "fixed",
            right: 34,
            top: 86,
            zIndex: 1200,
            padding: "10px 14px",
            borderRadius: 10,
            background: seasonModalError ? "#FFF4F4" : "#FFFDF9",
            border: `1px solid ${C.border}`,
            color: seasonModalError ? C.red : "var(--dashboard-text-soft)",
            fontSize: 12,
            fontFamily: "sans-serif",
            boxShadow: "0 8px 22px rgba(61,43,31,0.12)",
          }}
        >
          {seasonModalError || "Loading season members..."}
        </div>
      )}
    </>
  );
}

function getDateParts(value) {
  if (!value) return {};
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return {};
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function getMemberNumber(row) {
  return row?.member_number ?? row?.member_id ?? row?.id ?? null;
}

function getMemberName(row) {
  return (
    row?.member_full_name ??
    row?.member_name ??
    row?.full_name ??
    row?.name ??
    null
  );
}

const MODAL = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(30,18,10,0.55)",
    zIndex: 1000,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  panel: {
    width: "min(1180px, 98vw)",
    height: "100vh",
    background: C.bg,
    display: "flex",
    flexDirection: "column",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
    overflow: "hidden",
  },
  header: {
    padding: "24px 34px 20px",
    borderBottom: "1px solid var(--dashboard-border)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    position: "sticky",
    top: 0,
    background: C.bg,
    zIndex: 10,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: C.textPrimary,
    fontFamily: "sans-serif",
  },
  sub: {
    margin: "4px 0 0",
    fontSize: 12,
    color: C.textMuted,
    fontFamily: "sans-serif",
  },
  closeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: `1px solid ${C.border}`,
    background: "transparent",
    cursor: "pointer",
    color: "var(--dashboard-text-soft)",
    flexShrink: 0,
  },
  body: {
    padding: "22px 34px 42px",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  filterInput: {
    padding: "7px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "sans-serif",
    background: C.bg,
    color: C.textPrimary,
    outline: "none",
    width: 260,
  },
  count: {
    fontSize: 12,
    color: C.textMuted,
    fontFamily: "sans-serif",
    marginLeft: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "sans-serif",
    fontSize: 13,
  },
  th: {
    padding: "12px 14px",
    background: C.panelAlt,
    color: "var(--dashboard-text-soft)",
    fontWeight: 700,
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: "1px solid var(--dashboard-border)",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--dashboard-row-border)",
    color: C.textPrimary,
    verticalAlign: "top",
  },
};

function SeasonDetailPanel({ season, rows = [], onClose }) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState({
    year: "",
    month: "",
    day: "",
  });

  const years = Array.from(
    new Set(
      rows.map((r) => getDateParts(r.check_in_date).year).filter(Boolean),
    ),
  ).sort((a, b) => b - a);

  const filtered = rows.filter((r) => {
    const parts = getDateParts(r.check_in_date);

    if (dateFilter.year && parts.year !== Number(dateFilter.year)) return false;
    if (dateFilter.month && parts.month !== Number(dateFilter.month))
      return false;
    if (dateFilter.day && parts.day !== Number(dateFilter.day)) return false;

    if (!search) return true;
    const q = search.toLowerCase();
    return [
      getMemberName(r),
      getMemberNumber(r),
      r.country,
      r.member_type,
      r.room_type,
    ].some((v) => v && String(v).toLowerCase().includes(q));
  });

  return (
    <div
      style={MODAL.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={MODAL.panel}>
        <div style={MODAL.header}>
          <div>
            <p style={MODAL.title}>{season || "Season"} — Member Visits</p>
            <p style={MODAL.sub}>
              Detailed member visit records for the selected season. Use the
              filters below to narrow results by member, country, room, year,
              month, or day.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 10,
              }}
            >
              {[
                { label: "Table Rows", value: "Individual member stays" },
                { label: "Date Fields", value: "Check-in and check-out" },
                { label: "Search", value: "Name, ID, country, type, or room" },
              ].map((m) => (
                <span
                  key={m.label}
                  style={{
                    padding: "5px 9px",
                    borderRadius: 999,
                    background: C.panelAlt,
                    border: `1px solid ${C.border}`,
                    fontSize: 11,
                    color: C.textMid,
                    fontFamily: "sans-serif",
                  }}
                >
                  <strong>{m.label}:</strong> {m.value}
                </span>
              ))}
            </div>
          </div>
          <button type="button" style={MODAL.closeBtn} onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div style={MODAL.body}>
          <div style={MODAL.filterRow}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ID, country, room…"
              style={MODAL.filterInput}
            />

            <select
              value={dateFilter.year}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, year: e.target.value }))
              }
              style={{ ...MODAL.filterInput, width: 110 }}
            >
              <option value="">Any year</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={dateFilter.month}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, month: e.target.value }))
              }
              style={{ ...MODAL.filterInput, width: 120 }}
            >
              <option value="">Any month</option>
              {MONTH_NAMES.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>

            <select
              value={dateFilter.day}
              onChange={(e) =>
                setDateFilter((f) => ({ ...f, day: e.target.value }))
              }
              style={{ ...MODAL.filterInput, width: 100 }}
            >
              <option value="">Any day</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>

            <button
              type="button"
              style={{
                padding: "7px 12px",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: C.bg,
                color: C.textMid,
                fontSize: 12,
                fontFamily: "sans-serif",
                cursor: "pointer",
              }}
              onClick={() => setDateFilter({ year: "", month: "", day: "" })}
            >
              Clear dates
            </button>

            <span style={MODAL.count}>{filtered.length} records</span>
          </div>

          <div
            style={{
              overflow: "auto",
              maxHeight: "calc(100vh - 290px)",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
            }}
          >
            <table style={MODAL.table}>
              <thead>
                <tr>
                  {[
                    "Member Name",
                    "Member ID",
                    "Member Type",
                    "Age",
                    "Country",
                    "Check-In Date",
                    "Check-Out Date",
                    "Stay Length",
                    "Room Type",
                  ].map((h) => (
                    <th key={h} style={MODAL.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        ...MODAL.td,
                        textAlign: "center",
                        color: "#B09880",
                        padding: 40,
                      }}
                    >
                      No records found
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr
                      key={i}
                      style={{
                        background:
                          i % 2 === 0
                            ? "transparent"
                            : "var(--dashboard-panel)",
                      }}
                    >
                      <td style={{ ...MODAL.td, fontWeight: 600 }}>
                        {getMemberName(r) ?? "—"}
                      </td>
                      <td
                        style={{
                          ...MODAL.td,
                          color: C.textMuted,
                          fontSize: 11,
                        }}
                      >
                        {getMemberNumber(r) ?? "—"}
                      </td>
                      <td style={MODAL.td}>{r.member_type ?? "—"}</td>
                      <td style={{ ...MODAL.td, textAlign: "center" }}>
                        {r.age ?? "—"}
                      </td>
                      <td style={MODAL.td}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <MapPin size={10} color="#B09880" />
                          {r.country ?? "—"}
                        </span>
                      </td>
                      <td style={MODAL.td}>{r.check_in_date ?? "—"}</td>
                      <td style={MODAL.td}>{r.check_out_date ?? "—"}</td>
                      <td style={{ ...MODAL.td, textAlign: "center" }}>
                        {r.length_of_stay != null
                          ? `${r.length_of_stay}n`
                          : "—"}
                      </td>
                      <td style={MODAL.td}>{r.room_type ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
