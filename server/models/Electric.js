const mongoose = require('mongoose');

const electricSchema = new mongoose.Schema({
  hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  roomNumber: { type: Number, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  startReading: { type: Number, required: true },
  endReading: { type: Number, required: true },
  unitsConsumed: { type: Number },
  ratePerUnit: { type: Number, default: 8 },
  totalAmount: { type: Number },
  isAnomaly: { type: Boolean, default: false }, // F3: anomaly detection flag
}, { timestamps: true });

electricSchema.pre('save', function(next) {
  this.unitsConsumed = this.endReading - this.startReading;
  this.totalAmount = this.unitsConsumed * this.ratePerUnit;
  next();
});

electricSchema.index({ hostelId: 1, roomNumber: 1, year: 1, month: 1 });
module.exports = mongoose.model('Electric', electricSchema);