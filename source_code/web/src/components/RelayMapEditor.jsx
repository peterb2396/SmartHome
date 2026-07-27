import { useState, useEffect, useCallback } from "react";
import { FaPlug, FaPlus, FaPencilAlt, FaTrash } from "react-icons/fa";
import { getRelayMap, upsertRelay, deleteRelay } from "../api";
import RelayPinModal from "./RelayPinModal";
import { colors, card } from "../styles/tokens";

const cardStyle = { ...card, padding: "1.25rem" };

// Reference channel map — documentation, not control. Editing here relabels
// the reference; it doesn't change what a channel actually does (see
// server/services/relayMap.js's header comment for why that's deliberate).
export default function RelayMapEditor() {
  const [relays, setRelays] = useState([]);
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalRelay, setModalRelay] = useState(null); // null=closed, {}=new, {...}=editing

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getRelayMap();
      setRelays(data.relays);
      setBoards(data.boards);
    } catch (e) {
      console.error("RelayMapEditor:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  async function handleSave(relay) {
    await upsertRelay(relay);
    fetchState();
  }

  async function handleDelete(r) {
    if (!window.confirm(`Remove ${boards[r.address]?.label ?? `board 0x${r.address.toString(16)}`} CH${r.channel + 1} from the map?`)) return;
    await deleteRelay(r.address, r.channel);
    fetchState();
  }

  if (loading) return null;

  const byBoard = {};
  for (const r of relays) (byBoard[r.address] = byBoard[r.address] || []).push(r);

  return (
    <div style={{ ...cardStyle, marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaPlug color={colors.textMuted} /> Relay Map
        </h2>
        <button onClick={() => setModalRelay({})} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.85rem",
          background: colors.accent, color: "white", border: "none", borderRadius: 8,
          fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
        }}>
          <FaPlus size={11} /> Add Relay
        </button>
      </div>
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: colors.textMuted }}>
        Reference only — editing a channel here relabels the map, it doesn't rewire anything. Change the
        actual channel constant in the code (thermostat.js / boiler.js) to change what it controls.
      </p>

      {relays.length === 0 ? (
        <p style={{ margin: 0, color: colors.textMuted, fontSize: "0.85rem" }}>No relay channels mapped yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {Object.entries(boards)
            .filter(([key]) => byBoard[key]?.length)
            .map(([key, b]) => (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: b.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {b.label}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.6rem" }}>
                  {byBoard[key].map(r => (
                    <div key={`${r.address}:${r.channel}`} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: colors.surface, borderRadius: 10, padding: "0.55rem 0.75rem",
                      borderLeft: `3px solid ${b.color}`,
                    }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "0.85rem", color: colors.textPrimary, flexShrink: 0 }}>
                        CH{r.channel + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.label}
                        </div>
                        {r.notes && <div style={{ fontSize: "0.7rem", color: colors.textMuted }}>{r.notes}</div>}
                      </div>
                      <button onClick={() => setModalRelay(r)} title="Edit" style={{
                        width: 24, height: 24, background: "none", border: "none", color: colors.textMuted,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}><FaPencilAlt size={10} /></button>
                      <button onClick={() => handleDelete(r)} title="Remove" style={{
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

      {modalRelay && (
        <RelayPinModal
          relay={modalRelay.channel != null ? modalRelay : null}
          boards={boards}
          onClose={() => setModalRelay(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
