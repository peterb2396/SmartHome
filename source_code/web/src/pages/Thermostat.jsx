import { useState } from "react";
import { FaExclamationTriangle, FaCog, FaFire } from "react-icons/fa";
import { useThermostat } from "../hooks/useThermostat";
import { useBoiler } from "../hooks/useBoiler";
import ZoneCard      from "../components/ZoneCard";
import ModeToggle    from "../components/ModeToggle";
import ScheduleModal from "../components/ScheduleModal";
import RatesModal    from "../components/RatesModal";
import Spinner       from "../components/Spinner";
import PageHeader    from "../components/PageHeader";
import { CONTAINER_NARROW, CONTAINER_WIDE, GRID_COMPACT, pageContainerStyle } from "../styles/tokens";

export default function Thermostat() {
  const {
    state, loading, error, offline,
    setTarget, toggleZone, saveSchedule, setBalance, setMode, setAvailability, setRates, setSeasonThreshold, refetch,
  } = useThermostat();
  const boiler = useBoiler();
  // { system: '4zone' | '3zone', id } | null — tracks which system a given
  // schedule-modal zone id belongs to, since the two systems' zone ids can
  // otherwise collide (both have a "downstairs").
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [showRates, setShowRates] = useState(false);

  if (loading) return <Spinner message="Loading thermostat..." />;

  // Should be unreachable in practice — the hook always falls back to a
  // local/default state once loading finishes — but don't leave a blank
  // page if that assumption is ever wrong.
  if (!state) {
    return (
      <div style={{ ...pageContainerStyle(CONTAINER_NARROW), marginTop: "3rem" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--tint-danger)", border: "1px solid #fecaca", borderRadius: 12,
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

  // Which zone layout is actually live right now (see thermostat.js's
  // getActiveSystem()) — gas mode + cold-enough weather hands control to
  // the boiler's 3 zones; otherwise the air handler's 4 zones are shown.
  const is3Zone = state.activeSystem === "3zone";
  const zonesToShow = is3Zone ? (boiler.state?.zones ?? []) : state.zones;
  const zoneStep = is3Zone ? boiler.setTarget : setTarget;
  const zoneToggle = is3Zone ? boiler.toggleZone : toggleZone;

  const scheduleZone = scheduleTarget && (
    scheduleTarget.system === "3zone"
      ? (boiler.state?.zones ?? []).find(z => z.id === scheduleTarget.id)
      : state.zones.find(z => z.id === scheduleTarget.id)
  );
  const unresponsiveZones = zonesToShow.filter(z => !z.sensorOk);

  return (
    <div style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader
        title="Thermostat"
        actions={
          <button onClick={() => setShowRates(true)} aria-label="Utility rate settings" title="Utility rate settings" style={{
            width: 34, height: 34, borderRadius: "50%", border: "none",
            background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", color: "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.95rem",
          }}>
            <FaCog />
          </button>
        }
      />

      {is3Zone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem",
          background: "var(--tint-warning)", border: "1px solid #fed7aa", borderRadius: 10,
          padding: "0.65rem 1rem", color: "#9a3412", fontSize: "0.85rem", fontWeight: 600,
        }}>
          <FaFire />
          Gas boiler heating season — showing the boiler's own Great Room / Downstairs / Upstairs
          zones. The air handler's 4 zones are idle until gas mode is deselected or it warms back up
          above the season threshold (set in Settings, the gear icon above).
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`,
        gap: "1.25rem", marginBottom: "1.5rem",
      }}>
        {zonesToShow.map(zone => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            onStep={zoneStep}
            onToggle={zoneToggle}
            onOpenSchedule={id => setScheduleTarget({ system: is3Zone ? "3zone" : "4zone", id })}
            onBalanceChange={is3Zone ? undefined : setBalance}
          />
        ))}
      </div>

      {offline && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem",
          background: "var(--tint-warning)", border: "1px solid #fde68a", borderRadius: 10,
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
          background: "var(--tint-warning)", border: "1px solid #fed7aa", borderRadius: 10,
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
          costComparison={state.costComparison}
          onSetMode={setMode}
          onSetAvailability={setAvailability}
        />
      </div>

      {scheduleZone && (
        <ScheduleModal
          zone={scheduleZone}
          onClose={() => setScheduleTarget(null)}
          onSave={scheduleTarget?.system === "3zone" ? boiler.saveSchedule : saveSchedule}
        />
      )}

      {showRates && (
        <RatesModal
          rates={state.rates}
          gasSeasonThresholdF={state.gasSeasonThresholdF}
          onSaveThreshold={setSeasonThreshold}
          onClose={() => setShowRates(false)}
          onSave={setRates}
        />
      )}
    </div>
  );
}
