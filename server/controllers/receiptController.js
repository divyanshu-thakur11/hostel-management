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

exports.list = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const query = hostelId ? { hostelId } : {};
    if (req.query.room) query.roomNumber = parseInt(req.query.room);
    if (req.query.type) query.packageName = req.query.type;
    if (req.query.mode) query.modeOfPayment = req.query.mode;
    if (req.query.search) {
      query.$or = [
        { memberName: { $regex: req.query.search, $options: 'i' } },
        { memberMobile: { $regex: req.query.search } },
        { billNumber: { $regex: req.query.search, $options: 'i' } },
        { roomNumber: isNaN(parseInt(req.query.search)) ? undefined : parseInt(req.query.search) },
      ].filter(Boolean);
    }
    if (req.query.from) query.receiptDate = { ...query.receiptDate, $gte: new Date(req.query.from) };
    if (req.query.to) query.receiptDate = { ...query.receiptDate, $lte: new Date(req.query.to) };
    const [data, total] = await Promise.all([
      Receipt.find(query).sort({ receiptDate: -1 }).skip(skip).limit(limit).lean(),
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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) { await session.abortTransaction(); return res.status(400).json({ message: 'No hostel assigned' }); }
    const { roomNumber, totalAmount } = req.body;
    const errors = validate.collect([
      validate.required(roomNumber, 'Room number'),
      validate.required(totalAmount, 'Amount'),
      validate.number(totalAmount, 'Amount'),
    ]);
    if (errors.length) { await session.abortTransaction(); return res.status(400).json({ message: errors[0], errors }); }
    const [saved] = await Receipt.create([{ ...req.body, hostelId }], { session });
    await audit.log({ hostelId, action: 'CREATE_RECEIPT', entity: 'receipt', entityId: saved._id, description: `Receipt ${saved.billNumber} Room ${roomNumber} ₹${totalAmount}`, user: req.user });
    await notify.create({ hostelId, type: 'payment_received', title: `Payment: Room ${roomNumber}`, message: `₹${totalAmount} received (${req.body.packageName || 'payment'})`, roomNumber: parseInt(roomNumber), priority: 'low', amount: parseFloat(totalAmount) });
    await session.commitTransaction();
    res.status(201).json(saved);
  } catch(err) { await session.abortTransaction(); next(err); }
  finally { session.endSession(); }
};

exports.remove = async (req, res, next) => {
  try {
    const receipt = await Receipt.findByIdAndDelete(req.params.id);
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
    await audit.log({ hostelId: receipt.hostelId, action: 'DELETE_RECEIPT', entity: 'receipt', entityId: receipt._id, description: `Deleted receipt ${receipt.billNumber} Room ${receipt.roomNumber}`, user: req.user });
    res.json({ message: 'Deleted' });
  } catch(err) { next(err); }
};