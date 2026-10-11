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
  // Final Bill breakdown — stored explicitly so editing a Final Bill later
  // doesn't have to guess the rent/advance split from "whatever isn't electric".
  rentComponent:    { type: Number },
  advanceComponent: { type: Number },

  amountInWords: { type: String },
  // modeOfPayment stays the two-way cash/online split that Reports, Dashboard and
  // exports already use. paymentMethod is the finer detail (UPI, bank transfer…)
  // and is always consistent with it: cash -> 'cash', everything else -> 'online'.
  modeOfPayment: { type: String, enum: ['cash','online'], default: 'cash' },
  paymentMethod: { type: String, enum: ['cash','upi','bank_transfer','card','cheque','online_other'] },
  referenceNo:   { type: String, trim: true },   // UPI txn id / UTR / cheque no.
  receiptDate:   { type: Date, default: Date.now },
  notes:         { type: String },
  isPaid:        { type: Boolean, default: true },

  // ── Installments ───────────────────────────────────────────────────────
  // A "bill" is the ROOT receipt (the first payment, with the full bill amount
  // in totalAmount). Every later installment is its own receipt that points at
  // the root through parentReceiptId and carries only its own amount.
  //   root:  amountPaid = first payment, cumulativePaid = all installments,
  //          balanceDue = what is still outstanding on the whole bill
  //   child: totalAmount = amountPaid = this installment, balanceDue = 0
  //          (balanceAfter / paidToDate / billTotal are display snapshots)
  // Because only the root carries balanceDue, nothing that sums balanceDue
  // (Dashboard, Dues) can ever count an installment twice, and because each
  // installment keeps its own amountPaid + modeOfPayment, every existing
  // report/collection total stays correct without change.
  parentReceiptId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt', index: true },
  installmentNo:    { type: Number, default: 1 },
  installmentCount: { type: Number, default: 0 },   // root only: number of child installments
  cumulativePaid:   { type: Number },               // root only
  billTotal:        { type: Number },               // child snapshot
  paidToDate:       { type: Number },               // child snapshot (after this installment)
  balanceAfter:     { type: Number },               // child snapshot (after this installment)
  clientRequestId:  { type: String, index: true, sparse: true }, // blocks double-submit duplicates
}, { timestamps: true });

receiptSchema.index({ roomNumber: 1, receiptDate: -1 });
receiptSchema.index({ billNumber: 1 });

// On save, auto-set amountPaid = totalAmount if not a part payment
receiptSchema.pre('save', function(next) {
  // Installment receipts and roots that already have installments are kept
  // consistent by recalcBill() in the controller — don't let this hook undo it.
  if (this.parentReceiptId || (this.installmentCount || 0) > 0) return next();
  if (!this.isPartPayment) {
    this.amountPaid  = this.totalAmount;
    this.balanceDue  = 0;
  } else {
    this.balanceDue  = Math.max(0, (this.totalAmount || 0) - (this.amountPaid || 0));
  }
  // A brand-new bill (no installments yet) has paid exactly its own first payment.
  this.cumulativePaid = this.amountPaid;
  next();
});

module.exports = mongoose.models.Receipt || mongoose.model('Receipt', receiptSchema);
