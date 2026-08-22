// frontend/src/pages/mltab/CampaignDrawer.jsx
import { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import {
  C,
  money,
  number,
  formatDate,
  Metric,
  ActionButton,
} from "./MarketingTargetingShared";

const th = {
  padding: "10px 12px",
  background: C.panelAlt,
  color: C.textMid,
  fontWeight: 800,
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const td = {
  padding: "10px 12px",
  borderBottom: `1px solid ${C.rowBorder}`,
  color: C.textPrimary,
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

export default function CampaignDrawer({
  campaign,
  rows,
  loading,
  onClose,
  onExport,
}) {
  const [search, setSearch] = useState("");
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.name,
        r.member_number,
        r.email,
        r.country,
        r.state,
        r.business_source,
        r.preferred_season,
        r.preferred_villa,
        r.preferred_amenity,
        r.campaign_reason,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);
  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => {
          acc.paid += Number(r.paid_revenue || 0);
          acc.free += Number(r.free_value || 0);
          acc.lifetime += Number(r.lifetime_spend || 0);
          return acc;
        },
        { paid: 0, free: 0, lifetime: 0 },
      ),
    [filteredRows],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(1120px, 94vw)",
          height: "100%",
          background: C.bg,
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 22px",
            borderBottom: `1px solid ${C.border}`,
            background: C.panelAlt,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                color: C.textMuted,
                fontSize: 11,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "sans-serif",
              }}
            >
              Marketing Campaign
            </p>
            <h2
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: 22,
                fontWeight: 900,
                fontFamily: "sans-serif",
              }}
            >
              {campaign?.title}
            </h2>
            <p
              style={{
                margin: "7px 0 0",
                color: C.textMuted,
                fontSize: 13,
                fontFamily: "sans-serif",
                maxWidth: 760,
              }}
            >
              {campaign?.description}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.textPrimary,
              borderRadius: 10,
              width: 36,
              height: 36,
              cursor: "pointer",
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div
          style={{
            padding: 18,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <Metric
              label="Visible Targets"
              value={number(filteredRows.length)}
            />
            <Metric label="Potential" value={money(totals.lifetime)} />
            <Metric label="Paid Revenue" value={money(totals.paid)} />
            <Metric label="Free Value" value={money(totals.free)} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: C.textMuted,
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members, source, villa, reason…"
                style={{
                  width: 330,
                  padding: "9px 12px 9px 34px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.bg,
                  color: C.textPrimary,
                  outline: "none",
                  fontSize: 13,
                  fontFamily: "sans-serif",
                }}
              />
            </div>
            <ActionButton
              primary
              disabled={!filteredRows.length}
              onClick={() => onExport(filteredRows)}
            >
              <Download size={14} /> Export Visible CSV
            </ActionButton>
          </div>

          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              overflow: "auto",
              minHeight: 0,
              flex: 1,
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 40,
                  color: C.textMuted,
                  fontFamily: "sans-serif",
                }}
              >
                Loading campaign members…
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "sans-serif",
                }}
              >
                <thead>
                  <tr>
                    {[
                      "Name",
                      "Email",
                      "Phone",
                      "Country",
                      "Source",
                      "Season",
                      "Villa",
                      "Amenity",
                      "Potential",
                      "Paid",
                      "Free",
                      "Last Visit",
                      "Reason",
                    ].map((h, idx) => (
                      <th
                        key={h}
                        style={{
                          ...th,
                          textAlign: idx >= 8 && idx <= 10 ? "right" : "left",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13}
                        style={{ ...td, padding: 34, color: C.textMuted }}
                      >
                        No matching members found.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, index) => (
                      <tr key={`${r.member_number}-${index}`}>
                        <td style={{ ...td, fontWeight: 800 }}>
                          {r.name || "—"}
                        </td>
                        <td style={td}>{r.email || "—"}</td>
                        <td style={td}>{r.phone_number || "—"}</td>
                        <td style={td}>{r.country || r.state || "—"}</td>
                        <td style={td}>{r.business_source || "—"}</td>
                        <td style={td}>{r.preferred_season || "—"}</td>
                        <td style={td}>{r.preferred_villa || "—"}</td>
                        <td style={td}>{r.preferred_amenity || "—"}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.lifetime_spend)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.paid_revenue)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {money(r.free_value)}
                        </td>
                        <td style={td}>{formatDate(r.last_visit)}</td>
                        <td
                          style={{
                            ...td,
                            minWidth: 280,
                            whiteSpace: "normal",
                            color: C.textMid,
                          }}
                        >
                          {r.campaign_reason || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
