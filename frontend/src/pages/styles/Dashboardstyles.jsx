/* ─── Design tokens — Luxury Country Club ────────────────────────
   Matches the CSS variables provided (oklch values → hex approx):
   --palladian   #EEE9DF   parchment background
   --oatmeal     #C9C1B1   muted borders/surfaces
   --flame       #FFB162   Burning Flame accent
   --truffle     #A35139   Truffle Trouble secondary
   --deepblue    #2C3B4D   Blue Fantastic nav/headings
   --abyssal     #1B2632   deepest dark
──────────────────────────────────────────────────────────────── */

// Chart accent sequence — palette-aligned
export const COLORS = [
  "#FFB162", // flame
  "#A35139", // truffle
  "#013A59", // deepblue
  "#C9C1B1", // oatmeal
  "#5B8FA8",
  "#D4895A",
  "#4A6F86",
  "#E8C48A",
  "#7A5C45",
  "#3D6478",
  "#C4956A",
  "#8B9EAD",
];

export const TOOLTIP_STYLE = {
  background: "#f6f3ed",
  border: "1px solid #DDD6CA",
  borderRadius: 10,
  fontSize: 12,
  color: "#1B2632",
  boxShadow: "0 4px 20px rgba(0,0,0,0.10)",
  fontFamily: "Inter, system-ui, sans-serif",
};

// Shell tokens used by dashboard.jsx (non-Tailwind fallback for
// components that still use inline styles, e.g. recharts wrappers)
export const S = {};
export const styles = {};
