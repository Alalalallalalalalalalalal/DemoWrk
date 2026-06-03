/* ─── Design tokens ──────────────────────────────────────────── */
export const COLORS = [
  "#C8976E",
  "#5B9EAD",
  "#2D5F6E",
  "#C4A24D",
  "#8B6B4A",
  "#7ABCCC",
  "#A0522D",
  "#4E8098",
  "#D4956A",
  "#6B8E6E",
  "#9B7B9A",
  "#C9A96E",
];

export const TOOLTIP_STYLE = {
  background: "#FDFAF6",
  border: "1px solid #E8DDD0",
  borderRadius: 10,
  fontSize: 12,
  color: "#3D2B1F",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
};

/* ─── Styles ─────────────────────────────────────────────────── */
export const styles = {
  root: {
    minHeight: "100vh",
    background: "#F5EFE6",
    fontFamily: "'Georgia', 'Times New Roman', serif",
    display: "flex",
  },
  header: {
    background: "#FDFAF6",
    borderBottom: "1px solid #E8DDD0",
    backdropFilter: "blur(8px)",
  },
  headerInner: {
    maxWidth: 1280,
    margin: "0 auto",
    padding: "18px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBrand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "#3D2B1F",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: "#3D2B1F",
    letterSpacing: "0.02em",
  },
  headerSub: {
    margin: 0,
    fontSize: 11,
    color: "#9C7B65",
    fontFamily: "sans-serif",
  },
  liveBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#F5EFE6",
    border: "1px solid #E8DDD0",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 11,
    color: "#7A6050",
    fontFamily: "sans-serif",
  },
  main: {
    flex: 1,
    maxWidth: 1280,
    margin: "0 auto",
    padding: "28px 28px 60px",
  },

  sideNav: {
    position: "fixed",
    left: 12, // ← was 0
    top: 12, // ← was 0
    bottom: 12, // ← was 0
    width: 105,
    background: "#6C504A",
    borderRadius: 28, // ← replaces the two half-rounded props
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 80,
    gap: 24,
    // ← boxShadow removed
    zIndex: 100,
  },

  sideNavButton: {
    width: 48,
    height: 48,

    border: "none",
    background: "transparent",

    borderRadius: "50%",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    color: "#F4EBDD",
    cursor: "pointer",

    transition: "all .2s ease",
  },

  sideNavButtonActive: {
    background: "#4FC4D3",
    color: "#FFFFFF",

    transform: "scale(1.05)",

    boxShadow: "0 4px 12px rgba(79,196,211,.35)",
  },

  sideNavButtonInactive: {
    background: "transparent",
    color: "#F4EBDD",
  },
  tabContent: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 14,
  },
  statCard: {
    background: "#FDFAF6",
    border: "1px solid #E8DDD0",
    borderRadius: 14,
    padding: "20px 22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
    minWidth: 0,
    overflow: "hidden",
  },
  statLabel: {
    margin: 0,
    fontSize: 10,
    fontFamily: "sans-serif",
    fontWeight: 600,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: "#9C7B65",
  },
  statValue: {
    margin: "6px 0 4px",
    fontSize: 24,
    fontWeight: 700,
    color: "#3D2B1F",
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    wordBreak: "break-word",
    overflowWrap: "break-word",
  },
  statHint: {
    margin: 0,
    fontSize: 11,
    color: "#B09880",
    fontFamily: "sans-serif",
  },
  statIcon: {
    background: "#F5EFE6",
    borderRadius: 9,
    padding: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
  },
  card: {
    background: "#FDFAF6",
    border: "1px solid #E8DDD0",
    borderRadius: 14,
    padding: "20px 22px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
  },
  span2: { gridColumn: "span 2" },
  span3: { gridColumn: "span 3" },
  cardHeader: { marginBottom: 16 },
  cardTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "#3D2B1F",
  },
  cardDesc: {
    margin: "3px 0 0",
    fontSize: 11,
    color: "#9C7B65",
    fontFamily: "sans-serif",
  },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "4px 0",
  },
  sectionLabelLine: {
    flex: 1,
    height: 1,
    background: "#E8DDD0",
  },
  sectionLabelText: {
    fontSize: 10,
    fontFamily: "sans-serif",
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#B09880",
    whiteSpace: "nowrap",
  },
  searchInput: {
    width: "100%",
    padding: "9px 12px 9px 34px",
    border: "1px solid #E8DDD0",
    borderRadius: 9,
    fontSize: 13,
    fontFamily: "sans-serif",
    color: "#3D2B1F",
    background: "#FDFAF6",
    outline: "none",
    boxSizing: "border-box",
  },
  roomHighlight: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 0",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    fontFamily: "sans-serif",
  },
  th: {
    textAlign: "left",
    padding: "10px 14px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#9C7B65",
    borderBottom: "2px solid #E8DDD0",
  },
  td: {
    padding: "10px 14px",
    color: "#5A3E2B",
    borderBottom: "1px solid #F0E8DE",
    fontSize: 13,
  },
};

const INFOTIP_STYLE = `
.infotip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: default;
}
.infotip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #D9CEC3;
  color: #7A5C45;
  font-size: 9px;
  font-weight: 700;
  font-family: sans-serif;
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.15s;
}
.infotip-wrap:hover .infotip-icon {
  background: #C8976E;
  color: #fff;
}
.infotip-bubble {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: #3D2B1F;
  color: #F5EEE6;
  font-size: 11px;
  font-family: sans-serif;
  line-height: 1.45;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
  max-width: 220px;
  white-space: normal;
  text-align: center;
  z-index: 99;
  transition: opacity 0.15s 0.1s;
}
.infotip-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #3D2B1F;
}
.infotip-wrap:hover .infotip-bubble {
  visibility: visible;
  opacity: 1;
}
`;

export const S = {
  shell: {
    display: "flex",
    minHeight: "100vh",
    background: "#F9F5EE",
    fontFamily: "'Georgia', serif",
    padding: "12px",
    gap: "12px",
    boxSizing: "border-box",
  },

  sidebar: {
    width: 220,
    minWidth: 220,
    background: "#2A1F16",
    display: "flex",
    flexDirection: "column",
    padding: "32px 0 24px",
    position: "sticky",
    top: "12px",
    height: "calc(100vh - 24px)",
    overflowY: "auto",
    borderRadius: "18px",
    flexShrink: 0,
  },

  sidebarLogo: {
    padding: "0 24px 32px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    marginBottom: 16,
  },

  logoText: {
    fontFamily: "'Georgia', serif",
    fontSize: 15,
    fontWeight: 700,
    color: "#E8C99A",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },

  logoSub: {
    fontSize: 10,
    color: "rgba(232,201,154,0.5)",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginTop: 2,
  },

  navItem: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 16px",
    margin: "2px 8px",
    cursor: "pointer",
    transition: "background 0.15s",
    borderRadius: 12,
    background: active ? "#3D2B1F" : "transparent",
  }),

  navIcon: (active) => ({
    color: active ? "#C8976E" : "rgba(255,255,255,0.45)",
    flexShrink: 0,
  }),

  navLabel: (active) => ({
    fontSize: 13,
    fontFamily: "sans-serif",
    fontWeight: active ? 600 : 400,
    color: active ? "#E8C99A" : "rgba(255,255,255,0.5)",
    letterSpacing: "0.01em",
  }),

  sidebarFooter: {
    marginTop: "auto",
    padding: "16px 24px 0",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },

  footerText: {
    fontSize: 10,
    color: "rgba(255,255,255,0.25)",
    fontFamily: "sans-serif",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  content: {
    flex: 1,
    padding: "36px 32px",
    overflowY: "auto",
    minWidth: 0,
  },

  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#2A1F16",
    marginBottom: 4,
    fontFamily: "'Georgia', serif",
    letterSpacing: "-0.01em",
  },

  pageSub: {
    fontSize: 13,
    color: "#A08070",
    fontFamily: "sans-serif",
    marginBottom: 28,
  },
};
