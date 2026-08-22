import { useState } from "react";
import useSeasonGroups from "./useSeasonGroups";
import SeasonGroupTabs from "./SeasonGroupTabs";
import SeasonChips from "./SeasonChips";
import AddGroupPanel from "./AddGroupPanel";
import SeasonDemandChart from "./SeasonDemandChart";
import SeasonDetailPanel from "./SeasonDetailPanel";
import {
  C,
  S,
  InsightGuide,
  DateFilterBar,
  dateFilterLabel,
} from "./SeasonFilterShared";

export default function SeasonFilterBar({
  onSeasonClick,
  onSeasonGroupChange,
}) {
  const {
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
  } = useSeasonGroups({ onSeasonGroupChange, onSeasonClick });

  const [editingSeason, setEditingSeason] = useState(null); // {season}
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

  function handleSelectGroup(i, g) {
    setActiveGroupIdx(i);
    onSeasonGroupChange?.(g);
    setEditingSeason(null);
    setShowAddGroup(false);
    setShowAddSeason(false);
  }

  function handleAddGroupClick() {
    setShowAddGroup((v) => !v);
    setShowAddSeason(false);
    setEditingSeason(null);
  }

  function handleEditSeason(season) {
    setEditingSeason({ season });
    setEditForm({
      season_name: season.season_name,
      start_month: season.start_month,
      start_day: season.start_day,
      end_month: season.end_month,
      end_day: season.end_day,
    });
    setShowAddGroup(false);
    setShowAddSeason(false);
  }

  function handleAddSeasonClick() {
    setShowAddSeason((v) => !v);
    setEditingSeason(null);
    setShowAddGroup(false);
  }

  async function handleSaveEdit() {
    if (!editingSeason) return;
    await saveEdit(editingSeason.season.id, editForm);
    setEditingSeason(null);
  }

  async function handleCreateGroup() {
    const created = await createGroup(newGroupName);
    if (!created) return;
    setNewGroupName("");
    setShowAddGroup(false);
  }

  async function handleAddSeason() {
    const created = await addSeason(newSeason);
    if (!created) return;
    setNewSeason({
      season_name: "",
      start_month: 1,
      start_day: 1,
      end_month: 3,
      end_day: 31,
    });
    setShowAddSeason(false);
  }

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <DateFilterBar
            value={dateFilter}
            onChange={setDateFilter}
            years={dateYears}
          />
          <span style={S.note}>Showing: {dateFilterLabel(dateFilter)}</span>
        </div>

        <SeasonGroupTabs
          groups={groups}
          activeGroupIdx={activeGroupIdx}
          onSelectGroup={handleSelectGroup}
          onDeleteGroup={deleteGroup}
          onAddGroupClick={handleAddGroupClick}
        />

        <SeasonChips
          activeGroup={activeGroup}
          onToggleSeason={toggleSeason}
          onEditSeason={handleEditSeason}
          onDeleteSeason={deleteSeason}
          onAddSeasonClick={handleAddSeasonClick}
          editingSeason={editingSeason}
          editForm={editForm}
          onEditFormChange={setEditForm}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setEditingSeason(null)}
          showAddSeason={showAddSeason}
          newSeason={newSeason}
          onNewSeasonChange={setNewSeason}
          onAddSeason={handleAddSeason}
          onCancelAddSeason={() => setShowAddSeason(false)}
        />

        {/* Add group panel */}
        {showAddGroup && (
          <AddGroupPanel
            value={newGroupName}
            onChange={setNewGroupName}
            onCreate={handleCreateGroup}
            onCancel={() => setShowAddGroup(false)}
          />
        )}

        <SeasonDemandChart
          chartData={chartData}
          activeGroup={activeGroup}
          onBarClick={openSeasonMembers}
        />
      </div>

      {seasonModalOpen && (
        <SeasonDetailPanel
          season={selectedSeasonName}
          rows={seasonModalError ? [] : seasonDetailRows}
          memberAmenityUsage={[]}
          onClose={closeSeasonModal}
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
