import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { analyticsApi } from "../../api/analytics";
import { SectionLabel } from "../styles/Dashboardcomponents";
import AccountsUSMap from "./AccountsUSMap";
import {
  AX,
  GRID,
  TIP,
  C,
  Card,
  ChartInfo,
  HoverKpiCard,
  ClickableBarRow,
} from "./DemographicsShared";

/* Accounts by Country: maps the "Countries shown" label to a count. */
const COUNTRY_TOP_N = {
  "Top 5": 5,
  "Top 10": 10,
  "Top 15": 15,
  "Top 20": 20,
};

const COUNTRY_CHART_VISIBLE_HEIGHT = 288;
const COUNTRY_ROW_HEIGHT = 32;

/* ─── Geographic distribution + concentration summary ───────── */
export default function GeographicSection({
  membersByState,
  membersByCountry,
  geoConcentration,
  extraSummaryLoading,
  openAccountDrawer,
  countryChartRef,
}) {
  const stateMapCardRef = useRef(null);
  const countryScrollRef = useRef(null);

  /* Accounts by Country: Top N / All Countries selector */
  const [countriesShown, setCountriesShown] = useState("Top 10");
  const [otherCountriesOpen, setOtherCountriesOpen] = useState(false);

  const geoTotalAccounts = geoConcentration?.total_accounts ?? 0;

  const topStatesPanelRows = useMemo(() => {
    const list = geoConcentration?.top5_states ?? [];

    return list.map((row) => ({
      ...row,
      pct: geoTotalAccounts
        ? ((row.total / geoTotalAccounts) * 100).toFixed(1)
        : "0.0",
    }));
  }, [geoConcentration, geoTotalAccounts]);

  const topCountriesPanelRows = useMemo(() => {
    const list = geoConcentration?.top5_countries ?? [];

    return list.map((row) => ({
      ...row,
      pct: geoTotalAccounts
        ? ((row.total / geoTotalAccounts) * 100).toFixed(1)
        : "0.0",
    }));
  }, [geoConcentration, geoTotalAccounts]);

  const sortedCountries = useMemo(
    () =>
      [...membersByCountry].sort((a, b) => Number(b.total || 0) - Number(a.total || 0)),
    [membersByCountry],
  );

  const totalCountryLinkedAccounts = useMemo(
    () => sortedCountries.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [sortedCountries],
  );

  const isAllCountries = countriesShown === "All countries";

  const countryChartRows = useMemo(() => {
    if (isAllCountries) {
      return sortedCountries;
    }

    const n = COUNTRY_TOP_N[countriesShown] ?? 10;
    const top = sortedCountries.slice(0, n);
    const rest = sortedCountries.slice(n);

    if (!rest.length) {
      return top;
    }

    const otherTotal = rest.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const otherMemberTotal = rest.reduce(
      (sum, item) => sum + Number(item.member_total || 0),
      0,
    );
    const otherGuestTotal = rest.reduce(
      (sum, item) => sum + Number(item.guest_total || 0),
      0,
    );

    return [
      ...top,
      {
        country: "Other Countries",
        total: otherTotal,
        member_total: otherMemberTotal,
        guest_total: otherGuestTotal,
        isOtherCountries: true,
        includedCountries: rest,
      },
    ];
  }, [sortedCountries, countriesShown, isAllCountries]);

  const hasOtherCountriesBar =
    !isAllCountries && countryChartRows.some((row) => row.isOtherCountries);

  const countryChartHeight = Math.max(
    COUNTRY_CHART_VISIBLE_HEIGHT,
    countryChartRows.length * COUNTRY_ROW_HEIGHT,
  );

  useEffect(() => {
    if (countryScrollRef.current) {
      countryScrollRef.current.scrollTop = 0;
    }
  }, [countriesShown]);

  const countryChartSubtitle = isAllCountries
    ? `Showing all ${sortedCountries.length} represented countries`
    : hasOtherCountriesBar
    ? `Showing top ${COUNTRY_TOP_N[countriesShown] ?? 10} countries plus Other Countries`
    : `Showing top ${COUNTRY_TOP_N[countriesShown] ?? 10} countries`;

  const clearCountryFilters = () => {
    setCountriesShown("Top 10");
    setOtherCountriesOpen(false);

    if (countryScrollRef.current) {
      countryScrollRef.current.scrollTop = 0;
    }
  };

  function CountryTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;

    const row = payload[0].payload;
    const pct = totalCountryLinkedAccounts
      ? ((Number(row.total || 0) / totalCountryLinkedAccounts) * 100).toFixed(1)
      : "0.0";

    if (row.isOtherCountries) {
      return (
        <div style={TIP}>
          <div style={{ fontWeight: 700 }}>Other Countries</div>
          <div>
            {Number(row.total).toLocaleString()} accounts ({pct}%)
          </div>
          <div>{row.includedCountries.length} countries included</div>
        </div>
      );
    }

    const hasBreakdown = row.member_total !== undefined || row.guest_total !== undefined;

    return (
      <div style={TIP}>
        <div style={{ fontWeight: 700 }}>{row.country}</div>
        <div>
          {Number(row.total).toLocaleString()} accounts ({pct}%)
        </div>
        {hasBreakdown && (
          <>
            <div>Members: {Number(row.member_total || 0).toLocaleString()}</div>
            <div>Guests: {Number(row.guest_total || 0).toLocaleString()}</div>
          </>
        )}
      </div>
    );
  }

  const handleStateClick = (state) => {
    const total = Number(state.total || 0);
    const memberTotal = Number(state.member_total || 0);
    const guestTotal = Number(state.guest_total || 0);

    openAccountDrawer({
      state,
      title:
        `Accounts in ${state.name} (${state.code}) — ` +
        `${total.toLocaleString()} total ` +
        `(${memberTotal.toLocaleString()} members · ` +
        `${guestTotal.toLocaleString()} guests)`,
      eyebrow: "State account details",
      emptyMessage: `No accounts were found in ${state.name}.`,
      exportKey: `accounts-${state.code}`,

      request: (dateParams = {}) => analyticsApi.stateAccounts(state.code, dateParams),
    });
  };

  const handleCountryClick = (entry) => {
    const row = entry?.payload ?? entry;
    const country = row?.country;

    if (!country) return;

    openAccountDrawer({
      title: `Accounts in ${country}`,
      eyebrow: "Country account details",
      emptyMessage: `No accounts were found in ${country}.`,
      exportKey: `accounts-${country}`,
      request: (dateParams = {}) =>
        analyticsApi.demographicAccountDetails({
          dimension: "country",
          value: country,
          ...dateParams,
        }),
    });
  };

  const handleCountryBarClick = (entry) => {
    const row = entry?.payload ?? entry;

    if (row?.isOtherCountries) {
      setOtherCountriesOpen(true);
      return;
    }

    handleCountryClick(row);
  };

  const scrollToStateMap = () => {
    stateMapCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const scrollToCountryChart = (view) => {
    if (view) {
      setCountriesShown(view);
      setOtherCountriesOpen(false);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        countryChartRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  };

  const countryBarChart = (
    <BarChart
      data={countryChartRows}
      layout="vertical"
      margin={{ left: 12, right: 44 }}
      barCategoryGap="22%"
    >
      <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />

      <XAxis type="number" stroke={AX} fontSize={11} />

      <YAxis
        type="category"
        dataKey="country"
        stroke={AX}
        fontSize={10}
        width={130}
        interval={0}
        tickLine={false}
      />

      <Tooltip content={<CountryTooltip />} />

      <Bar
        dataKey="total"
        name="Accounts"
        fill="var(--dashboard-muted)"
        radius={[0, 6, 6, 0]}
        maxBarSize={20}
        cursor="pointer"
        onClick={handleCountryBarClick}
        background={(props) => (
          <ClickableBarRow {...props} onRowClick={handleCountryBarClick} />
        )}
      >
        <LabelList
          dataKey="total"
          position="right"
          formatter={(v) => Number(v).toLocaleString()}
          style={{ fontSize: 10, fill: C.text }}
        />
      </Bar>
    </BarChart>
  );

  return (
    <>
      <SectionLabel>Geographic Distribution</SectionLabel>

      {/* ─── Geographic concentration summary ─────────── */}
      <Card
        title="Geographic Concentration"
        sub="How concentrated accounts are by state, country, and USA vs. International"
        action={<ChartInfo id="geographicConcentration" />}
      >
        {extraSummaryLoading && !geoConcentration && (
          <div
            style={{
              color: C.muted,
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            Loading geographic summary…
          </div>
        )}

        <div className="dashboard-kpi-band" style={{ padding: "18px 24px" }}>
          <HoverKpiCard
            index={0}
            label="Top 5 States Share"
            value={
              geoConcentration?.top5_states_pct != null
                ? `${geoConcentration.top5_states_pct}%`
                : "—"
            }
            detail={
              geoConcentration?.top5_states_total != null
                ? `${Number(geoConcentration.top5_states_total).toLocaleString()} accounts`
                : "of all accounts"
            }
            onClick={scrollToStateMap}
            panel={
              topStatesPanelRows.length ? (
                <>
                  <div
                    style={{
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    {Number(geoConcentration.top5_states_total).toLocaleString()} accounts
                    across the top 5 states
                  </div>
                  {topStatesPanelRows.map((row) => (
                    <div
                      key={row.state}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "5px 0",
                        borderTop: `1px solid ${C.border}`,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{row.state}</span>
                      <span>
                        {Number(row.total).toLocaleString()} ({row.pct}%)
                      </span>
                      <span style={{ color: C.muted }}>
                        {Number(row.member_total).toLocaleString()}M /{" "}
                        {Number(row.guest_total).toLocaleString()}G
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <span style={{ color: C.muted }}>No state data available.</span>
              )
            }
          />

          <HoverKpiCard
            index={1}
            label="Top 5 Countries Share"
            value={
              geoConcentration?.top5_countries_pct != null
                ? `${geoConcentration.top5_countries_pct}%`
                : "—"
            }
            detail={
              geoConcentration?.top5_countries_total != null
                ? `${Number(geoConcentration.top5_countries_total).toLocaleString()} accounts`
                : "of all accounts"
            }
            onClick={() => scrollToCountryChart("Top 10")}
            panel={
              topCountriesPanelRows.length ? (
                <>
                  <div
                    style={{
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    {Number(geoConcentration.top5_countries_total).toLocaleString()}{" "}
                    accounts across the top 5 countries
                  </div>
                  {topCountriesPanelRows.map((row) => (
                    <div
                      key={row.country}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "5px 0",
                        borderTop: `1px solid ${C.border}`,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{row.country}</span>
                      <span>
                        {Number(row.total).toLocaleString()} ({row.pct}%)
                      </span>
                      <span style={{ color: C.muted }}>
                        {Number(row.member_total).toLocaleString()}M /{" "}
                        {Number(row.guest_total).toLocaleString()}G
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <span style={{ color: C.muted }}>No country data available.</span>
              )
            }
          />

          <HoverKpiCard
            index={2}
            label="US Accounts"
            value={
              geoConcentration?.domestic_pct != null
                ? `${geoConcentration.domestic_pct}%`
                : "—"
            }
            detail={
              geoConcentration?.domestic_accounts != null
                ? `${Number(geoConcentration.domestic_accounts).toLocaleString()} accounts`
                : undefined
            }
            onClick={scrollToStateMap}
            panel={
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>United States</div>
                <div style={{ padding: "3px 0" }}>
                  {Number(geoConcentration?.domestic_accounts || 0).toLocaleString()} total
                  accounts
                </div>
                <div style={{ padding: "3px 0" }}>
                  {Number(geoConcentration?.domestic_members || 0).toLocaleString()}{" "}
                  members ·{" "}
                  {Number(geoConcentration?.domestic_guests || 0).toLocaleString()} guests
                </div>
                <div style={{ padding: "3px 0", color: C.muted }}>
                  {geoConcentration?.domestic_pct != null
                    ? `${geoConcentration.domestic_pct}%`
                    : "—"}{" "}
                  of accounts with country data
                </div>
              </>
            }
          />

          <HoverKpiCard
            index={3}
            label="International Accounts"
            value={
              geoConcentration?.international_pct != null
                ? `${geoConcentration.international_pct}%`
                : "—"
            }
            detail={
              geoConcentration?.international_accounts != null
                ? `${Number(
                    geoConcentration.international_accounts,
                  ).toLocaleString()} accounts`
                : undefined
            }
            onClick={() => scrollToCountryChart("All countries")}
            panel={
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>International</div>
                <div style={{ padding: "3px 0" }}>
                  {Number(
                    geoConcentration?.international_accounts || 0,
                  ).toLocaleString()}{" "}
                  total accounts
                </div>
                <div style={{ padding: "3px 0" }}>
                  {Number(geoConcentration?.international_members || 0).toLocaleString()}{" "}
                  members ·{" "}
                  {Number(geoConcentration?.international_guests || 0).toLocaleString()}{" "}
                  guests
                </div>
                <div style={{ padding: "3px 0", color: C.muted }}>
                  {Number(
                    geoConcentration?.international_country_count || 0,
                  ).toLocaleString()}{" "}
                  countries represented
                </div>
              </>
            }
          />
        </div>
      </Card>

      <div className="dashboard-grid dashboard-grid-equal">
        <div
          ref={stateMapCardRef}
          style={{
            minWidth: 0,
            height: "100%",
          }}
        >
          <Card
            title="Accounts by State"
            sub="Account concentration across the United States"
            action={<ChartInfo id="accountsByState" />}
            style={{ height: "100%", boxSizing: "border-box" }}
          >
            <AccountsUSMap data={membersByState} onStateClick={handleStateClick} />
          </Card>
        </div>

        <div
          ref={countryChartRef}
          style={{
            minWidth: 0,
            height: "100%",
          }}
        >
          <Card
            title="Accounts by Country"
            sub={countryChartSubtitle}
            action={<ChartInfo id="accountsByCountry" />}
            style={{ height: "100%", boxSizing: "border-box" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="dashboard-eyebrow">Countries shown</span>

                <select
                  value={countriesShown}
                  onChange={(event) => setCountriesShown(event.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    color: C.text,
                    fontSize: 12,
                  }}
                >
                  <option value="Top 5">Top 5</option>
                  <option value="Top 10">Top 10</option>
                  <option value="Top 15">Top 15</option>
                  <option value="Top 20">Top 20</option>
                  <option value="All countries">All countries</option>
                </select>
              </label>

              <button
                type="button"
                onClick={clearCountryFilters}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.bg,
                  color: C.accent2,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
            <div
              ref={countryScrollRef}
              style={{
                height: COUNTRY_CHART_VISIBLE_HEIGHT,
                overflowY:
                  countryChartHeight > COUNTRY_CHART_VISIBLE_HEIGHT ? "auto" : "hidden",
                overflowX: "hidden",
                paddingRight: 4,
              }}
            >
              <div
                style={{
                  height: countryChartHeight,
                  minWidth: 0,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  {countryBarChart}
                </ResponsiveContainer>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Other Countries drilldown — lists the countries folded into
          the "Other Countries" bar; clicking one opens the normal
          account drawer for that country. */}
      {otherCountriesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Other Countries breakdown"
          onMouseDown={() => setOtherCountriesOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1500,
            background: "rgba(27, 38, 50, 0.34)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: 380,
              maxWidth: "90vw",
              maxHeight: "70vh",
              overflowY: "auto",
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 22,
                  color: C.text,
                }}
              >
                Other Countries
              </h3>

              <button
                type="button"
                onClick={() => setOtherCountriesOpen(false)}
                aria-label="Close Other Countries breakdown"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: C.muted,
                  padding: 2,
                  display: "flex",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <p
              style={{
                fontSize: 12,
                color: C.muted,
                marginBottom: 12,
              }}
            >
              Countries outside the current Top view, ranked by account total. Select one
              to view its accounts.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {(
                countryChartRows.find((row) => row.isOtherCountries)?.includedCountries ??
                []
              ).map((row) => (
                <button
                  key={row.country}
                  type="button"
                  onClick={() => {
                    setOtherCountriesOpen(false);
                    handleCountryClick(row);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: "var(--dashboard-panel-alt)",
                    cursor: "pointer",
                    fontSize: 12,
                    color: C.text,
                  }}
                >
                  <span>{row.country}</span>
                  <span>{Number(row.total || 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
