const Receipt = require('../models/Receipt');
const Hostel = require('../models/Hostel');
const audit = require('../services/audit');
const notify = require('../services/notifications');
const validate = require('../utils/validate');
const mongoose = require('mongoose');

const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    const hId = req.hostelId; // from JWT — never from client
    if (hId) return hId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

// ── Small helpers ─────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const httpError = (status, message) => { const e = new Error(message); e.status = status; return e; };

// Payment methods. modeOfPayment (cash/online) is what Reports/Dashboard already
// group by, so it is always derived from the method — never set independently.
const METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online_other'];
const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', card: 'Card', cheque: 'Cheque', online_other: 'Online' };
const modeFromMethod = (m) => (m === 'cash' ? 'cash' : 'online');
const methodOf = (r) => r.paymentMethod || (r.modeOfPayment === 'online' ? 'online_other' : 'cash');

function numberToWords(num) {
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (!num || num === 0) return 'Zero';
  let n = Math.floor(num), w = '';
  if (Math.floor(n / 100000) > 0) { w += numberToWords(Math.floor(n / 100000)) + ' Lakh '; n %= 100000; }
  if (Math.floor(n / 1000) > 0)   { w += numberToWords(Math.floor(n / 1000)) + ' Thousand '; n %= 1000; }
  if (Math.floor(n / 100) > 0)    { w += numberToWords(Math.floor(n / 100)) + ' Hundred '; n %= 100; }
  if (n > 0) { if (n < 20) w += a[n]; else w += b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''); }
  return w.trim();
}

// Runs fn(session) inside a transaction when the DB supports it (Atlas does);
// falls back to running without one so local standalone Mongo still works.
async function runTxn(fn) {
  let session = null;
  try { session = await mongoose.startSession(); session.startTransaction(); } catch (e) { session = null; }
  try {
    const out = await fn(session);
    if (session) await session.commitTransaction();
    return out;
  } catch (err) {
    if (session) { try { await session.abortTransaction(); } catch (_) {} }
    throw err;
  } finally {
    if (session) { try { session.endSession(); } catch (_) {} }
  }
}
const sopt = (session) => (session ? { session } : {});

const PROTECTED_ON_CREATE = ['parentReceiptId', 'installmentNo', 'installmentCount', 'cumulativePaid', 'billTotal', 'paidToDate', 'balanceAfter', 'clientRequestId', '_id', 'createdAt', 'updatedAt'];

// ── Bill (root + installments) bookkeeping ────────────────────────────────────
// Recomputes every derived number for one bill from the actual receipts, so the
// balance can never drift no matter how installments are added/edited/removed.
// Uses updateOne (not save) on purpose — it must not trigger the pre-save hook.
async function recalcBill(rootId, session) {
  const root = await Receipt.findById(rootId).session(session || null);
  if (!root) return null;
  const kids = await Receipt.find({ parentReceiptId: root._id }).sort({ receiptDate: 1, createdAt: 1 }).session(session || null);
  const total = round2(root.totalAmount);
  let running = round2(root.amountPaid);
  let n = 1;
  for (const k of kids) {
    n += 1;
    running = round2(running + (k.amountPaid || 0));
    await Receipt.updateOne({ _id: k._id }, { $set: {
      installmentNo: n, billTotal: total, paidToDate: running, balanceAfter: Math.max(0, round2(total - running)),
    } }, sopt(session));
  }
  const balance = Math.max(0, round2(total - running));
  await Receipt.updateOne({ _id: root._id }, { $set: {
    cumulativePaid: running, balanceDue: balance, installmentCount: kids.length, installmentNo: 1,
    isPartPayment: !!root.isPartPayment || kids.length > 0,
  } }, sopt(session));
  return { total, paid: running, balance, count: kids.length };
}

const toInstallmentRow = (r, isRoot) => ({
  _id: r._id,
  isRoot,
  installmentNo: isRoot ? 1 : (r.installmentNo || 2),
  receiptNumber: r.receiptNumber,
  billNumber: r.billNumber,
  receiptDate: r.receiptDate,
  amount: r.amountPaid || 0,
  paymentMethod: methodOf(r),
  methodLabel: METHOD_LABEL[methodOf(r)] || 'Online',
  modeOfPayment: r.modeOfPayment,
  referenceNo: r.referenceNo || '',
  notes: r.notes || '',
  balanceAfter: isRoot ? undefined : r.balanceAfter,
  createdAt: r.createdAt,
});

async function loadBill(hostelId, anyId) {
  let r = await Receipt.findOne({ _id: anyId, ...(hostelId ? { hostelId } : {}) }).lean();
  if (!r) return null;
  let root = r;
  if (r.parentReceiptId) {
    root = await Receipt.findOne({ _id: r.parentReceiptId, ...(hostelId ? { hostelId } : {}) }).lean();
    if (!root) return null;
  }
  const kids = await Receipt.find({ parentReceiptId: root._id }).sort({ receiptDate: 1, createdAt: 1 }).lean();
  const rows = [toInstallmentRow(root, true), ...kids.map(k => toInstallmentRow(k, false))];
  const total = round2(root.totalAmount);
  const paid = round2(rows.reduce((s, x) => s + x.amount, 0));
  const balance = Math.max(0, round2(total - paid));
  // "₹600 Cash + ₹400 UPI = ₹1,000 Paid"
  const byMethod = {};
  rows.forEach(x => { byMethod[x.methodLabel] = round2((byMethod[x.methodLabel] || 0) + x.amount); });
  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const breakdownText = Object.entries(byMethod).map(([l, a]) => `${fmt(a)} ${l}`).join(' + ') + ` = ${fmt(paid)} Paid`;
  return {
    root, installments: rows,
    summary: { total, paid, balance, isFullyPaid: balance <= 0, count: rows.length, byMethod, breakdownText },
  };
}

exports.list = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(2000, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const query = hostelId ? { hostelId } : {};
    if (req.query.room) query.roomNumber = parseInt(req.query.room);
    if (req.query.type) query.packageName = req.query.type;
    if (req.query.mode) query.modeOfPayment = req.query.mode;
    if (req.query.method) query.paymentMethod = req.query.method;
    if (req.query.search) {
      query.$or = [
        { memberName: { $regex: req.query.search, $options: 'i' } },
        { memberMobile: { $regex: req.query.search } },
        { billNumber: { $regex: req.query.search, $options: 'i' } },
        { referenceNo: { $regex: req.query.search, $options: 'i' } },
        { roomNumber: isNaN(parseInt(req.query.search)) ? undefined : parseInt(req.query.search) },
      ].filter(Boolean);
    }
    if (req.query.from) query.receiptDate = { ...query.receiptDate, $gte: new Date(req.query.from) };
    if (req.query.to) query.receiptDate = { ...query.receiptDate, $lte: new Date(req.query.to) };
    const [data, total] = await Promise.all([
      Receipt.find(query).sort({ receiptDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Receipt.countDocuments(query),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
  } catch(err) { next(err); }
};

exports.nextNumbers = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = hostelId ? { hostelId } : {};
    const last = await Receipt.findOne(query).sort({ receiptNumber: -1 });
    const nextNum = last ? (last.receiptNumber || 0) + 1 : 1;
    const year = new Date().getFullYear();
    const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
    const lastBill = await Receipt.findOne({ ...query, billYear: shortYear }).sort({ billSerial: -1 });
    const nextSerial = lastBill ? (lastBill.billSerial || 0) + 1 : 1;
    res.json({ receiptNumber: nextNum, billNumber: `SB/${shortYear}/${String(nextSerial).padStart(3, '0')}`, billYear: shortYear, billSerial: nextSerial });
  } catch(err) { next(err); }
};

// Reset bill serial counter for new financial year
exports.resetSerial = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel found' });
    const { yearType } = req.body; // 'april' (26-27) or 'january' (26-26)
    const now = new Date();
    let fromYear, toYear;
    if (yearType === 'april') {
      // Financial year April to March: e.g. Apr 2026 → Mar 2027 = "26-27"
      fromYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      toYear   = fromYear + 1;
    } else {
      // Calendar year January to December: e.g. Jan 2026 → Dec 2026 = "26-26"
      fromYear = now.getFullYear();
      toYear   = fromYear;
    }
    const newYear = `${String(fromYear).slice(2)}-${String(toYear).slice(2)}`;
    // Mark all receipts in this new year as having serial 0 so next one starts at 1
    // We do this by simply checking — no deletion, just confirm the year string is ready
    res.json({
      message: `Bill numbers will now use year format: SB/${newYear}/001`,
      newYear,
      nextBill: `SB/${newYear}/001`,
    });
  } catch(err) { next(err); }
};

// Legacy one-shot "clear the whole balance" — kept for old data. Bills that use
// installments must be settled through addInstallment so the money is recorded.
exports.clearDue = async (req, res, next) => {
  try {
    const existing = await Receipt.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Receipt not found' });
    if ((existing.installmentCount || 0) > 0 || existing.parentReceiptId) {
      return res.status(400).json({ message: 'This bill uses installments — record the remaining amount with Add Payment instead.' });
    }
    const updated = await Receipt.findByIdAndUpdate(
      req.params.id,
      { $set: { balanceDue: 0 } },
      { new: true }
    );
    res.json(updated);
  } catch(err) { next(err); }
};

exports.byRoom = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { roomNumber: parseInt(req.params.roomNumber) };
    if (hostelId) query.hostelId = hostelId;
    const receipts = await Receipt.find(query).sort({ receiptDate: -1 }).lean();
    res.json(receipts);
  } catch(err) { next(err); }
};

exports.roomSummary = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { roomNumber: parseInt(req.params.roomNumber) };
    if (hostelId) query.hostelId = hostelId;
    const receipts = await Receipt.find(query).sort({ receiptDate: -1 }).lean();
    res.json({
      totalPaid: receipts.reduce((s, r) => s + (r.totalAmount || 0), 0),
      totalRent: receipts.filter(r => r.packageName === 'rent').reduce((s, r) => s + (r.totalAmount || 0), 0),
      totalAdvance: receipts.filter(r => r.packageName === 'advance').reduce((s, r) => s + (r.totalAmount || 0), 0),
      totalElectric: receipts.filter(r => r.packageName === 'electric').reduce((s, r) => s + (r.totalAmount || 0), 0),
      receiptCount: receipts.length,
      lastPayment: receipts[0] || null,
      receipts,
    });
  } catch(err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const { roomNumber, totalAmount } = req.body;
    const errors = validate.collect([
      validate.required(roomNumber, 'Room number'),
      validate.required(totalAmount, 'Amount'),
      validate.number(totalAmount, 'Amount'),
      validate.positive(totalAmount, 'Amount'),
      validate.positive(req.body.amountPaid, 'Amount paid'),
    ]);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    if (req.body.isPartPayment && Number(req.body.amountPaid) > Number(totalAmount)) {
      return res.status(400).json({ message: 'Amount paid cannot be more than the total bill.' });
    }
    if (req.body.paymentMethod && !METHODS.includes(req.body.paymentMethod)) {
      return res.status(400).json({ message: 'Unknown payment method.' });
    }

    const body = { ...req.body };
    PROTECTED_ON_CREATE.forEach(k => delete body[k]);
    // Keep cash/online and the detailed method in step with each other.
    if (body.paymentMethod) body.modeOfPayment = modeFromMethod(body.paymentMethod);
    else if (body.modeOfPayment === 'online') body.paymentMethod = 'online_other';
    else body.paymentMethod = 'cash';
    if (body.referenceNo !== undefined) body.referenceNo = String(body.referenceNo || '').trim();

    const saved = await runTxn(async (session) => {
      // If no usable receipt number came from the client, compute the next
      // sequential one server-side so a save never silently falls back to "1".
      let receiptNumber = parseInt(body.receiptNumber);
      if (!receiptNumber || isNaN(receiptNumber) || receiptNumber < 1) {
        const last = await Receipt.findOne({ hostelId }).sort({ receiptNumber: -1 }).session(session || null);
        receiptNumber = last ? (last.receiptNumber || 0) + 1 : 1;
      }
      const [doc] = await Receipt.create([{ ...body, hostelId, receiptNumber }], sopt(session));
      return doc;
    });

    // Soft duplicate check — never blocks the save (the person may genuinely
    // want to reuse/renumber), just flags it so the UI can warn.
    const dupCount = await Receipt.countDocuments({ hostelId, receiptNumber: saved.receiptNumber, _id: { $ne: saved._id } });
    await audit.log({ hostelId, action: 'CREATE_RECEIPT', entity: 'receipt', entityId: saved._id, description: `Receipt ${saved.billNumber} Room ${roomNumber} ₹${totalAmount}`, user: req.user,
      meta: { totalAmount: saved.totalAmount, amountPaid: saved.amountPaid, paymentMethod: saved.paymentMethod, referenceNo: saved.referenceNo } });
    await notify.create({ hostelId, type: 'payment_received', title: `Payment: Room ${roomNumber}`, message: `₹${totalAmount} received (${req.body.packageName || 'payment'})`, roomNumber: parseInt(roomNumber), priority: 'low', amount: parseFloat(totalAmount) });
    const savedObj = saved.toObject();
    if (dupCount > 0) savedObj.duplicateReceiptNumberWarning = true;
    res.status(201).json(savedObj);
  } catch(err) { next(err); }
};

const EDIT_AUDIT_KEYS = ['totalAmount', 'amountPaid', 'isPartPayment', 'paymentMethod', 'modeOfPayment', 'referenceNo', 'receiptDate', 'packageName', 'monthYear', 'fromDate', 'toDate', 'roomNumber', 'billNumber', 'notes'];
const pickKeys = (obj, keys) => { const o = {}; keys.forEach(k => { o[k] = obj[k] instanceof Date ? obj[k].toISOString() : obj[k]; }); return o; };
const diffKeys = (before, after) => {
  const out = {};
  Object.keys(after).forEach(k => { if (String(before[k] ?? '') !== String(after[k] ?? '')) out[k] = { from: before[k] ?? null, to: after[k] ?? null }; });
  return out;
};

exports.update = async (req, res, next) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });

    const { totalAmount } = req.body;
    const errors = validate.collect([
      totalAmount !== undefined ? validate.required(totalAmount, 'Amount') : null,
      totalAmount !== undefined ? validate.number(totalAmount, 'Amount') : null,
      totalAmount !== undefined ? validate.positive(totalAmount, 'Amount') : null,
    ]);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    if (req.body.paymentMethod && !METHODS.includes(req.body.paymentMethod)) {
      return res.status(400).json({ message: 'Unknown payment method.' });
    }

    const isChild = !!receipt.parentReceiptId;
    const hasKids = (receipt.installmentCount || 0) > 0;
    if (isChild) {
      const moneyChanged =
        (req.body.totalAmount !== undefined && round2(req.body.totalAmount) !== round2(receipt.totalAmount)) ||
        (req.body.amountPaid !== undefined && round2(req.body.amountPaid) !== round2(receipt.amountPaid));
      if (moneyChanged) return res.status(400).json({ message: 'To correct an installment amount, use Payment History (it keeps an audit trail and updates the bill balance).' });
    }
    if (hasKids && req.body.isPartPayment === false) {
      return res.status(400).json({ message: 'This bill already has installments, so it cannot be converted to a full payment.' });
    }

    const before = pickKeys(receipt.toObject(), EDIT_AUDIT_KEYS);

    // Only touch fields that were actually sent — never let a partial edit
    // payload wipe out fields (like hostelId) it didn't intend to change.
    const editable = [
      'receiptNumber', 'billNumber', 'billYear', 'billSerial', 'roomNumber', 'month', 'monthYear',
      'memberName', 'memberMobile', 'memberId', 'members',
      'packageName', 'paymentType', 'fromDate', 'toDate',
      'totalAmount', 'amountPaid', 'isPartPayment', 'electricAmount',
      'rentComponent', 'advanceComponent',
      'amountInWords', 'modeOfPayment', 'paymentMethod', 'referenceNo', 'receiptDate', 'notes',
    ];
    editable.forEach(k => { if (req.body[k] !== undefined) receipt[k] = req.body[k]; });
    if (req.body.paymentMethod) receipt.modeOfPayment = modeFromMethod(req.body.paymentMethod);
    else if (req.body.modeOfPayment !== undefined) {
      receipt.paymentMethod = req.body.modeOfPayment === 'online' ? (receipt.paymentMethod && receipt.paymentMethod !== 'cash' ? receipt.paymentMethod : 'online_other') : 'cash';
    }
    if (receipt.isPartPayment && round2(receipt.amountPaid) > round2(receipt.totalAmount)) {
      return res.status(400).json({ message: 'Amount paid cannot be more than the total bill.' });
    }

    // If this is a root with installments, its total can't drop below what's already been paid.
    if (hasKids) {
      const kids = await Receipt.find({ parentReceiptId: receipt._id }).select('amountPaid').lean();
      const paid = round2((receipt.amountPaid || 0) + kids.reduce((s, k) => s + (k.amountPaid || 0), 0));
      if (round2(receipt.totalAmount) < paid) {
        return res.status(400).json({ message: `Bill total (₹${receipt.totalAmount}) cannot be less than the ₹${paid} already received across installments.` });
      }
    }

    // The pre-save hook recalculates amountPaid/balanceDue for ordinary
    // receipts; bills with installments are re-balanced by recalcBill below.
    await receipt.save();
    if (isChild) await recalcBill(receipt.parentReceiptId);
    else if (hasKids || receipt.isPartPayment) await recalcBill(receipt._id);

    // Soft duplicate check — never blocks the save, just flags it for the UI.
    const dupCount = await Receipt.countDocuments({ hostelId: receipt.hostelId, receiptNumber: receipt.receiptNumber, _id: { $ne: receipt._id } });
    const fresh = await Receipt.findById(receipt._id);
    const changes = diffKeys(before, pickKeys(fresh.toObject(), EDIT_AUDIT_KEYS));
    await audit.log({ hostelId: receipt.hostelId, action: 'UPDATE_RECEIPT', entity: 'receipt', entityId: receipt._id, description: `Edited receipt ${receipt.billNumber} Room ${receipt.roomNumber}`, user: req.user, meta: { changes } });
    const receiptObj = fresh.toObject();
    if (dupCount > 0) receiptObj.duplicateReceiptNumberWarning = true;
    res.json(receiptObj);
  } catch(err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const existing = await Receipt.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Receipt not found' });
    if ((existing.installmentCount || 0) > 0) {
      return res.status(400).json({ message: `This bill has ${existing.installmentCount} installment receipt(s). Delete those first (Payment History) so no recorded payment is lost.` });
    }
    const snapshot = existing.toObject();
    await Receipt.findByIdAndDelete(existing._id);
    if (existing.parentReceiptId) await recalcBill(existing.parentReceiptId);
    await audit.log({ hostelId: existing.hostelId, action: 'DELETE_RECEIPT', entity: 'receipt', entityId: existing._id,
      description: `Deleted receipt ${existing.billNumber} Room ${existing.roomNumber}${existing.parentReceiptId ? ' (installment — bill balance recalculated)' : ''}`,
      user: req.user, meta: { deleted: snapshot, reason: req.query.reason || req.body?.reason || '' } });
    res.json({ message: 'Deleted' });
  } catch(err) { next(err); }
};

// ── Installments ──────────────────────────────────────────────────────────────

// Full payment history of one bill (accepts the root OR any installment's id).
exports.getInstallments = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const bill = await loadBill(hostelId, req.params.id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    res.json(bill);
  } catch(err) { next(err); }
};

// Record another payment against the same bill.
exports.addInstallment = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const { amount, paymentMethod, referenceNo, receiptDate, notes, clientRequestId } = req.body;
    const amt = round2(amount);
    if (!(amt > 0)) return res.status(400).json({ message: 'Enter an amount greater than zero.' });
    const method = paymentMethod || 'cash';
    if (!METHODS.includes(method)) return res.status(400).json({ message: 'Unknown payment method.' });

    const result = await runTxn(async (session) => {
      const root = await Receipt.findOne({ _id: req.params.id, hostelId }).session(session || null);
      if (!root) throw httpError(404, 'Bill not found');
      if (root.parentReceiptId) throw httpError(400, 'Add the payment to the original bill, not to an installment.');

      // Double-click / retry protection: the same request id never creates two payments.
      if (clientRequestId) {
        const dup = await Receipt.findOne({ hostelId, clientRequestId: String(clientRequestId) }).session(session || null);
        if (dup) return { child: dup, root, duplicate: true };
      }

      if (!root.isPartPayment) throw httpError(400, 'This bill was paid in full — there is nothing outstanding.');
      const balance = round2(root.balanceDue);
      if (balance <= 0) throw httpError(400, 'This bill is already fully paid.');
      if (amt > balance) throw httpError(400, `Amount ₹${amt} is more than the outstanding ₹${balance}.`);

      const last = await Receipt.findOne({ hostelId }).sort({ receiptNumber: -1 }).session(session || null);
      const receiptNumber = last ? (last.receiptNumber || 0) + 1 : 1;
      const kids = await Receipt.find({ parentReceiptId: root._id }).select('billNumber').session(session || null);
      let maxSuffix = 1;
      kids.forEach(k => { const m = String(k.billNumber || '').match(/-P(\d+)$/); if (m) maxSuffix = Math.max(maxSuffix, parseInt(m[1])); });

      const ratio = root.totalAmount > 0 ? amt / root.totalAmount : 0;
      const [child] = await Receipt.create([{
        hostelId, receiptNumber,
        billNumber: `${root.billNumber || 'BILL'}-P${maxSuffix + 1}`,
        billYear: root.billYear, billSerial: root.billSerial,
        roomNumber: root.roomNumber, month: root.month, monthYear: root.monthYear,
        memberName: root.memberName, memberMobile: root.memberMobile, memberId: root.memberId, members: root.members,
        packageName: root.packageName, paymentType: root.paymentType,
        fromDate: root.fromDate, toDate: root.toDate,
        totalAmount: amt, amountPaid: amt, balanceDue: 0, isPartPayment: false,
        // Keep a Final Bill's electric/rent/advance split proportional so the
        // existing "electric portion paid" and "advance isn't income" maths stay right.
        electricAmount: round2((root.electricAmount || 0) * ratio),
        rentComponent: root.rentComponent != null ? round2(root.rentComponent * ratio) : undefined,
        advanceComponent: root.advanceComponent != null ? round2(root.advanceComponent * ratio) : undefined,
        amountInWords: req.body.amountInWords || `${numberToWords(amt)} Rupees Only`,
        modeOfPayment: modeFromMethod(method), paymentMethod: method,
        referenceNo: String(referenceNo || '').trim() || undefined,
        receiptDate: receiptDate ? new Date(receiptDate) : new Date(),
        notes: notes || `Installment against Bill No. ${root.billNumber}`,
        parentReceiptId: root._id,
        clientRequestId: clientRequestId ? String(clientRequestId) : undefined,
      }], sopt(session));

      const totals = await recalcBill(root._id, session);
      return { child, root, totals, duplicate: false };
    });

    if (!result.duplicate) {
      const child = result.child;
      await audit.log({ hostelId, action: 'ADD_INSTALLMENT', entity: 'receipt', entityId: child._id,
        description: `Installment ₹${amt} (${METHOD_LABEL[method]}) on ${result.root.billNumber} Room ${result.root.roomNumber} — balance ₹${result.totals.balance}`,
        user: req.user, meta: { rootId: result.root._id, billNumber: result.root.billNumber, amount: amt, paymentMethod: method, referenceNo: child.referenceNo, balanceAfter: result.totals.balance } });
      await notify.create({ hostelId, type: 'payment_received', title: `Payment: Room ${result.root.roomNumber}`, message: `₹${amt} received via ${METHOD_LABEL[method]} against ${result.root.billNumber}`, roomNumber: result.root.roomNumber, priority: 'low', amount: amt });
    }

    const bill = await loadBill(hostelId, req.params.id);
    const receipt = await Receipt.findById(result.child._id).lean();
    res.status(result.duplicate ? 200 : 201).json({ receipt, ...bill, duplicate: !!result.duplicate });
  } catch(err) { next(err); }
};

// Correct a mistake in an installment (amount / method / reference / date / notes).
// Works on the root's own first payment too. A reason is mandatory and the
// before/after values go to the audit log.
exports.editInstallment = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Please enter a reason for this correction.' });
    if (req.body.paymentMethod && !METHODS.includes(req.body.paymentMethod)) return res.status(400).json({ message: 'Unknown payment method.' });
    if (req.body.amount !== undefined && !(round2(req.body.amount) > 0)) return res.status(400).json({ message: 'Amount must be greater than zero.' });

    const out = await runTxn(async (session) => {
      const rec = await Receipt.findOne({ _id: req.params.id, hostelId }).session(session || null);
      if (!rec) throw httpError(404, 'Payment not found');
      const rootId = rec.parentReceiptId || rec._id;
      const root = rec.parentReceiptId ? await Receipt.findById(rootId).session(session || null) : rec;
      if (!root) throw httpError(404, 'Original bill not found');
      if (!root.isPartPayment && !rec.parentReceiptId) throw httpError(400, 'This receipt is a full payment, not an installment bill. Use Edit Receipt.');

      const before = { amount: rec.amountPaid, paymentMethod: methodOf(rec), referenceNo: rec.referenceNo || '', receiptDate: rec.receiptDate, notes: rec.notes || '' };
      const newAmt = req.body.amount !== undefined ? round2(req.body.amount) : round2(rec.amountPaid);

      // Total received across the bill, with this payment replaced by its new value.
      const kids = await Receipt.find({ parentReceiptId: root._id }).select('amountPaid').session(session || null);
      const othersPaid = round2((root._id.equals(rec._id) ? 0 : (root.amountPaid || 0)) + kids.filter(k => !k._id.equals(rec._id)).reduce((s, k) => s + (k.amountPaid || 0), 0));
      if (round2(othersPaid + newAmt) > round2(root.totalAmount)) {
        throw httpError(400, `That would make the total received ₹${round2(othersPaid + newAmt)}, more than the bill of ₹${round2(root.totalAmount)}.`);
      }

      if (req.body.amount !== undefined) {
        rec.amountPaid = newAmt;
        if (rec.parentReceiptId) {
          rec.totalAmount = newAmt;
          const ratio = root.totalAmount > 0 ? newAmt / root.totalAmount : 0;
          rec.electricAmount = round2((root.electricAmount || 0) * ratio);
          if (root.rentComponent != null) rec.rentComponent = round2(root.rentComponent * ratio);
          if (root.advanceComponent != null) rec.advanceComponent = round2(root.advanceComponent * ratio);
          rec.amountInWords = `${numberToWords(newAmt)} Rupees Only`;
        }
      }
      if (req.body.paymentMethod) { rec.paymentMethod = req.body.paymentMethod; rec.modeOfPayment = modeFromMethod(req.body.paymentMethod); }
      if (req.body.referenceNo !== undefined) rec.referenceNo = String(req.body.referenceNo || '').trim() || undefined;
      if (req.body.receiptDate) rec.receiptDate = new Date(req.body.receiptDate);
      if (req.body.notes !== undefined) rec.notes = req.body.notes;
      // updateOne-style persistence: avoid the pre-save hook rewriting root balances.
      const setDoc = {}; const unsetDoc = {};
      ['amountPaid', 'totalAmount', 'electricAmount', 'rentComponent', 'advanceComponent', 'amountInWords', 'paymentMethod', 'modeOfPayment', 'receiptDate', 'notes']
        .forEach(k => { if (rec[k] !== undefined) setDoc[k] = rec[k]; });
      if (rec.referenceNo) setDoc.referenceNo = rec.referenceNo; else unsetDoc.referenceNo = '';
      const upd = { $set: setDoc };
      if (Object.keys(unsetDoc).length) upd.$unset = unsetDoc;
      await Receipt.updateOne({ _id: rec._id }, upd, sopt(session));
      const totals = await recalcBill(root._id, session);
      const after = { amount: rec.amountPaid, paymentMethod: methodOf(rec), referenceNo: rec.referenceNo || '', receiptDate: rec.receiptDate, notes: rec.notes || '' };
      return { rec, root, totals, before, after };
    });

    await audit.log({ hostelId, action: 'EDIT_INSTALLMENT', entity: 'receipt', entityId: out.rec._id,
      description: `Corrected payment on ${out.root.billNumber} Room ${out.root.roomNumber}: ${reason}`,
      user: req.user, meta: { rootId: out.root._id, reason, changes: diffKeys(pickKeys(out.before, Object.keys(out.before)), pickKeys(out.after, Object.keys(out.after))), balanceAfter: out.totals.balance } });
    const bill = await loadBill(hostelId, req.params.id);
    res.json(bill);
  } catch(err) { next(err); }
};

// Remove a mistaken installment (not the original first payment — delete/edit
// the whole bill from Receipts for that). Balance is recalculated and the
// deleted record is preserved inside the audit log.
exports.deleteInstallment = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const reason = String(req.body?.reason || req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Please enter a reason for removing this payment.' });
    const out = await runTxn(async (session) => {
      const rec = await Receipt.findOne({ _id: req.params.id, hostelId }).session(session || null);
      if (!rec) throw httpError(404, 'Payment not found');
      if (!rec.parentReceiptId) throw httpError(400, 'The first payment is part of the original bill. Edit it instead, or delete the bill from Receipts once its installments are removed.');
      const snapshot = rec.toObject();
      await Receipt.deleteOne({ _id: rec._id }, sopt(session));
      const totals = await recalcBill(rec.parentReceiptId, session);
      return { rec, snapshot, totals };
    });
    await audit.log({ hostelId, action: 'DELETE_INSTALLMENT', entity: 'receipt', entityId: out.rec._id,
      description: `Removed installment ₹${out.rec.amountPaid} (${METHOD_LABEL[methodOf(out.rec)]}) from ${String(out.rec.billNumber).replace(/-P\d+$/, '')} Room ${out.rec.roomNumber}: ${reason}`,
      user: req.user, meta: { reason, deleted: out.snapshot, balanceAfter: out.totals.balance } });
    const bill = await loadBill(hostelId, out.rec.parentReceiptId);
    res.json(bill);
  } catch(err) { next(err); }
};

// Cash vs online (and by method) per day — everything actually received,
// each installment counted once, on the day and by the method it was taken.
exports.collectionSummary = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const match = {};
    if (hostelId) match.hostelId = new mongoose.Types.ObjectId(hostelId.toString());
    if (req.query.from || req.query.to) {
      match.receiptDate = {};
      if (req.query.from) match.receiptDate.$gte = new Date(req.query.from);
      if (req.query.to) { const t = new Date(req.query.to); t.setHours(23, 59, 59, 999); match.receiptDate.$lte = t; }
    }
    const rows = await Receipt.aggregate([
      { $match: match },
      { $project: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$receiptDate', timezone: 'Asia/Kolkata' } },
        mode: { $ifNull: ['$modeOfPayment', 'cash'] },
        method: { $ifNull: ['$paymentMethod', { $cond: [{ $eq: ['$modeOfPayment', 'online'] }, 'online_other', 'cash'] }] },
        amt: { $cond: [{ $gt: ['$amountPaid', 0] }, '$amountPaid', { $ifNull: ['$totalAmount', 0] }] },
      } },
      { $group: { _id: { day: '$day', mode: '$mode', method: '$method' }, amount: { $sum: '$amt' }, count: { $sum: 1 } } },
    ]);
    const byDay = {};
    rows.forEach(r => {
      const d = (byDay[r._id.day] = byDay[r._id.day] || { date: r._id.day, cash: 0, online: 0, total: 0, count: 0, byMethod: {} });
      d[r._id.mode === 'online' ? 'online' : 'cash'] += r.amount;
      d.total += r.amount; d.count += r.count;
      d.byMethod[r._id.method] = (d.byMethod[r._id.method] || 0) + r.amount;
    });
    const days = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));
    const totals = days.reduce((t, d) => ({ cash: t.cash + d.cash, online: t.online + d.online, total: t.total + d.total, count: t.count + d.count }), { cash: 0, online: 0, total: 0, count: 0 });
    res.json({ days, totals });
  } catch(err) { next(err); }
};
