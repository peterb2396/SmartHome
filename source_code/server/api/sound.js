/**
 * Sound Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /sound                — zone list (volume, source) + Spotify Connect
 *                               play-state, merged into one response so the
 *                               frontend doesn't need two requests.
 * POST /sound/zone/:id       — { volumePercent?, source? }
 *
 * See services/sound.js and services/spotify.js for the "software scaffold,
 * no zone amp hardware yet" caveat — these routes are fully real, they just
 * don't have physical audio to move around yet.
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
    const { volumePercent, source } = req.body;
    if (typeof volumePercent === 'number') await soundSvc.setZoneVolume(req.params.id, volumePercent);
    if (typeof source === 'string') await soundSvc.setZoneSource(req.params.id, source);
    // Keep spotify.js's routed-zone set in sync with whichever zones are
    // currently selecting the 'spotify' source — see spotify.js's header
    // for why this is "which zones," not "which zone."
    const routed = soundSvc.getState().zones.filter(z => z.source === 'spotify').map(z => z.id);
    spotifySvc.setRoutedZones(routed);
    res.json({ ok: true, state: getFullState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
