import { colors } from "../styles/tokens";

// Standard page header — title + optional subtitle + optional right-aligned
// actions slot (buttons/icons). Replaces the 3 different hand-rolled header
// patterns that had accumulated across pages (some pages had no title at
// all, some had a subtitle, weights/sizes varied).
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.5rem",
    }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: colors.textPrimary }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: "0.9rem" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {actions}
        </div>
      )}
    </div>
  );
}
