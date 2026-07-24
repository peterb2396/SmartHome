import { useState } from "react";

export default function GpioPinModal({ pin, groups, onClose, onSave }) {
  const [pinNumber, setPinNumber] = useState(pin?.pin ?? "");
  const [label,     setLabel]     = useState(pin?.label ?? "");
  const [direction, setDirection] = useState(pin?.direction ?? "out");
  const [group,     setGroup]     = useState(pin?.group ?? Object.keys(groups)[0]);
  const [notes,     setNotes]     = useState(pin?.notes ?? "");
  const isEditing = pin != null;

  function handleSave() {
    const num = Number(pinNumber);
    if (!Number.isInteger(num) || !label.trim()) return;
    onSave({ pin: num, label: label.trim(), direction, group, notes });
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
            {isEditing ? "Edit Pin" : "Add Pin"}
          </h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>BCM Pin</label>
            <input
              type="number" autoFocus={!isEditing} value={pinNumber} disabled={isEditing}
              onChange={e => setPinNumber(e.target.value)}
              placeholder="e.g. 18"
              style={{ ...inputStyle, opacity: isEditing ? 0.6 : 1 }}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>What's connected here</label>
            <input
              type="text" autoFocus={isEditing} value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. RS485 DE/RE control"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: "1.25rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Direction</label>
              <select value={direction} onChange={e => setDirection(e.target.value)} style={inputStyle}>
                <option value="out">Output</option>
                <option value="in">Input</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Group</label>
              <select value={group} onChange={e => setGroup(e.target.value)} style={inputStyle}>
                {Object.entries(groups).map(([key, g]) => <option key={key} value={key}>{g.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Notes (optional)</label>
            <input
              type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. active-LOW relay board"
              style={inputStyle}
            />
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
