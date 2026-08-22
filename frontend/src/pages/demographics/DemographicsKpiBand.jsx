import { useMemo } from "react";
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
import { AX, GRID, TIP, C, Card, ChartInfo } from "./DemographicsShared";

/* ─── Top KPI band + Data quality / completeness ────────────── */
export default function DemographicsKpiBand({
  membersByCountry,
  accountsByType,
  totalDependents,
  completeness,
  extraSummaryLoading,
  openAccountDrawer,
  scrollToCountryChart,
}) {
  const getAccountTotal = (category) =>
    accountsByType
      .filter((item) => item.account_category?.trim() === category)
      .reduce((sum, item) => sum + Number(item.total || 0), 0);

  const totalMemberAccounts = getAccountTotal("Member");
  const totalGuestAccounts = getAccountTotal("Guest");

  const totalDependentCount = (() => {
    if (
      totalDependents?.total_dependents !== undefined &&
      totalDependents?.total_dependents !== null
    ) {
      return Number(totalDependents.total_dependents).toLocaleString();
    }

    if (
      totalDependents !== null &&
      totalDependents !== undefined &&
      !Number.isNaN(Number(totalDependents))
    ) {
      return Number(totalDependents).toLocaleString();
    }
    return "—";
  })();

  const handleAccountCategoryClick = (category) => {
    const pluralLabel = category === "Member" ? "Members" : "Guests";

    openAccountDrawer({
      state: null,
      title: `All ${pluralLabel}`,
      eyebrow: "Account category details",
      emptyMessage: `No ${pluralLabel.toLowerCase()} were found.`,
      exportKey: `all-${pluralLabel.toLowerCase()}`,

      request: (dateParams = {}) =>
        analyticsApi.accountCategoryDetails(category, dateParams),
    });
  };

  /* Demographic data completeness — turn missing_* counts into a
     chart-friendly array of { field, missing, pct }. */
  const completenessRows = useMemo(() => {
    if (!completeness) return [];

    const total = Number(completeness.total_accounts || 0);
    if (!total) return [];

    const fields = [
      { key: "missing_age", label: "Age" },
      { key: "missing_gender", label: "Gender" },
      { key: "missing_country", label: "Country" },
      { key: "missing_marital_status", label: "Marital Status" },
      { key: "missing_since_date", label: "Since Date" },
    ];

    return fields.map((f) => {
      const missing = Number(completeness[f.key] || 0);

      return {
        field: f.label,
        missing,
        pct: Number(((missing / total) * 100).toFixed(1)),
      };
    });
  }, [completeness]);

  return (
    <>
      {/* ─── KPI band ──────────────────────────────────────── */}
      <section className="dashboard-kpi-band" style={{ padding: "24px 28px" }}>
        {[
          {
            label: "Total Members",
            value: totalMemberAccounts ? totalMemberAccounts.toLocaleString() : "—",
            detail: "Across all Member account types",
            onClick: () => handleAccountCategoryClick("Member"),
          },
          {
            label: "Total Guests",
            value: totalGuestAccounts ? totalGuestAccounts.toLocaleString() : "—",
            detail: "Across all Guest account types",
            onClick: () => handleAccountCategoryClick("Guest"),
          },
          {
            label: "Countries Represented",
            value: membersByCountry.length
              ? membersByCountry.length.toLocaleString()
              : "—",
            detail: "Click to view country distribution",
            onClick: () => scrollToCountryChart(),
          },
          {
            label: "Total Dependents",
            value: totalDependentCount,
            detail: "Linked family accounts",
          },
          {
            label: "Account Categories",
            value: accountsByType.length
              ? accountsByType.length.toLocaleString()
              : "—",
            detail: "Member and guest types",
          },
        ].map((item, index) => {
          const clickable = Boolean(item.onClick);
          const KpiElement = clickable ? "button" : "div";

          return (
            <KpiElement
              key={item.label}
              type={clickable ? "button" : undefined}
              onClick={item.onClick}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "0 24px",
                border: "none",
                borderLeft: index > 0 ? "1px solid #DDD6CA" : "none",
                background: "transparent",
                textAlign: "left",
                fontFamily: "inherit",
                cursor: clickable ? "pointer" : "default",
                borderRadius: clickable ? 10 : 0,
                transition: "background 0.16s ease, transform 0.16s ease",
              }}
              onMouseEnter={
                clickable
                  ? (event) => {
                      event.currentTarget.style.background =
                        "var(--dashboard-panel-alt)";
                      event.currentTarget.style.transform = "translateY(-1px)";
                    }
                  : undefined
              }
              onMouseLeave={
                clickable
                  ? (event) => {
                      event.currentTarget.style.background = "transparent";
                      event.currentTarget.style.transform = "translateY(0)";
                    }
                  : undefined
              }
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#9A8E84",
                }}
              >
                {item.label}
              </span>

              <span
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 32,
                  lineHeight: 1.1,
                  color: "#1B2632",
                }}
              >
                {item.value}
              </span>

              <span
                style={{
                  fontSize: 11,
                  color: "#A35139",
                }}
              >
                {item.detail}
              </span>
            </KpiElement>
          );
        })}
      </section>

      {/* ─── Data quality / completeness ──────────────── */}
      <SectionLabel>Data Quality</SectionLabel>
      <Card
        title="Demographic Data Completeness"
        sub="Share of accounts missing key fields"
        action={<ChartInfo id="dataCompleteness" />}
      >
        {extraSummaryLoading && !completeness && (
          <div
            style={{
              color: C.muted,
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            Loading completeness data…
          </div>
        )}

        <div
          className="dashboard-chart"
          style={{
            height: Math.max(200, completenessRows.length * 42),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={completenessRows}
              layout="vertical"
              margin={{
                top: 2,
                right: 34,
                bottom: 2,
              }}
              barCategoryGap="28%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />

              <XAxis
                type="number"
                stroke={AX}
                fontSize={11}
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />

              <YAxis
                type="category"
                dataKey="field"
                stroke={AX}
                fontSize={11}
                width={120}
                tickLine={false}
              />

              <Tooltip
                contentStyle={TIP}
                formatter={(value, name, props) => [
                  `${value}% (${Number(props.payload.missing).toLocaleString()} accounts)`,
                  "Missing",
                ]}
              />

              <Bar
                dataKey="pct"
                name="Missing"
                fill="var(--dashboard-flame)"
                radius={[0, 6, 6, 0]}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
