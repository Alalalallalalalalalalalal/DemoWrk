// frontend/src/pages/visits/DrillPanel.jsx
//
// Drill-down panel — villa or bedroom count. Opened from the chart or the
// performance table.
//
// Endpoints used:
//   /analytics/villa-source-bookings    villa drill-down records
//   /analytics/bedroom-bookings         bedroom drill-down records
//   /analytics/villa-monthly            trend inside the villa panel

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search } from "lucide-react";
import { analyticsApi } from "../../api/analytics";
import {
  Empty,
  ExportMenu,
  Section,
  Segmented,
  ScrollShell,
  SidePanel,
  SplitBar,
  T,
  TIP_STYLE,
  FONT_DISPLAY,
  FONT_NUM,
  bedColor,
  isAbort,
  money,
  moneyShort,
  n0,
  n1,
  periodFilePart,
  periodText,
  safeFilePart,
  searchRows,
  sortRows,
} from "./VisitsRoomsShared";
import { SortHeader } from "./VisitsPerformanceTable";

// Guest records fetched per villa drill-down. The panel prints "n of m", so a
// cap reads honestly. Backend accepts up to 20000; omit to go unbounded.
const DRILL_RECORD_LIMIT = 2000;

export default function DrillPanel({
  selection,
  tab,
  params,
  period,
  onClose,
  onOpenVilla,
  villaMetrics,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trend, setTrend] = useState([]);
  const [groupBy, setGroupBy] = useState("month");
  const [sort, setSort] = useState({ col: "check_in_date", dir: "desc" });
  const [search, setSearch] = useState("");

  const isVilla = selection.kind === "villa";
  const selKey = selection.key;
  const selLabel = selection.label;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setSearch("");

    const load = isVilla
      ? analyticsApi.villaSourceBookings(
          selKey,
          {
            ...params,
            ...(tab === "paid" ? { is_free: false } : {}),
            ...(tab === "free" ? { is_free: true } : {}),
            limit: DRILL_RECORD_LIMIT,
          },
          { signal: controller.signal },
        )
      : analyticsApi.bedroomBookings(selKey, params, {
          signal: controller.signal,
        });

    load
      .then((data) => {
        if (!cancelled) setRecords(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        console.error(err);
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selKey, isVilla, tab, params]);

  useEffect(() => {
    if (!isVilla) {
      setTrend([]);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const trendParams = groupBy === "year" ? {} : params;
    analyticsApi
      .villaMonthly(
        selKey,
        { group_by: groupBy, ...trendParams },
        { signal: controller.signal },
      )
      .then((data) => {
        if (!cancelled) setTrend(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        console.error(err);
        if (!cancelled) setTrend([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selKey, isVilla, groupBy, params]);

  const amountOf = (r) => Number(r.total_amount ?? r.revenue ?? 0);

  const totals = useMemo(() => {
    const bookings = records.length;
    const nights = records.reduce((s, r) => s + Number(r.nights || 0), 0);
    const guests = records.reduce((s, r) => s + Number(r.persons || 0), 0);
    const paidRows = records.filter((r) => !r.is_free);
    const compRows = records.filter((r) => r.is_free);
    return {
      bookings,
      nights,
      revenue: paidRows.reduce((s, r) => s + amountOf(r), 0),
      compValue: compRows.reduce((s, r) => s + amountOf(r), 0),
      avgStay: bookings ? nights / bookings : null,
      avgParty: bookings ? guests / bookings : null,
      paid: paidRows.length,
      comp: compRows.length,
      hasFreeFlag: records.some((r) => r.is_free !== undefined),
    };
  }, [records]);

  const breakdown = useMemo(() => {
    const key = isVilla ? "bedroom_count" : "villa_name";
    const map = new Map();
    records.forEach((r) => {
      const k = r[key] ?? "Unknown";
      if (!map.has(k))
        map.set(k, {
          key: k,
          bookings: 0,
          nights: 0,
          value: 0,
          guests: 0,
          paid: 0,
          comp: 0,
        });
      const e = map.get(k);
      e.bookings += 1;
      e.nights += Number(r.nights || 0);
      e.guests += Number(r.persons || 0);
      e.value += amountOf(r);
      if (r.is_free) e.comp += 1;
      else e.paid += 1;
    });
    const arr = [...map.values()];
    return isVilla
      ? arr.sort((a, b) => Number(a.key) - Number(b.key))
      : arr.sort((a, b) => b.bookings - a.bookings);
  }, [records, isVilla]);

  const visibleRecords = useMemo(
    () => sortRows(searchRows(records, search), sort.col, sort.dir),
    [records, search, sort],
  );

  const exportData = visibleRecords.map((r) => ({
    Selection: selLabel,
    Guest: r.member_full_name || r.member_name || r.guest_name || "",
    "Member #": r.member_number ?? "",
    Email: r.email ?? "",
    Phone: r.phone ?? "",
    Country: r.country ?? "",
    Villa: r.villa_name ?? "",
    Bedrooms: r.bedroom_count ?? "",
    Source: r.source ?? "",
    "Paid / Comp": r.is_free === undefined ? "" : r.is_free ? "Comp" : "Paid",
    Value: amountOf(r),
    "Check In": r.check_in_date ?? "",
    "Check Out": r.check_out_date ?? "",
    Nights: r.nights ?? "",
    Guests: r.persons ?? "",
    "Conf Code": r.conf_code ?? "",
  }));

  const authoritativeVillaMetrics = isVilla ? villaMetrics : null;

  const overviewValue = Number(
    authoritativeVillaMetrics?.overall_total_rental ?? 0,
  );
  const paidValue = Number(authoritativeVillaMetrics?.paid_total_rental ?? 0);
  const freeValue = Number(authoritativeVillaMetrics?.free_total_rental ?? 0);

  return (
    <SidePanel
      eyebrow={`${isVilla ? "Villa" : "Bedroom layout"} · ${
        tab === "overall"
          ? "All bookings"
          : tab === "paid"
            ? "Paid only"
            : "Comp only"
      }`}
      title={selLabel}
      subtitle={`${periodText(period)}${
        isVilla && selection.configs?.length
          ? ` · lets as ${selection.configs.join(" / ")} bedrooms`
          : ""
      }`}
      onClose={onClose}
    >
      {isVilla ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Overall revenue", money(overviewValue)],
              ["Paid revenue", money(paidValue)],
              ["Free value", money(freeValue)],
              [
                "Bookings",
                n0(
                  authoritativeVillaMetrics?.total_unique_bookings ??
                    totals.bookings,
                ),
              ],
              [
                "Avg stay",
                totals.avgStay == null ? "—" : `${n1(totals.avgStay)} n`,
              ],
              [
                "Avg party",
                totals.avgParty == null ? "—" : n1(totals.avgParty),
              ],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  className="text-xs font-bold uppercase"
                  style={{
                    letterSpacing: "0.08em",
                    color: T.muted,
                    fontSize: 10,
                  }}
                >
                  {l}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 24,
                    color: l === "Free value" ? "#B07B33" : T.ink,
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-3 rounded-lg p-3 text-xs"
            style={{
              background: "#FFF4E6",
              color: "#8A5A20",
              border: "1px solid #F5DDBC",
              lineHeight: 1.5,
            }}
          >
            <b>Free value</b> is not cash collected. It is the rack-rate value
            of complimentary stays, including reservations marked Paid where the
            complete charged total was zero.
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                tab === "free" ? "Comp value" : "Revenue",
                money(tab === "free" ? totals.compValue : totals.revenue),
              ],
              ["Bookings", n0(totals.bookings)],
              [
                "Avg stay",
                totals.avgStay == null ? "—" : `${n1(totals.avgStay)} n`,
              ],
              [
                "Avg party",
                totals.avgParty == null ? "—" : n1(totals.avgParty),
              ],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  className="text-xs font-bold uppercase"
                  style={{
                    letterSpacing: "0.08em",
                    color: T.muted,
                    fontSize: 10,
                  }}
                >
                  {l}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 24,
                    color: T.ink,
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          {tab === "free" && (
            <div
              className="mt-3 rounded-lg p-3 text-xs"
              style={{
                background: "#FFF4E6",
                color: "#8A5A20",
                border: "1px solid #F5DDBC",
              }}
            >
              Comp stays bill nothing. The figure above is the rack value of{" "}
              {n0(totals.nights)} room nights given away.
            </div>
          )}
        </>
      )}

      {breakdown.length > 0 && (
        <Section
          title={
            isVilla
              ? "By bedroom layout"
              : `Villas at this size (${breakdown.length})`
          }
        >
          {isVilla ? (
            <div style={{ display: "grid", gap: 8 }}>
              {breakdown.map((c) => (
                <div
                  key={c.key}
                  style={{
                    background: T.card,
                    border: `1px solid ${T.line}`,
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="flex items-center gap-2"
                      style={{ color: T.ink, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: bedColor(Number(c.key)),
                          display: "inline-block",
                        }}
                      />
                      {c.key === "Unknown"
                        ? "Bedroom count not set"
                        : `${c.key} bedroom`}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT_NUM,
                        color: T.deep,
                        fontSize: 13,
                      }}
                    >
                      {money(c.value)}
                    </span>
                  </div>
                  <div
                    className="flex flex-wrap"
                    style={{ gap: "4px 18px", fontSize: 12, color: T.slate }}
                  >
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n0(c.bookings)}
                      </b>{" "}
                      bookings
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n0(c.nights)}
                      </b>{" "}
                      nights
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n1(c.nights / (c.bookings || 1))}
                      </b>{" "}
                      avg stay
                    </span>
                    <span>
                      <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                        {n1(c.guests / (c.bookings || 1))}
                      </b>{" "}
                      avg party
                    </span>
                    {tab === "overall" && totals.hasFreeFlag && (
                      <span>
                        <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                          {n0(c.paid)}
                        </b>{" "}
                        paid ·{" "}
                        <b style={{ fontFamily: FONT_NUM, color: T.ink }}>
                          {n0(c.comp)}
                        </b>{" "}
                        comp
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ScrollShell maxHeight={260}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <tbody>
                  {breakdown.map((v) => (
                    <tr
                      key={v.key}
                      className="vr-row"
                      onClick={() => onOpenVilla(v.key)}
                      style={{
                        borderTop: `1px solid ${T.line}`,
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "9px 12px", color: T.ink }}>
                        {v.key}
                      </td>
                      <td
                        style={{
                          padding: "9px 8px",
                          textAlign: "right",
                          color: T.slate,
                          fontFamily: FONT_NUM,
                        }}
                      >
                        {n0(v.bookings)}
                      </td>
                      <td
                        style={{
                          padding: "9px 12px",
                          textAlign: "right",
                          color: T.deep,
                          fontFamily: FONT_NUM,
                        }}
                      >
                        {moneyShort(v.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollShell>
          )}
        </Section>
      )}

      {isVilla && (
        <Section
          title={`Bookings by ${groupBy === "year" ? "year" : "month"}`}
          action={
            <Segmented
              size="sm"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          }
        >
          <div
            style={{
              background: T.card,
              border: `1px solid ${T.line}`,
              borderRadius: 14,
              padding: 12,
              height: 220,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trend}
                margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke={T.lineSoft} />
                <XAxis
                  dataKey={groupBy === "year" ? "year" : "month"}
                  tick={{ fill: T.slate, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: T.slate, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={TIP_STYLE}
                  cursor={{ fill: "rgba(0,58,89,0.05)" }}
                />
                <Bar dataKey="bookings" fill={T.deep} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {groupBy === "year" && (
            <p className="mt-2" style={{ fontSize: 12, color: T.slate }}>
              Yearly view ignores the page date period so the trend stays
              comparable.
            </p>
          )}
        </Section>
      )}

      {tab === "overall" &&
        totals.hasFreeFlag &&
        totals.paid + totals.comp > 0 && (
          <Section title="Paid vs comp split">
            <div
              style={{
                background: T.card,
                border: `1px solid ${T.line}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <SplitBar
                leftLabel="Paid"
                left={totals.paid}
                rightLabel="Comp"
                right={totals.comp}
              />
            </div>
          </Section>
        )}

      <Section
        title={`Guest records · ${n0(visibleRecords.length)} of ${n0(records.length)}`}
        action={
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: T.card, border: `1px solid ${T.line}` }}
            >
              <Search size={13} style={{ color: T.slate }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records"
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
              filenameBase={`${safeFilePart(selLabel)}_records_${safeFilePart(periodFilePart(period))}`}
              disabled={loading || !exportData.length}
            />
          </div>
        }
      >
        {loading ? (
          <Empty>Loading booking records…</Empty>
        ) : !records.length ? (
          <Empty>
            No bookings match the current period and payment filters.
          </Empty>
        ) : (
          <ScrollShell maxHeight={420}>
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
                    ["Guest", "member_full_name", "left"],
                    isVilla
                      ? ["Beds", "bedroom_count", "right"]
                      : ["Villa", "villa_name", "left"],
                    ["Check in", "check_in_date", "right"],
                    ["Nights", "nights", "right"],
                    ["Party", "persons", "right"],
                    isVilla ? ["Source", "source", "left"] : null,
                    ["Value", isVilla ? "total_amount" : "revenue", "right"],
                  ]
                    .filter(Boolean)
                    .map(([label, col, align]) => (
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
                {visibleRecords.map((r, i) => (
                  <tr
                    key={r.conf_code ?? i}
                    className="vr-row"
                    style={{ borderTop: `1px solid ${T.lineSoft}` }}
                  >
                    <td
                      style={{
                        padding: "9px 10px",
                        color: T.ink,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.member_full_name ||
                        r.member_name ||
                        r.guest_name ||
                        "—"}
                      <div style={{ color: T.slate, fontSize: 10 }}>
                        #{r.member_number ?? "—"} · {r.conf_code ?? "—"}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: isVilla ? "right" : "left",
                        color: T.muted,
                        fontFamily: isVilla ? FONT_NUM : "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isVilla
                        ? (r.bedroom_count ?? "—")
                        : (r.villa_name ?? "—")}
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
                      {r.check_in_date ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(r.nights)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        color: T.ink,
                        fontFamily: FONT_NUM,
                      }}
                    >
                      {n0(r.persons)}
                    </td>
                    {isVilla && (
                      <td
                        style={{
                          padding: "9px 10px",
                          color: T.muted,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.source ?? "—"}
                      </td>
                    )}
                    <td
                      style={{
                        padding: "9px 10px",
                        textAlign: "right",
                        fontFamily: FONT_NUM,
                        color: r.is_free ? "#B07B33" : T.deep,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {money(amountOf(r))}
                      {r.is_free && (
                        <div style={{ fontSize: 9, color: T.slate }}>comp</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollShell>
        )}
        {isVilla && records.length >= DRILL_RECORD_LIMIT && (
          <p className="mt-2" style={{ fontSize: 12, color: "#B07B33" }}>
            Showing the {n0(DRILL_RECORD_LIMIT)} most recent bookings. Narrow
            the date period to see earlier stays.
          </p>
        )}
        {!isVilla && (
          <p className="mt-2" style={{ fontSize: 12, color: T.slate }}>
            Bedroom records come from /bedroom-bookings, which does not carry
            the paid/comp flag — this list shows every payment type. Open a
            villa for the split.
          </p>
        )}
      </Section>
    </SidePanel>
  );
}
