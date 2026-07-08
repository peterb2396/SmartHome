import { FaFire, FaBolt, FaWind, FaMagic, FaWrench } from "react-icons/fa";

const OPTIONS = [
  { value: "auto",     label: "Auto",     icon: FaMagic },
  { value: "gas",      label: "Gas",      icon: FaFire },
  { value: "electric", label: "Electric", icon: FaBolt },
  { value: "air",      label: "Air",      icon: FaWind },
];
const SOURCES = ["gas", "electric", "air"];
const SOURCE_LABEL = { gas: "Gas", electric: "Electric", air: "Air (Heat Pump)" };

export default function ModeToggle({ mode, activeSource, lastDecision, available, crossover, costComparison, onSetMode, onSetAvailability }) {
  const servicedSources = SOURCES.filter(s => available?.[s] === false);

  return (
    <div style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1rem 1.25rem",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <style>{`
        .mode-pills { display: flex; gap: 6px; }
        .mode-select { display: none; }
        @media (max-width: 560px) {
          .mode-pills { display: none; }
          .mode-select { display: block; width: 100%; }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="mode-pills">
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = mode === value;
            const isAvailable = value === "auto" || available?.[value] !== false;
            return (
              <button
                key={value}
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
            );
          })}
        </div>

        <select
          className="mode-select"
          value={mode}
          onChange={e => onSetMode(e.target.value)}
          style={{
            padding: "0.55rem 0.7rem", borderRadius: 10, border: "1px solid #e2e8f0",
            background: "#f8fafc", fontWeight: 600, fontSize: "0.9rem", color: "#1e293b",
          }}>
          {OPTIONS.map(({ value, label }) => {
            const disabled = value !== "auto" && available?.[value] === false;
            return (
              <option key={value} value={value} disabled={disabled}>
                {label}{disabled ? " (servicing)" : ""}
              </option>
            );
          })}
        </select>

        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
          Currently running: <strong style={{ color: "#1e293b" }}>{SOURCE_LABEL[activeSource] ?? "—"}</strong>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Equipment status:</span>
        {SOURCES.map(s => {
          const isServiced = available?.[s] === false;
          return (
            <button
              key={s}
              onClick={() => onSetAvailability(s, isServiced)}
              title={isServiced ? `Mark ${SOURCE_LABEL[s]} available again` : `Mark ${SOURCE_LABEL[s]} as being serviced`}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "0.3rem 0.65rem", borderRadius: 999,
                border: isServiced ? "1px solid #fbbf24" : "1px solid #e2e8f0",
                background: isServiced ? "#fffbeb" : "#f8fafc",
                color: isServiced ? "#b45309" : "#64748b",
                fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
              }}>
              <FaWrench size={9} />
              {SOURCE_LABEL[s]}: {isServiced ? "Servicing" : "OK"}
            </button>
          );
        })}
      </div>

      {servicedSources.length > 0 && (
        <div style={{ fontSize: "0.78rem", color: "#b45309", fontWeight: 600 }}>
          Being serviced: {servicedSources.map(s => SOURCE_LABEL[s]).join(", ")} — excluded from Auto selection.
        </div>
      )}

      {/* {lastDecision && (
        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
          {mode === "auto" ? "Auto-selected" : "Last cost check"} for {lastDecision.date} (avg {lastDecision.avgOutdoorTempF}°F outside):{" "}
          {Object.entries(lastDecision.costs)
            .sort((a, b) => a[1] - b[1])
            .map(([src, cost]) => `${SOURCE_LABEL[src]} $${cost.toFixed(3)}/kWh-eq${available?.[src] === false ? " (serviced)" : ""}`)
            .join(" · ")}
        </div>
      )} */}

      {crossover && (
        <div style={{
          fontSize: "0.78rem", color: "#334155", background: "#f8fafc",
          border: "1px solid #e2e8f0", borderRadius: 10, padding: "0.5rem 0.7rem",
        }}>
          <strong>Crossover: {crossover.tempF}°F</strong> at your current rates — above it,{" "}
          <strong>{SOURCE_LABEL[crossover.warmerIsCheaper]}</strong> is cheaper; below it,{" "}
          <strong>{SOURCE_LABEL[crossover.colderIsCheaper]}</strong> is cheaper.
          {crossover.outOfRange && (
            <div style={{ marginTop: 4, color: "#94a3b8" }}>
              This is past the {crossover.outOfRange === "above" ? "warmest" : "coldest"} weather this model
              covers ({crossover.modelEdge}°F, where the heat pump's real-world efficiency{" "}
              {crossover.outOfRange === "above" ? "plateaus" : "bottoms out"}) — treat it as an estimate, not a
              precise number.
            </div>
          )}
          {costComparison && costComparison.pctMoreExpensive > 0 && (
            <div style={{ marginTop: 4 }}>
              Right now (~{costComparison.avgOutdoorTempF}°F out): <strong>{SOURCE_LABEL[costComparison.pricier]}</strong> would
              cost <strong>{costComparison.pctMoreExpensive}% more</strong> than <strong>{SOURCE_LABEL[costComparison.cheaper]}</strong> (ex:
              ${costComparison.cheaperExampleCost} for {SOURCE_LABEL[costComparison.cheaper]}, ${costComparison.pricierExampleCost} for {SOURCE_LABEL[costComparison.pricier]}).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
