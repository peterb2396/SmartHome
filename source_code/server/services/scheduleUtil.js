/**
 * Schedule Resolution
 * ─────────────────────────────────────────────────────────────────
 * Pure, zone-system-agnostic weekly-schedule + manual-hold resolution.
 * Shared by thermostat.js (4-zone air handler) and boiler.js (3-zone gas
 * boiler) — both use the identical zone-settings shape
 * `{ target, schedule: [{day, start, end, target}], override: {target,
 * untilTime} | null }`, so this logic only needs to exist once.
 */

const moment = require('moment');

function dayMatches(blockDay, dow) {
  return blockDay === 'all' || blockDay === dow;
}

// A block whose end time is not after its start time (e.g. 22:00–06:00)
// spans midnight — it's scheduled for one calendar day but is still active
// into the next. Plain string comparison on "now falls between start and
// end" only works within a single day, so a wrapping block needs to be
// checked from both sides: "started tonight" (today's date matches the
// block's day, and we're at/after its start) or "carried over from last
// night" (yesterday's date matched the block's day, and we're still before
// its end).
function blockActiveAt(b, now) {
  const dow = now.day();
  const hm = now.format('HH:mm');
  const wraps = b.end <= b.start;
  if (!wraps) {
    return dayMatches(b.day, dow) && hm >= b.start && hm < b.end;
  }
  const yesterday = (dow + 6) % 7;
  const startedTonight       = dayMatches(b.day, dow) && hm >= b.start;
  const carriedFromLastNight = dayMatches(b.day, yesterday) && hm < b.end;
  return startedTonight || carriedFromLastNight;
}

function matchingBlock(schedule, now) {
  const matches = (schedule || []).filter(b => blockActiveAt(b, now));
  return matches.length ? matches[matches.length - 1] : null;
}

// When does "right now" — whichever block (or gap between blocks) we're
// currently in — end? A manual hold created now should last exactly until
// this absolute moment, then release. Returns an ISO string, or null if the
// schedule has no blocks at all (nothing to hand off to, ever — hold stands
// until manually changed again).
//
// This MUST be an absolute timestamp rather than a "which block/gap is this"
// identity — a gap has no distinguishing features of its own (any gap looks
// like any other gap), so identity-based comparison would let a hold set
// during one gap silently reactivate during a LATER, unrelated gap once
// enough real time had passed for it to roll around again. An absolute
// expiry moment can only ever be crossed once, since time only moves forward.
function nextBoundary(schedule, now) {
  const active = matchingBlock(schedule, now);
  if (active) {
    const [hh, mm] = active.end.split(':').map(Number);
    const endMoment = moment(now).hours(hh).minutes(mm).seconds(0).milliseconds(0);
    // A wrapping block's end time (e.g. the "06:00" in 22:00–06:00) refers
    // to tomorrow morning if we're still in tonight's portion of it — only
    // when we've already carried over past midnight does "today at end
    // time" mean the actual end.
    const wraps = active.end <= active.start;
    const hm = now.format('HH:mm');
    if (wraps && hm >= active.start) endMoment.add(1, 'day');
    return endMoment.toISOString();
  }
  // In a gap — find the soonest upcoming block start, scanning up to a week
  // ahead (covers day-specific blocks that haven't come around yet).
  let soonest = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = moment(now).add(dayOffset, 'days');
    const dow = day.day();
    for (const b of (schedule || [])) {
      if (b.day !== 'all' && b.day !== dow) continue;
      const [hh, mm] = b.start.split(':').map(Number);
      const startMoment = moment(day).hours(hh).minutes(mm).seconds(0).milliseconds(0);
      if (startMoment.isAfter(now) && (!soonest || startMoment.isBefore(soonest))) {
        soonest = startMoment;
      }
    }
  }
  return soonest ? soonest.toISOString() : null;
}

function overrideActive(zoneSettings, now) {
  const ov = zoneSettings.override;
  if (!ov) return false;
  return !ov.untilTime || moment(now).isBefore(ov.untilTime);
}

// The target actually in effect right now: a manual hold (if one is set and
// hasn't reached its expiry moment yet), else whatever the schedule says for
// this moment, else the zone's base target.
function resolveTarget(zoneSettings, now, fallback = 68) {
  if (overrideActive(zoneSettings, now)) return zoneSettings.override.target;
  const block = matchingBlock(zoneSettings.schedule, now);
  return block ? block.target : (zoneSettings.target ?? fallback);
}

function isOverridden(zoneSettings, now) {
  return overrideActive(zoneSettings, now);
}

// Is `now` inside an actual scheduled block for this zone (as opposed to a
// gap, regardless of whether a manual hold happens to also be active)? Used
// by the seasonal zone-system swap to decide whether it's safe to remap a
// zone's target — a zone mid-schedule-block shouldn't get its temperature
// silently rewritten out from under the block that's driving it.
function inScheduledBlock(zoneSettings, now) {
  return matchingBlock(zoneSettings.schedule, now) !== null;
}

module.exports = {
  dayMatches, blockActiveAt, matchingBlock, nextBoundary,
  overrideActive, resolveTarget, isOverridden, inScheduledBlock,
};
