// frontend/src/pages/mltab/SeasonChips.jsx
import { C, S, formatSeasonRange } from "./SeasonFilterShared";
import SeasonFormPanel from "./SeasonFormPanel";

export default function SeasonChips({
  activeGroup,
  onToggleSeason,
  onEditSeason,
  onDeleteSeason,
  onAddSeasonClick,
  editingSeason,
  editForm,
  onEditFormChange,
  onSaveEdit,
  onCancelEdit,
  showAddSeason,
  newSeason,
  onNewSeasonChange,
  onAddSeason,
  onCancelAddSeason,
}) {
  return (
    <>
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
                  onClick={() => onToggleSeason(s)}
                >
                  {s.is_active ? "◑" : "○"}
                </button>
                <button
                  style={S.chipBtn}
                  title="Edit"
                  onClick={() => onEditSeason(s)}
                >
                  ✎
                </button>
                <button
                  style={S.chipBtn}
                  title="Delete"
                  onClick={() => onDeleteSeason(s)}
                >
                  🗑
                </button>
              </span>
            </div>
          ))}
          {activeGroup.group_type !== "simple" && (
            <button
              style={{ ...S.addGroupBtn, fontSize: 11, padding: "3px 10px" }}
              onClick={onAddSeasonClick}
            >
              + Add season
            </button>
          )}
        </div>
      )}

      {/* Edit season panel */}
      {editingSeason && (
        <SeasonFormPanel
          title={`Edit: ${editingSeason.season.season_name}`}
          values={editForm}
          onChange={onEditFormChange}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
          saveLabel="Save"
        />
      )}

      {/* Add season panel (business/custom groups) */}
      {showAddSeason && (
        <SeasonFormPanel
          title="New season"
          values={newSeason}
          onChange={onNewSeasonChange}
          onSave={onAddSeason}
          onCancel={onCancelAddSeason}
          saveLabel="Add"
        />
      )}
    </>
  );
}
