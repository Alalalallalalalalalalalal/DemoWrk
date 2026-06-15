// /frontend/src/pages/Dashboardcomponents.jsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Star, Hash, MapPin, Info } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { styles, COLORS, TOOLTIP_STYLE } from "./Dashboardstyles";

/* ─── InfoTip ────────────────────────────────────────────────── */
export function InfoTip({ text }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const iconRef = useRef(null);

  const show = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top + window.scrollY,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  if (!text) return null;

  return (
    <>
      <span
        ref={iconRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{
          display: "inline-flex",
          alignItems: "center",
          cursor: "default",
          color: visible ? "#C8976E" : "#B09880",
          transition: "color 0.15s",
          flexShrink: 0,
        }}
      >
        <Info size={13} />
      </span>
      {visible &&
        createPortal(
          <div
            style={{
              position: "absolute",
              top: pos.y - 8,
              left: pos.x,
              transform: "translate(-50%, -100%)",
              background: "#3D2B1F",
              color: "#F5EEE6",
              fontSize: 11,
              fontFamily: "sans-serif",
              lineHeight: 1.5,
              padding: "6px 10px",
              borderRadius: 6,
              whiteSpace: "normal",
              width: "max-content",
              maxWidth: 200,
              textAlign: "center",
              zIndex: 99999,
              pointerEvents: "none",
            }}
          >
            {text}
            <span
              style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "5px solid #3D2B1F",
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/* ─── StatCard ───────────────────────────────────────────────── */
export function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div style={styles.statCard}>
      <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginBottom: 2,
          }}
        >
          <p style={{ ...styles.statLabel, margin: 0 }}>{label}</p>
          <InfoTip text={hint} />
        </div>
        <p style={styles.statValue}>{value}</p>
      </div>
      <div style={{ ...styles.statIcon, flexShrink: 0 }}>
        <Icon size={18} color="#C8976E" />
      </div>
    </div>
  );
}

/* ─── ChartCard ──────────────────────────────────────────────── */
export function ChartCard({ title, description, children, span2, span3 }) {
  return (
    <div
      style={{
        ...styles.card,
        ...(span2 ? styles.span2 : {}),
        ...(span3 ? styles.span3 : {}),
      }}
    >
      <div
        style={{
          ...styles.cardHeader,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <p style={{ ...styles.cardTitle, margin: 0 }}>{title}</p>
        <InfoTip text={description} />
      </div>
      <div style={{ height: 260 }}>{children}</div>
    </div>
  );
}

/* ─── SectionLabel ───────────────────────────────────────────── */
export function SectionLabel({ children }) {
  return (
    <div style={styles.sectionLabel}>
      <span style={styles.sectionLabelLine} />
      <span style={styles.sectionLabelText}>{children}</span>
      <span style={styles.sectionLabelLine} />
    </div>
  );
}

/* ─── PieLegendCard ──────────────────────────────────────────── */
export function PieLegendCard({ title, description, data, dataKey, nameKey, colorMap = {} }) {
  const getColor = (item, index) => {
    const rawValue = String(item?.[nameKey] ?? "").trim();
    const normalizedValue = rawValue.toLowerCase();

    return (
      colorMap[rawValue] ||
      colorMap[normalizedValue] ||
      COLORS[index % COLORS.length]
    );
  };
  return (
    <div style={styles.card}>
      <div
        style={{
          ...styles.cardHeader,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <p style={{ ...styles.cardTitle, margin: 0 }}>{title}</p>
        <InfoTip text={description} />
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 16, height: 260 }}
      >
        <div style={{ flex: "0 0 160px", height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKey}
                nameKey={nameKey}
                outerRadius={75}
                innerRadius={40}
                paddingAngle={2}
              >
                {data.map((item, i) => (
                  <Cell
                    key={`${item[nameKey]}-${i}`}
                    fill={getColor(item, i)}
                    stroke="var(--dashboard-palladian)"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            maxHeight: 260,
            paddingRight: 4,
          }}
        >
          {data.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: getColor(item, i),
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "#5A3E2B",
                  fontFamily: "sans-serif",
                  lineHeight: 1.3,
                }}
              >
                {item[nameKey]}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  color: "#9C7B65",
                  fontWeight: 600,
                  fontFamily: "sans-serif",
                }}
              >
                {item[dataKey]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── RoomHighlightCard ──────────────────────────────────────── */
export function RoomHighlightCard({ most, least }) {
  return (
    <div style={styles.card}>
      <div
        style={{
          ...styles.cardHeader,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <p style={{ ...styles.cardTitle, margin: 0 }}>Room Highlights</p>
        <InfoTip text="Most & least used room types" />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginTop: 8,
        }}
      >
        <div style={styles.roomHighlight}>
          <Star size={14} color="#C8976E" style={{ flexShrink: 0 }} />
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C7B65",
                fontFamily: "sans-serif",
              }}
            >
              Most Used
            </p>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 15,
                fontWeight: 700,
                color: "#3D2B1F",
              }}
            >
              {most?.room_type ?? "—"}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "#B09880",
                fontFamily: "sans-serif",
              }}
            >
              {most?.total ?? 0} bookings
            </p>
          </div>
        </div>
        <div style={{ height: 1, background: "#E8DDD0" }} />
        <div style={styles.roomHighlight}>
          <Hash size={14} color="#9C7B65" style={{ flexShrink: 0 }} />
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C7B65",
                fontFamily: "sans-serif",
              }}
            >
              Least Used
            </p>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 15,
                fontWeight: 700,
                color: "#3D2B1F",
              }}
            >
              {least?.room_type ?? "—"}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "#B09880",
                fontFamily: "sans-serif",
              }}
            >
              {least?.total ?? 0} bookings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── DirectoryRow ───────────────────────────────────────────── */
export function DirectoryRow({ m, i }) {
  const isInHouse = m.currently_checked_in || m.in_house;
  const hasBalance = m.amount_due > 0;

  return (
    <tr style={{ background: i % 2 === 0 ? "transparent" : "#FAF6F0" }}>
      <td style={styles.td}>
        <div style={{ fontWeight: 700, color: "#3D2B1F", fontSize: 13 }}>
          {m.member_name ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: "#9C7B65", marginTop: 2 }}>
          {m.member_number ?? ""}
          {m.email ? ` · ${m.email}` : ""}
        </div>
      </td>
      <td style={styles.td}>
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 600,
            background: m.member_or_guest === "Member" ? "#3D2B1F" : "#EDE5D8",
            color: m.member_or_guest === "Member" ? "#FDFAF6" : "#7A6050",
          }}
        >
          {m.member_type ?? "—"}
        </span>
      </td>
      <td style={styles.td}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            color: m.status === "Active" ? "#3D2B1F" : "#9C7B65",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: m.status === "Active" ? "#C8976E" : "#C4B0A0",
              flexShrink: 0,
            }}
          />
          {m.status ?? "—"}
        </span>
      </td>
      <td style={styles.td}>
        {isInHouse ? (
          <span
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              border: "1px solid #C8976E",
              color: "#C8976E",
              background: "#FDF6F0",
            }}
          >
            In-house
          </span>
        ) : (
          <span style={{ color: "#C4B0A0" }}>—</span>
        )}
      </td>
      <td style={styles.td}>
        <span style={{ fontSize: 13, color: "#5A3E2B" }}>
          {m.age ?? "—"} · {m.gender ?? "—"}
        </span>
      </td>
      <td style={styles.td}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "#5A3E2B",
          }}
        >
          <MapPin size={11} color="#B09880" />
          {m.city ?? "—"}
          {m.state ? `, ${m.state}` : ""}
        </div>
        <div style={{ fontSize: 11, color: "#9C7B65", marginTop: 1 }}>
          {m.country ?? ""}
        </div>
      </td>
      <td style={styles.td}>
        <div style={{ fontSize: 13, color: "#5A3E2B" }}>
          {m.occupation ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: "#9C7B65", marginTop: 1 }}>
          {m.employer ?? ""}
        </div>
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {m.tenure_years != null ? `${m.tenure_years}y` : "—"}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {m.dependents ?? "—"}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontWeight: hasBalance ? 700 : 400,
          color: hasBalance ? "#B85C38" : "#C4B0A0",
        }}
      >
        {hasBalance ? `$${Number(m.amount_due).toLocaleString()}` : "—"}
      </td>
    </tr>
  );
}
