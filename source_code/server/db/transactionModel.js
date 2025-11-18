const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
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
    required: true,
    enum: ['Electric', 'Gas', 'Internet', 'Mortgage', 'General', 'Food', 'Income']
  },
  account: {
    type: String
  },
  month: {
    type: Number,
    min: 1,
    max: 12
  },
  year: {
    type: Number
  },
  isPayment: {
    type: Boolean,
    default: false
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

// Create indexes for efficient querying
TransactionSchema.index({ category: 1, date: -1 });
TransactionSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model.Transaction || mongoose.model("Transaction", TransactionSchema, "transactions");
