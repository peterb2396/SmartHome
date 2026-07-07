import { FaCog, FaExclamationTriangle } from "react-icons/fa";
import ThermoDial from "./ThermoDial";

const STEP = 1;
const SAFETY_MIN = 60;
const SAFETY_MAX = 75;

export default function ZoneCard({ zone, onStep, onOpenSchedule }) {
  const {
    id, label, target, currentTemp: current, calling, coolCalling,
    safety = "normal", windowOpen,
  } = zone;
  const inSafetyOverride = safety !== "normal";

  return (
    <div style={{
      background: inSafetyOverride
        ? "linear-gradient(160deg, #fef2f2 0%, white 60%)"
        : calling ? "linear-gradient(160deg, #fff7ed 0%, white 60%)"
        : coolCalling ? "linear-gradient(160deg, #eff6ff 0%, white 60%)"
        : "white",
      borderRadius: 16,
      border: `1px solid ${inSafetyOverride ? "#fca5a5" : calling ? "#fed7aa" : coolCalling ? "#bfdbfe" : "#e2e8f0"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
      transition: "all 0.25s",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "1.02rem" }}>{label}</span>
        <button onClick={() => onOpenSchedule(id)} aria-label={`${label} schedule`} style={{
          width: 30, height: 30, borderRadius: "50%", border: "none",
          background: "#f1f5f9", color: "#94a3b8", display: "flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.8rem",
        }}>
          <FaCog />
        </button>
      </div>

      <ThermoDial
        current={current}
        target={target}
        calling={calling}
        coolCalling={coolCalling}
        safety={safety}
        onStep={delta => onStep(id, Math.max(SAFETY_MIN, Math.min(SAFETY_MAX, target + delta * STEP)))}
        onCommit={value => onStep(id, Math.max(SAFETY_MIN, Math.min(SAFETY_MAX, value)))}
      />

      {inSafetyOverride && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10,
          padding: "0.5rem 0.7rem", color: "#b91c1c", fontSize: "0.78rem", fontWeight: 700,
        }}>
          <FaExclamationTriangle />
          {safety === "below-min"
            ? `Below ${SAFETY_MIN}°F — forcing heat to prevent freezing.`
            : `Above ${SAFETY_MAX}°F — forcing cooling to prevent damage.`}
        </div>
      )}

      {!inSafetyOverride && windowOpen && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
          padding: "0.5rem 0.7rem", color: "#b91c1c", fontSize: "0.78rem", fontWeight: 600,
        }}>
          <FaExclamationTriangle />
          Window open in this zone
        </div>
      )}
    </div>
  );
}
