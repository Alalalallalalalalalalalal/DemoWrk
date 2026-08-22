// frontend/src/pages/mltab/SeasonFormPanel.jsx
// Shared season-field layout (name + start/end month/day selects), used by
// both the "Edit season" and "Add season" panels in SeasonChips.jsx — the
// original file duplicated this field layout almost verbatim between the
// two; this component factors it out with props for whatever differs
// (title text, current values, save label, and the save/cancel handlers).
import { C, S, MONTH_NAMES, DAY_OPTIONS } from "./SeasonFilterShared";

export default function SeasonFormPanel({
  title,
  values,
  onChange,
  onSave,
  onCancel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
}) {
  const update = (patch) => onChange({ ...values, ...patch });

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
        {title}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          style={S.input}
          placeholder="Season name"
          value={values.season_name ?? ""}
          onChange={(e) => update({ season_name: e.target.value })}
        />
        <select
          style={S.select}
          value={values.start_month ?? 1}
          onChange={(e) => update({ start_month: Number(e.target.value) })}
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          style={S.select}
          value={values.start_day ?? 1}
          onChange={(e) => update({ start_day: Number(e.target.value) })}
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
          value={values.end_month ?? 3}
          onChange={(e) => update({ end_month: Number(e.target.value) })}
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          style={S.select}
          value={values.end_day ?? 31}
          onChange={(e) => update({ end_day: Number(e.target.value) })}
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.saveBtn} onClick={onSave}>
          {saveLabel}
        </button>
        <button style={S.cancelBtn} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
