/**
 * Zone Audio Hardware Driver (direct I2C — no RS485 node)
 * ─────────────────────────────────────────────────────────────────
 * Alternate transport for the exact same "zoneAudio" hardware role
 * server/rs485-nodes/zone_audio_node.ino describes — same CD4066 audio
 * selector, LM393 override1 (TV) presence-detect front end, PT2258
 * shared-input volume chip, same 3-tier local priority decision
 * (announcement > override1/TV > Spotify). The only thing that changes is
 * WHERE that decision runs: zone_audio_node.ino runs it on a per-zone
 * RP2040 polled over RS485; this file runs the identical decision on the
 * Pi itself, driving each zone's chips directly over I2C, on the
 * assumption (per direct ask) that all the amp hardware sits physically
 * next to the Pi — RS485's whole reason to exist (long cable runs,
 * distributed addressing) buys nothing when everything's in one rack, and
 * a dedicated RP2040 + RS485 transceiver + regulator per zone is a lot of
 * duplicated hardware for boards that never need to be reached remotely.
 *
 * KEEP BOTH PATHS ALIVE — the RS485 node file has NOT been deleted and
 * this file does not touch rs485.js/nodeRegistry.js's existing zoneAudio
 * node support at all. Nothing stops a zone from using either transport;
 * whichever one actually has real hardware wired for a given zone is the
 * one that ends up calling sound.js's reportActiveSource() for it. This
 * is a genuine, not-yet-finalized hardware decision — see the chat this
 * shipped from.
 *
 * ── Why a mux, and why one PCA9535 + one PT2258 PER zone ────────────────
 * The PT2258 has a single fixed I2C address — multiple zones' worth of
 * them can't sit on one bus directly. Rather than bit-pack multiple
 * zones' signals into shared chips (more wiring complexity, more ways to
 * get it wrong), each zone gets its OWN PCA9535 (GPIO expander — same
 * chip family as i2cRelay.js's relay boards, just wired to CMOS-level
 * select/mute/detect lines instead of relay coils) and its OWN PT2258,
 * both living behind a dedicated channel on a TCA9548A I2C multiplexer.
 * Since the mux electrically isolates every channel until selected, EVERY
 * channel can reuse the exact same two fixed downstream addresses with no
 * collision — one repeated 2-chip BOM per zone, not a unique address per
 * zone. Two TCA9548A muxes (8 channels each = 16 total) comfortably cover
 * every zone in sound.js's ZONES with channels to spare.
 *
 * ── Hardware per zone (UNVERIFIED — nothing physical built yet) ─────────
 *   PCA9535 GPIO expander (fixed address 0x20, behind this zone's own mux
 *     channel) — Port 0 only:
 *       bit0 (out) AUDIO_SELECT_LOCAL   — CD4066: routes override1 (TV)
 *       bit1 (out) AUDIO_SELECT_SHARED  — CD4066: routes the shared Pi input
 *       bit2 (out) AMP_MUTE             — HIGH = muted (matches most
 *                                          TPA3116-style boards' SD/MUTE pin)
 *       bit3 (in)  OVERRIDE1_DETECT     — HIGH = TV signal present (LM393
 *                                          comparator output, see
 *                                          zone_audio_node.ino's header for
 *                                          the analog front end — identical
 *                                          hardware, just read over I2C
 *                                          instead of a direct GPIO)
 *       bits4-7    unused, configured as inputs (safe default — never
 *                                          drives an output pin that might
 *                                          be wired to something)
 *   PT2258 6-channel I2C volume chip (fixed address 0x44, same channel-1
 *     command bytes zone_audio_node.ino already uses) — only attenuates
 *     the shared input, exactly like the RS485 version; override1 passes
 *     through the CD4066 untouched, at its own native line level.
 *
 * ── I2C addressing ───────────────────────────────────────────────────
 *   TCA9548A mux #1: 0x70 (zones 0-7 of sound.js's ZONES array)
 *   TCA9548A mux #2: 0x71 (zones 8-15)
 *   PCA9535 on every mux channel: 0x20 (fixed, isolated per-channel by the mux)
 *   PT2258 on every mux channel: 0x44 (fixed, same reasoning)
 * CONFIRM all of this against your actual board's jumpers/datasheet before
 * trusting it — same honesty this codebase applies to every other
 * not-yet-built board (see zone_audio_node.ino's own header).
 */

const sound = require('./sound');

const I2C_BUS_NUMBER = 1; // same physical bus as i2cRelay.js's relay boards — Pi's primary I2C (/dev/i2c-1)
const TICK_MS = 300; // fast enough that "turn the TV on" feels instant to a person; see this file's header on why it can't be as instant as the RP2040 version's true continuous polling

// ── Fixed per-channel addresses — see this file's header ────────────────
const MUX_ADDRS = [0x70, 0x71];
const PCA9535_ADDR = 0x20;
const PT2258_ADDR = 0x88 >> 1; // datasheet gives the 8-bit write address 0x88; i2c-bus uses the 7-bit form, matches zone_audio_node.ino's own constant

const PCA_INPUT_PORT0 = 0x00;
const PCA_OUTPUT_PORT0 = 0x02;
const PCA_CONFIG_PORT0 = 0x06;

const PIN_SELECT_LOCAL = 0;  // bit0 — TV
const PIN_SELECT_SHARED = 1; // bit1 — Spotify/announcement
const PIN_MUTE = 2;          // bit2 — HIGH = muted
const PIN_DETECT = 3;        // bit3 — input, HIGH = override1/TV present
// bits 0-2 output, bit3 input, bits4-7 input (unused, safe default)
const PCA_CONFIG_BYTE = 0b11111000;

// Same numeric convention as sound.js's own ACTIVE_SOURCE_NAME / rs485.js's
// ACTIVE_SOURCE map — kept local here too so this file has no dependency on
// rs485.js at all (deliberately: this is the non-RS485 path).
const SOURCE_OFF = 0, SOURCE_SPOTIFY = 1, SOURCE_OVERRIDE1 = 2, SOURCE_ANNOUNCEMENT = 3;

let i2cBus = null;
let usingMock = true;

function openBus() {
  let i2c;
  try {
    i2c = require('i2c-bus');
  } catch {
    console.warn('[ZoneAudioHW] i2c-bus package unavailable — using mock transport. This is expected off the Pi.');
    return;
  }
  try {
    i2cBus = i2c.openSync(I2C_BUS_NUMBER);
    usingMock = false;
    console.log(`[ZoneAudioHW] Bus /dev/i2c-${I2C_BUS_NUMBER} open.`);
  } catch (e) {
    console.warn(`[ZoneAudioHW] Couldn't open /dev/i2c-${I2C_BUS_NUMBER} (${e.message}) — using mock transport. This is expected off the Pi.`);
  }
}

// Per-zone hardware address, assigned in ZONES order — see this file's
// header. Built once from sound.js's own zone list so adding/removing a
// sound zone there automatically reflects here with no separate list to
// keep in sync.
const ZONE_HW = new Map(
  sound.ZONES.map((zone, i) => [
    zone.id,
    { muxAddr: MUX_ADDRS[Math.floor(i / 8)], muxChannel: i % 8 },
  ])
);

// Selects this zone's mux channel — every subsequent transaction on the
// bus until the next select lands on whatever's behind THIS channel.
// Necessary before every PCA9535/PT2258 access since different zones
// reuse the same fixed downstream addresses. sendByteSync, NOT
// writeByteSync — the TCA9548A has no register/pointer byte, it's a
// single raw byte write (writeByteSync would send an extra leading byte
// first, which the mux has no concept of and would misinterpret).
function selectChannel(muxAddr, channel) {
  if (usingMock) return;
  i2cBus.sendByteSync(muxAddr, 1 << channel);
}

const configuredExpanders = new Set(); // muxAddr:channel — so config only gets written once per channel, not every tick
const lastOutputByte = new Map();      // muxAddr:channel -> last written PCA_OUTPUT_PORT0 value, for change-skipping like i2cRelay.js's writeIfChanged
const lastVolumeByte = new Map();      // muxAddr:channel -> last applied volumePercent, so PT2258 isn't rewritten every tick with the same value

function keyFor(hw) { return `${hw.muxAddr}:${hw.muxChannel}`; }

// Note what changed here on review: this (and readOverride1Detect/
// applyRouting/applyVolume below) used to catch its own I2C errors and
// console.error() individually, every single tick, for every zone. Before
// any of this hardware physically exists, that's 13 zones x 300ms x
// several failing operations each = well over 100 log lines PER SECOND —
// the exact "3800 identical NO RESPONSE lines" class of flood rs485.js's
// own shouldLogMiss() was built to prevent. These now just let the I2C
// error propagate; tickZone() below is the ONLY place that logs, once per
// state transition, not once per failure.
function ensureExpanderConfigured(hw) {
  const key = keyFor(hw);
  if (configuredExpanders.has(key) || usingMock) return;
  selectChannel(hw.muxAddr, hw.muxChannel);
  i2cBus.writeByteSync(PCA9535_ADDR, PCA_CONFIG_PORT0, PCA_CONFIG_BYTE);
  configuredExpanders.add(key); // only marked done once the write actually succeeds — a thrown config write must retry next tick, not be silently considered "handled"
}

function readOverride1Detect(hw) {
  if (usingMock) return false; // mock: TV never present, matches i2cRelay's mock stance of "nothing real is connected"
  selectChannel(hw.muxAddr, hw.muxChannel);
  const inputByte = i2cBus.readByteSync(PCA9535_ADDR, PCA_INPUT_PORT0);
  return !!(inputByte & (1 << PIN_DETECT));
}

// One atomic register write for select-local/select-shared/mute — unlike
// the RP2040 version's two sequential digitalWrite() calls (which needed
// an explicit break-before-make step to avoid a moment with both selects
// closed), a single I2C byte write updates all 8 output pins in one
// transaction, so there's no intermediate state where both could be
// asserted at once. Skips the write entirely if nothing changed, same
// reasoning as i2cRelay.js's setChannel().
// Returns useShared UNCONDITIONALLY — the caller needs it every tick to
// decide whether to also touch volume, regardless of whether the routing
// byte itself actually changed this time (the common case, once a zone
// settles on a source). Only the actual hardware WRITE below is skipped
// when nothing changed; an earlier version of this function returned
// early (with no value) in that case, which silently broke volume updates
// after the first tick a zone started playing Spotify — caught on review,
// not by anything that would have surfaced obviously on a bench test.
function applyRouting(hw, source) {
  const useShared = source === SOURCE_SPOTIFY || source === SOURCE_ANNOUNCEMENT;
  const useLocal = source === SOURCE_OVERRIDE1;
  const muted = source === SOURCE_OFF;

  let outByte = 0;
  if (useLocal) outByte |= (1 << PIN_SELECT_LOCAL);
  if (useShared) outByte |= (1 << PIN_SELECT_SHARED);
  if (muted) outByte |= (1 << PIN_MUTE);

  const key = keyFor(hw);
  if (lastOutputByte.get(key) !== outByte) {
    if (usingMock) {
      console.log(`[ZoneAudioHW Mock] mux 0x${hw.muxAddr.toString(16)} ch${hw.muxChannel} outputs -> 0x${outByte.toString(16).padStart(2, '0')}`);
    } else {
      selectChannel(hw.muxAddr, hw.muxChannel);
      i2cBus.writeByteSync(PCA9535_ADDR, PCA_OUTPUT_PORT0, outByte);
    }
    lastOutputByte.set(key, outByte); // only cached once the write actually succeeded — a thrown write must retry next tick, not be considered applied
  }

  return useShared;
}

// PT2258: 6dB-step attenuator, 0-100% mapped onto its 0(loudest)-0x1F
// (muted) attenuation range — same command bytes zone_audio_node.ino
// already uses (channel-1 select + attenuation nibbles). TODO (bring-up):
// confirm against the PT2258 datasheet before trusting this mapping, same
// caveat that file already carries.
function applyVolume(hw, volumePercent) {
  const key = keyFor(hw);
  if (lastVolumeByte.get(key) === volumePercent) return;

  if (usingMock) {
    console.log(`[ZoneAudioHW Mock] mux 0x${hw.muxAddr.toString(16)} ch${hw.muxChannel} volume -> ${volumePercent}%`);
  } else {
    const attenuationStep = Math.round(((100 - volumePercent) / 100) * 0x1F);
    selectChannel(hw.muxAddr, hw.muxChannel);
    // Both command bytes in ONE transaction — matches zone_audio_node.ino's
    // Wire.write()+Wire.write()+Wire.endTransmission() exactly (a single
    // START...STOP carrying 2 payload bytes, no register/pointer byte).
    // i2cWriteSync is the i2c-bus equivalent of that "plain write" shape;
    // writeByteSync would be wrong here — it always sends a register byte
    // before the data byte, which the PT2258 doesn't expect and would
    // corrupt this exact 2-byte command sequence.
    i2cBus.i2cWriteSync(PT2258_ADDR, 2, Buffer.from([0xC0 | (attenuationStep & 0x0F), 0xD0 | ((attenuationStep >> 4) & 0x03)]));
  }
  lastVolumeByte.set(key, volumePercent); // only cached once the write actually succeeded, same reasoning as applyRouting()
}

// Same local-priority decision as zone_audio_node.ino's updateActiveSource()
// — announcement wins even over the TV, TV wins over Spotify. The one real
// behavioral difference from the RP2040 version: that one re-decides every
// loop() iteration (microseconds); this re-decides once per TICK_MS. Still
// well under what a person notices, but worth knowing this isn't literally
// continuous the way the original design was.
async function tickZone(zone) {
  const hw = ZONE_HW.get(zone.id);
  ensureExpanderConfigured(hw);

  const override1Present = readOverride1Detect(hw);
  const push = sound.getZoneAudioPush(zone.id); // { spotifyEnabled, announcementActive, volumePercent } — same seam rs485.js used to consume

  let source = SOURCE_OFF;
  if (push.announcementActive) source = SOURCE_ANNOUNCEMENT;
  else if (override1Present) source = SOURCE_OVERRIDE1;
  else if (push.spotifyEnabled) source = SOURCE_SPOTIFY;

  const useShared = applyRouting(hw, source);
  if (useShared) applyVolume(hw, push.volumePercent);

  sound.reportActiveSource(zone.id, source); // same function rs485.js already calls — sound.js has no idea (or need to know) which transport is driving a given zone
}

// Edge-triggered logging — see this file's earlier note on why. Logs once
// on the transition INTO a failing state per zone and once on RECOVERY,
// exactly the same shape rs485.js's consecutiveMisses/"RECOVERED" already
// uses for the identical problem (a real fault repeating every tick
// forever). A failing zone just keeps whatever routing/volume it last
// successfully applied — no further state changes happen for it until its
// hardware starts answering again.
const erroringZones = new Set();
let tickTimer = null;
async function tick() {
  for (const zone of sound.ZONES) {
    try {
      await tickZone(zone);
      if (erroringZones.has(zone.id)) {
        erroringZones.delete(zone.id);
        console.log(`[ZoneAudioHW] Zone ${zone.id} — hardware responding again.`);
      }
    } catch (e) {
      if (!erroringZones.has(zone.id)) {
        erroringZones.add(zone.id);
        console.error(`[ZoneAudioHW] Zone ${zone.id} — I2C error, will keep retrying silently until it clears:`, e.message);
      }
    }
  }
}

function init() {
  openBus();
  tickTimer = setInterval(() => { tick().catch(err => console.error('[ZoneAudioHW] Tick error:', err.message)); }, TICK_MS);
  console.log('[ZoneAudioHW] Initialized.');
}

module.exports = { init };
