    import { useEffect, useMemo, useRef, useState } from "react";
    import {
    ChevronDown,
    Download,
    Search,
    X,
    } from "lucide-react";

    import * as XLSX from "xlsx";
    import { jsPDF } from "jspdf";
    import { autoTable } from "jspdf-autotable";

    const C = {
    bg: "var(--dashboard-card)",
    panelAlt: "var(--dashboard-panel-alt)",
    border: "var(--dashboard-border)",
    text: "var(--dashboard-abyssal)",
    muted: "var(--dashboard-muted)",
    accent: "var(--dashboard-deep-blue)",
    accent2: "var(--dashboard-truffle)",
    };

    const MIN_WIDTH = 420;
    const DEFAULT_WIDTH = 760;
    const MAX_WIDTH_RATIO = 0.92;

    const COLUMNS = [
        { key: "member_number", label: "Account #" },
        { key: "member_full_name", label: "Name" },
        { key: "member_or_guest", label: "Category" },
        { key: "member_type", label: "Account Type" },
        { key: "status", label: "Status" },
        { key: "dependent_count", label: "Dependents", },
        { key: "since_date", label: "Since Date" },
        { key: "age", label: "Age" },
        { key: "gender", label: "Gender" },
        { key: "email", label: "Email" },
        { key: "city", label: "City" },
        { key: "postal_code", label: "Postal Code" },
        { key: "country", label: "Country" },
    ];

    const MONTHS = [
        { value: "All", label: "All Months" },
        { value: "01", label: "January" },
        { value: "02", label: "February" },
        { value: "03", label: "March" },
        { value: "04", label: "April" },
        { value: "05", label: "May" },
        { value: "06", label: "June" },
        { value: "07", label: "July" },
        { value: "08", label: "August" },
        { value: "09", label: "September" },
        { value: "10", label: "October" },
        { value: "11", label: "November" },
        { value: "12", label: "December" },
    ];

    export default function StateAccountsModal({
    state = null,
    title = "",
    eyebrow = "Account details",
    emptyMessage = "",
    exportKey = "accounts",
    accounts = [],
    loading = false,
    error = "",
    onClose,
    }) {
    const [search, setSearch] = useState("");
    const [yearFilter, setYearFilter] = useState("All");
    const [monthFilter, setMonthFilter] = useState("All");
    const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);

    const exportMenuRef = useRef(null);
    const resizingRef = useRef(false);

    const drawerTitle =
        title ||
        (state
            ? `Accounts in ${state.name} (${state.code})`
            : "Account Details");

    const drawerEmptyMessage =
        emptyMessage ||
        (state
            ? `No accounts were found in ${state.name}.`
            : "No accounts were found.");

    const drawerExportKey =
        exportKey ||
        state?.code ||
        "accounts";

    useEffect(() => {
        if (!state && !title) return;

        const handleEscape = (event) => {
            if (event.key === "Escape") {
            onClose();
            }
        };

        const previousOverflow =
            document.body.style.overflow;

        document.body.style.overflow = "hidden";

        window.addEventListener(
            "keydown",
            handleEscape,
        );

        return () => {
            document.body.style.overflow =
            previousOverflow;

            window.removeEventListener(
            "keydown",
            handleEscape,
            );
        };
        }, [state, title, onClose]);

    useEffect(() => {
        if (!exportMenuOpen) return;

        const handleOutsideClick = (event) => {
            if (
            exportMenuRef.current &&
            !exportMenuRef.current.contains(event.target)
            ) {
            setExportMenuOpen(false);
            }
        };

        window.addEventListener(
            "mousedown",
            handleOutsideClick,
        );

        return () => {
            window.removeEventListener(
            "mousedown",
            handleOutsideClick,
            );
        };
        }, [exportMenuOpen]);

    useEffect(() => {
        setSearch("");
        setYearFilter("All");
        setMonthFilter("All");
        setExportMenuOpen(false);
    }, [state, title]);

    useEffect(() => {
        const handleMouseMove = (event) => {
        if (!resizingRef.current) return;

        const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
        const nextWidth = window.innerWidth - event.clientX;

        setDrawerWidth(
            Math.min(
            Math.max(nextWidth, MIN_WIDTH),
            maxWidth,
            ),
        );
        };

        const handleMouseUp = () => {
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const availableYears = useMemo(() => {
        const years = accounts
            .map((account) => {
            const dateValue = account.since_date;

            if (!dateValue) {
                return null;
            }

            const date = new Date(dateValue);

            if (Number.isNaN(date.getTime())) {
                return null;
            }

            return String(date.getFullYear());
            })
            .filter(Boolean);

        return [
            "All",
            ...Array.from(new Set(years)).sort(
            (a, b) => Number(b) - Number(a),
            ),
        ];
    }, [accounts]);

    const filteredAccounts = useMemo(() => {
        const term = search.trim().toLowerCase();

        return accounts.filter((account) => {
            const dateValue = account.since_date;
            const date = dateValue
            ? new Date(dateValue)
            : null;

            const hasValidDate =
            date && !Number.isNaN(date.getTime());

            const accountYear = hasValidDate
            ? String(date.getFullYear())
            : null;

            const accountMonth = hasValidDate
            ? String(date.getMonth() + 1).padStart(2, "0")
            : null;

            const matchesYear =
            yearFilter === "All" ||
            accountYear === yearFilter;

            const matchesMonth =
            monthFilter === "All" ||
            accountMonth === monthFilter;

            const matchesSearch =
            !term ||
            COLUMNS.some((column) =>
                String(account[column.key] ?? "")
                .toLowerCase()
                .includes(term),
            );

            return (
            matchesYear &&
            matchesMonth &&
            matchesSearch
            );
        });
    }, [accounts, search, yearFilter, monthFilter,]);

    const makeFilename = (extension) => {
        const safeKey = String(drawerExportKey || "accounts")
            .trim()
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();

        const date = new Date()
            .toISOString()
            .slice(0, 10);

        const filterParts = [
            yearFilter !== "All"
                ? yearFilter
                : null,
            monthFilter !== "All"
                ? monthFilter
                : null,
        ].filter(Boolean);

        const filterSuffix = filterParts.length
            ? `-${filterParts.join("-")}`
            : "";

        return `${
            safeKey || "accounts"
            }${filterSuffix}-${date}.${extension}`;
        };

    const exportValue = (value) => {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "";
    }

    return String(value);
    };

    const exportRows = filteredAccounts.map(
    (account) =>
        Object.fromEntries(
        COLUMNS.map((column) => [
            column.label,
            exportValue(account[column.key]),
        ]),
        ),
    );

    const exportCsv = () => {
        if (!filteredAccounts.length) return;

        const escapeCsvValue = (value) => {
            const text = exportValue(value);

            return `"${text.replace(/"/g, '""')}"`;
        };

        const header = COLUMNS.map((column) =>
            escapeCsvValue(column.label),
        ).join(",");

        const csvRows = filteredAccounts.map((account) =>
            COLUMNS.map((column) =>
            escapeCsvValue(account[column.key]),
            ).join(","),
        );

        const csvContent = [
            header,
            ...csvRows,
        ].join("\n");

        const blob = new Blob(
            [`\uFEFF${csvContent}`],
            {
            type: "text/csv;charset=utf-8;",
            },
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = makeFilename("csv");

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
        setExportMenuOpen(false);
        };

        const exportExcel = () => {
        if (!filteredAccounts.length) return;

        const worksheet =
            XLSX.utils.json_to_sheet(exportRows);

        worksheet["!cols"] = COLUMNS.map((column) => ({
            wch: Math.max(
            column.label.length + 2,
            14,
            ),
        }));

        const workbook = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            state?.code || "Accounts",
        );

        XLSX.writeFile(
            workbook,
            makeFilename("xlsx"),
        );

        setExportMenuOpen(false);
        };

        const exportPdf = () => {
        if (!filteredAccounts.length) return;

        const pdf = new jsPDF({
            orientation: "landscape",
            unit: "pt",
            format: "a4",
        });


        const pdfTitle = drawerTitle;

        pdf.setFontSize(15);
        pdf.text(pdfTitle, 36, 34);

        pdf.setFontSize(9);
        pdf.text(
            `${filteredAccounts.length.toLocaleString()} account${
            filteredAccounts.length === 1 ? "" : "s"
            } exported`,
            36,
            50,
        );

        autoTable(pdf, {
            startY: 64,

            head: [
            COLUMNS.map((column) => column.label),
            ],

            body: filteredAccounts.map((account) =>
            COLUMNS.map((column) =>
                exportValue(account[column.key]),
            ),
            ),

            styles: {
            fontSize: 7,
            cellPadding: 4,
            overflow: "linebreak",
            valign: "middle",
            },

            headStyles: {
            fontStyle: "bold",
            },

            margin: {
            top: 36,
            right: 24,
            bottom: 28,
            left: 24,
            },

            horizontalPageBreak: true,
            horizontalPageBreakBehaviour: "afterAllRows",

            didDrawPage: () => {
            const pageNumber = pdf.getNumberOfPages();

            pdf.setFontSize(7);
            pdf.text(
                `Page ${pageNumber}`,
                pdf.internal.pageSize.getWidth() - 52,
                pdf.internal.pageSize.getHeight() - 14,
            );
            },
        });

        pdf.save(makeFilename("pdf"));
        setExportMenuOpen(false);
        };

    const startResize = (event) => {
        event.preventDefault();

        resizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const filterSelectStyle = {
        height: 38,
        padding: "0 10px",
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        outline: "none",
        background: C.panelAlt,
        color: C.text,
        fontSize: 11,
        cursor: "pointer",
    };

    if (!state && !title) {
        return null;
    }

    return (
        <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="state-accounts-title"
        style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(27, 38, 50, 0.34)",
        }}
        onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
            onClose();
            }
        }}
        >
        <aside
            style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: drawerWidth,
            maxWidth: "92vw",
            minWidth: MIN_WIDTH,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: C.bg,
            borderLeft: `1px solid ${C.border}`,
            boxShadow: "-18px 0 45px rgba(0, 0, 0, 0.18)",
            fontFamily: "Inter, system-ui, sans-serif",
            }}
            onMouseDown={(event) => {
            event.stopPropagation();
            }}
        >
            {/* Resize handle */}
            <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize account drawer"
            onMouseDown={startResize}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                width: 8,
                zIndex: 10,
                cursor: "col-resize",
            }}
            >
            <div
                style={{
                position: "absolute",
                top: "50%",
                left: 2,
                transform: "translateY(-50%)",
                width: 3,
                height: 52,
                borderRadius: 999,
                background: C.border,
                }}
            />
            </div>

            {/* Header */}
            <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "20px 22px 16px 26px",
                borderBottom: `1px solid ${C.border}`,
            }}
            >
            <div>
                <div
                style={{
                    marginBottom: 4,
                    color: C.muted,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                }}
                >
                {eyebrow}
                </div>

                <h2
                id="state-accounts-title"
                style={{
                    margin: 0,
                    color: C.text,
                    fontFamily: "'Cormorant Garamond', serif",
                    fontSize: 27,
                    lineHeight: 1.15,
                }}
                >
                {drawerTitle}
                </h2>

                <p
                style={{
                    margin: "5px 0 0",
                    color: C.accent2,
                    fontSize: 12,
                }}
                >
                {loading
                    ? "Loading account information..."
                    : `${accounts.length.toLocaleString()} ${
                        accounts.length === 1
                        ? "account"
                        : "accounts"
                    }`}
                </p>

            <button
                type="button"
                onClick={onClose}
                aria-label="Close account drawer"
                style={{
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                padding: 0,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.panelAlt,
                color: C.muted,
                cursor: "pointer",
                }}
            >
                <X size={16} />
            </button>
            </div>

            {/* Toolbar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    flex: "1 1 500px",
                }}
                >
                <div
                    style={{
                    position: "relative",
                    flex: "1 1 230px",
                    minWidth: 200,
                    maxWidth: 350,
                    }}
                >
                    <Search
                    size={14}
                    style={{
                        position: "absolute",
                        left: 11,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.muted,
                    }}
                    />

                    <input
                    type="search"
                    value={search}
                    onChange={(event) =>
                        setSearch(event.target.value)
                    }
                    placeholder="Search name, account number, city..."
                    disabled={loading}
                    style={{
                        width: "100%",
                        height: 38,
                        padding: "0 12px 0 34px",
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        outline: "none",
                        background: C.panelAlt,
                        color: C.text,
                        fontSize: 12,
                        opacity: loading ? 0.6 : 1,
                    }}
                    />
                </div>

                <select
                    value={yearFilter}
                    onChange={(event) =>
                    setYearFilter(event.target.value)
                    }
                    style={filterSelectStyle}
                >
                    {availableYears.map((year) => (
                    <option key={year} value={year}>
                        {year === "All"
                        ? "All Years"
                        : year}
                    </option>
                    ))}
                </select>

                <select
                    value={monthFilter}
                    onChange={(event) =>
                    setMonthFilter(event.target.value)
                    }
                    style={filterSelectStyle}
                >
                    {MONTHS.map((month) => (
                    <option
                        key={month.value}
                        value={month.value}
                    >
                        {month.label}
                    </option>
                    ))}
                </select>

                {(search ||
                    yearFilter !== "All" ||
                    monthFilter !== "All") && (
                    <button
                    type="button"
                    onClick={() => {
                        setSearch("");
                        setYearFilter("All");
                        setMonthFilter("All");
                    }}
                    style={{
                        height: 38,
                        padding: "0 11px",
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        background: C.bg,
                        color: C.muted,
                        fontSize: 11,
                        cursor: "pointer",
                    }}
                    >
                    Clear
                    </button>
                )}
                </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                }}
                >
                {!loading && !error && (
                    <span
                    style={{
                        color: C.muted,
                        fontSize: 11,
                    }}
                    >
                    Showing{" "}
                    {filteredAccounts.length.toLocaleString()} of{" "}
                    {accounts.length.toLocaleString()}
                    </span>
                )}

                <div
                    ref={exportMenuRef}
                    style={{
                    position: "relative",
                    }}
                >
                    <button
                    type="button"
                    onClick={() =>
                        setExportMenuOpen((open) => !open)
                    }
                    disabled={
                        loading ||
                        Boolean(error) ||
                        filteredAccounts.length === 0
                    }
                    aria-expanded={exportMenuOpen}
                    aria-haspopup="menu"
                    style={{
                        height: 38,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        padding: "0 11px",
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        background: C.bg,
                        color: C.text,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor:
                        loading ||
                        error ||
                        filteredAccounts.length === 0
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                        loading ||
                        error ||
                        filteredAccounts.length === 0
                            ? 0.5
                            : 1,
                    }}
                    >
                    <Download size={14} />

                    Export

                    <ChevronDown
                        size={13}
                        style={{
                        transform: exportMenuOpen
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                        transition: "transform 0.16s ease",
                        }}
                    />
                    </button>

                    {exportMenuOpen && (
                    <div
                        role="menu"
                        style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        right: 0,
                        zIndex: 30,
                        width: 150,
                        overflow: "hidden",
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 11,
                        boxShadow:
                            "0 12px 32px rgba(0, 0, 0, 0.15)",
                        padding: 5,
                        }}
                    >
                        {[
                        {
                            label: "Export CSV",
                            action: exportCsv,
                        },
                        {
                            label: "Export Excel",
                            action: exportExcel,
                        },
                        {
                            label: "Export PDF",
                            action: exportPdf,
                        },
                        ].map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            onClick={item.action}
                            style={{
                            width: "100%",
                            padding: "9px 10px",
                            border: "none",
                            borderRadius: 7,
                            background: "transparent",
                            color: C.text,
                            fontSize: 11,
                            textAlign: "left",
                            cursor: "pointer",
                            }}
                            onMouseEnter={(event) => {
                            event.currentTarget.style.background =
                                C.panelAlt;
                            }}
                            onMouseLeave={(event) => {
                            event.currentTarget.style.background =
                                "transparent";
                            }}
                        >
                            {item.label}
                        </button>
                        ))}
                    </div>
                    )}
                </div>
                </div>
            </div>

            {/* Content */}
            <div
            style={{
                flex: 1,
                overflow: "auto",
                padding: "18px 22px 22px 26px",
            }}
            >
            {loading ? (
                <div
                style={{
                    padding: 50,
                    textAlign: "center",
                    color: C.muted,
                    fontSize: 13,
                }}
                >
                Loading account information...
                </div>
            ) : error ? (
                <div
                style={{
                    padding: 40,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    textAlign: "center",
                    color: C.accent2,
                    fontSize: 13,
                }}
                >
                {error}
                </div>
            ) : filteredAccounts.length === 0 ? (
                <div
                style={{
                    padding: 40,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    textAlign: "center",
                    color: C.muted,
                    fontSize: 13,
                }}
                >
                {search ? "No accounts match your search." : drawerEmptyMessage}
                </div>
            ) : (
                <div
                style={{
                    overflowX: "auto",
                    border: `1px solid ${C.border}`,
                    borderRadius: 14,
                }}
                >
                <table
                    style={{
                    width: "100%",
                    minWidth: 1120,
                    borderCollapse: "collapse",
                    fontSize: 12,
                    }}
                >
                    <thead
                    style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: C.panelAlt,
                    }}
                    >
                    <tr>
                        {COLUMNS.map((column) => (
                        <th
                            key={column.key}
                            style={{
                            padding: "10px 12px",
                            borderBottom: `2px solid ${C.border}`,
                            color: C.muted,
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textAlign: "left",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                            }}
                        >
                            {column.label}
                        </th>
                        ))}
                    </tr>
                    </thead>

                    <tbody>
                    {filteredAccounts.map(
                        (account, index) => (
                        <tr
                            key={`${account.member_number}-${index}`}
                            style={{
                            background:
                                index % 2 === 0
                                ? C.bg
                                : C.panelAlt,
                            borderBottom: `1px solid ${C.border}`,
                            }}
                        >
                            {COLUMNS.map((column) => (
                            <td
                                key={column.key}
                                style={{
                                padding: "10px 12px",
                                color: C.text,
                                whiteSpace:
                                    column.key === "email"
                                    ? "normal"
                                    : "nowrap",
                                }}
                            >
                                {account[column.key] ?? "—"}
                            </td>
                            ))}
                        </tr>
                        ),
                    )}
                    </tbody>
                </table>
                </div>
            )}
            </div>
        </aside>
        </div>
    );
    }