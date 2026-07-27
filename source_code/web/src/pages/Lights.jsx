import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { FaLightbulb, FaTv, FaPlug, FaSun, FaMoon, FaPowerOff, FaStarAndCrescent, FaCloudMoon, FaThermometerHalf, FaCloudSun, FaExclamationTriangle, FaCheckCircle } from "react-icons/fa";
import { useDevices }  from "../hooks/useDevices";
import { useSettings } from "../hooks/useSettings";
import { useCar }      from "../hooks/useCar";
import { useThermostat } from "../hooks/useThermostat";
import { useBoiler }   from "../hooks/useBoiler";
import { formatOperatingState } from "../utils";
import LightCard            from "../components/LightCard";
import LightSettingsModal   from "../components/LightSettingsModal";
import CarControls          from "../components/CarControls";
import SectionHeader        from "../components/SectionHeader";
import Spinner              from "../components/Spinner";
import PageHeader           from "../components/PageHeader";
import { CONTAINER_WIDE, GRID_COMPACT, GRID_WIDE, pageContainerStyle } from "../styles/tokens";

// ── House overview ───────────────────────────────────────────────────────────
// The at-a-glance "this is actually my home" strip — climate, lights,
// outside conditions, and anything that needs attention — sitting above the
// device-control sections below it.

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function OverviewTile({ icon: Icon, label, value, detail, tone = "neutral" }) {
  const toneColor = {
    neutral: "var(--accent)", ok: "var(--success)", warn: "var(--warning)", danger: "var(--danger)",
  }[tone];
  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
      boxShadow: "var(--shadow-card)", padding: "1.1rem 1.25rem",
      display: "flex", alignItems: "center", gap: "0.9rem",
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, flexShrink: 0,
        background: `${toneColor}22`, color: toneColor,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem",
      }}>
        <Icon />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</p>
        <p style={{ margin: "2px 0 0", color: "var(--text-primary)", fontSize: "1.15rem", fontWeight: 700, lineHeight: 1.2 }}>{value}</p>
        {detail && <p style={{ margin: "1px 0 0", color: "var(--text-muted)", fontSize: "0.78rem" }}>{detail}</p>}
      </div>
    </div>
  );
}

function HouseOverview({ lightsOn, lightsTotal }) {
  const { state: thermo } = useThermostat();
  const { state: boilerState } = useBoiler();

  const is3Zone = thermo?.activeSystem === "3zone";
  const climateZones = is3Zone ? (boilerState?.zones ?? []) : (thermo?.zones ?? []);
  const readingZones = climateZones.filter(z => z.sensorOk && typeof z.currentTemp === "number");
  const avgIndoor = readingZones.length
    ? Math.round(readingZones.reduce((sum, z) => sum + z.currentTemp, 0) / readingZones.length)
    : null;
  const callingCount = climateZones.filter(z => z.calling || z.coolCalling).length;
  const outsideTemp = thermo?.lastDecision?.avgOutdoorTempF;

  const unresponsive = climateZones.filter(z => !z.sensorOk).length;
  const inSafety = climateZones.filter(z => z.safety && z.safety !== "normal").length;
  const issues = unresponsive + inSafety;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`,
      gap: "1rem", marginBottom: "1.75rem",
    }}>
      <OverviewTile icon={FaThermometerHalf} label="Climate" tone="neutral"
        value={avgIndoor != null ? `${avgIndoor}°F inside` : "No reading"}
        detail={callingCount > 0 ? `${callingCount} zone${callingCount === 1 ? "" : "s"} calling` : "All zones idle"} />
      <OverviewTile icon={FaCloudSun} label="Outside" tone="neutral"
        value={typeof outsideTemp === "number" ? `${Math.round(outsideTemp)}°F` : "—"}
        detail="Today's forecast average" />
      <OverviewTile icon={FaLightbulb} label="Lights" tone={lightsOn > 0 ? "warn" : "neutral"}
        value={`${lightsOn} of ${lightsTotal} on`}
        detail={lightsOn > 0 ? "Some lights are on" : "All lights off"} />
      <OverviewTile
        icon={issues > 0 ? FaExclamationTriangle : FaCheckCircle}
        label="Status" tone={issues > 0 ? "danger" : "ok"}
        value={issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"}` : "All normal"}
        detail={issues > 0 ? <Link to="/thermostat" style={{ color: "inherit" }}>Check Thermostat →</Link> : "Nothing needs attention"} />
    </div>
  );
}

// ── Sub-displays ──────────────────────────────────────────────────────────────

function WeatherCard({ title, pairs }) {
  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem",
    }}>
      <p style={{ textAlign: "center", color: "var(--text-muted)", fontWeight: 300, fontSize: "1.1rem", margin: "0 0 1rem" }}>{title}</p>
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        {pairs.map(({ icon: Icon, bg, time }) => (
          <div key={time} style={{ textAlign: "center" }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: bg,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-secondary)", fontSize: "1.25rem", margin: "0 auto 6px",
            }}>
              <Icon />
            </div>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem", fontWeight: 500 }}>{time || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Lights page ──────────────────────────────────────────────────────────

export default function Lights() {
  const { devices, loading, setDeviceState, previewLevel } = useDevices();
  const { settings, users, updateSetting } = useSettings();
  const car = useCar();

  const [showLights,     setShowLights]     = useState(true);
  const [showAppliances, setShowAppliances] = useState(true);
  const [showPlugs,      setShowPlugs]      = useState(false);
  const [showWeather,    setShowWeather]    = useState(true);
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

  // Device classification
  const lightsDevices     = devices.filter(d => d.name?.toLowerCase().startsWith("c2c") && !d.name.toLowerCase().includes("switch"));
  const appliancesDevices = devices.filter(d => d.deviceTypeName?.toLowerCase().includes("samsung"));
  const plugsDevices      = devices.filter(d => !d.deviceTypeName?.toLowerCase().includes("samsung") && d.name?.toLowerCase().includes("switch"));

  const lightsByRoom = lightsDevices.reduce((acc, d) => {
    const room = settings.lights?.[d.deviceId]?.room?.trim() || "Uncategorized";
    (acc[room] = acc[room] || []).push(d);
    return acc;
  }, {});

  const existingRooms = [...new Set(Object.values(settings.lights || {}).map(l => l.room?.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const lightsOnCount = lightsDevices.filter(d => d.status?.components?.main?.switch?.switch?.value === "on").length;

  if (loading) return <Spinner message="Loading your smart home..." />;

  return (
    <div className="lights-page" style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Home" subtitle={`${greeting()} — here's how the house is doing`} />
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

      <HouseOverview lightsOn={lightsOnCount} lightsTotal={lightsDevices.length} />

      {/* Car controls */}
      <CarControls start={car.start} lock={car.lock} unlock={car.unlock} />

      {/* ── Lights ── */}
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
                        onToggle={(id, on, level) => setDeviceState(id, on, level)}
                        onPreview={previewLevel}
                        onCommit={(id, on, level) => setDeviceState(id, on, level)}
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

      {/* ── Weather ── */}
      <SectionHeader title="Weather" isExpanded={showWeather} onClick={() => setShowWeather(v => !v)}
        icon={FaSun} accentColor="#f59e0b" />

      {showWeather && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`, gap: "1rem", marginBottom: "1.5rem" }}>
          <WeatherCard title="Sunrise" pairs={[
            { icon: FaSun,   bg: "#fef3c7", time: settings.sunrise },
            { icon: FaMoon,  bg: "#f3f0ff", time: settings.sunset  },
          ]} />
          <WeatherCard title="Darksky" pairs={[
            { icon: FaStarAndCrescent, bg: "#f3f0ff", time: settings.stargazingStart },
            { icon: FaCloudMoon,       bg: "#f3f0ff", time: settings.stargazingEnd   },
          ]} />
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
