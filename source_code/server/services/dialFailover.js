/**
 * Dial Failover
 * ─────────────────────────────────────────────────────────────────
 * When a zone's own wall dial (its hasDial RS485 node) stops answering
 * POLL_DIAL, this picks a DIFFERENT zone's working dial to stand in for
 * it — its rotary/touch target-temp control and its onboard temp/humidity/
 * CO2 reading both get redirected to the down zone, for as long as the
 * down zone's own dial stays unreachable. The zone itself never actually
 * stops working either way (thermostat.js's schedule/target/manualHeat
 * run regardless of any dial, see its own header) — this is purely about
 * keeping SOME physical interface available, not a safety mechanism.
 *
 * Health is tracked here (not duplicated from rs485.js's own
 * dialConsecutiveMisses, which exists purely for its own log throttling)
 * so it can be driven from pollAllDials()'s actual POLL_DIAL round trips —
 * the one signal that actually means "this zone's dial is reachable right
 * now" — and consulted by BOTH pollAllDials() (who to push/pull for a
 * zone) and pollAll()'s blendZoneReading() (whose onboard sensor counts
 * toward a zone's blended reading), via resolveActiveNodes()/
 * effectiveZoneIdFor() below, without the two loops needing to coordinate
 * directly.
 *
 * A node only ever gets borrowed as a backup for ONE zone at a time (it's
 * one physical screen) — with fewer up dials than down zones, whichever
 * down zones get resolved first in resolveActiveNodes() below claim the
 * available ones; the rest simply have no physical dial until another one
 * recovers, same as a zone that never had a dial configured at all.
 *
 * Storage follows the same schema-less settings-blob pattern as
 * thermostat.js/maintenance.js/nodeRegistry.js (key 'dialFailover') —
 * just the user's explicit backup PREFERENCE per zone, not live health
 * (that's runtime-only, rebuilt from scratch on every server restart as
 * nodes report in again).
 */

const settingsSvc = require('./settings');

function getSettings() {
  return settingsSvc.get()?.dialFailover || {};
}

function getPreferredBackup(zoneId) {
  return getSettings()[zoneId] || null;
}

async function setPreferredBackup(zoneId, backupUniqueId) {
  const next = { ...getSettings() };
  if (backupUniqueId) next[zoneId] = backupUniqueId;
  else delete next[zoneId];
  await settingsSvc.updateSetting('dialFailover', next);
}

// Consecutive missed POLL_DIAL round trips before a node's dial is
// considered down — reported by pollAllDials() after every exchange
// (success resets straight to 0, same "recovers instantly" behavior as
// everything else in this codebase that tracks a miss streak). In-memory
// only, same as every other RS485 liveness signal (dialConsecutiveMisses,
// pendingNodes) — there's nothing to persist, a restart just rebuilds it
// from the next few real polls.
const DOWN_THRESHOLD = 5;
const missStreaks = new Map(); // uniqueId -> consecutive misses

function reportResult(uniqueId, ok) {
  missStreaks.set(uniqueId, ok ? 0 : (missStreaks.get(uniqueId) || 0) + 1);
}

// Unknown (never polled yet, e.g. right after boot) defaults to "up" —
// optimistic until proven otherwise, same reasoning as every other
// first-reading default in this codebase (see dial_node.ino's
// humidityAvailable comment for the general pattern).
function isUp(uniqueId) {
  return (missStreaks.get(uniqueId) || 0) < DOWN_THRESHOLD;
}

// For every THERMOSTAT zone with at least one hasDial node, decides which
// ONE node is actively serving it this cycle: its own node if any of its
// own are up, otherwise a backup (preferred if set/up/unclaimed, else the
// first available up+unclaimed hasDial node). Returns Map<zoneId,
// uniqueId> — a zone with zero up nodes anywhere (its own AND no spare
// available) simply has no entry.
function resolveActiveNodes(hasDialNodes) {
  const byZone = new Map();
  for (const n of hasDialNodes) {
    if (!n.zoneId) continue;
    if (!byZone.has(n.zoneId)) byZone.set(n.zoneId, []);
    byZone.get(n.zoneId).push(n);
  }

  const claimed = new Set();
  const active = new Map();

  // Pass 1 — DOWN zones (none of their own nodes up) claim a backup
  // FIRST, from every up hasDial node regardless of whose zone it
  // normally belongs to. A zone with nothing of its own takes priority
  // over a zone that still has a working dial — see this file's header:
  // "use that backup interface from another zone" means exactly this,
  // including a healthy zone's own (and only) dial, if that's what's
  // available. Order here is just Map iteration order (insertion order =
  // hasDialNodes' own order, itself nodeRegistry's name-sorted list);
  // with fewer spares than down zones, earlier zones in that order win —
  // set an explicit preferred backup (setPreferredBackup) to control
  // which one that is instead of leaving it to this ordering.
  // 1a — explicit preferences first, across every down zone, before any
  // auto-pick touches the pool — otherwise whichever down zone happens
  // to iterate first grabs the one spare regardless of some OTHER zone
  // having explicitly asked for it (a real bug caught by testing: with
  // one spare and zoneC preferring it, zoneA — earlier in iteration
  // order — claimed it first under a single-pass version of this).
  for (const [zoneId, nodes] of byZone) {
    if (nodes.some(n => isUp(n.uniqueId))) continue; // has its own — handled in pass 2
    const preferred = getPreferredBackup(zoneId);
    if (preferred && isUp(preferred) && !claimed.has(preferred) && hasDialNodes.some(n => n.uniqueId === preferred)) {
      active.set(zoneId, preferred);
      claimed.add(preferred);
    }
  }
  // 1b — everything left without a satisfied preference auto-picks
  // whatever's still unclaimed, preferring a TRULY free spare (one whose
  // own zone has another up node too, so lending it costs that zone
  // nothing — e.g. the 3-independent-RP2040 Upstairs zone, where a
  // second/third dial is redundant with the first) over sacrificing a
  // single-dial zone's only interface. Falls back to sacrificing one
  // anyway if that's genuinely all that's left — see this file's header,
  // that's the literal "3 down, 1 up" case this whole feature exists for.
  const upCountByZone = new Map();
  for (const [zoneId, nodes] of byZone) upCountByZone.set(zoneId, nodes.filter(n => isUp(n.uniqueId)).length);
  for (const [zoneId, nodes] of byZone) {
    if (active.has(zoneId) || nodes.some(n => isUp(n.uniqueId))) continue;
    const spare = hasDialNodes.find(n => isUp(n.uniqueId) && !claimed.has(n.uniqueId) && upCountByZone.get(n.zoneId) > 1)
      || hasDialNodes.find(n => isUp(n.uniqueId) && !claimed.has(n.uniqueId));
    if (spare) { active.set(zoneId, spare.uniqueId); claimed.add(spare.uniqueId); }
  }

  // Pass 2 — every zone with an up node of its own keeps it, UNLESS pass
  // 1 just claimed that exact node to rescue a DOWN zone instead — that
  // zone is sacrificed for this cycle (no dial, same as a zone that never
  // had one — thermostat.js keeps running it via the web app/schedule
  // regardless, see this file's header).
  for (const [zoneId, nodes] of byZone) {
    if (active.has(zoneId)) continue;
    const ownUp = nodes.find(n => isUp(n.uniqueId) && !claimed.has(n.uniqueId));
    if (ownUp) { active.set(zoneId, ownUp.uniqueId); claimed.add(ownUp.uniqueId); }
  }

  return active;
}

// Builds a (node) => effectiveZoneId lookup from resolveActiveNodes()'s
// result — a hasDial node not currently claimed as anyone's active
// server (e.g. it's down, or it's up but nobody needs it as a backup)
// just falls through to its own real zoneId, same as before this file
// existed.
function effectiveZoneIdFor(hasDialNodes) {
  const active = resolveActiveNodes(hasDialNodes);
  const byNode = new Map();
  for (const [zoneId, uniqueId] of active) byNode.set(uniqueId, zoneId);
  return (node) => byNode.get(node.uniqueId) ?? node.zoneId;
}

// Console status view — per thermostat zone, who's actually serving it
// right now and what else is available to pick as a preferred backup.
function getStatus(getConfiguredNodes, zones) {
  const allNodes = getConfiguredNodes();
  const hasDialNodes = allNodes.filter(n => n.hasDial && n.busAddress != null && n.zoneId);
  const active = resolveActiveNodes(hasDialNodes);
  const nodeById = new Map(hasDialNodes.map(n => [n.uniqueId, n]));

  return zones
    .filter(z => hasDialNodes.some(n => n.zoneId === z.id))
    .map(z => {
      const ownNodes = hasDialNodes.filter(n => n.zoneId === z.id);
      const servingId = active.get(z.id) || null;
      const serving = servingId ? nodeById.get(servingId) : null;
      const isBackup = !!serving && serving.zoneId !== z.id;
      return {
        zoneId: z.id,
        zoneLabel: z.label,
        ownUp: ownNodes.some(n => isUp(n.uniqueId)),
        servingNodeUniqueId: servingId,
        servingNodeName: serving?.name ?? null,
        isBackup,
        preferredBackupUniqueId: getPreferredBackup(z.id),
        candidates: hasDialNodes
          .filter(n => n.zoneId !== z.id)
          .map(n => ({ uniqueId: n.uniqueId, name: n.name, zoneId: n.zoneId, up: isUp(n.uniqueId) })),
      };
    });
}

module.exports = {
  reportResult, isUp, resolveActiveNodes, effectiveZoneIdFor,
  getPreferredBackup, setPreferredBackup, getStatus, DOWN_THRESHOLD,
};
