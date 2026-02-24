import { FaThermometerHalf, FaTint, FaWindowMaximize, FaWarehouse, FaWifi, FaSync } from "react-icons/fa";
import { useSensors } from "../hooks/useSensors";
import { formatRelativeTime } from "../utils";
import Spinner from "../components/Spinner";

// ── Sensor category config ────────────────────────────────────────────────────
const CATEGORIES = [
  { key: "garage",      label: "Garage",      icon: FaWarehouse,       color: "#6366f1", prefix: "garage"   },
  { key: "windows",     label: "Windows",     icon: FaWindowMaximize,  color: "#0ea5e9", prefix: "window"   },
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

// ── Sub-components ────────────────────────────────────────────────────────────

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
    <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "1rem" }}>
      {value ?? "—"}
    </span>
  );
}

function SensorRow({ sensor }) {
  const isNumeric = typeof sensor.value === "number";
  const label = sensor.metadata?.location || sensor.name
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0.85rem 1rem", borderBottom: "1px solid #f1f5f9",
    }}>
      <div>
        <p style={{ fontWeight: 600, color: "#1e293b", margin: 0, fontSize: "0.9rem" }}>{label}</p>
        <p style={{ color: "#94a3b8", fontSize: "0.75rem", margin: 0 }}>
          Updated {formatRelativeTime(sensor.updatedAt)}
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        {isNumeric
          ? <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "1.05rem" }}>
              {sensor.value}{sensor.unit ? ` ${sensor.unit}` : ""}
            </span>
          : <StatusBadge value={sensor.value} />
        }
      </div>
    </div>
  );
}

function GarageCard({ garage, onTrigger, triggerBusy, triggerMsg }) {
  const isOpen   = garage?.value?.toLowerCase() === "open";
  const isUnknown = !garage || garage.value === "unknown";

  return (
    <div style={{
      background: isOpen
        ? "linear-gradient(135deg, #fef3c7, white)"
        : "linear-gradient(135deg, #f0fdf4, white)",
      border: `1px solid ${isOpen ? "#fde68a" : "#bbf7d0"}`,
      borderRadius: 14, padding: "1.5rem", marginBottom: "1.5rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "1.5rem",
            background: isOpen ? "#fbbf24" : "#10b981", color: "white",
            boxShadow: `0 6px 18px ${isOpen ? "rgba(251,191,36,0.35)" : "rgba(16,185,129,0.35)"}`,
          }}>
            <FaWarehouse />
          </div>
          <div>
            <h3 style={{ margin: 0, fontWeight: 700, color: "#1e293b" }}>Garage Door</h3>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#94a3b8" }}>
              {isUnknown ? "Status unknown" : `Last updated ${formatRelativeTime(garage.updatedAt)}`}
            </p>
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          {isUnknown
            ? <span style={{ color: "#94a3b8", fontWeight: 600 }}>Unknown</span>
            : <StatusBadge value={garage.value} />
          }
        </div>
      </div>

      <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button
          onClick={onTrigger}
          disabled={triggerBusy}
          style={{
            padding: "0.65rem 1.5rem", border: "none", borderRadius: 10, fontWeight: 700,
            cursor: triggerBusy ? "not-allowed" : "pointer", transition: "all 0.2s",
            background: isOpen ? "#ef4444" : "#10b981", color: "white", fontSize: "0.9rem",
            boxShadow: `0 4px 12px ${isOpen ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
            opacity: triggerBusy ? 0.7 : 1,
          }}>
          {triggerBusy ? "Sending..." : isOpen ? "Close Door" : "Open Door"}
        </button>
        {triggerMsg && (
          <span style={{
            fontSize: "0.82rem", fontWeight: 600,
            color: triggerMsg.includes("Error") ? "#dc2626" : "#059669",
          }}>
            {triggerMsg}
          </span>
        )}
      </div>
    </div>
  );
}

function CategoryCard({ category, sensors: list }) {
  if (list.length === 0) return null;
  const Icon = category.icon;

  return (
    <div style={{
      background: "white", borderRadius: 14, border: "1px solid #e2e8f0",
      boxShadow: "0 1px 3px rgba(0,0,0,0.07)", marginBottom: "1.25rem", overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "0.85rem",
        padding: "1rem 1.25rem",
        borderBottom: "1px solid #f1f5f9",
        background: `${category.color}0a`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: `${category.color}22`, color: category.color, fontSize: "1rem",
        }}>
          <Icon />
        </div>
        <h3 style={{ margin: 0, fontWeight: 700, color: "#1e293b", fontSize: "1rem" }}>
          {category.label}
          <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: "0.8rem", marginLeft: 8 }}>
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
  const { sensors, garage, loading, triggerGarageDoor, triggerBusy, triggerMsg, refetch } = useSensors();

  if (loading) return <Spinner message="Loading sensors..." />;

  // Remove garage from the generic sensor grid — it has its own card
  const { garage: _garageList, ...restSensors } = categorizeSensors(sensors);
  const categorized = categorizeSensors(restSensors);
  const hasAnySensor = Object.values(sensors).length > 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1e293b", margin: 0 }}>Sensors</h1>
          <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem" }}>
            Live readings from Pi GPIO and ESP32
          </p>
        </div>
        <button
          onClick={refetch}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem",
            background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8,
            cursor: "pointer", color: "#64748b", fontWeight: 600, fontSize: "0.85rem",
          }}>
          <FaSync style={{ fontSize: "0.8rem" }} /> Refresh
        </button>
      </div>

      {/* Garage — always shown, even if status unknown */}
      <GarageCard
        garage={garage}
        onTrigger={triggerGarageDoor}
        triggerBusy={triggerBusy}
        triggerMsg={triggerMsg}
      />

      {/* Other sensor categories */}
      {!hasAnySensor && (
        <div style={{
          textAlign: "center", padding: "3rem", color: "#94a3b8",
          background: "white", borderRadius: 14, border: "1px solid #e2e8f0",
        }}>
          <FaWifi style={{ fontSize: "2.5rem", marginBottom: "0.75rem", opacity: 0.4 }} />
          <p style={{ fontWeight: 600, margin: 0 }}>No sensor data yet</p>
          <p style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
            Sensors will appear here once the Pi GPIO or ESP32 starts reporting.
          </p>
        </div>
      )}

      {CATEGORIES.filter(c => c.key !== "garage").map(cat => (
        <CategoryCard
          key={cat.key}
          category={cat}
          sensors={categorized[cat.key] || []}
        />
      ))}
    </div>
  );
}
