import { Link } from "react-router-dom";
import { FaLightbulb, FaSun, FaMoon, FaStarAndCrescent, FaCloudMoon, FaThermometerHalf, FaCloudSun, FaExclamationTriangle, FaCheckCircle, FaArrowRight } from "react-icons/fa";
import { useDevices }  from "../hooks/useDevices";
import { useSettings } from "../hooks/useSettings";
import { useCar }      from "../hooks/useCar";
import { useThermostat } from "../hooks/useThermostat";
import { useBoiler }   from "../hooks/useBoiler";
import { recordLightUsage } from "../utils";
import LightCard    from "../components/LightCard";
import CarControls  from "../components/CarControls";
import Spinner      from "../components/Spinner";
import PageHeader   from "../components/PageHeader";
import { CONTAINER_WIDE, GRID_COMPACT, GRID_WIDE, pageContainerStyle } from "../styles/tokens";

// The actual "this is my home, right now" screen — a few numbers that
// matter at a glance, your handful of most-reached-for lights, and the
// quick actions you'd actually want from the front door. Everything else
// (the full room-by-room light list, appliances, plugs) lives on its own
// page now — see pages/Lights.jsx — so this one stays short instead of
// being the dumping ground it used to be.

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function OverviewTile({ icon: Icon, label, value, detail, tone = "neutral", to }) {
  const toneColor = {
    neutral: "var(--accent)", ok: "var(--success)", warn: "var(--warning)", danger: "var(--danger)",
  }[tone];
  const content = (
    <div style={{
      background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
      boxShadow: "var(--shadow-card)", padding: "1.1rem 1.25rem",
      display: "flex", alignItems: "center", gap: "0.9rem", height: "100%",
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
  return to ? <Link to={to} style={{ textDecoration: "none", display: "block" }}>{content}</Link> : content;
}

function HouseOverview({ lightsOn, lightsTotal }) {
  const { state: thermo } = useThermostat();
  const { state: boilerState } = useBoiler();

  const isBoilerActive = thermo?.activeSystem === "boiler";
  const climateZones = isBoilerActive ? (boilerState?.zones ?? []) : (thermo?.zones ?? []);
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
      <OverviewTile icon={FaThermometerHalf} label="Climate" tone="neutral" to="/thermostat"
        value={avgIndoor != null ? `${avgIndoor}°F inside` : "No reading"}
        detail={callingCount > 0 ? `${callingCount} zone${callingCount === 1 ? "" : "s"} calling` : "All zones idle"} />
      <OverviewTile icon={FaCloudSun} label="Outside" tone="neutral"
        value={typeof outsideTemp === "number" ? `${Math.round(outsideTemp)}°F` : "—"}
        detail="Today's forecast average" />
      <OverviewTile icon={FaLightbulb} label="Lights" tone={lightsOn > 0 ? "warn" : "neutral"} to="/lights"
        value={`${lightsOn} of ${lightsTotal} on`}
        detail={lightsOn > 0 ? "Some lights are on" : "All lights off"} />
      <OverviewTile
        icon={issues > 0 ? FaExclamationTriangle : FaCheckCircle}
        label="Status" tone={issues > 0 ? "danger" : "ok"} to="/thermostat"
        value={issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"}` : "All normal"}
        detail={issues > 0 ? "Check Thermostat →" : "Nothing needs attention"} />
    </div>
  );
}

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

function SectionLabel({ children }) {
  return (
    <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 0.85rem" }}>
      {children}
    </h2>
  );
}

export default function Home() {
  const { devices, loading, setDeviceState, previewLevel } = useDevices();
  const { settings, updateSetting } = useSettings();
  const car = useCar();

  const lightsDevices = devices.filter(d => d.name?.toLowerCase().startsWith("c2c") && !d.name.toLowerCase().includes("switch"));
  const lightsOnCount = lightsDevices.filter(d => d.status?.components?.main?.switch?.switch?.value === "on").length;

  const usage = settings.lightUsage || {};
  const mostUsed = [...lightsDevices]
    .filter(d => (usage[d.deviceId] || 0) > 0)
    .sort((a, b) => (usage[b.deviceId] || 0) - (usage[a.deviceId] || 0))
    .slice(0, 6);
  // Nothing pinned yet (fresh install, or nobody's toggled anything from
  // here/the Lights page yet) — show whatever's currently on instead of
  // an empty section; still genuinely useful, and starts building real
  // usage data the moment any of these get touched.
  const quickLights = mostUsed.length > 0
    ? mostUsed
    : lightsDevices.filter(d => d.status?.components?.main?.switch?.switch?.value === "on").slice(0, 6);

  const trackedToggle = (id, on, level) => { recordLightUsage(settings, updateSetting, id); setDeviceState(id, on, level); };

  if (loading) return <Spinner message="Loading your smart home..." />;

  return (
    <div style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Home" subtitle={`${greeting()} — here's how the house is doing`} />
      <style>{`
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:var(--warning); cursor:pointer; box-shadow:0 2px 6px rgba(251,191,36,0.4); }
      `}</style>

      <HouseOverview lightsOn={lightsOnCount} lightsTotal={lightsDevices.length} />

      {/* ── Quick Lights (most-used, or currently-on as a fallback) ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.85rem" }}>
        <SectionLabel>{mostUsed.length > 0 ? "Your Lights" : "Currently On"}</SectionLabel>
        <Link to="/lights" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)", fontSize: "0.82rem", fontWeight: 600, textDecoration: "none" }}>
          All lights <FaArrowRight size={11} />
        </Link>
      </div>
      {quickLights.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.75rem" }}>
          Nothing pinned yet — the lights you use most will show up here once you start using them.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_WIDE}px, 1fr))`, gap: "1rem", marginBottom: "1.75rem" }}>
          {quickLights.map(d => (
            <LightCard
              key={d.deviceId} device={d}
              onToggle={trackedToggle}
              onPreview={previewLevel}
              onCommit={trackedToggle}
            />
          ))}
        </div>
      )}

      {/* ── Quick Actions ── */}
      <SectionLabel>Quick Actions</SectionLabel>
      <CarControls start={car.start} lock={car.lock} unlock={car.unlock} />

      {/* ── Today ── */}
      <SectionLabel>Today</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`, gap: "1rem" }}>
        <WeatherCard title="Sunrise" pairs={[
          { icon: FaSun,  bg: "#fef3c7", time: settings.sunrise },
          { icon: FaMoon, bg: "#f3f0ff", time: settings.sunset  },
        ]} />
        <WeatherCard title="Darksky" pairs={[
          { icon: FaStarAndCrescent, bg: "#f3f0ff", time: settings.stargazingStart },
          { icon: FaCloudMoon,       bg: "#f3f0ff", time: settings.stargazingEnd   },
        ]} />
      </div>
    </div>
  );
}
