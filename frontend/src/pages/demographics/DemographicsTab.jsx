import { useEffect, useMemo, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    LabelList,
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
import DateFilterBar from "./DemographicsDateFilter";
import NewVsRepeatFilterBar, {
    DEFAULT_VISITOR_FILTER,
} from "./NewVsRepeatFilterBar";

/* ─── Shared chart values ───────────────────────────────────── */

const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = TOOLTIP_STYLE;

const C = {
    bg: "var(--dashboard-card)",
    border: "var(--dashboard-border)",
    text: "var(--dashboard-abyssal)",
    muted: "var(--dashboard-muted)",
    soft: "var(--dashboard-text-soft)",
    accent: "var(--dashboard-deep-blue)",
    accent2: "var(--dashboard-truffle)",
};

const CHART_INFO = {
    accountTypes: {
        summary:
            "Shows how member and guest accounts are distributed across the club's different account types.",
        functionality:
            "Switch between Members and Guests, hover for exact totals, and click a bar to open the matching accounts.",
        x: "Number of accounts",
        y: "Account type",
    },
    ageGroups: {
        summary:
            "Groups accounts into age ranges to show the age composition of the club's member and guest population.",
        functionality:
            "Hover over a bar to view the exact number of accounts in each age group.",
        x: "Age group",
        y: "Number of accounts",
    },
    genderSplit: {
        summary:
            "Shows the proportional distribution of accounts by recorded gender.",
        functionality:
            "Hover over a slice or review the legend to compare the gender categories.",
        x: null,
        y: null,
    },
    maritalStatus: {
        summary:
            "Shows how accounts are distributed across the recorded marital-status categories.",
        functionality:
            "Hover over a slice or review the legend to compare marital-status categories.",
        x: null,
        y: null,
    },
    memberGuestStatus: {
        summary:
            "Compares the current account statuses of members and guests.",
        functionality:
            "Hover for exact totals and click a Member or Guest bar to open accounts with that status.",
        x: "Account status",
        y: "Number of accounts",
    },
    newMembersGuests: {
        summary:
            "Tracks the number of members and guests first added during each year.",
        functionality:
            "Hover over a point for the annual total and use the legend to distinguish members from guests.",
        x: "Year first added",
        y: "Number of new accounts",
    },
    newVsRepeatVisitors: {
        summary:
            "Compares newly acquired accounts with returning accounts over time.",
        functionality:
            "Click a legend item to show or hide a line. Hover for totals or click a point to open matching account records. Use Years shown / Ending year for a rolling annual window, All years for the full history, or switch to Custom Range to inspect a specific month-to-month span (up to 24 months, can cross a calendar year).",
        x: "Period",
        y: "Number of accounts",
    },
    accountsByState: {
        summary:
            "Shows the geographic distribution of accounts across US states.",
        functionality:
            "Hover a state for its account total, member/guest split and percentages. Select a state to open the accounts associated with it.",
        x: null,
        y: null,
    },
    accountsByCountry: {
        summary:
            "Shows the countries represented by member and guest accounts.",
        functionality:
            "Choose how many countries to display, hover for exact totals, percentages and the member/guest split, and click a country bar (or Other Countries) to view more detail.",
        x: "Number of accounts",
        y: "Country",
    },
    dependentsByAge: {
        summary:
            "Groups registered dependents into age ranges to show the age composition of linked family accounts.",
        functionality:
            "Hover over a bar to see the exact number of dependents in each age group.",
        x: "Dependent age group",
        y: "Number of dependents",
    },
    dependentsPerHousehold: {
        summary:
            "Shows how households are distributed by their number of registered dependents.",
        functionality:
            "Hover for the household total and click a bar to open households in that group.",
        x: "Dependents in household",
        y: "Number of households",
    },
    topMembersByDependents: {
        summary:
            "Ranks member accounts with the highest number of registered dependents.",
        functionality:
            "Hover over a bar for the exact dependent count associated with each member account.",
        x: "Member account",
        y: "Number of dependents",
    },
    dataCompleteness: {
        summary:
            "Shows what share of accounts are missing key demographic fields, such as age, gender, country, marital status, and join (since) date.",
        functionality:
            "Hover over a bar to see the exact count and percentage of accounts missing that field.",
        x: "Percent of accounts missing",
        y: "Field",
    },
    householdComposition: {
        summary:
            "Summarizes member households by whether they have any registered dependents, plus the average and largest household sizes.",
        functionality:
            "These are summary statistics calculated across all member accounts.",
        x: null,
        y: null,
    },
    geographicConcentration: {
        summary:
            "Shows how concentrated accounts are geographically — the share coming from the top 5 states and top 5 countries, and the US vs. International account split.",
        functionality:
            "Hover a card for the underlying breakdown; click a card to jump to the related map or chart (Top 5 Countries and International Accounts also switch the country chart's view).",
        x: null,
        y: null,
    },
};

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

/* New vs Repeat: maps the "Years shown" label to a span (in years). */
const YEARS_SHOWN_SPAN = {
    "Past 5 years": 5,
    "Past 10 years": 10,
    "Past 15 years": 15,
    "Past 20 years": 20,
};

/* Accounts by Country: maps the "Countries shown" label to a count. */
const COUNTRY_TOP_N = {
    "Top 5": 5,
    "Top 10": 10,
    "Top 15": 15,
    "Top 20": 20,
};

const COUNTRY_CHART_VISIBLE_HEIGHT = 288;
const COUNTRY_ROW_HEIGHT = 32;

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

const toVisitorParams = (filter, currentYr) => {
    if (filter.mode === "range") {
        if (
            !filter.startMonth ||
            !filter.startYear ||
            !filter.endMonth ||
            !filter.endYear
        ) {
            return null;
        }

        return {
            start_year: Number(filter.startYear),
            start_month: Number(filter.startMonth),
            end_year: Number(filter.endYear),
            end_month: Number(filter.endMonth),
        };
    }

    // Year mode
    if (filter.yearsShown === "All years") {
        return {};
    }

    const span = YEARS_SHOWN_SPAN[filter.yearsShown] ?? 10;

    const endYear =
        filter.endingYear === "Latest year"
            ? currentYr
            : Number(filter.endingYear);

    const startYear = endYear - span + 1;

    return { start_year: startYear, end_year: endYear };
};


/* ─── Local card wrapper ────────────────────────────────────── */

function ChartInfo({ id }) {
    const [open, setOpen] = useState(false);
    const info = CHART_INFO[id];

    if (!info) return null;

    return (
        <div style={{ position: "relative", display: "inline-flex" }}>
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-label="Chart information"
                aria-expanded={open}
                style={{
                    background: "none",
                    border: "none",
                    padding: 4,
                    cursor: "pointer",
                    color: open ? C.accent2 : C.muted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 6,
                    transition: "color 0.15s ease",
                }}
                onMouseEnter={(event) => {
                    event.currentTarget.style.color = C.accent2;
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.color = open
                        ? C.accent2
                        : C.muted;
                }}
            >
                <Info size={15} />
            </button>

            {open && (
                <>
                    <div
                        onClick={() => setOpen(false)}
                        style={{ position: "fixed", inset: 0, zIndex: 49 }}
                    />

                    <div
                        role="dialog"
                        aria-label="Chart explanation"
                        style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            right: 0,
                            zIndex: 50,
                            width: 280,
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            borderRadius: 14,
                            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.14)",
                            padding: "14px 16px",
                            fontSize: 12,
                            color: C.soft,
                            lineHeight: 1.55,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close chart information"
                            style={{
                                position: "absolute",
                                top: 8,
                                right: 8,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: C.muted,
                                padding: 2,
                                display: "flex",
                            }}
                        >
                            <X size={13} />
                        </button>

                        <p
                            style={{
                                margin: "0 0 10px",
                                color: C.text,
                                fontSize: 12,
                                paddingRight: 16,
                            }}
                        >
                            {info.summary}
                        </p>

                        {(info.x || info.y) && (
                            <div
                                style={{
                                    borderTop: `1px solid ${C.border}`,
                                    paddingTop: 10,
                                    marginBottom: 10,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 5,
                                }}
                            >
                                {info.x && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <span
                                            style={{
                                                fontWeight: 700,
                                                color: C.accent2,
                                                minWidth: 14,
                                                fontSize: 11,
                                            }}
                                        >
                                            X
                                        </span>
                                        <span>{info.x}</span>
                                    </div>
                                )}

                                {info.y && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <span
                                            style={{
                                                fontWeight: 700,
                                                color: C.accent,
                                                minWidth: 14,
                                                fontSize: 11,
                                            }}
                                        >
                                            Y
                                        </span>
                                        <span>{info.y}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div
                            style={{
                                borderTop: `1px solid ${C.border}`,
                                paddingTop: 10,
                                color: C.muted,
                                fontSize: 11,
                            }}
                        >
                            {info.functionality}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function Card({ title, sub, children, action, style }) {
    return (
        <div className="dashboard-card" style={style}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    marginBottom: 14,
                }}
            >
                <div>
                    <div className="dashboard-eyebrow">{sub}</div>
                    <h2 className="dashboard-card-title">{title}</h2>
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

/* ─── Lightweight KPI strip for summary stats (household composition) ── */
function MiniKpiBand({ items }) {
    return (
        <div
            className="dashboard-kpi-band"
            style={{ padding: "18px 24px", marginBottom: 18 }}
        >
            {items.map((item, index) => (
                <div
                    key={item.label}
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 4,
                        padding: "0 22px",
                        borderLeft:
                            index > 0
                                ? "1px solid #DDD6CA"
                                : "none",
                    }}
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
                            fontSize: 26,
                            lineHeight: 1.1,
                            color: "#1B2632",
                        }}
                    >
                        {item.value}
                    </span>

                    {item.detail && (
                        <span
                            style={{
                                fontSize: 11,
                                color: "#A35139",
                            }}
                        >
                            {item.detail}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

function HoverKpiCard({ label, value, detail, onClick, panel, index }) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                position: "relative",
                padding: "0 22px",
                borderLeft: index > 0 ? "1px solid #DDD6CA" : "none",
            }}
        >
            <button
                type="button"
                onClick={onClick}
                onFocus={() => setHovered(true)}
                onBlur={() => setHovered(false)}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    fontFamily: "inherit",
                    cursor: onClick ? "pointer" : "default",
                    padding: "6px 4px",
                    borderRadius: 10,
                    width: "100%",
                    transition: "background 0.16s ease",
                }}
                onMouseDown={(event) => event.preventDefault()}
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
                    {label}
                </span>

                <span
                    style={{
                        fontFamily: "'Cormorant Garamond', serif",
                        fontSize: 26,
                        lineHeight: 1.1,
                        color: "#1B2632",
                    }}
                >
                    {value}
                </span>

                {detail && (
                    <span style={{ fontSize: 11, color: "#A35139" }}>
                        {detail}
                    </span>
                )}
            </button>

            {hovered && panel && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 45,
                        width: 300,
                        maxHeight: 300,
                        overflowY: "auto",
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.16)",
                        padding: 12,
                        fontSize: 11,
                        color: C.text,
                    }}
                >
                    {panel}
                </div>
            )}
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
        !payload?.period_start ||
        !payload?.period_end
    ) {
        return null;
    }

    const handleClick = (event) => {
        event?.stopPropagation?.();

        onPointClick({
            visitorStatus,
            periodStart: payload.period_start,
            periodEnd: payload.period_end,
            periodLabel: payload.period_label,
        });
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
            aria-label={
                `View ${visitorStatus} accounts ` +
                `for ${payload.period_label}`
            }
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
    totalDependents = null,
    dependentsByAgeGroup = [],
    dependentsPerHousehold = [],
    dependentsPerMember = [],
}) {
    const currentYear = useMemo(() => new Date().getFullYear(), []);

    const years = useMemo(() => {
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
    }, [currentYear]);

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

    const [visitorChartFilter, setVisitorChartFilter] =
        useState(DEFAULT_VISITOR_FILTER);

    const [visitorYearsAvailable, setVisitorYearsAvailable] =
        useState([]);

    const [visitorChartData, setVisitorChartData] =
        useState([]);

    const [visitorChartLoading, setVisitorChartLoading] =
        useState(false);

    useEffect(() => {
        let cancelled = false;

        analyticsApi
            .newVsRepeatVisitors({})
            .then((data) => {
                if (cancelled) return;

                const rowsArray = Array.isArray(data) ? data : [];

                const uniqueYears = Array.from(
                    new Set(
                        rowsArray
                            .map((row) => Number(row.year))
                            .filter(
                                (year) =>
                                    Number.isFinite(year) &&
                                    year <= currentYear,
                            ),
                    ),
                ).sort((a, b) => b - a);

                setVisitorYearsAvailable(uniqueYears);
            })
            .catch((error) => {
                console.error(
                    "Unable to load available years for New vs Repeat chart:",
                    error,
                );
            });

        return () => {
            cancelled = true;
        };
    }, [currentYear]);

    useEffect(() => {
        let cancelled = false;

        const loadVisitorChart = async () => {
            const params = toVisitorParams(
                visitorChartFilter,
                currentYear,
            );

            if (params === null) {
                // Custom Range selected but not yet applied — wait.
                return;
            }

            setVisitorChartLoading(true);

            try {
                const data =
                    await analyticsApi.newVsRepeatVisitors(params);

                if (!cancelled) {
                    const rowsArray = Array.isArray(data)
                        ? data
                        : [];

                    const capped =
                        visitorChartFilter.mode === "range"
                            ? rowsArray
                            : rowsArray.filter(
                                  (row) =>
                                      Number(row.year) <= currentYear,
                              );

                    setVisitorChartData(capped);
                }
            } catch (error) {
                console.error(
                    "Unable to load New vs Repeat chart:",
                    error,
                );

                if (!cancelled) {
                    setVisitorChartData([]);
                }
            } finally {
                if (!cancelled) {
                    setVisitorChartLoading(false);
                }
            }
        };

        loadVisitorChart();

        return () => {
            cancelled = true;
        };
    }, [visitorChartFilter, currentYear]);

    const visitorChartSubtitle = useMemo(() => {
        if (visitorChartLoading && !visitorChartData.length) {
            return "Loading account history…";
        }

        if (!visitorChartData.length) {
            return "No account history available for this range.";
        }

        if (visitorChartFilter.mode === "range") {
            const first = visitorChartData[0];
            const last =
                visitorChartData[visitorChartData.length - 1];
            const numMonths = visitorChartData.length;

            return (
                `Monthly seasonal trend · ${first.period_label}` +
                `–${last.period_label} · ${numMonths} month${
                    numMonths === 1 ? "" : "s"
                }`
            );
        }

        const dataYears = visitorChartData
            .map((row) => Number(row.year))
            .filter((year) => Number.isFinite(year));

        const rangeStart = Math.min(...dataYears);
        const rangeEnd = Math.max(...dataYears);

        if (visitorChartFilter.yearsShown === "All years") {
            return `Showing all available years · ${rangeStart}–${rangeEnd}`;
        }

        return `Showing the ${visitorChartFilter.yearsShown.toLowerCase()} · ${rangeStart}–${rangeEnd}`;
    }, [visitorChartData, visitorChartFilter, visitorChartLoading]);

    const visitorAxisInterval = useMemo(() => {
        const numPoints = visitorChartData.length;

        if (visitorChartFilter.mode === "range") {
            if (numPoints <= 12) return 0;
            if (numPoints <= 18) return 1;
            return 2;
        }

        if (
            visitorChartFilter.mode === "year" &&
            visitorChartFilter.yearsShown === "All years"
        ) {
            return Math.max(0, Math.ceil(numPoints / 12) - 1);
        }

        if (numPoints <= 15) return 0;
        if (numPoints <= 20) return 1;

        return Math.max(1, Math.ceil(numPoints / 12) - 1);
    }, [visitorChartData, visitorChartFilter]);

    const stateMapCardRef = useRef(null);
    const countryChartRef = useRef(null);
    const countryScrollRef = useRef(null);

    /* Accounts by Country: Top N / All Countries selector */
    const [countriesShown, setCountriesShown] = useState("Top 10");
    const [otherCountriesOpen, setOtherCountriesOpen] = useState(false);

    /* ─── Data completeness / household / geo summaries ────── */
    const [completeness, setCompleteness] = useState(null);
    const [householdSummary, setHouseholdSummary] = useState(null);
    const [geoConcentration, setGeoConcentration] = useState(null);
    const [extraSummaryLoading, setExtraSummaryLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadExtraSummary = async () => {
            setExtraSummaryLoading(true);

            try {
                const data =
                    await analyticsApi.demographicsSummary();

                if (!cancelled) {
                    setCompleteness(
                        data.dataCompleteness ?? null,
                    );
                    setHouseholdSummary(
                        data.householdComposition ?? null,
                    );
                    setGeoConcentration(
                        data.geographicConcentration ?? null,
                    );
                }
            } catch (error) {
                console.error(
                    "Unable to load demographics summary extras:",
                    error,
                );
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

    /* 1. Demographic data completeness — turn missing_* counts into a
       chart-friendly array of { field, missing, pct }. */
    const completenessRows = useMemo(() => {
        if (!completeness) return [];

        const total = Number(completeness.total_accounts || 0);
        if (!total) return [];

        const fields = [
            { key: "missing_age", label: "Age" },
            { key: "missing_gender", label: "Gender" },
            { key: "missing_country", label: "Country" },
            {
                key: "missing_marital_status",
                label: "Marital Status",
            },
            { key: "missing_since_date", label: "Since Date" },
        ];

        return fields.map((f) => {
            const missing = Number(completeness[f.key] || 0);

            return {
                field: f.label,
                missing,
                pct: Number(
                    ((missing / total) * 100).toFixed(1),
                ),
            };
        });
    }, [completeness]);

    /* 2. Household composition KPI items */
    const householdKpiItems = [
        {
            label: "Accounts w/o Dependents",
            value: householdSummary
                ? Number(
                    householdSummary.accounts_no_dependents ||
                        0,
                ).toLocaleString()
                : "—",
        },
        {
            label: "Accounts w/ Dependents",
            value: householdSummary
                ? Number(
                    householdSummary.accounts_with_dependents ||
                        0,
                ).toLocaleString()
                : "—",
        },
        {
            label: "Avg Dependents / Household",
            value:
                householdSummary?.avg_dependents_per_household !=
                null
                    ? Number(
                        householdSummary
                            .avg_dependents_per_household,
                    ).toFixed(2)
                    : "—",
        },
        {
            label: "Largest Household",
            value:
                householdSummary?.largest_household_size != null
                    ? Number(
                        householdSummary
                            .largest_household_size,
                    ).toLocaleString()
                    : "—",
            detail: "dependents",
        },
    ];

    /* 3. Geographic Concentration: hover-panel data, derived from the
       new top5_states / top5_countries arrays returned by
       /demographics-summary. */
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

    const sortedCountries = useMemo(
        () =>
            [...membersByCountry].sort(
                (a, b) =>
                    Number(b.total || 0) - Number(a.total || 0),
            ),
        [membersByCountry],
    );

    const totalCountryLinkedAccounts = useMemo(
        () =>
            sortedCountries.reduce(
                (sum, item) => sum + Number(item.total || 0),
                0,
            ),
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

        const otherTotal = rest.reduce(
            (sum, item) => sum + Number(item.total || 0),
            0,
        );
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

    const hasOtherCountriesBar = !isAllCountries &&
        countryChartRows.some((row) => row.isOtherCountries);

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
        ? `Showing top ${
              COUNTRY_TOP_N[countriesShown] ?? 10
          } countries plus Other Countries`
        : `Showing top ${
              COUNTRY_TOP_N[countriesShown] ?? 10
          } countries`;

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
            ? (
                  (Number(row.total || 0) /
                      totalCountryLinkedAccounts) *
                  100
              ).toFixed(1)
            : "0.0";

        if (row.isOtherCountries) {
            return (
                <div style={TIP}>
                    <div style={{ fontWeight: 700 }}>
                        Other Countries
                    </div>
                    <div>
                        {Number(row.total).toLocaleString()} accounts
                        ({pct}%)
                    </div>
                    <div>
                        {row.includedCountries.length} countries
                        included
                    </div>
                </div>
            );
        }

        const hasBreakdown =
            row.member_total !== undefined ||
            row.guest_total !== undefined;

        return (
            <div style={TIP}>
                <div style={{ fontWeight: 700 }}>{row.country}</div>
                <div>
                    {Number(row.total).toLocaleString()} accounts (
                    {pct}%)
                </div>
                {hasBreakdown && (
                    <>
                        <div>
                            Members:{" "}
                            {Number(
                                row.member_total || 0,
                            ).toLocaleString()}
                        </div>
                        <div>
                            Guests:{" "}
                            {Number(
                                row.guest_total || 0,
                            ).toLocaleString()}
                        </div>
                    </>
                )}
            </div>
        );
    }

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
        showDateFilter = true,
    }) => {
        const drawer = {
            state,
            title,
            eyebrow,
            emptyMessage,
            exportKey,
            request,
            showDateFilter,
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

    const handleCountryBarClick = (entry) => {
        const row = entry?.payload ?? entry;

        if (row?.isOtherCountries) {
            setOtherCountriesOpen(true);
            return;
        }

        handleCountryClick(row);
    };

    const closeAccountDrawer = () => {
        setAccountDrawer(null);
        setAccountDetails([]);
        setAccountDetailsError("");
        setAccountDetailsLoading(false);
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

    const scrollToStateMap = () => {
        stateMapCardRef.current?.scrollIntoView({
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

    const handleVisitorPointClick = ({
        visitorStatus,
        periodStart,
        periodEnd,
        periodLabel,
    }) => {
        openAccountDrawer({
            title:
                `${visitorStatus} Accounts — ` +
                periodLabel,

            eyebrow:
                "Account details",

            emptyMessage:
                `No ${visitorStatus.toLowerCase()} ` +
                `accounts were found for ${periodLabel}.`,

            exportKey:
                `${visitorStatus.toLowerCase()}-visitors-` +
                periodLabel,

            showDateFilter: false,

            request: () =>
                analyticsApi.newVsRepeatVisitorDetails({
                    visitorStatus,
                    periodStart,
                    periodEnd,
                }),
        });
    };

    const countryBarChart = (
        <BarChart
            data={countryChartRows}
            layout="vertical"
            margin={{ left: 12, right: 44 }}
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
                    <ClickableBarRow
                        {...props}
                        onRowClick={handleCountryBarClick}
                    />
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
                        height: Math.max(
                            200,
                            completenessRows.length * 42,
                        ),
                    }}
                >
                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                    >
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
                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke={GRID}
                                horizontal={false}
                            />

                            <XAxis
                                type="number"
                                stroke={AX}
                                fontSize={11}
                                domain={[0, 100]}
                                tickFormatter={(value) =>
                                    `${value}%`
                                }
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
                                formatter={(
                                    value,
                                    name,
                                    props,
                                ) => [
                                    `${value}% (${Number(
                                        props.payload.missing,
                                    ).toLocaleString()} accounts)`,
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

            {/* ─── Account types ─────────────────────────────────── */}
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
                action={<ChartInfo id="ageGroups" />}
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
                    <Tooltip contentStyle={TIP}/>
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
                    Married:
                        "var(--dashboard-deep-blue)",
                    }}
                />
            </div>
            </div>

            {/* ─── Member status and growth ──────────────────────── */}
            <SectionLabel>
            Member Status &amp; Growth
            </SectionLabel>
            <div className="dashboard-grid dashboard-grid-side">
            <Card
                title="Member & Guest Status"
                sub="Status comparison between members and guests"
                action={<ChartInfo id="memberGuestStatus" />}
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
                    />
                    </BarChart>
                </ResponsiveContainer>
                </div>
            </Card>
            <Card
                title="New Members & Guests per Year"
                sub="Member and guest acquisition over time"
                action={<ChartInfo id="newMembersGuests" />}
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
                    sub={visitorChartSubtitle}
                    action={
                        <ChartInfo id="newVsRepeatVisitors" />
                    }
                >
                    <NewVsRepeatFilterBar
                        value={visitorChartFilter}
                        onChange={setVisitorChartFilter}
                        yearsAvailable={visitorYearsAvailable}
                        currentYear={currentYear}
                    />

                    {visitorChartLoading && (
                        <div
                            style={{
                                color: C.muted,
                                fontSize: 12,
                                marginBottom: 8,
                            }}
                        >
                            Updating chart…
                        </div>
                    )}

                    <div
                        className="dashboard-chart"
                        style={{
                            height: 280,
                        }}
                    >
                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                        >
                            <LineChart
                                data={visitorChartData}
                                margin={{
                                    top: 10,
                                    right: 20,
                                    bottom: 10,
                                    left: 0,
                                }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke={GRID}
                                />

                                <XAxis
                                    dataKey="period_label"
                                    stroke={AX}
                                    fontSize={11}
                                    interval={visitorAxisInterval}
                                />

                                <YAxis
                                    stroke={AX}
                                    fontSize={11}
                                    allowDecimals={false}
                                />

                                <Tooltip
                                    contentStyle={TIP}
                                    labelFormatter={(
                                        label,
                                    ) => label}
                                    formatter={(
                                        value,
                                        name,
                                    ) => [
                                        Number(
                                            value,
                                        ).toLocaleString(),
                                        name,
                                    ]}
                                />

                                <Legend
                                    onClick={handleLegendClick}
                                    wrapperStyle={{
                                        fontSize: 11,
                                        paddingTop: 8,
                                        cursor: "pointer",
                                    }}
                                    formatter={(value, entry) => {
                                        const isActive =
                                            activeVisitorLines[
                                                entry.dataKey
                                            ];

                                        return (
                                            <span
                                                style={{
                                                    color: isActive
                                                        ? C.text
                                                        : C.muted,
                                                    opacity: isActive
                                                        ? 1
                                                        : 0.45,
                                                    textDecoration: isActive
                                                        ? "none"
                                                        : "line-through",
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
                                    name="New"
                                    stroke={
                                        activeVisitorLines.total_new
                                            ? "#FFB162"
                                            : "transparent"
                                    }
                                    strokeWidth={2.5}
                                    connectNulls
                                    dot={
                                        activeVisitorLines.total_new
                                            ? (props) => (
                                                <ClickableVisitorDot
                                                    {...props}
                                                    fill="#FFB162"
                                                    visitorStatus="New"
                                                    onPointClick={
                                                        handleVisitorPointClick
                                                    }
                                                />
                                            )
                                            : false
                                    }
                                    activeDot={false}
                                />

                                <Line
                                    type="monotone"
                                    dataKey="total_repeat"
                                    name="Repeat"
                                    stroke={
                                        activeVisitorLines.total_repeat
                                            ? "var(--dashboard-truffle)"
                                            : "transparent"
                                    }
                                    strokeWidth={2.5}
                                    connectNulls
                                    dot={
                                        activeVisitorLines.total_repeat
                                            ? (props) => (
                                                <ClickableVisitorDot
                                                    {...props}
                                                    fill="var(--dashboard-truffle)"
                                                    visitorStatus="Repeat"
                                                    onPointClick={
                                                        handleVisitorPointClick
                                                    }
                                                />
                                            )
                                            : false
                                    }
                                    activeDot={false}
                                />

                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

            {/* ─── Geographic distribution ───────────────────────── */}
            <SectionLabel>
            Geographic Distribution
            </SectionLabel>

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
                                ? `${Number(
                                      geoConcentration.top5_states_total,
                                  ).toLocaleString()} accounts`
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
                                        {Number(
                                            geoConcentration.top5_states_total,
                                        ).toLocaleString()}{" "}
                                        accounts across the top 5 states
                                    </div>
                                    {topStatesPanelRows.map((row) => (
                                        <div
                                            key={row.state}
                                            style={{
                                                display: "flex",
                                                justifyContent:
                                                    "space-between",
                                                gap: 8,
                                                padding: "5px 0",
                                                borderTop: `1px solid ${C.border}`,
                                            }}
                                        >
                                            <span style={{ fontWeight: 600 }}>
                                                {row.state}
                                            </span>
                                            <span>
                                                {Number(
                                                    row.total,
                                                ).toLocaleString()}{" "}
                                                ({row.pct}%)
                                            </span>
                                            <span style={{ color: C.muted }}>
                                                {Number(
                                                    row.member_total,
                                                ).toLocaleString()}
                                                M /{" "}
                                                {Number(
                                                    row.guest_total,
                                                ).toLocaleString()}
                                                G
                                            </span>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <span style={{ color: C.muted }}>
                                    No state data available.
                                </span>
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
                                ? `${Number(
                                      geoConcentration.top5_countries_total,
                                  ).toLocaleString()} accounts`
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
                                        {Number(
                                            geoConcentration.top5_countries_total,
                                        ).toLocaleString()}{" "}
                                        accounts across the top 5 countries
                                    </div>
                                    {topCountriesPanelRows.map((row) => (
                                        <div
                                            key={row.country}
                                            style={{
                                                display: "flex",
                                                justifyContent:
                                                    "space-between",
                                                gap: 8,
                                                padding: "5px 0",
                                                borderTop: `1px solid ${C.border}`,
                                            }}
                                        >
                                            <span style={{ fontWeight: 600 }}>
                                                {row.country}
                                            </span>
                                            <span>
                                                {Number(
                                                    row.total,
                                                ).toLocaleString()}{" "}
                                                ({row.pct}%)
                                            </span>
                                            <span style={{ color: C.muted }}>
                                                {Number(
                                                    row.member_total,
                                                ).toLocaleString()}
                                                M /{" "}
                                                {Number(
                                                    row.guest_total,
                                                ).toLocaleString()}
                                                G
                                            </span>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <span style={{ color: C.muted }}>
                                    No country data available.
                                </span>
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
                                ? `${Number(
                                      geoConcentration.domestic_accounts,
                                  ).toLocaleString()} accounts`
                                : undefined
                        }
                        onClick={scrollToStateMap}
                        panel={
                            <>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                    United States
                                </div>
                                <div style={{ padding: "3px 0" }}>
                                    {Number(
                                        geoConcentration?.domestic_accounts || 0,
                                    ).toLocaleString()}{" "}
                                    total accounts
                                </div>
                                <div style={{ padding: "3px 0" }}>
                                    {Number(
                                        geoConcentration?.domestic_members || 0,
                                    ).toLocaleString()}{" "}
                                    members ·{" "}
                                    {Number(
                                        geoConcentration?.domestic_guests || 0,
                                    ).toLocaleString()}{" "}
                                    guests
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
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                    International
                                </div>
                                <div style={{ padding: "3px 0" }}>
                                    {Number(
                                        geoConcentration?.international_accounts ||
                                            0,
                                    ).toLocaleString()}{" "}
                                    total accounts
                                </div>
                                <div style={{ padding: "3px 0" }}>
                                    {Number(
                                        geoConcentration?.international_members ||
                                            0,
                                    ).toLocaleString()}{" "}
                                    members ·{" "}
                                    {Number(
                                        geoConcentration?.international_guests ||
                                            0,
                                    ).toLocaleString()}{" "}
                                    guests
                                </div>
                                <div style={{ padding: "3px 0", color: C.muted }}>
                                    {Number(
                                        geoConcentration?.international_country_count ||
                                            0,
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
                <AccountsUSMap
                    data={membersByState}
                    onStateClick={handleStateClick}
                />
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
                        <span className="dashboard-eyebrow">
                            Countries shown
                        </span>

                        <select
                            value={countriesShown}
                            onChange={(event) =>
                                setCountriesShown(
                                    event.target.value,
                                )
                            }
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
                            <option value="All countries">
                                All countries
                            </option>
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
                            countryChartHeight >
                            COUNTRY_CHART_VISIBLE_HEIGHT
                                ? "auto"
                                : "hidden",
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
                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                        >
                            {countryBarChart}
                        </ResponsiveContainer>
                    </div>
                </div>
                </Card>
            </div>
            </div>

            {/* ─── Household and dependents ──────────────────────── */}
            <SectionLabel>
            Household &amp; Dependents
            </SectionLabel>

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
                action={<ChartInfo id="dependentsPerHousehold" />}
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
            showDateFilter={
                accountDrawer?.showDateFilter !== false
            }
            />

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
                    onMouseDown={(event) =>
                        event.stopPropagation()
                    }
                    style={{
                        width: 380,
                        maxWidth: "90vw",
                        maxHeight: "70vh",
                        overflowY: "auto",
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 16,
                        padding: 20,
                        boxShadow:
                            "0 20px 50px rgba(0, 0, 0, 0.2)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent:
                                "space-between",
                            alignItems: "center",
                            marginBottom: 12,
                        }}
                    >
                        <h3
                            style={{
                                margin: 0,
                                fontFamily:
                                    "'Cormorant Garamond', serif",
                                fontSize: 22,
                                color: C.text,
                            }}
                        >
                            Other Countries
                        </h3>

                        <button
                            type="button"
                            onClick={() =>
                                setOtherCountriesOpen(false)
                            }
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
                        Countries outside the current Top view,
                        ranked by account total. Select one to view
                        its accounts.
                    </p>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        {(
                            countryChartRows.find(
                                (row) => row.isOtherCountries,
                            )?.includedCountries ?? []
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
                                    justifyContent:
                                        "space-between",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    border: `1px solid ${C.border}`,
                                    background:
                                        "var(--dashboard-panel-alt)",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    color: C.text,
                                }}
                            >
                                <span>{row.country}</span>
                                <span>
                                    {Number(
                                        row.total || 0,
                                    ).toLocaleString()}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        )}

        </>
    );
}