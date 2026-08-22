// frontend/src/pages/mltab/AddGroupPanel.jsx
import { C, S } from "./SeasonFilterShared";

export default function AddGroupPanel({ value, onChange, onCreate, onCancel }) {
  return (
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
        />
        <button style={S.saveBtn} onClick={onCreate}>
          Create
        </button>
        <button style={S.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
