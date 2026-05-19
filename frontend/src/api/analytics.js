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

  bookingsByRoomType: () => fetchData("/analytics/bookings-by-room-type"),
  bookingsByMonth: () => fetchData("/analytics/bookings-by-month"),
  averageLengthOfStay: () => fetchData("/analytics/average-length-of-stay"),

  totalRecentActivitySpend: () =>
    fetchData("/analytics/total-recent-activity-spend"),
  spendByMonth: () => fetchData("/analytics/spend-by-month"),
  topSpendDescriptions: () => fetchData("/analytics/top-spend-descriptions"),

  totalAmountDue: () => fetchData("/analytics/total-amount-due"),
  amountDueByPeriod: () => fetchData("/analytics/amount-due-by-period"),

  dependentsByAgeGroup: () => fetchData("/analytics/dependents-by-age-group"),
  dependentsPerMember: () => fetchData("/analytics/dependents-per-member"),
};
