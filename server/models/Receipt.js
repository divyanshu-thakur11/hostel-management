const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  receiptNumber: { type: Number },
  billNumber:    { type: String },
  billYear:      { type: String },
  billSerial:    { type: Number },

  hostelId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', index: true },
  roomNumber:    { type: Number, required: true, index: true },
  month:         { type: String },
  monthYear:     { type: String },

  // Cumulative room receipt — includes all members
  memberName:    { type: String },
  memberMobile:  { type: String },
  memberId:      { type: String },
  members: [{
    name:          { type: String },
    memberId:      { type: String },
    memberUniqueId:{ type: String },
    mobileNo:      { type: String },
  }],

  packageName:   { type: String, enum: ['rent','advance','electric','final','other'], default: 'rent' },
  paymentType:   { type: String, enum: ['rent','advance','electric','final','other'], default: 'rent' },

  fromDate:      { type: Date },
  toDate:        { type: Date },

  // Part payment support
  totalAmount:   { type: Number, default: 0 },  // total bill
  amountPaid:    { type: Number, default: 0 },  // actually paid
  balanceDue:    { type: Number, default: 0 },  // remaining
  isPartPayment: { type: Boolean, default: false },

  // FIX 5: For final receipts that bundle electric, store the electric portion
  // explicitly so DuesAndPayments doesn't need to parse the notes string.
  electricAmount: { type: Number, default: 0 },

  amountInWords: { type: String },
  modeOfPayment: { type: String, enum: ['cash','online'], default: 'cash' },
  receiptDate:   { type: Date, default: Date.now },
  notes:         { type: String },
  isPaid:        { type: Boolean, default: true },
}, { timestamps: true });

receiptSchema.index({ roomNumber: 1, receiptDate: -1 });
receiptSchema.index({ billNumber: 1 });

// On save, auto-set amountPaid = totalAmount if not a part payment
receiptSchema.pre('save', function(next) {
  if (!this.isPartPayment) {
    this.amountPaid  = this.totalAmount;
    this.balanceDue  = 0;
  } else {
    this.balanceDue  = Math.max(0, (this.totalAmount || 0) - (this.amountPaid || 0));
  }
  next();
});

module.exports = mongoose.model('Receipt', receiptSchema);