import { FaMinus, FaPlus } from "react-icons/fa";

const START_ANGLE = 135;   // degrees, 0 = 3 o'clock, clockwise
const SWEEP = 270;

function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const clampedEnd = Math.max(startAngle, Math.min(endAngle, startAngle + SWEEP));
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, clampedEnd);
  const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * Circular speedometer-style dial for one HVAC zone.
 * @param {number|null} current  Live temperature, or null if no sensor data yet.
 * @param {number} target        Target/setpoint temperature.
 * @param {boolean} on            Whether the zone is enabled (gray when off).
 * @param {boolean} calling       Whether the zone is actively calling for heat.
 * @param {(delta:number)=>void} onStep  Called with +1/-1 to nudge the target.
 */
export default function ThermoDial({
  current, target, on, calling, onStep,
  min = 50, max = 90, size = 200,
}) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 14;
  const gradId = `dial-grad-${Math.round(cx * 1000 + cy)}`;

  const toAngle = v => START_ANGLE + (Math.max(min, Math.min(max, v)) - min) / (max - min) * SWEEP;

  const trackPath = arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP);
  const currentAngle = current != null ? toAngle(current) : START_ANGLE;
  const fillPath = arcPath(cx, cy, r, START_ANGLE, currentAngle);
  const targetAngle = toAngle(target);
  const targetPoint = polarToXY(cx, cy, r, targetAngle);

  const trackColor = on ? "#e2e8f0" : "#e5e7eb";
  const fillStroke = on ? `url(#${gradId})` : "#cbd5e1";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="55%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          <path d={trackPath} fill="none" stroke={trackColor} strokeWidth={14} strokeLinecap="round" />

          {current != null && (
            <path d={fillPath} fill="none" stroke={fillStroke} strokeWidth={14} strokeLinecap="round"
              style={{ transition: "d 0.4s ease" }} />
          )}

          {/* Target marker */}
          <circle cx={targetPoint.x} cy={targetPoint.y} r={9}
            fill="white" stroke={on ? "#1e293b" : "#94a3b8"} strokeWidth={3} />
        </svg>

        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: size * 0.19, fontWeight: 700, color: on ? "#1e293b" : "#9ca3af", lineHeight: 1 }}>
            {Math.round(target)}°
          </div>
          <div style={{ fontSize: size * 0.075, color: "#94a3b8", marginTop: 4 }}>
            {current != null ? `now ${current.toFixed(1)}°` : "no reading"}
          </div>
          {on && (
            <div style={{
              marginTop: 6, fontSize: size * 0.06, fontWeight: 600,
              color: calling ? "#ef4444" : "#22c55e",
            }}>
              {calling ? "Heating" : "Idle"}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button onClick={() => onStep(-1)} disabled={!on} style={stepBtnStyle(on)}>
          <FaMinus size={12} />
        </button>
        <button onClick={() => onStep(1)} disabled={!on} style={stepBtnStyle(on)}>
          <FaPlus size={12} />
        </button>
      </div>
    </div>
  );
}

function stepBtnStyle(on) {
  return {
    width: 34, height: 34, borderRadius: "50%", border: "none",
    background: on ? "#f1f5f9" : "#f8fafc", color: on ? "#334155" : "#cbd5e1",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: on ? "pointer" : "not-allowed", transition: "background 0.15s",
  };
}
