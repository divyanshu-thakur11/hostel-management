const mongoose = require('mongoose');

const rentHistorySchema = new mongoose.Schema({
  oldRent:   { type: Number, default: 0 },
  newRent:   { type: Number, default: 0 },
  changedOn: { type: Date, default: Date.now },
  changedBy: { type: String, default: 'owner' },
  reason:    { type: String, default: '' },
}, { _id: false });

const roomSchema = new mongoose.Schema({
  hostelId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  roomNumber:  { type: Number, required: true },
  rent:        { type: Number, default: 0 },
  advance:     { type: Number, default: 0 },
  maxCapacity: { type: Number, default: 6 },
  notes:       { type: String, default: '' },
  rentHistory: { type: [rentHistorySchema], default: [] }, // F2: tracks every rent change
}, { timestamps: true });

roomSchema.index({ hostelId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('Room', roomSchema);