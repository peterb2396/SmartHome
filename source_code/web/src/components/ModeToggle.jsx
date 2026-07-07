import { FaFire, FaBolt, FaWind, FaMagic, FaWrench } from "react-icons/fa";

const OPTIONS = [
  { value: "auto",     label: "Auto",     icon: FaMagic },
  { value: "gas",      label: "Gas",      icon: FaFire },
  { value: "electric", label: "Electric", icon: FaBolt },
  { value: "air",      label: "Air",      icon: FaWind },
];

const SOURCE_LABEL = { gas: "Gas", electric: "Electric", air: "Air (Heat Pump)" };

export default function ModeToggle({ mode, activeSource, lastDecision, available, onSetMode, onSetAvailability }) {
  const servicedSources = Object.entries(available || {}).filter(([, ok]) => ok === false).map(([s]) => s);

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
            const isServiceable = value !== "auto";
            const isAvailable = !isServiceable || available?.[value] !== false;
            return (
              <div key={value} style={{ position: "relative" }}>
                <button
                  onClick={() => isAvailable && onSetMode(value)}
                  disabled={!isAvailable}
                  title={!isAvailable ? `${label} is marked as being serviced` : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "0.5rem 0.9rem", borderRadius: 999, border: "none",
                    fontWeight: 600, fontSize: "0.85rem",
                    cursor: isAvailable ? "pointer" : "not-allowed",
                    background: !isAvailable ? "#f8fafc" : active ? "#1e293b" : "#f1f5f9",
                    color: !isAvailable ? "#cbd5e1" : active ? "white" : "#64748b",
                    textDecoration: !isAvailable ? "line-through" : "none",
                    transition: "all 0.15s",
                  }}>
                  <Icon size={12} /> {label}
                </button>
                {isServiceable && (
                  <button
                    onClick={() => onSetAvailability(value, !isAvailable)}
                    title={isAvailable ? `Mark ${label} as being serviced` : `Mark ${label} available again`}
                    style={{
                      position: "absolute", top: -6, right: -6, width: 18, height: 18,
                      borderRadius: "50%", border: "2px solid white",
                      background: isAvailable ? "#cbd5e1" : "#f59e0b",
                      color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", padding: 0, fontSize: "0.5rem",
                    }}>
                    <FaWrench size={8} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
          Currently running: <strong style={{ color: "#1e293b" }}>{SOURCE_LABEL[activeSource] ?? "—"}</strong>
        </div>
      </div>

      {servicedSources.length > 0 && (
        <div style={{ fontSize: "0.78rem", color: "#b45309", fontWeight: 600 }}>
          Being serviced: {servicedSources.map(s => SOURCE_LABEL[s]).join(", ")} — excluded from Auto selection.
        </div>
      )}

      {lastDecision && (
        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
          {mode === "auto" ? "Auto-selected" : "Last cost check"} for {lastDecision.date} (avg {lastDecision.avgOutdoorTempF}°F outside):{" "}
          {Object.entries(lastDecision.costs)
            .sort((a, b) => a[1] - b[1])
            .map(([src, cost]) => `${SOURCE_LABEL[src]} $${cost.toFixed(3)}/kWh-eq${available?.[src] === false ? " (serviced)" : ""}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
