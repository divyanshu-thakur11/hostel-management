const express = require('express');
const router = express.Router();
const Electric = require('../models/Electric');
const Hostel = require('../models/Hostel');
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

router.put('/:id', async (req, res, next) => {
  try {
    const updated = await Electric.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Entry not found' });
    res.json(updated);
  } catch(err) { next(err); }
});

// PATCH payment-status: mark as paid / waived / unpaid
router.patch('/:id/payment-status', async (req, res, next) => {
  try {
    const { paymentStatus, waivedReason } = req.body;
    if (!['unpaid', 'paid', 'waived'].includes(paymentStatus)) {
      return res.status(400).json({ message: 'paymentStatus must be unpaid, paid, or waived' });
    }
    const update = { paymentStatus };
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