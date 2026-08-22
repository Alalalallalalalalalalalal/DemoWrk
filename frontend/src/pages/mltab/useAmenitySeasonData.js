// frontend/src/pages/mltab/useAmenitySeasonData.js
// ──────────────────────────────────────────
// Data-fetching hook for AmenitySeasonPanel. Fetches the combined
// amenity/season insights payload for a given season group and exposes
// loading/error state.

import { useState, useEffect } from "react";
import { analyticsApi } from "../../api/analytics";

export default function useAmenitySeasonData(seasonGroupId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(null);

    analyticsApi
      .amenitySeasonInsights({ group_id: seasonGroupId })
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch((err) => {
        console.error("Amenity season insights failed:", err);

        if (mounted) {
          setError("Unable to load amenity season insights.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [seasonGroupId]);

  return { data, loading, error };
}
