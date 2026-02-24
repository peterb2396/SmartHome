/**
 * Camera Routes
 * ─────────────────────────────────────────────────────────────────
 *
 * Camera management
 *   GET    /cameras                  List all cameras
 *   POST   /cameras                  Add a new camera
 *   PUT    /cameras/:id              Update camera config
 *   DELETE /cameras/:id              Remove camera + stop recording
 *
 * Live feed / snapshot
 *   GET    /cameras/:id/snapshot     Return latest JPEG snapshot (base64)
 *
 * Recording control
 *   POST   /cameras/:id/record/start   Start continuous recording
 *   POST   /cameras/:id/record/stop    Stop recording
 *
 * Recording history / playback
 *   GET    /cameras/:id/recordings         List saved clips (newest first)
 *   GET    /cameras/recordings/:recId/stream  Stream a clip file to browser
 *   DELETE /cameras/recordings/:recId        Delete a clip
 *
 * Storage info
 *   GET    /cameras/:id/storage       Usage stats for one camera
 *
 * ── Auth ─────────────────────────────────────────────────────────
 * All write routes require Bearer token matching ADMIN_UID.
 * Read routes (list, snapshot, recordings) are open — they're
 * behind your existing login wall on the frontend.
 */

const router   = require('express').Router();
const path     = require('path');
const fs       = require('fs');
const Camera          = require('../db/cameraModel');
const CameraRecording = require('../db/cameraRecordingModel');
const cameraSvc       = require('../services/camera');

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return token === process.env.ADMIN_UID;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// ── List cameras ─────────────────────────────────────────────────────────────
router.get('/cameras', async (req, res) => {
  try {
    const cameras = await Camera.find().sort({ label: 1 });
    // Attach live recording status
    const result = cameras.map(c => ({
      ...c.toObject(),
      isRecording: !!cameraSvc.activeRecorders[c.cameraId],
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Add camera ───────────────────────────────────────────────────────────────
router.post('/cameras', requireAdmin, async (req, res) => {
  try {
    const cam = await Camera.create(req.body);
    res.status(201).json(cam);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Update camera ────────────────────────────────────────────────────────────
router.put('/cameras/:id', requireAdmin, async (req, res) => {
  try {
    const cam = await Camera.findOneAndUpdate(
      { cameraId: req.params.id },
      { $set: req.body },
      { new: true }
    );
    if (!cam) return res.status(404).json({ error: 'Camera not found' });
    res.json(cam);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete camera ────────────────────────────────────────────────────────────
router.delete('/cameras/:id', requireAdmin, async (req, res) => {
  try {
    cameraSvc.stopRecording(req.params.id);
    await Camera.deleteOne({ cameraId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Snapshot ─────────────────────────────────────────────────────────────────
router.get('/cameras/:id/snapshot', async (req, res) => {
  try {
    const cam = await Camera.findOne({ cameraId: req.params.id });
    if (!cam) return res.status(404).json({ error: 'Camera not found' });

    // If a static snapshotUrl is configured, proxy or redirect
    if (cam.snapshotUrl && !cam.streamUrl) {
      return res.redirect(cam.snapshotUrl);
    }

    const url = cam.snapshotUrl || cam.streamUrl;
    if (!url) return res.status(400).json({ error: 'No stream or snapshot URL configured' });

    const b64 = await cameraSvc.captureSnapshot(url);
    if (!b64) return res.status(503).json({ error: 'Could not capture snapshot' });

    res.json({ cameraId: cam.cameraId, snapshot: b64, capturedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start recording ──────────────────────────────────────────────────────────
router.post('/cameras/:id/record/start', requireAdmin, async (req, res) => {
  try {
    const cam = await Camera.findOne({ cameraId: req.params.id });
    if (!cam) return res.status(404).json({ error: 'Camera not found' });
    cameraSvc.startRecording(cam);
    res.json({ ok: true, cameraId: cam.cameraId, isRecording: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stop recording ───────────────────────────────────────────────────────────
router.post('/cameras/:id/record/stop', requireAdmin, async (req, res) => {
  try {
    cameraSvc.stopRecording(req.params.id);
    res.json({ ok: true, cameraId: req.params.id, isRecording: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Recording history ─────────────────────────────────────────────────────────
router.get('/cameras/:id/recordings', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const skip  = parseInt(req.query.skip) || 0;

    const recordings = await CameraRecording
      .find({ cameraId: req.params.id })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CameraRecording.countDocuments({ cameraId: req.params.id });

    res.json({ recordings, total, skip, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stream a recording file to the browser ────────────────────────────────────
router.get('/cameras/recordings/:recId/stream', async (req, res) => {
  try {
    const rec = await CameraRecording.findById(req.params.recId);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    if (!fs.existsSync(rec.filePath)) return res.status(404).json({ error: 'File not found on disk' });

    const stat = fs.statSync(rec.filePath);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : total - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   'video/mp4',
      });
      fs.createReadStream(rec.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type':   'video/mp4',
        'Accept-Ranges':  'bytes',
      });
      fs.createReadStream(rec.filePath).pipe(res);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete a recording ────────────────────────────────────────────────────────
router.delete('/cameras/recordings/:recId', requireAdmin, async (req, res) => {
  try {
    const rec = await CameraRecording.findById(req.params.recId);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    try { fs.unlinkSync(rec.filePath); } catch {}
    await CameraRecording.deleteOne({ _id: rec._id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Storage stats ─────────────────────────────────────────────────────────────
router.get('/cameras/:id/storage', async (req, res) => {
  try {
    const cam = await Camera.findOne({ cameraId: req.params.id });
    if (!cam) return res.status(404).json({ error: 'Camera not found' });

    const recordings = await CameraRecording.find({ cameraId: req.params.id });
    const totalMB    = recordings.reduce((sum, r) => sum + (r.sizeMB || 0), 0);
    const maxMB      = (cam.maxStorageGB || 10) * 1024;
    const count      = recordings.length;

    res.json({
      cameraId:    cam.cameraId,
      usedMB:      Math.round(totalMB),
      usedGB:      (totalMB / 1024).toFixed(2),
      maxGB:       cam.maxStorageGB,
      percentFull: Math.min(100, Math.round((totalMB / maxMB) * 100)),
      clipCount:   count,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
