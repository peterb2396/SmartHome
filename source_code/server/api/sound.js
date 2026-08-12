/**
 * Sound Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /sound                — zone list (volume, spotifyEnabled,
 *                               hardware-reported activeSource) + Spotify
 *                               Connect play-state, merged into one
 *                               response so the frontend doesn't need two
 *                               requests.
 * POST /sound/zone/:id       — { volumePercent?, spotifyEnabled? }
 *
 * See services/sound.js for the 3-tier local-priority design — this file
 * only ever sets the Spotify-enable gate and volume; which input a zone
 * actually plays is decided by that zone's own hardware, not commanded
 * from here.
 */

const router = require('express').Router();
const soundSvc = require('../services/sound');
const spotifySvc = require('../services/spotify');

function getFullState() {
  return { ...soundSvc.getState(), spotify: spotifySvc.getState() };
}

router.get('/sound', (req, res) => {
  res.json(getFullState());
});

router.post('/sound/zone/:id', async (req, res) => {
  try {
    const { volumePercent, spotifyEnabled } = req.body;
    if (typeof volumePercent === 'number') await soundSvc.setZoneVolume(req.params.id, volumePercent);
    if (typeof spotifyEnabled === 'boolean') await soundSvc.setZoneEnabled(req.params.id, spotifyEnabled);
    // Keep spotify.js's routed-zone set in sync with whichever zones
    // currently have Spotify enabled — see spotify.js's header for why
    // this is "which zones," not "which zone." Routing is independent of
    // activeSource: the Pi always sends the stream to every enabled zone
    // and lets that zone's own hardware decide whether to actually use it.
    const routed = soundSvc.getState().zones.filter(z => z.spotifyEnabled).map(z => z.id);
    spotifySvc.setRoutedZones(routed);
    res.json({ ok: true, state: getFullState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
