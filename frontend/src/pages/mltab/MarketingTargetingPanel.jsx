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

const emptyForm = {
  key: "",
  title: "",
  category: "Custom",
  description: "",
  where: "total_visits >= 1",
  reason: "'Custom campaign match.'",
  sort: "lifetime_spend DESC",
  is_active: true,
};

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
            Rule: <code>{campaign.where || "—"}</code>
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
  const [form, setForm] = useState(() =>
    campaign
      ? {
          key: campaign.key || "",
          title: campaign.title || "",
          category: campaign.category || "Custom",
          description: campaign.description || "",
          where: campaign.where || "total_visits >= 1",
          reason: campaign.reason || "'Custom campaign match.'",
          sort: campaign.sort || "lifetime_spend DESC",
          is_active: campaign.isActive !== false,
        }
      : emptyForm,
  );
  const editing = Boolean(campaign?.key);
  const set = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

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
          width: "min(560px, 94vw)",
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
          style={{ padding: 20, overflowY: "auto", display: "grid", gap: 14 }}
        >
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
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Summer Villa Win Back"
              style={inputStyle()}
            />
          </Field>
          <Field label="Category">
            <input
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="Win Back"
              style={inputStyle()}
            />
          </Field>
          <Field label="Info Icon Description">
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Short explanation for users."
              style={inputStyle()}
            />
          </Field>
          <Field
            label="Audience Rule / WHERE"
            help="Examples: lifetime_spend >= 10000, preferred_villa = 'Haystack', total_visits >= 2 AND last_visit < CURRENT_DATE - INTERVAL '12 months'."
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
            help="Text shown per member. Keep it as a SQL expression."
          >
            <textarea
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              rows={3}
              style={inputStyle()}
            />
          </Field>
          <Field label="Sort">
            <input
              value={form.sort}
              onChange={(e) => set("sort", e.target.value)}
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
          <ActionButton primary onClick={() => onSave(form, editing)}>
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
