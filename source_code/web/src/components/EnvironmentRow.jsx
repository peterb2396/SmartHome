const STATUS_COLOR = { ok: "var(--success)", warn: "var(--warning)", danger: "var(--danger)" };

// One environmental reading as a compact horizontal range indicator — icon,
// label, a colored safe/warn/danger bar, and the live value. Deliberately
// not a second ThermoDial: these are read-only, and four dials would
// roughly double the card's height for no benefit over a slim bar.
export default function EnvironmentRow({ icon: Icon, label, value, unit, status, min, max, precision = 0 }) {
  const color = status ? STATUS_COLOR[status] : "#cbd5e1";
  const hasReading = value != null;
  const pct = hasReading ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <Icon style={{ color: "var(--text-muted)", fontSize: "0.75rem", width: 13, flexShrink: 0 }} />
      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", width: 56, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        {hasReading && (
          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s, background 0.3s" }} />
        )}
      </div>
      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: hasReading ? "var(--text-primary)" : "#cbd5e1", width: 62, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
        {hasReading ? `${value.toFixed(precision)}${unit}` : "—"}
      </span>
    </div>
  );
}
