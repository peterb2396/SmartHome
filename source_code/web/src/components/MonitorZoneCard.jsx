import { FaTint, FaEye, FaSmog, FaWind } from "react-icons/fa";
import EnvironmentRow from "./EnvironmentRow";

// Read-only counterpart to ZoneCard for monitor-only zones (basement/attic —
// see server/services/monitorZones.js): temp + the same humidity/voc/co2
// range-bar rows ZoneCard renders for real zones (same EnvironmentRow
// component, same envSensors.js status thresholds), just no target/on-off/
// schedule/damper, since these have no actuator at all. Visually matches
// ZoneCard's card shell so it sits naturally in the same grid.
export default function MonitorZoneCard({ zone }) {
  const { label, temperature, environment } = zone;
  const hasReading = temperature.value != null;

  return (
    <div style={{
      background: "var(--bg-card)",
      borderRadius: 16,
      border: "1px dashed var(--border)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1.02rem" }}>{label}</span>
        <span title="Monitor only — no temperature control here" style={{
          display: "flex", alignItems: "center", gap: 4, padding: "0.25rem 0.6rem", borderRadius: 999,
          background: "var(--bg-surface-alt)", color: "var(--text-muted)", fontSize: "0.7rem", fontWeight: 700,
        }}>
          <FaEye size={10} /> Monitor
        </span>
      </div>

      {hasReading ? (
        <div style={{ fontSize: "2.6rem", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
          {temperature.value.toFixed(1)}°
        </div>
      ) : (
        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", padding: "0.5rem 0" }}>No reading</div>
      )}

      {environment && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
          <EnvironmentRow icon={FaTint} label="Humidity" unit="%" precision={0}
            min={0} max={100} value={environment.humidity.value} status={environment.humidity.status} />
          <EnvironmentRow icon={FaSmog} label="VOC" unit="" precision={0}
            min={0} max={100} value={environment.voc.value} status={environment.voc.status} />
          <EnvironmentRow icon={FaWind} label="CO2" unit=" ppm" precision={0}
            min={400} max={3000} value={environment.co2.value} status={environment.co2.status} />
        </div>
      )}

      {hasReading && !temperature.sensorOk && (
        <div style={{
          width: "100%", fontSize: "0.75rem", fontWeight: 600, color: "#9a3412",
          background: "var(--tint-warning)", border: "1px solid #fed7aa", borderRadius: 10,
          padding: "0.4rem 0.6rem", textAlign: "center",
        }}>
          Stale — hasn't reported recently
        </div>
      )}
    </div>
  );
}
