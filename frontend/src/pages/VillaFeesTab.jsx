// frontend/src/pages/VillaFeesTab.jsx
//
// Annual Fees for Members - annual Maintenance Fee + Capital Expenditure
// Contribution billed per villa, from statement_details.
//
// CapEx is billed both monthly and annually on statements; the annual
// figure shown here is simply the SUM of every CapEx line in the year
// (e.g. 700 monthly + 9,500 annual = 10,200), per spec.
//
// Villa mapping: statement_details has no villa column. Each member's villa
// comes from villa_owner_map (see HISTORICAL_DUES_SYNOPSIS): manual override
// first, then the villa named in the member record, then room_lookup, then
// stays/bookings. Fee-billed members with no resolvable villa show under
// "Unmapped" so the totals always reconcile with raw statements.
//
// Self-contained on purpose (own colors/export helpers) so it can be
// dropped in and later deleted or merged without touching other tabs.

import { useEffect, useMemo, useState } from "react";
import {
    Download,
    ChevronDown,
    ChevronRight,
    Search,
    Home,
    Wrench,
    Landmark,
    Users,
    Info,
    X,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { villaFeesApi } from "../api/villaFeesApi";
import DuesHistorySection from "./DuesHistorySection";

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
    flame: "#FFB162",
    rust: "#E07B5A",
    navy: "#1B2632",
};

const money = (v, decimals = 2) =>
    v == null
        ? "-"
        : `$${Number(v).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        })}`;

/* ─── export helpers (same shape as VillaSourceBreakdown) ───────── */

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportRows(rows, filenameBase, format) {
    if (!rows.length) return;
    if (format === "csv") {
        const ws = XLSX.utils.json_to_sheet(rows);
        const csv = XLSX.utils.sheet_to_csv(ws);
        downloadFile(
            new Blob([csv], { type: "text/csv;charset=utf-8;" }),
            `${filenameBase}.csv`,
        );
    } else if (format === "excel") {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Annual Fees");
        XLSX.writeFile(wb, `${filenameBase}.xlsx`);
    } else if (format === "pdf") {
        const doc = new jsPDF({ orientation: "landscape" });
        const columns = Object.keys(rows[0] ?? {});
        doc.text(filenameBase.replaceAll("_", " "), 14, 14);
        autoTable(doc, {
            startY: 20,
            head: [columns],
            body: rows.map((r) => columns.map((c) => r[c] ?? "")),
            styles: { fontSize: 7 },
            headStyles: { fillColor: [30, 48, 70] },
        });
        doc.save(`${filenameBase}.pdf`);
    }
}

function ExportMenu({ rows, filenameBase, disabled }) {
    const [open, setOpen] = useState(false);
    const doExport = (fmt) => {
        exportRows(rows, filenameBase, fmt);
        setOpen(false);
    };
    return (
        <div style={{ position: "relative", display: "inline-flex" }}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 12px",
                    borderRadius: 10,
                    border: `1px solid ${C.accent2}`,
                    background: C.panelAlt,
                    color: C.accent,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.55 : 1,
                }}
            >
                <Download size={13} /> Export report <ChevronDown size={12} />
            </button>
            {open && !disabled && (
                <div
                    style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        zIndex: 20,
                        minWidth: 130,
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        boxShadow: "0 10px 26px rgba(0,0,0,0.14)",
                        overflow: "hidden",
                    }}
                >
                    {[
                        ["csv", "CSV"],
                        ["excel", "Excel"],
                        ["pdf", "PDF"],
                    ].map(([f, l]) => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => doExport(f)}
                            style={{
                                display: "block",
                                width: "100%",
                                padding: "9px 12px",
                                border: "none",
                                background: "transparent",
                                color: C.text,
                                textAlign: "left",
                                cursor: "pointer",
                                fontSize: 12,
                            }}
                        >
                            {l}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── small pieces ──────────────────────────────────────────────── */

function InfoButton({ title, sections }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ position: "relative", display: "inline-flex" }}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title={title}
                aria-label={title}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: open ? C.accent : C.panel,
                    color: open ? "#EEE9DF" : C.accent,
                    cursor: "pointer",
                    flexShrink: 0,
                }}
            >
                <Info size={14} />
            </button>
            {open && (
                <>
                    {/* click-away backdrop */}
                    <div
                        onClick={() => setOpen(false)}
                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            left: 0,
                            top: "calc(100% + 8px)",
                            zIndex: 50,
                            width: 380,
                            maxWidth: "82vw",
                            maxHeight: 420,
                            overflowY: "auto",
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            borderRadius: 14,
                            boxShadow: "0 14px 34px rgba(0,0,0,0.18)",
                            padding: 14,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 8,
                            }}
                        >
                            <div
                                style={{
                                    fontFamily: serif,
                                    fontSize: 17,
                                    color: C.text,
                                }}
                            >
                                {title}
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    color: C.muted,
                                    cursor: "pointer",
                                    padding: 2,
                                    display: "inline-flex",
                                }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                        {sections.map((s) => (
                            <div key={s.label} style={{ marginBottom: 10 }}>
                                <div
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        color: C.accent,
                                        marginBottom: 3,
                                    }}
                                >
                                    {s.label}
                                </div>
                                <div style={{ fontSize: 12, color: C.soft, lineHeight: 1.55 }}>
                                    {s.body}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function KpiCard({ icon: Icon, label, value, sub, color }) {
    return (
        <div
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: 18,
                background: C.panel,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    color: C.muted,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                }}
            >
                <Icon size={13} /> {label}
            </div>
            <div
                style={{
                    fontFamily: serif,
                    fontSize: 28,
                    color: color ?? C.text,
                    lineHeight: 1.1,
                }}
            >
                {value}
            </div>
            {sub && <div style={{ color: C.muted, fontSize: 11 }}>{sub}</div>}
        </div>
    );
}

const sortRows = (rows, key, dir = "asc") => {
    const mult = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a?.[key],
            bv = b?.[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = Number(av),
            bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * mult;
        return (
            String(av).localeCompare(String(bv), undefined, {
                numeric: true,
                sensitivity: "base",
            }) * mult
        );
    });
};

const HEADERS = [
    ["villa_name", "Villa"],
    ["bedroom_count", "Bedrooms"],
    ["owner_names", "Owner(s)"],
    ["maintenance_annual", "Maintenance, annual ($USD)"],
    ["capex_annual", "Capital Expenditure, annual ($USD)"],
    ["family_annual", "Family Membership, annual ($USD)"],
    ["total_annual", "Total annual billed ($USD)"],
];

// Badge colours for the charge-level fee_type values the backend actually
// emits. The previous inline ternary compared against "Maintenance", which
// never matches 'Maintenance Fees', so every badge rendered in the CapEx
// rust regardless of type.
const FEE_BADGE_COLORS = {
    "Maintenance Fees": { bg: "rgba(255,177,98,0.18)", fg: "#A65F00" },
    "Capital Expenditure Fees": { bg: "rgba(224,123,90,0.16)", fg: C.rust },
    "Annual Fees - Family Membership": { bg: "rgba(91,158,173,0.16)", fg: "#2F6B7A" },
    "Annual Fees - Family Membership Deferred": { bg: "rgba(91,158,173,0.16)", fg: "#2F6B7A" },
};
const FEE_BADGE_FALLBACK = { bg: "rgba(120,120,120,0.14)", fg: C.muted };
const feeBadge = (feeType) => FEE_BADGE_COLORS[feeType] ?? FEE_BADGE_FALLBACK;

/* ─── main tab ──────────────────────────────────────────────────── */

export default function VillaFeesTab() {
    const [years, setYears] = useState([]);
    const [year, setYear] = useState(null);
    const [summary, setSummary] = useState(null);
    const [byVilla, setByVilla] = useState([]);
    const [report, setReport] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("total_annual");
    const [sortDir, setSortDir] = useState("desc");
    const [expanded, setExpanded] = useState(() => new Set());

    // Load available years once, default to the latest.
    useEffect(() => {
        villaFeesApi
            .years()
            .then((ys) => {
                const list = (ys ?? []).map((r) => r.year).filter(Boolean);
                setYears(list);
                setYear(list[0] ?? new Date().getFullYear());
            })
            .catch((e) => {
                setError(String(e.message ?? e));
                setLoading(false);
            });
    }, []);

    // Load everything for the selected year.
    useEffect(() => {
        if (!year) return;
        setLoading(true);
        setError(null);
        Promise.all([
            villaFeesApi.summary(year),
            villaFeesApi.byVilla(year),
            villaFeesApi.report(year),
        ])
            .then(([s, v, r]) => {
                setSummary(s ?? null);
                setByVilla(v ?? []);
                setReport(r ?? []);
                setExpanded(new Set());
            })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setLoading(false));
    }, [year]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        const base = term
            ? byVilla.filter((r) =>
                [r.villa_name, r.owner_names, r.member_numbers]
                    .filter(Boolean)
                    .some((v) => String(v).toLowerCase().includes(term)),
            )
            : byVilla;
        return sortRows(base, sortKey, sortDir);
    }, [byVilla, search, sortKey, sortDir]);

    // Flat export rows: villa details + member info + charge name + annual charge.
    const exportRowsData = useMemo(
        () =>
            report.map((r) => ({
                Villa: r.villa_name,
                Bedrooms: r.bedroom_count ?? "",
                "Member #": r.member_number,
                "Member Name": r.member_name ?? "",
                Email: r.email ?? "",
                "Fee Type": r.fee_type,
                "Charge Name": r.charge_name,
                "Times Billed": r.times_billed,
                [`Annual Amount ${year ?? ""} ($USD)`]: r.annual_amount,
                "First Billed": r.first_billed ?? "",
                "Last Billed": r.last_billed ?? "",
            })),
        [report, year],
    );

    const toggleSort = (key) => {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
            setSortKey(key);
            setSortDir(key === "villa_name" || key === "owner_names" ? "asc" : "desc");
        }
    };

    const toggleExpand = (villa) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(villa) ? next.delete(villa) : next.add(villa);
            return next;
        });

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Header row */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                        }}
                    >
                        <div style={{ fontFamily: serif, fontSize: 26, color: C.text }}>
                            Annual Fees for Members
                        </div>
                        <InfoButton
                            sections={[
                                {
                                    label: "What this page shows",
                                    body: "The annual fees billed to villa owners on their member statements: the Monthly Maintenance Fee, the Capital Expenditure Contribution and Family Membership Dues (including mid-year adjustments), totaled per villa for the selected year. Each villa row expands to show the owner, contact details, and every charge name with its annual amount. GCT tax is tracked separately and not included in fee totals.",
                                },
                                {
                                    label: "How Capital Expenditure is totaled",
                                    body: "Capital Expenditure is billed both monthly and as an annual charge on statements. Both are added together into one annual figure. For example, $700 monthly charges plus a $9,500 annual charge count as one combined annual total.",
                                },
                                // {
                                //     label: "What counts as a Maintenance Fee",
                                //     body: "Only the standard recurring charge (\"Monthly Maintenance Fee\" with its billing period) counts as Maintenance Fees. One-off maintenance work (contractor invoices, storm-damage repairs, additional work billed to an owner) is not a fee and is excluded from this page entirely.",
                                // },
                                {
                                    label: "Dues History Card",
                                    body: "The Dues history card shows fees billed per year across all fee types. Its Total column includes GCT, so it reads higher than the fee totals at the top of this page, which exclude tax. The Dues history card is a multi-year view, while the table above is only for the selected year.",
                                },
                                // {
                                //     label: "Exporting",
                                //     body: "Export report downloads the full detail for the selected year (villa, bedrooms, owner, charge name, annual amount) as CSV, Excel, or PDF. It covers the same four fee types as the table above, so it excludes GCT. Export history on the bottom card downloads the multi-year dataset by villa size, and does include GCT.",
                                // },
                            ]}
                        />
                    </div>
                    <div style={{ color: C.muted, fontSize: 12, maxWidth: 640 }}>
                        Maintenance and Capital Expenditure billed per villa, from member
                        statements.
                    </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                        value={year ?? ""}
                        onChange={(e) => setYear(Number(e.target.value))}
                        style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: `1px solid ${C.border}`,
                            background: C.panel,
                            color: C.text,
                            fontSize: 12,
                            fontWeight: 700,
                        }}
                    >
                        {(years.length ? years : year ? [year] : []).map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                    <ExportMenu
                        rows={exportRowsData}
                        filenameBase={`annual_member_fees_${year ?? "report"}`}
                        disabled={!exportRowsData.length}
                    />
                </div>
            </div>

            {error && (
                <div
                    style={{
                        border: `1px solid ${C.rust}`,
                        borderRadius: 12,
                        padding: 12,
                        color: C.rust,
                        fontSize: 12,
                        background: C.panel,
                    }}
                >
                    {error}
                </div>
            )}

            {/* KPI cards */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                }}
            >
                <KpiCard
                    icon={Wrench}
                    label="Maintenance billed ($USD)"
                    value={loading ? "…" : money(summary?.maintenance_total)}
                    sub={`${year ?? ""} annual total`}
                    color={C.text}
                />
                <KpiCard
                    icon={Landmark}
                    label="Capital Expenditure billed ($USD)"
                    value={loading ? "…" : money(summary?.capex_total)}
                    sub="Monthly + annual charges summed"
                    color={C.text}
                />
                <KpiCard
                    icon={Users}
                    label="Family Membership billed ($USD)"
                    value={loading ? "…" : money(summary?.family_total)}
                    sub="Base dues + deferred adjustment"
                    color={C.text}
                />
                <KpiCard
                    icon={Home}
                    label="Combined annual billed ($USD)"
                    value={loading ? "…" : money(summary?.grand_total)}
                    sub="Maintenance + Capital Exp. + Family Membership"
                    color={C.rust}
                />
                <KpiCard
                    icon={Users}
                    label="Owners billed"
                    value={loading ? "…" : (summary?.owners_billed ?? "-")}
                    color={C.text}
                />
            </div>

            {/* Table card */}
            <div
                style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 18,
                    background: C.bg,
                    overflow: "hidden",
                    boxShadow: "var(--dashboard-shadow-soft)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 16px",
                        borderBottom: `1px solid ${C.rowBorder}`,
                        flexWrap: "wrap",
                    }}
                >
                    <div className="dashboard-eyebrow">
                        Annual billed by villa · {filtered.length} villa
                        {filtered.length === 1 ? "" : "s"}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: `1px solid ${C.border}`,
                            borderRadius: 10,
                            padding: "6px 10px",
                            background: C.panel,
                        }}
                    >
                        <Search size={13} color={C.muted} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search villa, owner, member #"
                            style={{
                                border: "none",
                                outline: "none",
                                background: "transparent",
                                color: C.text,
                                fontSize: 12,
                                width: 200,
                            }}
                        />
                    </div>
                </div>

                <div style={{ overflowX: "auto", maxHeight: "68vh", overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead
                            style={{
                                position: "sticky",
                                top: 0,
                                zIndex: 5,
                                background: "var(--dashboard-card)",
                            }}
                        >
                            <tr>
                                <th style={{ width: 34 }} />
                                {HEADERS.map(([key, label]) => (
                                    <th
                                        key={key}
                                        onClick={() => toggleSort(key)}
                                        style={{
                                            textAlign:
                                                key === "villa_name" || key === "owner_names"
                                                    ? "left"
                                                    : "right",
                                            padding: "10px 14px",
                                            color: sortKey === key ? C.accent : C.muted,
                                            fontSize: 10,
                                            fontWeight: 800,
                                            textTransform: "uppercase",
                                            letterSpacing: 0.6,
                                            cursor: "pointer",
                                            whiteSpace: "nowrap",
                                            borderBottom: `1px solid ${C.rowBorder}`,
                                            userSelect: "none",
                                        }}
                                    >
                                        {label}
                                        {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td
                                        colSpan={HEADERS.length + 1}
                                        style={{ padding: 22, textAlign: "center", color: C.muted }}
                                    >
                                        Loading annual fees…
                                    </td>
                                </tr>
                            )}
                            {!loading && !filtered.length && (
                                <tr>
                                    <td
                                        colSpan={HEADERS.length + 1}
                                        style={{ padding: 22, textAlign: "center", color: C.muted }}
                                    >
                                        No maintenance or capital expenditure lines found for{" "}
                                        {year ?? "this year"}.
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                filtered.map((r) => {
                                    const isOpen = expanded.has(r.villa_name);
                                    const detail = report.filter(
                                        (d) => d.villa_name === r.villa_name,
                                    );
                                    return (
                                        <FragmentRow
                                            key={r.villa_name}
                                            row={r}
                                            isOpen={isOpen}
                                            detail={detail}
                                            onToggle={() => toggleExpand(r.villa_name)}
                                        />
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Dues history (all years) */}
            <DuesHistorySection />
        </div>
    );
}

/* ─── expandable villa row + charge breakdown ───────────────────── */

function FragmentRow({ row, isOpen, detail, onToggle }) {
    const isUnmapped = row.villa_name === "Unmapped";
    return (
        <>
            <tr
                onClick={onToggle}
                style={{
                    cursor: "pointer",
                    background: isOpen ? C.panelAlt : "transparent",
                }}
            >
                <td style={{ padding: "10px 0 10px 12px", color: C.muted }}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </td>
                <td
                    style={{
                        padding: "10px 14px",
                        color: isUnmapped ? C.muted : C.text,
                        fontWeight: 700,
                        borderBottom: `1px solid ${C.rowBorder}`,
                        fontStyle: isUnmapped ? "italic" : "normal",
                    }}
                >
                    {row.villa_name}
                    {isUnmapped && (
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>
                            Fee-billed members with no villa on file
                        </div>
                    )}
                </td>
                <td style={cellNum}>{row.bedroom_count ?? "-"}</td>
                <td
                    style={{
                        padding: "10px 14px",
                        color: C.soft,
                        borderBottom: `1px solid ${C.rowBorder}`,
                        maxWidth: 260,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                    title={`${row.owner_names ?? ""} (${row.member_numbers ?? ""})`}
                >
                    {row.owner_names ?? "-"}
                </td>
                <td style={cellNum}>{money(row.maintenance_annual)}</td>
                <td style={cellNum}>{money(row.capex_annual)}</td>
                <td style={cellNum}>{money(row.family_annual)}</td>
                <td style={{ ...cellNum, color: C.rust, fontWeight: 800 }}>
                    {money(row.total_annual)}
                </td>
            </tr>
            {isOpen && (
                <tr>
                    <td
                        colSpan={8}
                        style={{
                            padding: "0 14px 14px 46px",
                            background: C.panelAlt,
                            borderBottom: `1px solid ${C.rowBorder}`,
                        }}
                    >
                        <div
                            style={{
                                border: `1px solid ${C.border}`,
                                borderRadius: 12,
                                overflow: "hidden",
                                marginTop: 4,
                                background: C.bg,
                            }}
                        >
                            <table
                                style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
                            >
                                <thead>
                                    <tr>
                                        {[
                                            "Member #",
                                            "Member Name",
                                            "Email",
                                            "Charge Name",
                                            "Fee Type",
                                            "Times Billed",
                                            "Annual Amount ($USD)",
                                        ].map((h, i) => (
                                            <th
                                                key={h}
                                                style={{
                                                    textAlign: i >= 5 ? "right" : "left",
                                                    padding: "8px 12px",
                                                    color: C.muted,
                                                    fontSize: 9,
                                                    fontWeight: 800,
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    borderBottom: `1px solid ${C.rowBorder}`,
                                                }}
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.map((d, i) => (
                                        <tr key={`${d.member_number}-${d.charge_name}-${i}`}>
                                            <td style={detailCell}>{d.member_number}</td>
                                            <td style={detailCell}>{d.member_name ?? "-"}</td>
                                            <td style={{ ...detailCell, color: C.muted }}>
                                                {d.email ?? "-"}
                                            </td>
                                            <td style={{ ...detailCell, fontWeight: 700 }}>
                                                {d.charge_name}
                                            </td>
                                            <td style={detailCell}>
                                                <span
                                                    style={{
                                                        padding: "2px 8px",
                                                        borderRadius: 999,
                                                        fontSize: 9,
                                                        fontWeight: 800,
                                                        background: feeBadge(d.fee_type).bg,
                                                        color: feeBadge(d.fee_type).fg,
                                                    }}
                                                >
                                                    {d.fee_type}
                                                </span>
                                            </td>
                                            <td style={{ ...detailCell, textAlign: "right" }}>
                                                {d.times_billed}
                                            </td>
                                            <td
                                                style={{
                                                    ...detailCell,
                                                    textAlign: "right",
                                                    fontWeight: 800,
                                                    color: C.text,
                                                }}
                                            >
                                                {money(d.annual_amount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

const cellNum = {
    padding: "10px 14px",
    textAlign: "right",
    color: "var(--dashboard-abyssal)",
    borderBottom: "1px solid var(--dashboard-row-border)",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
};

const detailCell = {
    padding: "8px 12px",
    color: "var(--dashboard-text-soft)",
    borderBottom: "1px solid var(--dashboard-row-border)",
};