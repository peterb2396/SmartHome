const mongoose = require('mongoose');

// Flexible schema — stores arbitrary key/value pairs from the frontend
const settingsSchema = new mongoose.Schema({}, { strict: false });
const Settings = mongoose.model('Settings', settingsSchema);

let settings = {};

async function init() {
  settings = (await Settings.findOne()) || {};
}

async function updateSetting(key, value) {
  const result = await Settings.findOneAndUpdate(
    {},
    { [key]: value },
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

module.exports = { init, get, refresh, updateSetting, Settings };
