const mongoose = require("mongoose");

const MonthlyStatsSchema = new mongoose.Schema({
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
    Electric: Number,
    Gas: Number,
    Internet: Number,
    Mortgage: Number,
    General: Number,
    Food: Number,
    Income: Number
  },
  totalExpenses: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { strict: false });

// Create index for efficient querying
MonthlyStatsSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model.MonthlyStats || mongoose.model("MonthlyStats", MonthlyStatsSchema, "monthlystats");
