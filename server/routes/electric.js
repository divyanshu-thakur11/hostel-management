const express = require('express');
const router = express.Router();
const Electric = require('../models/Electric');
const Hostel = require('../models/Hostel');
const audit = require('../services/audit');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    const hId = req.hostelId; // from JWT — never from client
    if (hId) return hId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = hostelId ? { hostelId } : {};
    const data = await Electric.find(query).sort({ year: -1, month: -1 });
    res.json(data);
  } catch(err) { next(err); }
});

router.get('/room/:roomNumber', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { roomNumber: parseInt(req.params.roomNumber) };
    if (hostelId) query.hostelId = hostelId;
    const data = await Electric.find(query).sort({ year: -1, month: -1 });
    res.json(data);
  } catch(err) { next(err); }
});

router.get('/room/:roomNumber/last', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { roomNumber: parseInt(req.params.roomNumber) };
    if (hostelId) query.hostelId = hostelId;
    const data = await Electric.findOne(query).sort({ year: -1, month: -1 });
    res.json(data);
  } catch(err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });

    const { roomNumber, month, year } = req.body;

    // ── FIX 4: Duplicate guard — one reading per room per month per year ──
    const existing = await Electric.findOne({ hostelId, roomNumber: parseInt(roomNumber), month: parseInt(month), year: parseInt(year) });
    if (existing) {
      return res.status(409).json({
        message: `A reading for Room ${roomNumber} in ${month}/${year} already exists. Delete the existing entry first if you need to correct it.`,
        existing,
      });
    }

    const entry = new Electric({ ...req.body, hostelId });
    const saved = await entry.save();

    // F3: Anomaly detection — non-blocking, fail silently
    try {
      const last6 = await Electric.find({ hostelId, roomNumber: saved.roomNumber, _id: { $ne: saved._id } })
        .sort({ year: -1, month: -1 }).limit(6).lean();
      if (last6.length >= 2) {
        const units = last6.map(r => r.unitsConsumed || 0);
        const mean  = units.reduce((s, u) => s + u, 0) / units.length;
        const std   = Math.sqrt(units.reduce((s, u) => s + (u - mean) ** 2, 0) / units.length);
        if ((saved.unitsConsumed || 0) > mean + 2 * std) {
          await Electric.findByIdAndUpdate(saved._id, { isAnomaly: true });
          saved.isAnomaly = true;
        }
      }
    } catch(_) {} // fail silently

    res.status(201).json(saved);
  } catch(err) { next(err); }
});

// F4: Bill prediction — linear regression on last 6 readings
router.get('/room/:roomNumber/predict', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { roomNumber: parseInt(req.params.roomNumber) };
    if (hostelId) query.hostelId = hostelId;
    const readings = await Electric.find(query).sort({ year: -1, month: -1 }).limit(6).lean();
    if (readings.length < 1) return res.json({ predictedUnits: null, predictedAmount: null, confidence: 'low' });

    const data = readings.reverse(); // oldest first
    const n = data.length;
    const xs = data.map((_, i) => i);
    const ys = data.map(r => r.unitsConsumed || 0);
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0) /
                  (xs.reduce((s, x) => s + (x - xMean) ** 2, 0) || 1);
    const intercept = yMean - slope * xMean;
    const predictedUnits = Math.max(0, Math.round(intercept + slope * n));
    const lastRate = data[data.length - 1]?.ratePerUnit || 8;
    const predictedAmount = predictedUnits * lastRate;
    const confidence = n < 3 ? 'low' : n < 6 ? 'medium' : 'high';
    res.json({ predictedUnits, predictedAmount, confidence });
  } catch(err) { next(err); }
});

// ── Edit a reading ────────────────────────────────────────────────────────────
// Start and end meter readings can be corrected independently. The units
// consumed and the bill amount are ALWAYS recalculated from the saved
// readings (the model's pre-save hook does it), never trusted from the client.
//
// Deliberately touches ONLY this Electric document. Receipts and rent dues are
// not modified — the Dues page works the electric balance out from this bill's
// total minus what receipts have already been paid against it, so a corrected
// bill is reflected there automatically while every receipt stays as issued.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const editReading = (allowed) => async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const doc = await Electric.findOne({ _id: req.params.id, ...(hostelId ? { hostelId } : {}) });
    if (!doc) return res.status(404).json({ message: 'Entry not found' });

    const reason = String(req.body.reason || '').trim();
    const oldUnits = doc.unitsConsumed, oldAmount = doc.totalAmount;
    const edits = [];

    for (const f of allowed) {
      if (req.body[f] === undefined || req.body[f] === '') continue;
      if (f === 'dueDate') {
        const nd = new Date(req.body.dueDate);
        if (isNaN(nd.getTime())) return res.status(400).json({ message: 'Invalid due date' });
        const od = doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : '';
        if (od !== nd.toISOString().slice(0, 10)) { edits.push({ field: f, oldValue: od || null, newValue: nd.toISOString().slice(0, 10) }); doc.dueDate = nd; }
        continue;
      }
      const v = Number(req.body[f]);
      if (!isFinite(v) || v < 0) return res.status(400).json({ message: `${f === 'startReading' ? 'Start reading' : f === 'endReading' ? 'End reading' : 'Rate per unit'} must be a number ≥ 0` });
      if (round2(v) !== round2(doc[f])) { edits.push({ field: f, oldValue: doc[f], newValue: v }); doc[f] = v; }
    }

    if (!edits.length) return res.status(400).json({ message: 'Nothing was changed.' });
    if (edits.some(e => e.field !== 'dueDate') && !reason) return res.status(400).json({ message: 'Please enter a reason for correcting this reading.' });
    if (doc.endReading < doc.startReading) {
      return res.status(400).json({ message: `End reading (${doc.endReading}) cannot be lower than start reading (${doc.startReading}).` });
    }

    // Record what changed (before/after incl. the effect on units and bill)
    // — the new units/amount are filled in right after the save recalculates them.
    const who = (req.user && (req.user.name || req.user.username)) || 'user';
    const startIdx = doc.editHistory.length;
    edits.forEach(e => doc.editHistory.push({ ...e, oldUnits, oldAmount, reason, editedBy: `${who}${req.user?.role ? ` (${req.user.role})` : ''}`, editedAt: new Date() }));
    await doc.save();                       // pre-save hook: unitsConsumed + totalAmount recalculated
    for (let i = startIdx; i < doc.editHistory.length; i++) {
      doc.editHistory[i].newUnits = doc.unitsConsumed;
      doc.editHistory[i].newAmount = doc.totalAmount;
    }

    // Re-check the "unusually high" flag against this room's other readings.
    try {
      const last6 = await Electric.find({ hostelId: doc.hostelId, roomNumber: doc.roomNumber, _id: { $ne: doc._id } })
        .sort({ year: -1, month: -1 }).limit(6).lean();
      if (last6.length >= 2) {
        const units = last6.map(r => r.unitsConsumed || 0);
        const mean = units.reduce((a, u) => a + u, 0) / units.length;
        const std = Math.sqrt(units.reduce((a, u) => a + (u - mean) ** 2, 0) / units.length);
        doc.isAnomaly = (doc.unitsConsumed || 0) > mean + 2 * std;
      }
    } catch (_) {}
    doc.markModified('editHistory');
    await doc.save();

    await audit.log({
      hostelId: doc.hostelId, action: 'EDIT_ELECTRIC', entity: 'electric', entityId: doc._id,
      description: `Room ${doc.roomNumber} ${doc.month}/${doc.year} electric corrected: ${edits.map(e => `${e.field} ${e.oldValue} → ${e.newValue}`).join(', ')} (bill ₹${oldAmount} → ₹${doc.totalAmount})${reason ? ` — ${reason}` : ''}`,
      user: req.user,
      meta: { edits, reason, before: { units: oldUnits, amount: oldAmount }, after: { units: doc.unitsConsumed, amount: doc.totalAmount } },
    });

    // Heads-up only (nothing is changed): do neighbouring months still line up with this one?
    const key = doc.year * 12 + doc.month;
    const siblings = await Electric.find({ hostelId: doc.hostelId, roomNumber: doc.roomNumber, _id: { $ne: doc._id } }).lean();
    const prev = siblings.filter(r => r.year * 12 + r.month < key).sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0];
    const next = siblings.filter(r => r.year * 12 + r.month > key).sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month))[0];
    const continuity = {
      prev: prev ? { month: prev.month, year: prev.year, endReading: prev.endReading } : null,
      next: next ? { month: next.month, year: next.year, startReading: next.startReading } : null,
      startMismatch: !!prev && prev.endReading !== doc.startReading,
      endMismatch: !!next && next.startReading !== doc.endReading,
    };
    res.json({ reading: doc, continuity });
  } catch(err) { next(err); }
};

router.patch('/:id/start-reading', editReading(['startReading']));
router.patch('/:id/end-reading',   editReading(['endReading']));
router.put('/:id',                 editReading(['startReading', 'endReading', 'ratePerUnit', 'dueDate']));

// PATCH payment-status: mark as paid / unpaid / waived (manual), or reset to automatic
router.patch('/:id/payment-status', async (req, res, next) => {
  try {
    const { paymentStatus, waivedReason, manualOverride } = req.body;
    if (!['unpaid', 'paid', 'waived'].includes(paymentStatus)) {
      return res.status(400).json({ message: 'paymentStatus must be unpaid, paid, or waived' });
    }
    const update = {
      paymentStatus,
      // Manual by default (Mark Paid / Mark Unpaid / Waive are deliberate
      // actions) — pass manualOverride:false explicitly to reset the bill
      // back to being worked out automatically from receipts.
      manualOverride: manualOverride !== undefined ? !!manualOverride : true,
    };
    if (paymentStatus === 'waived') {
      if (!waivedReason || !waivedReason.trim()) {
        return res.status(400).json({ message: 'Reason is required when waiving a bill' });
      }
      update.waivedReason = waivedReason.trim();
      update.waivedBy     = req.user && req.user.username ? req.user.username : 'owner';
      update.waivedAt     = new Date();
    } else {
      update.waivedReason = '';
      update.waivedBy     = '';
      update.waivedAt     = null;
    }
    const updated = await Electric.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Entry not found' });
    res.json(updated);
  } catch(err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Electric.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch(err) { next(err); }
});

module.exports = router;
