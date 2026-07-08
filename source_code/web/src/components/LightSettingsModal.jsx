import { useState } from "react";

const NEW_ROOM_VALUE = "__new__";

export default function LightSettingsModal({ deviceId, settings, users, existingRooms = [], onClose, onSave }) {
  const light = settings.lights?.[deviceId] || {};
  const [lutronId,   setLutronId]   = useState(light.lutronId ?? "");
  const [owner,      setOwner]      = useState(light.owner    ?? "");
  const [room,       setRoom]       = useState(light.room     ?? "Uncategorized");
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoom,    setNewRoom]    = useState("");

  const roomOptions = [...new Set([...existingRooms, "Uncategorized"])].sort((a, b) => a.localeCompare(b));

  function handleSave() {
    const finalRoom = (addingRoom ? newRoom : room).trim() || "Uncategorized";
    onSave(deviceId, { lutronId, owner, room: finalRoom });
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
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Light Settings</h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>
        <div style={{ padding: "1.5rem" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Room</label>
            {!addingRoom ? (
              <select
                value={room}
                onChange={e => {
                  if (e.target.value === NEW_ROOM_VALUE) { setAddingRoom(true); setNewRoom(""); }
                  else setRoom(e.target.value);
                }}
                style={inputStyle}>
                {roomOptions.map(r => <option key={r} value={r}>{r}</option>)}
                <option value={NEW_ROOM_VALUE}>+ New category…</option>
              </select>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text" autoFocus value={newRoom}
                  onChange={e => setNewRoom(e.target.value)}
                  placeholder="e.g. Living Room"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => setAddingRoom(false)} style={{
                  padding: "0 0.9rem", background: "#e2e8f0", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer",
                }}>Cancel</button>
              </div>
            )}
          </div>
          {[
            { label: "Lutron ID", value: lutronId, onChange: setLutronId, type: "number", placeholder: "Lutron ID" },
          ].map(({ label, ...props }) => (
            <div key={label} style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>{label}</label>
              <input {...props} style={inputStyle} />
            </div>
          ))}
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", marginBottom: 6 }}>Owner</label>
            <select value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle}>
              <option value="">— Select Owner —</option>
              {users.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
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
