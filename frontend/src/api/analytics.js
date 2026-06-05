// frontend/src/api/analytics.js
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function fetchData(endpoint) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpoint}`);
  }

  return response.json();
}

export const analyticsApi = {
  membersByCountry: () => fetchData("/analytics/members-by-country"),
  membersByState: () => fetchData("/analytics/members-by-state"),
  membersByGender: () => fetchData("/analytics/members-by-gender"),
  membersByAgeGroup: () => fetchData("/analytics/members-by-age-group"),
  membersByType: () => fetchData("/analytics/members-by-type"),
  membersByStatus: () => fetchData("/analytics/members-by-status"),
  membersByMaritalStatus: () =>
    fetchData("/analytics/members-by-marital-status"),

  newMembersPerYear: () => fetchData("/analytics/new-members-per-year"),
  averageTenure: () => fetchData("/analytics/average-tenure"),

  bookingsByRoomType: () => fetchData("/analytics/bookings-by-room-type"),
  bookingsByMonth: () => fetchData("/analytics/bookings-by-month"),
  averageLengthOfStay: () => fetchData("/analytics/average-length-of-stay"),
  mostUsedRoomTypes: () => fetchData("/analytics/most-used-room-types"),
  leastUsedRoomTypes: () => fetchData("/analytics/least-used-room-types"),

  currentlyCheckedInMembers: () =>
    fetchData("/analytics/currently-checked-in-members"),
  liveInHouseCount: () => fetchData("/analytics/live-in-house-count"),
  liveInHouseRoster: () => fetchData("/analytics/live-in-house-roster"),

  totalRecentActivitySpend: () =>
    fetchData("/analytics/total-recent-activity-spend"),
  spendByMonth: () => fetchData("/analytics/spend-by-month"),
  topSpendDescriptions: () => fetchData("/analytics/top-spend-descriptions"),

  totalAmountDue: () => fetchData("/analytics/total-amount-due"),
  amountDueByPeriod: () => fetchData("/analytics/amount-due-by-period"),

  totalDependents: () => fetchData("/analytics/total-dependents"),
  dependentsByAgeGroup: () => fetchData("/analytics/dependents-by-age-group"),
  dependentsPerMember: () => fetchData("/analytics/dependents-per-member"),
  memberDirectory: () => fetchData("/analytics/member-directory"),

  // ML Analytics
  memberSegments: () => fetchData("/analytics/ml/member-segments"),

  segmentSummary: () => fetchData("/analytics/ml/segment-summary"),

  amenityAdoption: () => fetchData("/analytics/ml/amenity-adoption"),

  memberAmenityUsage: () => fetchData("/analytics/ml/member-amenity-usage"),

  memberAmenitySegments: () =>
    fetchData("/analytics/ml/member-amenity-segments"),

  seasonalVisits: () => fetchData("/analytics/ml/seasonal-visits"),

  amenityRevenue: () => fetchData("/analytics/ml/amenity-revenue"),

  airportTransferUsers: (limit = 20) =>
    fetchData(`/analytics/ml/airport-transfer-users?limit=${limit}`),

  marketingTargets: () => fetchData("/analytics/ml/marketing-targets"),

  marketingTargetsByCampaign: () =>
    fetchData("/analytics/ml/marketing-targets-by-individual-campaign"),

  amenityMemberDetails: (amenity, limit = 100) =>
    fetchData(
      `/analytics/ml/amenity-member-details?amenity=${encodeURIComponent(
        amenity,
      )}&limit=${limit}`,
    ),

  memberAmenityHistory: (memberNumber) =>
    fetchData(
      `/analytics/ml/member-amenity-history?member_number=${encodeURIComponent(
        memberNumber,
      )}`,
    ),

  mlInsights: () => fetchData("/analytics/ml/insights"),

  seasonalVisitDetails: (season, limit = 50) =>
    fetchData(
      `/analytics/ml/seasonal-visit-details?season=${encodeURIComponent(
        season,
      )}&limit=${limit}`,
    ),

  // Season groups CRUD
  seasonGroups: () => fetchData("/analytics/ml/season-groups"),

  createSeasonGroup: (body) =>
    fetch(`${API_BASE_URL}/analytics/ml/season-groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),

  updateSeason: (seasonId, body) =>
    fetch(`${API_BASE_URL}/analytics/ml/seasons/${seasonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),

  addSeason: (body) =>
    fetch(`${API_BASE_URL}/analytics/ml/seasons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
};
