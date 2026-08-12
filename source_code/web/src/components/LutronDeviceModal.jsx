import { useState } from "react";

const NEW_ROOM_VALUE = "__new__";
const TYPES = [
  { value: "dimmer", label: "Dimmer" },
  { value: "switch", label: "Switch (on/off only)" },
  { value: "fan",    label: "Fan speed control" },
];

// Doubles as both "add a new device" (device=null — integrationId comes
// from the Lutron app's Integration Report, since there's no auto-
// discovery over Telnet the way RS485 nodes announce themselves) and
// "edit an existing one." device is the flat lutron.js shape
// ({integrationId, name, type, room, owner}).
export default function LutronDeviceModal({ device, users, existingRooms = [], onClose, onSave, onDelete }) {
  const isEditing = device != null;
  const [integrationId, setIntegrationId] = useState(device?.integrationId ?? "");
  const [name,   setName]   = useState(device?.name ?? "");
  const [type,   setType]   = useState(device?.type ?? "dimmer");
  const [owner,  setOwner]  = useState(device?.owner ?? "");
  const [room,   setRoom]   = useState(device?.room  ?? "Uncategorized");
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoom,    setNewRoom]    = useState("");

  const roomOptions = [...new Set([...existingRooms, "Uncategorized"])].sort((a, b) => a.localeCompare(b));

  function handleSave() {
    const id = Number(integrationId);
    if (!Number.isInteger(id) || !name.trim()) return;
    const finalRoom = (addingRoom ? newRoom : room).trim() || "Uncategorized";
    onSave({ integrationId: id, name: name.trim(), type, owner, room: finalRoom });
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
            {isEditing ? "Edit Device" : "Add Lutron Device"}
          </h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>
              Integration ID
            </label>
            <input
              type="number" autoFocus={!isEditing} disabled={isEditing} value={integrationId}
              onChange={e => setIntegrationId(e.target.value)}
              placeholder="From the Lutron app's Integration Report"
              style={{ ...inputStyle, opacity: isEditing ? 0.6 : 1 }}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Name</label>
            <input
              type="text" autoFocus={isEditing} value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Living Room Lamp"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Room</label>
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
                  padding: "0 0.9rem", background: "var(--border)", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer",
                }}>Cancel</button>
              </div>
            )}
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: 6 }}>Owner</label>
            <select value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle}>
              <option value="">— Select Owner —</option>
              {users.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.5rem", background: "var(--bg-surface)" }}>
          {isEditing && (
            <button onClick={() => { onDelete(integrationId); onClose(); }} style={{
              padding: "0.7rem 1rem", background: "var(--tint-danger)", color: "var(--danger)",
              border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer",
            }}>Remove</button>
          )}
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
