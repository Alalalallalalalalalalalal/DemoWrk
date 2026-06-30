import { useState, useContext, useMemo, createContext } from "react";
import { ArrowUpRight } from "lucide-react";
import { InfoTip } from "./styles/Dashboardcomponents";
import { FinancePeriodFilter } from "./finance/FinanceShared";

const serif = "'Cormorant Garamond', serif";

const C = {
    bg: "var(--dashboard-card)",
    panel: "var(--dashboard-panel)",
    panelAlt: "var(--dashboard-panel-alt)",
    border: "var(--dashboard-border)",
    rowBorder: "var(--dashboard-row-border)",
    text: "var(--dashboard-abyssal)",
    muted: "var(--dashboard-muted)",
    soft: "var(--dashboard-text-soft)",
    accent: "var(--dashboard-deep-blue)",
    accent2: "var(--dashboard-truffle)",
    accent3: "var(--dashboard-flame)",
    navy: "#1B2632",
    navyBorder: "rgba(255,255,255,0.08)",
    navyText: "#EEE9DF",
    navyMuted: "rgba(238,233,223,0.4)",
    navyDim: "rgba(238,233,223,0.25)",
    flame: "#FFB162",
    rust: "#E07B5A",
};

const money = (v, decimals = 0) =>
    v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals })}`;

const block = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "var(--dashboard-shadow-soft)",
};

// ─────────────────────────────────────────────
// FILTER PILL
// "Overall" is always visible. "Paid" and "Free" toggle on/off — clicking
// the active one resets to Overall. The label is the same word on every
// card ("Paid"/"Free"); what it actually MEANS differs by card and is
// explained in that card's tooltip (InfoDot) rather than in the pill text:
//   - Bookings at a glance, Bedroom demand, Revenue by month, Top villas
//     by revenue: booking-level — was this villa STAY paid for or comped.
//   - Finance at a glance, Member vs guest revenue: transaction-level —
//     was this individual TRANSACTION (villa or amenity) actually charged
//     or comped/reversed to zero.
// ─────────────────────────────────────────────
const FilterPill = ({ value, onChange }) => {
    const options = [
        { label: "Overall", key: "overall" },
        { label: "Paid", key: "paid_villa" },
        { label: "Free", key: "free_villa" },
    ];
    return (
        <div style={{ display: "flex", gap: 3 }}>
            {options.map(opt => {
                const active = value === opt.key;
                return (
                    <button
                        key={opt.key}
                        onClick={() => onChange(active && opt.key !== "overall" ? "overall" : opt.key)}
                        style={{
                            fontSize: 9,
                            fontFamily: "sans-serif",
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            padding: "3px 8px",
                            borderRadius: 20,
                            border: `1px solid ${active ? C.navy : C.border}`,
                            background: active ? C.navy : "transparent",
                            color: active ? C.flame : C.muted,
                            cursor: "pointer",
                            lineHeight: 1.4,
                            transition: "all 0.15s ease",
                        }}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
};

// ─────────────────────────────────────────────
// METRIC TOGGLE
// Two mutually-exclusive options (unlike FilterPill, there's no "off"
// state — one is always selected). Used by "Top villas by revenue" to
// switch which revenue figure the ranking is sorted by.
// ─────────────────────────────────────────────
const MetricToggle = ({ value, onChange, options }) => (
    <div style={{ display: "flex", gap: 3 }}>
        {options.map(opt => {
            const active = value === opt.key;
            return (
                <button
                    key={opt.key}
                    onClick={() => onChange(opt.key)}
                    style={{
                        fontSize: 9,
                        fontFamily: "sans-serif",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "4px 9px",
                        borderRadius: 20,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        background: active ? C.accent : "transparent",
                        color: active ? "#FFFFFF" : C.muted,
                        cursor: "pointer",
                        lineHeight: 1.4,
                        transition: "all 0.15s ease",
                    }}
                >
                    {opt.label}
                </button>
            );
        })}
    </div>
);

// ─────────────────────────────────────────────
// CARD HEADERS
// ─────────────────────────────────────────────
//
// TOOLTIP RENDERING (added 2026-06-25): InfoDot used to rely on a pure
// CSS :hover + ::after rule (.info-btn in styles.css) — simple, but
// position:absolute means it gets clipped by ANY ancestor with
// overflow:hidden, which every card in this file has (needed elsewhere,
// for rows with their own background color to not poke square corners
// out past the card's rounded edges). Long tooltips (like Finance at a
// glance's) grow past the bottom of shorter cards and got visibly cut
// off as a result.
//
// Fix: render ONE shared tooltip via TooltipContext, positioned with
// position:fixed (escapes every ancestor's overflow:hidden, since fixed
// positioning is relative to the viewport, not any clipping ancestor)
// and placed in JS from the hovered icon's actual screen position,
// flipping above the icon instead of below if there isn't room
// underneath. This only touches InfoDot/this file — the Hero KPI band's
// tooltips use a separate component (InfoTip, from Dashboardcomponents)
// and its own .hero-info-btn CSS rule, untouched by this.
const TooltipContext = createContext(null);

function FixedTooltip() {
    const ctx = useContext(TooltipContext);
    if (!ctx?.active) return null;
    const { text, rect } = ctx.active;
    const width = 240;
    const margin = 8;
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = rect.bottom + 6;
    // Flip above the icon if there's clearly more room there than below
    // — avoids guessing the tooltip's exact height up front.
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    return (
        <div style={{
            position: "fixed",
            top: preferAbove ? undefined : top,
            bottom: preferAbove ? window.innerHeight - rect.top + 6 : undefined,
            left,
            width,
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            background: "#1B2632",
            color: "#EEE9DF",
            fontSize: 11,
            lineHeight: 1.5,
            padding: "8px 10px",
            borderRadius: 8,
            zIndex: 9999,
            fontFamily: "sans-serif",
            fontWeight: 400,
            pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        }}>
            {text}
        </div>
    );
}

const InfoDot = ({ tip }) => {
    const ctx = useContext(TooltipContext);
    return (
        <div
            style={{
                width: 15, height: 15, borderRadius: "50%",
                border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: C.muted, fontWeight: 700, lineHeight: 1,
                flexShrink: 0, cursor: "default",
            }}
            onMouseEnter={(e) => ctx?.show(tip, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => ctx?.hide()}
        >i</div>
    );
};

// "View details" link — sits at the bottom of a card, switches the
// sidebar to the named tab. Added 2026-06-26. Deliberately just a tab
// switch (not a deep link to a specific card on that tab) — keeps this
// entirely self-contained to the Overview page, no changes needed to
// Demographics/Visits & Rooms/Finance to support it.
const ViewDetailsLink = ({ label, tab, onNavigateToTab }) => (
    <button
        type="button"
        onClick={() => onNavigateToTab(tab)}
        style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%",
            padding: "11px 16px",
            borderTop: `1px solid ${C.border}`,
            background: "transparent",
            border: "none",
            borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: C.border,
            color: C.accent,
            fontSize: 11, fontWeight: 700, fontFamily: "sans-serif",
            cursor: "pointer",
            borderRadius: "0 0 14px 14px",
        }}
    >
        {label}
        <ArrowUpRight size={14} />
    </button>
);

// Plain header — no filter
const CardHeader = ({ label, tip }) => (
    <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
        <span className="dashboard-eyebrow">{label}</span>
        <InfoDot tip={tip} />
    </div>
);

// Header with filter pills
const CardHeaderF = ({ label, tip, filter, onFilterChange }) => (
    <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    }}>
        <span className="dashboard-eyebrow">{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FilterPill value={filter} onChange={onFilterChange} />
            <InfoDot tip={tip} />
        </div>
    </div>
);

// ─────────────────────────────────────────────
// ROWS
// ─────────────────────────────────────────────
const StatRow = ({ label, value, warn, last, sub }) => (
    <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 16px", gap: 8,
        borderBottom: last ? "none" : `1px solid ${C.rowBorder}`,
    }}>
        <div>
            <div style={{ fontSize: 12, color: C.soft, fontFamily: "sans-serif" }}>{label}</div>
            {sub && <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif", marginTop: 1 }}>{sub}</div>}
        </div>
        <span style={{
            fontFamily: serif, fontSize: 18,
            color: warn ? C.accent2 : C.text,
            lineHeight: 1, textAlign: "right", flexShrink: 0,
        }}>
            {value}
        </span>
    </div>
);

const RankRow = ({ rank, label, value, mini, total, sub, last }) => (
    <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 16px", gap: 8,
        background: rank % 2 === 0 ? C.panel : C.bg,
        borderBottom: last ? "none" : `1px solid ${C.rowBorder}`,
    }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                background: rank === 1 ? C.navy : C.panelAlt,
                color: rank === 1 ? C.flame : C.muted,
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "sans-serif",
            }}>{rank}</div>
            <div style={{ minWidth: 0 }}>
                <div style={{
                    fontSize: 12, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", maxWidth: 140, fontFamily: "sans-serif",
                }}>{label}</div>
                {sub && <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>{sub}</div>}
            </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {mini != null && total > 0 && (
                <div style={{ width: 44, height: 4, background: C.panelAlt, borderRadius: 2 }}>
                    <div style={{
                        height: "100%", borderRadius: 2,
                        background: rank === 1 ? C.navy : C.muted,
                        width: `${Math.round((mini / total) * 100)}%`,
                    }} />
                </div>
            )}
            <span style={{ fontFamily: serif, fontSize: 18, color: C.text, minWidth: 32, textAlign: "right" }}>
                {value}
            </span>
        </div>
    </div>
);

// ─────────────────────────────────────────────
// FILTER HELPERS
// villa_payment_type field on each row: "Paid" | "Free" | "Unknown"
// (set by the backend from folios.payment_type, sourced from
// business_source.csv via cleaner.py's load_business_source step)
// ─────────────────────────────────────────────
const filterKeyToType = (filter) => (filter === "paid_villa" ? "Paid" : filter === "free_villa" ? "Free" : null);

// For row-array datasets (bedroomBookings, monthlyRevenue, villaAmenityRevenue)
// where each row already carries its own villa_payment_type.
const applyVillaFilter = (data, filter) => {
    if (!data || filter === "overall") return data ?? [];
    const match = filterKeyToType(filter);
    return data.filter(r => r.villa_payment_type === match);
};

// For datasets that need to be RE-AGGREGATED across a grouping key after filtering
// by payment type (e.g. villa-stats has one row per villa+bedroom+payment_type,
// but the "Top villas by revenue" card wants one row per villa regardless of type
// once a filter is chosen). Sums numeric fields, re-derives any *_derived fields via reducer.
const regroupSum = (rows, groupKey, sumFields) => {
    const map = new Map();
    for (const r of rows) {
        const key = typeof groupKey === "function" ? groupKey(r) : r[groupKey];
        if (!map.has(key)) {
            map.set(key, { ...r });
            sumFields.forEach(f => { map.get(key)[f] = 0; });
        }
        const acc = map.get(key);
        sumFields.forEach(f => { acc[f] = (acc[f] || 0) + (r[f] || 0); });
    }
    return [...map.values()];
};

// visitsTabSummary carries an overall aggregate PLUS a by_payment_type breakdown
// (an array of {villa_payment_type, total_members_booked, total_guests_booked,
// avg_length_of_stay, avg_party_size, total_room_nights, villa_rental_revenue}).
// This picks the right slice depending on the active filter.
const pickSummary = (visitsTabSummary, filter) => {
    if (!visitsTabSummary) return null;
    if (filter === "overall") return visitsTabSummary;
    const match = filterKeyToType(filter);
    const row = (visitsTabSummary.by_payment_type || []).find(r => r.villa_payment_type === match);
    return row ?? {
        total_bookings: 0,
        total_members_booked: 0,
        total_guests_booked: 0,
        avg_length_of_stay: null,
        avg_party_size: null,
        total_room_nights: 0,
        villa_rental_revenue: 0,
    };
};

// ─────────────────────────────────────────────
// TRANSACTION-LEVEL FILTER HELPER
// Used by transactionFinanceSummary / transactionMemberVsGuestRevenue —
// these come from overview_transaction_lines (per net line-item, NOT per
// booking), keyed by line_status: "Paid" | "Free" (Anomaly rows are never
// sent here — the backend excludes them from these two endpoints).
// Unlike villa_payment_type (booking-level), there's no "Unknown" bucket,
// and "overall" here means SUM of Paid + Free for each grouping key,
// since the API returns Paid and Free as separate rows rather than also
// providing a combined row.
//
// NOTE on uniqueAccounts: this field is NOT summed across Paid+Free rows
// even in "overall" mode, because a member/guest with both paid and free
// transactions would otherwise be double-counted. Since uniqueAccounts is
// only ever rendered as a per-status display value (not used in any
// "overall" combined total in the UI today), it's safe to leave it as
// whichever single row's value happens to land last during regroupSum —
// callers needing an accurate combined unique-account count should query
// the backend directly rather than rely on client-side summing here.
//
// NOTE on the Free slice (added 2026-06-25): `revenue` for a Free row is
// always exactly $0 — that's correct, it's the real cost to the guest —
// but it doesn't show how much was actually given away. When the dataset
// carries a `valueGivenAway` field (currently only
// transactionMemberVsGuestRevenue does; transactionFinanceSummary's
// Villa/Amenity rows don't, and are unaffected since the field is just
// absent there), the Free-filtered rows have `revenue` swapped to the
// NEGATIVE of that instead, so e.g. "Member vs guest revenue" can show
// how much value each customer type was given for free instead of two
// uninformative $0s. "Overall" is intentionally untouched — it still
// sums the real `revenue` field (Free contributing $0, as it always has),
// so the combined total isn't artificially reduced by the giveaway figure.
const applyLineStatusFilter = (data, filter, groupKey) => {
    const rows = data ?? [];
    if (filter === "overall") {
        return regroupSum(rows, groupKey, ["transaction_count", "total_amount", "revenue", "transactions"]);
    }
    const match = filterKeyToType(filter); // "Paid" | "Free" — same mapping as villa_payment_type
    const filtered = rows.filter(r => r.line_status === match);
    if (match === "Free") {
        return filtered.map(r => ({
            ...r,
            revenue: r.valueGivenAway != null ? -r.valueGivenAway : r.revenue,
        }));
    }
    return filtered;
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function OverviewTab({
    onNavigateToTab = () => { },
    period = null,
    onPeriodChange = () => { },
    years = [],
    membersByType = [],
    membersByStatus = [],
    membersByCountry = [],
    membersByState = [],
    averageLengthOfStay = null,
    bookingsByMonth = [],
    bookingsByRoomType = [], // DEPRECATED — no longer read; "Villa types available" now counts distinct villas from villaStats instead (see below), to stay consistent with every other villa-related number on this page rather than depending on a separate `rooms` table this page otherwise never touches. Safe to stop passing this from dashboard.jsx.
    mostUsedRoomTypes = [], // DEPRECATED — no longer read; "Top villas by bookings" now uses villaStats. Safe to stop passing this from dashboard.jsx.
    totalDependents = null,
    totalAmountDue = null,
    amountDueByPeriod = [],
    topSpendDescriptions = [],
    directoryMembers = [],
    memberVsGuestRevenue = [], // DEPRECATED — no longer read; superseded by transactionMemberVsGuestRevenue. Safe to stop passing this from dashboard.jsx.
    villaStats = [],
    visitsTabSummary = null,
    bedroomBookings = [],
    villaRevenue = [], // DEPRECATED — no longer read; superseded by villaAmenityRevenue. Safe to stop passing this from dashboard.jsx.
    monthlyRevenue = [], // DEPRECATED — no longer read; superseded by monthlyRevenueByCategory. Safe to stop passing this from dashboard.jsx.
    transactionFinanceSummary = [],
    transactionMemberVsGuestRevenue = [],
    transactionMemberVsGuestRevenueByCategory = [],
    villaAmenityRevenue = [],
    monthlyRevenueByCategory = [],
    reversalsSummary = null,
    villaRackRateFree = [],
    cashAdvanceSummary = null,
    anomaliesSummary = null,
    anomalies = [],
}) {
    // ── Per-card filter state ──────────────────────────────────────
    // Shared fixed-position tooltip state — see TooltipContext/FixedTooltip
    // above for why this exists instead of the old CSS :hover approach.
    const [tooltipActive, setTooltipActive] = useState(null);
    const tooltipCtxValue = useMemo(() => ({
        active: tooltipActive,
        show: (text, rect) => setTooltipActive({ text, rect }),
        hide: () => setTooltipActive(null),
    }), [tooltipActive]);

    const [financeFilter, setFinanceFilter] = useState("overall");
    const [villaRevFilter, setVillaRevFilter] = useState("overall");
    // Which figure "Top villas by revenue" ranks by — "amenity" (food,
    // golf, spa, wine, etc.) or "villa" (the villa rental charge itself).
    // Added 2026-06-25 per request; previously the card only ever showed
    // amenity revenue with no way to switch.
    const [villaRevMetric, setVillaRevMetric] = useState("amenity");
    // How many rows are currently shown in "Top villas by revenue" — starts
    // at 10, grows by 10 per "See more" click, caps at 50. Resets to 10
    // whenever the Overall/Paid/Free filter changes, since a Free-filtered
    // list might be much shorter than an expanded Paid/Overall list and
    // "showing 40 of 6" would look broken.
    const [villaRevVisibleCount, setVillaRevVisibleCount] = useState(10);
    const [monthlyFilter, setMonthlyFilter] = useState("overall");
    const [bookingsFilter, setBookingsFilter] = useState("overall");
    const [bedroomDemandFilter, setBedroomDemandFilter] = useState("overall");
    const [memberGuestFilter, setMemberGuestFilter] = useState("overall");
    const [villaBookingsFilter, setVillaBookingsFilter] = useState("overall");
    // Same "See more" pagination pattern as Top villas by revenue — starts
    // at 10, grows by 10 per click, caps at 50, resets on filter change.
    const [villaBookingsVisibleCount, setVillaBookingsVisibleCount] = useState(10);
    // "Unexplained anomalies" table — same See-more pagination pattern as
    // the villa tables above.
    const [anomaliesVisibleCount, setAnomaliesVisibleCount] = useState(5);

    // ── Derived: filtered datasets ─────────────────────────────────
    // Used by the "Most booked bedroom" stat inside the Bookings at a glance card —
    // intentionally tied to bookingsFilter, NOT bedroomDemandFilter, so that stat
    // moves with the rest of the Bookings card.
    const filteredBedroomBookingsForBookingsCard = applyVillaFilter(bedroomBookings, bookingsFilter);
    // Used by the standalone Bedroom demand card — has its own independent toggle.
    const filteredBedroomBookingsForDemandCard = applyVillaFilter(bedroomBookings, bedroomDemandFilter);
    const filteredMemberGuest = applyLineStatusFilter(transactionMemberVsGuestRevenue, memberGuestFilter, "customerType");
    // Villa/Amenity/Membership split for the stacked bar on "Member vs
    // guest revenue" — a SEPARATE dataset from filteredMemberGuest above
    // (see overview_analytics.py's docstring on why), used only to find
    // each customerType's category proportions. Headline numbers (total
    // revenue, transactions, uniqueAccounts) keep coming from
    // filteredMemberGuest, unaffected by this.
    //
    // "Membership" (added 2026-06-26) is Temp Membership Fee charges,
    // carved out of what the rest of the page still calls "Amenity" —
    // scoped to ONLY this card's breakdown, see the backend endpoint's
    // docstring. Label differs by customerType when rendered: shown as
    // "Temp membership fee" for Guests (who are the ones who actually
    // pay it), or generically as "Other" for Members (who rarely do) —
    // same underlying number either way, just a different display label.
    const filteredMemberGuestByCategory = applyLineStatusFilter(
        transactionMemberVsGuestRevenueByCategory,
        memberGuestFilter,
        r => `${r.customerType}__${r.line_category}`,
    );
    const memberGuestCategorySplit = (customerType) => {
        const villa = filteredMemberGuestByCategory.find(r => r.customerType === customerType && r.line_category === "Villa");
        const amenity = filteredMemberGuestByCategory.find(r => r.customerType === customerType && r.line_category === "Amenity");
        const membership = filteredMemberGuestByCategory.find(r => r.customerType === customerType && r.line_category === "Membership");
        return {
            villaRevenue: villa?.revenue ?? 0,
            amenityRevenue: amenity?.revenue ?? 0,
            membershipRevenue: membership?.revenue ?? 0,
        };
    };

    // "Top villas by revenue" can rank villas by either AMENITY revenue
    // (commissary, golf, wine, transportation, etc.) or VILLA RENTAL
    // revenue (the rental charge itself), via villaRevMetric. Both
    // sources carry villa_payment_type per row (booking-level Paid/Free
    // villa-stay type) so the existing applyVillaFilter pattern works for
    // either one. "Free Villa" + amenity metric means: amenity revenue
    // generated by guests whose villa stay itself was comped (the villa
    // was free, but they still spent real money on amenities).
    const filteredVillaAmenityRevenue = applyVillaFilter(villaAmenityRevenue, villaRevFilter);
    const amenityByVilla = regroupSum(
        filteredVillaAmenityRevenue,
        "villa_name",
        ["amenity_revenue", "amenity_transactions"],
    );

    // Bookings count for this card is intentionally sourced from villaStats
    // (booking-level data, one row per booking regardless of spend), NOT
    // from the amenity-revenue endpoint above. villaAmenityRevenue only
    // includes a booking at all if it had at least one PAID amenity
    // transaction, so a villa stay with zero amenity spend was silently
    // dropped from the count entirely (e.g. Sunset Villa showing 5
    // bookings instead of its real 6 — confirmed against conf_code 10006,
    // which has a villa rental charge but no amenity lines at all).
    // villaStats counts every booking, so this fixes that undercount
    // regardless of which revenue metric is selected.
    const filteredVillaStatsForRevenueCard = applyVillaFilter(villaStats, villaRevFilter);
    const villaStatsForRevenueCard = regroupSum(
        filteredVillaStatsForRevenueCard,
        "villa_name",
        ["bookings", "revenue"],
    );

    // When viewing Villa rental revenue filtered to Free, actual revenue
    // collected is at or near $0 by definition (that's what "Free" means)
    // and doesn't communicate how much was given away. In that one
    // specific combination, swap in a NEGATIVE number instead — sourced
    // from /overview/villa-rack-rate-free. Every other filter/metric
    // combination is unaffected.
    const isFreeRackRateView = villaRevFilter === "free_villa" && villaRevMetric === "villa";

    const allVillaNamesForRevenueCard = [...new Set([
        ...amenityByVilla.map(v => v.villa_name),
        ...villaStatsForRevenueCard.map(v => v.villa_name),
        ...(isFreeRackRateView ? villaRackRateFree.map(v => v.villa_name) : []),
    ])];
    const villaRevSource = allVillaNamesForRevenueCard.map(name => {
        const amenityRow = amenityByVilla.find(v => v.villa_name === name);
        const statsRow = villaStatsForRevenueCard.find(v => v.villa_name === name);
        const rackRow = villaRackRateFree.find(v => v.villa_name === name);
        const amenityRevenue = amenityRow?.amenity_revenue ?? 0;
        // Usually rack rate is the bigger (and more meaningful) number —
        // that's the full value of what was given away. But a booking can
        // be tagged Free at the source level and still get charged at or
        // above rack rate on the actual villa rental line (confirmed:
        // conf_code 16762, Wonderland — rack rate $5,642.86, but actually
        // charged $6,294.65). For that handful of exceptions, showing the
        // rack rate would understate it and showing $0 would hide it
        // entirely, so this takes whichever figure is LARGER before
        // negating — every villa where rack rate already exceeds actual
        // revenue (the normal case) is unaffected.
        const rackRateTotal = rackRow?.rack_rate_total ?? 0;
        const actualRevenue = statsRow?.revenue ?? 0;
        const villaRentalRevenue = isFreeRackRateView
            ? -Math.max(rackRateTotal, actualRevenue)
            : actualRevenue;
        return {
            villaName: name,
            revenue: villaRevMetric === "villa" ? villaRentalRevenue : amenityRevenue,
            totalBookings: statsRow?.bookings ?? rackRow?.free_bookings ?? 0,
            amenityTransactions: amenityRow?.amenity_transactions ?? 0,
        };
    });

    // Villa revenue sorted. In the Free rack-rate view, "top" means
    // biggest giveaway, i.e. most negative first — everywhere else it's
    // highest revenue first, as before.
    const villaRevSorted = [...villaRevSource].sort((a, b) =>
        isFreeRackRateView ? a.revenue - b.revenue : b.revenue - a.revenue
    );
    // Likewise, the Free rack-rate view wants villas with a real (negative)
    // giveaway value, not villas with revenue > 0 (there shouldn't be any
    // once Free-filtered, but excluding <= 0 keeps the list clean either way).
    const villaRevPositive = villaRevSorted.filter(v => isFreeRackRateView ? v.revenue < 0 : v.revenue > 0);

    // "Top villas by bookings" — ranks villas by booking COUNT, filterable
    // by the same booking-level Paid/Free villa-stay toggle used elsewhere.
    // Sourced from villaStats (overview_villa_stats), which already carries
    // villa_payment_type per row, the same dataset "Top villas by revenue"
    // used before it was switched to amenity revenue.
    const filteredVillaStatsForBookings = applyVillaFilter(villaStats, villaBookingsFilter);
    const villaBookingsSource = regroupSum(
        filteredVillaStatsForBookings,
        "villa_name",
        ["bookings", "total_nights", "total_guests"],
    ).map(v => ({
        villaName: v.villa_name,
        bookings: v.bookings,
    }));
    const villaBookingsSorted = [...villaBookingsSource].sort((a, b) => b.bookings - a.bookings);
    const villaBookingsPositive = villaBookingsSorted.filter(v => v.bookings > 0);

    // ── Summary values — always from unfiltered data ───────────────
    const checkedIn = directoryMembers.filter(m => m.currently_checked_in).length;
    const withEmail = directoryMembers.filter(m => m.email).length;

    const guestCount = membersByType.find(t => t.member_type === "Guests")?.total ?? 0;
    const memberCount = membersByType
        .filter(t => !["Guests", "Family Dependent", "Spa Outside Guests", "Banquet Functions", "Golf Guest"].includes(t.member_type))
        .reduce((a, b) => a + (b.total || 0), 0);
    const totalAccounts = membersByType.reduce((a, b) => a + (b.total || 0), 0);

    // Revenue totals — respect filter
    const memberRev = filteredMemberGuest.find(r => r.customerType === "Member");
    const guestRev = filteredMemberGuest.find(r => r.customerType === "Guests");
    const totalRev = (memberRev?.revenue ?? 0) + (guestRev?.revenue ?? 0);

    // ── Bookings card summary — respects bookingsFilter via visitsTabSummary.by_payment_type ──
    const bookingsSummary = pickSummary(visitsTabSummary, bookingsFilter);
    // total_bookings, total_members_booked, and total_guests_booked are all
    // COUNT(*) (bookings, not distinct people) since 2026-06-26 — see
    // overview_analytics.py's docstring on /overview/visits-summary. Using
    // total_bookings directly here either way, since "Total bookings" is
    // the headline figure regardless of how the other two are computed.
    const totalBookingsMadeForBookings = bookingsSummary?.total_bookings ?? 0;

    // ── Finance card — TRANSACTION-LEVEL Paid/Free (villa + amenity combined),
    // respects financeFilter. Distinct from the booking-level "Paid/Free villa
    // stay" meaning used everywhere else on this page — see
    // applyLineStatusFilter's comment for why.
    const financeLines = applyLineStatusFilter(transactionFinanceSummary, financeFilter, r => `${r.line_category}`);
    const financeVillaRevenue = financeLines.find(r => r.line_category === "Villa")?.total_amount ?? 0;
    const financeAmenityRevenue = financeLines.find(r => r.line_category === "Amenity")?.total_amount ?? 0;
    const totalVillaRevenue = financeVillaRevenue + financeAmenityRevenue;
    const financeTransactionCount = financeLines.reduce((a, b) => a + (b.transaction_count || 0), 0);
    const revPerBooking = financeTransactionCount > 0 ? totalVillaRevenue / financeTransactionCount : null;

    // Member vs guest revenue for the Finance card's "Member revenue" /
    // "Guest revenue" / "Member transactions" rows — same transaction-level
    // source as the standalone Member vs guest revenue card, just filtered
    // by financeFilter instead of memberGuestFilter.
    const financeMemberGuestLines = applyLineStatusFilter(transactionMemberVsGuestRevenue, financeFilter, "customerType");
    const finMemberRev = financeMemberGuestLines.find(r => r.customerType === "Member");
    const finGuestRev = financeMemberGuestLines.find(r => r.customerType === "Guests");

    // Villa/Amenity/Membership breakdown for the same two rows — same
    // category split as memberGuestCategorySplit (see that function's
    // comment for what "Membership" means and why the label differs by
    // customerType), just filtered by financeFilter instead of
    // memberGuestFilter, since this card has its own independent toggle.
    const filteredFinanceByCategory = applyLineStatusFilter(
        transactionMemberVsGuestRevenueByCategory,
        financeFilter,
        r => `${r.customerType}__${r.line_category}`,
    );
    const financeCategorySplit = (customerType) => {
        const villa = filteredFinanceByCategory.find(r => r.customerType === customerType && r.line_category === "Villa");
        const amenity = filteredFinanceByCategory.find(r => r.customerType === customerType && r.line_category === "Amenity");
        const membership = filteredFinanceByCategory.find(r => r.customerType === customerType && r.line_category === "Membership");
        return {
            villaRevenue: villa?.revenue ?? 0,
            amenityRevenue: amenity?.revenue ?? 0,
            membershipRevenue: membership?.revenue ?? 0,
        };
    };
    const finMemberSplit = financeCategorySplit("Member");
    const finGuestSplit = financeCategorySplit("Guests");
    const financeSubText = (split, customerType) => {
        const thirdLabel = customerType === "Guests" ? "membership" : "other";
        const v = Math.abs(split.villaRevenue), a = Math.abs(split.amenityRevenue), m = Math.abs(split.membershipRevenue);
        if (v === 0 && a === 0 && m === 0) return undefined;
        return `${money(v)} villa · ${money(a)} amenity · ${money(m)} ${thirdLabel}`;
    };
    // Total revenue's own villa/amenity/membership breakdown — just
    // Member + Guest summed together (confirmed this reconstructs the
    // same total the old 2-way villa/amenity split already showed, so
    // nothing else changes, this only adds the membership-fee carve-out
    // that's already shown on the Member/Guest rows directly below).
    // "Membership" (not "other") is the right label here specifically
    // because this combines both customer types - it's accurate
    // regardless of who it's attributed to, unlike the Member row's
    // "other", which exists only to avoid implying every member
    // personally pays this fee.
    const finTotalSplit = {
        villaRevenue: (finMemberSplit.villaRevenue ?? 0) + (finGuestSplit.villaRevenue ?? 0),
        amenityRevenue: (finMemberSplit.amenityRevenue ?? 0) + (finGuestSplit.amenityRevenue ?? 0),
        membershipRevenue: (finMemberSplit.membershipRevenue ?? 0) + (finGuestSplit.membershipRevenue ?? 0),
    };
    const finTotalSubText = financeSubText(finTotalSplit, "Guests");

    // ── Hero KPIs — always overall (unfiltered), regardless of any card filter ──
    const heroSummary = visitsTabSummary; // overall object, never filtered
    const heroVillaRevenue = heroSummary?.villa_rental_revenue ?? 0;
    // Bedroom data for the "Most booked bedroom" stat inside Bookings at a glance
    // (follows bookingsFilter, same as the rest of that card).
    const bedroomByBedsForBookingsCard = regroupSum(filteredBedroomBookingsForBookingsCard, "beds", ["bookings", "total_nights"]).map(b => ({
        ...b,
        avg_stay: b.total_nights && b.bookings ? b.total_nights / b.bookings : null,
    }));
    const topBedroom = [...bedroomByBedsForBookingsCard].sort((a, b) => b.bookings - a.bookings)[0];

    // Bedroom data for the standalone Bedroom demand card (its own independent toggle).
    const bedroomDemandByBeds = regroupSum(filteredBedroomBookingsForDemandCard, "beds", ["bookings", "total_nights"]).map(b => ({
        ...b,
        avg_stay: b.total_nights && b.bookings ? b.total_nights / b.bookings : null,
    }));
    const totalBedroomDemandBookings = bedroomDemandByBeds.reduce((a, b) => a + (b.bookings || 0), 0);
    const topBedroomDemand = [...bedroomDemandByBeds].sort((a, b) => b.bookings - a.bookings)[0];

    // Monthly revenue derived (re-aggregated by month after filtering by type)
    // "Revenue by month" now uses the TRANSACTION-level category split
    // (Villa vs Amenity, from /overview/monthly-revenue-by-category) so the
    // card can show a stacked bar per month. villa_payment_type filtering
    // works the same way as everywhere else (booking-level Paid/Free).
    const filteredMonthlyByCategory = applyVillaFilter(monthlyRevenueByCategory, monthlyFilter);
    const monthlyVillaRows = filteredMonthlyByCategory.filter(r => r.line_category === "Villa");
    const monthlyAmenityRows = filteredMonthlyByCategory.filter(r => r.line_category === "Amenity");
    const monthlyVillaByMonth = regroupSum(monthlyVillaRows, "month", ["revenue", "transactions", "bookings"]);
    const monthlyAmenityByMonth = regroupSum(monthlyAmenityRows, "month", ["revenue", "transactions", "bookings"]);
    // Combine into one row per month: villaRevenue, amenityRevenue, and a
    // combined `revenue` total — kept under the same field name `revenue`
    // so peakMonth/Hero KPI band (which only care about the combined
    // total, not the split) don't need any changes.
    const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const allMonthsPresent = [...new Set([...monthlyVillaByMonth.map(m => m.month), ...monthlyAmenityByMonth.map(m => m.month)])];
    const monthlyByMonth = allMonthsPresent
        .map(month => {
            const v = monthlyVillaByMonth.find(m => m.month === month);
            const a = monthlyAmenityByMonth.find(m => m.month === month);
            const villaRevenue = v?.revenue ?? 0;
            const amenityRevenue = a?.revenue ?? 0;
            return {
                month,
                villaRevenue,
                amenityRevenue,
                revenue: villaRevenue + amenityRevenue,
                bookings: Math.max(v?.bookings ?? 0, a?.bookings ?? 0),
            };
        })
        .sort((a, b) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month));
    const peakMonth = [...monthlyByMonth].sort((a, b) => b.revenue - a.revenue)[0];
    const positiveMonths = monthlyByMonth.filter(m => m.revenue > 0);
    const totalPositiveRev = positiveMonths.reduce((a, b) => a + b.revenue, 0);

    const villaStatsWithData = villaStats.filter(v => v.total_nights > 0);
    const totalVillaGuests = villaStats.reduce((a, b) => a + (b.total_guests || 0), 0);
    const totalVillaNights = villaStats.reduce((a, b) => a + (b.total_nights || 0), 0);
    // "Villa types available" — distinct villas with any booking activity,
    // from villaStats (always unfiltered/overall here, same as before).
    // villaStats has one row per villa+bedroom_count+payment_type, so a
    // villa with multiple bedroom configs or both Paid and Free bookings
    // would otherwise be counted more than once without this dedup.
    const distinctVillasWithBookings = new Set(villaStats.map(v => v.villa_name)).size;

    const heroKpis = [
        { label: "Villa Revenue ($USD)", value: heroVillaRevenue > 0 ? money(heroVillaRevenue) : "—", sub: `${heroSummary?.total_room_nights ?? "—"} room nights`, color: C.flame, tip: "The villa rental charge only, not amenities like food, golf or spa. Any charge that was later cancelled or corrected has already been removed, so this is the real amount actually paid across every reservation. This figure is always shown unfiltered, regardless of any toggle elsewhere on the page." },
        { label: "Outstanding ($USD)", value: totalAmountDue?.total_amount_due != null ? `$${(Number(totalAmountDue.total_amount_due) / 1_000_000).toFixed(2)}M` : "—", sub: "Total dues owed", color: C.rust, tip: "Shown in millions. The total of every unpaid balance currently owed, added up across all accounts and all billing periods." },
        { label: "Room Nights", value: heroSummary?.total_room_nights?.toLocaleString() ?? "—", sub: `Avg ${heroSummary?.avg_length_of_stay?.toFixed(1) ?? "—"} nights/stay`, color: C.navyText, tip: "The total number of nights members and guests have stayed, added up across every reservation (e.g. one 7-night stay counts as 7)." },
        { label: "Rev / Booking ($USD)", value: (heroSummary?.total_bookings ?? 0) > 0 ? money(heroVillaRevenue / heroSummary.total_bookings) : "—", sub: "Villa rental average", color: C.navyText, tip: "Villa Revenue divided by the total number of bookings - the average amount a single booking brings in from the villa rental charge alone, not counting amenities." },
        { label: "Peak Month", value: peakMonth?.month ?? "—", sub: peakMonth ? money(peakMonth.revenue) : "—", color: C.flame, tip: "The single calendar month with the highest combined revenue - villa + amenities ($USD). Updates if you change the Overall/Paid/Free toggle on the \"Revenue by month\" card further down the page." },
        { label: "Active Accounts", value: membersByStatus.find(s => s.status === "Active")?.total?.toLocaleString() ?? "—", sub: `of ${totalAccounts.toLocaleString()} total`, color: C.navyText, tip: "The number of member and guest accounts currently marked Active (not Inactive, Cancelled, etc.), out of every account on file. A count of accounts." },
    ];

    return (
        <TooltipContext.Provider value={tooltipCtxValue}>
            <div className="dashboard-section dashboard-section-lg">

                {/* ── Date-range filter — same component/behavior as the Finance
                 tab's, reused directly rather than reimplemented, so the two
                 tabs' period pickers can never visually or behaviorally
                 drift apart. Every card below already reads from
                 villaStats/visitsTabSummary/etc, which dashboard.jsx now
                 refetches whenever `period` changes — this component only
                 needs to render the control itself. ── */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                    <FinancePeriodFilter value={period} onChange={onPeriodChange} years={years} />
                </div>

                {/* ── Dark hero KPI band ── */}
                <section style={{
                    background: C.navy, borderRadius: 18, overflow: "hidden",
                    marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
                }}>
                    {heroKpis.map((k, i) => (
                        <div key={k.label} style={{
                            padding: "22px 20px",
                            borderRight: i < heroKpis.length - 1 ? `1px solid ${C.navyBorder}` : "none",
                            display: "flex", flexDirection: "column", gap: 5,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.navyMuted, fontFamily: "sans-serif" }}>{k.label}</span>
                                <InfoTip text={k.tip} />
                            </div>
                            <span style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.1, color: k.color, fontWeight: 600 }}>{k.value}</span>
                            <span style={{ fontSize: 11, color: C.navyDim, fontFamily: "sans-serif" }}>{k.sub}</span>
                        </div>
                    ))}
                </section>

                {/* ── Row 1: Members · Bookings · Finance ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>

                    {/* Members — no filter (member data not villa-tagged) */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeader label="Members at a glance" tip="Counts every member and guest account on file, broken down by active/inactive status, country, and state. This is account counts only, not bookings or spend." />
                        <div style={{ flex: 1 }}>
                            <StatRow label="Active members" value={membersByStatus.find(s => s.status === "Active")?.members?.toLocaleString() ?? "—"} />
                            <StatRow label="Active guests" value={membersByStatus.find(s => s.status === "Active")?.guests?.toLocaleString() ?? "—"} />
                            <StatRow label="Inactive accounts" value={membersByStatus.find(s => s.status === "Inactive")?.total?.toLocaleString() ?? "—"} />
                            <StatRow label="Guest-to-member ratio" value={memberCount > 0 ? `${Math.round(guestCount / memberCount)}:1` : "—"} />
                            <StatRow label="Total dependents" value={totalDependents?.total_dependents?.toLocaleString() ?? "—"} />
                            <StatRow label="Countries represented" value={membersByCountry.length} />
                            <StatRow label="US states represented" value={membersByState.length} />
                            <StatRow label="With email on file" value={withEmail > 0 ? withEmail.toLocaleString() : "—"} last />
                        </div>
                        <ViewDetailsLink label="View full demographics" tab="demographics" onNavigateToTab={onNavigateToTab} />
                    </div>

                    {/* Bookings — filtered */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Bookings at a glance"
                            tip="Counts whole villa reservations (not individual charges). Paid/Free here describes how the BOOKING itself was classified at intake. Cancelled and no-show bookings are excluded. Every row here counts BOOKINGS, not people - an account that booked twice contributes 2, not 1. Bookings by members + Bookings by guests always adds up to Total bookings exactly."
                            filter={bookingsFilter}
                            onFilterChange={setBookingsFilter}
                        />
                        <div style={{ flex: 1 }}>
                            <StatRow label="Total bookings" value={totalBookingsMadeForBookings.toLocaleString()} />
                            <StatRow label="Bookings by members" value={bookingsSummary?.total_members_booked?.toLocaleString() ?? "—"} />
                            <StatRow label="Bookings by guests" value={bookingsSummary?.total_guests_booked?.toLocaleString() ?? "—"} />
                            <StatRow label="Total room nights" value={bookingsSummary?.total_room_nights?.toLocaleString() ?? "—"} />
                            <StatRow label="Avg. stay" value={bookingsSummary?.avg_length_of_stay != null ? `${bookingsSummary.avg_length_of_stay.toFixed(1)} nights` : "—"} />
                            <StatRow label="Avg. party size" value={bookingsSummary?.avg_party_size != null ? bookingsSummary.avg_party_size.toFixed(1) : "—"} />
                            <StatRow label="Most booked bedroom" value={topBedroom ? `${topBedroom.beds} BR` : "—"} sub={topBedroom ? `${topBedroom.bookings} bookings` : undefined} />
                            <StatRow label="Villa types available" value={distinctVillasWithBookings} last />
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>

                    {/* Finance — filtered */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Finance at a glance ($USD)"
                            tip="This card counts individual CHARGES across every booking, not whole bookings. Paid means money was actually charged for that item, after cancelling out any matching refund or correction. Free means the charge was reversed or comped down to $0 - it does not mean the booking itself was free. Charges that were fully reversed (a charge and its exact-opposite correction, even when worded differently) are pulled out of Total revenue entirely and shown on their own as 'Reversed charges' below, so they don't inflate or distort the numbers. Cash advances (cash handed directly to a guest, billed to their folio) are pulled out the same way, since they aren't product or service revenue. A small number of unusual refunds that don't clearly match a known charge are also left out of Total revenue and shown separately as 'Unexplained anomalies' - see the dedicated table further down the page for the individual lines. Total/Member/Guest revenue each break down into villa, amenity, and membership underneath - Temp Membership Fee charges, labeled 'other' on the Member row specifically since members rarely pay it themselves (mostly only when covering it for a group they're hosting)."
                            filter={financeFilter}
                            onFilterChange={setFinanceFilter}
                        />
                        <div style={{ flex: 1 }}>
                            <StatRow label="Total revenue" value={money(totalVillaRevenue)} sub={finTotalSubText ?? `${money(financeVillaRevenue)} villa · ${money(financeAmenityRevenue)} amenity`} />
                            <StatRow
                                label="Reversed charges"
                                value={reversalsSummary?.reversed_total != null ? money(reversalsSummary.reversed_total) : "—"}
                                sub={reversalsSummary?.reversed_count != null ? `${reversalsSummary.reversed_count.toLocaleString()} charges charged then fully reversed` : undefined}
                            />
                            <StatRow
                                label="Cash advance"
                                value={cashAdvanceSummary?.cash_advance_total != null ? money(cashAdvanceSummary.cash_advance_total) : "—"}
                                sub={cashAdvanceSummary?.cash_advance_count != null ? `${cashAdvanceSummary.cash_advance_count.toLocaleString()} cash advance charges` : undefined}
                            />
                            <StatRow label="Rev. per transaction" value={revPerBooking != null ? money(revPerBooking) : "—"} />
                            <StatRow label="Member revenue" value={finMemberRev?.revenue != null ? `${finMemberRev.revenue < 0 ? "−" : ""}${money(Math.abs(finMemberRev.revenue))}` : "—"} sub={financeSubText(finMemberSplit, "Member")} warn={finMemberRev?.revenue < 0} />
                            <StatRow label="Guest revenue" value={finGuestRev?.revenue != null ? `${finGuestRev.revenue < 0 ? "−" : ""}${money(Math.abs(finGuestRev.revenue))}` : "—"} sub={financeSubText(finGuestSplit, "Guests")} warn={finGuestRev?.revenue < 0} />
                            <StatRow label="Member transactions" value={finMemberRev?.transactions?.toLocaleString() ?? "—"} />
                            <StatRow label="Statement periods" value={amountDueByPeriod.length} last />
                        </div>
                        <ViewDetailsLink label="View full finance breakdown" tab="finance" onNavigateToTab={onNavigateToTab} />
                    </div>
                </div>

                {/* ── Row 2: [Account status + Member vs guest revenue stacked] · Bedroom demand · Monthly revenue ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>

                    {/* Column 1: Account status (top) + Member vs guest revenue (bottom), stacked.
                    Both cards get flex:1 so this column's total height naturally
                    matches Bedroom demand / Revenue by month next to it — the grid
                    row stretches this whole wrapper to match the tallest column,
                    but without flex:1 here, the two cards keep their own natural
                    height and just leave a gap below "Combined total" instead of
                    the column's bottom edge lining up with its neighbors. */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                        {/* Account status — no filter */}
                        <div style={{ ...block, flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
                            <CardHeader label="Account status" tip="Counts every account on file by whether it's currently Active or Inactive, split into members and guests. This is a simple headcount - no dollar amounts." />
                            <div style={{ flex: 1 }}>
                                <div style={{ padding: "14px 16px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
                                    {membersByStatus.map((s) => {
                                        const tot = membersByStatus.reduce((a, b) => a + (b.total || 0), 0);
                                        const pct = tot > 0 ? Math.round((s.total / tot) * 100) : 0;
                                        const isActive = s.status === "Active";
                                        return (
                                            <div key={s.status}>
                                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                                                    <span style={{ color: C.soft, fontFamily: "sans-serif" }}>{s.status}</span>
                                                    <span style={{ fontFamily: serif, fontSize: 17, color: C.text, lineHeight: 1 }}>
                                                        {s.total.toLocaleString()}
                                                        <span style={{ fontSize: 11, fontFamily: "sans-serif", color: C.muted, marginLeft: 4 }}>({pct}%)</span>
                                                    </span>
                                                </div>
                                                <div style={{ height: 6, background: C.panelAlt, borderRadius: 3 }}>
                                                    <div style={{ height: "100%", width: `${pct}%`, background: isActive ? C.navy : C.muted, borderRadius: 3 }} />
                                                </div>
                                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginTop: 4, fontFamily: "sans-serif" }}>
                                                    <span>Members: {s.members?.toLocaleString() ?? "—"}</span>
                                                    <span>Guests: {s.guests?.toLocaleString() ?? "—"}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 16px 4px" }}>
                                    <span className="dashboard-eyebrow">Top account types</span>
                                </div>
                                {membersByType.slice(0, 4).map((t, i, arr) => (
                                    <RankRow key={t.member_type} rank={i + 1} label={t.member_type} value={t.total.toLocaleString()} mini={t.total} total={totalAccounts} last={i === arr.length - 1} />
                                ))}
                            </div>
                            <ViewDetailsLink label="View full demographics" tab="demographics" onNavigateToTab={onNavigateToTab} />
                        </div>

                        {/* Member vs Guest revenue — filtered */}
                        <div style={{ ...block, flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
                            <CardHeaderF
                                label="Member vs guest revenue ($USD)"
                                tip="Splits revenue between Member accounts and Guest accounts. This counts individual charges (villa rental + amenities combined). Paid/Free reflects whether each specific charge was actually paid, after netting out any matching refund or correction - not whether the booking itself was comped. Free shows a NEGATIVE number - the original amount charged before it was comped/reversed - since the actual net cost to the guest is always $0 and wouldn't show what was given away. Each bar splits into Villa (navy), Amenity (orange), and a third slice (rust) that's Temp Membership Fee charges for Guests, or just 'Other' for Members - same category, different label, since members rarely pay this fee."
                                filter={memberGuestFilter}
                                onFilterChange={setMemberGuestFilter}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{ padding: "8px 16px 0", display: "flex", gap: 14, alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: 2, background: C.navy }} />
                                        <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Villa</span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: 2, background: C.flame }} />
                                        <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Amenity</span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: 2, background: C.rust }} />
                                        <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Membership fee / Other</span>
                                    </div>
                                </div>
                                {filteredMemberGuest.map((r, i, arr) => {
                                    const pct = totalRev !== 0 ? Math.round((r.revenue / totalRev) * 100) : 0;
                                    const isNeg = r.revenue < 0;
                                    const { villaRevenue, amenityRevenue, membershipRevenue } = memberGuestCategorySplit(r.customerType);
                                    const villaAbs = Math.abs(villaRevenue);
                                    const amenityAbs = Math.abs(amenityRevenue);
                                    const membershipAbs = Math.abs(membershipRevenue);
                                    const catTotal = villaAbs + amenityAbs + membershipAbs;
                                    // Proportions WITHIN this row's own bar (all three shares add
                                    // to 100% of the bar's own width, which is itself `pct`% of
                                    // the card) — not relative to any other row.
                                    const villaShare = catTotal > 0 ? (villaAbs / catTotal) * 100 : 0;
                                    const amenityShare = catTotal > 0 ? (amenityAbs / catTotal) * 100 : 0;
                                    const membershipShare = catTotal > 0 ? (membershipAbs / catTotal) * 100 : 0;
                                    // Guests are the ones who actually pay this fee — Members
                                    // showing a nonzero value here is the rare exception, so it's
                                    // labeled generically rather than implying every member pays it.
                                    const thirdLabel = r.customerType === "Guests" ? "temp membership fee" : "other";
                                    return (
                                        <div key={r.customerType} style={{ padding: "11px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                                                <span style={{ color: C.soft, fontFamily: "sans-serif" }}>{r.customerType}</span>
                                                <span style={{ fontFamily: serif, fontSize: 17, color: isNeg ? C.accent2 : C.text, lineHeight: 1 }}>
                                                    {isNeg ? "−" : ""}{money(Math.abs(r.revenue))}
                                                    <span style={{ fontSize: 11, fontFamily: "sans-serif", color: C.muted, marginLeft: 4 }}>({pct}%)</span>
                                                </span>
                                            </div>
                                            <div style={{ height: 5, background: C.panelAlt, borderRadius: 3, display: "flex", overflow: "hidden" }}>
                                                <div style={{ height: "100%", width: `${Math.abs(pct)}%`, display: "flex" }}>
                                                    <div style={{ height: "100%", width: `${villaShare}%`, background: C.navy }} />
                                                    <div style={{ height: "100%", width: `${amenityShare}%`, background: C.flame }} />
                                                    <div style={{ height: "100%", width: `${membershipShare}%`, background: C.rust }} />
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 3, fontFamily: "sans-serif" }}>
                                                <span>{isNeg ? "−" : ""}{money(villaAbs)} villa · {isNeg ? "−" : ""}{money(amenityAbs)} amenity · {isNeg ? "−" : ""}{money(membershipAbs)} {thirdLabel}</span>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginTop: 4, fontFamily: "sans-serif" }}>
                                                <span>{r.transactions?.toLocaleString()} transactions</span>
                                                <span>{r.uniqueAccounts} unique accounts</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Combined total</span>
                                <span style={{ fontFamily: serif, fontSize: 16, color: totalRev < 0 ? C.accent2 : C.text }}>
                                    {totalRev < 0 ? "−" : ""}{money(Math.abs(totalRev))}
                                </span>
                            </div>
                            <ViewDetailsLink label="View full finance breakdown" tab="finance" onNavigateToTab={onNavigateToTab} />
                        </div>
                    </div>

                    {/* Bedroom demand — filtered, independent toggle */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Bedroom demand"
                            tip="Groups bookings by how many bedrooms the villa has, showing how many bookings and how long the average stay is for each size. Paid/Free describes how the booking itself was classified at intake, not whether amenities were purchased during the stay."
                            filter={bedroomDemandFilter}
                            onFilterChange={setBedroomDemandFilter}
                        />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                            {bedroomDemandByBeds.map((b, i, arr) => {
                                const pct = totalBedroomDemandBookings > 0 ? Math.round((b.bookings / totalBedroomDemandBookings) * 100) : 0;
                                const isTop = b.beds === topBedroomDemand?.beds;
                                return (
                                    <div key={b.beds} style={{
                                        padding: "9px 16px",
                                        borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none",
                                        background: i % 2 === 0 ? C.bg : C.panel,
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <div style={{
                                                    width: 26, height: 26, borderRadius: 6,
                                                    background: isTop ? C.navy : C.panelAlt,
                                                    color: isTop ? C.flame : C.muted,
                                                    fontSize: 10, fontWeight: 700,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    fontFamily: "sans-serif", flexShrink: 0,
                                                }}>
                                                    {b.beds}BR
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif" }}>{b.bookings} bookings</div>
                                                    <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Avg {b.avg_stay?.toFixed(1) ?? "—"} nights</div>
                                                </div>
                                            </div>
                                            <span style={{ fontFamily: serif, fontSize: 17, color: isTop ? C.accent : C.text }}>{pct}%</span>
                                        </div>
                                        <div style={{ height: 4, background: C.panelAlt, borderRadius: 2 }}>
                                            <div style={{ height: "100%", width: `${pct}%`, background: isTop ? C.navy : C.muted, borderRadius: 2 }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Total bookings tracked</span>
                            <span style={{ fontFamily: serif, fontSize: 16, color: C.text }}>{totalBedroomDemandBookings}</span>
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>

                    {/* Monthly revenue — filtered, stacked Villa vs Amenity */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Revenue by month ($USD)"
                            tip="Each month's bar is the actual money charged that month, split into villa rental (navy) and amenity spend like food, golf, and wine (orange) - only real charges count, not the cancelled/comped portion. The Paid/Free toggle filters by how the underlying booking was classified at intake, then shows that booking's real spend."
                            filter={monthlyFilter}
                            onFilterChange={setMonthlyFilter}
                        />
                        <div style={{ flex: 1 }}>
                            <div style={{ padding: "8px 16px 0", display: "flex", gap: 14, alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 2, background: C.navy }} />
                                    <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Villa</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 2, background: C.flame }} />
                                    <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Amenity</span>
                                </div>
                            </div>
                            {monthlyByMonth.map((m, i, arr) => {
                                const absMax = Math.max(...monthlyByMonth.map(x => Math.abs(x.revenue)));
                                const villaPct = absMax > 0 ? (Math.abs(m.villaRevenue) / absMax) * 100 : 0;
                                const amenityPct = absMax > 0 ? (Math.abs(m.amenityRevenue) / absMax) * 100 : 0;
                                const isPos = m.revenue >= 0;
                                const isPeak = m.month === peakMonth?.month;
                                return (
                                    <div key={m.month} style={{
                                        padding: "7px 16px",
                                        borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none",
                                        background: isPeak ? `color-mix(in srgb, ${C.navy} 4%, transparent)` : i % 2 === 0 ? C.bg : C.panel,
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                                <span style={{ fontSize: 12, color: isPeak ? C.navy : C.soft, fontWeight: isPeak ? 700 : 400, fontFamily: "sans-serif", minWidth: 28 }}>{m.month}</span>
                                                {isPeak && (
                                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 8, background: C.navy, color: C.flame, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: "0.08em" }}>PEAK</span>
                                                )}
                                                <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>{m.bookings} bkgs</span>
                                            </div>
                                            <span style={{ fontFamily: serif, fontSize: 15, color: isPos ? C.text : C.accent2, lineHeight: 1 }}>
                                                {isPos ? "" : "−"}{money(Math.abs(m.revenue))}
                                            </span>
                                        </div>
                                        <div style={{ height: 3, background: C.panelAlt, borderRadius: 2, display: "flex", overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${villaPct}%`, background: C.navy }} />
                                            <div style={{ height: "100%", width: `${amenityPct}%`, background: C.flame }} />
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 3 }}>
                                            <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>{money(m.villaRevenue)} villa</span>
                                            <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>{money(m.amenityRevenue)} amenity</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Positive months total</span>
                            <span style={{ fontFamily: serif, fontSize: 16, color: C.text }}>{money(totalPositiveRev)}</span>
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>
                </div>

                {/* ── Row 3: Top villas by revenue · Top villas by bookings ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

                    {/* Villa revenue table — filtered */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Top villas by revenue ($USD)"
                            tip="Ranks villas by either AMENITY spend (food, golf, spa, wine, equipment, etc.) or the VILLA RENTAL charge itself - switch between them with the toggle below the header. Only charges that were actually paid count (comped/reversed charges are excluded, since they amount to $0). Bookings always counts every stay at that villa, even ones with no amenity spend at all. The Paid/Free pill filters by whether the guest's villa STAY was paid or comped - a comped stay can still show real amenity revenue, since the guest may have paid for extras even though the villa itself was free. One exception: Free + Villa rental revenue shows a NEGATIVE number instead - the full rack-rate value of the nights given away (or the actual amount charged, if that happens to be larger), since actual revenue collected on a comped stay is usually at or near $0 and wouldn't show what was given up."
                            filter={villaRevFilter}
                            onFilterChange={(val) => { setVillaRevFilter(val); setVillaRevVisibleCount(10); }}
                        />
                        <div style={{ flex: 1 }}>
                            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
                                <MetricToggle
                                    value={villaRevMetric}
                                    onChange={(val) => { setVillaRevMetric(val); setVillaRevVisibleCount(10); }}
                                    options={[
                                        { key: "amenity", label: "Amenity revenue" },
                                        { key: "villa", label: "Villa rental revenue" },
                                    ]}
                                />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "7px 16px", borderBottom: `1px solid ${C.border}`, background: C.panelAlt }}>
                                {["Villa", villaRevMetric === "villa" ? "Villa revenue" : "Amenity revenue", "Bookings", "Amenity txns"].map(h => (
                                    <span key={h} style={{ fontSize: 9, color: C.muted, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
                                ))}
                            </div>
                            {villaRevPositive.slice(0, villaRevVisibleCount).map((v, i, arr) => (
                                <div key={v.villaName} style={{
                                    display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                                    padding: "8px 16px",
                                    borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none",
                                    background: i % 2 === 0 ? C.bg : C.panel,
                                    alignItems: "center",
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                        <div style={{
                                            width: 18, height: 18, borderRadius: 4,
                                            background: i === 0 ? C.navy : C.panelAlt,
                                            color: i === 0 ? C.flame : C.muted,
                                            fontSize: 9, fontWeight: 700,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontFamily: "sans-serif", flexShrink: 0,
                                        }}>{i + 1}</div>
                                        <span style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.villaName}</span>
                                    </div>
                                    <span style={{ fontFamily: serif, fontSize: 14, color: v.revenue < 0 ? C.accent2 : C.accent }}>
                                        {v.revenue < 0 ? "−" : ""}{money(Math.abs(v.revenue))}
                                    </span>
                                    <span style={{ fontFamily: serif, fontSize: 14, color: C.text }}>{v.totalBookings}</span>
                                    <span style={{ fontFamily: serif, fontSize: 14, color: C.soft }}>{v.amenityTransactions?.toLocaleString() ?? "—"}</span>
                                </div>
                            ))}
                            {(() => {
                                const totalAvailable = Math.min(villaRevPositive.length, 50);
                                const nextCount = Math.min(villaRevVisibleCount + 10, 50, villaRevPositive.length);
                                const remainingToShow = nextCount - villaRevVisibleCount;
                                if (remainingToShow <= 0) return null;
                                return (
                                    <button
                                        onClick={() => setVillaRevVisibleCount(nextCount)}
                                        style={{
                                            width: "100%", padding: "9px 16px",
                                            background: C.panelAlt, border: "none",
                                            borderTop: `1px solid ${C.border}`,
                                            color: C.accent, fontFamily: "sans-serif",
                                            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                                            textTransform: "uppercase", cursor: "pointer",
                                        }}
                                    >
                                        See {remainingToShow} more (showing {villaRevVisibleCount} of {totalAvailable})
                                    </button>
                                );
                            })()}
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>

                    {/* Top villas by bookings — Paid/Free villa-stay toggle, See-more pagination */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Top villas by bookings"
                            tip="Ranks villas by how many separate reservations they've had - a count of bookings, not a dollar amount. A villa can appear here with bookings that have no amenity spend at all, which is why its count may not match the same villa's appearance on 'Top villas by revenue.' Paid/Free describes how each booking was classified at intake."
                            filter={villaBookingsFilter}
                            onFilterChange={(val) => { setVillaBookingsFilter(val); setVillaBookingsVisibleCount(10); }}
                        />
                        <div style={{ flex: 1 }}>
                            {villaBookingsPositive.slice(0, villaBookingsVisibleCount).map((v, i, arr) => (
                                <RankRow key={v.villaName} rank={i + 1} label={v.villaName} value={v.bookings} mini={v.bookings} total={villaBookingsPositive[0]?.bookings || 1} last={i === arr.length - 1} />
                            ))}
                            {(() => {
                                const totalAvailable = Math.min(villaBookingsPositive.length, 50);
                                const nextCount = Math.min(villaBookingsVisibleCount + 10, 50, villaBookingsPositive.length);
                                const remainingToShow = nextCount - villaBookingsVisibleCount;
                                if (remainingToShow <= 0) return null;
                                return (
                                    <button
                                        onClick={() => setVillaBookingsVisibleCount(nextCount)}
                                        style={{
                                            width: "100%", padding: "9px 16px",
                                            background: C.panelAlt, border: "none",
                                            borderTop: `1px solid ${C.border}`,
                                            color: C.accent, fontFamily: "sans-serif",
                                            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                                            textTransform: "uppercase", cursor: "pointer",
                                        }}
                                    >
                                        See {remainingToShow} more (showing {villaBookingsVisibleCount} of {totalAvailable})
                                    </button>
                                );
                            })()}
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>
                </div>

                {/* ── Row 4: Unexplained anomalies — reviewable list ── */}
                <div style={{ marginTop: 12 }}>
                    <div style={block}>
                        <CardHeader
                            label="Unexplained anomalies"
                            tip="Individual credits/refunds that exceed their original charge and couldn't be matched to a specific charge cleanly enough to call it a reversal - either several same-amount charges exist in that booking (no reliable way to tell which one a credit belongs to), or no matching charge exists at all. Already excluded from every revenue total elsewhere on this page (Total revenue, villa/amenity breakdowns, etc.) - listed here so they're reviewable instead of just disappearing."
                        />
                        {anomalies.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.3fr 2.4fr 0.9fr 1fr", padding: "7px 16px", borderBottom: `1px solid ${C.border}`, background: C.panelAlt }}>
                                {["Conf Code", "Villa", "Description", "Category", "Amount"].map(h => (
                                    <span key={h} style={{ fontSize: 9, color: C.muted, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
                                ))}
                            </div>
                        )}
                        {anomalies.slice(0, anomaliesVisibleCount).map((a, i, arr) => (
                            <div key={`${a.conf_code}-${a.description}-${i}`} style={{
                                display: "grid", gridTemplateColumns: "0.8fr 1.3fr 2.4fr 0.9fr 1fr",
                                padding: "8px 16px",
                                borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none",
                                background: i % 2 === 0 ? C.bg : C.panel,
                                alignItems: "center",
                            }}>
                                <span style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif" }}>{a.conf_code}</span>
                                <span style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.villa_name || "—"}</span>
                                <span style={{ fontSize: 12, color: C.soft, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.description}</span>
                                <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>{a.line_category}</span>
                                <span style={{ fontFamily: serif, fontSize: 14, color: C.accent2 }}>
                                    −{money(Math.abs(a.net_amount), 2)}
                                </span>
                            </div>
                        ))}
                        {anomalies.length === 0 && (
                            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>
                                No unexplained anomalies.
                            </div>
                        )}
                        {anomalies.length > 0 && (
                            <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Total ({anomalies.length.toLocaleString()} lines)</span>
                                <span style={{ fontFamily: serif, fontSize: 16, color: C.accent2 }}>
                                    −{money(Math.abs(anomalies.reduce((sum, a) => sum + (a.net_amount || 0), 0)), 2)}
                                </span>
                            </div>
                        )}
                        {(() => {
                            const totalAvailable = anomalies.length;
                            const nextCount = Math.min(anomaliesVisibleCount + 10, totalAvailable);
                            const remainingToShow = nextCount - anomaliesVisibleCount;
                            if (remainingToShow <= 0) return null;
                            return (
                                <button
                                    onClick={() => setAnomaliesVisibleCount(nextCount)}
                                    style={{
                                        width: "100%", padding: "9px 16px",
                                        background: C.panelAlt, border: "none",
                                        borderTop: `1px solid ${C.border}`,
                                        color: C.accent, fontFamily: "sans-serif",
                                        fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                                        textTransform: "uppercase", cursor: "pointer",
                                    }}
                                >
                                    See {remainingToShow} more (showing {Math.min(anomaliesVisibleCount, totalAvailable)} of {totalAvailable})
                                </button>
                            );
                        })()}
                    </div>
                </div>

            </div>
            <FixedTooltip />
        </TooltipContext.Provider>
    );
}