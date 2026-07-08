/**
 * Maintenance Routes
 * ─────────────────────────────────────────────────────────────────
 * GET    /maintenance            — full state (tasks, valid frequencies)
 * POST   /maintenance/task       — { label, frequency } add a new task
 * PATCH  /maintenance/task/:id   — { label?, frequency? } edit a task
 * DELETE /maintenance/task/:id   — remove a task
 * POST   /maintenance/task/:id/complete — mark done, rolls due date forward
 *
 * Every mutation responds with the same `state` shape as GET /maintenance
 * so the frontend can apply it directly, matching the thermostat routes'
 * pattern of avoiding a racy extra GET right after a write.
 */

const router = require('express').Router();
const maintenanceSvc = require('../services/maintenance');

router.get('/maintenance', (req, res) => {
  res.json(maintenanceSvc.getState());
});

router.post('/maintenance/task', async (req, res) => {
  try {
    const { label, frequency } = req.body;
    await maintenanceSvc.addTask({ label, frequency });
    res.json({ ok: true, state: maintenanceSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.patch('/maintenance/task/:id', async (req, res) => {
  try {
    const { label, frequency } = req.body;
    await maintenanceSvc.updateTask(req.params.id, { label, frequency });
    res.json({ ok: true, state: maintenanceSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/maintenance/task/:id', async (req, res) => {
  try {
    await maintenanceSvc.deleteTask(req.params.id);
    res.json({ ok: true, state: maintenanceSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/maintenance/task/:id/complete', async (req, res) => {
  try {
    await maintenanceSvc.completeTask(req.params.id);
    res.json({ ok: true, state: maintenanceSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
