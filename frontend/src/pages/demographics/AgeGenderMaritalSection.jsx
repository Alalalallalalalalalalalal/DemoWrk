import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { SectionLabel, PieLegendCard } from "../styles/Dashboardcomponents";
import { AX, GRID, TIP, Card, ChartInfo } from "./DemographicsShared";

/* ─── Age, gender and marital status ────────────────── */
export default function AgeGenderMaritalSection({
  membersByAgeGroup,
  membersByGender,
  membersByMaritalStatus,
}) {
  return (
    <>
      <SectionLabel>Age / Gender / Status</SectionLabel>
      <div className="dashboard-grid dashboard-grid-3">
        <Card
          title="Age Groups"
          sub="Accounts by age segment"
          action={<ChartInfo id="ageGroups" />}
        >
          <div className="dashboard-chart dashboard-chart-200">
            <ResponsiveContainer>
              <BarChart data={membersByAgeGroup}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="age_group" stroke={AX} fontSize={11} />
                <YAxis stroke={AX} fontSize={11} />
                <Tooltip contentStyle={TIP} />
                <Bar
                  dataKey="total"
                  fill="var(--dashboard-truffle)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <div style={{ position: "relative", minWidth: 0 }}>
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              zIndex: 10,
            }}
          >
            <ChartInfo id="genderSplit" />
          </div>
          <PieLegendCard
            title="Gender Split"
            data={membersByGender}
            dataKey="total"
            nameKey="gender"
            colorMap={{
              M: "var(--dashboard-truffle)",
              F: "var(--dashboard-flame)",
            }}
          />
        </div>
        <div style={{ position: "relative", minWidth: 0 }}>
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              zIndex: 10,
            }}
          >
            <ChartInfo id="maritalStatus" />
          </div>
          <PieLegendCard
            title="Marital Status"
            data={membersByMaritalStatus}
            dataKey="total"
            nameKey="marital_status"
            colorMap={{
              Single: "var(--dashboard-truffle)",
              Married: "var(--dashboard-deep-blue)",
            }}
          />
        </div>
      </div>
    </>
  );
}
