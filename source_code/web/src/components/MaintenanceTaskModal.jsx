import { useState } from "react";

export default function MaintenanceTaskModal({ task, frequencies, onClose, onSave }) {
  const [label,     setLabel]     = useState(task?.label ?? "");
  const [frequency, setFrequency] = useState(task?.frequency ?? frequencies[0]);

  function handleSave() {
    if (!label.trim()) return;
    onSave({ label: label.trim(), frequency });
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "1rem",
    }}>
      <div style={{
        background: "white", borderRadius: 16, maxWidth: 420, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.2)", overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
          padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
            {task ? "Edit Task" : "New Maintenance Task"}
          </h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Task</label>
            <input
              type="text" autoFocus value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Replace HVAC filter"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Frequency</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value)} style={inputStyle}>
              {frequencies.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
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
