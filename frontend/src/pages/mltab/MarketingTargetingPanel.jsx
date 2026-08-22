// frontend/src/pages/mltab/MarketingTargetingPanel.jsx
import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { analyticsApi } from "../../api/analytics";
import { C, card, money, number, Metric, ActionButton } from "./MarketingTargetingShared";
import useMarketingCampaigns from "./useMarketingCampaigns";
import CampaignCard from "./CampaignCard";
import CampaignFormDrawer from "./CampaignFormDrawer";
import CampaignDrawer from "./CampaignDrawer";

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

export default function MarketingTargetingPanel() {
  const {
    campaigns,
    loading,
    error,
    setError,
    showInactive,
    setShowInactive,
    loadCampaigns,
    saveCampaign,
    toggleCampaign,
    deleteCampaign,
  } = useMarketingCampaigns();

  const [activeCampaign, setActiveCampaign] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [formCampaign, setFormCampaign] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

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

  const handleSaveCampaign = async (form, editing) => {
    const ok = await saveCampaign(form, editing);
    if (ok) {
      setFormOpen(false);
      setFormCampaign(null);
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
          onSave={handleSaveCampaign}
        />
      )}
    </div>
  );
}
