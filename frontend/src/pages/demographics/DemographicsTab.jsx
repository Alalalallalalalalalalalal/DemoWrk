import { useMemo, useRef, useState } from "react";
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    CartesianGrid,
} from "recharts";

import { analyticsApi } from "../../api/analytics";
import { TOOLTIP_STYLE } from "../styles/Dashboardstyles";
import {
    SectionLabel,
    PieLegendCard,
} from "../styles/Dashboardcomponents";

import AccountsUSMap from "./AccountsUSMap";
import StateAccountsModal from "./StateAccountsModal";

/* ─── Shared chart values ───────────────────────────────────── */

const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = TOOLTIP_STYLE;

const MONTHS = [
  "All",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const toDateParams = (filter) => {
  if (filter.mode === "day") {
    return filter.date
      ? {
          date: filter.date,
        }
      : {};
  }

  if (filter.mode === "range") {
    return filter.startDate &&
      filter.endDate
      ? {
          start_date: filter.startDate,
          end_date: filter.endDate,
        }
      : {};
  }

  return {
    year:
      filter.year === "All"
        ? null
        : Number(filter.year),

    month:
      filter.month === "All"
        ? null
        : MONTHS.indexOf(filter.month),
  };
};


/* ─── Local card wrapper ────────────────────────────────────── */

function Card({ title, sub, children }) {
    return (
        <div className="dashboard-card">
        <div className="dashboard-eyebrow">{sub}</div>
        <h2 className="dashboard-card-title">{title}</h2>
        {children}
        </div>
    );
}

function ClickableVisitorDot({
    cx,
    cy,
    payload,
    fill,
    visitorStatus,
    onPointClick,
    }) {
    if (
        cx == null ||
        cy == null ||
        payload?.year == null
    ) {
        return null;
    }

    const handleClick = (event) => {
        event?.stopPropagation?.();

        onPointClick(
        payload.year,
        visitorStatus,
        );
    };

    return (
        <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill}
        stroke="var(--dashboard-card)"
        strokeWidth={2}
        role="button"
        tabIndex={0}
        aria-label={`View ${visitorStatus} Accounts for ${payload.year}`}
        style={{
            cursor: "pointer",
        }}
        onClick={handleClick}
        onKeyDown={(event) => {
            if (
            event.key === "Enter" ||
            event.key === " "
            ) {
            event.preventDefault();
            handleClick(event);
            }
        }}
        />
    );
}

function formatDashboardDate(value) {
    if (!value) {
        return "—";
    }

    const dateText =
        String(value).slice(0, 10);

    const date = new Date(
        `${dateText}T00:00:00`,
    );

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString(
        "en-US",
        {
        year: "numeric",
        month: "short",
        day: "numeric",
        },
    );
}

/* ─── Demographics tab ──────────────────────────────────────── */

export default function DemographicsTab({
    membersByCountry = [],
    membersByState = [],
    membersByGender = [],
    membersByAgeGroup = [],
    accountsByType = [],
    membersByStatus = [],
    membersByMaritalStatus = [],
    newMembersPerYear = [],
    newVsRepeatVisitors = [],
    totalDependents = null,
    dependentsByAgeGroup = [],
    dependentsPerHousehold = [],
    dependentsPerMember = [],
}) {
    const years = useMemo(() => {
        const currentYear =
            new Date().getFullYear();

        return [
            "All",
            ...Array.from(
            {
                length:
                currentYear - 2018 + 1,
            },
            (_, index) =>
                currentYear - index,
            ),
        ];
    }, []);

    const [drawerDateFilter, setDrawerDateFilter] =
        useState({
            mode: "ym",
            year: "All",
            month: "All",
            date: "",
            startDate: "",
            endDate: "",
        });

    /* Account-type toggle */
    const [accountTypeView, setAccountTypeView] = useState("Member");

    /* State-account drawer */
    const [accountDrawer, setAccountDrawer] = useState(null);
    const [accountDetails, setAccountDetails] = useState([]);
    const [accountDetailsLoading, setAccountDetailsLoading,] = useState(false);

    const [accountDetailsError, setAccountDetailsError,] = useState("");

    /* New vs Repeat Accounts chart - interactive legend */
    const [activeVisitorLines, setActiveVisitorLines] = useState({
        total_new: true,
        total_repeat: true,
    });
    const countryChartRef = useRef(null);

    /* ─── Derived account data ────────────────────────────────── */

    const visibleAccountTypes = useMemo(
        () =>
        accountsByType.filter(
            (item) =>
            item.account_category?.trim() ===
            accountTypeView,
        ),
        [accountsByType, accountTypeView],
    );
    const getAccountTotal = (category) =>
        accountsByType
        .filter(
            (item) =>
            item.account_category?.trim() === category,
        )
        .reduce(
            (sum, item) =>
            sum + Number(item.total || 0),
            0,
        );
    const totalMemberAccounts = getAccountTotal("Member");
    const totalGuestAccounts = getAccountTotal("Guest");
    const totalDependentCount = (() => {
        if (
        totalDependents?.total_dependents !==
            undefined &&
        totalDependents?.total_dependents !== null
        ) {
        return Number(
            totalDependents.total_dependents,
        ).toLocaleString();
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

    const loadDrawerAccounts = async (
        drawer,
        dateParams = {},
    ) => {
        if (!drawer?.request) return;

        setAccountDetails([]);
        setAccountDetailsError("");
        setAccountDetailsLoading(true);

        try {
            const data = await drawer.request(
                dateParams,
            );

            setAccountDetails(
                Array.isArray(data) ? data : [],
            );
        } catch (error) {
            console.error(
                `Unable to load ${drawer.title}:`,
                error,
            );

            setAccountDetailsError(
                `${drawer.title} could not be loaded.`,
            );
        } finally {
            setAccountDetailsLoading(false);
        }
    };

    const openAccountDrawer = ({
        title,
        eyebrow,
        emptyMessage,
        exportKey,
        state = null,
        request,
    }) => {
        const drawer = {
            state,
            title,
            eyebrow,
            emptyMessage,
            exportKey,
            request,
        };

        setAccountDrawer(drawer);

        const defaultFilter = {
            mode: "ym",
            year: "All",
            month: "All",
            date: "",
            startDate: "",
            endDate: "",
        };

        setDrawerDateFilter(defaultFilter);

        loadDrawerAccounts(drawer, {});
    };

    const handleDrawerDateChange = (
        nextFilter,
        ) => {
        setDrawerDateFilter(nextFilter);

        if (
            nextFilter.mode === "range" &&
            (
            !nextFilter.startDate ||
            !nextFilter.endDate
            )
        ) {
            return;
        }

        if (
            nextFilter.mode === "day" &&
            !nextFilter.date
        ) {
            return;
        }

        loadDrawerAccounts(
            accountDrawer,
            toDateParams(nextFilter),
        );
    };

    /* ─── State drawer interaction ────────────────────────────── */

    const handleHouseholdClick = (entry) => {
        const row = entry?.payload ?? entry;
        const householdGroup =
            row?.household_group;

        if (!householdGroup) return;

        openAccountDrawer({
            title: `Households — ${householdGroup}`,
            eyebrow: "Dependent household details",
            emptyMessage:
            `No member households were found in ${householdGroup}.`,
            exportKey:
            `households-${householdGroup}`,
            request: (dateParams = {}) =>
            analyticsApi.demographicAccountDetails({
                dimension: "household",
                value: householdGroup,
                ...dateParams,
            }),
        });
        };

    const handleStatusClick = (
        entry,
        category,
        ) => {
        const row = entry?.payload ?? entry;
        const status = row?.status;

        if (!status) return;

        openAccountDrawer({
            title: `${category} Accounts — ${status}`,
            eyebrow: "Account status details",
            emptyMessage:
            `No ${category.toLowerCase()} accounts were found with the status ${status}.`,
            exportKey:
            `${category}-${status}`,
            request: (dateParams = {}) =>
            analyticsApi.demographicAccountDetails({
                dimension: "status",
                value: status,
                category,
                ...dateParams,
            }),
        });
    };

    const handleAccountTypeClick = (entry) => {
        const row = entry?.payload ?? entry;
        const memberType = row?.member_type;

        if (!memberType) return;

        const category =
            row?.account_category ??
            accountTypeView;

        openAccountDrawer({
            title: `${category} Accounts — ${memberType}`,
            eyebrow: "Account type details",
            emptyMessage:
            `No ${category.toLowerCase()} accounts were found for ${memberType}.`,
            exportKey:
            `${category}-${memberType}`,
            request: (dateParams = {}) =>
            analyticsApi.demographicAccountDetails({
                dimension: "account_type",
                value: memberType,
                category,
                ...dateParams,
            }),
        });
        };

    const handleStateClick = (state) => {
        openAccountDrawer({
            state,
            title:
            `Accounts in ${state.name} (${state.code})`,
            eyebrow: "State account details",
            emptyMessage:
            `No accounts were found in ${state.name}.`,
            exportKey:
            `accounts-${state.code}`,

            request: (dateParams = {}) =>
            analyticsApi.stateAccounts(
                state.code,
                dateParams,
            ),
        });
        };

    const handleAccountCategoryClick = (
        category,
        ) => {
        const pluralLabel =
            category === "Member"
            ? "Members"
            : "Guests";

        openAccountDrawer({
            state: null,
            title: `All ${pluralLabel}`,
            eyebrow:
            "Account category details",
            emptyMessage:
            `No ${pluralLabel.toLowerCase()} were found.`,
            exportKey:
            `all-${pluralLabel.toLowerCase()}`,

            request: (dateParams = {}) =>
            analyticsApi.accountCategoryDetails(
                category,
                dateParams,
            ),
        });
        };

    const handleCountryClick = (entry) => {
        const row = entry?.payload ?? entry;
        const country = row?.country;

        if (!country) return;

        openAccountDrawer({
            title: `Accounts in ${country}`,
            eyebrow: "Country account details",
            emptyMessage:
            `No accounts were found in ${country}.`,
            exportKey: `accounts-${country}`,
            request: (dateParams = {}) =>
            analyticsApi.demographicAccountDetails({
                dimension: "country",
                value: country,
                ...dateParams,
            }),
        });
    };

    const closeAccountDrawer = () => {
        setAccountDrawer(null);
        setAccountDetails([]);
        setAccountDetailsError("");
        setAccountDetailsLoading(false);
    };

    const scrollToCountryChart = () => {
        countryChartRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    };

    const handleLegendClick = ({ dataKey }) => {
        if (!dataKey) return;

        setActiveVisitorLines((previous) => ({
            ...previous,
            [dataKey]: !previous[dataKey],
        }));
    };

    const handleVisitorPointClick = (
        year,
        visitorStatus,
        ) => {
        openAccountDrawer({
            title:
            `${visitorStatus} Accounts — ${year}`,

            eyebrow:
            "Account details",

            emptyMessage:
            `No ${visitorStatus.toLowerCase()} Accounts were found for ${year}.`,

            exportKey:
            `${visitorStatus.toLowerCase()}-visitors-${year}`,

            request: () =>
            analyticsApi.newVsRepeatVisitorDetails(
                Number(year),
                visitorStatus,
            ),
        });
        };

        const ClickableBarRow = ({
            x,
            y,
            width,
            height,
            payload,
            onRowClick,
            }) => (
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => onRowClick(payload)}
            />
            );

        const ClickableBarColumn = ({
            x,
            y,
            width,
            height,
            payload,
            category,
            onColumnClick,
            }) => (
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() =>
                category
                    ? onColumnClick(payload, category)
                    : onColumnClick(payload)
                }
            />
            );
    return (
        <>
        <div className="dashboard-section">
            {/* ─── KPI band ──────────────────────────────────────── */}
            <section
            className="dashboard-kpi-band"
            style={{ padding: "24px 28px" }}
            >
            {[
                {
                label: "Total Members",
                value: totalMemberAccounts
                    ? totalMemberAccounts.toLocaleString()
                    : "—",
                detail:
                    "Across all Member account types",
                    onClick: () => handleAccountCategoryClick("Member"),
                },
                {
                label: "Total Guests",
                value: totalGuestAccounts
                    ? totalGuestAccounts.toLocaleString()
                    : "—",
                detail:
                    "Across all Guest account types",
                    onClick: () => handleAccountCategoryClick("Guest"),
                },
                {
                label: "Countries Represented",
                value: membersByCountry.length
                    ? membersByCountry.length.toLocaleString()
                    : "—",
                detail: "Click to view country distribution",
                onClick: scrollToCountryChart,
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
                const KpiElement = clickable
                    ? "button"
                    : "div";

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
                        borderLeft:
                        index > 0
                            ? "1px solid #DDD6CA"
                            : "none",
                        background: "transparent",
                        textAlign: "left",
                        fontFamily: "inherit",
                        cursor: clickable
                        ? "pointer"
                        : "default",
                        borderRadius: clickable ? 10 : 0,
                        transition:
                        "background 0.16s ease, transform 0.16s ease",
                    }}
                    onMouseEnter={
                        clickable
                        ? (event) => {
                            event.currentTarget.style.background =
                                "var(--dashboard-panel-alt)";
                            event.currentTarget.style.transform =
                                "translateY(-1px)";
                            }
                        : undefined
                    }
                    onMouseLeave={
                        clickable
                        ? (event) => {
                            event.currentTarget.style.background =
                                "transparent";
                            event.currentTarget.style.transform =
                                "translateY(0)";
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
                        fontFamily:
                            "'Cormorant Garamond', serif",
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

            {/* ─── Account types ─────────────────────────────────── */}
            <Card
            title="Account Types"
            sub="Distribution of member and guest account types"
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
                onClick={() =>
                    setAccountTypeView("Member")
                }
                style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontFamily:
                    "Inter, system-ui, sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                    accountTypeView === "Member"
                        ? "#2C3B4D"
                        : "transparent",
                    color:
                    accountTypeView === "Member"
                        ? "#FFB162"
                        : "#2C3B4D",
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
                onClick={() =>
                    setAccountTypeView("Guest")
                }
                style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontFamily:
                    "Inter, system-ui, sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                    accountTypeView === "Guest"
                        ? "#2C3B4D"
                        : "transparent",
                    color:
                    accountTypeView === "Guest"
                        ? "#FFB162"
                        : "#2C3B4D",
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
                height: Math.max(
                    220,
                    visibleAccountTypes.length * 34,
                ),
                maxHeight: 460,
                }}
            >
                <ResponsiveContainer
                width="100%"
                height="100%"
                >
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
                    <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    horizontal={false}
                    />
                    <XAxis
                    type="number"
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
                    formatter={(value) => [
                        Number(value).toLocaleString(),
                        accountTypeView === "Member"
                        ? "Members"
                        : "Guests",
                    ]}
                    />
                    <Bar
                        dataKey="total"
                        name="Accounts"
                        fill={
                            accountTypeView === "Member"
                            ? "#FFB162"
                            : "var(--dashboard-truffle)"
                        }
                        radius={[0, 6, 6, 0]}
                        maxBarSize={20}
                        cursor="pointer"
                        onClick={handleAccountTypeClick}
                        background={(props) => (
                            <ClickableBarRow
                            {...props}
                            onRowClick={handleAccountTypeClick}
                            />
                        )}
                        />
                </BarChart>
                </ResponsiveContainer>
            </div>
            </Card>

            {/* ─── Age, gender and marital status ────────────────── */}
            <SectionLabel>
            Age / Gender / Status
            </SectionLabel>
            <div className="dashboard-grid dashboard-grid-3">
            <Card
                title="Age Groups"
                sub="Accounts by age segment"
            >
                <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer>
                    <BarChart data={membersByAgeGroup}>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                    />
                    <XAxis
                        dataKey="age_group"
                        stroke={AX}
                        fontSize={11}
                    />
                    <YAxis
                        stroke={AX}
                        fontSize={11}
                    />
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
            <PieLegendCard
                title="Gender Split"
                description="Male vs Female"
                data={membersByGender}
                dataKey="total"
                nameKey="gender"
                colorMap={{
                M: "var(--dashboard-truffle)",
                F: "var(--dashboard-flame)",
                }}
            />
            <PieLegendCard
                title="Marital Status"
                description="Household composition"
                data={membersByMaritalStatus}
                dataKey="total"
                nameKey="marital_status"
                colorMap={{
                Single: "var(--dashboard-truffle)",
                Married:
                    "var(--dashboard-deep-blue)",
                }}
            />
            </div>

            {/* ─── Member status and growth ──────────────────────── */}
            <SectionLabel>
            Member Status &amp; Growth
            </SectionLabel>
            <div className="dashboard-grid dashboard-grid-side">
            <Card
                title="Member & Guest Status"
                sub="Status comparison between members and guests"
            >
                <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer>
                    <BarChart
                    data={membersByStatus}
                    margin={{
                        top: 5,
                        right: 12,
                        bottom: 0,
                        left: 0,
                    }}
                    barGap={4}
                    >
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                    />
                    <XAxis
                        dataKey="status"
                        stroke={AX}
                        fontSize={11}
                    />
                    <YAxis
                        stroke={AX}
                        fontSize={11}
                        allowDecimals={false}
                    />
                    <Tooltip contentStyle={TIP} />
                    <Legend
                        wrapperStyle={{
                        fontSize: 11,
                        paddingTop: 6,
                        }}
                    />
                    
                    <Bar
                        dataKey="members"
                        name="Members"
                        fill="#FFB162"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) =>
                            handleStatusClick(entry, "Member")
                        }
                        background={(props) => (
                            <ClickableBarColumn
                            {...props}
                            category="Member"
                            onColumnClick={handleStatusClick}
                            />
                        )}
                        />

                    <Bar
                        dataKey="guests"
                        name="Guests"
                        fill="var(--dashboard-truffle)"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) =>
                            handleStatusClick(entry, "Guest")
                        }
                        background={(props) => (
                            <ClickableBarColumn
                            {...props}
                            category="Guest"
                            onColumnClick={handleStatusClick}
                            />
                        )}
                    />
                    <Bar
                        dataKey="guests"
                        name="Guests"
                        fill="var(--dashboard-truffle)"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) =>
                            handleStatusClick(entry, "Guest")
                        }
                    />
                    </BarChart>
                </ResponsiveContainer>
                </div>
            </Card>
            <Card
                title="New Members & Guests per Year"
                sub="Member and guest acquisition over time"
            >
                <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer>
                    <LineChart
                    data={newMembersPerYear}
                    margin={{
                        top: 5,
                        right: 12,
                        bottom: 5,
                        left: 0,
                    }}
                    >
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                    />
                    <XAxis
                        dataKey="year"
                        stroke={AX}
                        fontSize={11}
                        allowDecimals={false}
                    />
                    <YAxis
                        stroke={AX}
                        fontSize={11}
                        allowDecimals={false}
                    />
                    <Tooltip contentStyle={TIP} />
                    <Legend
                        wrapperStyle={{
                        fontSize: 11,
                        paddingTop: 6,
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="members"
                        name="Members"
                        stroke="#FFB162"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="guests"
                        name="Guests"
                        stroke="var(--dashboard-truffle)"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                    />
                    </LineChart>
                </ResponsiveContainer>
                </div>
            </Card>
            </div>

            <div>
                <Card
                    title="New vs Repeat Guests & Members"
                    sub="First-time accounts compared with returning visitors by year"
                    >
                    <div className="dashboard-chart dashboard-chart-200">
                        <ResponsiveContainer>
                        <LineChart
                            data={newVsRepeatVisitors}
                            margin={{
                            top: 5,
                            right: 12,
                            bottom: 5,
                            left: 0,
                            }}
                        >
                            <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={GRID}
                            />

                            <XAxis
                            dataKey="year"
                            stroke={AX}
                            fontSize={11}
                            allowDecimals={false}
                            />

                            <YAxis
                                stroke={AX}
                                fontSize={11}
                                allowDecimals={false}
                                includeHidden
                                domain={[0, "auto"]}
                            />

                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) {
                                    return null;
                                    }

                                    const row = payload[0]?.payload;

                                    if (!row) {
                                    return null;
                                    }

                                    const format = (value) =>
                                    Number(value ?? 0).toLocaleString();

                                    return (
                                    <div
                                        style={{
                                        ...TIP,
                                        minWidth: 180,
                                        padding: "8px 10px",
                                        fontSize: 11,
                                        }}
                                    >
                                        <div
                                        style={{
                                            fontWeight: 700,
                                            marginBottom: 6,
                                        }}
                                        >
                                        Year: {label}
                                        </div>

                                        {/* New Accounts */}
                                        <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr auto",
                                            gap: "3px 12px",
                                            paddingBottom: 6,
                                            borderBottom: "1px solid #DDD6CA",
                                        }}
                                        >
                                        <strong>New</strong>

                                        <strong>
                                            {format(row.total_new)}
                                        </strong>

                                        <span>Members</span>
                                        <span>{format(row.new_members)}</span>

                                        <span>Guests</span>
                                        <span>{format(row.new_guests)}</span>
                                        </div>

                                        {/* Repeat Accounts */}
                                        <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr auto",
                                            gap: "3px 12px",
                                            paddingTop: 6,
                                        }}
                                        >
                                        <strong>Repeat</strong>

                                        <strong>
                                            {format(row.total_repeat)}
                                        </strong>

                                        <span>Members</span>
                                        <span>{format(row.repeat_members)}</span>

                                        <span>Guests</span>
                                        <span>{format(row.repeat_guests)}</span>
                                        <span style={{ color: "#2563eb", fontStyle: "italic" }}>click points to view accounts</span>
                                        </div>
                                    </div>
                                    );
                                }}
                                />

                            <Legend
                                onClick={handleLegendClick}
                                wrapperStyle={{
                                    fontSize: 11,
                                    paddingTop: 6,
                                    cursor: "pointer",
                                }}
                                formatter={(value, entry) => {
                                    const isVisible =
                                    activeVisitorLines[
                                        entry.dataKey
                                    ];

                                    return (
                                    <span
                                        style={{
                                        color: isVisible
                                            ? "var(--dashboard-abyssal)"
                                            : "#dc1010",
                                        opacity: isVisible ? 1 : 0.45,
                                        textDecoration: isVisible
                                            ? "none"
                                            : "line-through",
                                        cursor: "pointer",
                                        }}
                                    >
                                        {value}
                                    </span>
                                    );
                                }}
                                />

                            <Line
                                type="monotone"
                                dataKey="total_new"
                                name="New Accounts"
                                stroke="#FFB162"
                                strokeWidth={2.5}
                                hide={!activeVisitorLines.total_new}
                                dot={(props) => (
                                    <ClickableVisitorDot
                                    {...props}
                                    fill="#FFB162"
                                    visitorStatus="New"
                                    onPointClick={
                                        handleVisitorPointClick
                                    }
                                    />
                                )}
                                activeDot={(props) => (
                                    <ClickableVisitorDot
                                    {...props}
                                    fill="#FFB162"
                                    visitorStatus="New"
                                    onPointClick={
                                        handleVisitorPointClick
                                    }
                                    />
                                )}
                                />

                                <Line
                                type="monotone"
                                dataKey="total_repeat"
                                name="Repeat Accounts"
                                stroke="var(--dashboard-truffle)"
                                strokeWidth={2.5}
                                hide={
                                    !activeVisitorLines.total_repeat
                                }
                                dot={(props) => (
                                    <ClickableVisitorDot
                                    {...props}
                                    fill="var(--dashboard-truffle)"
                                    visitorStatus="Repeat"
                                    onPointClick={
                                        handleVisitorPointClick
                                    }
                                    />
                                )}
                                activeDot={(props) => (
                                    <ClickableVisitorDot
                                    {...props}
                                    fill="var(--dashboard-truffle)"
                                    visitorStatus="Repeat"
                                    onPointClick={
                                        handleVisitorPointClick
                                    }
                                    />
                                )}
                                />
                        </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ textAlign: "center" }}>
                    <span
                    style={{
                    color: "#6b7280",
                    fontStyle: "italic",
                    fontSize: "12px",
                    }}
                    >
                        click legend to focus
                    </span></div>
                    </Card>
            </div>

            {/* ─── Geographic distribution ───────────────────────── */}
            <SectionLabel>
            Geographic Distribution
            </SectionLabel>

            <div className="dashboard-grid dashboard-grid-equal">
            <Card
                title="Accounts by State"
                sub="Account concentration across the United States"
            >
                <AccountsUSMap
                data={membersByState}
                onStateClick={handleStateClick}
                />
            </Card>

            <div ref={countryChartRef}>
                <Card
                title="Accounts by Country"
                sub="Click a country to view its accounts"
                >
                <div
                    className="dashboard-chart"
                    style={{
                    height: Math.max(
                        260,
                        membersByCountry.length * 30,
                    ),
                    maxHeight: 318,
                    }}
                >
                    <ResponsiveContainer
                    width="100%"
                    height="100%"
                    >
                    <BarChart
                        data={membersByCountry}
                        layout="vertical"
                        margin={{ left: 12 }}
                        barCategoryGap="22%"
                    >
                        <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                        horizontal={false}
                        />

                        <XAxis
                        type="number"
                        stroke={AX}
                        fontSize={11}
                        />

                        <YAxis
                        type="category"
                        dataKey="country"
                        stroke={AX}
                        fontSize={10}
                        width={115}
                        interval={0}
                        tickLine={false}
                        />

                        <Tooltip contentStyle={TIP} />

                        <Bar
                            dataKey="total"
                            name="Accounts"
                            fill="var(--dashboard-muted)"
                            radius={[0, 6, 6, 0]}
                            maxBarSize={20}
                            cursor="pointer"
                            onClick={handleCountryClick}
                            background={(props) => (
                                <ClickableBarRow
                                {...props}
                                onRowClick={handleCountryClick}
                                />
                            )}
                            />
                    </BarChart>
                    </ResponsiveContainer>
                </div>
                </Card>
            </div>
            </div>

            {/* ─── Household and dependents ──────────────────────── */}
            <SectionLabel>
            Household &amp; Dependents
            </SectionLabel>
            <div className="dashboard-grid dashboard-grid-equal">
            <Card
                title="Dependents by Age Group"
                sub="Linked to member folios"
            >
                <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer>
                    <BarChart
                    data={dependentsByAgeGroup}
                    >
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                    />
                    <XAxis
                        dataKey="age_group"
                        stroke={AX}
                        fontSize={11}
                    />
                    <YAxis
                        stroke={AX}
                        fontSize={11}
                    />
                    <Tooltip contentStyle={TIP} />
                    <Bar
                        dataKey="total"
                        fill="#A35139"
                        radius={[6, 6, 0, 0]}
                    />
                    </BarChart>
                </ResponsiveContainer>
                </div>
            </Card>
            <Card
                title="Dependents per Household"
                sub="Distribution of linked dependents across member households"
            >
                <div className="dashboard-chart dashboard-chart-200">
                <ResponsiveContainer
                    width="100%"
                    height="100%"
                >
                    <BarChart
                    data={dependentsPerHousehold}
                    margin={{
                        top: 6,
                        right: 12,
                        bottom: 8,
                        left: 0,
                    }}
                    >
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={GRID}
                        vertical={false}
                    />
                    <XAxis
                        dataKey="household_group"
                        stroke={AX}
                        fontSize={10}
                        interval={0}
                        tickLine={false}
                    />
                    <YAxis
                        stroke={AX}
                        fontSize={11}
                        allowDecimals={false}
                    />
                    <Tooltip
                        contentStyle={TIP}
                        formatter={(value) => [
                        Number(value).toLocaleString(),
                        "Households",
                        ]}
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
                            <ClickableBarColumn
                            {...props}
                            onColumnClick={handleHouseholdClick}
                            />
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
                    <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    />
                    <XAxis
                    dataKey="member_number"
                    stroke={AX}
                    fontSize={11}
                    angle={-15}
                    textAnchor="end"
                    height={55}
                    />
                    <YAxis
                    stroke={AX}
                    fontSize={11}
                    allowDecimals={false}
                    />
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
        </div>

        {/* State-account drawer */}
        <StateAccountsModal
            isOpen={Boolean(accountDrawer)}
            state={accountDrawer?.state ?? null}
            title={accountDrawer?.title ?? ""}
            eyebrow={
                accountDrawer?.eyebrow ??
                "Account details"
            }
            emptyMessage={
                accountDrawer?.emptyMessage ?? ""
            }
            exportKey={
                accountDrawer?.exportKey ??
                "accounts"
            }
            accounts={accountDetails}
            loading={accountDetailsLoading}
            error={accountDetailsError}
            onClose={closeAccountDrawer}
            dateFilter={drawerDateFilter}
            onDateFilterChange={
                handleDrawerDateChange
            }
            years={years}
            months={MONTHS}
            />

            
        </>
    );
}