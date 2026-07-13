const Receipt = require('../models/Receipt');
const Hostel = require('../models/Hostel');
const Member = require('../models/Member');
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
    const limit = Math.min(500, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const { search, room, fromDate, toDate } = req.query;
    
    const base = hostelId ? { hostelId } : {};
    if (room) base.roomNumber = parseInt(room);
    if (fromDate && toDate) {
      base.receiptDate = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }
    
    const query = search ? {
      ...base,
      $or: [
        { billNumber: { $regex: search, $options: 'i' } },
        { memberName: { $regex: search, $options: 'i' } },
        { memberMobile: { $regex: search } },
        { roomNumber: isNaN(parseInt(search)) ? undefined : parseInt(search) },
      ].filter(Boolean),
    } : base;
    
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
    const year = new Date().getFullYear();
    const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
    
    const last = await Receipt.findOne({ hostelId, billYear: shortYear }).sort({ billSerial: -1 });
    const nextSerial = (last?.billSerial || 0) + 1;
    const billNumber = `HBL/${shortYear}/${String(nextSerial).padStart(4, '0')}`;
    
    res.json({ nextSerial, billNumber, billYear: shortYear });
  } catch(err) { next(err); }
};

exports.resetSerial = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const { billYear } = req.body;
    
    if (!billYear) return res.status(400).json({ message: 'Bill year is required' });
    
    await Receipt.updateMany({ hostelId, billYear }, { billSerial: 0 });
    await audit.log({ hostelId, action: 'RESET_SERIAL', entity: 'receipt', description: `Reset bill serial for ${billYear}`, user: req.user });
    
    res.json({ message: 'Serial reset successfully', billYear });
  } catch(err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    
    const { roomNumber, month, monthYear, memberName, memberMobile, packageName, totalAmount, amountPaid, modeOfPayment, notes } = req.body;
    
    const errors = validate.collect([
      validate.required(roomNumber, 'Room number'),
      validate.required(totalAmount, 'Total amount'),
      validate.required(packageName, 'Package type'),
    ]);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    
    // Get next bill number
    const year = new Date().getFullYear();
    const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
    const last = await Receipt.findOne({ hostelId, billYear: shortYear }).sort({ billSerial: -1 });
    const nextSerial = (last?.billSerial || 0) + 1;
    const billNumber = `HBL/${shortYear}/${String(nextSerial).padStart(4, '0')}`;
    
    // Get room members
    const members = await Member.find({ hostelId, roomNumber: parseInt(roomNumber), isActive: true }).select('name memberId mobileNo').lean();
    
    const receipt = new Receipt({
      hostelId,
      roomNumber: parseInt(roomNumber),
      month,
      monthYear,
      memberName,
      memberMobile,
      members,
      packageName,
      paymentType: packageName,
      totalAmount: Number(totalAmount),
      amountPaid: Number(amountPaid) || 0,
      balanceDue: Number(totalAmount) - (Number(amountPaid) || 0),
      isPartPayment: Number(amountPaid) > 0 && Number(amountPaid) < Number(totalAmount),
      modeOfPayment,
      notes,
      isPaid: Number(amountPaid) >= Number(totalAmount),
      billNumber,
      billYear: shortYear,
      billSerial: nextSerial,
      receiptDate: new Date(),
    });
    
    const saved = await receipt.save();
    
    await audit.log({ hostelId, action: 'CREATE_RECEIPT', entity: 'receipt', entityId: saved._id, description: `Created receipt ${billNumber} for Room ${roomNumber}`, user: req.user });
    await notify.create({ hostelId, type: 'receipt', title: `Receipt created for Room ${roomNumber}`, message: `₹${totalAmount}`, memberId: null, roomNumber: parseInt(roomNumber), priority: 'low' });
    
    res.status(201).json(saved);
  } catch(err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const existing = await Receipt.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Receipt not found' });
    
    const { amountPaid, modeOfPayment, notes } = req.body;
    
    const totalAmount = existing.totalAmount;
    const newAmountPaid = amountPaid !== undefined ? Number(amountPaid) : existing.amountPaid;
    const newBalanceDue = totalAmount - newAmountPaid;
    
    Object.assign(existing, {
      amountPaid: newAmountPaid,
      balanceDue: Math.max(0, newBalanceDue),
      isPartPayment: newAmountPaid > 0 && newAmountPaid < totalAmount,
      isPaid: newAmountPaid >= totalAmount,
      modeOfPayment: modeOfPayment || existing.modeOfPayment,
      notes: notes !== undefined ? notes : existing.notes,
    });
    
    const updated = await existing.save();
    
    await audit.log({ hostelId: existing.hostelId, action: 'UPDATE_RECEIPT', entity: 'receipt', entityId: updated._id, description: `Updated receipt ${existing.billNumber}`, user: req.user });
    
    res.json(updated);
  } catch(err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const receipt = await Receipt.findByIdAndDelete(req.params.id);
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
    
    await audit.log({ hostelId: receipt.hostelId, action: 'DELETE_RECEIPT', entity: 'receipt', entityId: receipt._id, description: `Deleted receipt ${receipt.billNumber}`, user: req.user });
    
    res.json({ message: 'Receipt deleted', id: receipt._id });
  } catch(err) { next(err); }
};

exports.byRoom = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const roomNumber = parseInt(req.params.roomNumber);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      Receipt.find({ hostelId, roomNumber }).sort({ receiptDate: -1 }).skip(skip).limit(limit).lean(),
      Receipt.countDocuments({ hostelId, roomNumber }),
    ]);
    
    res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
  } catch(err) { next(err); }
};

exports.roomSummary = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const roomNumber = parseInt(req.params.roomNumber);
    
    const receipts = await Receipt.find({ hostelId, roomNumber }).sort({ receiptDate: -1 }).lean();
    
    const totalCollected = receipts.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
    const totalDue = receipts.reduce((sum, r) => sum + (r.balanceDue || 0), 0);
    const lastReceipt = receipts[0] || null;
    
    res.json({ roomNumber, totalCollected, totalDue, lastReceipt, totalReceipts: receipts.length });
  } catch(err) { next(err); }
};

exports.clearDue = async (req, res, next) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
    
    receipt.balanceDue = 0;
    receipt.amountPaid = receipt.totalAmount;
    receipt.isPaid = true;
    receipt.isPartPayment = false;
    
    const updated = await receipt.save();
    
    await audit.log({ hostelId: receipt.hostelId, action: 'CLEAR_DUE', entity: 'receipt', entityId: updated._id, description: `Cleared due for receipt ${receipt.billNumber}`, user: req.user });
    
    res.json(updated);
  } catch(err) { next(err); }
};