import { useRef, useState, useCallback } from "react";
import { FaMinus, FaPlus } from "react-icons/fa";

const START_ANGLE = 135;   // degrees, 0 = 3 o'clock, clockwise
const SWEEP = 270;
const GAP_MID = START_ANGLE + SWEEP + (360 - SWEEP) / 2; // midpoint of the closed-off bottom gap

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

// Inverse of value->angle: given a pointer angle (0-360, 0 = 3 o'clock,
// clockwise), work out which temperature that corresponds to. Angles that
// fall in the closed-off gap at the bottom snap to whichever end is closer,
// like grabbing past the stop on a real dial.
function angleToValue(angleDeg, min, max) {
  let rel = angleDeg - START_ANGLE;
  if (rel < 0) rel += 360;
  if (rel > SWEEP) {
    return rel < GAP_MID - START_ANGLE ? max : min;
  }
  return min + (rel / SWEEP) * (max - min);
}

/**
 * Circular speedometer-style dial for one HVAC zone. Every zone is always
 * actively regulated toward its target — there's no on/off/mode — so the
 * dial is always "live"; only the status text changes (Heating/Cooling/Idle,
 * or a safety override). The target can be set via the +/- buttons or by
 * dragging anywhere along the arc.
 * @param {number|null} current  Live temperature, or null if no sensor data yet.
 * @param {number} target        Target/setpoint temperature.
 * @param {boolean} calling       Whether the zone is actively calling for heat.
 * @param {boolean} coolCalling   Whether the zone is actively calling for cooling.
 * @param {'normal'|'below-min'|'above-max'} safety  Hard-limit override state.
 * @param {(delta:number)=>void} onStep  Called with +1/-1 to nudge the target.
 * @param {(value:number)=>void} onCommit  Called with the new target once a drag ends (or a tap).
 */
export default function ThermoDial({
  current, target, calling, coolCalling, safety = "normal", onStep, onCommit,
  min = 60, max = 75, size = 200,
}) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 14;
  const gradId = `dial-grad-${Math.round(cx * 1000 + cy)}`;
  const svgRef = useRef(null);
  const [dragValue, setDragValue] = useState(null); // non-null while actively dragging

  const displayTarget = dragValue ?? target;

  // Ring-only hit zone — ignores taps near the center (the temperature
  // text) so they don't get misread as a drag-to-zero-ish angle.
  const valueFromPointer = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = clientX - (rect.left + rect.width / 2);
    const py = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(px, py);
    if (dist < r * 0.45) return null; // too close to center, not on the ring
    let angle = (Math.atan2(py, px) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    const raw = angleToValue(angle, min, max);
    return Math.round(Math.min(max, Math.max(min, raw)));
  }, [min, max, r]);

  const handlePointerDown = useCallback((e) => {
    const value = valueFromPointer(e.clientX, e.clientY);
    if (value == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragValue(value);
  }, [valueFromPointer]);

  const handlePointerMove = useCallback((e) => {
    if (dragValue == null) return;
    const value = valueFromPointer(e.clientX, e.clientY);
    if (value != null) setDragValue(value);
  }, [dragValue, valueFromPointer]);

  const endDrag = useCallback((e) => {
    if (dragValue == null) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onCommit?.(dragValue);
    setDragValue(null);
  }, [dragValue, onCommit]);

  const toAngle = v => START_ANGLE + (Math.max(min, Math.min(max, v)) - min) / (max - min) * SWEEP;

  const trackPath = arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP);
  const currentAngle = current != null ? toAngle(current) : START_ANGLE;
  const fillPath = arcPath(cx, cy, r, START_ANGLE, currentAngle);
  const targetAngle = toAngle(displayTarget);
  const targetPoint = polarToXY(cx, cy, r, targetAngle);

  let statusText, statusColor;
  if (safety === "below-min") {
    statusText = "Freeze Protection"; statusColor = "#ef4444";
  } else if (safety === "above-max") {
    statusText = "Safety Cooling"; statusColor = "#3b82f6";
  } else {
    statusText = coolCalling ? "Cooling" : calling ? "Heating" : "Idle";
    statusColor = coolCalling ? "#3b82f6" : calling ? "#ef4444" : "#22c55e";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg
          ref={svgRef}
          width={size} height={size}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ touchAction: "none", cursor: dragValue != null ? "grabbing" : "grab" }}
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="55%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          <path d={trackPath} fill="none" stroke="#e2e8f0" strokeWidth={14} strokeLinecap="round" />

          {current != null && (
            <path d={fillPath} fill="none" stroke={`url(#${gradId})`} strokeWidth={14} strokeLinecap="round"
              style={{ transition: dragValue == null ? "d 0.4s ease" : "none" }} />
          )}

          {/* Target marker — bigger + no transition while actively dragging, so it tracks the pointer exactly */}
          <circle cx={targetPoint.x} cy={targetPoint.y} r={dragValue != null ? 11 : 9}
            fill="white" stroke="#1e293b" strokeWidth={3}
            style={{ transition: dragValue == null ? "cx 0.15s, cy 0.15s" : "none" }} />
        </svg>

        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: size * 0.19, fontWeight: 700, color: "#1e293b", lineHeight: 1 }}>
            {Math.round(displayTarget)}°
          </div>
          <div style={{ fontSize: size * 0.075, color: "#94a3b8", marginTop: 4 }}>
            {current != null ? `now ${current.toFixed(1)}°` : "no reading"}
          </div>
          <div style={{
            marginTop: 6, fontSize: size * 0.06, fontWeight: 700,
            color: statusColor,
          }}>
            {statusText}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button onClick={() => onStep(-1)} style={stepBtnStyle}>
          <FaMinus size={12} />
        </button>
        <button onClick={() => onStep(1)} style={stepBtnStyle}>
          <FaPlus size={12} />
        </button>
      </div>
    </div>
  );
}

const stepBtnStyle = {
  width: 34, height: 34, borderRadius: "50%", border: "none",
  background: "#f1f5f9", color: "#334155",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", transition: "background 0.15s",
};
