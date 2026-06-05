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

export default function SeasonFilterBar({ seasonalVisits, onSeasonClick }) {
  const [groups, setGroups] = useState([]);
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

  useEffect(() => {
    analyticsApi
      .seasonGroups()
      .then(setGroups)
      .catch(() => {});
  }, []);

  const activeGroup = groups[activeGroupIdx];
  const chartData = activeGroup
    ? aggregateByGroup(seasonalVisits, activeGroup.seasons)
    : [];

  async function toggleSeason(season) {
    const updated = { is_active: !season.is_active };
    await analyticsApi.updateSeason(season.id, updated);
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== activeGroupIdx
          ? g
          : {
              ...g,
              seasons: g.seasons.map((s) =>
                s.id === season.id ? { ...s, ...updated } : s,
              ),
            },
      ),
    );
  }

  async function saveEdit() {
    await analyticsApi.updateSeason(editingSeason.season.id, editForm);
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== activeGroupIdx
          ? g
          : {
              ...g,
              seasons: g.seasons.map((s) =>
                s.id === editingSeason.season.id ? { ...s, ...editForm } : s,
              ),
            },
      ),
    );
    setEditingSeason(null);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const created = await analyticsApi.createSeasonGroup({
      group_name: newGroupName.trim(),
    });
    setGroups((prev) => [...prev, created]);
    setActiveGroupIdx(groups.length);
    setNewGroupName("");
    setShowAddGroup(false);
  }

  async function addSeason() {
    if (!newSeason.season_name.trim() || !activeGroup) return;
    const created = await analyticsApi.addSeason({
      ...newSeason,
      group_id: activeGroup.id,
    });
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== activeGroupIdx
          ? g
          : {
              ...g,
              seasons: [...g.seasons, created],
            },
      ),
    );
    setNewSeason({
      season_name: "",
      start_month: 1,
      start_day: 1,
      end_month: 3,
      end_day: 31,
    });
    setShowAddSeason(false);
  }

  const S = {
    wrap: {
      background: "#FDFAF6",
      border: "1px solid #EDE5D8",
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
      color: "#3D2B1F",
      fontFamily: "sans-serif",
    },
    note: { fontSize: 11, color: "#A08070", fontFamily: "sans-serif" },
    tabRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
    tab: (active) => ({
      padding: "5px 13px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      border: "1.5px solid",
      fontFamily: "sans-serif",
      borderColor: active ? "#3D2B1F" : "#DDD0C4",
      background: active ? "#3D2B1F" : "#FDFAF6",
      color: active ? "#FDFAF6" : "#7A6050",
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
      border: "1.5px dashed #C8976E",
      color: "#C8976E",
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
      border: "1px solid #EDE5D8",
      background: "#FAF6F0",
      color: "#5A3E2B",
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
      color: "#9C7B65",
      fontSize: 11,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    panel: {
      background: "#F4EDE4",
      borderRadius: 10,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    },
    input: {
      flex: 1,
      padding: "6px 10px",
      border: "1px solid #DDD0C4",
      borderRadius: 8,
      fontSize: 12,
      background: "#FDFAF6",
      color: "#3D2B1F",
      outline: "none",
      fontFamily: "sans-serif",
    },
    select: {
      padding: "6px 8px",
      border: "1px solid #DDD0C4",
      borderRadius: 8,
      fontSize: 12,
      background: "#FDFAF6",
      color: "#3D2B1F",
      outline: "none",
    },
    saveBtn: {
      padding: "6px 14px",
      borderRadius: 8,
      border: "none",
      background: "#C8976E",
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "sans-serif",
    },
    cancelBtn: {
      padding: "6px 14px",
      borderRadius: 8,
      border: "1px solid #DDD0C4",
      background: "#FDFAF6",
      color: "#7A6050",
      fontSize: 12,
      cursor: "pointer",
      fontFamily: "sans-serif",
    },
  };

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <p style={S.title}>Seasonal demand</p>
        <span style={S.note}>· click a bar to drill in</span>
      </div>

      {/* Group tabs */}
      <div style={S.tabRow}>
        {groups.map((g, i) => (
          <div
            key={g.id}
            style={S.tab(i === activeGroupIdx)}
            onClick={() => {
              setActiveGroupIdx(i);
              setEditingSeason(null);
              setShowAddGroup(false);
              setShowAddSeason(false);
            }}
          >
            {g.group_name}
            {g.group_type === "custom" && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: 9,
                  padding: "1px 5px",
                  borderRadius: 8,
                  background: "#C8976E22",
                  color: "#C8976E",
                  border: "1px solid #C8976E44",
                }}
              >
                custom
              </span>
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
              <span style={{ fontSize: 10, color: "#A08070", fontWeight: 400 }}>
                {MONTH_NAMES[s.start_month - 1]}–{MONTH_NAMES[s.end_month - 1]}
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
              </span>
            </div>
          ))}
          {activeGroup.group_type === "custom" && (
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
              color: "#3D2B1F",
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
            <span
              style={{ fontSize: 11, color: "#A08070", alignSelf: "center" }}
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
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.saveBtn} onClick={saveEdit}>
              Save
            </button>
            <button style={S.cancelBtn} onClick={() => setEditingSeason(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add season panel (custom groups only) */}
      {showAddSeason && (
        <div style={S.panel}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#3D2B1F",
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
            <span
              style={{ fontSize: 11, color: "#A08070", alignSelf: "center" }}
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
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.saveBtn} onClick={addSeason}>
              Add
            </button>
            <button style={S.cancelBtn} onClick={() => setShowAddSeason(false)}>
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
              color: "#3D2B1F",
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
            <button style={S.cancelBtn} onClick={() => setShowAddGroup(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Chart */}
      <div style={{ height: Math.max(220, 220) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} style={{ cursor: "pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
            <XAxis dataKey="season" stroke="#A08070" fontSize={11} />
            <YAxis stroke="#A08070" fontSize={11} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar
              dataKey="visits"
              fill="#C8976E"
              radius={[6, 6, 0, 0]}
              cursor="pointer"
              onClick={(data) =>
                data?.season &&
                onSeasonClick &&
                onSeasonClick(data.season, activeGroup)
              }
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p
        style={{
          fontSize: 11,
          color: "#A08070",
          fontFamily: "sans-serif",
          margin: 0,
        }}
      >
        Showing <strong>{activeGroup?.group_name ?? "—"}</strong>
        {activeGroup &&
          ` · ${activeGroup.seasons.filter((s) => s.is_active).length} of ${activeGroup.seasons.length} seasons active`}
      </p>
    </div>
  );
}
