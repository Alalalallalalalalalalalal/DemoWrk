// frontend/src/pages/visits/VisitsLeadersRow.jsx
//
// "Most booked / Least booked / Most value / Least value" leader-card row.

import {
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { FONT_DISPLAY, FONT_NUM, T, money, n0 } from "./VisitsRoomsShared";

function LeaderCard({
  label,
  name,
  primary,
  secondary,
  tone,
  icon: Icon,
  onOpen,
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="vr-focus vr-lift w-full text-left"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 16,
        padding: "18px 20px",
        cursor: "pointer",
      }}
    >
      <div
        className="flex items-center gap-1.5 text-xs font-bold uppercase"
        style={{ letterSpacing: "0.1em", color: T.muted, fontSize: 11 }}
      >
        <Icon size={13} style={{ color: tone }} />
        {label}
      </div>
      <div
        className="mt-3 truncate"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          lineHeight: 1.15,
          color: T.ink,
        }}
      >
        {name || "—"}
      </div>
      <div
        className="mt-2"
        style={{ fontFamily: FONT_NUM, fontSize: 13, color: T.deep }}
      >
        {primary}
      </div>
      <div className="mt-0.5" style={{ fontSize: 12, color: T.slate }}>
        {secondary}
      </div>
    </button>
  );
}

export default function VisitsLeadersRow({ leaders, tab, onOpenVilla }) {
  return (
    <div className="visits-leader-grid">
      <LeaderCard
        label="Most booked"
        tone={T.deep}
        icon={TrendingUp}
        name={leaders.mostBooked?.name}
        primary={
          leaders.mostBooked ? `${n0(leaders.mostBooked.bookings)} bookings` : "—"
        }
        secondary={
          leaders.mostBooked
            ? `${n0(leaders.mostBooked.nights)} nights spent`
            : ""
        }
        onOpen={() => leaders.mostBooked && onOpenVilla(leaders.mostBooked.name)}
      />
      <LeaderCard
        label="Least booked"
        tone="#B0CADB"
        icon={TrendingDown}
        name={leaders.leastBooked?.name}
        primary={
          leaders.leastBooked
            ? `${n0(leaders.leastBooked.bookings)} bookings`
            : "—"
        }
        secondary={
          leaders.leastBooked
            ? `${n0(leaders.leastBooked.nights)} nights spent`
            : ""
        }
        onOpen={() =>
          leaders.leastBooked && onOpenVilla(leaders.leastBooked.name)
        }
      />
      <LeaderCard
        label={
          tab === "free"
            ? "Most free value"
            : tab === "paid"
              ? "Most paid revenue"
              : "Most overall revenue"
        }
        tone={T.flame}
        icon={ArrowUpRight}
        name={leaders.mostValue?.name}
        primary={leaders.mostValue ? money(leaders.mostValue.value) : "—"}
        secondary={
          leaders.mostValue ? `${n0(leaders.mostValue.bookings)} bookings` : ""
        }
        onOpen={() => leaders.mostValue && onOpenVilla(leaders.mostValue.name)}
      />
      <LeaderCard
        label={
          tab === "free"
            ? "Least free value"
            : tab === "paid"
              ? "Least paid revenue"
              : "Least overall revenue"
        }
        tone="#85AEC7"
        icon={ArrowDownRight}
        name={leaders.leastValue?.name}
        primary={leaders.leastValue ? money(leaders.leastValue.value) : "—"}
        secondary={
          leaders.leastValue ? `${n0(leaders.leastValue.bookings)} bookings` : ""
        }
        onOpen={() => leaders.leastValue && onOpenVilla(leaders.leastValue.name)}
      />
    </div>
  );
}
