import { useState, useEffect, useCallback } from "react";
import { FaMicrochip, FaPlus, FaPencilAlt, FaTrash, FaArrowRight, FaArrowLeft } from "react-icons/fa";
import { getGpioMap, upsertGpioPin, deleteGpioPin } from "../api";
import GpioPinModal from "./GpioPinModal";
import { colors, card } from "../styles/tokens";

const cardStyle = { ...card, padding: "1.25rem" };

// Reference pinout map — documentation, not control. Editing here relabels
// the reference; it doesn't change what a pin actually does (see
// server/services/gpioMap.js's header comment for why that's deliberate).
export default function GpioMapEditor() {
  const [pins, setPins] = useState([]);
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalPin, setModalPin] = useState(null); // null=closed, {}=new, {...}=editing

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getGpioMap();
      setPins(data.pins);
      setGroups(data.groups);
    } catch (e) {
      console.error("GpioMapEditor:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  async function handleSave(pin) {
    await upsertGpioPin(pin);
    fetchState();
  }

  async function handleDelete(p) {
    if (!window.confirm(`Remove GPIO ${p.pin} from the map?`)) return;
    await deleteGpioPin(p.pin);
    fetchState();
  }

  if (loading) return null;

  const byGroup = {};
  for (const p of pins) (byGroup[p.group] = byGroup[p.group] || []).push(p);

  return (
    <div style={{ ...cardStyle, marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaMicrochip color={colors.textMuted} /> GPIO Map
        </h2>
        <button onClick={() => setModalPin({})} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.85rem",
          background: colors.accent, color: "white", border: "none", borderRadius: 8,
          fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
        }}>
          <FaPlus size={11} /> Add Pin
        </button>
      </div>
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: colors.textMuted }}>
        Reference only — editing a pin here relabels the map, it doesn't rewire anything. Change the
        actual pin in the code to change what it controls.
      </p>

      {pins.length === 0 ? (
        <p style={{ margin: 0, color: colors.textMuted, fontSize: "0.85rem" }}>No pins mapped yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {Object.entries(groups)
            .filter(([key]) => byGroup[key]?.length)
            .map(([key, g]) => (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {g.label}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.6rem" }}>
                  {byGroup[key].map(p => (
                    <div key={p.pin} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: colors.surface, borderRadius: 10, padding: "0.55rem 0.75rem",
                      borderLeft: `3px solid ${g.color}`,
                    }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "0.85rem", color: colors.textPrimary, flexShrink: 0 }}>
                        {p.pin}
                      </span>
                      {p.direction === "out"
                        ? <FaArrowRight title="Output" size={10} style={{ color: colors.textMuted, flexShrink: 0 }} />
                        : <FaArrowLeft title="Input" size={10} style={{ color: colors.textMuted, flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.label}
                        </div>
                        {p.notes && <div style={{ fontSize: "0.7rem", color: colors.textMuted }}>{p.notes}</div>}
                      </div>
                      <button onClick={() => setModalPin(p)} title="Edit" style={{
                        width: 24, height: 24, background: "none", border: "none", color: colors.textMuted,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}><FaPencilAlt size={10} /></button>
                      <button onClick={() => handleDelete(p)} title="Remove" style={{
                        width: 24, height: 24, background: "none", border: "none", color: colors.danger,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}><FaTrash size={10} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {modalPin && (
        <GpioPinModal
          pin={modalPin.pin != null ? modalPin : null}
          groups={groups}
          onClose={() => setModalPin(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
