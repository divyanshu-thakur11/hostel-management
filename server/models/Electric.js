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
  // When this specific electric bill is due — independent of the room's rent
  // cycle (e.g. rent might be paid through end-of-month while the electric
  // bill for a mid-month reading is due earlier).
  dueDate: { type: Date },
  // Payment tracking
  paymentStatus: { type: String, enum: ['unpaid', 'paid', 'waived'], default: 'unpaid' },
  // When true, paymentStatus above is a deliberate manual choice (via Mark
  // Paid / Mark Unpaid) and should be trusted as-is. When false, the status
  // shown in the app is worked out automatically from receipts instead —
  // this field is what lets someone correct a misclick without it silently
  // reverting the next time receipts are recalculated.
  manualOverride: { type: Boolean, default: false },
  waivedReason:  { type: String, default: '' },
  waivedBy:      { type: String, default: '' },
  waivedAt:      { type: Date },
}, { timestamps: true });

electricSchema.pre('save', function(next) {
  this.unitsConsumed = this.endReading - this.startReading;
  this.totalAmount = this.unitsConsumed * this.ratePerUnit;
  next();
});

electricSchema.index({ hostelId: 1, roomNumber: 1, year: 1, month: 1 });
module.exports = mongoose.models.Electric || mongoose.model('Electric', electricSchema);