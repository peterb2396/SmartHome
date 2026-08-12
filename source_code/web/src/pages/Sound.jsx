import { FaExclamationTriangle, FaSpotify } from "react-icons/fa";
import { useSound } from "../hooks/useSound";
import SoundZoneCard from "../components/SoundZoneCard";
import Spinner from "../components/Spinner";
import PageHeader from "../components/PageHeader";
import { CONTAINER_WIDE, GRID_COMPACT, pageContainerStyle } from "../styles/tokens";

// Software scaffold — see server/services/sound.js and spotify.js. Every
// control here is real (persists, round-trips, and is what an RS485 dial's
// Sound screen drives too) — there's just no physical zone amp yet to
// actually hear it, and one Spotify Connect stream can be routed to
// multiple zones at once but can't play different songs in different
// zones simultaneously (a Spotify platform limit, not something this page
// works around — see spotify.js's header for why).
export default function Sound() {
  const { state, loading, setVolume, setSource } = useSound();

  if (loading) return <Spinner message="Loading sound..." />;
  if (!state) return null;

  const routedZones = state.zones.filter(z => z.source === "spotify");

  return (
    <div style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Sound" subtitle="Per-zone volume and source — no zone speakers wired up yet" />

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem",
        background: "var(--tint-warning)", border: "1px solid #fed7aa", borderRadius: 10,
        padding: "0.65rem 1rem", color: "#9a3412", fontSize: "0.85rem", fontWeight: 600,
      }}>
        <FaExclamationTriangle />
        Controls here are fully real and saved, but there's no zone amp hardware yet to actually
        play audio — this page is ready for when that's wired up.
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
              {routedZones.length === 0
                ? "Not routed to any zone — set a zone's source to Spotify below."
                : `Routed to: ${routedZones.map(z => z.label).join(", ")} — same stream, all zones at once (Spotify allows one stream per account, not independent songs per zone).`}
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
            onSourceChange={setSource}
          />
        ))}
      </div>
    </div>
  );
}
