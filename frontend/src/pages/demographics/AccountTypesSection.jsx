import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { analyticsApi } from "../../api/analytics";
import { AX, GRID, TIP, Card, ChartInfo, ClickableBarRow } from "./DemographicsShared";

/* ─── Account types ─────────────────────────────────── */
export default function AccountTypesSection({ accountsByType, openAccountDrawer }) {
  const [accountTypeView, setAccountTypeView] = useState("Member");

  const visibleAccountTypes = useMemo(
    () =>
      accountsByType.filter(
        (item) => item.account_category?.trim() === accountTypeView,
      ),
    [accountsByType, accountTypeView],
  );

  const handleAccountTypeClick = (entry) => {
    const row = entry?.payload ?? entry;
    const memberType = row?.member_type;

    if (!memberType) return;

    const category = row?.account_category ?? accountTypeView;

    openAccountDrawer({
      title: `${category} Accounts — ${memberType}`,
      eyebrow: "Account type details",
      emptyMessage: `No ${category.toLowerCase()} accounts were found for ${memberType}.`,
      exportKey: `${category}-${memberType}`,
      request: (dateParams = {}) =>
        analyticsApi.demographicAccountDetails({
          dimension: "account_type",
          value: memberType,
          category,
          ...dateParams,
        }),
    });
  };

  return (
    <Card
      title="Account Types"
      sub="Distribution of member and guest account types"
      action={<ChartInfo id="accountTypes" />}
    >
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          marginBottom: 18,
          background: "#EEE9DF",
          border: "1px solid #DDD6CA",
          borderRadius: 12,
          width: "fit-content",
        }}
      >
        <button
          type="button"
          onClick={() => setAccountTypeView("Member")}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            background: accountTypeView === "Member" ? "#2C3B4D" : "transparent",
            color: accountTypeView === "Member" ? "#FFB162" : "#2C3B4D",
            boxShadow:
              accountTypeView === "Member"
                ? "0 3px 10px rgba(27, 38, 50, 0.14)"
                : "none",
            transition: "all 0.2s ease",
          }}
        >
          Members
        </button>
        <button
          type="button"
          onClick={() => setAccountTypeView("Guest")}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            background: accountTypeView === "Guest" ? "#2C3B4D" : "transparent",
            color: accountTypeView === "Guest" ? "#FFB162" : "#2C3B4D",
            boxShadow:
              accountTypeView === "Guest"
                ? "0 3px 10px rgba(27, 38, 50, 0.14)"
                : "none",
            transition: "all 0.2s ease",
          }}
        >
          Guests
        </button>
      </div>
      <div
        className="dashboard-chart"
        style={{
          height: Math.max(220, visibleAccountTypes.length * 34),
          maxHeight: 460,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={visibleAccountTypes}
            layout="vertical"
            margin={{
              top: 2,
              right: 20,
              bottom: 2,
            }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, "dataMax"]}
              stroke={AX}
              fontSize={11}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="member_type"
              stroke={AX}
              fontSize={10}
              width={210}
              interval={0}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TIP}
              formatter={(value, name) => [Number(value).toLocaleString(), name]}
            />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                paddingTop: 6,
              }}
            />
            <Bar
              dataKey="active_total"
              name="Active"
              stackId="accountType"
              fill={accountTypeView === "Member" ? "#FFB162" : "var(--dashboard-truffle)"}
              maxBarSize={20}
              cursor="pointer"
              onClick={handleAccountTypeClick}
              background={(props) => (
                <ClickableBarRow {...props} onRowClick={handleAccountTypeClick} />
              )}
            />
            <Bar
              dataKey="inactive_total"
              name="Inactive"
              stackId="accountType"
              fill={accountTypeView === "Member" ? "#fad1a9" : "#7b79ae"}
              fillOpacity={0.4}
              radius={[0, 6, 6, 0]}
              maxBarSize={20}
              cursor="pointer"
              onClick={handleAccountTypeClick}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
