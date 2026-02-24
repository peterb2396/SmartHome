const mongoose = require('mongoose');

/**
 * Camera
 * Registered cameras in the system.
 * Each camera has a unique ID, a human label, and a stream URL.
 * Recordings are stored on a local drive path; oldest files are pruned when
 * the drive exceeds maxStorageGB.
 */
const cameraSchema = new mongoose.Schema({
  cameraId:      { type: String, required: true, unique: true }, // e.g. "front-door"
  label:         { type: String, required: true },               // "Front Door"
  streamUrl:     { type: String, default: '' },                  // RTSP or HTTP stream URL
  snapshotUrl:   { type: String, default: '' },                  // static JPEG URL (optional)
  location:      { type: String, default: '' },                  // "Outside / Front"
  recordingPath: { type: String, default: '' },                  // local path where clips are stored
  maxStorageGB:  { type: Number, default: 10 },                  // auto-prune when exceeded
  enabled:       { type: Boolean, default: true },
  addedAt:       { type: Date, default: Date.now },
}, { strict: false });

module.exports = mongoose.model('Camera', cameraSchema);
