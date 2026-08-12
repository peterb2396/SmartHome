/**
 * Sound Service
 * ─────────────────────────────────────────────────────────────────
 * SOFTWARE SCAFFOLD — no speaker/amp/audio-routing hardware exists yet
 * ("in the future I will have a speaker zone in each room"). This builds
 * the real data model, API, and RS485 dial-volume protocol now so the
 * wiring is already correct once real zone amps are chosen — but actually
 * carrying PCM audio into a physical zone is not implemented here; see
 * spotify.js's header for exactly where that gap is.
 *
 * Zone ids intentionally match thermostat.js's 4 air-handler zones (not
 * imported directly, to keep this module standalone/independently
 * testable, same as boiler.js/monitorZones.js each defining their own zone
 * list rather than sharing thermostat.js's) — a dial node's single
 * `zoneId` (see nodeRegistry.js) identifies both its HVAC zone and its
 * sound zone, one id space, not two to keep in sync.
 *
 * Same schema-less settings-blob pattern as boiler.js/thermostat.js
 * (settings key 'sound').
 */

const settingsSvc = require('./settings');

const MIN_VOLUME = 0;
const MAX_VOLUME = 100;
const SOURCES = ['off', 'spotify', 'tv'];

const ZONES = [
  { id: 'primary-suite', label: 'Primary Suite' },
  { id: 'upstairs',      label: 'Upstairs' },
  { id: 'downstairs',    label: 'Downstairs' },
  { id: 'office',        label: 'Office' },
];

const DEFAULT_SETTINGS = {
  zones: Object.fromEntries(ZONES.map(z => [z.id, { volumePercent: 30, source: 'off' }])),
};

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
      source: settings.zones[zone.id].source,
    })),
  };
}

// Always absolute, never a delta — one function, two callers (the web API's
// POST /sound/zone/:id, and rs485.js's dial handling). A dial reports its
// own locally-tracked absolute volume each poll (the master pushes the
// current value down every cycle so the dial always has something correct
// to increment from), exactly the same pattern as thermostat.js's
// setZone()/target — avoids the drift risk a delta-based approach would
// have if a frame is ever dropped.
async function setZoneVolume(zoneId, volumePercent) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown sound zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId], volumePercent: clampVolume(volumePercent) };
  await saveSettings({ ...settings, zones: { ...settings.zones, [zoneId]: zs } });
  return getState();
}

async function setZoneSource(zoneId, source) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown sound zone ${zoneId}`);
  if (!SOURCES.includes(source)) throw new Error(`Unknown source ${source}`);
  // 'tv' is accepted and stored, but there's no physical audio-routing
  // hardware to actually act on it yet — see this file's header comment.
  // Not silently pretending it works: the zone just records the selection.
  const zs = { ...settings.zones[zoneId], source };
  await saveSettings({ ...settings, zones: { ...settings.zones, [zoneId]: zs } });
  return getState();
}

async function init() {
  if (!settingsSvc.get()?.sound) {
    await saveSettings(DEFAULT_SETTINGS);
  }
  console.log('[Sound] Initialized (software scaffold — no zone amp hardware wired yet).');
}

module.exports = { init, getState, setZoneVolume, setZoneSource, ZONES, SOURCES };
