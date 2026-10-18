import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { FaChevronLeft, FaChevronRight, FaChartLine } from "react-icons/fa";
import { getZoneHistory } from "../api";
import { colors, card } from "../styles/tokens";

const MAX_DAYS_BACK = 6; // 7 days of history total (today + 6 back) — matches zoneHistory.js's 7-day TTL

function dayBounds(dayOffset) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - dayOffset);
  const startMs = start.getTime();
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

function dayLabel(dayOffset) {
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Yesterday";
  const { startMs } = dayBounds(dayOffset);
  return new Date(startMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hourTick(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric" });
}

function CallingStat({ label, analysis, tint }) {
  if (!analysis || analysis.cycleCount === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 120 }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: "1.1rem", fontWeight: 800, color: tint }}>{analysis.dutyCyclePercent}%</span>
      <span style={{ fontSize: "0.72rem", color: colors.textMuted }}>
        {analysis.cycleCount} cycle{analysis.cycleCount === 1 ? "" : "s"}, avg {analysis.avgCycleMinutes}m
      </span>
    </div>
  );
}

// Zone temperature history — a 24h window at a time, up to a week back
// (zoneHistory.js's own TTL bounds how much ever exists, so navigation
// just clamps at the same 7 days rather than needing its own limit
// re-derived here). Shaded bands mark when the zone was actually calling
// for heat/cooling; the blurb beneath is a deterministic read of that
// same window's duty cycle and cycle pattern, not a live recompute of
// anything — see zoneHistory.js's analyze() for the actual logic.
export default function ZoneHistoryChart({ zones }) {
  const [zoneId, setZoneId] = useState(zones[0]?.id);
  const [dayOffset, setDayOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!zoneId && zones[0]) setZoneId(zones[0].id);
  }, [zones, zoneId]);

  const { startMs, endMs } = useMemo(() => dayBounds(dayOffset), [dayOffset]);

  const fetchHistory = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await getZoneHistory(zoneId, startMs, endMs);
      setData(res);
    } catch (e) {
      console.error("ZoneHistoryChart:", e);
      setError("Couldn't load history for this zone.");
    } finally {
      setLoading(false);
    }
  }, [zoneId, startMs, endMs]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  if (!zones.length) return null;

  const points = (data?.points ?? []).map(p => ({ ...p, currentTemp: p.currentTemp ?? null }));
  const hasPoints = points.length > 0;

  return (
    <div style={{ ...card, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaChartLine color={colors.textMuted} /> Zone History
        </h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {zones.map(z => (
            <button key={z.id} onClick={() => setZoneId(z.id)} style={{
              padding: "0.35rem 0.75rem", borderRadius: 999, border: "none", cursor: "pointer",
              fontSize: "0.78rem", fontWeight: 600,
              background: zoneId === z.id ? colors.accent : colors.surfaceAlt,
              color: zoneId === z.id ? "white" : colors.textSecondary,
            }}>
              {z.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: "0.75rem" }}>
        <button onClick={() => setDayOffset(d => Math.min(d + 1, MAX_DAYS_BACK))} disabled={dayOffset >= MAX_DAYS_BACK}
          aria-label="Previous day" style={navBtnStyle(dayOffset >= MAX_DAYS_BACK)}>
          <FaChevronLeft size={12} />
        </button>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: colors.textPrimary, minWidth: 120, textAlign: "center" }}>
          {dayLabel(dayOffset)}
        </span>
        <button onClick={() => setDayOffset(d => Math.max(d - 1, 0))} disabled={dayOffset <= 0}
          aria-label="Next day" style={navBtnStyle(dayOffset <= 0)}>
          <FaChevronRight size={12} />
        </button>
      </div>

      {loading ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: colors.textMuted, fontSize: "0.85rem" }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: colors.danger, fontSize: "0.85rem" }}>
          {error}
        </div>
      ) : !hasPoints ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: colors.textMuted, fontSize: "0.85rem" }}>
          No data logged for this zone on {dayLabel(dayOffset).toLowerCase()}.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
            <XAxis
              dataKey="t" type="number" domain={[startMs, endMs]}
              ticks={Array.from({ length: 5 }, (_, i) => startMs + i * 6 * 60 * 60 * 1000)}
              tickFormatter={hourTick} stroke={colors.textMuted} fontSize={11}
            />
            <YAxis stroke={colors.textMuted} fontSize={11} width={36} unit="°" domain={["auto", "auto"]} />
            <Tooltip
              labelFormatter={(ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              formatter={(value, name) => [value == null ? "no reading" : `${value.toFixed(1)}°`, name]}
              contentStyle={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: "0.78rem" }}
            />
            {data?.heat?.segments.map((seg, i) => (
              <ReferenceArea key={`heat-${i}`} x1={seg.start} x2={seg.end} fill="#fb923c" fillOpacity={0.18} ifOverflow="extendDomain" />
            ))}
            {data?.cool?.segments.map((seg, i) => (
              <ReferenceArea key={`cool-${i}`} x1={seg.start} x2={seg.end} fill="#60a5fa" fillOpacity={0.18} ifOverflow="extendDomain" />
            ))}
            <Line type="monotone" dataKey="currentTemp" name="Current" stroke={colors.accent} strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="stepAfter" dataKey="target" name="Target" stroke={colors.textMuted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {hasPoints && (data?.heat?.cycleCount > 0 || data?.cool?.cycleCount > 0) && (
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", margin: "1rem 0 0.75rem" }}>
          <CallingStat label="Heat duty cycle" analysis={data.heat} tint="#ea580c" />
          <CallingStat label="Cool duty cycle" analysis={data.cool} tint="#2563eb" />
        </div>
      )}

      {hasPoints && (
        <div style={{
          background: colors.surfaceAlt, borderRadius: 10, padding: "0.85rem 1rem",
          fontSize: "0.82rem", color: colors.textSecondary, lineHeight: 1.5,
        }}>
          {data.heat.cycleCount > 0 ? data.heat.blurb : (data.cool.cycleCount > 0 ? data.cool.blurb : data.heat.blurb)}
        </div>
      )}
    </div>
  );
}

function navBtnStyle(disabled) {
  return {
    width: 30, height: 30, borderRadius: 8, border: "none",
    background: colors.surfaceAlt, color: disabled ? colors.textMuted : colors.textSecondary,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}
