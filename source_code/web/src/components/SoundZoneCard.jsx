import { FaVolumeUp, FaVolumeMute, FaSpotify, FaTv, FaPowerOff } from "react-icons/fa";

const SOURCES = [
  { id: "off",     label: "Off",     icon: FaPowerOff, color: "var(--text-muted)" },
  { id: "spotify", label: "Spotify", icon: FaSpotify,  color: "#1DB954" },
  { id: "tv",      label: "TV",      icon: FaTv,       color: "var(--accent)" },
];

// Software scaffold — see server/services/sound.js. Fully interactive
// (volume/source both persist and round-trip through the API and any
// RS485 dial assigned to this zone), there's just no physical zone amp
// yet to actually hear it change.
export default function SoundZoneCard({ zone, onVolumeChange, onSourceChange }) {
  const { id, label, volumePercent, source } = zone;
  const active = SOURCES.find(s => s.id === source) ?? SOURCES[0];
  const muted = volumePercent === 0 || source === "off";

  return (
    <div style={{
      background: source !== "off"
        ? `linear-gradient(160deg, ${active.color}1a 0%, var(--bg-card) 60%)`
        : "var(--bg-card)",
      borderRadius: 16,
      border: `1px solid ${source !== "off" ? `${active.color}55` : "var(--border)"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
      display: "flex", flexDirection: "column", gap: 14,
      transition: "all 0.25s",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1.02rem" }}>{label}</span>
        <span style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.25rem 0.6rem", borderRadius: 999,
          background: source !== "off" ? `${active.color}22` : "var(--bg-surface-alt)",
          color: source !== "off" ? active.color : "var(--text-muted)",
          fontSize: "0.72rem", fontWeight: 700,
        }}>
          <active.icon size={11} /> {active.label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {muted ? <FaVolumeMute color="var(--text-muted)" /> : <FaVolumeUp color={active.color} />}
        <input
          type="range" min={0} max={100} step={1}
          value={volumePercent}
          onChange={e => onVolumeChange(id, Number(e.target.value))}
          aria-label={`${label} volume`}
          style={{ flex: 1, accentColor: active.color }}
        />
        <span style={{
          fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "0.85rem",
          color: "var(--text-primary)", width: 34, textAlign: "right",
        }}>
          {volumePercent}%
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => onSourceChange(id, s.id)} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "0.45rem 0.5rem", borderRadius: 10, border: "none", cursor: "pointer",
            fontSize: "0.78rem", fontWeight: 600,
            background: source === s.id ? s.color : "var(--bg-surface-alt)",
            color: source === s.id ? "white" : "var(--text-secondary)",
            transition: "all 0.15s",
          }}>
            <s.icon size={12} /> {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
