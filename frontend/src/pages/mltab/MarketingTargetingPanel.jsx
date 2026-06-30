// frontend/src/pages/mltab/MarketingTargetingPanel.jsx
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Edit3,
  Info,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { analyticsApi } from "../../api/analytics";

const C = {
  bg: "var(--dashboard-card)",
  panel: "var(--dashboard-panel)",
  panelAlt: "var(--dashboard-panel-alt)",
  border: "var(--dashboard-border)",
  rowBorder: "var(--dashboard-row-border)",
  textPrimary: "var(--dashboard-abyssal)",
  textMid: "var(--dashboard-text-soft)",
  textMuted: "var(--dashboard-muted)",
  accent: "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  flame: "var(--dashboard-flame)",
  overlay: "var(--dashboard-overlay)",
  shadow: "var(--dashboard-shadow-panel)",
};

const tint = (color, amount = 14) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 18,
};

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 800,
  fontFamily: "sans-serif",
  cursor: "pointer",
};

const th = {
  padding: "10px 12px",
  background: C.panelAlt,
  color: C.textMid,
  fontWeight: 800,
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const td = {
  padding: "10px 12px",
  borderBottom: `1px solid ${C.rowBorder}`,
  color: C.textPrimary,
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

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

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\r?\n/g, " ");
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadRowsAsCsv(rows, filename) {
  if (!rows?.length) return;
  const columns = Object.keys(rows[0]);
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toExportRows(rows = []) {
  return rows.map((r) => ({
    campaign_name: r.campaign_name ?? "",
    campaign_key: r.campaign_key ?? "",
    campaign_reason: r.campaign_reason ?? "",
    member_number: r.member_number ?? "",
    title: r.title ?? "",
    name: r.name ?? "",
    email: r.email ?? "",
    phone_number: r.phone_number ?? "",
    address_line1: r.address_line1 ?? "",
    address_line2: r.address_line2 ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    postal_code: r.postal_code ?? "",
    country: r.country ?? "",
    business_source: r.business_source ?? "",
    preferred_season: r.preferred_season ?? "",
    preferred_villa: r.preferred_villa ?? "",
    preferred_amenity: r.preferred_amenity ?? "",
    total_visits: r.total_visits ?? 0,
    total_nights: r.total_nights ?? 0,
    paid_revenue: r.paid_revenue ?? 0,
    free_value: r.free_value ?? 0,
    lifetime_spend: r.lifetime_spend ?? 0,
    first_visit: r.first_visit ?? "",
    last_visit: r.last_visit ?? "",
    date_of_birth: r.date_of_birth ?? "",
  }));
}

function Metric({ label, value }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
      }}
    >
      <p
        style={{
          margin: "0 0 4px",
          color: C.textMuted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "sans-serif",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: 0,
          color: C.textPrimary,
          fontSize: 18,
          fontWeight: 900,
          fontFamily: "sans-serif",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  danger = false,
  primary = false,
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonBase,
        background: primary ? C.accent : danger ? "rgba(196,91,91,0.09)" : C.bg,
        color: primary ? "white" : danger ? "#9f2f2f" : C.accent,
        border: `1px solid ${danger ? "rgba(196,91,91,0.25)" : primary ? C.accent : C.border}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function CampaignCard({ campaign, onOpen, onEdit, onToggle, onDelete }) {
  const [showInfo, setShowInfo] = useState(false);
  const inactive = campaign.isActive === false;

  return (
    <div
      onClick={() => !inactive && onOpen(campaign)}
      style={{
        ...card,
        display: "flex",
        flexDirection: "column",
        minHeight: 248,
        borderTop: `4px solid ${inactive ? C.textMuted : C.accent}`,
        cursor: inactive ? "default" : "pointer",
        position: "relative",
        opacity: inactive ? 0.62 : 1,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 9px",
              borderRadius: 999,
              background: tint(inactive ? C.textMuted : C.accent, 12),
              color: inactive ? C.textMuted : C.accent,
              fontSize: 11,
              fontWeight: 800,
              fontFamily: "sans-serif",
            }}
          >
            {campaign.category}
            {inactive ? " · Disabled" : ""}
          </span>
          <h3
            style={{
              margin: "10px 0 6px",
              color: C.textPrimary,
              fontSize: 17,
              fontWeight: 900,
              fontFamily: "sans-serif",
            }}
          >
            {campaign.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowInfo((v) => !v);
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: C.panelAlt,
            color: C.accent,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label="Campaign info"
        >
          <Info size={16} />
        </button>
      </div>

      {showInfo && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 58,
            right: 16,
            width: 280,
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.bg,
            color: C.textMid,
            boxShadow: C.shadow,
            fontSize: 12,
            lineHeight: 1.45,
            fontFamily: "sans-serif",
            zIndex: 5,
          }}
        >
          <strong style={{ color: C.textPrimary }}>What it means:</strong>
          <div style={{ marginTop: 5 }}>
            {campaign.description || "No description added."}
          </div>
          <div style={{ marginTop: 10, color: C.textMuted }}>
            Click the card to view the audience and export members.
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        <Metric label="Targets" value={number(campaign.memberCount)} />
        <Metric label="Emails" value={number(campaign.emailableCount)} />
        <Metric label="Potential" value={money(campaign.potentialRevenue)} />
        <Metric label="Avg Lifetime" value={money(campaign.avgLifetimeSpend)} />
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: "auto",
          paddingTop: 14,
        }}
      >
        <ActionButton onClick={() => onEdit(campaign)}>
          <Edit3 size={13} /> Edit
        </ActionButton>
        <ActionButton onClick={() => onToggle(campaign)}>
          {inactive ? "Enable" : "Disable"}
        </ActionButton>
        <ActionButton danger onClick={() => onDelete(campaign)}>
          <Trash2 size={13} /> Delete
        </ActionButton>
      </div>
    </div>
  );
}

function CampaignFormDrawer({ campaign, onClose, onSave }) {
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

function CampaignDrawer({ campaign, rows, loading, onClose, onExport }) {
  const [search, setSearch] = useState("");
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.name,
        r.member_number,
        r.email,
        r.country,
        r.state,
        r.business_source,
        r.preferred_season,
        r.preferred_villa,
        r.preferred_amenity,
        r.campaign_reason,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);
  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => {
          acc.paid += Number(r.paid_revenue || 0);
          acc.free += Number(r.free_value || 0);
          acc.lifetime += Number(r.lifetime_spend || 0);
          return acc;
        },
        { paid: 0, free: 0, lifetime: 0 },
      ),
    [filteredRows],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(1120px, 94vw)",
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
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
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
              Marketing Campaign
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 22,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              {campaign?.title}
            </h2>
            <p
              style={{
                margin: "7px 0 0",
                color: C.textMuted,
                fontSize: 13,
                fontFamily: "sans-serif",
                maxWidth: 760,
              }}
            >
              {campaign?.description}
            </p>
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
          style={{
            padding: 18,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <Metric
              label="Visible Targets"
              value={number(filteredRows.length)}
            />
            <Metric label="Potential" value={money(totals.lifetime)} />
            <Metric label="Paid Revenue" value={money(totals.paid)} />
            <Metric label="Free Value" value={money(totals.free)} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: C.textMuted,
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members, source, villa, reason…"
                style={{
                  width: 330,
                  padding: "9px 12px 9px 34px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.bg,
                  color: C.textPrimary,
                  outline: "none",
                  fontSize: 13,
                  fontFamily: "sans-serif",
                }}
              />
            </div>
            <ActionButton
              primary
              disabled={!filteredRows.length}
              onClick={() => onExport(filteredRows)}
            >
              <Download size={14} /> Export Visible CSV
            </ActionButton>
          </div>

          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              overflow: "auto",
              minHeight: 0,
              flex: 1,
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 40,
                  color: C.textMuted,
                  fontFamily: "sans-serif",
                }}
              >
                Loading campaign members…
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "sans-serif",
                }}
              >
                <thead>
                  <tr>
                    {[
                      "Name",
                      "Email",
                      "Phone",
                      "Country",
                      "Source",
                      "Season",
                      "Villa",
                      "Amenity",
                      "Potential",
                      "Paid",
                      "Free",
                      "Last Visit",
                      "Reason",
                    ].map((h, idx) => (
                      <th
                        key={h}
                        style={{
                          ...th,
                          textAlign: idx >= 8 && idx <= 10 ? "right" : "left",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13}
                        style={{ ...td, padding: 34, color: C.textMuted }}
                      >
                        No matching members found.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, index) => (
                      <tr key={`${r.member_number}-${index}`}>
                        <td style={{ ...td, fontWeight: 800 }}>
                          {r.name || "—"}
                        </td>
                        <td style={td}>{r.email || "—"}</td>
                        <td style={td}>{r.phone_number || "—"}</td>
                        <td style={td}>{r.country || r.state || "—"}</td>
                        <td style={td}>{r.business_source || "—"}</td>
                        <td style={td}>{r.preferred_season || "—"}</td>
                        <td style={td}>{r.preferred_villa || "—"}</td>
                        <td style={td}>{r.preferred_amenity || "—"}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.lifetime_spend)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.paid_revenue)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.free_value)}
                        </td>
                        <td style={td}>{formatDate(r.last_visit)}</td>
                        <td
                          style={{
                            ...td,
                            minWidth: 280,
                            whiteSpace: "normal",
                            color: C.textMid,
                          }}
                        >
                          {r.campaign_reason || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function MarketingTargetingPanel() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [formCampaign, setFormCampaign] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await analyticsApi.marketingCampaigns(showInactive);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      setError(err.message || "Failed to load marketing campaigns.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [showInactive]);

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(new Set(campaigns.map((c) => c.category).filter(Boolean))),
    ],
    [campaigns],
  );

  const filteredCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (category !== "All" && c.category !== category) return false;
      if (!q) return true;
      return [c.title, c.category, c.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [campaigns, category, search]);

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (acc, c) => {
          if (c.isActive === false) return acc;
          acc.members += Number(c.memberCount || 0);
          acc.emails += Number(c.emailableCount || 0);
          acc.revenue += Number(c.potentialRevenue || 0);
          return acc;
        },
        { members: 0, emails: 0, revenue: 0 },
      ),
    [campaigns],
  );

  const openCampaign = async (campaign) => {
    setActiveCampaign(campaign);
    setMembers([]);
    setMembersLoading(true);
    try {
      const data = await analyticsApi.marketingCampaignMembers(campaign.key);
      setMembers(data.members || []);
    } catch (err) {
      setMembers([]);
      setError(err.message || "Failed to load campaign members.");
    } finally {
      setMembersLoading(false);
    }
  };

  const saveCampaign = async (form, editing) => {
    try {
      setError("");
      if (editing) await analyticsApi.updateMarketingCampaign(form.key, form);
      else await analyticsApi.createMarketingCampaign(form);
      setFormOpen(false);
      setFormCampaign(null);
      await loadCampaigns();
    } catch (err) {
      setError(err.message || "Failed to save campaign.");
    }
  };

  const toggleCampaign = async (campaign) => {
    try {
      await analyticsApi.setMarketingCampaignStatus(
        campaign.key,
        campaign.isActive === false,
      );
      await loadCampaigns();
    } catch (err) {
      setError(err.message || "Failed to update campaign status.");
    }
  };

  const deleteCampaign = async (campaign) => {
    const ok = window.confirm(
      `Delete/disable ${campaign.title}? Built-in campaigns will be disabled, custom campaigns will be deleted.`,
    );
    if (!ok) return;
    try {
      await analyticsApi.deleteMarketingCampaign(campaign.key);
      await loadCampaigns();
    } catch (err) {
      setError(err.message || "Failed to delete campaign.");
    }
  };

  const exportVisibleMembers = (rows) => {
    const date = new Date().toISOString().slice(0, 10);
    downloadRowsAsCsv(
      toExportRows(rows || []),
      `${activeCampaign?.key || "marketing_campaign"}_${date}.csv`,
    );
  };

  return (
    <div style={{ padding: "4px 0 24px" }}>
      <div
        style={{
          ...card,
          marginBottom: 18,
          background:
            "linear-gradient(135deg, var(--dashboard-card) 0%, var(--dashboard-panel-alt) 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 760 }}>
            <p
              style={{
                margin: "0 0 6px",
                color: C.flame,
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "sans-serif",
              }}
            >
              ML Insights · Marketing Targeting
            </p>
            <h2
              style={{
                margin: "0 0 8px",
                color: C.textPrimary,
                fontSize: 25,
                fontWeight: 950,
                fontFamily: "sans-serif",
              }}
            >
              Action-ready campaign audiences
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "flex-start",
            }}
          >
            <ActionButton
              primary
              onClick={() => {
                setFormCampaign(null);
                setFormOpen(true);
              }}
            >
              <Plus size={14} /> Add Campaign
            </ActionButton>
            <ActionButton onClick={loadCampaigns}>
              <RefreshCw size={14} /> Refresh
            </ActionButton>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            marginTop: 18,
          }}
        >
          <Metric
            label="Active Campaigns"
            value={number(campaigns.filter((c) => c.isActive !== false).length)}
          />
          <Metric label="Total Audience Rows" value={number(totals.members)} />
          <Metric label="Potential Value" value={money(totals.revenue)} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.textMuted,
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            style={{
              width: 260,
              padding: "9px 12px 9px 34px",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textPrimary,
              outline: "none",
              fontSize: 13,
              fontFamily: "sans-serif",
            }}
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{
            padding: "9px 12px",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.bg,
            color: C.textPrimary,
            outline: "none",
            fontSize: 13,
            fontFamily: "sans-serif",
          }}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label
          style={{
            display: "inline-flex",
            gap: 7,
            alignItems: "center",
            color: C.textMuted,
            fontSize: 12,
            fontWeight: 800,
            fontFamily: "sans-serif",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />{" "}
          Show disabled
        </label>
      </div>

      {error && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            color: "#9f2f2f",
            background: "rgba(196,91,91,0.08)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
          Loading marketing campaigns…
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div style={{ ...card, color: C.textMuted, fontFamily: "sans-serif" }}>
          No marketing campaigns found.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
            gap: 16,
          }}
        >
          {filteredCampaigns.map((campaign) => (
            <CampaignCard
              key={campaign.key}
              campaign={campaign}
              onOpen={openCampaign}
              onEdit={(c) => {
                setFormCampaign(c);
                setFormOpen(true);
              }}
              onToggle={toggleCampaign}
              onDelete={deleteCampaign}
            />
          ))}
        </div>
      )}

      {activeCampaign && (
        <CampaignDrawer
          campaign={activeCampaign}
          rows={members}
          loading={membersLoading}
          onClose={() => setActiveCampaign(null)}
          onExport={exportVisibleMembers}
        />
      )}
      {formOpen && (
        <CampaignFormDrawer
          campaign={formCampaign}
          onClose={() => {
            setFormOpen(false);
            setFormCampaign(null);
          }}
          onSave={saveCampaign}
        />
      )}
    </div>
  );
}
