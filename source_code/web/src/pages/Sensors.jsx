import { FaThermometerHalf, FaTint, FaWifi, FaSync, FaCar } from "react-icons/fa";
import { useSensors } from "../hooks/useSensors";
import { formatRelativeTime } from "../utils";
import Spinner from "../components/Spinner";
import PageHeader from "../components/PageHeader";
import { CONTAINER_MEDIUM, pageContainerStyle } from "../styles/tokens";

// ── Sensor category config ────────────────────────────────────────────────────
const CATEGORIES = [
  { key: "temperature", label: "Temperature", icon: FaThermometerHalf, color: "#f97316", prefix: ["temp", "temperature"] },
  { key: "humidity",    label: "Humidity",    icon: FaTint,            color: "#14b8a6", prefix: "humidity" },
  { key: "other",       label: "Other",       icon: FaWifi,            color: "#8b5cf6", prefix: null       },
];

function matchesCategory(name, prefix) {
  if (!prefix) return true;
  if (Array.isArray(prefix)) return prefix.some(p => name.startsWith(p));
  return name.startsWith(prefix);
}

function categorizeSensors(sensors) {
  const result = {};
  CATEGORIES.forEach(c => { result[c.key] = []; });

  for (const [name, data] of Object.entries(sensors)) {
    // Skip vehicle-suburban — rendered in VehicleCard
    if (name === "vehicle-suburban") continue;

    let matched = false;
    for (const cat of CATEGORIES) {
      if (cat.prefix && matchesCategory(name, cat.prefix)) {
        result[cat.key].push({ name, ...data });
        matched = true;
        break;
      }
    }
    if (!matched) result.other.push({ name, ...data });
  }
  return result;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ value }) {
  const open   = typeof value === "string" && value.toLowerCase() === "open";
  const closed = typeof value === "string" && value.toLowerCase() === "closed";

  if (open) return (
    <span style={{
      padding: "4px 12px", borderRadius: 20, fontSize: "0.82rem", fontWeight: 700,
      background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
    }}>OPEN</span>
  );
  if (closed) return (
    <span style={{
      padding: "4px 12px", borderRadius: 20, fontSize: "0.82rem", fontWeight: 700,
      background: "#d1fae5", color: "#065f46", border: "1px solid #6ee7b7",
    }}>CLOSED</span>
  );
  return (
    <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1rem" }}>
      {value ?? "—"}
    </span>
  );
}

// ── Sensor row ────────────────────────────────────────────────────────────────
function SensorRow({ sensor }) {
  const isNumeric = typeof sensor.value === "number";
  const label = sensor.metadata?.location || sensor.name
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0.85rem 1rem", borderBottom: "1px solid var(--bg-surface-alt)",
    }}>
      <div>
        <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0, fontSize: "0.9rem" }}>{label}</p>
        <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: 0 }}>
          Updated {formatRelativeTime(sensor.updatedAt)}
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        {isNumeric
          ? <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1.05rem" }}>
              {sensor.value}{sensor.unit ? ` ${sensor.unit}` : ""}
            </span>
          : <StatusBadge value={sensor.value} />
        }
      </div>
    </div>
  );
}

// ── Vehicle card ──────────────────────────────────────────────────────────────
function VehicleCard({ carStatus }) {
  const isOn      = carStatus?.value === "on";
  const isUnknown = !carStatus || carStatus.value === "unknown";

  const bgGradient    = isOn
    ? "linear-gradient(135deg, var(--tint-success), var(--bg-card))"
    : "linear-gradient(135deg, var(--bg-surface), var(--bg-card))";
  const borderColor   = isOn ? "#bbf7d0" : "var(--border)";
  const iconBg        = isOn ? "var(--success)" : "var(--text-muted)";
  const iconShadow    = isOn ? "0 6px 18px rgba(16,185,129,0.35)" : "none";

  return (
    <div style={{
      background: bgGradient,
      border: `1px solid ${borderColor}`,
      borderRadius: 14,
      padding: "1.5rem",
      marginBottom: "1.5rem",
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "1.4rem",
            background: iconBg, color: "white", boxShadow: iconShadow,
            transition: "all 0.3s",
          }}>
            <FaCar />
          </div>
          <div>
            <h3 style={{ margin: 0, fontWeight: 700, color: "var(--text-primary)" }}>Suburban</h3>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {isUnknown
                ? "No data yet — car will report on next poll"
                : `Last updated ${formatRelativeTime(carStatus.updatedAt)}`
              }
            </p>
          </div>
        </div>

        {/* Status badge */}
        <div style={{ textAlign: "right" }}>
          {isUnknown ? (
            <span style={{ color: "var(--text-muted)", fontWeight: 600, fontSize: "0.9rem" }}>Unknown</span>
          ) : (
            <span style={{
              padding: "6px 16px", borderRadius: 20, fontSize: "0.85rem", fontWeight: 700,
              background: isOn ? "#d1fae5" : "var(--bg-surface-alt)",
              color:      isOn ? "#065f46" : "#475569",
              border:     `1px solid ${isOn ? "#6ee7b7" : "var(--border)"}`,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {/* Pulsing dot when engine is on */}
              {isOn && (
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "var(--success)", display: "inline-block",
                  animation: "enginePulse 1.4s ease-in-out infinite",
                }} />
              )}
              {isOn ? "ENGINE ON" : "ENGINE OFF"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Category card ─────────────────────────────────────────────────────────────
function CategoryCard({ category, sensors: list }) {
  if (list.length === 0) return null;
  const Icon = category.icon;

  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", marginBottom: "1.25rem", overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "0.85rem",
        padding: "1rem 1.25rem", borderBottom: "1px solid var(--bg-surface-alt)",
        background: `${category.color}0a`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: `${category.color}22`, color: category.color, fontSize: "1rem",
        }}>
          <Icon />
        </div>
        <h3 style={{ margin: 0, fontWeight: 700, color: "var(--text-primary)", fontSize: "1rem" }}>
          {category.label}
          <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: 8 }}>
            {list.length} sensor{list.length !== 1 ? "s" : ""}
          </span>
        </h3>
      </div>
      <div>
        {list.map(s => <SensorRow key={s.name} sensor={s} />)}
      </div>
    </div>
  );
}

// ── Main Sensors page ─────────────────────────────────────────────────────────
export default function Sensors() {
  const { sensors, carStatus, loading, refetch } = useSensors();

  if (loading) return <Spinner message="Loading sensors..." />;

  const categorized = categorizeSensors(sensors);
  // Don't count vehicle-suburban in "any sensor" check
  const sensorCount = Object.keys(sensors).filter(k => k !== "vehicle-suburban").length;

  return (
    <div style={pageContainerStyle(CONTAINER_MEDIUM)}>
      <style>{`
        @keyframes enginePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>

      <PageHeader
        title="Sensors"
        subtitle="Live readings from the Pi and its sensor nodes"
        actions={
          <button
            onClick={refetch}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem",
              background: "var(--bg-surface-alt)", border: "1px solid var(--border)", borderRadius: 8,
              cursor: "pointer", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.85rem",
            }}>
            <FaSync style={{ fontSize: "0.8rem" }} /> Refresh
          </button>
        }
      />

      {/* Vehicle status card */}
      <VehicleCard carStatus={carStatus} />

      {/* Sensor categories */}
      {sensorCount === 0 && (
        <div style={{
          textAlign: "center", padding: "3rem", color: "var(--text-muted)",
          background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
        }}>
          <FaWifi style={{ fontSize: "2.5rem", marginBottom: "0.75rem", opacity: 0.4 }} />
          <p style={{ fontWeight: 600, margin: 0 }}>No sensor data yet</p>
          <p style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
            Sensors will appear once the Pi or a sensor node starts reporting.
          </p>
        </div>
      )}

      {CATEGORIES.map(cat => (
        <CategoryCard
          key={cat.key}
          category={cat}
          sensors={categorized[cat.key] || []}
        />
      ))}
    </div>
  );
}
