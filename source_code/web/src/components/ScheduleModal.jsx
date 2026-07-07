import { useState } from "react";
import { FaTrash, FaPlus } from "react-icons/fa";

const DAY_OPTIONS = [
  { value: "all", label: "Every day" },
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export default function ScheduleModal({ zone, onClose, onSave }) {
  const [blocks, setBlocks] = useState(
    (zone.schedule || []).map(b => ({ ...b }))
  );

  function addBlock() {
    setBlocks(prev => [...prev, { day: "all", start: "07:00", end: "22:00", target: zone.target ?? 68 }]);
  }
  function updateBlock(i, patch) {
    setBlocks(prev => prev.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }
  function removeBlock(i) {
    setBlocks(prev => prev.filter((_, idx) => idx !== i));
  }
  function handleSave() {
    onSave(zone.id, blocks);
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "1rem",
    }}>
      <div style={{
        background: "white", borderRadius: 16, maxWidth: 640, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.2)", overflow: "hidden",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #fb923c, #ea580c)",
          padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
            {zone.label} — Schedule
          </h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
            width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem",
          }}>×</button>
        </div>

        <div style={{ padding: "1.5rem", overflowY: "auto", flex: 1 }}>
          {blocks.length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
              No schedule blocks yet — this zone will just hold its manual target. Add a block below.
            </p>
          )}
          {blocks.map((b, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "center", marginBottom: 10,
              background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "0.6rem",
            }}>
              <select value={b.day} onChange={e => updateBlock(i, { day: e.target.value === "all" ? "all" : Number(e.target.value) })}
                style={{ ...selectStyle, flex: "1.3" }}>
                {DAY_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <input type="time" value={b.start} onChange={e => updateBlock(i, { start: e.target.value })} style={{ ...inputStyle, flex: "1.2", minWidth: 118 }} />
              <span style={{ color: "#94a3b8" }}>–</span>
              <input type="time" value={b.end} onChange={e => updateBlock(i, { end: e.target.value })} style={{ ...inputStyle, flex: "1.2", minWidth: 118 }} />
              <input type="number" value={b.target} onChange={e => updateBlock(i, { target: Number(e.target.value) })}
                style={{ ...inputStyle, flex: "0.6", textAlign: "center" }} />
              <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>°F</span>
              <button onClick={() => removeBlock(i)} style={{
                background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.9rem",
              }}>
                <FaTrash />
              </button>
            </div>
          ))}

          <button onClick={addBlock} style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: 6,
            background: "#fff7ed", border: "1px dashed #fb923c", color: "#c2410c",
            borderRadius: 10, padding: "0.6rem 1rem", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
          }}>
            <FaPlus size={12} /> Add block
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.5rem", background: "#f8fafc" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", background: "#e2e8f0", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 1, padding: "0.7rem", background: "#ea580c", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Save Schedule</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "0.5rem 0.6rem", background: "white",
  border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.85rem",
  outline: "none", boxSizing: "border-box", minWidth: 0,
};
const selectStyle = { ...inputStyle };
