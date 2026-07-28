// frontend/src/pages/OverviewTab.jsx

import { createContext, useContext, useState, useMemo } from "react";
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
    const { text, rect, width: customWidth } = ctx.active;
    const width = customWidth || 280;
    const margin = 8;
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = rect.bottom + 6;
    // Flip above the icon if there's clearly more room there than below
    // — avoids guessing the tooltip's exact height up front.
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    // text can be a plain string (rendered as-is, unchanged from before)
    // OR an array of { label, body } sections (added 2026-06-28) — each
    // gets its own bold mini-header and its own paragraph, with a
    // divider between sections, so e.g. the Tips explanation reads as
    // visually distinct from the Cash Advance explanation instead of
    // all running together in one wall of text.
    const isSections = Array.isArray(text);
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
            padding: isSections ? "10px 12px" : "8px 10px",
            borderRadius: 8,
            zIndex: 9999,
            fontFamily: "sans-serif",
            fontWeight: 400,
            pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        }}>
            {isSections ? (
                text.map((section, i) => (
                    <div
                        key={section.label ?? i}
                        style={{
                            paddingTop: i === 0 ? 0 : 8,
                            marginTop: i === 0 ? 0 : 8,
                            borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.14)",
                        }}
                    >
                        {section.label && (
                            <div style={{ fontWeight: 700, color: "#fff", marginBottom: 2, fontSize: 11 }}>
                                {section.label}
                            </div>
                        )}
                        <div>{section.body}</div>
                    </div>
                ))
            ) : text}
        </div>
    );
}

const InfoDot = ({ tip, width }) => {
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
            onMouseEnter={(e) => ctx?.show(tip, e.currentTarget.getBoundingClientRect(), width)}
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
const CardHeader = ({ label, tip, tipWidth }) => (
    <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
        <span className="dashboard-eyebrow">{label}</span>
        <InfoDot tip={tip} width={tipWidth} />
    </div>
);

// Header with filter pills
const CardHeaderF = ({ label, tip, tipWidth, filter, onFilterChange }) => (
    <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    }}>
        <span className="dashboard-eyebrow">{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FilterPill value={filter} onChange={onFilterChange} />
            <InfoDot tip={tip} width={tipWidth} />
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
// avg_length_of_stay, avg_party_size, total_room_nights, villa_rental_revenue,
// total_villa_revenue}). This picks the right slice depending on the active filter.
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
        total_villa_revenue: 0,
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
        // Fixed 2026-07-02: if the dataset already provides a genuinely
        // pre-aggregated "Overall" row per group (added for
        // transactionMemberVsGuestRevenue specifically, to fix
        // uniqueAccounts — a COUNT(DISTINCT ...) can't be correctly
        // derived by summing separate Paid/Free rows client-side,
        // since anyone with both would be double-counted, or under the
        // old regroupSum-based approach, simply not summed at all and
        // silently wrong), use those rows directly instead of summing.
        // Falls back to the original client-side sum for any dataset
        // that doesn't provide this — unchanged behavior for
        // transactionFinanceSummary and transactionMemberVsGuestRevenueByCategory.
        const overallRows = rows.filter(r => r.line_status === "Overall");
        if (overallRows.length > 0) {
            return overallRows;
        }
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
    averageTenure = null, // Added 2026-07-01: same as above - powers "Avg. membership tenure".
    newMembersPerYear = [], // Added 2026-07-01: fetched by dashboard.jsx for a while, wasn't passed to this component until now - powers "New members this year".
    averageLengthOfStay = null,
    bookingsByMonth = [],
    bookingsByRoomType = [], // DEPRECATED — no longer read; "Villa types available" now counts distinct villas from villaStats instead (see below), to stay consistent with every other villa-related number on this page rather than depending on a separate `rooms` table this page otherwise never touches. Safe to stop passing this from dashboard.jsx.
    mostUsedRoomTypes = [], // DEPRECATED — no longer read; "Top villas by bookings" now uses villaStats. Safe to stop passing this from dashboard.jsx.
    totalDependents = null,
    // totalAmountDue / amountDueByPeriod removed 2026-07-01 — statements
    // stopped generating from folios (always $0 / empty), so both the hero
    // band's old "Outstanding" tile and the "Statement periods" stat row
    // were pulled, and dashboard.jsx stopped passing these props. If
    // statement generation resumes, re-add here + in overview_analytics.py
    // (/overview/amount-due, /overview/amount-due-by-period).
    topSpendDescriptions = [],
    directoryMembers = [], // No longer populated by dashboard.jsx (was always []); "With email on file" now uses emailOnFile below instead. `checkedIn` further down still reads this but is dead/unrendered.
    emailOnFile = null,
    memberDuesSummary = null,
    outstandingBalanceSummary = null,
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
    rackRateSummary = null,
    cashAdvanceSummary = null,
    anomaliesSummary = null,
    anomalies = [],
    tipsSummary = null,
    internalTransfersSummary = null,
    paymentsSummary = null,
    paymentCorrectionsSummary = null,
}) {
    // ── Per-card filter state ──────────────────────────────────────
    // Shared fixed-position tooltip state — see TooltipContext/FixedTooltip
    // above for why this exists instead of the old CSS :hover approach.
    const [tooltipActive, setTooltipActive] = useState(null);
    const tooltipCtxValue = useMemo(() => ({
        active: tooltipActive,
        show: (text, rect, width) => setTooltipActive({ text, rect, width }),
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
    const filteredMemberGuest = applyLineStatusFilter(transactionMemberVsGuestRevenue, "overall", "customerType");
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
        "overall",
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
            // Added 2026-06-28: did this villa actually have a Free
            // booking on record at all (i.e. it appears in
            // villaRackRateFree), regardless of whether its rack rate
            // happened to total exactly $0 (e.g. an internal "HO"
            // comp-rate booking, genuinely priced at $0 by the source
            // system - not missing data, just a real zero). The filter
            // below needs this instead of checking revenue < 0, since a
            // real $0 giveaway would otherwise fail a strict "< 0" check
            // and silently disappear even though the villa genuinely had
            // a Free stay.
            hasFreeBooking: Boolean(rackRow),
        };
    });

    // Villa revenue sorted. In the Free rack-rate view, "top" means
    // biggest giveaway, i.e. most negative first — everywhere else it's
    // highest revenue first, as before.
    const villaRevSorted = [...villaRevSource].sort((a, b) =>
        isFreeRackRateView ? a.revenue - b.revenue : b.revenue - a.revenue
    );
    // Likewise, the Free rack-rate view wants every villa with a genuine
    // Free booking on record, even ones whose rack rate (or actual
    // revenue) totals exactly $0 — e.g. an internal "HO" comp-rate
    // booking the source system itself prices at $0, not a data gap.
    // Checking hasFreeBooking instead of revenue < 0 (changed 2026-06-28)
    // is what keeps those villas from silently vanishing from this list
    // despite genuinely having Free bookings (confirmed against Hyde Park
    // and Twin Palms, both $0 rack rate, both real Free stays).
    // Everywhere else (not the Free rack-rate view), behavior is
    // unchanged: revenue > 0 only.
    const villaRevPositive = villaRevSorted.filter(v => isFreeRackRateView ? (v.revenue < 0 || v.hasFreeBooking) : v.revenue > 0);

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
    const checkedIn = directoryMembers.filter(m => m.currently_checked_in).length; // dead: directoryMembers is never populated; nothing currently renders `checkedIn`.
    // withEmail (2026-07-01): previously `directoryMembers.filter(m => m.email).length`,
    // but dashboard.jsx always passed directoryMembers as [] (never wired to a real
    // data source), so this was permanently 0 → rendered as "—". Now reads the real
    // count from /overview/email-on-file via the emailOnFile prop.
    const withEmail = emailOnFile?.with_email ?? null;

    // ── Additional Members at a glance stats (added 2026-07-01) — all
    // sourced from data dashboard.jsx was already fetching but not passing/
    // rendering here (see prop comments above). No new backend work needed.
    const avgTenureYears = averageTenure?.average_tenure_years ?? null;
    const currentYear = new Date().getFullYear();
    const newMembersThisYear = newMembersPerYear.find(y => y.year === currentYear);

    const guestCount = membersByType.find(t => t.member_type === "Guests")?.total ?? 0;
    const memberCount = membersByType
        .filter(t => !["Guests", "Family Dependent", "Spa Outside Guests", "Banquet Functions", "Golf Guest"].includes(t.member_type))
        .reduce((a, b) => a + (b.total || 0), 0);
    const totalAccounts = membersByType.reduce((a, b) => a + (b.total || 0), 0);

    // Revenue totals — respect filter
    const memberRev = filteredMemberGuest.find(r => r.customerType === "Member");
    const guestRev = filteredMemberGuest.find(r => r.customerType === "Guests");
    // Real Member dues (statement_details) counts toward Combined total,
    // per explicit decision — it's real, posted, dated revenue (see
    // /overview/member-dues-summary), same as villa/amenity.
    const totalRev = (memberRev?.revenue ?? 0) + (guestRev?.revenue ?? 0) + (memberDuesSummary?.total_dues ?? 0);

    // ── Bookings card summary — respects bookingsFilter via visitsTabSummary.by_payment_type ──
    const bookingsSummary = pickSummary(visitsTabSummary, bookingsFilter);
    // total_bookings, total_members_booked, and total_guests_booked are all
    // COUNT(*) (bookings, not distinct people) since 2026-06-26 — see
    // overview_analytics.py's docstring on /overview/visits-summary. Using
    // total_bookings directly here either way, since "Total bookings" is
    // the headline figure regardless of how the other two are computed.
    const totalBookingsMadeForBookings = bookingsSummary?.total_bookings ?? 0;
    // ADR (Average Daily Rate) = actual villa revenue collected ÷ room nights
    // sold — industry-standard definition, NOT rack/published rate (that's a
    // separate concept, used for the Free-villa give-away calc elsewhere on
    // this page). Reuses bookingsSummary's own villa_rental_revenue/
    // total_room_nights, so it automatically respects this card's Paid/Free/
    // Overall filter exactly like every other stat in it — no new endpoint
    // needed. Added 2026-07-01.
    //
    // NOTE (2026-07-16): villa_rental_revenue stays BOOKING-level here on
    // purpose — the rental-programme income has no room nights or booking
    // count in our data to average over, so it must never enter ADR or
    // Rev/Booking. The hero tile's headline uses total_villa_revenue
    // (transaction-level, includes the programme) instead — see heroVillaRevenue.
    // [2026-07-19] ADR now derives from the nightly rate schedule
    // (rackRateSummary.charged_total, see the note below where
    // rackRateSummaryPicked is built) rather than booking-level ledger
    // revenue. Ledger revenue is zeroed for rental-programme villas by
    // the double-count guard while their nights remain in the
    // denominator, which produced an ADR of $98.69 against a $2,809
    // rack rate (2,519 of 2,660 bookings contributed nights but no
    // revenue). Defined below rackRateSummaryPicked.
    // Rack ADR + effective discount (added 2026-07-01, same request as ADR
    // above): rack rate = published/list price, so ADR ÷ rack ADR shows how
    // much of full price is actually being collected on average. Picked from
    // rackRateSummary the same way bookingsSummary is picked from
    // visitsTabSummary — "overall" object directly, or the matching
    // by_payment_type row for Paid/Free — so it follows this card's own
    // filter, not bookingsFilter's raw key.
    const rackRateSummaryPicked = !rackRateSummary
        ? null
        : bookingsFilter === "overall"
            ? rackRateSummary
            : (rackRateSummary.by_payment_type || []).find(r => r.villa_payment_type === filterKeyToType(bookingsFilter))
            ?? { rack_rate_total: 0, total_room_nights: 0 };
    const rackAdr = rackRateSummaryPicked?.total_room_nights > 0
        ? rackRateSummaryPicked.rack_rate_total / rackRateSummaryPicked.total_room_nights
        : null;
    // ADR = what was actually charged per night, same source/filter/night
    // set as rackAdr above so the discount comparison is like-for-like.
    const adr = rackRateSummaryPicked?.total_room_nights > 0
        ? (rackRateSummaryPicked.charged_total ?? 0) / rackRateSummaryPicked.total_room_nights
        : null;
    const effectiveDiscountPct = adr != null && rackAdr != null && rackAdr > 0
        ? (1 - adr / rackAdr) * 100
        : null;

    // ── Finance card — TRANSACTION-LEVEL Paid/Free (villa + amenity combined),
    // respects financeFilter. Distinct from the booking-level "Paid/Free villa
    // stay" meaning used everywhere else on this page — see
    // applyLineStatusFilter's comment for why.
    const financeLines = applyLineStatusFilter(transactionFinanceSummary, financeFilter, r => `${r.line_category}`);
    const financeVillaRevenue = financeLines.find(r => r.line_category === "Villa")?.total_amount ?? 0;
    const financeAmenityRevenue = financeLines.find(r => r.line_category === "Amenity")?.total_amount ?? 0;
    // Kept as the literal NET total (always exactly $0 under the Free
    // filter, by definition - see overview_views.sql's 'Free' status
    // docstring) deliberately, NOT switched to gross/value-given-away —
    // this feeds Rev. per transaction below, where "$0 collected per
    // free transaction" is accurate and uncontradicted by anything else
    // on that row. The "Total revenue" StatRow itself uses a separate
    // display-only figure instead (totalRevenueDisplay, defined after
    // finTotalSplit below) so its headline number agrees with its own
    // sub-text and the Member vs Guest card, without changing what
    // Rev. per transaction means.
    const totalVillaRevenue = financeVillaRevenue + financeAmenityRevenue;
    const financeTransactionCount = financeLines.reduce((a, b) => a + (b.transaction_count || 0), 0);
    const revPerBooking = financeTransactionCount > 0 ? totalVillaRevenue / financeTransactionCount : null;

    // Member vs guest revenue for the Finance card's "Member revenue" /
    // "Guest revenue" / "Member transactions" rows — same transaction-level
    // source as the standalone Member vs guest revenue card (which always
    // shows Overall now, no toggle), filtered here by this card's own
    // financeFilter instead.
    const financeMemberGuestLines = applyLineStatusFilter(transactionMemberVsGuestRevenue, financeFilter, "customerType");
    const finMemberRev = financeMemberGuestLines.find(r => r.customerType === "Member");
    const finGuestRev = financeMemberGuestLines.find(r => r.customerType === "Guests");

    // Villa/Amenity/Membership breakdown for the same two rows — same
    // category split as memberGuestCategorySplit (see that function's
    // comment for what "Membership" means and why the label differs by
    // customerType), filtered here by this card's own financeFilter,
    // since this card has its own independent toggle (unlike Member vs
    // guest revenue, which always shows Overall now).
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
    // Real Member dues (statement_details) counts toward Total revenue
    // here too, matching the decision already made for Member vs guest
    // revenue's Combined total. Included under both "Overall" and "Paid"
    // (see includeDuesInFinanceTotal below) — dues represents real posted
    // charges with no comp/Free concept of its own, so it's excluded
    // only from the Free view specifically. Computed here (before
    // finTotalSubText below) so the sub-text can include it too — otherwise the headline total and its own sub-text breakdown
    // would stop agreeing with each other again, the exact class of bug
    // already fixed once for the Free view on 2026-06-28.
    const financeDuesAmount = memberDuesSummary?.total_dues ?? 0;
    // Fixed 2026-07-03 per request: dues now also counts under the Paid
    // view, not just Overall — dues represents real, posted charges (no
    // comp/Free concept of its own, unlike villa/amenity), so attributing
    // it to "Paid" (money actually collected) is more accurate than
    // leaving it out entirely. Still excluded from Free specifically,
    // since there's no such thing as a "free" dues charge to show.
    const includeDuesInFinanceTotal = financeFilter === "overall" || financeFilter === "paid_villa";
    const finTotalSubText = (() => {
        const v = Math.abs(finTotalSplit.villaRevenue);
        const a = Math.abs(finTotalSplit.amenityRevenue);
        const membershipAndDues = Math.abs(finTotalSplit.membershipRevenue) + (includeDuesInFinanceTotal ? financeDuesAmount : 0);
        if (v === 0 && a === 0 && membershipAndDues === 0) return undefined;
        return `${money(v)} villa · ${money(a)} amenity · ${money(membershipAndDues)} membership & dues`;
    })();
    // Fixed 2026-06-28: under the Free filter, totalVillaRevenue above is
    // always exactly $0 (net amount, by definition - see comment where
    // it's declared), which contradicted finTotalSubText right below it
    // on the same row (computed from gross_charged_amount, i.e. value
    // given away) and the Member vs Guest card next to it - showing
    // "Total revenue: $0" with a sub-text that itself sums to a six-figure
    // number. Under Free, show the same value-given-away total the
    // sub-text and Member vs Guest card already agree on instead.
    const isFreeFinanceView = financeFilter === "free_villa";
    const totalRevenueDisplay = isFreeFinanceView
        ? -(Math.abs(finTotalSplit.villaRevenue) + Math.abs(finTotalSplit.amenityRevenue) + Math.abs(finTotalSplit.membershipRevenue))
        : finTotalSplit.villaRevenue + finTotalSplit.amenityRevenue + finTotalSplit.membershipRevenue + (includeDuesInFinanceTotal ? financeDuesAmount : 0);

    // ── Hero KPIs — always overall (unfiltered), regardless of any card filter ──
    const heroSummary = visitsTabSummary; // overall object, never filtered
    // Hero headline shows TOTAL villa revenue (transaction-level, from
    // /overview/visits-summary-by-payment-type's total_villa_revenue —
    // added 2026-07-16): member-journal rentals PLUS rental-programme
    // income at net value, identical source to the Finance card's villa
    // slot so the two can never disagree. Falls back to the old
    // booking-level field if the backend hasn't been updated yet.
    // ADR and Rev/Booking deliberately KEEP the booking-level
    // villa_rental_revenue — the programme income has no room nights or
    // booking count in our data to average over.
    const heroVillaRevenue = heroSummary?.total_villa_revenue
        ?? heroSummary?.villa_rental_revenue ?? 0;
    // [2026-07-19] Rev/Booking had the same defect as ADR — booking-level
    // ledger revenue divided by a booking count that includes programme
    // villas whose revenue the dedup removed (~$703/booking). Uses the
    // rate schedule's charged total and its own reservation count.
    const heroBookingLevelVillaRevenue =
        rackRateSummary?.charged_total ?? heroSummary?.villa_rental_revenue ?? 0;
    const heroReservationCount =
        rackRateSummary?.total_reservations ?? null;
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
        { label: "Villa Revenue ($USD)", value: heroVillaRevenue > 0 ? money(heroVillaRevenue) : "—", sub: "Incl. rental programme income", color: C.flame, tip: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. This is all villa rental income for the period: stays billed through member accounts plus the rental-programme payouts to villa owners (used exactly as paid out - no commission is deducted; tax is already excluded). Amenities are not included. Matches the Villa figure on Finance at a glance exactly. Always shows the full picture, regardless of any toggle elsewhere on the page." },
        // "Outstanding ($USD)" removed again 2026-07-03, per request. Was
        // rebuilt earlier the same day using the new statements table
        // (/overview/outstanding-balance-summary) after being removed on
        // 2026-07-01 for a different, unrelated reason (the old
        // folio-based statement pipeline had stopped producing data).
        // The backend endpoint and dashboard.jsx wiring are left intact
        // in case this comes back again later — only the hero tile itself
        // is removed here.
        { label: "Room Nights", value: heroSummary?.total_room_nights?.toLocaleString() ?? "—", sub: `Avg ${heroSummary?.avg_length_of_stay?.toFixed(1) ?? "—"} nights/stay`, color: C.navyText, tip: "Total nights stayed across every reservation - one 7-night stay counts as 7. Rental-programme stays are not included, because those bookings are not individually tracked in our data, only their income is." },
        { label: "Rev / Booking ($USD)", value: (heroReservationCount ?? 0) > 0 ? money(heroBookingLevelVillaRevenue / heroReservationCount) : "—", sub: "Avg. rate charged per reservation", color: C.navyText, tip: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. This is posted villa rental money from tracked bookings, divided by the number of those bookings - the average one booking brings in from the room charge alone, not counting amenities. Rental-programme income is left out because those stays have no booking count, so including it would inflate the average." },
        { label: "Peak Month", value: peakMonth?.month ?? "—", sub: peakMonth ? money(peakMonth.revenue) : "—", color: C.flame, tip: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. Peak Month is the month with the most posted money - villa plus amenities, including rental-programme income in the month it was earned. Follows the Overall/Paid/Free toggle on the Revenue by month card further down." },
        { label: "Active Accounts", value: membersByStatus.find(s => s.status === "Active")?.total?.toLocaleString() ?? "—", sub: `of ${totalAccounts.toLocaleString()} total`, color: C.navyText, tip: "How many member and guest accounts are currently marked Active, out of every account on file. A count of accounts, not dollars." },
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
                    marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
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
                        <CardHeader
                            label="Members at a glance"
                            tipWidth={340}
                            tip={[
                                {
                                    label: "How this card counts accounts",
                                    body: "A simple headcount of every member and guest account on file. No dollar amounts, no bookings. The date picker above does not affect this card - it is always a current snapshot.",
                                },
                                {
                                    label: "Active members / Active guests / Inactive accounts",
                                    body: "Split by each account's current status. Inactive covers anything no longer current - cancelled or deactivated - whether it was a member or a guest account.",
                                },
                                {
                                    label: "Guest-to-member ratio",
                                    body: "Guest accounts divided by member accounts, rounded to a whole number. Special categories like dependents and spa or golf day guests are left out of the member count.",
                                },
                                {
                                    label: "Total dependents",
                                    body: "All spouses, children, and other dependents linked to member accounts.",
                                },
                                {
                                    label: "Avg. membership tenure",
                                    body: "The average number of years members have been with the club, based on each member's join date.",
                                },
                                {
                                    label: "New members this year",
                                    body: "Accounts whose join date falls in this calendar year.",
                                },

                                {
                                    label: "Countries / US states represented",
                                    body: "How many different countries and US states appear in member addresses.",
                                },
                                {
                                    label: "With email on file",
                                    body: "Member accounts that have an email address on file.",
                                },
                            ]}
                        />
                        <div style={{ flex: 1 }}>
                            <StatRow label="Active members" value={membersByStatus.find(s => s.status === "Active")?.members?.toLocaleString() ?? "—"} />
                            <StatRow label="Active guests" value={membersByStatus.find(s => s.status === "Active")?.guests?.toLocaleString() ?? "—"} />
                            <StatRow label="Inactive accounts" value={membersByStatus.find(s => s.status === "Inactive")?.total?.toLocaleString() ?? "—"} />
                            <StatRow label="Guest-to-member ratio" value={memberCount > 0 ? `${Math.round(guestCount / memberCount)}:1` : "—"} />
                            <StatRow label="Total dependents" value={totalDependents?.total_dependents?.toLocaleString() ?? "—"} />
                            <StatRow label="Avg. membership tenure" value={avgTenureYears != null ? `${avgTenureYears.toFixed(1)} yrs` : "—"} />
                            <StatRow label="New members this year" value={newMembersThisYear?.total?.toLocaleString() ?? "—"} sub={newMembersThisYear ? `${newMembersThisYear.members ?? 0} members, ${newMembersThisYear.guests ?? 0} guests` : undefined} />
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
                            tipWidth={340}
                            tip={[
                                {
                                    label: "How this card counts bookings",
                                    body: "Counts whole reservations, not charges. Someone who booked twice counts as 2. Cancelled and no-show bookings are excluded. Paid or Free here means whether the stay itself was paid or comped. Rental-programme stays are not counted - those bookings are not individually tracked in our data, only their income is (shown on the revenue cards).",
                                },
                                {
                                    label: "Bookings by members / by guests",
                                    body: "These always add up to Total bookings - every booking is one or the other.",
                                },
                                {
                                    label: "Total room nights",
                                    body: "All nights stayed, added together. A single 7-night stay counts as 7.",
                                },
                                {
                                    label: "ADR (avg. daily rate)",
                                    body: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. ADR is that posted villa rental money divided by nights sold - the real average earned per night after discounts and corrections, not the list price. Rental-programme income is left out because it has no night count to divide by.",
                                },
                                {
                                    label: "Rack rate ADR",
                                    body: "The list price per night, averaged the same way as ADR. The gap between the two is the average discount being given. If ADR is higher than rack, stays were billed above list price on average - that is real, not an error.",
                                },
                                {
                                    label: "Avg. stay / Avg. party size",
                                    body: "Average nights per stay and average people per booking, following the filter above.",
                                },
                                {
                                    label: "Most booked bedroom",
                                    body: "The bedroom size (for example 4 BR) with the most bookings in the period.",
                                },
                                {
                                    label: "Villa types available",
                                    body: "How many different villas had at least one booking in the period.",
                                },
                            ]}
                            filter={bookingsFilter}
                            onFilterChange={setBookingsFilter}
                        />
                        <div style={{ flex: 1 }}>
                            <StatRow label="Total bookings" value={totalBookingsMadeForBookings.toLocaleString()} />
                            <StatRow label="Bookings by members" value={bookingsSummary?.total_members_booked?.toLocaleString() ?? "—"} />
                            <StatRow label="Bookings by guests" value={bookingsSummary?.total_guests_booked?.toLocaleString() ?? "—"} />
                            <StatRow label="Total room nights" value={bookingsSummary?.total_room_nights?.toLocaleString() ?? "—"} />
                            <StatRow label="ADR (avg. daily rate)" value={adr != null ? money(adr, 2) : "—"} />
                            <StatRow label="Rack rate ADR" value={rackAdr != null ? money(rackAdr, 2) : "—"} sub={effectiveDiscountPct != null ? `${effectiveDiscountPct.toFixed(1)}% avg. discount off rack` : "Published/list price"} />
                            <StatRow label="Avg. stay" value={bookingsSummary?.avg_length_of_stay != null ? `${bookingsSummary.avg_length_of_stay.toFixed(1)} nights` : "—"} />
                            <StatRow label="Avg. party size" value={bookingsSummary?.avg_party_size != null ? bookingsSummary.avg_party_size.toFixed(1) : "—"} sub={bookingsSummary?.party_size_sample != null && totalBookingsMadeForBookings > 0 ? `from ${bookingsSummary.party_size_sample.toLocaleString()} of ${totalBookingsMadeForBookings.toLocaleString()} bookings` : undefined} />
                            <StatRow label="Most booked bedroom" value={topBedroom ? `${topBedroom.beds} BR` : "—"} sub={topBedroom ? `${topBedroom.bookings} bookings` : undefined} />
                            <StatRow label="Villa types available" value={distinctVillasWithBookings} last />
                        </div>
                        <ViewDetailsLink label="View villa & room performance" tab="visits" onNavigateToTab={onNavigateToTab} />
                    </div>

                    {/* Finance — filtered */}
                    <div style={{ ...block, display: "flex", flexDirection: "column" }}>
                        <CardHeaderF
                            label="Finance at a glance ($USD)"
                            tipWidth={340}
                            tip={[
                                {
                                    label: "How this card counts money",
                                    body: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. This card counts individual charges, not whole bookings. Paid means real money was charged, after cancelling out any matching refund. Free means the charge ended up at zero (comped or reversed) - the booking itself may still have been paid. Villa revenue includes the rental-programme payouts to villa owners, used exactly as paid out (no commission is deducted; tax is already excluded). Under the Free pill, Total revenue shows the value given away - what was originally charged before being comped - since collected money on anything Free is zero by definition. Under Overall and Paid, Total revenue also includes Member dues. The rows further down (Reversed charges, Cash advance, Tips, Payments collected, Payment corrections, Unexplained reversals) are separate buckets kept out of revenue - they do not change with the Paid/Free toggle.",
                                },
                                {
                                    label: "Reversed charges",
                                    body: `Charges that were fully reversed (a charge and its exact-opposite correction, even when worded differently) are pulled out of Total revenue entirely so they don't inflate or distort the numbers.${reversalsSummary?.reversed_count != null ? ` Currently ${reversalsSummary.reversed_count.toLocaleString()} charges.` : ""}`,
                                },
                                {
                                    label: "Cash advance",
                                    body: `Cash handed directly to a guest and billed to their folio - not product or service revenue, so it's pulled out the same way.${cashAdvanceSummary?.cash_advance_count != null ? ` Currently ${cashAdvanceSummary.cash_advance_count.toLocaleString()} charges.` : ""}`,
                                },
                                {
                                    label: "Tips",
                                    body: `Standalone staff-gratuity charges, also pulled out. Tips bundled into a single combined spa/amenity charge stay in Amenity revenue since they aren't reliably separable.${tipsSummary?.tip_count != null ? ` Currently ${tipsSummary.tip_count.toLocaleString()} charges.` : ""}`,
                                },
                                {
                                    label: "Payments collected",
                                    body: `The actual cash/card/check money guests paid against their balance - a separate thing entirely from charges, shown here for visibility, not added into revenue.${paymentsSummary?.payments_count != null ? ` Currently ${paymentsSummary.payments_count.toLocaleString()} payments.` : "."}`,
                                },
                                {
                                    label: "Payment corrections",
                                    body: "Fixes to payments that were recorded wrong - for example a payment applied to the wrong account and moved later. Tracked separately from both charges and Payments collected.",
                                },
                                {
                                    label: "Unexplained reversals",
                                    body: "A few refunds that do not clearly match any known charge, so they cannot be treated as normal reversals. The table further down the page lists each one.",
                                },
                                {
                                    label: "Revenue breakdown",
                                    body: "Total revenue splits into villa, amenity, and membership fees underneath. The same split by member vs guest is on the Member vs guest revenue card.",
                                },
                            ]}
                            filter={financeFilter}
                            onFilterChange={setFinanceFilter}
                        />
                        <div style={{ flex: 1 }}>
                            <StatRow
                                label="Total revenue"
                                value={`${totalRevenueDisplay < 0 ? "−" : ""}${money(Math.abs(totalRevenueDisplay))}`}
                                sub={finTotalSubText ?? `${money(financeVillaRevenue)} villa · ${money(financeAmenityRevenue)} amenity`}
                                warn={totalRevenueDisplay < 0}
                            />
                            <StatRow
                                label="Reversed charges"
                                value={reversalsSummary?.reversed_total != null ? money(reversalsSummary.reversed_total) : "—"}
                            />
                            <StatRow
                                label="Cash advance"
                                value={cashAdvanceSummary?.cash_advance_total != null ? money(cashAdvanceSummary.cash_advance_total) : "—"}
                            />
                            <StatRow
                                label="Tips"
                                value={tipsSummary?.tip_total != null ? money(tipsSummary.tip_total) : "—"}
                            />
                            <StatRow
                                label="Payments collected"
                                value={paymentsSummary?.payments_total != null ? money(Math.abs(paymentsSummary.payments_total)) : "—"}
                                sub="Guest folios and owner statements"
                            />
                            <StatRow
                                label="Payment corrections"
                                value={paymentCorrectionsSummary?.payment_correction_total != null ? money(Math.abs(paymentCorrectionsSummary.payment_correction_total)) : "—"}
                                sub={paymentCorrectionsSummary?.payment_correction_count != null ? `${paymentCorrectionsSummary.payment_correction_count.toLocaleString()} corrections` : undefined}
                            />
                            <StatRow
                                label="Unexplained reversals"
                                value={anomaliesSummary?.anomaly_total != null ? money(Math.abs(anomaliesSummary.anomaly_total)) : "—"}
                                sub={anomaliesSummary?.anomaly_count != null ? `${anomaliesSummary.anomaly_count.toLocaleString()} transactions` : undefined}
                            />
                            <StatRow label="Rev. per transaction" value={revPerBooking != null ? money(revPerBooking) : "—"} />
                            {/* "Statement periods" removed 2026-07-01: same broken statement
                                pipeline as the hero band's old "Outstanding" tile — folios have
                                stopped producing statements. The whole data path
                                (amountDueByPeriod prop, /overview/amount-due-by-period endpoint)
                                was stripped the same day — see overview_analytics.py and
                                dashboard.jsx. */}
                            <StatRow label="Member transactions" value={finMemberRev?.transactions?.toLocaleString() ?? "—"} last />
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
                            <CardHeader label="Account status" tip="A headcount of every account on file, split by Active vs Inactive and by member vs guest. No dollar amounts." />
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

                        {/* Member vs Guest revenue — always Overall, no toggle (removed 2026-07-03 per request) */}
                        <div style={{ ...block, flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
                            <CardHeader
                                label="Member vs guest revenue ($USD)"
                                tip={[
                                    {
                                        label: "What this counts",
                                        body: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. Revenue is split between member and guest accounts - villa rental and amenities combined, with matching refunds cancelled out. Rental-programme income counts under Member (villa owners are members), which is why the Member villa figure is much bigger than the guest one.",
                                    },
                                    {
                                        label: "The three colors in each bar",
                                        body: "Navy is villa, orange is amenities, rust is membership money. For guests, rust is temp membership fees. For members, rust is real dues charges from their statements.",
                                    },
                                    {
                                        label: "How Member dues is calculated",
                                        body: "Actual posted dues charges from member statements - membership dues, maintenance fees, capital contributions, and the F&B minimum. These are real dated charges, not estimates, so they follow the date picker and count toward the Member total and the Combined total like any other revenue.",
                                    },
                                ]}
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
                                        <span style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Membership fee / Dues</span>
                                    </div>
                                </div>
                                {filteredMemberGuest.map((r, i, arr) => {
                                    // Member's displayed revenue includes real dues too, matching
                                    // totalRev above — if only the denominator grew and the Member
                                    // row's own numerator didn't, their percentage would look
                                    // artificially low relative to what Combined total actually
                                    // contains. Guests are unaffected (dues doesn't apply to them).
                                    const rowRevenue = r.customerType === "Member"
                                        ? (r.revenue ?? 0) + (memberDuesSummary?.total_dues ?? 0)
                                        : r.revenue;
                                    const pct = totalRev !== 0 ? Math.round((rowRevenue / totalRev) * 100) : 0;
                                    const isNeg = rowRevenue < 0;
                                    const { villaRevenue, amenityRevenue, membershipRevenue } = memberGuestCategorySplit(r.customerType);
                                    const villaAbs = Math.abs(villaRevenue);
                                    const amenityAbs = Math.abs(amenityRevenue);
                                    // Members: folios has ZERO membership-fee-type charges tied to
                                    // Member accounts (confirmed 2026-07-02 — Temp Membership Fee
                                    // only ever applies to Guests), so membershipRevenue from the
                                    // folio-based split is always $0 for Members. Real member dues
                                    // (Capital Expenditure Contribution, Family Membership Dues,
                                    // Monthly Maintenance Fee, etc.) come from statement_details
                                    // instead — real itemized dues charges with an actual
                                    // transaction_date per line, filtered to lines matching those
                                    // known dues-type names — see the tooltip's "How Member dues is
                                    // calculated" section for the full logic.
                                    const membershipAbs = r.customerType === "Guests"
                                        ? Math.abs(membershipRevenue)
                                        : Math.abs(memberDuesSummary?.total_dues ?? 0);
                                    // membershipAbs shares the same filterable basis as villa/
                                    // amenity now — dues from statement_details has a real
                                    // transaction_date, so it responds to the page's date-range
                                    // picker the same way villa/amenity revenue does. Members get
                                    // all three colors in the bar, same as Guests.
                                    const shareBasisTotal = villaAbs + amenityAbs + membershipAbs;
                                    const villaShare = shareBasisTotal > 0 ? (villaAbs / shareBasisTotal) * 100 : 0;
                                    const amenityShare = shareBasisTotal > 0 ? (amenityAbs / shareBasisTotal) * 100 : 0;
                                    const membershipShare = shareBasisTotal > 0 ? (membershipAbs / shareBasisTotal) * 100 : 0;
                                    // Guests are the ones who actually pay Temp Membership Fee via
                                    // folios; Members' third slice comes from statement_details dues
                                    // instead (see membershipAbs above), so it gets its own label.
                                    const thirdLabel = r.customerType === "Guests" ? "temp membership fee" : "membership fee/dues";
                                    return (
                                        <div key={r.customerType} style={{ padding: "11px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                                                <span style={{ color: C.soft, fontFamily: "sans-serif" }}>{r.customerType}</span>
                                                <span style={{ fontFamily: serif, fontSize: 17, color: isNeg ? C.accent2 : C.text, lineHeight: 1 }}>
                                                    {isNeg ? "−" : ""}{money(Math.abs(rowRevenue))}
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
                            tip="Groups bookings by how many bedrooms the villa has, with the booking count and average stay for each size. Paid or Free describes whether the stay itself was paid or comped."
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
                            tip="Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. Each month's bar is the money posted that month, split into villa rental (navy) and amenity spend like food, golf, and wine (orange). Comped and cancelled charges do not count. Villa includes rental-programme income in the month it was earned. The Paid/Free toggle filters by whether the underlying stay was paid or comped."
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
                            tip={[
                                {
                                    label: "The metric toggle",
                                    body: "Revenue realized: this shows posted money from completed stays only - charges actually billed and collected. Stays still in progress and future bookings are not counted until checkout. The toggle ranks villas by either amenity spend (food, golf, spa, wine, and so on) or the villa rental charge itself. Only charges that were actually paid count - comped or reversed charges are zero and excluded. Bookings always counts every stay at the villa, even ones with no amenity spend. Rental-programme income is not shown per villa here - see Finance at a glance for the complete villa total.",
                                },
                                {
                                    label: "Paid / Free pill",
                                    body: "Filters by whether the stay itself was paid or comped. A comped stay can still show real amenity revenue - the guest may have paid for extras even though the villa was free.",
                                },
                                {
                                    label: "One exception",
                                    body: "Free plus Villa rental shows a negative number instead: the value of the nights given away (list price, or the actual amount charged if that was higher). If no list price is on file for those dates, the villa will not appear here - see Top villas by bookings for the full list.",
                                },
                            ]}
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
                            tip="Ranks villas by how many reservations they have had - a count of bookings, not dollars. A villa can appear here with bookings that had no amenity spend, so its count may differ from Top villas by revenue. Rental-programme stays are not counted, since those bookings are not individually tracked."
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

                {/* ── Row 4: Unexplained reversals — reviewable list ── */}
                <div style={{ marginTop: 12 }}>
                    <div style={block}>
                        <CardHeader
                            label="Unexplained reversals"
                            tip="Refunds that could not be matched to a specific charge - either several same-amount charges exist in the booking, or no matching charge exists at all. These are already kept out of every revenue total on this page; they are listed here so they can be reviewed instead of just disappearing."
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