import { useState } from "react";

const KIND_OPTIONS = [
  { value: "thermostat", label: "Thermostat zone (BME680 + SCD41)" },
  { value: "monitor",    label: "Monitor-only zone (temp + humidity)" },
  { value: "dial",       label: "Wall dial (thermostat + sound control)" },
  { value: "zoneAudio",  label: "Zone audio hardware (speaker amp)" },
  { value: "other",      label: "Other" },
];

// Thermostat zone and sound zone are separate id spaces (HVAC zoning
// follows ductwork, audio zoning follows room-by-room speaker wiring —
// see server/services/sound.js's header) — which zone picker(s) show
// depends on the node kind: a dial can drive both, a zoneAudio node only
// ever needs a sound zone (reusing the single zoneId field for it, same
// as this modal already did before sound zones existed), a
// thermostat/monitor node only ever needs a thermostat zone.
function needsThermostatZone(kind) {
  return kind === "thermostat" || kind === "monitor" || kind === "dial";
}
function needsSoundZone(kind) {
  return kind === "dial" || kind === "zoneAudio";
}

// Naming/setup portal for a node discovered on the RS485 bus. Fully wired
// to the real node-registry API.
export default function NodeSetupModal({ node, zones, soundZones, onClose, onSave }) {
  const [name, setName] = useState(node.name || "");
  const [kind, setKind] = useState(node.kind || "thermostat");
  const [zoneId, setZoneId] = useState(node.zoneId || "");
  const [soundZoneId, setSoundZoneId] = useState(node.soundZoneId || "");

  function handleSave() {
    if (!name.trim()) return;
    onSave(node.uniqueId, {
      name: name.trim(),
      kind,
      zoneId: needsThermostatZone(kind) || kind === "zoneAudio" ? (zoneId || null) : null,
      soundZoneId: kind === "dial" ? (soundZoneId || null) : null,
    });
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-card)", borderRadius: 16, maxWidth: 440, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.2)", overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, var(--accent), var(--accent-dark))",
          padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Set Up Node</h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <p style={{ margin: "0 0 1.25rem", color: "var(--text-muted)", fontSize: "0.78rem", fontFamily: "monospace" }}>
            {node.uniqueId}
          </p>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Name</label>
            <input
              type="text" autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Office Thermostat Node"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Node type</label>
            <select value={kind} onChange={e => setKind(e.target.value)} style={inputStyle}>
              {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {needsThermostatZone(kind) && zones?.length > 0 && (
            <div style={{ marginBottom: needsSoundZone(kind) ? "1.25rem" : 0 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
                Thermostat zone
              </label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </div>
          )}

          {needsSoundZone(kind) && soundZones?.length > 0 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
                Sound zone
              </label>
              <select
                value={kind === "zoneAudio" ? zoneId : soundZoneId}
                onChange={e => (kind === "zoneAudio" ? setZoneId : setSoundZoneId)(e.target.value)}
                style={inputStyle}
              >
                <option value="">— None —</option>
                {soundZones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.5rem", background: "var(--bg-surface)" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", background: "var(--border)", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 1, padding: "0.7rem", background: "var(--accent)", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "0.7rem 1rem", background: "var(--bg-surface)",
  border: "1px solid var(--border)", borderRadius: 10, fontSize: "0.95rem",
  outline: "none", boxSizing: "border-box",
};
