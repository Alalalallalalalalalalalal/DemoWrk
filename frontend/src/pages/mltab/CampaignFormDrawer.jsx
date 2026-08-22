// frontend/src/pages/mltab/CampaignFormDrawer.jsx
import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { C, card, ActionButton } from "./MarketingTargetingShared";

const FIELD_OPTIONS = [
  { value: "lifetime_spend", label: "Lifetime Spend", type: "number" },
  { value: "paid_revenue", label: "Paid Revenue", type: "number" },
  { value: "free_value", label: "Complimentary Value", type: "number" },
  { value: "total_visits", label: "Number of Visits", type: "number" },
  { value: "total_nights", label: "Number of Nights", type: "number" },
  {
    value: "preferred_villa_visits",
    label: "Preferred Villa Visits",
    type: "number",
  },
  {
    value: "preferred_amenity_visits",
    label: "Preferred Amenity Uses",
    type: "number",
  },
  {
    value: "preferred_season_visits",
    label: "Preferred Season Visits",
    type: "number",
  },
  { value: "last_visit", label: "Last Visit", type: "date" },
  { value: "first_visit", label: "First Visit", type: "date" },
  { value: "date_of_birth", label: "Birthday", type: "date" },
  { value: "preferred_villa", label: "Preferred Villa", type: "text" },
  { value: "preferred_amenity", label: "Preferred Amenity", type: "text" },
  { value: "preferred_season", label: "Preferred Season", type: "text" },
  { value: "business_source", label: "Business Source", type: "text" },
  { value: "country", label: "Country", type: "text" },
  { value: "state", label: "State", type: "text" },
  { value: "city", label: "City", type: "text" },
  { value: "email", label: "Email", type: "text" },
];

const TEXT_OPERATORS = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_known", label: "is known" },
  { value: "is_unknown", label: "is blank" },
];

const NUMBER_OPERATORS = [
  { value: ">=", label: "is at least" },
  { value: ">", label: "is greater than" },
  { value: "<=", label: "is at most" },
  { value: "<", label: "is less than" },
  { value: "=", label: "equals" },
  { value: "!=", label: "does not equal" },
  { value: "between", label: "is between" },
];

const DATE_OPERATORS = [
  { value: "more_than_months_ago", label: "more than months ago" },
  { value: "within_last_months", label: "within last months" },
  { value: "before", label: "before date" },
  { value: "after", label: "after date" },
  { value: "next_month", label: "is next month" },
  { value: "this_month", label: "is this month" },
  { value: "is_known", label: "is known" },
  { value: "is_unknown", label: "is blank" },
];

const REASON_TEMPLATES = [
  { value: "auto", label: "Simple match reason" },
  { value: "win_back", label: "Win-back / last visit" },
  { value: "high_value", label: "High lifetime spend" },
  { value: "villa", label: "Preferred villa" },
  { value: "amenity", label: "Preferred amenity" },
  { value: "birthday", label: "Birthday" },
  { value: "custom", label: "Custom campaign match" },
];

const CAMPAIGN_TEMPLATES = [
  {
    key: "blank",
    label: "Blank Campaign",
    form: {
      title: "",
      category: "Custom",
      description: "Build a custom audience using the dropdown rules below.",
      rules: [
        { field: "total_visits", operator: ">=", value: "1", value2: "" },
      ],
      sort_field: "lifetime_spend",
      sort_direction: "DESC",
      reason_template: "auto",
    },
  },
  {
    key: "win_back",
    label: "Win Back",
    form: {
      title: "Win Back Campaign",
      category: "Win Back",
      description:
        "Members who have not visited recently and may respond to a return offer.",
      rules: [
        {
          field: "last_visit",
          operator: "more_than_months_ago",
          value: "18",
          value2: "",
        },
      ],
      sort_field: "lifetime_spend",
      sort_direction: "DESC",
      reason_template: "win_back",
    },
  },
  {
    key: "high_spenders",
    label: "High Spenders",
    form: {
      title: "High Spenders",
      category: "VIP",
      description: "Members with strong lifetime value for premium messaging.",
      rules: [
        { field: "lifetime_spend", operator: ">=", value: "10000", value2: "" },
      ],
      sort_field: "lifetime_spend",
      sort_direction: "DESC",
      reason_template: "high_value",
    },
  },
  {
    key: "villa_lovers",
    label: "Villa Lovers",
    form: {
      title: "Villa Lovers",
      category: "Villa",
      description: "Members with repeat stays in a preferred villa.",
      rules: [
        {
          field: "preferred_villa",
          operator: "is_known",
          value: "",
          value2: "",
        },
        {
          field: "preferred_villa_visits",
          operator: ">=",
          value: "2",
          value2: "",
        },
      ],
      sort_field: "preferred_villa_visits",
      sort_direction: "DESC",
      reason_template: "villa",
    },
  },
  {
    key: "spa_guests",
    label: "Spa Guests",
    form: {
      title: "Spa Guests",
      category: "Amenities",
      description: "Members whose preferred amenity is Spa.",
      rules: [
        {
          field: "preferred_amenity",
          operator: "is",
          value: "Spa",
          value2: "",
        },
        {
          field: "preferred_amenity_visits",
          operator: ">=",
          value: "2",
          value2: "",
        },
      ],
      sort_field: "preferred_amenity_visits",
      sort_direction: "DESC",
      reason_template: "amenity",
    },
  },
  {
    key: "golf_guests",
    label: "Golf Guests",
    form: {
      title: "Golf Guests",
      category: "Amenities",
      description: "Members whose preferred amenity is Golf.",
      rules: [
        {
          field: "preferred_amenity",
          operator: "is",
          value: "Golf",
          value2: "",
        },
        {
          field: "preferred_amenity_visits",
          operator: ">=",
          value: "2",
          value2: "",
        },
      ],
      sort_field: "preferred_amenity_visits",
      sort_direction: "DESC",
      reason_template: "amenity",
    },
  },
  {
    key: "birthdays",
    label: "Birthdays Next Month",
    form: {
      title: "Birthdays Next Month",
      category: "Occasion",
      description:
        "Members with birthdays next month for birthday greetings or offers.",
      rules: [
        {
          field: "date_of_birth",
          operator: "next_month",
          value: "",
          value2: "",
        },
      ],
      sort_field: "lifetime_spend",
      sort_direction: "DESC",
      reason_template: "birthday",
    },
  },
  {
    key: "free_to_paid",
    label: "Free to Paid Conversion",
    form: {
      title: "Free to Paid Conversion",
      category: "Conversion",
      description:
        "Members with complimentary value but little or no paid revenue.",
      rules: [
        { field: "free_value", operator: ">", value: "0", value2: "" },
        { field: "paid_revenue", operator: "<=", value: "0", value2: "" },
      ],
      sort_field: "free_value",
      sort_direction: "DESC",
      reason_template: "auto",
    },
  },
];

const emptyRule = {
  field: "total_visits",
  operator: ">=",
  value: "1",
  value2: "",
};

const emptyForm = {
  key: "",
  title: "",
  category: "Custom",
  description: "",
  rules: [emptyRule],
  rule_logic: "AND",
  sort_field: "lifetime_spend",
  sort_direction: "DESC",
  reason_template: "auto",
  advanced_mode: false,
  where: "total_visits >= 1",
  reason: "'Custom campaign match.'",
  sort: "lifetime_spend DESC",
  is_active: true,
};

function getFieldMeta(field) {
  return (
    FIELD_OPTIONS.find((option) => option.value === field) || FIELD_OPTIONS[0]
  );
}

function getOperatorsForType(type) {
  if (type === "number") return NUMBER_OPERATORS;
  if (type === "date") return DATE_OPERATORS;
  return TEXT_OPERATORS;
}

function needsValue(operator) {
  return !["is_known", "is_unknown", "next_month", "this_month"].includes(
    operator,
  );
}

function buildPreview(form) {
  if (form.advanced_mode) {
    return {
      where: form.where || "total_visits >= 1",
      reason: form.reason || "'Custom campaign match.'",
      sort: form.sort || "lifetime_spend DESC",
    };
  }
  const ruleText = (form.rules || [])
    .filter((r) => r.field && r.operator)
    .map((r) => {
      const field = getFieldMeta(r.field);
      const op =
        getOperatorsForType(field.type).find((o) => o.value === r.operator)
          ?.label || r.operator;
      if (!needsValue(r.operator)) return `${field.label} ${op}`;
      if (r.operator === "between")
        return `${field.label} ${op} ${r.value || "0"} and ${r.value2 || "0"}`;
      return `${field.label} ${op} ${r.value || "—"}`;
    });
  const sortLabel =
    FIELD_OPTIONS.find((f) => f.value === form.sort_field)?.label ||
    "Lifetime Spend";
  return {
    where: ruleText.length
      ? ruleText.join(` ${form.rule_logic || "AND"} `)
      : "All members with visits",
    reason:
      REASON_TEMPLATES.find((r) => r.value === form.reason_template)?.label ||
      "Simple match reason",
    sort: `${sortLabel} · ${form.sort_direction === "ASC" ? "Lowest first" : "Highest first"}`,
  };
}

function Field({ label, help, children }) {
  return (
    <label style={{ display: "grid", gap: 6, fontFamily: "sans-serif" }}>
      <span style={{ color: C.textPrimary, fontSize: 12, fontWeight: 900 }}>
        {label}
      </span>
      {children}
      {help && (
        <span style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.4 }}>
          {help}
        </span>
      )}
    </label>
  );
}

function inputStyle(disabled = false) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 11px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: disabled ? C.panelAlt : C.bg,
    color: C.textPrimary,
    outline: "none",
    fontSize: 13,
    fontFamily: "sans-serif",
  };
}

export default function CampaignFormDrawer({ campaign, onClose, onSave }) {
  const editing = Boolean(campaign?.key);
  const [templateKey, setTemplateKey] = useState("blank");
  const [form, setForm] = useState(() =>
    campaign
      ? {
          ...emptyForm,
          key: campaign.key || "",
          title: campaign.title || "",
          category: campaign.category || "Custom",
          description: campaign.description || "",
          where: campaign.where || "total_visits >= 1",
          reason: campaign.reason || "'Custom campaign match.'",
          sort: campaign.sort || "lifetime_spend DESC",
          advanced_mode: true,
          is_active: campaign.isActive !== false,
        }
      : emptyForm,
  );

  const preview = useMemo(() => buildPreview(form), [form]);
  const set = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const applyTemplate = (key) => {
    setTemplateKey(key);
    const template = CAMPAIGN_TEMPLATES.find((item) => item.key === key);
    if (!template) return;
    setForm((prev) => ({
      ...prev,
      ...template.form,
      key: editing ? prev.key : prev.key,
      is_active: prev.is_active,
      advanced_mode: false,
      rule_logic: "AND",
    }));
  };

  const updateRule = (index, field, value) => {
    setForm((prev) => {
      const rules = [...(prev.rules || [])];
      const next = { ...rules[index], [field]: value };
      if (field === "field") {
        const meta = getFieldMeta(value);
        next.operator = getOperatorsForType(meta.type)[0].value;
        next.value = meta.type === "number" ? "1" : "";
        next.value2 = "";
      }
      rules[index] = next;
      return { ...prev, rules };
    });
  };

  const addRule = () =>
    setForm((prev) => ({
      ...prev,
      rules: [...(prev.rules || []), { ...emptyRule }],
    }));
  const removeRule = (index) =>
    setForm((prev) => ({
      ...prev,
      rules: (prev.rules || []).filter((_, i) => i !== index),
    }));

  const save = () => {
    const payload = {
      ...form,
      rules: form.advanced_mode ? [] : form.rules,
      rule_logic: form.rule_logic || "AND",
      sort_field: form.sort_field || "lifetime_spend",
      sort_direction: form.sort_direction || "DESC",
      reason_template: form.reason_template || "auto",
      advanced_mode: Boolean(form.advanced_mode),
    };
    onSave(payload, editing);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1100,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(720px, 96vw)",
          height: "100%",
          background: C.bg,
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 22px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                color: C.textMuted,
                fontSize: 11,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "sans-serif",
              }}
            >
              {editing ? "Edit Campaign" : "Add Campaign"}
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 21,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              {editing ? campaign.title : "New marketing campaign"}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textPrimary,
              borderRadius: 10,
              width: 36,
              height: 36,
              cursor: "pointer",
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div
          style={{ padding: 20, overflowY: "auto", display: "grid", gap: 16 }}
        >
          {!editing && (
            <Field
              label="Start With a Template"
              help="Pick a common campaign type to pre-fill the audience rules."
            >
              <select
                value={templateKey}
                onChange={(e) => applyTemplate(e.target.value)}
                style={inputStyle()}
              >
                {CAMPAIGN_TEMPLATES.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 170px",
              gap: 12,
            }}
          >
            <Field label="Campaign Name">
              <input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Summer Villa Win Back"
                style={inputStyle()}
              />
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                style={inputStyle()}
              >
                {[
                  "Custom",
                  "Win Back",
                  "VIP",
                  "Villa",
                  "Amenities",
                  "Occasion",
                  "Conversion",
                  "Seasonality",
                  "Source",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Info Icon Description">
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Short explanation for users."
              style={inputStyle()}
            />
          </Field>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: C.textPrimary,
              fontSize: 13,
              fontWeight: 900,
              fontFamily: "sans-serif",
            }}
          >
            <input
              type="checkbox"
              checked={form.advanced_mode}
              onChange={(e) => set("advanced_mode", e.target.checked)}
            />
            Advanced Mode
            <span style={{ color: C.textMuted, fontWeight: 700 }}>
              {form.advanced_mode
                ? "SQL fields visible"
                : "dropdown rules only"}
            </span>
          </label>

          {!form.advanced_mode ? (
            <>
              <div style={{ ...card, padding: 14, display: "grid", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: 0,
                        color: C.textPrimary,
                        fontWeight: 900,
                        fontFamily: "sans-serif",
                      }}
                    >
                      Who should receive this campaign?
                    </p>
                    <p
                      style={{
                        margin: "4px 0 0",
                        color: C.textMuted,
                        fontSize: 12,
                        fontFamily: "sans-serif",
                      }}
                    >
                      Add one or more rules. No backend knowledge needed.
                    </p>
                  </div>
                  <select
                    value={form.rule_logic}
                    onChange={(e) => set("rule_logic", e.target.value)}
                    style={{ ...inputStyle(), width: 90 }}
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                </div>

                {(form.rules || []).map((rule, index) => {
                  const fieldMeta = getFieldMeta(rule.field);
                  const operators = getOperatorsForType(fieldMeta.type);
                  const showValue = needsValue(rule.operator);
                  const showValue2 = rule.operator === "between";
                  const valueType =
                    fieldMeta.type === "number" ||
                    ["within_last_months", "more_than_months_ago"].includes(
                      rule.operator,
                    )
                      ? "number"
                      : fieldMeta.type === "date"
                        ? "date"
                        : "text";
                  return (
                    <div
                      key={index}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.2fr 1fr 1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <select
                        value={rule.field}
                        onChange={(e) =>
                          updateRule(index, "field", e.target.value)
                        }
                        style={inputStyle()}
                      >
                        {FIELD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) =>
                          updateRule(index, "operator", e.target.value)
                        }
                        style={inputStyle()}
                      >
                        {operators.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: showValue2 ? "1fr 1fr" : "1fr",
                          gap: 6,
                        }}
                      >
                        {showValue ? (
                          <input
                            type={valueType}
                            value={rule.value || ""}
                            onChange={(e) =>
                              updateRule(index, "value", e.target.value)
                            }
                            placeholder={valueType === "number" ? "0" : "Value"}
                            style={inputStyle()}
                          />
                        ) : (
                          <span
                            style={{
                              color: C.textMuted,
                              fontSize: 12,
                              fontFamily: "sans-serif",
                            }}
                          >
                            No value needed
                          </span>
                        )}
                        {showValue2 && (
                          <input
                            type="number"
                            value={rule.value2 || ""}
                            onChange={(e) =>
                              updateRule(index, "value2", e.target.value)
                            }
                            placeholder="To"
                            style={inputStyle()}
                          />
                        )}
                      </div>
                      <ActionButton
                        danger
                        disabled={(form.rules || []).length <= 1}
                        onClick={() => removeRule(index)}
                      >
                        <Trash2 size={13} />
                      </ActionButton>
                    </div>
                  );
                })}
                <div>
                  <ActionButton onClick={addRule}>
                    <Plus size={13} /> Add Rule
                  </ActionButton>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 150px",
                  gap: 12,
                }}
              >
                <Field label="Sort By">
                  <select
                    value={form.sort_field}
                    onChange={(e) => set("sort_field", e.target.value)}
                    style={inputStyle()}
                  >
                    {FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Order">
                  <select
                    value={form.sort_direction}
                    onChange={(e) => set("sort_direction", e.target.value)}
                    style={inputStyle()}
                  >
                    <option value="DESC">Highest first</option>
                    <option value="ASC">Lowest first</option>
                  </select>
                </Field>
              </div>

              <Field label="Reason Shown Per Member">
                <select
                  value={form.reason_template}
                  onChange={(e) => set("reason_template", e.target.value)}
                  style={inputStyle()}
                >
                  {REASON_TEMPLATES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div style={{ ...card, padding: 14, background: C.panelAlt }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    color: C.textPrimary,
                    fontWeight: 900,
                    fontFamily: "sans-serif",
                  }}
                >
                  Preview
                </p>
                <p
                  style={{
                    margin: "0 0 5px",
                    color: C.textMid,
                    fontSize: 12,
                    fontFamily: "sans-serif",
                  }}
                >
                  <strong>Audience:</strong> {preview.where}
                </p>
                <p
                  style={{
                    margin: "0 0 5px",
                    color: C.textMid,
                    fontSize: 12,
                    fontFamily: "sans-serif",
                  }}
                >
                  <strong>Reason:</strong> {preview.reason}
                </p>
                <p
                  style={{
                    margin: 0,
                    color: C.textMid,
                    fontSize: 12,
                    fontFamily: "sans-serif",
                  }}
                >
                  <strong>Sort:</strong> {preview.sort}
                </p>
              </div>
            </>
          ) : (
            <>
              <Field
                label="Campaign Key"
                help="Use lowercase_with_underscores. Leave blank when adding to auto-create from title."
              >
                <input
                  disabled={editing}
                  value={form.key}
                  onChange={(e) => set("key", e.target.value)}
                  placeholder="custom_campaign_key"
                  style={inputStyle(editing)}
                />
              </Field>
              <Field
                label="Audience Rule / WHERE"
                help="Developer-only SQL condition."
              >
                <textarea
                  value={form.where}
                  onChange={(e) => set("where", e.target.value)}
                  rows={4}
                  style={inputStyle()}
                />
              </Field>
              <Field
                label="Member Reason SQL"
                help="Developer-only SQL expression for the member reason."
              >
                <textarea
                  value={form.reason}
                  onChange={(e) => set("reason", e.target.value)}
                  rows={3}
                  style={inputStyle()}
                />
              </Field>
              <Field
                label="Sort SQL"
                help="Developer-only ORDER BY expression."
              >
                <input
                  value={form.sort}
                  onChange={(e) => set("sort", e.target.value)}
                  style={inputStyle()}
                />
              </Field>
            </>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: C.textPrimary,
              fontSize: 13,
              fontWeight: 800,
              fontFamily: "sans-serif",
            }}
          >
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />{" "}
            Active
          </label>
        </div>

        <div
          style={{
            padding: 18,
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton primary disabled={!form.title.trim()} onClick={save}>
            {editing ? "Save Changes" : "Add Campaign"}
          </ActionButton>
        </div>
      </aside>
    </div>
  );
}
