// frontend/src/pages/DuesHistorySection.jsx
//
// "Dues history" card for the Annual Fees for Members tab: dues billed per year per fee
// type (pivot table), villas billed per year, and an export of the full
// year × fee type × villa-size dataset.
//
// Wire-up (2 lines in VillaFeesTab.jsx):
//   import DuesHistorySection from "./DuesHistorySection";
//   ...and render <DuesHistorySection /> at the bottom of the tab.

import { useEffect, useMemo, useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { villaFeesApi } from "../api/villaFeesApi";

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
    rust: "#E07B5A",
};

const money = (v) =>
    v == null
        ? "—"
        : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const FEE_COLUMNS = [
    ["Maintenance Fees", "Maintenance"],
    ["Capital Expenditure Fees", "Capital Exp."],
    ["Annual Fees - Family Membership", "Family Membership"],
    ["GCT on Family Membership (tax)", "GCT (tax)"],
];

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
        downloadFile(
            new Blob([XLSX.utils.sheet_to_csv(ws)], {
                type: "text/csv;charset=utf-8;",
            }),
            `${filenameBase}.csv`,
        );
    } else if (format === "excel") {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Dues History");
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
                <Download size={13} /> Export history <ChevronDown size={12} />
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
                            onClick={() => {
                                exportRows(rows, "dues_history_by_villa_size", f);
                                setOpen(false);
                            }}
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

export default function DuesHistorySection() {
    const [byYear, setByYear] = useState([]);
    const [bySize, setBySize] = useState([]);
    const [villasPerYear, setVillasPerYear] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        Promise.all([
            villaFeesApi.historyByYear(),
            villaFeesApi.historyBySize(),
            villaFeesApi.historyVillasPerYear(),
        ])
            .then(([y, s, v]) => {
                setByYear(y ?? []);
                setBySize(s ?? []);
                setVillasPerYear(v ?? []);
            })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setLoading(false));
    }, []);

    // Pivot: one row per year, one column per fee type + total + villas.
    const pivot = useMemo(() => {
        const years = [...new Set(byYear.map((r) => r.year))].sort();
        const villaMap = Object.fromEntries(
            villasPerYear.map((r) => [r.year, r]),
        );
        return years.map((year) => {
            const row = { year };
            let total = 0;
            FEE_COLUMNS.forEach(([key]) => {
                const hit = byYear.find((r) => r.year === year && r.fee_type === key);
                row[key] = hit?.total_billed ?? null;
                total += Number(hit?.total_billed ?? 0);
            });
            row.total = total;
            row.villas = villaMap[year]?.villas_billed ?? null;
            row.members = villaMap[year]?.members_billed ?? null;
            return row;
        });
    }, [byYear, villasPerYear]);

    // Flat export rows from the by-size dataset (the supervisor deliverable).
    const exportData = useMemo(
        () =>
            bySize.map((r) => ({
                Year: r.year,
                "Fee Type": r.fee_type,
                Bedrooms: r.bedroom_count ?? "Unknown",
                Villas: r.villas,
                "Members Billed": r.members_billed,
                "Total Billed ($USD)": r.total_billed,
                "Avg / Member ($USD)": r.avg_per_member,
            })),
        [bySize],
    );

    const th = (label, right = true) => (
        <th
            key={label}
            style={{
                textAlign: right ? "right" : "left",
                padding: "10px 14px",
                color: C.muted,
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                whiteSpace: "nowrap",
                borderBottom: `1px solid ${C.rowBorder}`,
            }}
        >
            {label}
        </th>
    );

    const td = (val, opts = {}) => (
        <td
            style={{
                padding: "10px 14px",
                textAlign: opts.left ? "left" : "right",
                color: opts.color ?? C.text,
                fontWeight: opts.bold ? 800 : 400,
                borderBottom: `1px solid ${C.rowBorder}`,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
            }}
        >
            {val}
        </td>
    );

    return (
        <div
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: 18,
                background: C.bg,
                overflow: "hidden",
                boxShadow: "var(--dashboard-shadow-soft)",
                marginTop: 16,
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: 12,
                    padding: "14px 16px",
                    borderBottom: `1px solid ${C.rowBorder}`,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <div className="dashboard-eyebrow">Dues history</div>
                    <div style={{ fontFamily: serif, fontSize: 22, color: C.text }}>
                        Dues billed per year, by fee type
                    </div>
                    <div style={{ color: C.muted, fontSize: 11, maxWidth: 620 }}>
                        From member statements. Capital Expenditure sums monthly + annual
                        charges. Full multi-member coverage starts Dec 2024 — 2025 is the
                        only complete year; earlier years reflect a single member's
                        statements. Maintenance includes special assessments.
                    </div>
                </div>
                <ExportMenu rows={exportData} disabled={!exportData.length} />
            </div>

            {error && (
                <div style={{ padding: 14, color: C.rust, fontSize: 12 }}>{error}</div>
            )}

            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                        <tr>
                            {th("Year", false)}
                            {FEE_COLUMNS.map(([, label]) => th(label))}
                            {th("Total")}
                            {th("Villas")}
                            {th("Members")}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td
                                    colSpan={FEE_COLUMNS.length + 4}
                                    style={{ padding: 20, textAlign: "center", color: C.muted }}
                                >
                                    Loading dues history…
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            pivot.map((r) => (
                                <tr key={r.year}>
                                    {td(r.year, { left: true, bold: true })}
                                    {FEE_COLUMNS.map(([key]) => td(money(r[key])))}
                                    {td(money(r.total), { bold: true, color: C.rust })}
                                    {td(r.villas ?? "—")}
                                    {td(r.members ?? "—")}
                                </tr>
                            ))}
                        {!loading && !pivot.length && (
                            <tr>
                                <td
                                    colSpan={FEE_COLUMNS.length + 4}
                                    style={{ padding: 20, textAlign: "center", color: C.muted }}
                                >
                                    No dues history found — make sure the SETUP section of
                                    HISTORICAL_DUES_SYNOPSIS.sql has been run in the database.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}