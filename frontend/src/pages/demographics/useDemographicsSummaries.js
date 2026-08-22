import { useEffect, useState } from "react";

import { analyticsApi } from "../../api/analytics";

/* Data completeness / household composition / geographic concentration
   summaries — a single combined fetch shared by three sections. */
export default function useDemographicsSummaries() {
  const [completeness, setCompleteness] = useState(null);
  const [householdSummary, setHouseholdSummary] = useState(null);
  const [geoConcentration, setGeoConcentration] = useState(null);
  const [extraSummaryLoading, setExtraSummaryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadExtraSummary = async () => {
      setExtraSummaryLoading(true);

      try {
        const data = await analyticsApi.demographicsSummary();

        if (!cancelled) {
          setCompleteness(data.dataCompleteness ?? null);
          setHouseholdSummary(data.householdComposition ?? null);
          setGeoConcentration(data.geographicConcentration ?? null);
        }
      } catch (error) {
        console.error("Unable to load demographics summary extras:", error);
      } finally {
        if (!cancelled) {
          setExtraSummaryLoading(false);
        }
      }
    };

    loadExtraSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  return { completeness, householdSummary, geoConcentration, extraSummaryLoading };
}
