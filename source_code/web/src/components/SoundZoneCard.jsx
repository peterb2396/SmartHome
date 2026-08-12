import { FaVolumeUp, FaVolumeMute, FaSpotify, FaTv, FaBell, FaPowerOff } from "react-icons/fa";

// What a zone's own audio hardware is CURRENTLY actually playing — decided
// locally by that hardware (fixed priority: override2 > override1 >
// spotify), reported back over RS485 purely for display. Read-only here;
// there is no control that sets this directly.
const ACTIVE_SOURCE = {
  off:       { label: "Off",               icon: FaPowerOff, color: "var(--text-muted)" },
  spotify:   { label: "Spotify",           icon: FaSpotify,  color: "#1DB954" },
  override1: { label: "TV",                icon: FaTv,       color: "var(--accent)" },
  override2: { label: "Priority Override", icon: FaBell,     color: "var(--danger)" },
};

// The only thing this card actually controls is the Spotify-enable gate
// and Spotify's volume for this zone — see server/services/sound.js's
// header for the full 3-tier priority design. A TV plugged into this
// zone's override input always works, whether or not this toggle is on.
export default function SoundZoneCard({ zone, onVolumeChange, onEnabledChange }) {
  const { id, label, volumePercent, spotifyEnabled, activeSource } = zone;
  const active = ACTIVE_SOURCE[activeSource] ?? ACTIVE_SOURCE.off;
  const muted = volumePercent === 0 || activeSource === "off";

  return (
    <div style={{
      background: activeSource !== "off"
        ? `linear-gradient(160deg, ${active.color}1a 0%, var(--bg-card) 60%)`
        : "var(--bg-card)",
      borderRadius: 16,
      border: `1px solid ${activeSource !== "off" ? `${active.color}55` : "var(--border)"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
      display: "flex", flexDirection: "column", gap: 14,
      transition: "all 0.25s",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1.02rem" }}>{label}</span>
        <span style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.25rem 0.6rem", borderRadius: 999,
          background: activeSource !== "off" ? `${active.color}22` : "var(--bg-surface-alt)",
          color: activeSource !== "off" ? active.color : "var(--text-muted)",
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
          aria-label={`${label} Spotify volume`}
          style={{ flex: 1, accentColor: active.color }}
        />
        <span style={{
          fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "0.85rem",
          color: "var(--text-primary)", width: 34, textAlign: "right",
        }}>
          {volumePercent}%
        </span>
      </div>

      <label style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.55rem 0.7rem", borderRadius: 10, background: "var(--bg-surface-alt)",
        cursor: "pointer",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)" }}>
          <FaSpotify color={spotifyEnabled ? "#1DB954" : "var(--text-muted)"} size={13} />
          Spotify enabled
        </span>
        <span
          onClick={() => onEnabledChange(id, !spotifyEnabled)}
          role="switch" aria-checked={spotifyEnabled} aria-label={`Spotify enabled in ${label}`}
          style={{
            width: 40, height: 22, borderRadius: 999, position: "relative", cursor: "pointer",
            background: spotifyEnabled ? "#1DB954" : "var(--border)", transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 2, left: spotifyEnabled ? 20 : 2,
            width: 18, height: 18, borderRadius: "50%", background: "white",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left 0.2s",
          }} />
        </span>
      </label>
    </div>
  );
}
