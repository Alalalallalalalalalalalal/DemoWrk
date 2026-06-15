    import { useMemo, useState } from "react";
    import {
    ComposableMap,
    Geographies,
    Geography,
    } from "@vnedyalk0v/react19-simple-maps";

    import usStates from "us-atlas/states-10m.json";

    /*
    * The map identifies states using Census FIPS codes.
    * Your API identifies states using postal abbreviations.
    * This mapping connects the two.
    */
    const STATE_BY_FIPS = {
    "01": { code: "AL", name: "Alabama" },
    "02": { code: "AK", name: "Alaska" },
    "04": { code: "AZ", name: "Arizona" },
    "05": { code: "AR", name: "Arkansas" },
    "06": { code: "CA", name: "California" },
    "08": { code: "CO", name: "Colorado" },
    "09": { code: "CT", name: "Connecticut" },
    "10": { code: "DE", name: "Delaware" },
    "11": { code: "DC", name: "District of Columbia" },
    "12": { code: "FL", name: "Florida" },
    "13": { code: "GA", name: "Georgia" },
    "15": { code: "HI", name: "Hawaii" },
    "16": { code: "ID", name: "Idaho" },
    "17": { code: "IL", name: "Illinois" },
    "18": { code: "IN", name: "Indiana" },
    "19": { code: "IA", name: "Iowa" },
    "20": { code: "KS", name: "Kansas" },
    "21": { code: "KY", name: "Kentucky" },
    "22": { code: "LA", name: "Louisiana" },
    "23": { code: "ME", name: "Maine" },
    "24": { code: "MD", name: "Maryland" },
    "25": { code: "MA", name: "Massachusetts" },
    "26": { code: "MI", name: "Michigan" },
    "27": { code: "MN", name: "Minnesota" },
    "28": { code: "MS", name: "Mississippi" },
    "29": { code: "MO", name: "Missouri" },
    "30": { code: "MT", name: "Montana" },
    "31": { code: "NE", name: "Nebraska" },
    "32": { code: "NV", name: "Nevada" },
    "33": { code: "NH", name: "New Hampshire" },
    "34": { code: "NJ", name: "New Jersey" },
    "35": { code: "NM", name: "New Mexico" },
    "36": { code: "NY", name: "New York" },
    "37": { code: "NC", name: "North Carolina" },
    "38": { code: "ND", name: "North Dakota" },
    "39": { code: "OH", name: "Ohio" },
    "40": { code: "OK", name: "Oklahoma" },
    "41": { code: "OR", name: "Oregon" },
    "42": { code: "PA", name: "Pennsylvania" },
    "44": { code: "RI", name: "Rhode Island" },
    "45": { code: "SC", name: "South Carolina" },
    "46": { code: "SD", name: "South Dakota" },
    "47": { code: "TN", name: "Tennessee" },
    "48": { code: "TX", name: "Texas" },
    "49": { code: "UT", name: "Utah" },
    "50": { code: "VT", name: "Vermont" },
    "51": { code: "VA", name: "Virginia" },
    "53": { code: "WA", name: "Washington" },
    "54": { code: "WV", name: "West Virginia" },
    "55": { code: "WI", name: "Wisconsin" },
    "56": { code: "WY", name: "Wyoming" },
    };

    function getStateColor(total, maximum) {
    if (!total || total <= 0) {
        return "var(--dashboard-oatmeal)";
    }

    const ratio = maximum > 0 ? total / maximum : 0;

    if (ratio >= 0.75) {
        return "var(--dashboard-deep-blue)";
    }

    if (ratio >= 0.5) {
        return "var(--dashboard-truffle)";
    }

    if (ratio >= 0.25) {
        return "#5B8FA8";
    }

    if (ratio >= 0.1) {
        return "#D4895A";
    }

    return "var(--dashboard-flame)";
    }

    export default function AccountsUSMap({ data = [] }) {
    const [hoveredState, setHoveredState] = useState(null);

    const stateTotals = useMemo(() => {
        const totals = new Map();

        data.forEach((item) => {
        const stateCode = String(item?.state ?? "")
            .trim()
            .toUpperCase();

        const total = Number(item?.total ?? 0);

        if (stateCode) {
            totals.set(
            stateCode,
            Number.isFinite(total) ? total : 0,
            );
        }
        });

        return totals;
    }, [data]);

    const maximumTotal = useMemo(() => {
        const totals = Array.from(stateTotals.values());

        return totals.length > 0
        ? Math.max(...totals)
        : 0;
    }, [stateTotals]);

    return (
        <div
        style={{
            position: "relative",
            width: "100%",
        }}
        >
        <ComposableMap
            projection="geoAlbersUsa"
            projectionConfig={{
            scale: 920,
            }}
            width={800}
            height={470}
            style={{
            display: "block",
            width: "100%",
            height: "auto",
            }}
            aria-label="United States accounts by state"
        >
            <Geographies geography={usStates}>
            {({ geographies }) =>
                geographies.map((geo) => {
                const fipsCode = String(
                    geo.id,
                ).padStart(2, "0");

                const state = STATE_BY_FIPS[fipsCode];

                if (!state) {
                    return null;
                }

                const total =
                    stateTotals.get(state.code) ?? 0;

                return (
                    <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getStateColor(
                        total,
                        maximumTotal,
                    )}
                    stroke="var(--dashboard-palladian)"
                    strokeWidth={1}
                    onMouseEnter={() => {
                        setHoveredState({
                        code: state.code,
                        name: state.name,
                        total,
                        });
                    }}
                    onMouseLeave={() => {
                        setHoveredState(null);
                    }}
                    style={{
                        default: {
                        outline: "none",
                        },
                        hover: {
                        fill:
                            "var(--dashboard-truffle)",
                        outline: "none",
                        cursor: "pointer",
                        },
                        pressed: {
                        outline: "none",
                        },
                    }}
                    />
                );
                })
            }
            </Geographies>
        </ComposableMap>

        {hoveredState && (
            <div
            style={{
                position: "absolute",
                top: 8,
                right: 8,
                minWidth: 155,
                padding: "10px 12px",
                border:
                "1px solid var(--dashboard-oatmeal)",
                borderRadius: 10,
                background:
                "var(--dashboard-palladian)",
                boxShadow:
                "0 6px 18px rgba(27, 38, 50, 0.14)",
                pointerEvents: "none",
                zIndex: 5,
            }}
            >
            <div
                style={{
                color:
                    "var(--dashboard-deepblue)",
                fontFamily:
                    "Inter, system-ui, sans-serif",
                fontSize: 12,
                fontWeight: 700,
                }}
            >
                {hoveredState.name} ({hoveredState.code})
            </div>

            <div
                style={{
                marginTop: 4,
                color:
                    "var(--dashboard-truffle)",
                fontFamily:
                    "Inter, system-ui, sans-serif",
                fontSize: 12,
                }}
            >
                {hoveredState.total.toLocaleString()}{" "}
                {hoveredState.total === 1
                ? "account"
                : "accounts"}
            </div>
            </div>
        )}

        <div
            style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 12,
            marginTop: -8,
            }}
        >
            <LegendItem
            color="var(--dashboard-oatmeal)"
            label="No accounts"
            />

            <LegendItem
            color="var(--dashboard-flame)"
            label="Low"
            />

            <LegendItem
            color="#D4895A"
            label="Low–medium"
            />

            <LegendItem
            color="#5B8FA8"
            label="Medium"
            />

            <LegendItem
            color="var(--dashboard-deep-blue)"
            label="High"
            />
        </div>
        </div>
    );
    }

    function LegendItem({ color, label }) {
    return (
        <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "var(--dashboard-truffle)",
            fontFamily:
            "Inter, system-ui, sans-serif",
            fontSize: 10,
        }}
        >
        <span
            style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: color,
            border:
                "1px solid rgba(27, 38, 50, 0.12)",
            }}
        />

        <span>{label}</span>
        </div>
    );
    }