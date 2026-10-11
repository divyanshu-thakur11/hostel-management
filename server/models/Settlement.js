const mongoose = require('mongoose');

// One line on a member's final settlement statement.
//   credit           → money the hostel owes the member   (advance held, discount/waiver)
//   debit            → money the member owes the hostel    (unpaid rent/electric, damages…)
//   paid_by_member   → member paid something at exit       (reduces what they owe)
//   paid_to_member   → hostel refunded the member          (reduces what the hostel owes)
const ITEM_TYPES = {
  advance:             'credit',
  discount:            'credit',
  rent_due:            'debit',
  electric_due:        'debit',
  other_due:           'debit',
  payment_from_member: 'paid_by_member',
  refund:              'paid_to_member',
};

const itemSchema = new mongoose.Schema({
  type:        { type: String, enum: Object.keys(ITEM_TYPES), required: true },
  label:       { type: String, required: true, trim: true },
  amount:      { type: Number, required: true, min: 0 },
  date:        { type: Date },
  method:      { type: String, enum: ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online_other', ''], default: '' },
  referenceNo: { type: String, default: '' },
  notes:       { type: String, default: '' },
  source:      { type: String, enum: ['auto', 'manual'], default: 'manual' },
  refKey:      { type: String, default: '' },       // stable key for suggested lines, so "build from records" never duplicates them
}, { timestamps: false });

const changeSchema = new mongoose.Schema({
  field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed,
}, { _id: false });

// Audit trail kept inside the settlement itself (also mirrored to the global Audit Log).
const historySchema = new mongoose.Schema({
  at:      { type: Date, default: Date.now },
  byName:  { type: String, default: '' },
  byRole:  { type: String, default: '' },
  action:  { type: String, default: '' },           // created | edited | finalized | reopened | vacated
  summary: { type: String, default: '' },
  reason:  { type: String, default: '' },
  changes: { type: [changeSchema], default: [] },
}, { _id: false });

const settlementSchema = new mongoose.Schema({
  hostelId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  // _id of the Member while active; stays the same after vacating (ArchivedMember.originalId),
  // so the record is still found once the member has left.
  memberKey: { type: String, required: true },

  // Frozen copy of who this is — survives the member being archived or even deleted.
  member: {
    name: String, memberId: String, mobileNo: String, fathersName: String,
    roomNumber: Number, roomJoinDate: Date, roomLeavingDate: Date,
    rent: Number, advance: Number,
    vacatedOn: Date, vacatedReason: String,
  },

  status:        { type: String, enum: ['open', 'settled'], default: 'open' },
  items:         { type: [itemSchema], default: [] },
  notes:         { type: String, default: '' },

  statementNo:     { type: String },
  statementYear:   { type: String },
  statementSerial: { type: Number },
  settledAt:       { type: Date },
  settledBy:       { type: String },

  // Read-only copy of the member's rent/electric/payment history taken when the
  // settlement is finalized, so the statement can always be reproduced as issued.
  snapshot: { type: mongoose.Schema.Types.Mixed },

  history: { type: [historySchema], default: [] },
}, { timestamps: true });

settlementSchema.index({ hostelId: 1, memberKey: 1 }, { unique: true });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Totals for a list of items. net > 0  → hostel still owes the member (refund pending)
//                              net < 0  → member still owes the hostel
settlementSchema.statics.summarize = function (items) {
  const t = { credits: 0, debits: 0, paidByMember: 0, paidToMember: 0 };
  (items || []).forEach(i => {
    const a = Number(i.amount) || 0;
    const d = ITEM_TYPES[i.type];
    if (d === 'credit') t.credits += a;
    else if (d === 'debit') t.debits += a;
    else if (d === 'paid_by_member') t.paidByMember += a;
    else if (d === 'paid_to_member') t.paidToMember += a;
  });
  const net = round2(t.credits - t.debits + t.paidByMember - t.paidToMember);
  return {
    credits: round2(t.credits), debits: round2(t.debits),
    paidByMember: round2(t.paidByMember), paidToMember: round2(t.paidToMember),
    net,
    state: net === 0 ? 'settled' : net > 0 ? 'refund_pending' : 'recoverable',
  };
};

settlementSchema.statics.ITEM_TYPES = ITEM_TYPES;

module.exports = mongoose.models.Settlement || mongoose.model('Settlement', settlementSchema);
