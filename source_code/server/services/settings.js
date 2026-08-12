const mongoose = require('mongoose');

// Flexible schema — stores arbitrary key/value pairs from the frontend
const settingsSchema = new mongoose.Schema({}, { strict: false });
const Settings = mongoose.model('Settings', settingsSchema);

let settings = {};

async function init() {
  settings = (await Settings.findOne()) || {};
}

async function updateSetting(key, value) {
  return updateSettings({ [key]: value });
}

// Multi-key version of updateSetting — one atomic Mongo write instead of N
// sequential ones. Matters anywhere two or more fields must land together
// or not at all (e.g. smartthings.js's access+refresh token pair — writing
// them as two separate updateSetting() calls left a real window where a
// restart or a concurrent write landing between them could persist a fresh
// access token next to an already-consumed, dead refresh token).
async function updateSettings(patch) {
  const result = await Settings.findOneAndUpdate(
    {},
    patch,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  settings = result.toObject();
  return settings;
}

async function refresh() {
  settings = await Settings.findOne();
}

function get() {
  return settings;
}

module.exports = { init, get, refresh, updateSetting, updateSettings, Settings };
