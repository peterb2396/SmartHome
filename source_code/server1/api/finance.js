/**
 * Finance Routes
 * ─────────────────────────────────────────────────────────────────
 * GET /monthly-stats
 * GET /transactions
 * GET /transactions/:category
 */

const router       = require('express').Router();
const MonthlyStats = require('../db/monthlyStatsModel');
const Transaction  = require('../db/transactionModel');

router.get('/monthly-stats', async (req, res) => {
  try {
    const stats = await MonthlyStats.find({}).sort({ year: 1, month: 1 });
    res.status(200).json(stats);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch monthly stats', error: err.message });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const query = {};
    if (req.query.category) query.category = req.query.category;
    if (req.query.year)     query.year      = parseInt(req.query.year);
    if (req.query.month)    query.month     = parseInt(req.query.month);

    const transactions = await Transaction.find(query).sort({ date: -1 });
    res.status(200).json(transactions);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
});

router.get('/transactions/:category', async (req, res) => {
  try {
    const transactions = await Transaction.find({ category: req.params.category }).sort({ date: -1 });
    res.status(200).json(transactions);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
});

module.exports = router;
