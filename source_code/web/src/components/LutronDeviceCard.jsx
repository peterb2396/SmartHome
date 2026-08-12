import { FaCog, FaLightbulb, FaFan } from "react-icons/fa";

// Local Lutron Caseta device — same visual language as the old SmartThings-
// backed LightCard, but built on the plain flat shape lutron.js returns
// ({integrationId, name, type, on, level}) instead of SmartThings' nested
// capability status, and offline means "bridge unreachable," not "this one
// device is offline" (the whole bridge is one TCP connection).
export default function LutronDeviceCard({ device, bridgeConnected, onToggle, onPreview, onCommit, onSettings }) {
  const { integrationId, name, type, on, level } = device;
  const isFan = type === "fan";
  const isDimmable = type !== "switch";

  const statusText = !bridgeConnected
    ? "Bridge unreachable"
    : on
      ? isDimmable ? `${level}%` : "On"
      : "Off";

  return (
    <div className="device-card-wrapper" style={{ position: "relative" }}>
      <div style={{
        background: on ? "linear-gradient(135deg, var(--tint-warning) 0%, var(--bg-card) 100%)" : "var(--bg-card)",
        borderRadius: 14, border: `1px solid ${on ? "#fde68a" : "var(--border)"}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)", opacity: bridgeConnected ? 1 : 0.55,
        transition: "all 0.25s",
      }}>
        <button className="settings-button" onClick={() => onSettings(integrationId)} style={{
          position: "absolute", top: 12, right: 12, width: 34, height: 34,
          background: "var(--bg-surface-alt)", border: "none", borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "var(--text-muted)", opacity: 0.5, transition: "opacity 0.2s",
          fontSize: "0.85rem",
        }}>
          <FaCog />
        </button>

        <div style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: 12 }}>
            <div
              onClick={() => bridgeConnected && onToggle(integrationId, !on, level || 100)}
              style={{
                width: 44, height: 44, borderRadius: 10, display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: "1.15rem",
                cursor: bridgeConnected ? "pointer" : "not-allowed", transition: "all 0.25s",
                background: on ? "var(--warning)" : "var(--bg-surface-alt)",
                color: on ? "white" : "#9ca3af",
                boxShadow: on ? "0 8px 20px rgba(251,191,36,0.3)" : "none",
              }}>
              {isFan ? <FaFan /> : <FaLightbulb />}
            </div>
            <div>
              <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0, fontSize: "0.95rem" }}>{name}</p>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>{statusText}</p>
            </div>
          </div>

          {isDimmable && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{isFan ? "Speed" : "Brightness"}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{level}%</span>
              </div>
              <input type="range" min="0" max="100" value={level}
                disabled={!bridgeConnected}
                onChange={e => onPreview(integrationId, e.target.value)}
                onMouseUp={e => onCommit(integrationId, Number(e.target.value) > 0, Number(e.target.value))}
                onTouchEnd={e => onCommit(integrationId, Number(e.target.value) > 0, Number(e.target.value))}
                style={{
                  width: "100%", height: 6, borderRadius: 3, outline: "none",
                  cursor: bridgeConnected ? "pointer" : "not-allowed", appearance: "none", border: "none",
                  background: `linear-gradient(to right, var(--warning) 0%, var(--warning) ${level}%, #e5e7eb ${level}%, #e5e7eb 100%)`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
