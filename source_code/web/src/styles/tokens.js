// Shared design tokens — the palette/sizes already in de facto use across the
// app, made explicit and importable instead of re-typed per file. Pages are
// still plain inline styles (no CSS-in-JS library here); this just gives
// them one source of truth for color/spacing/card-shape decisions instead of
// hand-copying the same hex codes and style objects everywhere.

// Values are CSS custom properties (see styles/index.css) so every consumer
// is automatically dark-mode-reactive with zero per-file changes — the
// browser resolves var() at paint time against whatever `data-theme` (or
// prefers-color-scheme) is currently active, inline styles included.
export const colors = {
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  border: "var(--border)",
  surface: "var(--bg-surface)",
  surfaceAlt: "var(--bg-surface-alt)",
  card: "var(--bg-card)",
  accent: "var(--accent)",
  accentDark: "var(--accent-dark)",
  danger: "var(--danger)",
  success: "var(--success)",
  warning: "var(--warning)",
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
  boxShadow: "var(--shadow-card)",
};
