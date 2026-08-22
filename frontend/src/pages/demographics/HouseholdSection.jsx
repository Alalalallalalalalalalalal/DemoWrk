import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { analyticsApi } from "../../api/analytics";
import { SectionLabel } from "../styles/Dashboardcomponents";
import {
  AX,
  GRID,
  TIP,
  C,
  Card,
  ChartInfo,
  MiniKpiBand,
  ClickableBarColumn,
} from "./DemographicsShared";

/* ─── Household and dependents ──────────────────────── */
export default function HouseholdSection({
  dependentsByAgeGroup,
  dependentsPerHousehold,
  dependentsPerMember,
  householdSummary,
  extraSummaryLoading,
  openAccountDrawer,
}) {
  const householdKpiItems = [
    {
      label: "Accounts w/o Dependents",
      value: householdSummary
        ? Number(householdSummary.accounts_no_dependents || 0).toLocaleString()
        : "—",
    },
    {
      label: "Accounts w/ Dependents",
      value: householdSummary
        ? Number(householdSummary.accounts_with_dependents || 0).toLocaleString()
        : "—",
    },
    {
      label: "Avg Dependents / Household",
      value:
        householdSummary?.avg_dependents_per_household != null
          ? Number(householdSummary.avg_dependents_per_household).toFixed(2)
          : "—",
    },
    {
      label: "Largest Household",
      value:
        householdSummary?.largest_household_size != null
          ? Number(householdSummary.largest_household_size).toLocaleString()
          : "—",
      detail: "dependents",
    },
  ];

  const handleHouseholdClick = (entry) => {
    const row = entry?.payload ?? entry;
    const householdGroup = row?.household_group;

    if (!householdGroup) return;

    openAccountDrawer({
      title: `Households — ${householdGroup}`,
      eyebrow: "Dependent household details",
      emptyMessage: `No member households were found in ${householdGroup}.`,
      exportKey: `households-${householdGroup}`,
      request: (dateParams = {}) =>
        analyticsApi.demographicAccountDetails({
          dimension: "household",
          value: householdGroup,
          ...dateParams,
        }),
    });
  };

  return (
    <>
      <SectionLabel>Household &amp; Dependents</SectionLabel>

      {/* ─── Household composition summary ────────────── */}
      <Card
        title="Household Composition"
        sub="No-dependent vs. dependent households, plus average and largest household size"
        action={<ChartInfo id="householdComposition" />}
      >
        {extraSummaryLoading && !householdSummary && (
          <div
            style={{
              color: C.muted,
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            Loading household summary…
          </div>
        )}
        <MiniKpiBand items={householdKpiItems} />
      </Card>

      <div className="dashboard-grid dashboard-grid-equal">
        <Card
          title="Dependents by Age Group"
          sub="Linked to member folios"
          action={<ChartInfo id="dependentsByAge" />}
        >
          <div className="dashboard-chart dashboard-chart-200">
            <ResponsiveContainer>
              <BarChart data={dependentsByAgeGroup}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="age_group" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
                <Tooltip contentStyle={TIP} />
                <Bar dataKey="total" fill="#A35139" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card
          title="Dependents per Household"
          sub="Distribution of linked dependents across member households"
          action={<ChartInfo id="dependentsPerHousehold" />}
        >
          <div className="dashboard-chart dashboard-chart-200">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dependentsPerHousehold}
                margin={{
                  top: 6,
                  right: 12,
                  bottom: 8,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="household_group"
                  stroke={AX}
                  fontSize={10}
                  interval={0}
                  tickLine={false}
                />
                <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={TIP}
                  formatter={(value) => [Number(value).toLocaleString(), "Households"]}
                />
                <Bar
                  dataKey="total_households"
                  name="Households"
                  fill="var(--dashboard-flame)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={42}
                  cursor="pointer"
                  onClick={handleHouseholdClick}
                  background={(props) => (
                    <ClickableBarColumn {...props} onColumnClick={handleHouseholdClick} />
                  )}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card
        title="Top Members by Dependents"
        sub="Members with the most linked dependents"
        action={<ChartInfo id="topMembersByDependents" />}
      >
        <div className="dashboard-chart dashboard-chart-200">
          <ResponsiveContainer>
            <BarChart
              data={dependentsPerMember}
              margin={{
                top: 5,
                right: 12,
                bottom: 0,
                left: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis
                dataKey="member_number"
                stroke={AX}
                fontSize={11}
                angle={-15}
                textAnchor="end"
                height={55}
              />
              <YAxis stroke={AX} fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={TIP} />
              <Bar
                dataKey="total_dependents"
                fill="var(--dashboard-truffle)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
