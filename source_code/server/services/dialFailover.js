/**
 * Dial Failover
 * ─────────────────────────────────────────────────────────────────
 * When a zone has no working wall dial of its own — either its hasDial
 * RS485 node is down, or one was simply never set up for that zone yet —
 * it temporarily MERGES onto a different zone's working dial: both
 * zones share that one dial's rotary/touch target-temp control and its
 * onboard temp/humidity/CO2 reading, as if they were one zone, for as
 * long as the merged-in zone has nothing of its own. This is additive,
 * not exclusive — a working dial keeps serving its OWN zone exactly as
 * before AND simultaneously drives every other zone merged onto it;
 * nothing is "taken away" from the zone that owns it. Any number of
 * zones can merge onto the same dial at once (e.g. three unconfigured
 * zones all merging onto the one zone that actually has a working dial,
 * per the explicit ask this was built from). The zone itself never
 * actually stops working either way (thermostat.js's schedule/target/
 * manualHeat run regardless of any dial, see its own header) — this is
 * purely about keeping SOME physical interface and SOME real sensor
 * reading available, not a safety mechanism.
 *
 * Health is tracked here (not duplicated from rs485.js's own
 * dialConsecutiveMisses, which exists purely for its own log throttling)
 * so it can be driven from pollAllDials()'s actual POLL_DIAL round trips —
 * the one signal that actually means "this zone's dial is reachable right
 * now" — and consulted by BOTH pollAllDials() (who to push/pull for a
 * zone) and pollAll()'s blendZoneReading() (whose onboard sensor counts
 * toward a zone's blended reading), via resolveZoneGroups() below,
 * without the two loops needing to coordinate directly.
 *
 * Which dial a zone with nothing of its own merges onto: its explicit
 * preference if one is set and that node is up (setPreferredBackup), else
 * a single shared DEFAULT — the first up hasDial node found at all. Using
 * one shared default (rather than spreading unassigned zones across every
 * available dial) is deliberate: it's what makes "all three of my down
 * zones merge onto the one dial that's actually up" the out-of-the-box
 * behavior, matching a household's own mental model of "temporarily one
 * zone," rather than an arbitrary fan-out. Set an explicit preference to
 * put a specific zone in a DIFFERENT merge group instead.
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

// For every THERMOSTAT zone (zoneIds — ALL of them, not just ones with a
// hasDial node already configured: a zone whose dial was simply never set
// up yet needs to merge onto one exactly like a zone whose dial died, see
// this file's header), decides which node's dial it's currently part of.
// Returns Map<nodeUniqueId, Set<zoneId>> — every UP hasDial node mapped
// to the FULL set of zones currently merged onto it (always including its
// own zoneId once it's up). A zone with no up node anywhere to merge onto
// (nothing of its own AND no default/preferred backup up either) simply
// appears in no group.
function resolveZoneGroups(hasDialNodes, zoneIds) {
  const byZone = new Map();
  for (const id of zoneIds) byZone.set(id, []);
  for (const n of hasDialNodes) {
    if (!n.zoneId) continue;
    if (!byZone.has(n.zoneId)) byZone.set(n.zoneId, []); // a configured node pointed at a zoneId outside the passed list — keep it rather than drop it
    byZone.get(n.zoneId).push(n);
  }

  const groups = new Map(); // uniqueId -> Set<zoneId>
  function addToGroup(uniqueId, zoneId) {
    if (!groups.has(uniqueId)) groups.set(uniqueId, new Set());
    groups.get(uniqueId).add(zoneId);
  }

  // Every zone with an up node of its own anchors its OWN group with it —
  // merging is additive, so this doesn't block anyone else from ALSO
  // merging onto the same node below.
  for (const [zoneId, nodes] of byZone) {
    const ownUp = nodes.find(n => isUp(n.uniqueId));
    if (ownUp) addToGroup(ownUp.uniqueId, zoneId);
  }

  // The one shared default for every zone with nothing of its own and no
  // (working) explicit preference — see this file's header on why this
  // is a single shared node, not spread across whatever's available.
  const defaultBackup = hasDialNodes.find(n => isUp(n.uniqueId)) || null;

  for (const [zoneId, nodes] of byZone) {
    if (nodes.some(n => isUp(n.uniqueId))) continue; // already anchored above
    const preferred = getPreferredBackup(zoneId);
    const backupId = (preferred && isUp(preferred) && hasDialNodes.some(n => n.uniqueId === preferred))
      ? preferred
      : defaultBackup?.uniqueId;
    if (backupId) addToGroup(backupId, zoneId);
  }

  return groups;
}

// Every zone a given hasDial node is currently representing — its own
// (once up) plus whatever's merged onto it. A node not up at all, or with
// no zoneId of its own (sound-only), just returns its own zoneId alone.
function getHostedZoneIds(groups, node) {
  const hosted = groups.get(node.uniqueId);
  return hosted ? Array.from(hosted) : (node.zoneId ? [node.zoneId] : []);
}

// Whether a given node's reading/control currently counts toward zoneId —
// true for its own zone once it's up, AND for every zone merged onto it;
// a plain non-hasDial sensor node is unaffected by any of this (it only
// ever reports to its own real zone).
function nodeContributesToZone(groups, node, zoneId) {
  if (!node.hasDial) return node.zoneId === zoneId;
  const hosted = groups.get(node.uniqueId);
  return hosted ? hosted.has(zoneId) : node.zoneId === zoneId;
}

// Console status view — EVERY thermostat zone (not just ones with a
// hasDial node already set up — a never-configured zone is exactly the
// case this exists to cover), who's actually serving it right now, and
// what else is available to pick as a preferred backup.
function getStatus(getConfiguredNodes, zones) {
  const allNodes = getConfiguredNodes();
  const hasDialNodes = allNodes.filter(n => n.hasDial && n.busAddress != null && n.zoneId);
  const zoneIds = zones.map(z => z.id);
  const groups = resolveZoneGroups(hasDialNodes, zoneIds);
  const nodeById = new Map(hasDialNodes.map(n => [n.uniqueId, n]));

  // zoneId -> the node currently hosting it (for display — a zone only
  // ever shows ONE "serving" node even though that node may ALSO be
  // hosting several other zones at once; see mergedWith below for the
  // rest of its group).
  const servingByZone = new Map();
  for (const [uniqueId, zoneSet] of groups) {
    for (const zid of zoneSet) servingByZone.set(zid, uniqueId);
  }

  return zones.map(z => {
    const ownNodes = hasDialNodes.filter(n => n.zoneId === z.id);
    const servingId = servingByZone.get(z.id) || null;
    const serving = servingId ? nodeById.get(servingId) : null;
    const isBackup = !!serving && serving.zoneId !== z.id;
    const mergedWith = servingId
      ? Array.from(groups.get(servingId)).filter(zid => zid !== z.id)
      : [];
    return {
      zoneId: z.id,
      zoneLabel: z.label,
      hasOwnDial: ownNodes.length > 0,
      ownUp: ownNodes.some(n => isUp(n.uniqueId)),
      servingNodeUniqueId: servingId,
      servingNodeName: serving?.name ?? null,
      isBackup,
      mergedWith, // other zoneIds currently sharing the same dial/sensor
      preferredBackupUniqueId: getPreferredBackup(z.id),
      candidates: hasDialNodes
        .filter(n => n.zoneId !== z.id)
        .map(n => ({ uniqueId: n.uniqueId, name: n.name, zoneId: n.zoneId, up: isUp(n.uniqueId) })),
    };
  });
}

module.exports = {
  reportResult, isUp, resolveZoneGroups, getHostedZoneIds, nodeContributesToZone,
  getPreferredBackup, setPreferredBackup, getStatus, DOWN_THRESHOLD,
};
