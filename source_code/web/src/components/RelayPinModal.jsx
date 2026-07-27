import { useState } from "react";

export default function RelayPinModal({ relay, boards, onClose, onSave }) {
  const boardKeys = Object.keys(boards);
  const [address, setAddress] = useState(relay?.address ?? Number(boardKeys[0]));
  const [channel, setChannel] = useState(relay?.channel ?? "");
  const [label,   setLabel]   = useState(relay?.label ?? "");
  const [notes,   setNotes]   = useState(relay?.notes ?? "");
  const isEditing = relay != null;

  function handleSave() {
    const ch = Number(channel);
    if (!Number.isInteger(ch) || ch < 0 || ch > 7 || !label.trim()) return;
    onSave({ address: Number(address), channel: ch, label: label.trim(), notes });
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-card)", borderRadius: 16, maxWidth: 420, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.2)", overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, var(--accent), var(--accent-dark))",
          padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
            {isEditing ? "Edit Relay" : "Add Relay"}
          </h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: "1.25rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Board</label>
              <select value={address} disabled={isEditing} onChange={e => setAddress(Number(e.target.value))} style={{ ...inputStyle, opacity: isEditing ? 0.6 : 1 }}>
                {boardKeys.map(key => <option key={key} value={key}>{boards[key].label}</option>)}
              </select>
            </div>
            <div style={{ width: 100 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Channel</label>
              <input
                type="number" min={0} max={7} disabled={isEditing} value={channel}
                onChange={e => setChannel(e.target.value)}
                placeholder="0-7"
                style={{ ...inputStyle, opacity: isEditing ? 0.6 : 1 }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>What's wired here</label>
            <input
              type="text" autoFocus value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Great Room zone valve"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Notes (optional)</label>
            <input
              type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. unwired — see wiring guide"
              style={inputStyle}
            />
          </div>
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
