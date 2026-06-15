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

export default function OverviewTab({
    membersByType = [],
    membersByStatus = [],
    membersByCountry = [],
    membersByState = [],
    averageLengthOfStay = null,
    bookingsByMonth = [],
    bookingsByRoomType = [],
    mostUsedRoomTypes = [],
    totalDependents = null,
    totalAmountDue = null,
    amountDueByPeriod = [],
    topSpendDescriptions = [],
    directoryMembers = [],
    memberVsGuestRevenue = [],
    villaStats = [],
    visitsTabSummary = null,
    bedroomBookings = [],
    villaRevenue = [],
    monthlyRevenue = [],
}) {
    const checkedIn = directoryMembers.filter(m => m.currently_checked_in).length;
    const withEmail = directoryMembers.filter(m => m.email).length;

    const guestCount = membersByType.find(t => t.member_type === "Guests")?.total ?? 0;
    const memberCount = membersByType
        .filter(t => !["Guests", "Family Dependent", "Spa Outside Guests", "Banquet Functions", "Golf Guest"].includes(t.member_type))
        .reduce((a, b) => a + (b.total || 0), 0);
    const totalAccounts = membersByType.reduce((a, b) => a + (b.total || 0), 0);

    const memberRev = memberVsGuestRevenue.find(r => r.customerType === "Member");
    const guestRev = memberVsGuestRevenue.find(r => r.customerType === "Guests");
    const totalRev = (memberRev?.revenue ?? 0) + (guestRev?.revenue ?? 0);

    const villaRevSorted = [...villaRevenue].sort((a, b) => b.revenue - a.revenue);
    const villaRevPositive = villaRevSorted.filter(v => v.revenue > 0);
    const topRevenueVilla = villaRevPositive[0];

    const totalVillaRevenue = visitsTabSummary?.villa_rental_revenue ?? 0;
    const totalBookingsMade = (visitsTabSummary?.total_members_booked ?? 0) + (visitsTabSummary?.total_guests_booked ?? 0);
    const revPerBooking = totalBookingsMade > 0 ? totalVillaRevenue / totalBookingsMade : null;

    const totalBedroomBookings = bedroomBookings.reduce((a, b) => a + (b.bookings || 0), 0);
    const topBedroom = [...bedroomBookings].sort((a, b) => b.bookings - a.bookings)[0];

    const peakMonth = [...monthlyRevenue].sort((a, b) => b.revenue - a.revenue)[0];
    const positiveMonths = monthlyRevenue.filter(m => m.revenue > 0);
    const totalPositiveRev = positiveMonths.reduce((a, b) => a + b.revenue, 0);

    const villaStatsWithData = villaStats.filter(v => v.total_nights > 0);
    const totalVillaGuests = villaStats.reduce((a, b) => a + (b.total_guests || 0), 0);
    const totalVillaNights = villaStats.reduce((a, b) => a + (b.total_nights || 0), 0);
    const longestStayVilla = [...villaStatsWithData].sort((a, b) => b.avg_stay - a.avg_stay)[0];
    const biggestPartyVilla = [...villaStatsWithData].sort((a, b) => b.avg_party_size - a.avg_party_size)[0];

    const InfoBtn = ({ tip }) => (
        <div className="info-btn" data-tip={tip} style={{
            width: 15, height: 15, borderRadius: "50%",
            border: `1px solid ${C.navyBorder}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, color: C.navyMuted, fontWeight: 700, lineHeight: 1, flexShrink: 0, cursor: "default",
        }}>i</div>
    );

    const CardHeader = ({ label, tip }) => (
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="dashboard-eyebrow">{label}</span>
            <div className="info-btn" data-tip={tip} style={{
                width: 15, height: 15, borderRadius: "50%", border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: C.muted, fontWeight: 700, lineHeight: 1, flexShrink: 0, cursor: "default",
            }}>i</div>
        </div>
    );

    const StatRow = ({ label, value, warn, last, sub }) => (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", gap: 8, borderBottom: last ? "none" : `1px solid ${C.rowBorder}` }}>
            <div>
                <div style={{ fontSize: 12, color: C.soft, fontFamily: "sans-serif" }}>{label}</div>
                {sub && <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif", marginTop: 1 }}>{sub}</div>}
            </div>
            <span style={{ fontFamily: serif, fontSize: 18, color: warn ? C.accent2 : C.text, lineHeight: 1, textAlign: "right", flexShrink: 0 }}>
                {value}
            </span>
        </div>
    );

    const RankRow = ({ rank, label, value, mini, total, sub, last }) => (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", gap: 8, background: rank % 2 === 0 ? C.panel : C.bg, borderBottom: last ? "none" : `1px solid ${C.rowBorder}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, background: rank === 1 ? C.navy : C.panelAlt, color: rank === 1 ? C.flame : C.muted, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>{rank}</div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140, fontFamily: "sans-serif" }}>{label}</div>
                    {sub && <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>{sub}</div>}
                </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {mini != null && total > 0 && (
                    <div style={{ width: 44, height: 4, background: C.panelAlt, borderRadius: 2 }}>
                        <div style={{ height: "100%", borderRadius: 2, background: rank === 1 ? C.navy : C.muted, width: `${Math.round((mini / total) * 100)}%` }} />
                    </div>
                )}
                <span style={{ fontFamily: serif, fontSize: 18, color: C.text, minWidth: 32, textAlign: "right" }}>{value}</span>
            </div>
        </div>
    );

    const heroKpis = [
        { label: "Villa Revenue", value: totalVillaRevenue > 0 ? money(totalVillaRevenue) : "—", sub: `${visitsTabSummary?.total_room_nights ?? "—"} room nights`, color: C.flame, tip: "Total villa rental revenue from all reservations." },
        { label: "Outstanding", value: totalAmountDue?.total_amount_due != null ? `$${(Number(totalAmountDue.total_amount_due) / 1_000_000).toFixed(2)}M` : "—", sub: "Total dues owed", color: C.rust, tip: "Sum of all unpaid balances across every account and statement period." },
        { label: "Room Nights", value: visitsTabSummary?.total_room_nights?.toLocaleString() ?? "—", sub: `Avg ${visitsTabSummary?.avg_length_of_stay?.toFixed(1) ?? "—"} nights/stay`, color: C.navyText, tip: "Total room nights sold across all villa reservations." },
        { label: "Rev / Booking", value: revPerBooking != null ? money(revPerBooking) : "—", sub: "Villa rental average", color: C.navyText, tip: "Average villa rental revenue per booking." },
        { label: "Peak Month", value: peakMonth?.month ?? "—", sub: peakMonth ? money(peakMonth.revenue) : "—", color: C.flame, tip: "Month with the highest revenue. April dominates due to peak season." },
        { label: "Active Accounts", value: membersByStatus.find(s => s.status === "Active")?.total?.toLocaleString() ?? "—", sub: `of ${totalAccounts.toLocaleString()} total`, color: C.navyText, tip: "Accounts with Active status able to make new bookings." },
    ];

    return (
        <div className="dashboard-section dashboard-section-lg">

            {/* ── Dark hero KPI band ── */}
            <section style={{
                background: C.navy,
                borderRadius: 18,
                overflow: "hidden",
                marginBottom: 16,
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
            }}>
                {heroKpis.map((k, i) => (
                    <div key={k.label} style={{
                        padding: "22px 20px",
                        borderRight: i < heroKpis.length - 1 ? `1px solid ${C.navyBorder}` : "none",
                        display: "flex", flexDirection: "column", gap: 5,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.navyMuted, fontFamily: "sans-serif" }}>{k.label}</span>
                            <InfoBtn tip={k.tip} />
                        </div>
                        <span style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.1, color: k.color, fontWeight: 600 }}>{k.value}</span>
                        <span style={{ fontSize: 11, color: C.navyDim, fontFamily: "sans-serif" }}>{k.sub}</span>
                    </div>
                ))}
            </section>

            {/* ── Row 1: Members · Bookings · Finance ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>

                <div style={block}>
                    <CardHeader label="Members at a glance" tip="Breakdown of accounts by activity status, geography, and household data." />
                    <StatRow label="Active members" value={membersByStatus.find(s => s.status === "Active")?.members?.toLocaleString() ?? "—"} />
                    <StatRow label="Active guests" value={membersByStatus.find(s => s.status === "Active")?.guests?.toLocaleString() ?? "—"} />
                    <StatRow label="Inactive accounts" value={membersByStatus.find(s => s.status === "Inactive")?.total?.toLocaleString() ?? "—"} />
                    <StatRow label="Guest-to-member ratio" value={memberCount > 0 ? `${Math.round(guestCount / memberCount)}:1` : "—"} />
                    <StatRow label="Total dependents" value={totalDependents?.total_dependents?.toLocaleString() ?? "—"} />
                    <StatRow label="Countries represented" value={membersByCountry.length} />
                    <StatRow label="US states represented" value={membersByState.length} />
                    <StatRow label="With email on file" value={withEmail > 0 ? withEmail.toLocaleString() : "—"} last />
                </div>

                <div style={block}>
                    <CardHeader label="Bookings at a glance" tip="Villa reservation totals, stay lengths, guest volumes, and bedroom demand." />
                    <StatRow label="Total bookings" value={bookingsByMonth.reduce((a, b) => a + (b.total || 0), 0).toLocaleString()} />
                    <StatRow label="Members who booked" value={visitsTabSummary?.total_members_booked?.toLocaleString() ?? "—"} />
                    <StatRow label="Guests who booked" value={visitsTabSummary?.total_guests_booked?.toLocaleString() ?? "—"} />
                    <StatRow label="Total room nights" value={visitsTabSummary?.total_room_nights?.toLocaleString() ?? "—"} />
                    <StatRow label="Avg. stay" value={visitsTabSummary?.avg_length_of_stay != null ? `${visitsTabSummary.avg_length_of_stay.toFixed(1)} nights` : "—"} />
                    <StatRow label="Avg. party size" value={visitsTabSummary?.avg_party_size != null ? visitsTabSummary.avg_party_size.toFixed(1) : "—"} />
                    <StatRow label="Most booked bedroom" value={topBedroom ? `${topBedroom.beds} BR` : "—"} sub={topBedroom ? `${topBedroom.bookings} bookings` : undefined} />
                    <StatRow label="Villa types available" value={bookingsByRoomType.length} last />
                </div>

                <div style={block}>
                    <CardHeader label="Finance at a glance ($US)" tip="Outstanding dues, villa rental revenue, and revenue by customer type." />
                    <StatRow label="Villa rental revenue" value={money(totalVillaRevenue)} />
                    <StatRow label="Rev. per booking" value={revPerBooking != null ? money(revPerBooking) : "—"} />
                    <StatRow label="Outstanding balance" value={totalAmountDue?.total_amount_due != null ? `$${(Number(totalAmountDue.total_amount_due) / 1_000_000).toFixed(2)}M` : "—"} warn />
                    <StatRow label="Member revenue" value={memberRev?.revenue != null ? money(memberRev.revenue) : "—"} />
                    <StatRow label="Guest revenue" value={guestRev?.revenue != null ? money(guestRev.revenue) : "—"} />
                    <StatRow label="Member transactions" value={memberRev?.transactions?.toLocaleString() ?? "—"} />
                    <StatRow label="Statement periods" value={amountDueByPeriod.length} />
                    <StatRow label="Periods with credits" value={amountDueByPeriod.filter(p => (p.total || 0) < 0).length} last />
                </div>
            </div>

            {/* ── Row 2: Status · Bedroom demand · Monthly revenue ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>

                {/* Account status */}
                <div style={block}>
                    <CardHeader label="Account status" tip="Active vs inactive accounts split by member and guest type." />
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

                {/* Bedroom demand */}
                <div style={block}>
                    <CardHeader label="Bedroom demand" tip="Bookings and avg stay by villa size. Shows which bedroom counts are most popular." />
                    {bedroomBookings.map((b, i, arr) => {
                        const pct = totalBedroomBookings > 0 ? Math.round((b.bookings / totalBedroomBookings) * 100) : 0;
                        const isTop = b.beds === topBedroom?.beds;
                        return (
                            <div key={b.beds} style={{ padding: "9px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none", background: i % 2 === 0 ? C.bg : C.panel }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ width: 26, height: 26, borderRadius: 6, background: isTop ? C.navy : C.panelAlt, color: isTop ? C.flame : C.muted, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", flexShrink: 0 }}>
                                            {b.beds}BR
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif" }}>{b.bookings} bookings</div>
                                            <div style={{ fontSize: 10, color: C.muted, fontFamily: "sans-serif" }}>Avg {b.avg_stay?.toFixed(1)} nights</div>
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
                    <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Total bookings tracked</span>
                        <span style={{ fontFamily: serif, fontSize: 16, color: C.text }}>{totalBedroomBookings}</span>
                    </div>
                </div>

                {/* Monthly revenue */}
                <div style={block}>
                    <CardHeader label="Revenue by month ($US)" tip="Monthly revenue totals. Negative values are credits or adjustments. April is peak season." />
                    {monthlyRevenue.map((m, i, arr) => {
                        const absMax = Math.max(...monthlyRevenue.map(x => Math.abs(x.revenue)));
                        const pct = absMax > 0 ? Math.round((Math.abs(m.revenue) / absMax) * 100) : 0;
                        const isPos = m.revenue >= 0;
                        const isPeak = m.month === peakMonth?.month;
                        return (
                            <div key={m.month} style={{ padding: "7px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none", background: isPeak ? `color-mix(in srgb, ${C.navy} 4%, transparent)` : i % 2 === 0 ? C.bg : C.panel }}>
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
                                <div style={{ height: 3, background: C.panelAlt, borderRadius: 2 }}>
                                    <div style={{ height: "100%", width: `${pct}%`, background: isPos ? (isPeak ? C.navy : C.muted) : C.accent2, borderRadius: 2 }} />
                                </div>
                            </div>
                        );
                    })}
                    <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Positive months total</span>
                        <span style={{ fontFamily: serif, fontSize: 16, color: C.text }}>{money(totalPositiveRev)}</span>
                    </div>
                </div>
            </div>

            {/* ── Row 3: Villa revenue table + Member vs Guest + Top bookings ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

                {/* Villa revenue table */}
                <div style={block}>
                    <CardHeader label="Top villas by revenue" tip="Villas ranked by rental revenue. Rev/night shows pricing efficiency — fewer nights at higher rate means strong demand." />
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "7px 16px", borderBottom: `1px solid ${C.border}`, background: C.panelAlt }}>
                        {["Villa", "Revenue", "Bookings", "Rev/night"].map(h => (
                            <span key={h} style={{ fontSize: 9, color: C.muted, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
                        ))}
                    </div>
                    {villaRevSorted.filter(v => v.revenue > 0).slice(0, 10).map((v, i, arr) => (
                        <div key={v.villaName} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none", background: i % 2 === 0 ? C.bg : C.panel, alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 18, height: 18, borderRadius: 4, background: i === 0 ? C.navy : C.panelAlt, color: i === 0 ? C.flame : C.muted, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", flexShrink: 0 }}>{i + 1}</div>
                                <span style={{ fontSize: 12, color: C.text, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.villaName}</span>
                            </div>
                            <span style={{ fontFamily: serif, fontSize: 14, color: C.accent }}>{money(v.revenue)}</span>
                            <span style={{ fontFamily: serif, fontSize: 14, color: C.text }}>{v.totalBookings}</span>
                            <span style={{ fontFamily: serif, fontSize: 14, color: C.soft }}>{v.roomNights > 0 ? money(v.revenue / v.roomNights) : "—"}</span>
                        </div>
                    ))}
                </div>

                {/* Right column: member vs guest + top villas by bookings */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                    <div style={block}>
                        <CardHeader label="Member vs guest revenue ($US)" tip="Revenue and transaction breakdown between member and guest folio accounts." />
                        {memberVsGuestRevenue.map((r, i, arr) => {
                            const pct = totalRev > 0 ? Math.round((r.revenue / totalRev) * 100) : 0;
                            const col = r.customerType === "Member" ? C.navy : C.flame;
                            return (
                                <div key={r.customerType} style={{ padding: "11px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${C.rowBorder}` : "none" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                                        <span style={{ color: C.soft, fontFamily: "sans-serif" }}>{r.customerType}</span>
                                        <span style={{ fontFamily: serif, fontSize: 17, color: C.text, lineHeight: 1 }}>
                                            {money(r.revenue)}
                                            <span style={{ fontSize: 11, fontFamily: "sans-serif", color: C.muted, marginLeft: 4 }}>({pct}%)</span>
                                        </span>
                                    </div>
                                    <div style={{ height: 5, background: C.panelAlt, borderRadius: 3 }}>
                                        <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 3 }} />
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginTop: 4, fontFamily: "sans-serif" }}>
                                        <span>{r.transactions?.toLocaleString()} transactions</span>
                                        <span>{r.uniqueAccounts} unique accounts</span>
                                    </div>
                                </div>
                            );
                        })}
                        <div style={{ padding: "9px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif" }}>Combined total</span>
                            <span style={{ fontFamily: serif, fontSize: 16, color: C.text }}>{money(totalRev)}</span>
                        </div>
                    </div>

                    <div style={block}>
                        <CardHeader label="Top villas by bookings" tip="Villas ranked by number of reservations." />
                        {mostUsedRoomTypes.slice(0, 6).map((r, i, arr) => (
                            <RankRow key={r.room_type} rank={i + 1} label={r.room_type} value={r.total} mini={r.total} total={mostUsedRoomTypes[0]?.total || 1} last={i === arr.length - 1} />
                        ))}
                    </div>
                </div>
            </div>

        </div>
    );
}
