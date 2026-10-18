/**
 * Zone History
 * ─────────────────────────────────────────────────────────────────
 * Logs a `{currentTemp, target, calling, coolCalling}` snapshot per zone
 * on every thermostat.js tick (~30s cadence — see its own call site),
 * sourced from the SAME unified getState() merge thermostat.js already
 * uses for the web app/dial (so "calling" here always means whichever
 * plant — air handler or boiler — is actually serving that zone right
 * now, never a stale/plant-specific internal flag).
 *
 * Storage: its own Mongo collection, not the shared settings blob — this
 * is genuine time-series data, not configuration. A TTL index on `t`
 * auto-expires anything older than 7 days, matching the "view a week of
 * history at most" requirement exactly — nothing here ever needs manual
 * cleanup or grows unbounded.
 *
 * getHistoryWithAnalysis() does double duty: the raw points for charting,
 * PLUS a rule-based efficiency read of that same window (duty cycle,
 * cycle count, short-cycling) — see analyze()'s own comments for the
 * thresholds and why they're set where they are. This is a deterministic
 * summary, not a model — same number of cycles always produces the same
 * verdict.
 */

const mongoose = require('mongoose');

const zoneHistorySchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  t: { type: Date, required: true },
  currentTemp: Number, // null when the zone had no reading at log time
  target: Number,
  calling: Boolean,
  coolCalling: Boolean,
});
zoneHistorySchema.index({ zoneId: 1, t: 1 });
// TTL index — MongoDB's background TTL monitor deletes documents once
// `t` is this many seconds in the past, checked roughly once a minute.
// 7 days, matching the UI's own "at most a week back" limit — there is
// deliberately no separate cleanup job anywhere else in this app.
zoneHistorySchema.index({ t: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
const ZoneHistory = mongoose.model('ZoneHistory', zoneHistorySchema);

// entries: [{ zoneId, currentTemp, target, calling, coolCalling }] — one
// per zone, same timestamp for all (one tick = one moment in time).
// Fire-and-forget from the caller's perspective (errors are logged, never
// thrown) — a missed history write should never be allowed to break the
// actual heat-call logic that's calling this.
async function logSnapshot(entries) {
  try {
    const t = new Date();
    await ZoneHistory.insertMany(entries.map(e => ({ ...e, t })));
  } catch (err) {
    console.error('[ZoneHistory] Failed to log snapshot:', err.message);
  }
}

// A heating/cooling cycle shorter than this is flagged as "short" — 10
// minutes is a standard rule of thumb for residential HVAC short-cycling
// concern (frequent sub-10-minute runs mean more startup losses and wear
// relative to the useful runtime than one long steady call gets).
const SHORT_CYCLE_MINUTES = 10;
// A gap between consecutive log points bigger than this (server down,
// bus outage, etc.) is excluded from both the duty-cycle denominator and
// any in-progress cycle — we genuinely don't know what happened during
// it, so guessing either way would misrepresent the window.
const MAX_GAP_MS = 5 * 60 * 1000;

// Pure function, no I/O — takes the raw point list (sorted ascending by
// `t`) and returns the chart-ready segments plus the rule-based verdict.
// `kind`: 'calling' or 'coolCalling' — which boolean field to analyze;
// called once per heat and, separately, once for cool if ever needed.
function analyze(points, kind) {
  const segments = [];
  let totalActiveMs = 0, totalWindowMs = 0;
  let cycleCount = 0, shortCycleCount = 0, totalCycleMs = 0;
  let activeStart = null;

  for (let i = 0; i < points.length - 1; i++) {
    const cur = points[i], next = points[i + 1];
    const dt = next.t.getTime() - cur.t.getTime();
    if (dt <= 0 || dt > MAX_GAP_MS) {
      // Gap (or clock weirdness) — close out any in-progress run right
      // where the data stops, rather than bridging across the unknown.
      if (activeStart !== null) {
        const end = cur.t.getTime();
        segments.push({ start: activeStart, end });
        cycleCount++;
        const lenMs = end - activeStart;
        totalCycleMs += lenMs;
        if (lenMs < SHORT_CYCLE_MINUTES * 60 * 1000) shortCycleCount++;
        activeStart = null;
      }
      continue;
    }
    totalWindowMs += dt;
    if (cur[kind]) totalActiveMs += dt;

    if (cur[kind] && activeStart === null) {
      activeStart = cur.t.getTime();
    } else if (!cur[kind] && activeStart !== null) {
      const end = cur.t.getTime();
      segments.push({ start: activeStart, end });
      cycleCount++;
      const lenMs = end - activeStart;
      totalCycleMs += lenMs;
      if (lenMs < SHORT_CYCLE_MINUTES * 60 * 1000) shortCycleCount++;
      activeStart = null;
    }
  }
  // Still active at the end of the window — close it out at the last point.
  if (activeStart !== null && points.length > 0) {
    const end = points[points.length - 1].t.getTime();
    segments.push({ start: activeStart, end });
    cycleCount++;
    const lenMs = end - activeStart;
    totalCycleMs += lenMs;
    if (lenMs < SHORT_CYCLE_MINUTES * 60 * 1000) shortCycleCount++;
  }

  const dutyCyclePercent = totalWindowMs > 0 ? (totalActiveMs / totalWindowMs) * 100 : 0;
  const avgCycleMinutes = cycleCount > 0 ? (totalCycleMs / cycleCount) / 60000 : 0;
  const shortCycleFraction = cycleCount > 0 ? shortCycleCount / cycleCount : 0;

  return {
    segments,
    dutyCyclePercent: Math.round(dutyCyclePercent * 10) / 10,
    cycleCount,
    shortCycleCount,
    avgCycleMinutes: Math.round(avgCycleMinutes * 10) / 10,
    blurb: buildBlurb({ dutyCyclePercent, cycleCount, shortCycleCount, shortCycleFraction, avgCycleMinutes }),
  };
}

// Deterministic, rule-based — not trying to be clever, just surfacing
// the two things that actually matter for efficiency: how MUCH it ran
// (duty cycle) and whether it ran in a healthy PATTERN (long steady
// cycles vs. frequent short ones). Order matters — short-cycling is
// checked first since it's the most actionable/concerning finding
// regardless of duty cycle.
function buildBlurb({ dutyCyclePercent, cycleCount, shortCycleCount, shortCycleFraction, avgCycleMinutes }) {
  const pct = dutyCyclePercent.toFixed(1);
  if (cycleCount === 0) {
    return 'No heating activity in this window — the zone stayed within its comfort band the whole time without calling for heat once.';
  }
  // Noise guard: with only 1-2 cycles total, one short one isn't a real
  // pattern yet — needs at least 3 cycles before "40% were short" means
  // anything.
  if (cycleCount >= 3 && shortCycleFraction > 0.4) {
    return `Short-cycling detected — ${shortCycleCount} of ${cycleCount} heating cycles lasted under ${SHORT_CYCLE_MINUTES} minutes. `
      + 'This usually means the comfort deadband is too tight, a sensor is reacting to a nearby draft, or the equipment is oversized for '
      + 'this zone — frequent short cycles waste energy on startup losses and add equipment wear compared to fewer, longer runs. '
      + 'Consider widening the deadband slightly, or checking for drafts right around the sensor.';
  }
  if (dutyCyclePercent > 60) {
    return `This zone called for heat ${pct}% of the day across ${cycleCount} cycle${cycleCount === 1 ? '' : 's'} `
      + `(avg ${avgCycleMinutes.toFixed(0)} min each) — well above typical. Worth checking for heat loss (drafts, thin insulation, a door `
      + 'left open) in this zone, or whether its target is set higher than actually needed for current conditions.';
  }
  if (dutyCyclePercent < 5) {
    return `Efficient — only ${pct}% of the day spent actively calling for heat, across ${cycleCount} cycle${cycleCount === 1 ? '' : 's'} `
      + `averaging ${avgCycleMinutes.toFixed(0)} minutes each.`;
  }
  return `${pct}% of the day spent calling for heat across ${cycleCount} cycle${cycleCount === 1 ? '' : 's'} `
    + `(avg ${avgCycleMinutes.toFixed(0)} min each) — within a normal, efficient range. No short-cycling or excessive runtime detected.`;
}

async function getHistoryWithAnalysis(zoneId, fromMs, toMs) {
  const points = await ZoneHistory.find({
    zoneId, t: { $gte: new Date(fromMs), $lte: new Date(toMs) },
  }).sort({ t: 1 }).lean();

  const heat = analyze(points, 'calling');
  const cool = analyze(points, 'coolCalling');

  return {
    points: points.map(p => ({
      t: p.t.getTime(), currentTemp: p.currentTemp, target: p.target,
      calling: !!p.calling, coolCalling: !!p.coolCalling,
    })),
    heat,
    cool,
  };
}

module.exports = { logSnapshot, getHistoryWithAnalysis, analyze };
