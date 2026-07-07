import { useState } from "react";
import { FaExclamationTriangle, FaCog } from "react-icons/fa";
import { useThermostat } from "../hooks/useThermostat";
import ZoneCard      from "../components/ZoneCard";
import ModeToggle    from "../components/ModeToggle";
import ScheduleModal from "../components/ScheduleModal";
import RatesModal    from "../components/RatesModal";
import Spinner       from "../components/Spinner";

export default function Thermostat() {
  const { state, loading, error, offline, setTarget, saveSchedule, setMode, setAvailability, setRates, refetch } = useThermostat();
  const [scheduleZoneId, setScheduleZoneId] = useState(null);
  const [showRates, setShowRates] = useState(false);

  if (loading) return <Spinner message="Loading thermostat..." />;

  // Should be unreachable in practice — the hook always falls back to a
  // local/default state once loading finishes — but don't leave a blank
  // page if that assumption is ever wrong.
  if (!state) {
    return (
      <div style={{ maxWidth: 700, margin: "3rem auto", padding: "1.5rem" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
          padding: "1rem 1.25rem", color: "#b91c1c",
        }}>
          <FaExclamationTriangle size={18} />
          <div>
            <div style={{ fontWeight: 700 }}>Can't reach the thermostat service</div>
            <div style={{ fontSize: "0.85rem", marginTop: 2 }}>{error}</div>
          </div>
          <button onClick={refetch} style={{
            marginLeft: "auto", padding: "0.5rem 1rem", borderRadius: 8, border: "none",
            background: "#b91c1c", color: "white", fontWeight: 600, cursor: "pointer",
          }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const scheduleZone = state.zones.find(z => z.id === scheduleZoneId);
  const unresponsiveZones = state.zones.filter(z => !z.sensorOk);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 1rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>Thermostat</h1>
        <button onClick={() => setShowRates(true)} aria-label="Utility rate settings" title="Utility rate settings" style={{
          width: 34, height: 34, borderRadius: "50%", border: "none",
          background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", color: "#64748b",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.95rem",
        }}>
          <FaCog />
        </button>
      </div>

      {offline && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem",
          background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10,
          padding: "0.65rem 1rem", color: "#92400e", fontSize: "0.85rem", fontWeight: 600,
        }}>
          <FaExclamationTriangle />
          Can't reach the thermostat backend ({error}) — you can still set up zones, targets, and
          schedules below; they're saved in this browser and will sync once the backend is live.
          <button onClick={refetch} style={{
            marginLeft: "auto", padding: "0.35rem 0.8rem", borderRadius: 8, border: "none",
            background: "#92400e", color: "white", fontWeight: 600, cursor: "pointer", fontSize: "0.8rem",
          }}>
            Retry
          </button>
        </div>
      )}

      {unresponsiveZones.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem",
          background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10,
          padding: "0.65rem 1rem", color: "#9a3412", fontSize: "0.85rem", fontWeight: 600,
        }}>
          <FaExclamationTriangle />
          Not receiving data from: {unresponsiveZones.map(z => z.label).join(", ")}
          {" "}{unresponsiveZones.length === 1 ? "sensor" : "sensors"}. Those zones won't call for heat or cooling until the hardware is wired up.
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <ModeToggle
          mode={state.mode}
          activeSource={state.activeSource}
          lastDecision={state.lastDecision}
          available={state.available}
          crossover={state.crossover}
          onSetMode={setMode}
          onSetAvailability={setAvailability}
        />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "1.25rem",
      }}>
        {state.zones.map(zone => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            onStep={setTarget}
            onOpenSchedule={setScheduleZoneId}
          />
        ))}
      </div>

      {scheduleZone && (
        <ScheduleModal
          zone={scheduleZone}
          onClose={() => setScheduleZoneId(null)}
          onSave={saveSchedule}
        />
      )}

      {showRates && (
        <RatesModal
          rates={state.rates}
          onClose={() => setShowRates(false)}
          onSave={setRates}
        />
      )}
    </div>
  );
}
