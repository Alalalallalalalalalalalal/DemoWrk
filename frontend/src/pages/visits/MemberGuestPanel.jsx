// frontend/src/pages/visits/MemberGuestPanel.jsx
//
// Member vs guest panel — opened from the "Total bookings" card.
//
// Endpoint used: /analytics/booked-people

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { analyticsApi } from "../../api/analytics";
import {
  Empty,
  ExportMenu,
  FONT_DISPLAY,
  FONT_NUM,
  InfoTip,
  ScrollShell,
  Section,
  Segmented,
  SidePanel,
  SplitBar,
  T,
  isAbort,
  n0,
  periodFilePart,
  periodText,
  safeFilePart,
  searchRows,
  sortRows,
} from "./VisitsRoomsShared";
import { SortHeader } from "./VisitsPerformanceTable";

export default function MemberGuestPanel({ params, period, onClose }) {
  const [data, setData] = useState({ members: [], guests: [] });
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("members");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ col: "bookings", dir: "desc" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled([
      analyticsApi.bookedPeople("members", params, {
        signal: controller.signal,
      }),
      analyticsApi.bookedPeople("guests", params, {
        signal: controller.signal,
      }),
    ])
      .then(([m, g]) => {
        if (cancelled) return;
        setData({
          members:
            m.status === "fulfilled" && Array.isArray(m.value) ? m.value : [],
          guests:
            g.status === "fulfilled" && Array.isArray(g.value) ? g.value : [],
        });
        if (m.status === "rejected" && !isAbort(m.reason))
          console.error(m.reason);
        if (g.status === "rejected" && !isAbort(g.reason))
          console.error(g.reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [params]);

  const roll = (rows) =>
    rows.reduce(
      (a, r) => ({
        accounts: a.accounts + 1,
        bookings: a.bookings + Number(r.bookings || 0),
        nights: a.nights + Number(r.nights || 0),
      }),
      { accounts: 0, bookings: 0, nights: 0 },
    );

  const memberTotals = useMemo(() => roll(data.members), [data.members]);
  const guestTotals = useMemo(() => roll(data.guests), [data.guests]);

  const rows = kind === "members" ? data.members : data.guests;
  const visible = useMemo(
    () => sortRows(searchRows(rows, search), sort.col, sort.dir),
    [rows, search, sort],
  );

  const exportData = visible.map((p) => ({
    Account: kind === "members" ? "Member" : "Guest",
    Name: p.member_full_name || p.member_name || p.folio_guest_name || "",
    "Member #": p.member_number ?? "",
    "Member Type": p.member_type ?? "",
    Email: p.email ?? "",
    Phone: p.phone ?? "",
    Country: p.country ?? "",
    State: p.state ?? "",
    Bookings: p.bookings ?? "",
    Nights: p.nights ?? "",
    "First In": p.first_check_in ?? "",
    "Last Out": p.last_check_out ?? "",
  }));

  return (
    <SidePanel
      eyebrow="Total bookings · member vs guest"
      title="Who booked"
      subtitle={periodText(period)}
      onClose={onClose}
    >
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.line}`,
          borderRadius: 16,
          padding: 18,
        }}
      >
        <SplitBar
          leftLabel="Member bookings"
          left={memberTotals.bookings}
          rightLabel="Guest bookings"
          right={guestTotals.bookings}
          leftColor={T.deep}
          rightColor={T.flame}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Members", memberTotals, T.deep],
            ["Guests", guestTotals, T.flame],
          ].map(([label, t, tone]) => (
            <div
              key={label}
              style={{
                border: `1px solid ${T.line}`,
                borderLeft: `3px solid ${tone}`,
                borderRadius: 12,
                padding: 14,
                background: T.mist,
              }}
            >
              <div
                className="text-xs font-bold uppercase"
                style={{
                  letterSpacing: "0.09em",
                  color: T.muted,
                  fontSize: 10,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 26,
                  color: T.ink,
                  marginTop: 4,
                }}
              >
                {n0(t.bookings)}{" "}
                <span style={{ fontSize: 13, color: T.slate }}>bookings</span>
              </div>
              <div style={{ fontSize: 12, color: T.link, marginTop: 2 }}>
                {n0(t.accounts)} accounts · {n0(t.nights)} nights
              </div>
            </div>
          ))}
        </div>
        <p
          className="mt-3 flex items-center gap-1"
          style={{ fontSize: 12, color: T.slate }}
        >
          Bookings without a member number can't be attributed to either side.
          <InfoTip id="split" />
        </p>
      </div>

      <Section
        title={`${kind === "members" ? "Member" : "Guest"} accounts · ${n0(visible.length)} of ${n0(
          rows.length,
        )}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setSearch("");
              }}
              options={[
                { value: "members", label: "Members" },
                { value: "guests", label: "Guests" },
              ]}
            />
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: T.card, border: `1px solid ${T.line}` }}
            >
              <Search size={13} style={{ color: T.slate }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people"
                className="vr-focus"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  width: 130,
                  fontSize: 12,
                  color: T.ink,
                }}
              />
            </div>
            <ExportMenu
              rows={exportData}
              filenameBase={`${kind}_booked_${safeFilePart(periodFilePart(period))}`}
              disabled={loading || !exportData.length}
            />
          </div>
        }
      >
        {loading ? (
          <Empty>Loading people…</Empty>
        ) : !rows.length ? (
          <Empty>No {kind} booked in this period.</Empty>
        ) : (
          <ScrollShell maxHeight={460}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                minWidth: 720,
              }}
            >
              <thead>
                <tr>
                  {[
                    ["Name", "member_full_name", "left"],
                    ["Member #", "member_number", "right"],
                    ["Type", "member_type", "left"],
                    ["Bookings", "bookings", "right"],
                    ["Nights", "nights", "right"],
                    ["First in", "first_check_in", "right"],
                    ["Last out", "last_check_out", "right"],
                  ].map(([label, col, align]) => (
                    <th
                      key={col}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                        background: T.card,
                        borderBottom: `1px solid ${T.line}`,
                        padding: "9px 10px",
                      }}
                    >
                      <SortHeader
                        label={label}
                        col={col}
                        sort={sort}
                        setSort={setSort}
                        align={align}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <tr
                    key={p.member_number ?? i}
                    className="vr-row"
                    style={{ borderTop: `1px solid ${T.lineSoft}` }}
                  >
                    <td style={{ padding: "9px 10px", color: T.ink }}>
                      {p.member_full_name ||
                        p.member_name ||
                        p.folio_guest_name ||
                        "Unknown"}
                      {p.email && (
                        <div style={{ color: T.slate, fontSize: 10 }}>
                          {p.email}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {p.member_number ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        color: p.member_type ? T.muted : "#B07B33",
                        fontWeight: p.member_type ? 400 : 700,
                      }}
                    >
                      {p.member_type ?? "Not set"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(p.bookings)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(p.nights)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.first_check_in ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.muted,
                        fontFamily: FONT_NUM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.last_check_out ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollShell>
        )}
      </Section>
    </SidePanel>
  );
}
