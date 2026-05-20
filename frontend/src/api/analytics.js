const API_BASE_URL = "http://127.0.0.1:8000";

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
};
