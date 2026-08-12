/**
 * Spotify Connect Service
 * ─────────────────────────────────────────────────────────────────
 * SOFTWARE SCAFFOLD — see sound.js's header for the overall "no zone amp
 * hardware yet" caveat; this file has an additional, separate constraint
 * on top of that worth being explicit about:
 *
 * Spotify does not hand out its real Connect SDK to hobbyists — the only
 * practical way for this app to show up as a Spotify "device" (the way a
 * Sonos or a Roku does) is librespot, the open-source reverse-engineered
 * Connect implementation (the same thing the `raspotify` Debian package
 * wraps). One librespot process is ONE Connect session — Spotify only
 * allows a single account to have one active playback stream at a time
 * across all its devices, full stop. That means "multiple zones playing
 * different songs simultaneously" is NOT achievable through a single
 * household Spotify account via this protocol, and this file does not
 * attempt to fake it. The user explicitly chose the "one stream, routed to
 * multiple zones at once" design instead (same audio playable in several
 * rooms simultaneously, not independent streams) — see setRoutedZones()
 * below.
 *
 * What this file actually does today: spawn/manage a single librespot
 * child process and expose its play-state. What it does NOT do yet, because
 * no zone amp hardware exists to receive it: fan the decoded PCM output out
 * to individual zones. librespot's own audio output today just goes to
 * whatever default ALSA/ffmpeg sink the Pi has — routing that into
 * per-zone amps is real DSP/hardware work (a multi-channel DAC + amp per
 * zone, or a networked-audio approach) that has to follow the actual
 * hardware choice, not precede it. `routedZoneIds` below is real state,
 * tracked and exposed to the frontend/dial correctly — it just doesn't
 * physically move audio anywhere yet.
 */

const { spawn } = require('child_process');

const LIBRESPOT_BIN = process.env.LIBRESPOT_BIN || 'librespot';
const DEVICE_NAME = process.env.SPOTIFY_DEVICE_NAME || 'SmartHome';

let proc = null;
let playState = { playing: false, track: null, artist: null };
let routedZoneIds = new Set();

function isRunning() {
  return proc !== null;
}

// Parses librespot's stderr log lines for the handful of events worth
// surfacing — it doesn't expose a structured API of its own, this is the
// standard way projects like raspotify's status scripts read its state.
function handleLogLine(line) {
  if (/Playing/i.test(line)) playState.playing = true;
  if (/Paused|Stopped/i.test(line)) playState.playing = false;
}

function start() {
  if (proc) return; // already running
  try {
    // No --username/--password — deliberately left in librespot's default
    // zeroconf-discoverable mode, so pairing happens from the Spotify app's
    // own device picker (like adding a Sonos), not by storing account
    // credentials in this codebase.
    proc = spawn(LIBRESPOT_BIN, ['--name', DEVICE_NAME, '--bitrate', '160', '--backend', 'alsa'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.warn(`[Spotify] Couldn't start librespot (${err.message}) — is it installed? This is expected off the Pi / before setup.`);
    proc = null;
    return;
  }
  proc.stdout.on('data', (d) => d.toString().split('\n').forEach(handleLogLine));
  proc.stderr.on('data', (d) => d.toString().split('\n').forEach(handleLogLine));
  proc.on('exit', (code) => {
    console.warn(`[Spotify] librespot exited (code ${code}).`);
    proc = null;
    playState = { playing: false, track: null, artist: null };
  });
  console.log(`[Spotify] librespot starting as Connect device "${DEVICE_NAME}".`);
}

function stop() {
  if (!proc) return;
  proc.kill();
  proc = null;
}

// Which sound.js zones should currently hear the single shared Spotify
// stream — see this file's header for why it's "which zones," plural,
// not "which zone." Actual audio fan-out is the documented gap above.
function setRoutedZones(zoneIds) {
  routedZoneIds = new Set(zoneIds);
}

function getState() {
  return {
    running: isRunning(),
    deviceName: DEVICE_NAME,
    ...playState,
    routedZoneIds: Array.from(routedZoneIds),
  };
}

async function init() {
  start();
}

module.exports = { init, start, stop, setRoutedZones, getState, isRunning };
