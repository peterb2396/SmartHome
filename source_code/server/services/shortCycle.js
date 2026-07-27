/**
 * Short-Cycle Prevention
 * ─────────────────────────────────────────────────────────────────
 * Generic minimum-run-time gate shared by every piece of equipment that
 * shouldn't be rapidly cycled — the air handler's compressor (thermostat.js)
 * and the boiler's circulator/enable relay (boiler.js). Rapidly cycling a
 * compressor or a boiler burns/wears it out and wastes energy; this holds a
 * requested on/off transition until the equipment has spent at least
 * `minOnMs`/`minOffMs` in its current state.
 *
 * `state` is a plain object the caller owns and persists across ticks:
 * `{ on: boolean, lastOnAt: number, lastOffAt: number }`. Treat process
 * boot as equivalent to "just turned off" (initialize lastOffAt to the
 * boot timestamp) so a restart or power outage can't immediately slam
 * equipment back on ahead of its own minimum-off timer.
 */

function applyMinRunTime(state, wantOn, now, minOnMs, minOffMs) {
  if (wantOn === state.on) return state.on;
  if (wantOn) {
    if (now - state.lastOffAt >= minOffMs) {
      state.on = true;
      state.lastOnAt = now;
    }
  } else {
    if (now - state.lastOnAt >= minOnMs) {
      state.on = false;
      state.lastOffAt = now;
    }
  }
  return state.on;
}

module.exports = { applyMinRunTime };
