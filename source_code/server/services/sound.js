/**
 * Sound Service
 * ─────────────────────────────────────────────────────────────────
 * Each zone's physical audio hardware (a "zoneAudio" RS485 node — see
 * rs485.js's protocol header) has 2 audio inputs wired in and 3 priority
 * TIERS, LOCAL hardware-level switching:
 *   0 (lowest)  Spotify       — the shared Pi line-out, present only if
 *                               this zone has Spotify enabled
 *   1           Override1     — a LOCAL input, e.g. that room's TV audio
 *                               out, wired straight into the zone box
 *   2 (highest) Announcement  — the SAME shared Pi line-out as Spotify,
 *                               just flagged as top-priority for this zone
 *                               right now (announcementActive) — there's
 *                               no second physical "alarm" wire; targeting
 *                               specific zones is just which zones have
 *                               that flag set, see setAnnouncementTargets()
 *
 * The zone hardware itself decides which input is actually audible, by
 * locally detecting signal presence on the local override1 input and by
 * reading the spotifyEnabled/announcementActive flags this server pushes
 * down each poll — the same "must keep working with zero WiFi/server
 * dependency" requirement the HVAC dial protocol was built around applies
 * to override1 here too: turning a TV on has to instantly win over
 * Spotify with no round-trip to this server. This service and the RS485
 * link to each zone are NOT in the override1-vs-Spotify decision path at
 * all — announcements are the one exception, since "which zones" is
 * inherently a server-side decision, not something a zone box can sense
 * locally. Their job:
 *   - tell each zone whether Spotify is allowed to be its lowest-priority
 *     input right now (setZoneEnabled() below — the web/dial "zone on/off"
 *     control is strictly a Spotify gate, never touches override1; the TV
 *     in a room always works whether or not anyone's ever opened this app)
 *   - tell each zone whether IT is a current announcement target
 *     (setAnnouncementTargets() below — not yet wired to actually playing
 *     announcement audio on the Pi's output; that's a separate future
 *     piece, this is just the per-zone targeting plumbing for it)
 *   - carry that zone's desired Spotify volume down
 *   - receive back which input the hardware is CURRENTLY actually playing
 *     (reportActiveSource(), called by rs485.js after each poll reply),
 *     purely for display on the web app / dial — read-only from here,
 *     never commanded
 *
 * activeSource is therefore live hardware-observed state, not a user
 * preference — kept in an in-memory Map like lutron.js's deviceState, not
 * in the persisted settings blob (volumePercent/spotifyEnabled ARE user
 * preferences and go through the normal settings-blob pattern below, same
 * as boiler.js/thermostat.js). announcementTargets is also in-memory only
 * (not a saved preference — an announcement is inherently transient).
 *
 * Zone ids are audio-zone-specific, deliberately NOT shared with
 * thermostat.js's 4 air-handler zones — audio zoning follows room-by-room
 * speaker wiring, HVAC zoning follows ductwork, and this house's actual
 * rooms don't line up 1:1 with its duct zones. A dial node that controls
 * both needs a thermostat zoneId AND a sound-zone id — see
 * nodeRegistry.js's `soundZoneId` field.
 *
 * ── Location presets ("Spotify Downstairs/Upstairs/Outside") ────────────
 * Every zone belongs to exactly one of 3 physical locations (see LOCATIONS
 * below) — purely a grouping/UX concept, no protocol meaning. A location
 * preset is a toggle over its member zones' spotifyEnabled, all together:
 *   - if every zone in the location is currently enabled, the preset turns
 *     them all OFF (and touches nothing else)
 *   - otherwise (off, or a mixed state) it turns them all ON, AND turns
 *     every zone NOT in this location off too — this only happens on the
 *     turning-on branch, never on turning-off. Matches spotify.js's "one
 *     shared stream" constraint: since every enabled zone hears the exact
 *     same audio, having two locations enabled at once means they're
 *     forced to share one stream anyway, so a location preset is really
 *     "move the party here," not an additive toggle.
 */

const settingsSvc = require('./settings');

const MIN_VOLUME = 0;
const MAX_VOLUME = 100;

// Matches the wire values rs485.js's ZONE_AUDIO_STATE parsing uses —
// keep in sync with that file's ACTIVE_SOURCE map.
const ACTIVE_SOURCE_NAME = { 0: 'off', 1: 'spotify', 2: 'override1', 3: 'override2' };

const LOCATIONS = [
  { id: 'downstairs', label: 'Downstairs' },
  { id: 'upstairs',   label: 'Upstairs' },
  { id: 'outside',    label: 'Outside' },
];
const LOCATION_IDS = new Set(LOCATIONS.map(l => l.id));

// Declared grouped by location on purpose — every place this iterates
// ZONES in order (getState(), etc.) gives an already-location-sorted list
// for free, not just the explicit per-location grouping the frontend does.
const ZONES = [
  // Downstairs
  { id: 'lounge',           label: 'Lounge',           location: 'downstairs' },
  { id: 'office',           label: 'Office',           location: 'downstairs' },
  { id: 'kitchen',          label: 'Kitchen',          location: 'downstairs' },
  { id: 'great-room',       label: 'Great Room',       location: 'downstairs' },
  // Upstairs
  { id: 'primary-bedroom',  label: 'Primary Bedroom',  location: 'upstairs' },
  { id: 'primary-bathroom', label: 'Primary Bathroom', location: 'upstairs' },
  { id: 'foyer',            label: 'Foyer',            location: 'upstairs' },
  { id: 'bedroom-1',        label: 'Bedroom 1',        location: 'upstairs' },
  { id: 'bedroom-2',        label: 'Bedroom 2',        location: 'upstairs' },
  { id: 'hall-bathroom',    label: 'Hall Bathroom',    location: 'upstairs' },
  // Outside
  { id: 'pavillion',        label: 'Pavillion',        location: 'outside' },
  { id: 'stardeck',         label: 'Stardeck',         location: 'outside' },
  { id: 'driveway',         label: 'Driveway',         location: 'outside' },
];
const ZONE_IDS = new Set(ZONES.map(z => z.id));

const DEFAULT_SETTINGS = {
  zones: Object.fromEntries(ZONES.map(z => [z.id, { volumePercent: 30, spotifyEnabled: false }])),
};

// Live, hardware-reported — never persisted, never user-set directly.
// zoneId -> 'off'|'spotify'|'override1'|'override2'. Absent (not yet
// reported, e.g. no zoneAudio node configured for that zone) reads as
// 'off' via getState() below rather than throwing.
const activeSourceByZone = new Map();

// Which zones are current announcement targets — transient, in-memory
// only, see this file's header. Set of zoneId.
const announcementTargets = new Set();

function clampVolume(v) {
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(v)));
}

function getSettings() {
  const stored = settingsSvc.get()?.sound;
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    zones: Object.fromEntries(ZONES.map(z => [
      z.id,
      { ...DEFAULT_SETTINGS.zones[z.id], ...(stored.zones?.[z.id] || {}) },
    ])),
  };
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('sound', next);
}

function getState() {
  const settings = getSettings();
  return {
    zones: ZONES.map(zone => ({
      id: zone.id,
      label: zone.label,
      location: zone.location,
      volumePercent: settings.zones[zone.id].volumePercent,
      spotifyEnabled: settings.zones[zone.id].spotifyEnabled,
      activeSource: activeSourceByZone.get(zone.id) || 'off',
    })),
    locations: getLocations(settings),
  };
}

// allOn per location — the preset button's own on/off indicator, and what
// togglePreset() below flips. Accepts an already-loaded `settings` when a
// caller has one (togglePreset() does, to read pre- and post-toggle state
// without two Mongo round trips); loads its own otherwise.
function getLocations(settings = getSettings()) {
  return LOCATIONS.map(loc => {
    const zoneIds = ZONES.filter(z => z.location === loc.id).map(z => z.id);
    const allOn = zoneIds.length > 0 && zoneIds.every(id => settings.zones[id].spotifyEnabled);
    return { id: loc.id, label: loc.label, zoneIds, allOn };
  });
}

// Always absolute, never a delta — one function, three callers (the web
// API's POST /sound/zone/:id, rs485.js's dial volume handling, and the
// zoneAudio push payload builder below reads it back out). Same
// drop-a-frame-safe reasoning as thermostat.js's setZone()/target.
async function setZoneVolume(zoneId, volumePercent) {
  const settings = getSettings();
  if (!ZONE_IDS.has(zoneId)) throw new Error(`Unknown sound zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId], volumePercent: clampVolume(volumePercent) };
  await saveSettings({ ...settings, zones: { ...settings.zones, [zoneId]: zs } });
  return getState();
}

// The "zone on/off" control — strictly a Spotify gate, see this file's
// header. Called from the web API, and from a dial's tapEvent==3 on its
// Sound screen (see rs485.js's pollAllDials()).
async function setZoneEnabled(zoneId, enabled) {
  const settings = getSettings();
  if (!ZONE_IDS.has(zoneId)) throw new Error(`Unknown sound zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId], spotifyEnabled: !!enabled };
  await saveSettings({ ...settings, zones: { ...settings.zones, [zoneId]: zs } });
  return getState();
}

// "Spotify Downstairs/Upstairs/Outside" — see this file's header for the
// exact toggle rule. One atomic settings write regardless of how many
// zones change, same reasoning as settings.js's updateSettings() comment
// (multiple sequential writes for what's logically one change is how the
// SmartThings token pair got corrupted earlier — not repeating that here).
async function togglePreset(locationId) {
  if (!LOCATION_IDS.has(locationId)) throw new Error(`Unknown location ${locationId}`);
  const settings = getSettings();
  const inLocation = new Set(ZONES.filter(z => z.location === locationId).map(z => z.id));
  const currentlyAllOn = [...inLocation].every(id => settings.zones[id].spotifyEnabled);

  const nextZones = { ...settings.zones };
  for (const zone of ZONES) {
    if (inLocation.has(zone.id)) {
      nextZones[zone.id] = { ...nextZones[zone.id], spotifyEnabled: !currentlyAllOn };
    } else if (!currentlyAllOn) {
      // Turning this location ON turns every other zone off — only on
      // this branch, per this file's header comment.
      nextZones[zone.id] = { ...nextZones[zone.id], spotifyEnabled: false };
    }
  }
  await saveSettings({ ...settings, zones: nextZones });
  return getState();
}

// Called by rs485.js after each zoneAudio node's poll reply — pure status
// intake, not a mutation of anything a user configured.
function reportActiveSource(zoneId, sourceByte) {
  if (!ZONE_IDS.has(zoneId)) return;
  activeSourceByZone.set(zoneId, ACTIVE_SOURCE_NAME[sourceByte] || 'off');
}

// Marks which zones should currently treat the shared Pi input as
// top-priority (tier 2) — see this file's header. NOT yet wired to
// anything that actually plays announcement audio on the Pi's own output
// (pausing Spotify, feeding in a message) — that's a separate future
// piece; this is the per-zone targeting half of it, ready for that piece
// to call. `zoneIds` replaces the entire current target set (not
// additive) — an announcement targets a specific set of zones, not a
// running accumulation of every announcement ever started.
function setAnnouncementTargets(zoneIds) {
  announcementTargets.clear();
  for (const id of zoneIds) {
    if (ZONE_IDS.has(id)) announcementTargets.add(id);
  }
}

function clearAnnouncement() {
  announcementTargets.clear();
}

// What rs485.js pushes down to a zone's audio node each poll — see this
// file's header for why it's only these three fields (spotifyEnabled/
// announcementActive/volume), never a commanded source.
function getZoneAudioPush(zoneId) {
  const settings = getSettings();
  const zs = settings.zones[zoneId];
  if (!zs) return { spotifyEnabled: false, announcementActive: false, volumePercent: 0 };
  return {
    spotifyEnabled: zs.spotifyEnabled,
    announcementActive: announcementTargets.has(zoneId),
    volumePercent: zs.volumePercent,
  };
}

async function init() {
  if (!settingsSvc.get()?.sound) {
    await saveSettings(DEFAULT_SETTINGS);
  }
  console.log('[Sound] Initialized.');
}

module.exports = {
  init, getState, setZoneVolume, setZoneEnabled, togglePreset, reportActiveSource,
  setAnnouncementTargets, clearAnnouncement, getZoneAudioPush, ZONES, LOCATIONS,
};
