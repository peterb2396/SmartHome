/**
 * Sound Service
 * ─────────────────────────────────────────────────────────────────
 * Each zone's physical audio hardware (a "zoneAudio" RS485 node — see
 * rs485.js's protocol header) has 3 audio inputs, fixed priority, LOCAL
 * hardware-level switching:
 *   0 (lowest)  Spotify  — the shared Pi-routed stream, only present at
 *                          all if this zone has Spotify enabled
 *   1           Override input 1 — e.g. a TV's audio out, wired straight
 *                          into the zone box
 *   2 (highest) Override input 2 — reserved for a future Pi-triggered
 *                          "force audio to every zone" alarm/announcement
 *                          feed, not wired yet
 *
 * The zone hardware itself decides which input is actually audible, by
 * locally detecting signal presence on whichever override input(s) have
 * one — the same "must keep working with zero WiFi/server dependency"
 * requirement the HVAC dial protocol was built around applies here too:
 * turning a TV on has to instantly win over Spotify with no round-trip to
 * this server. This service and the RS485 link to each zone are NOT in
 * that decision path at all. Their job is narrower:
 *   - tell each zone whether Spotify is allowed to be its lowest-priority
 *     input right now (setZoneEnabled() below — the web/dial "zone on/off"
 *     control is strictly a Spotify gate, never touches override inputs;
 *     the TV in a room always works whether or not anyone's ever opened
 *     this app)
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
 * as boiler.js/thermostat.js).
 *
 * Zone ids are audio-zone-specific, deliberately NOT shared with
 * thermostat.js's 4 air-handler zones — audio zoning follows room-by-room
 * speaker wiring, HVAC zoning follows ductwork, and this house's actual
 * rooms don't line up 1:1 with its duct zones. A dial node that controls
 * both needs a thermostat zoneId AND a sound-zone id — see
 * nodeRegistry.js's `soundZoneId` field.
 */

const settingsSvc = require('./settings');

const MIN_VOLUME = 0;
const MAX_VOLUME = 100;

// Matches the wire values rs485.js's ZONE_AUDIO_STATE parsing uses —
// keep in sync with that file's ACTIVE_SOURCE map.
const ACTIVE_SOURCE_NAME = { 0: 'off', 1: 'spotify', 2: 'override1', 3: 'override2' };

const ZONES = [
  { id: 'primary-bedroom',  label: 'Primary Bedroom' },
  { id: 'primary-bathroom', label: 'Primary Bathroom' },
  { id: 'foyer',            label: 'Foyer' },
  { id: 'lounge',           label: 'Lounge' },
  { id: 'office',           label: 'Office' },
  { id: 'kitchen',          label: 'Kitchen' },
  { id: 'great-room',       label: 'Great Room' },
  { id: 'pavillion',        label: 'Pavillion' },
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
      volumePercent: settings.zones[zone.id].volumePercent,
      spotifyEnabled: settings.zones[zone.id].spotifyEnabled,
      activeSource: activeSourceByZone.get(zone.id) || 'off',
    })),
  };
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

// Called by rs485.js after each zoneAudio node's poll reply — pure status
// intake, not a mutation of anything a user configured.
function reportActiveSource(zoneId, sourceByte) {
  if (!ZONE_IDS.has(zoneId)) return;
  activeSourceByZone.set(zoneId, ACTIVE_SOURCE_NAME[sourceByte] || 'off');
}

// What rs485.js pushes down to a zone's audio node each poll — see this
// file's header for why it's only these two fields (spotifyEnabled +
// volume), never a commanded source.
function getZoneAudioPush(zoneId) {
  const settings = getSettings();
  const zs = settings.zones[zoneId];
  if (!zs) return { spotifyEnabled: false, volumePercent: 0 };
  return { spotifyEnabled: zs.spotifyEnabled, volumePercent: zs.volumePercent };
}

async function init() {
  if (!settingsSvc.get()?.sound) {
    await saveSettings(DEFAULT_SETTINGS);
  }
  console.log('[Sound] Initialized.');
}

module.exports = {
  init, getState, setZoneVolume, setZoneEnabled, reportActiveSource, getZoneAudioPush, ZONES,
};
