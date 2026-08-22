// frontend/src/pages/visits/VisitsSummaryCards.jsx
//
// Revenue banner + the "Total bookings / room nights / avg stay / avg party"
// stat card row from the top of the visits/rooms tab.

import { CalendarClock, CalendarDays, Moon, Users } from "lucide-react";
import { FONT_DISPLAY, T, money, n0, n1, periodText } from "./VisitsRoomsShared";

function StatCard({ label, value, unit, note, icon: Icon, onClick }) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={onClick ? "vr-focus vr-lift" : "vr-lift"}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${T.line}`,
        borderRadius: 18,
        background: T.mist,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        cursor: onClick ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: T.muted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {Icon && <Icon size={13} />}
        {label}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 5,
        }}
      >
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            color: T.ink,
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>

        {unit && (
          <span
            style={{
              color: T.muted,
              fontSize: 11,
            }}
          >
            {unit}
          </span>
        )}
      </div>

      {note && (
        <div
          style={{
            color: T.muted,
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={note}
        >
          {note}
        </div>
      )}
    </Tag>
  );
}

export default function VisitsSummaryCards({
  tab,
  summary,
  totals,
  period,
  onOpenSplit,
}) {
  return (
    <>
      {/* ── Revenue banner ─────────────────────────────────────────────── */}
      <div
        className="visits-revenue-banner flex flex-wrap items-end justify-between gap-6"
        style={{
          background: T.ink,
          borderRadius: 18,
          color: "#fff",
        }}
      >
        <div>
          <div
            className="text-xs font-bold uppercase"
            style={{ letterSpacing: "0.12em", color: T.flame, fontSize: 11 }}
          >
            {tab === "free" ? "Total comp value" : "Total villa revenue"}
          </div>
          <div
            className="visits-revenue-value"
            style={{
              fontFamily: FONT_DISPLAY,
              lineHeight: 1,
              marginTop: 10,
            }}
          >
            {money(
              tab === "overall" ? summary?.villa_rental_revenue : totals.value,
            )}
          </div>
        </div>
        <div style={{ fontSize: 14, color: "#A8C6D8", maxWidth: 420 }}>
          {tab === "free"
            ? "Comp stays bill nothing — this is the rack value of the rooms given away."
            : `${n0(totals.bookings)} bookings · ${periodText(period)}`}
          {tab === "overall" && (
            <div className="mt-2" style={{ fontSize: 12 }}>
              Villa Income from owner statements
            </div>
          )}
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <div className="visits-summary-grid">
        <StatCard
          label="Total bookings"
          value={n0(totals.bookings)}
          note={
            tab === "overall"
              ? "Member vs guest split — open"
              : `${tab === "paid" ? "Paid" : "Comp"} bookings only`
          }
          icon={CalendarDays}
          onClick={onOpenSplit}
        />
        <StatCard
          label="Total room nights"
          value={n0(totals.nights)}
          note="Occupied room-date nights"
          icon={Moon}
        />
        <StatCard
          label="Avg length of stay"
          value={totals.avgStay == null ? "—" : n1(totals.avgStay)}
          unit="nights"
          note={
            totals.avgStayDerived
              ? "Nights ÷ bookings for this filter"
              : "Nights per booking"
          }
          icon={CalendarClock}
        />
        <StatCard
          label="Avg party size"
          value={totals.avgParty == null ? "—" : n1(totals.avgParty)}
          unit={totals.avgParty == null ? "" : "guests"}
          note={
            totals.avgParty == null
              ? "Not published per payment type"
              : "People per booking"
          }
          icon={Users}
        />
      </div>
    </>
  );
}
