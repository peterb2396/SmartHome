/**
 * Outdoor-Temperature Economizer Gate
 * ─────────────────────────────────────────────────────────────────
 * Decides which of heat/cool is even ALLOWED to run right now, by
 * comparing the outdoor temperature to a zone's target — independent of
 * which specific plant (air handler vs boiler) would deliver it. Shared by
 * thermostat.js (air heat + all cooling) and boiler.js (gas heat), the same
 * way scheduleUtil.js is shared by both for schedule/override resolution.
 *
 * The reasoning, per direct instruction: if it's warmer outside than the
 * target, a zone sitting below target will drift UP toward it for free as
 * the house picks up outdoor heat — there's no reason to ever run active
 * heat in that weather, so heat is disallowed; only cooling (for a zone
 * that's ABOVE target and won't cool itself) is allowed. Symmetric the
 * other way: colder outside than target means a zone above target drifts
 * DOWN for free, so cooling is disallowed and only heat is allowed. This is
 * what actually prevents a heat-then-immediately-cool ping-pong — the two
 * are mutually exclusive per outdoor condition, not just separated by a
 * deadband that a temperature swing could still cross both sides of.
 *
 * Falls back to allowing BOTH whenever outdoor data is missing/stale — a
 * weather API outage must never leave a zone with NO climate control at
 * all. This gate is an efficiency optimization, not a safety mechanism —
 * the hard safety floor/ceiling in both callers is checked separately,
 * AFTER this, and always wins outright regardless of what this returns.
 */
function allowedModes(outdoorF, outdoorStale, target) {
  if (outdoorF == null || outdoorStale) return { heatAllowed: true, coolAllowed: true };
  if (outdoorF > target) return { heatAllowed: false, coolAllowed: true };
  if (outdoorF < target) return { heatAllowed: true, coolAllowed: false };
  return { heatAllowed: true, coolAllowed: true }; // exactly equal — genuinely ambiguous, don't block either
}

module.exports = { allowedModes };
