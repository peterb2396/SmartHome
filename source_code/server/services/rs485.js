/**
 * RS485 Bus Service
 * ─────────────────────────────────────────────────────────────────
 * Master side of the RS485 sensor bus: every zone has an RP2040 node
 * (TTL-to-RS485 converter + LM2596 24V→5V step-down; thermostat-zone nodes
 * additionally carry a BME680 + SCD41) reporting its temperature over a
 * half-duplex serial link. The Pi's end of the bus is a USB-to-RS485
 * adapter (RS485_PORT_PATH below) — the adapter handles direction
 * switching internally, so no GPIO pins are needed on the Pi side for the
 * bus itself. This module owns the wire protocol, polls configured nodes
 * for readings, writes them into sensorStore as `<type>-<zoneId>` (e.g.
 * `temp-office`), and tracks any node that's announced itself on the bus
 * but hasn't been named yet — that's what feeds the Console's "New Nodes"
 * panel.
 *
 * Decision logic (thermostat control, safety ranges, cost selection) stays
 * on the server — these nodes are pure sensor input. Damper actuation is
 * separate, direct-wired Pi relays (see thermostat.js's driveDamper()),
 * not commanded over this bus. SET_RELAY exists in the protocol for a
 * possible future actuator-carrying node type, but nothing configured
 * today uses it.
 *
 * If the port errors out or closes (dongle unplugged/reseated, USB hiccup),
 * openTransport() is retried on a timer (RECONNECT_INTERVAL_MS) rather than
 * staying dead until the process restarts — see handleDisconnect()/
 * scheduleReconnect(). isBusDown() feeds faults.js the same way gpio.js's
 * isHvacFaultActive() does, only actually flagged as a fault on Linux (a
 * mock transport off the Pi during dev is normal, not a fault).
 *
 * A single NODE going silent while the port/bus itself is fine is a
 * separate, more common failure — see consecutiveMisses/alertNodeDown()
 * below. Earlier evidence (git history) pointed at the node's own MCU
 * getting wedged (an RP2040 I2C hang inside sendReport()'s sensor reads),
 * not the bus — the node side has its own hardware watchdog and UART-hang
 * mitigations for that (see rs485_node.ino). Since then, a SEPARATE real
 * incident (a node down for 450+ consecutive misses, fixed only by
 * physically unplugging/replugging the Pi's own USB-to-RS485 adapter —
 * nothing on the node side could explain that fix) pointed at the adapter
 * itself instead — see resetUsbAdapter()/attemptUsbResetRecovery() below,
 * which now attempts that same fix in software (one shot per outage) the
 * moment a node crosses the alert threshold, before falling back to just
 * notifying you like before. Either way, this side sends a Bark push once
 * a node's been silent long enough to rule out a blip, so a real outage
 * gets noticed without staring at the console.
 *
 * ── Wire protocol ────────────────────────────────────────────────────────
 * Frame: [0xAA sync][addr 1B][cmd 1B][len 1B][payload...][crc8 1B]
 * addr 0x00 is reserved for broadcast / not-yet-configured nodes.
 *
 * Master → node:
 *   0x01 POLL             — request a report. Payload: none.
 *   0x02 ASSIGN            — broadcast only. Payload: [uniqueId 8B][newAddr 1B].
 *                            Only the node whose uniqueId matches adopts newAddr
 *                            and persists it to flash.
 *   0x03 SET_RELAY         — Payload: [relayIndex 1B][state 1B]. Unused today.
 *   0x04 POLL_DIAL         — dial-kind nodes only (see below), replaces POLL.
 *   0x05 POLL_ZONE_AUDIO   — zoneAudio-kind nodes only (see below), replaces POLL.
 *
 * Node → master:
 *   0x81 ANNOUNCE        — sent on addr 0x00 while unconfigured, every few
 *                          seconds. Payload: [uniqueId 8B][capabilities 1B].
 *   0x82 REPORT          — reply to POLL. Payload: repeated
 *                          [sensorType 1B][value float32 4B] tuples.
 *   0x83 ACK             — generic acknowledgement for ASSIGN/SET_RELAY.
 *   0x84 DIAL_STATE      — reply to POLL_DIAL (see below).
 *   0x85 ZONE_AUDIO_STATE — reply to POLL_ZONE_AUDIO (see below).
 *
 * Sensor type byte (REPORT payload):
 *   0x01 temperature (°F)   0x02 humidity (%RH)   0x03 pressure (hPa)
 *   0x04 voc (0-100 heuristic score)              0x05 co2 (ppm)
 *
 * ── Dial nodes (wall-mounted RS485 HMI: thermostat + sound control) ──────
 * A dial is not a separate physical node on this bus — see nodeRegistry.js's
 * `hasDial` field. The actual RS485 node is the SAME mass-produced RP2040
 * board used for every zone's sensors; the dial (an ESP32-based touch +
 * rotary display) is an I2C ACCESSORY hanging off that RP2040, exactly like
 * the BME680/SCD41 sensors are — the RP2040 bridges between RS485 (talking
 * to this server) and I2C (talking to the dial), and answers on ONE shared
 * bus address for BOTH roles: POLL/REPORT for its own sensors (if it has
 * any — see `kind`) and POLL_DIAL/DIAL_STATE for the attached dial (if
 * `hasDial` is true). This keeps the RS485 side of things exactly as
 * simple as every other node type ("master always initiates, node only
 * ever replies") — the ESP32 dial itself never touches RS485 at all, or
 * even needs to know the protocol exists; the RP2040 handles all of that
 * and just gives the dial a small I2C register interface to read/write.
 *
 * Dial polling runs on its OWN loop (pollAllDials()), separate from the
 * ordinary sensor pollAll() loop, but at the SAME cadence (DIAL_SWEEP_GAP_MS
 * == POLL_INTERVAL_MS, both 10s) by explicit choice — see DIAL_SWEEP_GAP_MS's
 * own comment for why this doesn't cost the physical dial any responsiveness
 * despite being nowhere near "fast." Since a `hasDial` node's SAME bus
 * address can now be visited by EITHER loop, and RS485 is a shared
 * half-duplex bus where only one request can be outstanding at a time, both
 * loops check a shared per-address busy set (see pollingAddresses below)
 * before writing to an address and simply skip that node for this pass if
 * it's already mid-exchange with the other loop — at matched 10s cadences a
 * skip just means that node's dial-push waits for the next tick, a rare and
 * harmless one-cycle delay, not the many-times-a-second retry this used to be.
 *
 * POLL_DIAL payload (master→dial, pushes what the dial should display for
 * every screen every cycle, since the dial can switch screens locally
 * without waiting for a new poll — 48B): [targetF f32][currentF f32]
 * [humidity f32][co2 f32][outdoorF f32][flags 1B: bit0 callingHeat, bit1
 * callingCool, bit2 safetyActive, bit3 weatherStale, bit4
 * spotifyEnabled, bit5 humidityAvailable — most zones only carry an SCD41
 * (co2 only, no BME680 — see envSensors.js's header), so the humidity
 * float is a meaningless 0.0 sentinel unless this bit says otherwise; the
 * dial must not render it as a real reading when unset][hour 1B][minute
 * 1B][volumePercent 1B][activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2][faultCount 1B]
 * [maintenanceDueCount 1B]. volume/spotifyEnabled come from sound.js's
 * persisted per-zone settings; activeSource is that zone's own audio
 * hardware's CURRENT hardware-detected input (see the zoneAudio section
 * below), relayed through here purely so the dial can display "now
 * playing: TV" etc. — the dial has no say in it, same as the web app.
 * faultCount/maintenanceDueCount are plain counts (from faults.js/
 * maintenance.js, same numbers the Console/Maintenance pages show) for an
 * ambient badge on every OTHER screen — it just flags "something's up" via
 * that badge when either is nonzero. The Status screen itself DOES now
 * render real text (bytes 48+, below) — this earlier design call ("no room
 * on a round face") was reversed per explicit ask (2026-09-29). Same for
 * every dial in a sweep, not per-zone.
 *
 * Bytes 27-47, appended for the Clock/weather screen redesign (kept after
 * the original 27B so none of those offsets ever had to move): [weekday
 * 1B: 0=Sunday..6=Saturday][month 1B: 1-12][day 1B: 1-31][weatherCategory
 * 1B: astro.js's own small icon enum — 0=clear,1=partlyCloudy,2=cloudy,
 * 3=fog,4=drizzle,5=rain,6=snow,7=thunderstorm, see its weatherCategory()
 * for the WMO-code mapping this simplifies — the dial only ever needs to
 * know how to DRAW each of these 8 values, never the raw WMO table][
 * rainHour 1B: hour-of-day (0-23) rain is first expected TODAY, or 255 if
 * none is — see astro.js's refreshOutdoorCacheOnce()][forecastValidMask
 * 1B: bit0=+3h point present, bit1=+6h, bit2=+9h — astro.js only returns
 * as many forecast points as it actually has, and 0°F is a real possible
 * reading, so "no data for this slot" needs its own bit rather than a
 * magic temperature][3x forecast point, 5B each, +3h/+6h/+9h in order:
 * tempF f32 + weatherCategory 1B — ignore both if this point's
 * forecastValidMask bit is unset].
 *
 * Bytes 48+, appended for individual fault/maintenance text on the Status
 * screen (2026-09-29) — up to MAX_STATUS_ITEMS (3) slots, (1 +
 * STATUS_ITEM_TEXT_LEN(48))B each: [isFault 1B][text 48B, NUL-padded/
 * truncated, always a valid terminated C string]. Faults first (more
 * urgent), then due maintenance, combined and truncated to 3 total — see
 * buildStatusItems(). An unused slot is all-zero; the dial treats
 * text[0]==0 as "no item here," no separate item-count byte needed. The
 * dial cycles through whichever slots are populated one at a time by
 * rotating while on the Status screen; faultCount/maintenanceDueCount
 * above are unrelated raw counts, unchanged, still driving the ambient
 * badge on every other screen.
 *
 * DIAL_STATE payload (dial→master reply, 8B): [mode 1B: 0=thermostat,
 * 1=sound][newTargetF f32][changed 1B][tapEvent 1B][newVolumePercent 1B].
 * Both newTargetF and newVolumePercent are the dial's own locally-tracked
 * ABSOLUTE values, never deltas — the master pushes the current value down
 * every cycle specifically so the dial always has a correct base to
 * increment from, which avoids the drift a delta-based approach would risk
 * if a frame is ever dropped. When changed=1, the master applies it
 * directly via thermostat.js's setZone() (mode=thermostat) or sound.js's
 * setZoneVolume() (mode=sound) — the exact same functions the web app's
 * own routes call, so there is one code path for "a zone's target/volume
 * changed" regardless of what changed it. This is also what makes the
 * whole HVAC-must-work-with-no-WiFi requirement hold up: dial → this bus →
 * setZone() → tick()/relay-drive never leaves the Pi.
 *
 * tapEvent values: 0=none, 1=wake (idle→clock), 2=menuSelect, 4=returnToMenu
 * (tapped/pressed on Thermostat or Status, both purely local dial-side
 * navigation, same as wake/menuSelect — never acted on server-side). 3=
 * toggle Spotify-enabled for this dial's sound zone — only acted on when
 * mode=sound (see pollAllDials()). This is strictly the same "zone on/off"
 * Spotify gate the web app's toggle is, never touches override inputs. 5=
 * markMaintenanceDone — the Status screen's "Mark Done" button, shown only
 * while something's actually due. Acted on regardless of `mode`, unlike
 * toggleSpotifyEnabled: completes every currently-due maintenance.js task
 * (see pollAllDials()), same completeTask() the web app's Maintenance page
 * calls — one code path either way. Faults are NOT completable from here
 * on purpose (they clear on their own once the underlying condition
 * resolves — see faults.js), so there's no equivalent tapEvent for them.
 *
 * ── Zone audio nodes (per-room amp hardware — NOT the dial, a separate
 * node) ────────────────────────────────────────────────────────────────
 * A `kind: 'zoneAudio'` node is the physical box driving one room's
 * speakers, with 2 audio inputs wired in — a LOCAL one (that zone's TV/
 * override1, physically only present in that room) and a SHARED one (the
 * Pi's own line-out, distributed to every zone node — see hardware.md /
 * the hardware doc for the physical distribution-amp design) — and a
 * FIXED, LOCAL priority between them, decided entirely on the node, see
 * sound.js's header for the full design and why the switching decision
 * never touches this server.
 *
 * The shared Pi input carries EITHER Spotify OR an announcement — never
 * both, same "one stream" limit as Spotify alone already has (see
 * spotify.js's header) — so which one it currently means for THIS zone's
 * priority purposes is a per-zone flag this server pushes down, not
 * something the node can infer from the audio alone: with spotifyEnabled
 * set it's tier-0 (loses to the local override1 input); with
 * announcementActive set it's tier-2 (wins over everything, including
 * override1) — that's what makes "announce to specific zones,
 * programmatically" actually work: targeting a zone is nothing more than
 * setting its announcementActive flag, the same RS485 push that already
 * carries spotifyEnabled. Playing the actual announcement audio (pausing
 * Spotify on the Pi's output, feeding the message in) is a separate,
 * not-yet-built piece — see sound.js's setAnnouncementTargets() for
 * exactly where that gets wired in later; the protocol/plumbing here is
 * ready for it now so the hardware doc doesn't describe a system that
 * doesn't match what's actually built.
 *
 * This bus's job for these nodes is carrying spotifyEnabled/
 * announcementActive/volume down, and carrying back which input the
 * hardware is currently actually playing — same "master polls, node only
 * ever replies" rule as every other node type, still folded into the
 * ordinary 10s pollAll() cycle (not the dial's fast loop) since nothing
 * here needs sub-second responsiveness — the actual audio switching
 * already happened locally, instantly, independent of this poll, by the
 * time the poll even goes out.
 *
 * POLL_ZONE_AUDIO payload (master→zoneAudio, 2B): [flags 1B: bit0
 * spotifyEnabled, bit1 announcementActive][spotifyVolumePercent 1B].
 *
 * ZONE_AUDIO_STATE payload (zoneAudio→master reply, 1B): [activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2 — override2 here means "the
 * shared Pi input, at announcement priority," not a second physical
 * input] — read straight into sound.js's reportActiveSource(), which is
 * display-only state, never fed back into a command.
 *
 * ── Remote firmware update (RP2040 nodes only — see firmwareUpdate.js) ───
 * The Pi has no USB wire to a deployed node, only this RS485 pair — so
 * "flash it remotely" means pushing a new image over the SAME half-duplex
 * bus normal polling uses, in small chunks, and having the node install it
 * itself. Node-side this rides arduino-pico's Update library (same shape
 * as ESP32/ESP8266's): the new image goes into an inactive flash
 * partition and is only marked bootable after a clean finish, so an
 * interrupted or corrupt push leaves the node running its OLD firmware,
 * not bricked — that safety only holds if the node was BUILT with an
 * OTA-enabled "Flash Size" partition scheme in the Arduino IDE, which is
 * a one-time per-node manual-USB-flash requirement, not something this
 * protocol can do for a node that doesn't already have it.
 *
 * This protocol layer adds its OWN whole-image CRC32 check (below,
 * independent of whatever Update.end() itself verifies) specifically so
 * correctness doesn't depend on exactly matching some Updater library
 * version's internal behavior — FW_BEGIN carries the sender's expected
 * CRC32, the node accumulates its own running CRC32 over every byte
 * written, and FW_END only finalizes/reboots if they match.
 *
 * One flash runs at a time, one node at a time — reuses pollingAddresses
 * (see above) so an in-progress push simply excludes that address from
 * normal polling until it finishes or times out; every OTHER node keeps
 * polling normally throughout. At 9600 baud, half-duplex, one small chunk
 * per round trip, a few-hundred-KB image realistically takes low single
 * digit MINUTES — see flashFirmware()'s own comment before assuming
 * something's stuck.
 *
 * 0x06 FW_BEGIN  (master→node) — payload: [totalSize u32][crc32 u32] (8B).
 *                  Node calls Update.begin(totalSize), resets its running
 *                  CRC32 accumulator. Replies FW_ACK stage=0.
 * 0x07 FW_CHUNK  (master→node) — payload: [seq u16][data...] (up to
 *                  FW_CHUNK_DATA_LEN=32B data). Node calls
 *                  Update.write(data, len), folds data into the running
 *                  CRC32. Replies FW_ACK stage=1, echoing seq.
 * 0x08 FW_END    (master→node) — payload: none. Node compares its
 *                  running CRC32 against the one FW_BEGIN sent; if it
 *                  matches, calls Update.end(true) and — only if THAT also
 *                  reports success — replies FW_ACK stage=2 ok=1 and
 *                  reboots into the new image; on any mismatch it replies
 *                  ok=0 and keeps running the current firmware, untouched.
 * 0x09 GET_LOG   (master→node) — payload: none. Node replies LOG_LINE with
 *                  its next buffered debug line, if any queued — see
 *                  rs485_node.ino's logLine() — so field debug output
 *                  (BME680/SCD41 not found, dial I2C errors, etc.) is
 *                  visible from the Console's existing log Terminal panel
 *                  without a USB cable, tagged by node name (see
 *                  pollNodeLog() below). Polled slowly and round-robin
 *                  (LOG_POLL_INTERVAL_MS/one node per tick) — this is
 *                  debug convenience, not control traffic, and
 *                  deliberately kept cheap on bus time.
 * 0x0A CHECK_OTA  (master→node, hasDial nodes only) — payload: none. Node
 *                  replies ACK, and sets a one-shot flag the dial reads
 *                  (and clears) on its own next i2c1 exchange — bit1 of
 *                  the existing i2c1-only push byte, alongside bit0's PIR
 *                  wake (see dial_node.ino's header) — telling it to run
 *                  checkForOTA() immediately instead of waiting for its own
 *                  OTA_CHECK_INTERVAL_MS timer. Sent exactly once per
 *                  hasDial node, right after this service starts up — see
 *                  notifyDialsToCheckOta() below. Exists because a dial's
 *                  RS485 power feed is isolated from the Pi's own supply
 *                  (real hardware fact, not a bug): the dial never power-
 *                  cycles when the Pi/server restarts, so without this it
 *                  could sit on stale firmware for up to 6h after a fresh
 *                  build gets uploaded and the server restarts to serve it.
 *
 * 0x86 FW_ACK    (node→master) — payload: [stage 1B][ok 1B][seq u16 — only
 *                  meaningful for stage=1, echoes the chunk seq].
 * 0x87 LOG_LINE  (node→master) — payload: [hasLine 1B][text...] (up to
 *                  30B, UTF-8/ASCII). hasLine=0 with no text means nothing
 *                  was queued this poll.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sensors = require('./sensorStore');
const { sendPush } = require('./mail');

const SYNC = 0xaa;
const CMD = {
  POLL: 0x01, ASSIGN: 0x02, SET_RELAY: 0x03, POLL_DIAL: 0x04, POLL_ZONE_AUDIO: 0x05,
  FW_BEGIN: 0x06, FW_CHUNK: 0x07, FW_END: 0x08, GET_LOG: 0x09, CHECK_OTA: 0x0A,
  ANNOUNCE: 0x81, REPORT: 0x82, ACK: 0x83, DIAL_STATE: 0x84, ZONE_AUDIO_STATE: 0x85,
  FW_ACK: 0x86, LOG_LINE: 0x87,
};
const ACTIVE_SOURCE_NAME = { 0: 'off', 1: 'spotify', 2: 'override1', 3: 'override2' };
// motion: a PIR wired directly to an RS485 node's own GPIO (see
// rs485_node.ino's HAS_PIR/PIR_PIN) — reported every cycle like any other
// reading (1.0 = a rising edge was seen since the last report, 0.0
// otherwise — the node latches and clears this itself so a brief pulse
// between polls is never missed), not just an on/off level. See pollAll()
// below for what a 1.0 actually triggers.
const SENSOR_TYPE = { temperature: 0x01, humidity: 0x02, pressure: 0x03, voc: 0x04, co2: 0x05, motion: 0x06 };
const SENSOR_TYPE_NAME = Object.fromEntries(Object.entries(SENSOR_TYPE).map(([k, v]) => [v, k]));
const SENSOR_UNIT = { temperature: 'F', humidity: '%', pressure: 'hPa', voc: 'score', co2: 'ppm', motion: '' };
// sensorStore key prefix per type — 'temperature' on the wire but 'temp' in
// the store, matching thermostat.js's `tempSensor: 'temp-<zoneId>'`
// convention. Every other type's wire name IS its prefix.
const SENSOR_KEY_PREFIX = { temperature: 'temp', humidity: 'humidity', pressure: 'pressure', voc: 'voc', co2: 'co2', motion: 'motion' };

// motion is a discrete event (did ANY node see a rising edge this cycle),
// not a continuous measurement — averaging it across multiple nodes on the
// same zone would make no sense, so it's the one type blendZoneReading()
// below is never called for; see pollAll()'s own motion handling, which is
// unaffected by any of this.
const BLENDABLE_TYPES = new Set(['temperature', 'humidity', 'pressure', 'voc', 'co2']);

// Raw per-node contributor readings feeding blendZoneReading() below — kept
// in this file's own private Map, NOT sensorStore. sensorStore.getAll() is
// consumed with zero filtering by both the general /sensors API
// (smarthome.js) and its web page (Sensors.jsx's raw per-key dump) — a
// per-node intermediate value ("upstairs" temp as seen by ONE of three
// dials) isn't a sensor the rest of the app should ever see standalone, so
// routing it through the shared store would just clutter that page with
// confusing extra rows. key: `${type}-${zoneId}-${node.uniqueId}`.
const zoneReadingContributors = new Map();

// Weighted-average a zone's environment reading across every node
// currently configured to report it — added 2026-09-28 for multi-dial
// zones (e.g. 3 dials in the same room-group, each with its own SCD41):
// before this, every node reporting the same zoneId+type wrote straight to
// the SAME sensorStore key (`${prefix}-${zoneId}`), so whichever node
// happened to be polled LAST in a given sweep silently overwrote whatever
// the others had just reported — not a blend, just a flicker between
// readings. Each node now records its own reading into
// zoneReadingContributors first (see pollAll() below); this combines the
// FRESH ones (same STALE_MS threshold sensorStore itself uses, so "stopped
// answering" behaves identically to every other sensor in the app) using
// each node's own `sensorWeight` (nodeRegistry.js, default 1 — a zone with
// only one reporting node is unaffected either way, since a single-item
// weighted average is just that item), then writes the ONE result to the
// normal shared sensorStore key exactly like before. Falls through to
// leaving that shared key exactly as it was if nothing fresh is available —
// same "last known good, flagged stale" behavior every other sensor here
// already has, not a new failure mode.
function blendZoneReading(type, zoneId, getConfiguredNodes) {
  const prefix = SENSOR_KEY_PREFIX[type];
  const freshContributors = [];
  let weightedSum = 0, totalWeight = 0;
  for (const node of getConfiguredNodes().filter(n => n.zoneId === zoneId)) {
    const entry = zoneReadingContributors.get(`${type}-${zoneId}-${node.uniqueId}`);
    if (!entry || (Date.now() - entry.updatedAt) > sensors.STALE_MS) continue;
    const weight = node.sensorWeight ?? 1;
    weightedSum += entry.value * weight;
    totalWeight += weight;
    freshContributors.push(node.uniqueId);
  }
  if (totalWeight === 0) return; // nothing fresh from anyone this cycle — leave the existing (possibly now-stale) shared value alone
  sensors.set(`${prefix}-${zoneId}`, weightedSum / totalWeight, SENSOR_UNIT[type], {
    source: 'rs485-blend',
    contributors: freshContributors,
  });
}

const RS485_PORT_PATH = process.env.RS485_PORT || '/dev/ttyUSB0'; // USB-to-RS485 adapter
const BAUD_RATE = 9600;
// Was 10000, then 1000, briefly 2000 (2026-09-28) — reverted back to 1000
// the same day after the 2000ms change coincided with a total, sustained
// breakdown on one node (100% CRC failure, not just occasional mismatches)
// that a full firmware reflash and power cycle did NOT clear. That's not
// proof this constant caused it — going slower should mechanically reduce
// bus contention, not create it — but the timing correlation was exact and
// direct, and reverting a timing constant is cheap/safe to test against a
// live HVAC outage, unlike continuing to theorize. If mismatches persist
// at 1000ms too, this constant is cleared and the real cause is still
// unfound — don't treat this revert alone as confirmation of what broke it.
const POLL_INTERVAL_MS = 1000;
const ANNOUNCE_STALE_MS = 30000; // drop a pending node from the list if it stops announcing

// How long to wait for a REPORT after a POLL before giving up. Sized for a
// real sensor read, not a quick ack — the BME680's forced-mode conversion
// (oversampling + its ~150ms gas heater cycle) routinely runs past a couple
// hundred ms, and the node can't answer until that completes. Generous is
// fine here since it's nowhere near POLL_INTERVAL_MS (2s) either way.
const POLL_RESPONSE_TIMEOUT_MS = 2000;
const RECONNECT_INTERVAL_MS = 10000; // how often to retry opening the port after it's lost/never opened

// Dial nodes get their own much faster response timeout (they're a tiny
// microcontroller reacting to a queued input event, not a BME680 forced
// read) and a small gap between full sweeps of all dial nodes so an empty
// or single-dial bus doesn't spin a tight synchronous loop.
const DIAL_POLL_RESPONSE_TIMEOUT_MS = 200;
// Real production evidence, a genuine A/B comparison on the SAME hardware
// with the SCD41-on-the-dial-cable relay fix already in place both times
// (see rs485_node.ino's header): at 120ms, RS485 corruption was mild and
// self-healing (a miss or two, recovered within a poll); at 20ms it produced
// a continuous storm (100+ consecutive misses, not self-healing) on the same
// Pi/adapter. That whole tuning exercise assumed this loop NEEDED to be fast
// for the physical dial to feel responsive — it doesn't. The dial applies an
// encoder turn to its own screen immediately, locally, over its own private
// i2c1 link to the RP2040 (see dial_node.ino's RP2040_POLL_INTERVAL_MS,
// which stays fast on purpose) — that link never touches this shared,
// multi-node RS485 bus at all. This loop's only job is keeping the PI in
// sync (so setZone()/the relay/the web app see a change).
//
// Matched to POLL_INTERVAL_MS by explicit choice, not a coincidence, and
// deliberately kept that way rather than given its own independent value —
// both loops share the exact same real constraint (bus throughput/collision
// exposure, see POLL_INTERVAL_MS's own comment on why that's no longer a
// correctness risk since acquireBusLock() started guaranteeing strict
// one-exchange-at-a-time), so there's no reason for them to ever drift
// apart. dial_node.ino's PUSH_OVERRIDE_GRACE_MS is sized off THIS value —
// change one, change both.
const DIAL_SWEEP_GAP_MS = POLL_INTERVAL_MS;
const DIAL_MODE = { thermostat: 0, sound: 1 };
const DIAL_TAP_EVENT = { none: 0, wake: 1, menuSelect: 2, toggleSpotifyEnabled: 3, returnToMenu: 4, markMaintenanceDone: 5 };
// tapEvent values other than toggleSpotifyEnabled/markMaintenanceDone are
// parsed but not acted on server-side — menu/mode navigation is entirely
// local to the dial's own UI state machine. Reserved protocol surface,
// same as SET_RELAY above.

// zoneAudio nodes reuse the sensor-rate 10s pollAll() loop, not the dial's
// fast loop — see this file's header for why sub-second responsiveness
// isn't needed here (the actual audio switching already happened locally
// on the node, independent of this poll).
const ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS = 2000;

// ── Remote firmware update — see this file's header for the protocol ────
const FW_CHUNK_DATA_LEN = 32; // + 2B seq = 34B payload, under MAX_PAYLOAD_LEN (40)
const FW_BEGIN_TIMEOUT_MS = 3000; // Update.begin() may erase flash — give it room
const FW_CHUNK_TIMEOUT_MS = 2000; // Update.write() can cross a sector boundary and erase
const FW_END_TIMEOUT_MS = 6000; // finalize + verify + (on success) the node reboots itself
const FW_CHUNK_RETRIES = 5; // a dropped chunk is just re-sent, not a fatal abort

// Debug-convenience only (see GET_LOG in this file's header) — deliberately
// slow and one node per tick so this never competes meaningfully with real
// polling for bus time.
const LOG_POLL_INTERVAL_MS = 3000;
const LOG_POLL_RESPONSE_TIMEOUT_MS = 500;

// Standard CRC-32 (IEEE 802.3 / zlib) — must match crc32Update() in
// rs485_node.ino/zone_audio_node.ino bit-for-bit, since FW_END's whole-image
// check is only meaningful if both sides compute the identical value.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// onData()'s resync safety net — see its own comment for the failure mode
// this guards against. Largest real payload today is POLL_DIAL's 195B (see
// buildDialPushPayload() — grew from 60 for the Status-screen fault/
// maintenance text, 2026-09-29); generous headroom over that so a
// legitimate future protocol addition doesn't false-positive against this.
const MAX_PAYLOAD_LEN = 220;
// NOT just wire-transmission time (9600 baud is ~1ms/byte, which alone
// would suggest well under 50ms) — real USB-to-RS485 adapters/OS serial
// drivers can legitimately deliver one genuine frame's bytes split across
// multiple 'data' events with real gaps between them well past that,
// independent of how fast the node actually replied. An earlier version
// of this used 300ms and it was WRONG: it fired on real in-progress
// frames, not just noise, discarding their sync byte before the rest
// arrived — turned "occasional timeout after hours" into "every poll
// fails immediately." This only needs to be shorter than the time before
// enough new traffic queues up behind a truly-dead byte to matter, so it
// stays comfortably above POLL_RESPONSE_TIMEOUT_MS (2000ms) — a real
// per-node round trip, including any driver buffering delay, should never
// get close to this.
const FRAME_STALL_MS = 3000;

let port = null;
let usingMock = true;
let reconnectTimer = null;
// True only once we're actually expected to have a real bus (Linux — see
// openTransport()) and it isn't open — a mock transport on a dev machine
// off the Pi is normal, not a fault, so that case never sets this.
let busDown = false;
const pendingNodes = new Map(); // uniqueId -> { uniqueId, lastSeenAt }
let rxBuffer = Buffer.alloc(0);
let pendingReportResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL
let pendingDialResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL_DIAL
let pendingZoneAudioResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL_ZONE_AUDIO
let pendingFwResolvers = new Map(); // address -> resolve fn, for the current in-flight FW_BEGIN/CHUNK/END
let pendingLogResolvers = new Map(); // address -> resolve fn, for the current in-flight GET_LOG

// A combined sensor+dial node (nodeRegistry.js's `hasDial`) answers both
// pollAll()'s 10s sensor sweep and pollAllDials()'s dial sweep on the SAME
// bus address — since RS485 only allows one outstanding request at a time,
// both sweeps check this set before writing to an address and skip it for
// this pass (not wait) if it's already mid-exchange with the other sweep.
// See this file's header ("Dial nodes") for the full reasoning. This is a
// fast, cheap SKIP heuristic only — see acquireBusLock() just below for
// the actual hard guarantee this alone was never enough to provide.
const pollingAddresses = new Set();

// ── Global bus mutex ─────────────────────────────────────────────────────
// RS485 is one shared half-duplex wire — only one exchange (one write, one
// awaited reply) may ever be in flight at a time, full stop, regardless of
// which node it's with. pollingAddresses above only ever prevented two
// exchanges to the SAME address from overlapping. It did nothing to stop
// pollAll()'s sensor sweep, pollAllDials()'s dial sweep, pollNodeLog()'s
// debug-log sweep, and flashFirmware() — four independent, self-scheduling
// async chains — from each writing a frame to a DIFFERENT address while
// one of the others was still waiting on a reply. Two transmissions (or a
// transmission stepping on an in-flight reply) sharing one physical wire
// at once looks exactly like noise on the receiving end — indistinguishable
// from the CRC-mismatch/no-response symptoms this whole system has fought,
// via a mechanism nothing about grounding, termination, or adapter
// isolation could ever have fixed, since it never was a signal-integrity
// problem to begin with.
//
// This is a small FIFO async mutex, the standard "chain of promises"
// pattern: acquireBusLock() resolves once it's this caller's turn
// (immediately, if the bus is free) with a `release` function the caller
// MUST call exactly once — on every resolution path (success, timeout,
// mock mode) — or every later queued caller waits forever.
let busLockTail = Promise.resolve();
function acquireBusLock() {
  let release;
  const lockPromise = new Promise((resolve) => { release = resolve; });
  const acquired = busLockTail.then(() => release);
  busLockTail = busLockTail.then(() => lockPromise);
  return acquired;
}

// ── CRC8 (poly 0x07, matches common Arduino Crc8 implementations) ──────────
function crc8(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function buildFrame(addr, cmd, payload = Buffer.alloc(0)) {
  const head = Buffer.from([addr, cmd, payload.length]);
  const body = Buffer.concat([head, payload]);
  return Buffer.concat([Buffer.from([SYNC]), body, Buffer.from([crc8(body)])]);
}

// ── USB adapter reset — see alertNodeDown()/attemptUsbResetRecovery() ──────
// Real production evidence: a node went completely unresponsive (450+
// consecutive misses, ~75 minutes) while this file's own bus-transport
// tracking reported the connection as healthy the whole time — nothing on
// the NODE side (which already has its own watchdog and I2C-isolation
// mitigations) can explain a fix that only ever touched the Pi's end of
// the wire. Physically unplugging and replugging the USB-to-RS485 adapter
// fixed it instantly, meaning the adapter chip itself (or the kernel's
// view of it) was the thing actually wedged, not any node. This
// reproduces that same fix without needing physical access: unbind then
// rebind the USB device at the driver level, forcing the kernel to fully
// tear down and re-enumerate it — the closest software equivalent to a
// real unplug/replug available. It does NOT power-cycle the device (no
// VBUS drop) — if the fault ever turns out to need an actual power
// interruption to clear, this won't help, but it's the strongest fix
// available without adding hardware (a powered, switchable USB hub).
//
// Finds the top-level USB device's sysfs bus-id (e.g. "1-1.2") backing a
// /dev/ttyUSBx path by walking up from the tty's own sysfs device symlink
// until hitting a directory that carries idVendor/idProduct — the actual
// USB device node, not one of its child interfaces. Works regardless of
// which specific USB-serial chip is in the adapter (CH340, CP210x, FTDI,
// etc. all expose this same generic USB core sysfs shape).
function findUsbBusId(ttyPath) {
  let dir;
  try {
    dir = fs.realpathSync(`/sys/class/tty/${path.basename(ttyPath)}/device`);
  } catch {
    return null;
  }
  while (dir && dir !== '/' && dir !== '.') {
    if (fs.existsSync(path.join(dir, 'idVendor')) && fs.existsSync(path.join(dir, 'idProduct'))) {
      return path.basename(dir);
    }
    dir = path.dirname(dir);
  }
  return null;
}

// The Node server does NOT run as root (and shouldn't — this is one narrow
// action, not a reason to hand a long-running internet-facing process root
// on the whole Pi). Writing /sys/bus/usb/drivers/usb/{unbind,bind}
// directly needs root, so instead this shells out via `sudo` to a tiny,
// single-purpose wrapper script (server/scripts/rs485-usb-reset.sh) that's
// the ONLY thing a scoped sudoers rule grants passwordless root on — see
// that script's own header and the deployment setup notes for the exact
// sudoers line required. If that one-time setup was never done, this fails
// loudly (once, via a dedicated Bark push) rather than silently doing
// nothing forever.
const USB_RESET_SCRIPT = '/usr/local/bin/rs485-usb-reset.sh'; // installed copy — see the script's own header for the repo source
const USB_RESET_SETTLE_MS = 500; // matches the script's own internal unbind->bind gap, kept here only for the "how long to keep suppressing bus-down alerts" window below
let intentionalUsbReset = false; // suppresses the bus-down/back-online Bark push below for a reset WE triggered — see attemptUsbResetRecovery()
let usbResetPermissionWarned = false; // one-time — see the exec callback below

// Fires the reset script asynchronously via sudo and returns immediately —
// success/failure is only known once the child process exits, handled in
// the callback below. Returns false only for the synchronous "couldn't
// even figure out which device to reset" case; a script/sudo failure is
// reported asynchronously instead, since child_process.execFile can't be
// synchronous.
function resetUsbAdapter() {
  const busId = findUsbBusId(RS485_PORT_PATH);
  if (!busId) {
    console.error(`[RS485] USB reset requested but couldn't locate the USB device backing ${RS485_PORT_PATH} — skipping.`);
    return false;
  }
  // -n (non-interactive) is load-bearing, not optional: without it, a
  // missing/wrong sudoers rule makes `sudo` sit waiting for a password on
  // a TTY that doesn't exist (this is a background service, not an
  // interactive shell) — a hung child process, forever, the exact class of
  // bug this whole file's history has been about avoiding. With -n, a
  // misconfigured sudoers rule instead fails immediately and reports
  // through the catch below, same as any other setup mistake.
  execFile('sudo', ['-n', USB_RESET_SCRIPT, busId], (err, _stdout, stderr) => {
    if (err) {
      console.error(`[RS485] USB reset script failed (${err.message}${stderr ? ` — ${stderr.trim()}` : ''}) — see server/scripts/rs485-usb-reset.sh's header for the required one-time sudoers setup.`);
      if (!usbResetPermissionWarned) {
        usbResetPermissionWarned = true;
        sendPush('Tried to auto-reset the RS485 USB adapter after a node went down, but the reset script failed (sudoers setup likely missing/wrong) — this will keep failing silently until fixed.', 'RS485: Auto-Reset Broken');
      }
    } else {
      console.log(`[RS485] USB adapter reset (bus id ${busId}) completed.`);
    }
  });
  return true;
}

// Edge-triggered, same pattern as gpio.js's HVAC fault handling — push once
// on the transition, not on every failed reconnect attempt while it stays
// down. Suppressed for a reset we triggered ourselves (intentionalUsbReset)
// — see attemptUsbResetRecovery() — since that's an expected side effect,
// not a surprise outage; the console lines still print either way, so it's
// still visible in the Console terminal history.
//
// Real production incident: a genuine adapter-vanished outage ran for
// hours overnight — one push at the start is easy to miss while asleep
// (silenced phone, etc.), and this alone used to be the only notification
// for the entire outage. checkBusDownReminder() below now re-pushes on a
// slow interval for as long as the bus stays down, so a long outage can't
// go completely unnoticed just because the first push was missed.
let busDownSince = 0;
let busDownWasVanished = false; // sticky for the duration of THIS outage — see the reminder message
function setBusDown(down, vanished = false) {
  if (down === busDown) {
    if (down && vanished) busDownWasVanished = true; // a later open attempt can upgrade "wedged" to "vanished" mid-outage
    return;
  }
  busDown = down;
  if (down) {
    busDownSince = Date.now();
    busDownWasVanished = vanished;
    console.warn('[RS485] Bus is down.');
    if (!intentionalUsbReset) sendPush('The RS485 sensor bus is unreachable — zone sensors will stop updating until this recovers.', 'RS485: Bus Down');
  } else {
    busDownSince = 0;
    console.log('[RS485] Bus back online.');
    if (!intentionalUsbReset) sendPush('The RS485 sensor bus is back online.', 'RS485: Resolved');
  }
}

// Slow-interval "still down" nag — see setBusDown()'s comment on the real
// incident this responds to. Deliberately not edge-triggered like
// setBusDown() itself: the whole point is to re-alert periodically for as
// long as the outage continues, not just once.
const BUS_DOWN_REMINDER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastBusDownReminderAt = 0;
function checkBusDownReminder() {
  if (!busDown || !busDownSince || intentionalUsbReset) return;
  const now = Date.now();
  if (now - busDownSince < BUS_DOWN_REMINDER_INTERVAL_MS) return; // not worth nagging for a short outage
  if (lastBusDownReminderAt && now - lastBusDownReminderAt < BUS_DOWN_REMINDER_INTERVAL_MS) return;
  lastBusDownReminderAt = now;
  const hours = Math.round((now - busDownSince) / 3600000);
  const guidance = busDownWasVanished
    ? 'The adapter appears to have disappeared from the USB bus entirely — a physical unplug/replug is likely needed, this can\'t self-recover in software.'
    : 'The auto-reset has been retrying without success — worth checking on physically.';
  sendPush(`The RS485 sensor bus has been down for ~${hours}h straight. ${guidance}`, 'RS485: Still Down');
}

function scheduleReconnect() {
  if (reconnectTimer) return; // already have one pending
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openTransport();
  }, RECONNECT_INTERVAL_MS);
}

// Fires on either a hard error or the port closing (e.g. the USB adapter
// being unplugged) — either way the connection is gone and needs a fresh
// open, not just logging.
function handleDisconnect(err) {
  if (err) console.error('[RS485] Serial error:', err.message);
  port = null;
  usingMock = true;
  if (process.platform === 'linux') setBusDown(true);
  scheduleReconnect();
}

// ── Transport: real serial port, or a silent mock off the Pi ───────────────
function openTransport() {
  let SerialPort;
  try {
    ({ SerialPort } = require('serialport'));
  } catch {
    console.warn('[RS485] serialport package unavailable — using mock transport.');
    return;
  }
  const candidate = new SerialPort({ path: RS485_PORT_PATH, baudRate: BAUD_RATE, autoOpen: false });
  candidate.open((err) => {
    if (err) {
      // Real production incident: ENOENT specifically means the device
      // NODE ITSELF is gone (the kernel removed it), which only happens
      // when the adapter has actually dropped off the USB bus — unplugged,
      // or died — not a normal transient open failure. That's a
      // meaningfully different, worse situation than a wedged-but-present
      // adapter (see resetUsbAdapter()'s header): the unbind/rebind reset
      // operates on a sysfs path keyed to the device's bus id, which
      // doesn't exist anymore either once the device is truly gone, so
      // that mitigation can't help here — only a physical unplug/replug
      // (or the device re-enumerating on its own) recovers this. The old
      // "This is expected off the Pi" wording was written for a dev
      // machine with no adapter at all and is actively misleading on the
      // Pi itself with a real adapter that's vanished — only claim that
      // now when this genuinely isn't Linux.
      const vanished = err.code === 'ENOENT';
      const context = process.platform === 'linux'
        ? (vanished ? 'the adapter appears to have disappeared from the USB bus entirely — likely needs a physical unplug/replug' : 'retrying')
        : 'this is expected off the Pi';
      console.warn(`[RS485] Couldn't open ${RS485_PORT_PATH} (${err.message}) — using mock transport (${context}).`);
      if (process.platform === 'linux') setBusDown(true, vanished);
      scheduleReconnect();
      return;
    }
    port = candidate;
    usingMock = false;
    setBusDown(false);
    port.on('data', onData);
    port.on('error', handleDisconnect);
    port.on('close', () => handleDisconnect(null));
    console.log(`[RS485] Bus online on ${RS485_PORT_PATH} at ${BAUD_RATE} baud.`);
  });
}

// `verbose` lets a caller opt into a raw hex dump for this specific write —
// used at the same shouldLogMiss() checkpoints as the "NO RESPONSE"
// warnings, so a sustained outage's log shows real TX bytes going out at
// the exact moments it also shows the timeout, instead of either logging
// every single write forever (the old, buffer-flooding behavior) or
// having zero TX evidence at all during an outage.
function writeFrame(frame, verbose = false) {
  if (usingMock || !port) {
    console.log(`[RS485 Mock] would write ${frame.length}B frame: ${frame.toString('hex')}`);
    return;
  }
  if (verbose) console.log(`[RS485] TX ${frame.length}B: ${frame.toString('hex')}`);
  port.write(frame);
}

// ── Frame parsing ────────────────────────────────────────────────────────
// Tracks when the byte currently sitting at rxBuffer's front first started
// looking like the start of an in-progress frame — reset to null whenever
// a frame completes/gets skipped, i.e. whenever progress is made.
let awaitingFrameSince = null;

function onData(chunk) {
  // No routine RX log here on purpose — every chunk on a healthy bus used
  // to print a hex dump, which is exactly the noise this was asked to
  // remove. The raw bytes still show up when they actually matter: see the
  // CRC-mismatch warning below, which now carries the offending frame's
  // hex directly on the same line instead of relying on a separate,
  // unconditional per-chunk log to have captured it.
  rxBuffer = Buffer.concat([rxBuffer, chunk]);
  let syncIdx;
  while ((syncIdx = rxBuffer.indexOf(SYNC)) !== -1) {
    // A stray byte that happens to equal SYNC (bus noise, or just landing
    // inside another frame's payload) can make everything from here look
    // like the start of a frame that will never actually complete. Left
    // unchecked, indexOf(SYNC) keeps re-finding this same dead position on
    // every future call forever — no amount of reopening the serial port
    // or resetting the remote node clears rxBuffer, only a process
    // restart reallocates it, which is exactly the "only fix is
    // restarting the backend" symptom this guards against. Two checks:
    // an implausible len skips immediately, a plausible-but-never-
    // completing one times out after FRAME_STALL_MS of no progress.
    const len = rxBuffer.length > syncIdx + 3 ? rxBuffer[syncIdx + 3] : null;
    if (len !== null && len > MAX_PAYLOAD_LEN) {
      rxBuffer = rxBuffer.subarray(syncIdx + 1);
      awaitingFrameSince = null;
      continue;
    }

    if (rxBuffer.length < syncIdx + 4) { // not enough for header yet
      if (awaitingFrameSince === null) awaitingFrameSince = Date.now();
      else if (Date.now() - awaitingFrameSince > FRAME_STALL_MS) {
        rxBuffer = rxBuffer.subarray(syncIdx + 1);
        awaitingFrameSince = null;
        continue;
      }
      return;
    }
    const addr = rxBuffer[syncIdx + 1];
    const cmd = rxBuffer[syncIdx + 2];
    const frameEnd = syncIdx + 4 + len + 1;
    if (rxBuffer.length < frameEnd) { // wait for the rest
      if (awaitingFrameSince === null) awaitingFrameSince = Date.now();
      else if (Date.now() - awaitingFrameSince > FRAME_STALL_MS) {
        rxBuffer = rxBuffer.subarray(syncIdx + 1);
        awaitingFrameSince = null;
        continue;
      }
      return;
    }

    const payload = rxBuffer.subarray(syncIdx + 4, syncIdx + 4 + len);
    const receivedCrc = rxBuffer[frameEnd - 1];
    const expectedCrc = crc8(rxBuffer.subarray(syncIdx + 1, syncIdx + 4 + len));
    const rawFrame = rxBuffer.subarray(syncIdx, frameEnd); // captured before advancing, only used if this turns out to be a failure below
    rxBuffer = rxBuffer.subarray(frameEnd);
    awaitingFrameSince = null;

    if (receivedCrc !== expectedCrc) {
      console.warn(`[RS485] CRC mismatch, dropping frame (raw ${rawFrame.length}B: ${rawFrame.toString('hex')})`);
      continue;
    }
    handleFrame(addr, cmd, payload);
  }
}

// onData() only re-checks the stall timeout when new bytes actually
// arrive — if the bus goes fully silent after the stuck byte (no further
// noise at all), onData() never fires again and the timeout above never
// gets evaluated. Called once per pollAll() cycle (already runs every
// POLL_INTERVAL_MS regardless of bus traffic) so a stuck buffer self-heals
// even without anything new coming in over the wire.
function checkFrameStall() {
  if (awaitingFrameSince === null) return;
  if (Date.now() - awaitingFrameSince <= FRAME_STALL_MS) return;
  const syncIdx = rxBuffer.indexOf(SYNC);
  rxBuffer = syncIdx === -1 ? Buffer.alloc(0) : rxBuffer.subarray(syncIdx + 1);
  awaitingFrameSince = null;
}

function handleFrame(addr, cmd, payload) {
  if (cmd === CMD.ANNOUNCE && addr === 0x00) {
    const uniqueId = payload.subarray(0, 8).toString('hex');
    pendingNodes.set(uniqueId, { uniqueId, lastSeenAt: Date.now() });
    return;
  }
  if (cmd === CMD.REPORT) {
    const readings = [];
    for (let i = 0; i + 5 <= payload.length; i += 5) {
      const typeByte = payload[i];
      const value = payload.readFloatLE(i + 1);
      const typeName = SENSOR_TYPE_NAME[typeByte];
      if (typeName) readings.push({ type: typeName, value });
    }
    const resolve = pendingReportResolvers.get(addr);
    if (resolve) { resolve(readings); pendingReportResolvers.delete(addr); }
    return;
  }
  if (cmd === CMD.DIAL_STATE) {
    const resolve = pendingDialResolvers.get(addr);
    if (!resolve || payload.length < 8) return;
    resolve({
      mode: payload[0],
      newTargetF: payload.readFloatLE(1),
      changed: !!payload[5],
      tapEvent: payload[6],
      newVolumePercent: payload[7],
    });
    pendingDialResolvers.delete(addr);
    return;
  }
  if (cmd === CMD.ZONE_AUDIO_STATE) {
    const resolve = pendingZoneAudioResolvers.get(addr);
    if (!resolve || payload.length < 1) return;
    resolve({ activeSource: payload[0] });
    pendingZoneAudioResolvers.delete(addr);
    return;
  }
  if (cmd === CMD.FW_ACK) {
    const resolve = pendingFwResolvers.get(addr);
    if (!resolve || payload.length < 2) return;
    resolve({ stage: payload[0], ok: !!payload[1], seq: payload.length >= 4 ? payload.readUInt16LE(2) : null });
    pendingFwResolvers.delete(addr);
    return;
  }
  if (cmd === CMD.LOG_LINE) {
    const resolve = pendingLogResolvers.get(addr);
    if (!resolve || payload.length < 1) return;
    const hasLine = !!payload[0];
    resolve(hasLine ? payload.subarray(1).toString('utf8').replace(/\0+$/, '') : null);
    pendingLogResolvers.delete(addr);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────
// Logs every poll's outcome (response or timeout) so a bus that goes quiet
// after a while can actually be diagnosed from the logs — which node
// stopped answering, and when — instead of just observing "it stopped
// working" with no record of where.
let consecutiveMisses = new Map(); // busAddress -> count, reset to 0 on any response
// Separate from consecutiveMisses above on purpose — see pollAllDials()'s
// own comment on why sharing one counter between the sensor poll and the
// dial poll would let one's routine successes mask the other's sustained
// failures.
let dialConsecutiveMisses = new Map();
// Diagnostic-only: busAddress -> last target (°F) actually pushed to that
// dial, so pollAllDials() can log a push only when the value it's sending
// actually changes rather than every 1s tick — added to get positive
// visibility into a reported "dial/web target never syncs" bug that left
// no trace either way in the normal NO RESPONSE/RECOVERED logging (a
// perfectly healthy exchange is otherwise completely silent by design).
let lastPushedTarget = new Map();

// A single node going silent while the bus/port itself is fine (dongle
// still connected, other nodes still answering) is a DIFFERENT failure
// than isBusDown() above — that one's about the port/transport; this is
// "one specific RP2040 stopped answering," the exact "clean REPORT, then
// total silence for 12+ hours" failure mode this file's header/git history
// documents. Console logs alone don't help if nobody's watching them at
// 2am, so once a node has been silent long enough to rule out a transient
// blip (NODE_DOWN_ALERT_MISSES, chosen to line up with shouldLogMiss()'s
// own "this is no longer just noise" threshold), send a Bark push —
// edge-triggered via nodesAlerted so a multi-hour outage sends exactly one
// "down" push and one "recovered" push, not one every poll.
const NODE_DOWN_ALERT_MISSES = 2; // ~1 minute of consecutive silence at POLL_INTERVAL_MS
const nodesAlerted = new Set(); // busAddress currently in an alerted "down" state

function alertNodeDown(address, label, misses) {
  if (misses < NODE_DOWN_ALERT_MISSES || nodesAlerted.has(address)) return;
  nodesAlerted.add(address);
  // Approximate — one miss roughly every POLL_INTERVAL_MS, the cadence
  // pollAll()'s own timer runs at (a bit loose when other nodes on the
  // same cycle are also timing out, but well within "good enough for a
  // push notification").
  const silentSeconds = Math.round(misses * POLL_INTERVAL_MS / 1000);
  sendPush(
    `RS485 node ${label} has stopped responding (~${silentSeconds}s of silence). Go check its Serial Monitor log and send it over.`,
    'RS485: Node Down'
  );
  attemptUsbResetRecovery(label);
}

// One-shot per outage — see resetUsbAdapter()'s header for why this exists
// at all. Deliberately just ONE attempt, not a retry loop: if the adapter
// genuinely isn't the problem this time, hammering unbind/rebind
// repeatedly risks doing more harm than good, and the existing escalating
// "N in a row" logging + this same node-down push already keep you
// informed either way.
let usbResetAttemptedThisOutage = false;
function attemptUsbResetRecovery(triggeredByLabel) {
  if (usbResetAttemptedThisOutage || usingMock || process.platform !== 'linux') return;
  usbResetAttemptedThisOutage = true;
  intentionalUsbReset = true;
  console.log(`[RS485] Node ${triggeredByLabel} down — attempting a one-shot USB adapter reset (see resetUsbAdapter()'s header).`);
  if (!resetUsbAdapter()) { intentionalUsbReset = false; return; }
  // Comfortably longer than USB_RESET_SETTLE_MS + one full reconnect
  // cycle, so a genuinely still-down bus/node after this window resumes
  // normal (unsuppressed) alerting rather than staying silently masked.
  setTimeout(() => { intentionalUsbReset = false; }, USB_RESET_SETTLE_MS + RECONNECT_INTERVAL_MS + 5000);
}

function alertNodeRecovered(address, label, priorMisses) {
  if (!nodesAlerted.has(address)) return;
  nodesAlerted.delete(address);
  sendPush(`RS485 node ${label} is responding again after ${priorMisses} consecutive missed polls.`, 'RS485: Node Recovered');
  usbResetAttemptedThisOutage = false; // this outage is over — a future, separate one gets its own reset attempt
}

// A sustained outage logging one warning every single 10s cycle, forever,
// is what buried an entire day's worth of every other service's logs
// under ~3800 identical "NO RESPONSE" lines and made it impossible to see
// what actually happened at the moment it started — see git history.
// Full detail for the first several misses (exactly when it started
// matters most), then backing off to periodic checkpoints, keeps a long
// outage from crowding the ring buffer out while still leaving a trail.
function shouldLogMiss(misses) {
  if (misses <= 5) return true;
  if (misses < 50) return misses % 10 === 0;
  if (misses < 500) return misses % 50 === 0;
  return misses % 500 === 0;
}

async function pollNode(address, zoneId) {
  if (usingMock) return []; // nothing to poll without real hardware
  // A hasDial node's address might already be mid-exchange with
  // pollAllDials()'s dial sweep — skip this node for THIS 10s cycle rather
  // than queue behind it needlessly. Cheap: it just tries again next
  // cycle. acquireBusLock() below is what actually guarantees no overlap
  // with any OTHER address's exchange too, not just this one.
  if (pollingAddresses.has(address)) return [];
  pollingAddresses.add(address);
  const release = await acquireBusLock();
  return new Promise((resolve) => {
    const label = `addr=${address}${zoneId ? ` zone=${zoneId}` : ''}`;
    const frame = buildFrame(address, CMD.POLL);
    const timeout = setTimeout(() => {
      pendingReportResolvers.delete(address);
      pollingAddresses.delete(address);
      release();
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      if (shouldLogMiss(misses)) {
        // The TX hex used to be logged speculatively, BEFORE knowing
        // whether this poll would even miss — which meant it fired on
        // nearly every single healthy poll too (a fresh miss count of 1
        // always passed the "first 5" checkpoint in shouldLogMiss()),
        // exactly the routine noise this was asked to remove. Now it's
        // only ever printed here, attached to an actual miss, so a quiet
        // bus stays quiet and a real outage still shows what was sent.
        console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row) — sent ${frame.length}B: ${frame.toString('hex')}`);
      }
      alertNodeDown(address, label, misses);
      resolve([]);
    }, POLL_RESPONSE_TIMEOUT_MS);
    pendingReportResolvers.set(address, (readings) => {
      clearTimeout(timeout);
      pollingAddresses.delete(address);
      release();
      // The single most useful line in a long outage: exactly when it
      // ended and how long it ran, logged unconditionally (unlike the
      // routine per-poll success case, which stays silent either way).
      const priorMisses = consecutiveMisses.get(address) || 0;
      if (priorMisses > 0) {
        console.log(`[RS485] Poll ${label} — RECOVERED after ${priorMisses} consecutive misses`);
        alertNodeRecovered(address, label, priorMisses);
      }
      consecutiveMisses.set(address, 0);
      resolve(readings);
    });
    writeFrame(frame); // no speculative hex dump on the routine send — see the NO RESPONSE warning above for the failure-tied one instead
  });
}

// zoneAudio nodes required lazily, same load-order reasoning as
// pollAllDials()'s thermostat/astro/sound requires below.
async function pollZoneAudioNode(address, zoneId) {
  const soundSvc = require('./sound');
  if (usingMock) return;
  const release = await acquireBusLock();
  return new Promise((resolve) => {
    const label = `addr=${address} soundZone=${zoneId}`;
    const { spotifyEnabled, announcementActive, volumePercent } = soundSvc.getZoneAudioPush(zoneId);
    const flags = (spotifyEnabled ? 1 : 0) | (announcementActive ? 2 : 0);
    const push = Buffer.from([flags, volumePercent]);
    const frame = buildFrame(address, CMD.POLL_ZONE_AUDIO, push);
    const timeout = setTimeout(() => {
      pendingZoneAudioResolvers.delete(address);
      release();
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      if (shouldLogMiss(misses)) {
        console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row) — sent ${frame.length}B: ${frame.toString('hex')}`);
      }
      alertNodeDown(address, label, misses);
      resolve();
    }, ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS);
    pendingZoneAudioResolvers.set(address, ({ activeSource }) => {
      clearTimeout(timeout);
      release();
      const priorMisses = consecutiveMisses.get(address) || 0;
      if (priorMisses > 0) {
        const sourceName = ACTIVE_SOURCE_NAME[activeSource] || 'off';
        console.log(`[RS485] Poll ${label} — RECOVERED after ${priorMisses} consecutive misses (now playing ${sourceName})`);
        alertNodeRecovered(address, label, priorMisses);
      }
      consecutiveMisses.set(address, 0);
      soundSvc.reportActiveSource(zoneId, activeSource);
      resolve();
    });
    writeFrame(frame);
  });
}

// ── Remote firmware update ──────────────────────────────────────────────
// One request/reply exchange over the FW_* protocol — mirrors pollNode()'s
// shape (promise + timeout + pendingFwResolvers) but generic over which
// frame gets sent, since FW_BEGIN/FW_CHUNK/FW_END are all "send one frame,
// await one FW_ACK" with different timeouts.
async function fwExchange(address, frame, timeoutMs) {
  const release = await acquireBusLock();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingFwResolvers.delete(address);
      release();
      resolve(null);
    }, timeoutMs);
    pendingFwResolvers.set(address, (ack) => {
      clearTimeout(timeout);
      release();
      resolve(ack);
    });
    writeFrame(frame, true); // OTA traffic is rare and important enough to always log
  });
}

// Pushes `buffer` (a full firmware .bin) to `address` over RS485, one
// FW_CHUNK_DATA_LEN chunk at a time. Claims `address` in pollingAddresses
// for the whole operation — see this file's header — so normal polling of
// THIS node pauses until it finishes (expected: it's about to reboot) while
// every other node keeps polling normally. Resolves true only if FW_END
// both CRC-matched and the node's own Update.end() reported success; false
// for anything else (timeout, NACK, CRC mismatch) — in every false case the
// node is defined to still be running its OLD firmware untouched, so a
// caller can just retry the whole push.
//
// Speed reality check: 9600 baud, half-duplex, one small chunk per round
// trip (send + node's Update.write() + ack) — figure roughly 100-150ms per
// chunk including driver/turnaround overhead, so a 300KB image (~9,400
// chunks at 32B) is realistically several minutes, not seconds. onProgress
// (if given) is called after every chunk with {sent, total} so a caller can
// show real progress instead of a spinner with no sense of how long this
// legitimately takes.
async function flashFirmware(address, buffer, onProgress) {
  if (usingMock) return false;
  if (pollingAddresses.has(address)) return false; // already mid-exchange with something else
  pollingAddresses.add(address);
  try {
    const totalCrc = crc32(buffer);
    const beginPayload = Buffer.alloc(8);
    beginPayload.writeUInt32LE(buffer.length, 0);
    beginPayload.writeUInt32LE(totalCrc, 4);
    const beginAck = await fwExchange(address, buildFrame(address, CMD.FW_BEGIN, beginPayload), FW_BEGIN_TIMEOUT_MS);
    if (!beginAck || !beginAck.ok) return false;

    let seq = 0;
    for (let offset = 0; offset < buffer.length; offset += FW_CHUNK_DATA_LEN) {
      const data = buffer.subarray(offset, offset + FW_CHUNK_DATA_LEN);
      const chunkPayload = Buffer.concat([Buffer.alloc(2), data]);
      chunkPayload.writeUInt16LE(seq, 0);
      const frame = buildFrame(address, CMD.FW_CHUNK, chunkPayload);

      let ack = null;
      for (let attempt = 0; attempt < FW_CHUNK_RETRIES && !ack; attempt++) {
        const reply = await fwExchange(address, frame, FW_CHUNK_TIMEOUT_MS);
        if (reply && reply.ok && reply.seq === seq) ack = reply;
      }
      if (!ack) return false; // exhausted retries — node unresponsive mid-transfer

      seq++;
      if (onProgress) onProgress({ sent: Math.min(offset + FW_CHUNK_DATA_LEN, buffer.length), total: buffer.length });
    }

    const endAck = await fwExchange(address, buildFrame(address, CMD.FW_END), FW_END_TIMEOUT_MS);
    return !!(endAck && endAck.ok);
  } finally {
    pollingAddresses.delete(address);
  }
}

// ── Node debug-log relay — see GET_LOG in this file's header ───────────
// One node per tick, round-robin, deliberately slow — this is debug
// convenience riding along on production bus time, not control traffic.
let logPollCursor = 0;
let logPollTimer = null;
async function pollNodeLog(getConfiguredNodes) {
  const nodes = getConfiguredNodes().filter(n => n.busAddress != null);
  if (nodes.length === 0 || usingMock) {
    logPollTimer = setTimeout(() => pollNodeLog(getConfiguredNodes), LOG_POLL_INTERVAL_MS);
    return;
  }
  const node = nodes[logPollCursor % nodes.length];
  logPollCursor++;

  if (!pollingAddresses.has(node.busAddress)) {
    pollingAddresses.add(node.busAddress);
    const release = await acquireBusLock();
    const line = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingLogResolvers.delete(node.busAddress);
        release();
        resolve(null);
      }, LOG_POLL_RESPONSE_TIMEOUT_MS);
      pendingLogResolvers.set(node.busAddress, (text) => {
        clearTimeout(timeout);
        release();
        resolve(text);
      });
      writeFrame(buildFrame(node.busAddress, CMD.GET_LOG));
    });
    pollingAddresses.delete(node.busAddress);
    // sourceFor() in logStream.js groups by the leading [Bracket] — this
    // makes each node's field debug output show up as its own source in
    // the Console's existing Terminal panel, no new UI needed.
    if (line) console.log(`[Node:${node.name}] ${line}`);
  }

  logPollTimer = setTimeout(() => pollNodeLog(getConfiguredNodes), LOG_POLL_INTERVAL_MS);
}

// Tracks which hasDial nodes have already been sent CHECK_OTA this server
// process's lifetime — in-memory only, not persisted, so it naturally
// resets (and re-notifies every dial) on every restart, which is exactly
// the point (see CHECK_OTA's own header comment on why this exists at
// all). Also covers a node that's offline at the moment the server starts
// and joins the bus later — it just gets notified whenever pollAll() first
// sees it, not only in the very first sweep.
const otaCheckNotified = new Set();

// Called from pollAll() below, once per sweep — cheap (a Set membership
// check per hasDial node) and self-limiting (each node drops out after its
// one real send). Fire-and-forget by design: the RP2040 does reply with a
// plain ACK, but there's nothing to do with it (no state to update) and no
// harm if it's dropped — the dial's own periodic OTA_CHECK_INTERVAL_MS
// timer is the fallback either way, this is purely a "don't make them wait
// up to 6h for it" latency improvement, not a delivery guarantee.
async function notifyDialsToCheckOta(getConfiguredNodes) {
  if (usingMock) return;
  for (const node of getConfiguredNodes()) {
    if (!node.hasDial || node.busAddress == null || otaCheckNotified.has(node.uniqueId)) continue;
    if (pollingAddresses.has(node.busAddress)) continue; // mid-exchange with something else this tick — try again next sweep
    otaCheckNotified.add(node.uniqueId); // mark before sending — see this function's own comment on why a dropped ACK isn't worth retrying
    const release = await acquireBusLock();
    writeFrame(buildFrame(node.busAddress, CMD.CHECK_OTA));
    // No resolver registered for CMD.ACK (nothing reads it) — just hold
    // the bus lock long enough for the node's reply to actually land and
    // get consumed by the normal frame parser before releasing, same
    // settle time a dial's own exchanges use.
    await new Promise((resolve) => setTimeout(resolve, DIAL_POLL_RESPONSE_TIMEOUT_MS));
    release();
  }
}

// Self-reschedules after it FINISHES (setTimeout, not setInterval) — same
// pattern pollAllDials()/pollNodeLog() already use, and for the same
// reason: POLL_RESPONSE_TIMEOUT_MS alone (2s) is a meaningful fraction of
// a short POLL_INTERVAL_MS, so a single missed node could make one sweep
// run longer than the interval between sweeps. A bare setInterval would
// then start a SECOND sweep on top of the first — the bus mutex stops that
// from corrupting the wire, but it doesn't stop the two sweeps' worth of
// queued exchanges from silently stacking up faster than they drain.
// Self-rescheduling makes that structurally impossible: there's never more
// than one sweep in flight, period, regardless of how long a slow one runs.
async function pollAll(getConfiguredNodes) {
  checkFrameStall();
  checkBusDownReminder(); // runs every cycle regardless of bus state — see its own comment
  // Re-enabled (2026-09-29) — was briefly disabled (2026-09-28) while
  // chasing a total RS485 outage on the one hasDial node that this
  // function targets, initially (wrongly) suspected as its cause. Real
  // root cause, found directly on the hardware: a firmware reflash had
  // wiped that node's EEPROM-persisted bus address back to unconfigured
  // (0x00) — the ~5s TX blink that looked like activity was actually its
  // own ANNOUNCE beacon (ANNOUNCE_INTERVAL_MS, rs485_node.ino), not a
  // reply to anything this file sent — completely unrelated to
  // CMD_CHECK_OTA. Re-addressed via the Console and confirmed working
  // again. Safe to re-enable: that node's currently-flashed firmware
  // already understands CMD_CHECK_OTA (0x0A), and it's still the only
  // hasDial node configured.
  await notifyDialsToCheckOta(getConfiguredNodes);
  for (const node of getConfiguredNodes()) {
    if (node.busAddress == null) continue;
    if (node.kind === 'zoneAudio') {
      if (!node.zoneId) continue;
      await pollZoneAudioNode(node.busAddress, node.zoneId);
      continue;
    }
    if (!node.zoneId) continue;
    const readings = await pollNode(node.busAddress, node.zoneId);
    for (const { type, value } of readings) {
      if (BLENDABLE_TYPES.has(type)) {
        // Own private contributor entry first, THEN re-blend the zone's
        // shared sensorStore key from every contributing node's latest
        // fresh reading — see blendZoneReading()'s own comment. A zone
        // with only one node reporting this type ends up writing the exact
        // same value to the shared key it always did, just via one extra
        // step.
        zoneReadingContributors.set(`${type}-${node.zoneId}-${node.uniqueId}`, { value, updatedAt: Date.now() });
        blendZoneReading(type, node.zoneId, getConfiguredNodes);
      } else {
        sensors.set(`${SENSOR_KEY_PREFIX[type]}-${node.zoneId}`, value, SENSOR_UNIT[type], { source: 'rs485', nodeId: node.uniqueId });
      }
      // A node-wired PIR (see SENSOR_TYPE's own comment) drives the exact
      // same foyer-light automation the Pi's own GPIO-22 PIR does — one
      // shared function (gpio.js's triggerFoyerMotion()) so the two PIRs,
      // covering opposite ends of the same staircase, can never behave
      // differently from each other. Lazily required, same load-order
      // reasoning as thermostat/astro/sound elsewhere in this file.
      if (type === 'motion' && value === 1) {
        require('./gpio').triggerFoyerMotion();
      }
    }
  }
  // Pending nodes go stale (drop off the list) if they stop announcing —
  // e.g. unplugged before ever being configured.
  const now = Date.now();
  for (const [id, n] of pendingNodes) {
    if (now - n.lastSeenAt > ANNOUNCE_STALE_MS) pendingNodes.delete(id);
  }
  pollTimer = setTimeout(() => pollAll(getConfiguredNodes), POLL_INTERVAL_MS);
}

// ── Dial nodes — fast poll loop, separate from pollAll() above ─────────────
// thermostat.js/astro.js/sound.js required lazily (not at module top) to
// avoid any load-order coupling — rs485.js gets required very early
// (nodeRegistry.js requires it too), before those are guaranteed to have
// finished loading.
const SOUND_SOURCE_BYTE = { off: 0, spotify: 1, override1: 2, override2: 3 };

// Individual fault/maintenance TEXT on the dial's Status screen, cycled
// one at a time by rotating — per explicit ask (2026-09-29), reversing
// this file's own earlier design call ("the dial never shows fault/
// maintenance TEXT... no room on a round 480x480 face"). Capped at 3
// items combined (faults prioritized over maintenance, same as the
// badge's own color priority — see buildStatusItems()) and 48 characters
// each: a real household is expected to have at most a couple of these
// active at once, and this is still an ambient glance surface, not meant
// to replace the web app's own full fault/maintenance views.
const MAX_STATUS_ITEMS = 3;
const STATUS_ITEM_TEXT_LEN = 48; // bytes, NUL-padded — dial treats it as a C string

// Builds the up-to-3-item list buildDialPushPayload() encodes below.
// Faults first (more urgent — matches the existing badge's own
// DANGER-over-WARNING color priority), then maintenance, combined list
// truncated to MAX_STATUS_ITEMS. Takes the SAME faults/dueTasks arrays
// pollAllDials() already fetched for faultCount/maintenanceDueCount, so
// this doesn't re-query either service.
function buildStatusItems(faults, dueTasks) {
  const items = [
    ...faults.map(f => ({ isFault: true, text: f.message })),
    ...dueTasks.map(t => ({ isFault: false, text: t.label })),
  ];
  return items.slice(0, MAX_STATUS_ITEMS);
}

function buildDialPushPayload(zone, outdoor, soundZone, now, faultCount, maintenanceDueCount, statusItems) {
  const buf = Buffer.alloc(48 + MAX_STATUS_ITEMS * (1 + STATUS_ITEM_TEXT_LEN));
  buf.writeFloatLE(zone?.target ?? 68, 0);
  buf.writeFloatLE(zone?.currentTemp ?? 0, 4);
  buf.writeFloatLE(zone?.environment?.humidity?.value ?? 0, 8);
  buf.writeFloatLE(zone?.environment?.co2?.value ?? 0, 12);
  buf.writeFloatLE(outdoor?.tempF ?? 0, 16);
  // bit5 humidityAvailable — most zones only carry an SCD41 (co2 only, no
  // BME680 — see envSensors.js's header), so humidity reads permanently
  // null there, not just "not yet reported." Without this flag the dial
  // has no way to tell "genuinely no sensor" apart from "sensor exists but
  // hasn't reported yet" — both would otherwise arrive as the same 0.0
  // sentinel float and render as a false "0% RH" danger reading forever.
  const flags = (zone?.calling ? 1 : 0) | (zone?.coolCalling ? 2 : 0) |
    (zone && zone.safety !== 'normal' ? 4 : 0) | (outdoor?.stale ? 8 : 0) |
    (soundZone?.spotifyEnabled ? 16 : 0) |
    (zone?.environment?.humidity?.value != null ? 32 : 0);
  buf.writeUInt8(flags, 20);
  buf.writeUInt8(now.getHours(), 21);
  buf.writeUInt8(now.getMinutes(), 22);
  buf.writeUInt8(soundZone?.volumePercent ?? 0, 23);
  // Hardware-detected, relayed for display only — see this file's header.
  buf.writeUInt8(SOUND_SOURCE_BYTE[soundZone?.activeSource] ?? 0, 24);
  // Purely a glanceable count for an ambient badge — the dial never shows
  // fault/maintenance TEXT (no room on a round 480x480 face for arbitrary
  // strings, and it'd mean duplicating faults.js's/maintenance.js's detail
  // rendering in firmware); "go check the app" is the answer either way,
  // this just tells the dial whether it should say so.
  buf.writeUInt8(Math.min(faultCount ?? 0, 255), 25);
  buf.writeUInt8(Math.min(maintenanceDueCount ?? 0, 255), 26);

  // ── Clock/weather screen redesign (see this file's header for the full
  // layout) — appended after the original 27 bytes so none of the above
  // offsets ever had to move. weekday/month/day let the dial print
  // "Saturday, 9/26" without carrying any calendar-math logic of its own.
  // weatherCategory is astro.js's own small icon enum (see its
  // weatherCategory() comment) — the dial only ever needs to know how to
  // DRAW each of the 8 values, never what WMO code produced it.
  buf.writeUInt8(now.getDay(), 27);   // 0=Sunday..6=Saturday
  buf.writeUInt8(now.getMonth() + 1, 28);
  buf.writeUInt8(now.getDate(), 29);
  buf.writeUInt8(outdoor?.weatherCategory ?? 2, 30);
  // 255 = no rain expected today — see astro.js's refreshOutdoorCacheOnce()
  // for how "today" and the probability threshold are decided.
  buf.writeUInt8(outdoor?.rainHour ?? 255, 31);
  // 3 forecast points (+3h/+6h/+9h). astro.js only ever returns as many
  // entries as it actually has (e.g. right at a refresh boundary) — a
  // missing point still needs to send SOME bytes to keep every later
  // offset fixed, but 0°F is a real possible reading, so "missing" is its
  // own explicit bit here rather than a magic temperature value that could
  // collide with a genuine cold-weather forecast.
  const forecast = outdoor?.forecast ?? [];
  let forecastValidMask = 0;
  [3, 6, 9].forEach((hoursAhead, i) => {
    const point = forecast.find(f => f.hoursAhead === hoursAhead);
    if (point) forecastValidMask |= (1 << i);
    const offset = 33 + i * 5;
    buf.writeFloatLE(point?.tempF ?? 0, offset);
    buf.writeUInt8(point?.weatherCategory ?? 2, offset + 4);
  });
  buf.writeUInt8(forecastValidMask, 32); // bit0=+3h, bit1=+6h, bit2=+9h

  // ── Status items (see MAX_STATUS_ITEMS/STATUS_ITEM_TEXT_LEN above) —
  // appended after the original 48 bytes, same "never move an existing
  // offset" convention as the Clock/weather block above. Per slot: isFault
  // (1B) + text (STATUS_ITEM_TEXT_LEN B, NUL-padded/truncated). An empty
  // slot (past however many real items there are) is left all-zero —
  // dial_node.ino treats text[0]==0 as "no item here," no separate count
  // byte needed.
  statusItems.forEach((item, i) => {
    const base = 48 + i * (1 + STATUS_ITEM_TEXT_LEN);
    buf.writeUInt8(item.isFault ? 1 : 0, base);
    // Reserve the last byte as a guaranteed NUL terminator even if the
    // message is long enough to otherwise fill the whole field exactly —
    // dial_node.ino trusts this is always a valid, terminated C string.
    // The explicit byte-length cap (3rd arg) matters even after the
    // character-count .slice() above: .slice() counts UTF-16 code units,
    // not bytes, so any non-ASCII character could still encode to more
    // bytes than that count implies — without this cap, write() would
    // happily spill past STATUS_ITEM_TEXT_LEN into the NEXT item's slot
    // (or past the buffer's end, on the last one).
    buf.write(item.text.slice(0, STATUS_ITEM_TEXT_LEN - 1), base + 1, STATUS_ITEM_TEXT_LEN - 1, 'utf8');
  });
  return buf;
}

// One full sweep of every configured dial node, applying any change it
// reports directly via thermostat.js's setZone() — the same function the
// web app's own zone-target route calls, so a dial's input and the web
// UI's input go through one identical code path. Reschedules itself after
// each sweep completes (DIAL_SWEEP_GAP_MS gap), not on a fixed interval
// timer, so it can't overlap itself if a sweep ever runs long.
// Takes the same getConfiguredNodes callback init() does (not a resolved
// array) and re-calls it fresh every sweep — same reasoning as pollAll()
// above, so a dial added/removed via the Console mid-run is picked up on
// the very next sweep instead of needing a restart.
let dialSweepTimer = null;
async function pollAllDials(getConfiguredNodes) {
  // A dial may drive a thermostat zone, a sound zone, or both — the two
  // are separate id spaces (see sound.js's header for why), so a dial
  // node carries both a `zoneId` (thermostat) and a `soundZoneId`. Either
  // may be unset; buildDialPushPayload()/the lookups below default
  // gracefully via optional chaining either way. `hasDial` is independent
  // of `kind` — see nodeRegistry.js — so this node may ALSO be a sensor
  // node pollAll() visits on its own 10s cycle, same bus address.
  const dialNodes = getConfiguredNodes().filter(n => n.hasDial && n.busAddress != null && (n.zoneId || n.soundZoneId));

  // This function reschedules itself every DIAL_SWEEP_GAP_MS forever,
  // regardless of dial count — with zero dials that's just an occasional
  // no-op tick now that the gap matches the ordinary 10s cadence (this used
  // to matter a lot more back when the gap was ~20ms and this ran 50x/sec —
  // see git history for the "starved the RS485 serial port's own data
  // callback" incident that came from doing real work that often with
  // nothing to send it to). Still bail out before any real work below on an
  // empty list, just cheaper insurance now than a hard requirement.
  if (dialNodes.length === 0) {
    dialSweepTimer = setTimeout(() => pollAllDials(getConfiguredNodes), DIAL_SWEEP_GAP_MS);
    return;
  }

  const thermostatSvc = require('./thermostat');
  const astroSvc = require('./astro');
  const soundSvc = require('./sound');
  const faultsSvc = require('./faults');
  const maintenanceSvc = require('./maintenance');
  // Same for every dial in this sweep — computed once, not per node.
  const faults = faultsSvc.getFaults();
  const dueTasks = maintenanceSvc.getState().tasks.filter(t => t.isDue);
  const faultCount = faults.length;
  const maintenanceDueCount = dueTasks.length;
  const statusItems = buildStatusItems(faults, dueTasks);

  for (const node of dialNodes) {
    // This address might currently be mid-exchange with pollAll()'s
    // sensor sweep (only possible for a combined sensor+dial node) —
    // skip it for this pass rather than risk two outstanding requests on
    // the same half-duplex bus. At matched 10s cadences this just means
    // that node's dial-push waits for the next tick, ~10s later — a rare,
    // harmless one-cycle delay, not a retry loop.
    if (usingMock) continue;
    if (pollingAddresses.has(node.busAddress)) continue;

    const zone = thermostatSvc.getState().zones.find(z => z.id === node.zoneId);
    const outdoor = astroSvc.getCachedOutdoorConditions();
    const soundZone = soundSvc.getState().zones.find(z => z.id === node.soundZoneId);
    // Diagnostic-only, see lastPushedTarget's own comment — logs only on an
    // actual change to what's being sent, so this stays silent under
    // normal 1s-cadence operation and only speaks up exactly when a web
    // edit should be on its way to this dial.
    if (zone && lastPushedTarget.get(node.busAddress) !== zone.target) {
      console.log(`[RS485] Pushing target=${zone.target}\xB0F to dial addr=${node.busAddress} zone=${node.zoneId}`);
      lastPushedTarget.set(node.busAddress, zone.target);
    }
    pollingAddresses.add(node.busAddress);
    const release = await acquireBusLock();
    writeFrame(buildFrame(node.busAddress, CMD.POLL_DIAL, buildDialPushPayload(zone, outdoor, soundZone, new Date(), faultCount, maintenanceDueCount, statusItems)));

    // Real production evidence (2026-09-26): this exchange used to fail
    // completely SILENTLY on timeout — no warning, no miss count, nothing —
    // unlike pollNode()'s explicit "NO RESPONSE" tracking below. A real bug
    // (the RP2040's own MAX_PAYLOAD_LEN not raised alongside the 48B
    // payload — see rs485_node.ino) broke every single POLL_DIAL exchange
    // for days with the Console showing a spotless log the whole time,
    // because there was nowhere for a failure here to ever show up. Tracked
    // in its own map, not pollNode()'s shared `consecutiveMisses` — this is
    // a DIFFERENT exchange to the same address, and folding the two
    // together would have the sensor poll's own routine successes
    // constantly resetting a genuine, sustained dial-poll failure back to
    // "1 in a row," masking exactly the kind of silent, persistent break
    // this is here to catch.
    const label = `addr=${node.busAddress}${node.zoneId ? ` zone=${node.zoneId}` : ''} (dial)`;
    const reply = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingDialResolvers.delete(node.busAddress);
        pollingAddresses.delete(node.busAddress);
        release();
        const misses = (dialConsecutiveMisses.get(node.busAddress) || 0) + 1;
        dialConsecutiveMisses.set(node.busAddress, misses);
        if (shouldLogMiss(misses)) {
          console.warn(`[RS485] Dial poll ${label} — NO RESPONSE (timed out after ${DIAL_POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row)`);
        }
        resolve(null);
      }, DIAL_POLL_RESPONSE_TIMEOUT_MS);
      pendingDialResolvers.set(node.busAddress, (state) => {
        clearTimeout(timeout);
        pollingAddresses.delete(node.busAddress);
        release();
        const priorMisses = dialConsecutiveMisses.get(node.busAddress) || 0;
        if (priorMisses > 0) console.log(`[RS485] Dial poll ${label} — RECOVERED after ${priorMisses} consecutive misses`);
        dialConsecutiveMisses.set(node.busAddress, 0);
        resolve(state);
      });
    });
    if (!reply) continue;

    // Strictly the Spotify-enable gate — see sound.js's header. Checked
    // independent of `changed`, which is only about the volume value.
    if (reply.mode === DIAL_MODE.sound && reply.tapEvent === DIAL_TAP_EVENT.toggleSpotifyEnabled && node.soundZoneId) {
      try {
        const current = soundSvc.getState().zones.find(z => z.id === node.soundZoneId);
        await soundSvc.setZoneEnabled(node.soundZoneId, !current?.spotifyEnabled);
      } catch (err) {
        console.warn(`[RS485] Dial ${node.uniqueId} enable-toggle rejected:`, err.message);
      }
    }

    // The Status screen's "Mark Done" button — independent of `mode` (it's
    // a separate screen from Thermostat/Sound), so no `reply.mode` gate
    // here unlike the Spotify toggle above. Completes every currently-due
    // task rather than a specific one: the dial deliberately never renders
    // per-task text (see dial_node.ino's header), so there's no way for it
    // to identify a single task to complete — a coarser "clear what's due
    // right now" action is the only one that makes sense from this screen.
    if (reply.tapEvent === DIAL_TAP_EVENT.markMaintenanceDone) {
      try {
        const due = maintenanceSvc.getState().tasks.filter(t => t.isDue);
        for (const task of due) await maintenanceSvc.completeTask(task.id);
      } catch (err) {
        console.warn(`[RS485] Dial ${node.uniqueId} maintenance-done rejected:`, err.message);
      }
    }

    if (!reply.changed) continue;
    // Diagnostic-only, see lastPushedTarget's own comment — this only ever
    // fires while the dial's own pendingChange flag is set (a real local
    // edit, held for PUSH_OVERRIDE_GRACE_MS — see dial_node.ino), so it's
    // not a per-tick spam risk, just invisible today because there was
    // previously no success-path logging here at all, only a rejection
    // warning on failure.
    console.log(`[RS485] Dial ${node.uniqueId} reports changed: mode=${reply.mode} newTargetF=${reply.newTargetF} newVolumePercent=${reply.newVolumePercent}`);
    try {
      if (reply.mode === DIAL_MODE.thermostat && node.zoneId) {
        // Always thermostat.js — it's the single source of truth for a
        // zone's target/schedule/on/manualHeat regardless of which plant is
        // actually delivering heat right now (see thermostat.js's getState()
        // target comment, and boiler.js's tick()/getState(), which read
        // through to this same settings object rather than keeping their
        // own copy).
        await thermostatSvc.setZone(node.zoneId, { target: reply.newTargetF });
        console.log(`[RS485] Applied dial target=${reply.newTargetF}\xB0F to zone=${node.zoneId}`);
      } else if (reply.mode === DIAL_MODE.sound && node.soundZoneId) {
        await soundSvc.setZoneVolume(node.soundZoneId, reply.newVolumePercent);
        console.log(`[RS485] Applied dial volume=${reply.newVolumePercent}% to soundZone=${node.soundZoneId}`);
      }
    } catch (err) {
      console.warn(`[RS485] Dial ${node.uniqueId} change rejected:`, err.message);
    }
  }

  dialSweepTimer = setTimeout(() => pollAllDials(getConfiguredNodes), DIAL_SWEEP_GAP_MS);
}

// ── Public API ───────────────────────────────────────────────────────────
function getPending() {
  return Array.from(pendingNodes.values()).map(n => ({ uniqueId: n.uniqueId }));
}

// Assigns the next free bus address (1-250) and tells the node to adopt it.
// Called once, when a pending node is named/configured via the Console.
function assignAddress(uniqueId, usedAddresses) {
  let addr = 1;
  const used = new Set(usedAddresses);
  while (used.has(addr) && addr < 250) addr++;
  const idBytes = Buffer.from(uniqueId, 'hex');
  const payload = Buffer.concat([idBytes, Buffer.from([addr])]);
  writeFrame(buildFrame(0x00, CMD.ASSIGN, payload));
  pendingNodes.delete(uniqueId);
  return addr;
}

let pollTimer = null;
function init(getConfiguredNodes) {
  openTransport();
  pollAll(getConfiguredNodes); // self-reschedules — see its own comment
  pollAllDials(getConfiguredNodes); // self-reschedules — see its own comment
  pollNodeLog(getConfiguredNodes); // self-reschedules — see its own comment
  console.log('[RS485] Service initialized.');
}

function isBusDown() {
  return busDown;
}

// address must currently be idle (not mid-poll/mid-dial-sweep) — callers
// needing a node's live busAddress should read it from nodeRegistry, same
// as everywhere else in this codebase.
module.exports = { init, getPending, assignAddress, isBusDown, flashFirmware, CMD, SENSOR_TYPE, DIAL_MODE };
