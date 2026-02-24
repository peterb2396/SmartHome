const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    enum: ['Food', 'Electric', 'Gas', 'Internet', 'Mortgage', 'General', 'Income'],
    required: true,
    index: true
  },
  account: {
    type: String,
    required: true
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
    index: true
  },
  year: {
    type: Number,
    required: true,
    index: true
  },
  isPayment: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
transactionSchema.index({ year: 1, month: 1, category: 1 });
transactionSchema.index({ date: 1, description: 1, amount: 1, account: 1 }, { unique: true });

module.exports = mongoose.model('Transaction', transactionSchema);
