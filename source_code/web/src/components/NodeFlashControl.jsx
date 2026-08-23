import { useState, useEffect, useRef } from "react";
import { FaBolt } from "react-icons/fa";
import { flashNode, getFlashStatus } from "../api";
import { colors } from "../styles/tokens";

const POLL_MS = 2000;

// Inline firmware-push control for one configured RS485 node — pick an
// uploaded image (see FirmwarePanel) and push it over the bus. Only shown
// for nodes with a bus address (an unaddressed/pending node has nothing
// to flash yet). See server/services/rs485.js's flashFirmware() for why
// this realistically takes low single digit MINUTES, not seconds — the
// progress bar is there so that doesn't read as "stuck."
export default function NodeFlashControl({ uniqueId, firmwareFiles }) {
  const [filename, setFilename] = useState("");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const pollTimer = useRef(null);

  useEffect(() => {
    return () => clearTimeout(pollTimer.current);
  }, []);

  function pollStatus() {
    pollTimer.current = setTimeout(async () => {
      try {
        const { data } = await getFlashStatus(uniqueId);
        setStatus(data);
        if (data?.status === "flashing") pollStatus();
      } catch (e) {
        console.error("NodeFlashControl:", e);
      }
    }, POLL_MS);
  }

  async function handleFlash() {
    if (!filename) return;
    setError(null);
    try {
      const { data } = await flashNode(uniqueId, filename);
      setStatus(data.status);
      pollStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  if (firmwareFiles.length === 0) return null;

  const flashing = status?.status === "flashing";
  const pct = flashing && status.total ? Math.round((status.sent / status.total) * 100) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <select
        value={filename} onChange={e => setFilename(e.target.value)} disabled={flashing}
        style={{
          padding: "0.3rem 0.5rem", background: colors.surface, border: "1px solid var(--border)",
          borderRadius: 8, fontSize: "0.75rem", color: colors.textSecondary,
        }}
      >
        <option value="">firmware…</option>
        {firmwareFiles.map(f => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
      </select>
      <button
        onClick={handleFlash} disabled={!filename || flashing} title="Flash firmware over RS485"
        style={{
          width: 28, height: 28, background: "var(--bg-surface-alt)", border: "none", borderRadius: 8,
          color: flashing ? colors.textMuted : colors.accent, cursor: (!filename || flashing) ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      ><FaBolt size={12} /></button>

      {flashing && (
        <span style={{ fontSize: "0.72rem", color: colors.textMuted }}>
          Flashing… {pct != null ? `${pct}%` : ""}
        </span>
      )}
      {status?.status === "success" && (
        <span style={{ fontSize: "0.72rem", color: "#059669", fontWeight: 600 }}>Flashed — node rebooting</span>
      )}
      {status?.status === "failed" && (
        <span style={{ fontSize: "0.72rem", color: colors.danger }} title={status.error}>Flash failed — still on old firmware</span>
      )}
      {error && <span style={{ fontSize: "0.72rem", color: colors.danger }}>{error}</span>}
    </div>
  );
}
