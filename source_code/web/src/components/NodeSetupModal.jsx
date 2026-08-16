import { useState } from "react";

const KIND_OPTIONS = [
  { value: "thermostat", label: "Thermostat zone (BME680 + SCD41)" },
  { value: "monitor",    label: "Monitor-only zone (temp + humidity)" },
  { value: "zoneAudio",  label: "Zone audio hardware (speaker amp)" },
  { value: "other",      label: "Other" },
];

// `kind` is a node's own sensor role — it no longer has a 'dial' value.
// A wall dial is a separate ESP32 board bridged over I2C to one of these
// RP2040 sensor nodes (see rs485_node.ino's header) and is represented
// here by the independent `hasDial` flag, orthogonal to `kind`: a
// thermostat/monitor node can also carry a dial (the common case — one
// mass-produced board per room), or a dial can be paired with a
// sensor-less node (kind='other', hasDial=true) pointed at a zone sensed
// elsewhere, since multiple dials/nodes are allowed to share one zoneId.
//
// Thermostat zone and sound zone are separate id spaces (HVAC zoning
// follows ductwork, audio zoning follows room-by-room speaker wiring —
// see server/services/sound.js's header). A dial always needs a
// thermostat zone (its Thermostat screen has to show/adjust something)
// and, separately, a sound zone for its Sound screen. `zoneAudio` nodes
// are unrelated hardware (no dial, no sensors) that reuse the single
// zoneId field to mean their sound zone, same as before this redesign.
function needsThermostatZone(kind, hasDial) {
  return kind === "thermostat" || kind === "monitor" || hasDial;
}
function needsSoundZone(hasDial) {
  return hasDial;
}

// Naming/setup portal for a node discovered on the RS485 bus. Fully wired
// to the real node-registry API.
export default function NodeSetupModal({ node, zones, soundZones, onClose, onSave }) {
  const [name, setName] = useState(node.name || "");
  const [kind, setKind] = useState(node.kind || "thermostat");
  const [hasDial, setHasDial] = useState(!!node.hasDial);
  const [zoneId, setZoneId] = useState(node.zoneId || "");
  const [soundZoneId, setSoundZoneId] = useState(node.soundZoneId || "");

  const usesZoneIdAsSoundZone = kind === "zoneAudio";

  function handleKindChange(nextKind) {
    setKind(nextKind);
    if (nextKind === "zoneAudio") setHasDial(false); // zoneAudio is separate amp hardware, never carries a dial
  }

  function handleSave() {
    if (!name.trim()) return;
    onSave(node.uniqueId, {
      name: name.trim(),
      kind,
      hasDial,
      zoneId: needsThermostatZone(kind, hasDial) || usesZoneIdAsSoundZone ? (zoneId || null) : null,
      soundZoneId: needsSoundZone(hasDial) ? (soundZoneId || null) : null,
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
            <select value={kind} onChange={e => handleKindChange(e.target.value)} style={inputStyle}>
              {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {kind !== "zoneAudio" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem", cursor: "pointer" }}>
              <input type="checkbox" checked={hasDial} onChange={e => setHasDial(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>Has a wall dial attached (I2C)</span>
            </label>
          )}

          {needsThermostatZone(kind, hasDial) && zones?.length > 0 && (
            <div style={{ marginBottom: needsSoundZone(hasDial) ? "1.25rem" : 0 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
                Thermostat zone
              </label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </div>
          )}

          {usesZoneIdAsSoundZone && soundZones?.length > 0 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
                Sound zone
              </label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {soundZones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </div>
          )}

          {needsSoundZone(hasDial) && soundZones?.length > 0 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
                Sound zone (dial's Sound screen)
              </label>
              <select value={soundZoneId} onChange={e => setSoundZoneId(e.target.value)} style={inputStyle}>
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
