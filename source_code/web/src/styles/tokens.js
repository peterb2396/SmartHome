// Shared design tokens — the palette/sizes already in de facto use across the
// app, made explicit and importable instead of re-typed per file. Pages are
// still plain inline styles (no CSS-in-JS library here); this just gives
// them one source of truth for color/spacing/card-shape decisions instead of
// hand-copying the same hex codes and style objects everywhere.

export const colors = {
  textPrimary: "#1e293b",
  textSecondary: "#64748b",
  textMuted: "#94a3b8",
  border: "#e2e8f0",
  surface: "#f8fafc",
  surfaceAlt: "#f1f5f9",
  card: "#ffffff",
  accent: "#3b82f6",
  accentDark: "#2563eb",
  danger: "#ef4444",
  success: "#10b981",
  warning: "#fbbf24",
};

// Named container widths — pick the one that matches the page's content
// shape rather than defaulting to the widest option everywhere.
export const CONTAINER_NARROW = 700;  // single-column forms (e.g. Settings)
export const CONTAINER_MEDIUM = 900;  // list-style pages (e.g. Sensors, Maintenance)
export const CONTAINER_WIDE = 1400;   // grid/dashboard pages (e.g. Cameras, Thermostat, Console)

// Named responsive-grid minimum column widths.
export const GRID_COMPACT = 260; // small cards: zones, plugs
export const GRID_WIDE = 300;    // larger cards: cameras, category panels

export function pageContainerStyle(maxWidth = CONTAINER_WIDE) {
  return { maxWidth, margin: "0 auto", padding: "1.5rem" };
}

// The white-card look duplicated verbatim across most pages/components.
export const card = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 14,
  boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
};
