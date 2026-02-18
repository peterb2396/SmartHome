const mongoose = require('mongoose');

const monthlyStatsSchema = new mongoose.Schema({
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true
  },
  categories: {
    Food: { type: Number, default: 0 },
    Electric: { type: Number, default: 0 },
    Gas: { type: Number, default: 0 },
    Internet: { type: Number, default: 0 },
    Mortgage: { type: Number, default: 0 },
    General: { type: Number, default: 0 },
    Income: { type: Number, default: 0 }
  },
  totalExpenses: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Unique index for year-month combination
monthlyStatsSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyStats', monthlyStatsSchema);
