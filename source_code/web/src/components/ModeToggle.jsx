import { FaFire, FaBolt, FaWind, FaMagic } from "react-icons/fa";

const OPTIONS = [
  { value: "auto",     label: "Auto",     icon: FaMagic },
  { value: "gas",      label: "Gas",      icon: FaFire },
  { value: "electric", label: "Electric", icon: FaBolt },
  { value: "air",      label: "Air",      icon: FaWind },
];

const SOURCE_LABEL = { gas: "Gas", electric: "Electric", air: "Air (Heat Pump)" };

export default function ModeToggle({ mode, activeSource, lastDecision, onSetMode }) {
  return (
    <div style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1rem 1.25rem",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = mode === value;
            return (
              <button key={value} onClick={() => onSetMode(value)} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "0.5rem 0.9rem", borderRadius: 999, border: "none",
                fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
                background: active ? "#1e293b" : "#f1f5f9",
                color: active ? "white" : "#64748b",
                transition: "all 0.15s",
              }}>
                <Icon size={12} /> {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
          Currently running: <strong style={{ color: "#1e293b" }}>{SOURCE_LABEL[activeSource] ?? "—"}</strong>
        </div>
      </div>

      {lastDecision && (
        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
          {mode === "auto" ? "Auto-selected" : "Last cost check"} for {lastDecision.date} (avg {lastDecision.avgOutdoorTempF}°F outside):{" "}
          {Object.entries(lastDecision.costs)
            .sort((a, b) => a[1] - b[1])
            .map(([src, cost]) => `${SOURCE_LABEL[src]} $${cost.toFixed(3)}/kWh-eq`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
