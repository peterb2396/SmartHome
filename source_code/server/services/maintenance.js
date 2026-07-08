/**
 * Maintenance Service
 * ─────────────────────────────────────────────────────────────────
 * Tracks routine home maintenance tasks (e.g. "Replace HVAC filter",
 * "Winterize sprinklers"), each recurring on a chosen frequency. A daily
 * cron checks for anything due and sends a Bark push once a week for as
 * long as it stays incomplete — marking a task done in the Maintenance tab
 * is what stops the nagging and rolls the due date forward to the next
 * cycle.
 *
 * Storage: one schema-less settings blob (key 'maintenance'), same pattern
 * as thermostat.js — { tasks: [ {id, label, frequency, createdAt,
 * lastCompleted, nextDue, lastNotifiedAt} ] }.
 */

const moment = require('moment');
const cron   = require('node-cron');
const crypto = require('crypto');
const settingsSvc  = require('./settings');
const astro        = require('./astro');
const { sendPush } = require('./mail');

const CRON_OPTS = { scheduled: true, timezone: astro.TZ };
const NOTIFY_INTERVAL_DAYS = 7;

// ── Frequency configuration ──────────────────────────────────────────────────
// Fixed-interval frequencies recur every N days from the last completion (or
// creation date, if never completed). Seasonal frequencies instead recur on
// a fixed calendar date each year (meteorological season starts), since
// "winterize the sprinklers" means every autumn, not "90 days after
// whenever I last got around to it."
const FREQUENCIES = {
  Weekly:    { days: 7 },
  Monthly:   { days: 30 },
  Quarterly: { days: 90 },
  Yearly:    { days: 365 },
  Spring:    { seasonStart: [3, 1] },  // [month, day], month is 1-indexed here for readability
  Summer:    { seasonStart: [6, 1] },
  Fall:      { seasonStart: [9, 1] },
  Winter:    { seasonStart: [12, 1] },
};

function nextDueFrom(frequency, fromMoment) {
  const config = FREQUENCIES[frequency];
  if (!config) throw new Error(`Unknown frequency ${frequency}`);
  if (config.days) return moment(fromMoment).add(config.days, 'days');

  const [month, day] = config.seasonStart;
  const due = moment(fromMoment).month(month - 1).date(day).startOf('day');
  if (!due.isAfter(fromMoment, 'day')) due.add(1, 'year');
  return due;
}

// ── Settings I/O ──────────────────────────────────────────────────────────────
function getSettings() {
  const stored = settingsSvc.get()?.maintenance;
  return stored || { tasks: [] };
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('maintenance', next);
}

// ── Task CRUD ─────────────────────────────────────────────────────────────────
async function addTask({ label, frequency }) {
  if (!label || !label.trim()) throw new Error('label is required');
  if (!FREQUENCIES[frequency]) throw new Error(`Unknown frequency ${frequency}`);
  const settings = getSettings();
  const now = moment();
  const task = {
    id: crypto.randomUUID(),
    label: label.trim(),
    frequency,
    createdAt: now.toISOString(),
    lastCompleted: null,
    nextDue: nextDueFrom(frequency, now).toISOString(),
    lastNotifiedAt: null,
  };
  const next = { ...settings, tasks: [...settings.tasks, task] };
  await saveSettings(next);
  return next;
}

async function updateTask(id, { label, frequency }) {
  const settings = getSettings();
  const task = settings.tasks.find(t => t.id === id);
  if (!task) throw new Error(`Unknown task ${id}`);
  const updated = { ...task };
  if (typeof label === 'string' && label.trim()) updated.label = label.trim();
  if (frequency) {
    if (!FREQUENCIES[frequency]) throw new Error(`Unknown frequency ${frequency}`);
    updated.frequency = frequency;
    // Changing frequency re-anchors the due date from the last known
    // completion (or creation, if never completed) under the new schedule.
    updated.nextDue = nextDueFrom(frequency, moment(updated.lastCompleted || updated.createdAt)).toISOString();
  }
  const tasks = settings.tasks.map(t => (t.id === id ? updated : t));
  const next = { ...settings, tasks };
  await saveSettings(next);
  return next;
}

async function deleteTask(id) {
  const settings = getSettings();
  const tasks = settings.tasks.filter(t => t.id !== id);
  const next = { ...settings, tasks };
  await saveSettings(next);
  return next;
}

async function completeTask(id) {
  const settings = getSettings();
  const task = settings.tasks.find(t => t.id === id);
  if (!task) throw new Error(`Unknown task ${id}`);
  const now = moment();
  const updated = {
    ...task,
    lastCompleted: now.toISOString(),
    nextDue: nextDueFrom(task.frequency, now).toISOString(),
    lastNotifiedAt: null, // reset so the next due cycle starts nagging fresh
  };
  const tasks = settings.tasks.map(t => (t.id === id ? updated : t));
  const next = { ...settings, tasks };
  await saveSettings(next);
  return next;
}

// ── Weekly nag ────────────────────────────────────────────────────────────────
// Runs daily; only actually pushes once every NOTIFY_INTERVAL_DAYS per task,
// so something that becomes due mid-week gets notified promptly and then
// re-nagged weekly rather than either spamming daily or waiting for a fixed
// weekly cron slot.
async function checkAndNotify() {
  const settings = getSettings();
  const now = moment();
  let changed = false;
  const tasks = settings.tasks.map(task => {
    const isDue = !moment(task.nextDue).isAfter(now);
    if (!isDue) return task;
    const dueForNotify = !task.lastNotifiedAt ||
      moment(now).diff(moment(task.lastNotifiedAt), 'days') >= NOTIFY_INTERVAL_DAYS;
    if (!dueForNotify) return task;
    sendPush(`${task.label} is due for maintenance.`, 'Maintenance');
    changed = true;
    return { ...task, lastNotifiedAt: now.toISOString() };
  });
  if (changed) await saveSettings({ ...settings, tasks });
}

// ── Frontend-facing state ────────────────────────────────────────────────────
function getState() {
  const settings = getSettings();
  const now = moment();
  const tasks = settings.tasks.map(task => {
    const nextDue = moment(task.nextDue);
    return {
      id: task.id,
      label: task.label,
      frequency: task.frequency,
      lastCompleted: task.lastCompleted,
      nextDue: task.nextDue,
      daysUntilDue: nextDue.diff(now, 'days'),
      isDue: !nextDue.isAfter(now),
    };
  });
  // Due items first (most overdue first), then upcoming by soonest due date.
  tasks.sort((a, b) => (a.isDue !== b.isDue ? (a.isDue ? -1 : 1) : a.daysUntilDue - b.daysUntilDue));
  return { tasks, frequencies: Object.keys(FREQUENCIES) };
}

function init() {
  cron.schedule('0 9 * * *', checkAndNotify, CRON_OPTS);
  console.log('[Maintenance] Initialized.');
}

module.exports = {
  init,
  getState,
  addTask,
  updateTask,
  deleteTask,
  completeTask,
  checkAndNotify,
  FREQUENCIES,
};
