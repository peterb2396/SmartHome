const mongoose = require('mongoose');

/**
 * CameraRecording
 * One document per video clip saved to disk by the recording service.
 * The actual file lives at `filePath`; this document lets the frontend
 * browse history without scanning the filesystem directly.
 */
const recordingSchema = new mongoose.Schema({
  cameraId:    { type: String, required: true, index: true },
  filename:    { type: String, required: true },
  filePath:    { type: String, required: true },       // absolute path on Pi
  startedAt:   { type: Date, required: true },
  endedAt:     { type: Date },
  durationSec: { type: Number },
  sizeMB:      { type: Number },
  thumbnail:   { type: String },                       // base64 JPEG or URL
}, { timestamps: true });

module.exports = mongoose.model('CameraRecording', recordingSchema);
