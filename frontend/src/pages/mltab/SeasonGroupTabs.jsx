// frontend/src/pages/mltab/SeasonGroupTabs.jsx
import { C, S, tint } from "./SeasonFilterShared";

export default function SeasonGroupTabs({
  groups,
  activeGroupIdx,
  onSelectGroup,
  onDeleteGroup,
  onAddGroupClick,
}) {
  return (
    <div style={S.tabRow}>
      {groups.map((g, i) => (
        <div
          key={g.id}
          style={S.tab(i === activeGroupIdx)}
          onClick={() => onSelectGroup(i, g)}
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
                  onDeleteGroup(g);
                }}
              >
                🗑
              </button>
            </>
          )}
        </div>
      ))}
      <button style={S.addGroupBtn} onClick={onAddGroupClick}>
        + Add group
      </button>
    </div>
  );
}
