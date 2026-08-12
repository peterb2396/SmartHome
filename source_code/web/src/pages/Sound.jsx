import { FaExclamationTriangle, FaSpotify } from "react-icons/fa";
import { useSound } from "../hooks/useSound";
import SoundZoneCard from "../components/SoundZoneCard";
import Spinner from "../components/Spinner";
import PageHeader from "../components/PageHeader";
import { CONTAINER_WIDE, GRID_COMPACT, pageContainerStyle } from "../styles/tokens";

// Each zone's own audio hardware decides locally which of its 3 inputs is
// audible — Spotify (lowest priority), a wired override input like a TV
// (mid), and a reserved second override input for a future Pi-triggered
// "force audio everywhere" alarm feed (highest) — see
// server/services/sound.js's header for the full design. This page and
// the "Spotify enabled" toggle only ever control the lowest tier; a TV
// plugged into a zone always works regardless of anything set here.
export default function Sound() {
  const { state, loading, setVolume, setEnabled } = useSound();

  if (loading) return <Spinner message="Loading sound..." />;
  if (!state) return null;

  const enabledZones = state.zones.filter(z => z.spotifyEnabled);

  return (
    <div style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Sound" subtitle="Per-zone Spotify volume and enable — TV/override inputs always win locally" />

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem",
        background: "var(--tint-warning)", border: "1px solid #fed7aa", borderRadius: 10,
        padding: "0.65rem 1rem", color: "#9a3412", fontSize: "0.85rem", fontWeight: 600,
      }}>
        <FaExclamationTriangle />
        No zone amp hardware is wired up yet — controls here are fully real and saved, and each
        zone's "Now Playing" badge will reflect real hardware-detected status once it is.
      </div>

      {state.spotify && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: "1.25rem",
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
          padding: "0.75rem 1.1rem",
        }}>
          <FaSpotify size={20} color="#1DB954" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
              {state.spotify.running
                ? `Connect device "${state.spotify.deviceName}" — ${state.spotify.playing ? "playing" : "connected, idle"}`
                : "Spotify Connect not running (librespot not installed/started on the Pi)"}
            </div>
            <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
              {enabledZones.length === 0
                ? "Not enabled in any zone — turn a zone's Spotify toggle on below."
                : `Enabled in: ${enabledZones.map(z => z.label).join(", ")} — same stream, all zones at once (Spotify allows one stream per account, not independent songs per zone). A zone only actually plays it while nothing has priority on its override inputs.`}
            </div>
          </div>
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`,
        gap: "1.25rem",
      }}>
        {state.zones.map(zone => (
          <SoundZoneCard
            key={zone.id}
            zone={zone}
            onVolumeChange={setVolume}
            onEnabledChange={setEnabled}
          />
        ))}
      </div>
    </div>
  );
}
