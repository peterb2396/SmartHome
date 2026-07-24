import { useState } from "react";

const KIND_OPTIONS = [
  { value: "thermostat", label: "Thermostat zone (BME680 + SCD41)" },
  { value: "monitor",    label: "Monitor-only zone (temp + humidity)" },
  { value: "other",      label: "Other" },
];

// Naming/setup portal for a node discovered on the RS485 bus. Fully wired
// to the real node-registry API — it simply has nothing to configure until
// server/services/rs485.js (not built yet) starts reporting pending nodes.
export default function NodeSetupModal({ node, zones, onClose, onSave }) {
  const [name, setName] = useState(node.name || "");
  const [kind, setKind] = useState(node.kind || "thermostat");
  const [zoneId, setZoneId] = useState(node.zoneId || "");

  function handleSave() {
    if (!name.trim()) return;
    onSave(node.uniqueId, { name: name.trim(), kind, zoneId: zoneId || null });
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "1rem",
    }}>
      <div style={{
        background: "white", borderRadius: 16, maxWidth: 440, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.2)", overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
          padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Set Up Node</h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <p style={{ margin: "0 0 1.25rem", color: "#94a3b8", fontSize: "0.78rem", fontFamily: "monospace" }}>
            {node.uniqueId}
          </p>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Name</label>
            <input
              type="text" autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Office Thermostat Node"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Node type</label>
            <select value={kind} onChange={e => setKind(e.target.value)} style={inputStyle}>
              {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {zones?.length > 0 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Zone</label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.5rem", background: "#f8fafc" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", background: "#e2e8f0", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 1, padding: "0.7rem", background: "#3b82f6", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "0.7rem 1rem", background: "#f8fafc",
  border: "1px solid #e2e8f0", borderRadius: 10, fontSize: "0.95rem",
  outline: "none", boxSizing: "border-box",
};
