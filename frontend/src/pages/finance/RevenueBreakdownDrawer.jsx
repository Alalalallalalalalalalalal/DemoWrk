// frontend/src/pages/finance/RevenueBreakdownDrawer.jsx
// Right-side slide-over drawer for drill-down folio records.

import { useEffect, useRef, useState } from "react";
import { X, ChevronRight } from "lucide-react";
import { financeApi } from "../../api/financeApi";

const C = {
  bg:      "var(--dashboard-card)",
  panel:   "var(--dashboard-panel)",
  panelAlt:"var(--dashboard-panel-alt)",
  border:  "var(--dashboard-border)",
  text:    "var(--dashboard-abyssal)",
  muted:   "var(--dashboard-muted)",
  soft:    "var(--dashboard-text-soft)",
  accent:  "var(--dashboard-deep-blue)",
  accent2: "var(--dashboard-truffle)",
  accent3: "var(--dashboard-flame)",
};

const money = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

// ── Breadcrumb trail ────────────────────────────────────────────
function Breadcrumbs({ trail, onNavigate }) {
  if (!trail.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
      {trail.map((crumb, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <ChevronRight size={12} color={C.muted} />}
          <button
            onClick={() => onNavigate(i)}
            style={{
              background: "none",
              border: "none",
              cursor: i < trail.length - 1 ? "pointer" : "default",
              padding: "2px 6px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: i === trail.length - 1 ? 700 : 400,
              color: i === trail.length - 1 ? C.text : C.accent,
              fontFamily: "sans-serif",
              textDecoration: i < trail.length - 1 ? "underline" : "none",
            }}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </div>
  );
}

// ── Folio records table ─────────────────────────────────────────
function FolioTable({ rows }) {
  const [search, setSearch] = useState("");

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.description, r.folioName, r.memberNumber, r.guestName, r.villaName, r.confCode]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });

  const thStyle = {
    padding: "9px 12px",
    background: C.panelAlt,
    color: C.soft,
    fontWeight: 700,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    zIndex: 2,
    textAlign: "left",
    fontFamily: "sans-serif",
  };

  const tdStyle = {
    padding: "9px 12px",
    borderBottom: `1px solid var(--dashboard-row-border)`,
    color: C.text,
    fontSize: 12,
    verticalAlign: "top",
    fontFamily: "sans-serif",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, folio, member…"
          style={{
            width: 260,
            padding: "7px 11px",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12,
            background: C.bg,
            color: C.text,
            outline: "none",
            fontFamily: "sans-serif",
          }}
        />
        <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>
          {filtered.length} records
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Folio / Conf</th>
                <th style={thStyle}>Member / Guest</th>
                <th style={thStyle}>Villa</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: C.muted, padding: 32 }}>
                    No records found
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={r.folioKey ?? i} style={{ background: i % 2 === 0 ? "transparent" : C.panel }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: C.muted }}>
                      {r.transactionDate ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 220, wordBreak: "break-word" }}>
                      {r.description ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, color: C.muted, fontSize: 11 }}>
                      <div>{r.folioNum ?? "—"}</div>
                      <div style={{ color: C.accent }}>{r.confCode ?? ""}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.folioName ?? r.guestName ?? "—"}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        {r.memberNumber ? `#${r.memberNumber}` : "Guest"}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: C.soft }}>{r.villaName ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.accent }}>
                      {money(r.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Mid-level breakdown list (e.g. villas within "Villa Revenue") ─
function BreakdownList({ items, onDrill }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => onDrill(item)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 14px",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: i % 2 === 0 ? C.bg : C.panel,
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.panelAlt)}
          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.bg : C.panel)}
        >
          <div>
            <div style={{ fontWeight: 600, color: C.text, fontSize: 13, fontFamily: "sans-serif" }}>
              {item.label}
            </div>
            {item.sub && (
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif", marginTop: 2 }}>
                {item.sub}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, color: C.accent, fontSize: 14, fontFamily: "sans-serif" }}>
              {money(item.revenue)}
            </span>
            {item.count != null && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: "sans-serif" }}>
                {fmt(item.count)} txn
              </span>
            )}
            <ChevronRight size={14} color={C.muted} />
          </div>
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// DRAWER  –  exported component
// ══════════════════════════════════════════════════════════════════
export default function RevenueBreakdownDrawer({
  open,
  onClose,
  // Initial drill context
  drillType,   // "total" | "paid" | "complimentary" | "member" | "guest" | "source" | "villa" | "amenity"
  drillValue,  // label string shown in title
  // Mid-level items (optional): array of { label, sub, revenue, count, drillType, drillValue }
  // When provided, show a list first; clicking an item loads folio records
  midItems,
}) {
  const [trail, setTrail]         = useState([]);
  const [folioRows, setFolioRows] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [showFolios, setShowFolios] = useState(false);
  const [currentMidItems, setCurrentMidItems] = useState(midItems ?? []);

  // Reset whenever the drawer opens with new context
  useEffect(() => {
    if (!open) return;
    setTrail([{ label: drillValue ?? "Breakdown", drillType, drillValue }]);
    setFolioRows([]);
    setError(null);
    setShowFolios(false);
    setCurrentMidItems(midItems ?? []);

    // If no mid-level items, go straight to folio records
    if (!midItems || midItems.length === 0) {
      loadFolios(drillType, drillValue);
    }
  }, [open, drillType, drillValue]);

  async function loadFolios(type, value) {
    setLoading(true);
    setError(null);
    try {
      const data = await financeApi.drilldown(type, value);
      setFolioRows(data);
      setShowFolios(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function drillIntoItem(item) {
    setTrail((prev) => [...prev, { label: item.label, drillType: item.drillType, drillValue: item.drillValue }]);
    loadFolios(item.drillType, item.drillValue);
  }

  function navigateTrail(idx) {
    const crumb = trail[idx];
    const newTrail = trail.slice(0, idx + 1);
    setTrail(newTrail);
    if (idx === 0 && currentMidItems.length > 0) {
      setShowFolios(false);
      setFolioRows([]);
    } else {
      loadFolios(crumb.drillType, crumb.drillValue);
    }
  }

  if (!open) return null;

  const totalRevenue = folioRows.reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--dashboard-overlay)",
          zIndex: 900,
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(780px, 96vw)",
          background: C.bg,
          boxShadow: "var(--dashboard-shadow-panel)",
          zIndex: 901,
          display: "flex",
          flexDirection: "column",
          borderLeft: `3px solid ${C.accent2}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "22px 26px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="dashboard-eyebrow">Revenue Breakdown</div>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 28,
                  color: C.text,
                  margin: "4px 0 0",
                  lineHeight: 1.15,
                }}
              >
                {trail[trail.length - 1]?.label ?? drillValue}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 36, height: 36, borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: C.bg,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.soft,
              }}
            >
              <X size={16} />
            </button>
          </div>

          {showFolios && (
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: C.accent, fontFamily: "sans-serif" }}>
                {money(totalRevenue)}
              </span>
              <span style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginLeft: 8 }}>
                total from {folioRows.length} records
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 26px 32px" }}>
          <Breadcrumbs trail={trail} onNavigate={navigateTrail} />

          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontFamily: "sans-serif" }}>
              Loading records…
            </div>
          )}

          {error && (
            <div style={{ padding: 16, color: "#C45B5B", fontSize: 13, fontFamily: "sans-serif" }}>
              {error}
            </div>
          )}

          {!loading && !error && !showFolios && currentMidItems.length > 0 && (
            <>
              <p style={{ fontSize: 12, color: C.muted, fontFamily: "sans-serif", marginBottom: 14 }}>
                Select a category below to see underlying folio records.
              </p>
              <BreakdownList items={currentMidItems} onDrill={drillIntoItem} />
            </>
          )}

          {!loading && !error && showFolios && (
            <FolioTable rows={folioRows} />
          )}
        </div>
      </aside>
    </>
  );
}
