/**
 * Camera Service
 * ─────────────────────────────────────────────────────────────────
 * Handles:
 *   - Disk usage tracking per camera recording path
 *   - Auto-pruning oldest recordings when maxStorageGB is exceeded
 *   - ffmpeg-based segment recording from RTSP streams
 *   - Snapshot capture via ffmpeg (single JPEG frame)
 *
 * ffmpeg must be installed on the Pi:
 *   sudo apt install ffmpeg
 *
 * Recording segments are named:  <cameraId>_<timestamp>.mp4
 * They are saved to camera.recordingPath and registered in MongoDB.
 *
 * HOW AUTO-PRUNE WORKS:
 *   1. After each new segment is saved, checkAndPrune(camera) is called.
 *   2. It totals the sizeMB of all recordings for that camera in Mongo.
 *   3. If total > maxStorageGB * 1024, it deletes the oldest files
 *      (from disk AND from Mongo) until under the limit.
 */

const fs   = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const Camera          = require('../db/cameraModel');
const CameraRecording = require('../db/cameraRecordingModel');

// ── Disk helpers ─────────────────────────────────────────────────────────────

function getFileSizeMB(filePath) {
  try {
    return fs.statSync(filePath).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

async function checkAndPrune(camera) {
  const maxMB = (camera.maxStorageGB || 10) * 1024;

  // Sum all recording sizes for this camera
  const recordings = await CameraRecording
    .find({ cameraId: camera.cameraId })
    .sort({ startedAt: 1 }); // oldest first

  let totalMB = recordings.reduce((sum, r) => sum + (r.sizeMB || 0), 0);

  while (totalMB > maxMB && recordings.length > 0) {
    const oldest = recordings.shift();
    totalMB -= oldest.sizeMB || 0;

    // Delete file from disk
    try {
      if (oldest.filePath && fs.existsSync(oldest.filePath)) {
        fs.unlinkSync(oldest.filePath);
        console.log(`[Camera] Pruned: ${oldest.filePath}`);
      }
    } catch (e) {
      console.warn(`[Camera] Could not delete ${oldest.filePath}:`, e.message);
    }

    // Remove from Mongo
    await CameraRecording.deleteOne({ _id: oldest._id });
  }
}

// ── Snapshot (single JPEG frame) ─────────────────────────────────────────────

/**
 * Capture one JPEG frame from a stream URL using ffmpeg.
 * Returns a base64-encoded JPEG string, or null on failure.
 */
function captureSnapshot(streamUrl) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-i', streamUrl,
      '-frames:v', '1',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];

    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.on('close', (code) => {
      if (code === 0 && chunks.length) {
        resolve(Buffer.concat(chunks).toString('base64'));
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));

    // Timeout after 8 seconds
    setTimeout(() => { proc.kill(); resolve(null); }, 8000);
  });
}

// ── Continuous segment recording ─────────────────────────────────────────────

// Map of cameraId → ffmpeg child process
const activeRecorders = {};

/**
 * Start recording a camera stream in rolling segments.
 * Each segment is SEGMENT_DURATION_SEC seconds long.
 * @param {Object} camera  - Camera document from Mongo
 */
const SEGMENT_DURATION_SEC = 60 * 10; // 10-minute segments

function startRecording(camera) {
  if (!camera.streamUrl || !camera.recordingPath) {
    console.warn(`[Camera] ${camera.cameraId}: no streamUrl or recordingPath, skipping.`);
    return;
  }

  if (activeRecorders[camera.cameraId]) {
    console.log(`[Camera] ${camera.cameraId} already recording.`);
    return;
  }

  // Ensure directory exists
  try {
    fs.mkdirSync(camera.recordingPath, { recursive: true });
  } catch (e) {
    console.error(`[Camera] Could not create ${camera.recordingPath}:`, e.message);
    return;
  }

  const segmentPattern = path.join(camera.recordingPath, `${camera.cameraId}_%Y%m%d_%H%M%S.mp4`);

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.streamUrl,
    '-c', 'copy',
    '-f', 'segment',
    '-segment_time', String(SEGMENT_DURATION_SEC),
    '-reset_timestamps', '1',
    '-strftime', '1',
    segmentPattern,
  ];

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
  activeRecorders[camera.cameraId] = proc;

  proc.on('close', async (code) => {
    delete activeRecorders[camera.cameraId];
    console.log(`[Camera] ${camera.cameraId} recording stopped (code ${code}).`);

    // Register newly-created segments in Mongo and prune if needed
    try {
      await registerNewSegments(camera);
      await checkAndPrune(camera);
    } catch (e) {
      console.error('[Camera] post-recording cleanup error:', e);
    }
  });

  proc.on('error', (err) => {
    console.error(`[Camera] ${camera.cameraId} ffmpeg error:`, err.message);
    delete activeRecorders[camera.cameraId];
  });

  console.log(`[Camera] Started recording ${camera.cameraId} → ${camera.recordingPath}`);
}

function stopRecording(cameraId) {
  const proc = activeRecorders[cameraId];
  if (proc) {
    proc.kill('SIGTERM');
    delete activeRecorders[cameraId];
  }
}

/**
 * Scan recordingPath for .mp4 files not yet in Mongo and register them.
 */
async function registerNewSegments(camera) {
  if (!camera.recordingPath) return;

  let files;
  try {
    files = fs.readdirSync(camera.recordingPath)
      .filter(f => f.startsWith(camera.cameraId) && f.endsWith('.mp4'));
  } catch {
    return;
  }

  for (const filename of files) {
    const filePath = path.join(camera.recordingPath, filename);
    const exists   = await CameraRecording.findOne({ filePath });
    if (exists) continue;

    const sizeMB = getFileSizeMB(filePath);

    // Parse timestamp from filename e.g. front-door_20250218_143022.mp4
    let startedAt = new Date();
    const match = filename.match(/_(\d{8})_(\d{6})\.mp4$/);
    if (match) {
      const [, date, time] = match;
      startedAt = new Date(
        `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}`
      );
    }

    await CameraRecording.create({
      cameraId: camera.cameraId,
      filename,
      filePath,
      startedAt,
      sizeMB,
    });
  }
}

/**
 * On server boot: start recording for all enabled cameras that have a stream URL.
 */
async function initRecorders() {
  try {
    const cameras = await Camera.find({ enabled: true, streamUrl: { $ne: '' } });
    for (const cam of cameras) {
      startRecording(cam);
    }
    console.log(`[Camera] ${cameras.length} recorder(s) started.`);
  } catch (e) {
    console.error('[Camera] initRecorders error:', e);
  }
}

module.exports = {
  startRecording,
  stopRecording,
  captureSnapshot,
  checkAndPrune,
  registerNewSegments,
  initRecorders,
  activeRecorders,
};
