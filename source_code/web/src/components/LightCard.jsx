import { FaCog, FaLightbulb, FaFan } from "react-icons/fa";

export default function LightCard({ device, onToggle, onPreview, onCommit, onSettings }) {
  const main       = device.status?.components?.main || {};
  const isFan      = device.name?.toLowerCase().includes("fan");
  const isOffline  = main.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";
  const brightness = main.switchLevel?.level?.value ?? 0;
  const speedVal   = main.fanSpeed?.fanSpeed?.value ?? 0;
  const isOn       = main.switch?.switch?.value === "on" || brightness > 0;
  const speedLabels = ["Off", "Low", "Medium", "High", "Max"];
  const sliderVal  = isFan ? speedVal : brightness;
  const maxVal     = isFan ? 4 : 100;

  const statusText = isOffline
    ? "Offline"
    : isOn
      ? isFan ? `${speedLabels[speedVal] ?? "?"} speed` : `${brightness}%`
      : "Off";

  return (
    <div className="device-card-wrapper" style={{ position: "relative" }}>
      <div style={{
        background: isOn ? "linear-gradient(135deg, var(--tint-warning) 0%, var(--bg-card) 100%)" : "var(--bg-card)",
        borderRadius: 14, border: `1px solid ${isOn ? "#fde68a" : "var(--border)"}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)", opacity: isOffline ? 0.55 : 1,
        transition: "all 0.25s",
      }}>
        <button className="settings-button" onClick={() => onSettings(device.deviceId)} style={{
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
              onClick={() => onToggle(device.deviceId, !isOn, isFan ? speedVal : brightness || 100)}
              style={{
                width: 44, height: 44, borderRadius: 10, display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: "1.15rem",
                cursor: "pointer", transition: "all 0.25s",
                background: isOn ? "var(--warning)" : "var(--bg-surface-alt)",
                color: isOn ? "white" : "#9ca3af",
                boxShadow: isOn ? "0 8px 20px rgba(251,191,36,0.3)" : "none",
              }}>
              {isFan ? <FaFan /> : <FaLightbulb />}
            </div>
            <div>
              <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0, fontSize: "0.95rem" }}>{device.label}</p>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>{statusText}</p>
            </div>
          </div>

          {(main.switchLevel || main.fanSpeed) && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{isFan ? "Speed" : "Brightness"}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  {isFan ? speedLabels[speedVal] : `${brightness}%`}
                </span>
              </div>
              <input type="range" min="0" max={maxVal} value={sliderVal}
                onChange={e => onPreview(device.deviceId, e.target.value)}
                onMouseUp={e => onCommit(device.deviceId, true, Number(e.target.value))}
                onTouchEnd={e => onCommit(device.deviceId, true, Number(e.target.value))}
                style={{
                  width: "100%", height: 6, borderRadius: 3, outline: "none",
                  cursor: "pointer", appearance: "none", border: "none",
                  background: `linear-gradient(to right, var(--warning) 0%, var(--warning) ${isFan ? sliderVal * 25 : sliderVal}%, #e5e7eb ${isFan ? sliderVal * 25 : sliderVal}%, #e5e7eb 100%)`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
