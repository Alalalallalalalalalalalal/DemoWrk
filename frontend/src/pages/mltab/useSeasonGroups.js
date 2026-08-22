// frontend/src/pages/mltab/useSeasonGroups.js
// Data-fetching + season-group-state logic extracted from SeasonFilterBar.
import { useState, useEffect } from "react";
import { analyticsApi } from "../../api/analytics";
import {
  createDateFilter,
  toDateParams,
  rowMatchesDateFilter,
  getDateFilterYearsFromRows,
  aggregateByGroup,
} from "./SeasonFilterShared";

export default function useSeasonGroups({
  onSeasonGroupChange,
  onSeasonClick,
} = {}) {
  const [groups, setGroups] = useState([]);
  const [seasonalVisits, setSeasonalVisits] = useState([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const [dateFilter, setDateFilter] = useState(createDateFilter());

  const [selectedSeasonName, setSelectedSeasonName] = useState("");
  const [seasonDetailRows, setSeasonDetailRows] = useState([]);
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [seasonModalLoading, setSeasonModalLoading] = useState(false);
  const [seasonModalError, setSeasonModalError] = useState("");

  useEffect(() => {
    analyticsApi
      .seasonSummary(toDateParams(dateFilter))
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
  }, [onSeasonGroupChange, dateFilter]);

  const activeGroup = groups[activeGroupIdx];
  const dateYears = getDateFilterYearsFromRows(seasonalVisits);
  const filteredSeasonalVisits = seasonalVisits.filter((row) =>
    rowMatchesDateFilter(row, dateFilter),
  );
  const chartData = activeGroup
    ? aggregateByGroup(filteredSeasonalVisits, activeGroup.seasons)
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

  // seasonId / formData replace the component-state closures (`editingSeason`,
  // `editForm`) the original inline version read directly — those now live
  // as UI state in the orchestrator and are passed in explicitly.
  async function saveEdit(seasonId, formData) {
    if (!activeGroup || !seasonId) return;

    const saved = await analyticsApi.updateSeason(seasonId, formData);
    const nextGroup = {
      ...activeGroup,
      seasons: activeGroup.seasons.map((s) =>
        s.id === seasonId ? { ...s, ...saved } : s,
      ),
    };

    setGroups((prev) =>
      prev.map((g, gi) => (gi === activeGroupIdx ? nextGroup : g)),
    );
    onSeasonGroupChange?.(nextGroup);
  }

  // groupName replaces the component-state closure (`newGroupName`) the
  // original inline version read directly. Returns the created group (or
  // undefined if the input was invalid) so the caller can decide whether
  // to reset its form state.
  async function createGroup(groupName) {
    if (!groupName || !groupName.trim()) return undefined;
    const created = await analyticsApi.createSeasonGroup({
      group_name: groupName.trim(),
    });
    setGroups((prev) => {
      setActiveGroupIdx(prev.length);
      onSeasonGroupChange?.(created);
      return [...prev, created];
    });
    return created;
  }

  // seasonData replaces the component-state closure (`newSeason`) the
  // original inline version read directly. Returns the created season (or
  // undefined if the input was invalid) so the caller can decide whether
  // to reset its form state.
  async function addSeason(seasonData) {
    if (!seasonData?.season_name?.trim() || !activeGroup) return undefined;
    const created = await analyticsApi.addSeason({
      ...seasonData,
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
    return created;
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
      const rows = await analyticsApi.seasonMembers(
        data.season_id,
        toDateParams(dateFilter),
      );
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

  function closeSeasonModal() {
    setSeasonModalOpen(false);
    setSelectedSeasonName("");
    setSeasonDetailRows([]);
    setSeasonModalError("");
  }

  return {
    groups,
    activeGroup,
    activeGroupIdx,
    setActiveGroupIdx,
    dateFilter,
    setDateFilter,
    dateYears,
    chartData,
    toggleSeason,
    saveEdit,
    createGroup,
    addSeason,
    deleteSeason,
    deleteGroup,
    selectedSeasonName,
    seasonDetailRows,
    seasonModalOpen,
    seasonModalLoading,
    seasonModalError,
    openSeasonMembers,
    closeSeasonModal,
  };
}
