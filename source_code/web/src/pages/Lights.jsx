import { useState, useEffect } from "react";
import { FaLightbulb, FaTv, FaPlug, FaPowerOff } from "react-icons/fa";
import { useDevices }  from "../hooks/useDevices";
import { useSettings } from "../hooks/useSettings";
import { formatOperatingState, recordLightUsage } from "../utils";
import LightCard            from "../components/LightCard";
import LightSettingsModal   from "../components/LightSettingsModal";
import SectionHeader        from "../components/SectionHeader";
import Spinner              from "../components/Spinner";
import PageHeader           from "../components/PageHeader";
import { CONTAINER_WIDE, GRID_COMPACT, GRID_WIDE, pageContainerStyle } from "../styles/tokens";

// Every physical light/fan (grouped by room), appliance, and smart plug in
// the house — the full device-control page. Deliberately NOT the Home
// screen (see pages/Home.jsx) — this is where you come to manage things
// room by room, not the at-a-glance dashboard.

export default function Lights() {
  const { devices, loading, setDeviceState, previewLevel } = useDevices();
  const { settings, users, updateSetting } = useSettings();

  const [showLights,     setShowLights]     = useState(true);
  const [showAppliances, setShowAppliances] = useState(true);
  const [showPlugs,      setShowPlugs]      = useState(false);
  const [expandedRooms,  setExpandedRooms]  = useState({});
  const [modalDevice,    setModalDevice]    = useState(null);
  const [initedSettings, setInitedSettings] = useState(false);

  // Seed settings.lights once
  useEffect(() => {
    if (!loading && settings && devices.length && !initedSettings) {
      const existing = settings.lights || {};
      const merged   = { ...existing };
      devices
        .filter(d => d.name?.toLowerCase().startsWith("c2c") && !d.name.toLowerCase().includes("switch"))
        .forEach(d => {
          if (!merged[d.deviceId]) {
            merged[d.deviceId] = {
              deviceId: d.deviceId, label: d.label,
              lutronId: "", owner: "", room: "Uncategorized",
            };
          }
        });
      updateSetting("lights", merged);
      setInitedSettings(true);
    }
  }, [loading, settings, devices, initedSettings, updateSetting]);

  const saveDeviceSettings = (deviceId, patch) => {
    const updated = { ...settings.lights, [deviceId]: { ...settings.lights?.[deviceId], ...patch } };
    updateSetting("lights", updated);
  };

  const trackedToggle = (id, on, level) => { recordLightUsage(settings, updateSetting, id); setDeviceState(id, on, level); };

  // Device classification — appliances/plugs distinguished by manufacturerName
  // (the real field SmartThings returns; deviceTypeName doesn't exist on the
  // API response and was always empty).
  const isSamsung         = d => d.manufacturerName?.toLowerCase().includes("samsung");
  const lightsDevices     = devices.filter(d => d.name?.toLowerCase().startsWith("c2c") && !d.name.toLowerCase().includes("switch"));
  const appliancesDevices = devices.filter(d => isSamsung(d));
  const plugsDevices      = devices.filter(d => !isSamsung(d) && d.name?.toLowerCase().includes("switch"));

  const lightsByRoom = lightsDevices.reduce((acc, d) => {
    const room = settings.lights?.[d.deviceId]?.room?.trim() || "Uncategorized";
    (acc[room] = acc[room] || []).push(d);
    return acc;
  }, {});

  const existingRooms = [...new Set(Object.values(settings.lights || {}).map(l => l.room?.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  if (loading) return <Spinner message="Loading your smart home..." />;

  return (
    <div className="lights-page" style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Lights" subtitle="Lights, fans, appliances, and plugs — by room" />
      <style>{`
        .device-card-wrapper:hover .settings-button { opacity: 1 !important; }
        .settings-button:hover { background: var(--border) !important; color: var(--text-primary) !important; }
        .section-header:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:var(--warning); cursor:pointer; box-shadow:0 2px 6px rgba(251,191,36,0.4); }
        @media (max-width: 640px) {
          .lights-page { padding: 0.85rem !important; }
          .section-header { height: auto !important; padding: 0.85rem 1rem !important; }
        }
      `}</style>

      {/* ── Lights (and fans — same LightCard, same room grouping) ── */}
      <SectionHeader title="Lights" isExpanded={showLights} onClick={() => setShowLights(v => !v)}
        icon={FaLightbulb} count={lightsDevices.length} />

      {showLights && (
        <div style={{ marginBottom: "2rem" }}>
          {Object.entries(lightsByRoom).sort(([a], [b]) => a.localeCompare(b)).map(([room, roomDevices]) => {
            const expanded = expandedRooms[room] !== false;
            return (
              <div key={room} style={{ marginBottom: "1.25rem" }}>
                <div onClick={() => setExpandedRooms(p => ({ ...p, [room]: !expanded }))} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.85rem 1.25rem", background: "var(--bg-card)", borderRadius: 10,
                  border: "1px solid var(--border)", cursor: "pointer", marginBottom: "0.75rem",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{room}</span>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {roomDevices.length} {roomDevices.length === 1 ? "light" : "lights"}
                    </span>
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "0.8rem" }}>{expanded ? "▲" : "▼"}</span>
                </div>
                {expanded && (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_WIDE}px, 1fr))`, gap: "1rem" }}>
                    {roomDevices.map(d => (
                      <LightCard
                        key={d.deviceId} device={d}
                        onToggle={trackedToggle}
                        onPreview={previewLevel}
                        onCommit={trackedToggle}
                        onSettings={id => setModalDevice(id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Appliances ── */}
      <SectionHeader title="Appliances" isExpanded={showAppliances} onClick={() => setShowAppliances(v => !v)}
        icon={FaTv} count={appliancesDevices.length} accentColor="var(--success)" />

      {showAppliances && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_WIDE}px, 1fr))`, gap: "1rem", marginBottom: "1.5rem" }}>
          {appliancesDevices.map(d => {
            const main      = d.status?.components?.main || {};
            const isOffline = main.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";
            const dryerState  = formatOperatingState(main["samsungce.dryerOperatingState"]);
            const washerState = formatOperatingState(main["samsungce.washerOperatingState"]);

            return (
              <div key={d.deviceId} style={{
                background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
                opacity: isOffline ? 0.55 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: "1.1rem",
                    background: "linear-gradient(135deg, var(--success), #059669)", color: "white",
                  }}>
                    <FaTv />
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>{d.label}</p>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
                      {isOffline ? "Offline" : "Connected"}
                    </p>
                  </div>
                </div>
                {(dryerState || washerState) && (
                  <div style={{ background: "var(--bg-surface)", borderRadius: 10, padding: "0.75rem" }}>
                    {[dryerState, washerState].filter(Boolean).map(s => (
                      <div key={s} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Status</span>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.85rem" }}>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Smart Plugs ── */}
      <SectionHeader title="Smart Plugs" isExpanded={showPlugs} onClick={() => setShowPlugs(v => !v)}
        icon={FaPlug} count={plugsDevices.length} accentColor="#8b5cf6" />

      {showPlugs && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`, gap: "1rem", marginBottom: "1.5rem" }}>
          {plugsDevices.map(d => {
            const main      = d.status?.components?.main || {};
            const isOn      = main.switch?.switch?.value === "on";
            const isOffline = main.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";
            return (
              <div key={d.deviceId} style={{
                background: isOn ? "linear-gradient(135deg, var(--tint-info), var(--bg-card))" : "var(--bg-card)",
                borderRadius: 14, border: `1px solid ${isOn ? "#bfdbfe" : "var(--border)"}`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
                opacity: isOffline ? 0.55 : 1, display: "flex", alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: "1.1rem",
                    background: isOn ? "var(--accent)" : "var(--bg-surface-alt)", color: isOn ? "white" : "#9ca3af",
                    boxShadow: isOn ? "0 6px 16px rgba(59,130,246,0.3)" : "none",
                  }}>
                    <FaPlug />
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0, fontSize: "0.9rem" }}>{d.label}</p>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: 0 }}>
                      {isOffline ? "Offline" : isOn ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>
                <button
                  disabled={isOffline}
                  onClick={() => setDeviceState(d.deviceId, !isOn, null)}
                  style={{
                    width: 42, height: 42, borderRadius: 10, border: "none",
                    cursor: isOffline ? "not-allowed" : "pointer",
                    background: isOn ? "var(--success)" : "var(--danger)", color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: `0 4px 12px ${isOn ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                    transition: "all 0.2s",
                  }}>
                  <FaPowerOff />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Light settings modal */}
      {modalDevice && (
        <LightSettingsModal
          deviceId={modalDevice}
          settings={settings}
          users={users}
          existingRooms={existingRooms}
          onClose={() => setModalDevice(null)}
          onSave={saveDeviceSettings}
        />
      )}
    </div>
  );
}
