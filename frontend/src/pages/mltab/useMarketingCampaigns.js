// frontend/src/pages/mltab/useMarketingCampaigns.js
// Campaign list fetch + CRUD handlers extracted from MarketingTargetingPanel.
import { useEffect, useState } from "react";
import { analyticsApi } from "../../api/analytics";

export default function useMarketingCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  // Returns true on success / false on failure so the caller (which owns the
  // form-drawer open/close state) can decide whether to close the drawer.
  const saveCampaign = async (form, editing) => {
    try {
      setError("");
      if (editing) await analyticsApi.updateMarketingCampaign(form.key, form);
      else await analyticsApi.createMarketingCampaign(form);
      await loadCampaigns();
      return true;
    } catch (err) {
      setError(err.message || "Failed to save campaign.");
      return false;
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

  return {
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
  };
}
