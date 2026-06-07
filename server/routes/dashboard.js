const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const Receipt = require('../models/Receipt');
const Room = require('../models/Room');
const Electric = require('../models/Electric');
const Salary = require('../models/Salary');
const Hostel = require('../models/Hostel');
const Notification = require('../models/Notification');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    const hId = req.hostelId;
    if (hId) return hId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const baseQ = hostelId ? { hostelId } : {};

    // ── FIX 2: Revenue via MongoDB aggregation — no 500-receipt cap ───────
    // Use $cond+$gt instead of $ifNull: amountPaid defaults to 0 (not null),
    // so $ifNull never substitutes. $cond correctly falls back to totalAmount
    // when amountPaid is 0 (i.e. not set on older receipts).
    const amtExpr = { $cond: [{ $gt: ['$amountPaid', 0] }, '$amountPaid', '$totalAmount'] };
    const revenueAgg = await Receipt.aggregate([
      { $match: hostelId ? { hostelId } : {} },
      { $group: {
        _id: null,
        totalRevenue:    { $sum: amtExpr },
        cashRevenue:     { $sum: { $cond: [{ $eq: ['$modeOfPayment','cash']  }, amtExpr, 0] } },
        onlineRevenue:   { $sum: { $cond: [{ $eq: ['$modeOfPayment','online'] }, amtExpr, 0] } },
        totalBalanceDue: { $sum: { $ifNull: ['$balanceDue', 0] } },
      }},
    ]);
    const revTotals = revenueAgg[0] || { totalRevenue:0, cashRevenue:0, onlineRevenue:0, totalBalanceDue:0 };

    // 6-month trend via aggregation
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const trendAgg = await Receipt.aggregate([
      { $match: hostelId ? { hostelId, receiptDate: { $gte: trendStart } } : { receiptDate: { $gte: trendStart } } },
      { $group: {
        _id: { year: { $year: '$receiptDate' }, month: { $month: '$receiptDate' } },
        amount: { $sum: { $cond: [{ $gt: ['$amountPaid', 0] }, '$amountPaid', '$totalAmount'] } },
      }},
    ]);
    const trendMap = {};
    trendAgg.forEach(t => { trendMap[`${t._id.year}-${t._id.month}`] = t.amount; });
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()+1}`;
      trend.push({ month: d.toLocaleString('en-IN', { month: 'short' }) + ' ' + d.getFullYear(), amount: trendMap[key] || 0 });
    }

    // Run remaining queries in parallel
    const results = await Promise.allSettled([
      Member.countDocuments(baseQ),                                                            // 0
      Member.countDocuments({ ...baseQ, isActive: true, roomNumber: { $ne: null } }),         // 1
      Receipt.find({ ...baseQ, receiptDate: { $gte: startOfMonth } }).lean(),                 // 2 — this month only, unbounded
      Salary.find(baseQ).lean(),                                                               // 3
      Member.find({ ...baseQ, isActive: true, roomLeavingDate: { $lt: now, $ne: null } }).select('name roomNumber roomLeavingDate rent mobileNo').lean(), // 4
      Member.find({ ...baseQ, isActive: true, roomLeavingDate: { $gte: now, $lte: in7days } }).select('name roomNumber roomLeavingDate').lean(),          // 5
      Member.distinct('roomNumber', { ...baseQ, isActive: true, roomNumber: { $ne: null } }), // 6
      hostelId ? Notification.countDocuments({ hostelId, isRead: false }) : 0,                // 7
      Member.find({ ...baseQ, isActive: true, roomNumber: { $ne: null }, rent: { $gt: 0 } }).select('name roomNumber rent mobileNo').lean(), // 8
      Receipt.find(baseQ).sort({ receiptDate: -1 }).limit(8).lean(),                          // 9 — recent receipts only
      Room.find(baseQ).select('roomNumber').lean(),                                            // 10 — FIX 3: actual room list
      Receipt.find({ ...baseQ, isPartPayment: true, balanceDue: { $gt: 0 } }).sort({ balanceDue: -1 }).limit(20).lean(), // 11
    ]);

    const val = (i, fallback) => results[i].status === 'fulfilled' ? results[i].value : fallback;

    const totalMembers      = val(0, 0);
    const activeMembers     = val(1, 0);
    const thisMonthReceipts = val(2, []);
    const allSalaries       = val(3, []);
    const overdueMembers    = val(4, []);
    const expiringMembers   = val(5, []);
    const occupiedRoomNums  = val(6, []);
    const unreadCount       = val(7, 0);
    const activeRoomMembers = val(8, []);
    const recentReceipts    = val(9, []);
    const allRoomDocs       = val(10, []);
    const partPaymentReceipts = val(11, []);

    const monthRevenueActual = thisMonthReceipts.reduce((s, r) => s + (r.amountPaid || r.totalAmount || 0), 0);
    const totalExpenses      = allSalaries.reduce((s, r) => s + (r.totalExpense || r.netSalary || 0), 0);

    // ── FIX 3: Room status from actual Room collection (not 1…N) ─────────
    const occupiedSet = new Set(occupiedRoomNums.map(n => parseInt(n)));
    const roomStatus  = allRoomDocs
      .map(r => ({ roomNumber: r.roomNumber, status: occupiedSet.has(r.roomNumber) ? 'occupied' : 'vacant' }))
      .sort((a, b) => a.roomNumber - b.roomNumber);
    const totalRooms = roomStatus.length || (await Hostel.findById(hostelId).lean())?.totalRooms || 20;

    // ── FIX 1: Rent due count — include final + advance + other as payment ─
    // Any receipt type except electric counts as clearing rent for that room.
    const thisMonthRoomsPaid = new Set(
      thisMonthReceipts
        .filter(r => !['electric'].includes(r.packageName))
        .map(r => r.roomNumber)
    );
    const membersDueThi = activeRoomMembers.filter(m => !thisMonthRoomsPaid.has(m.roomNumber));
    const estimatedDue  = membersDueThi.reduce((s, m) => s + (m.rent || 0), 0);

    const partPaymentRoomNums = new Set(partPaymentReceipts.map(r => r.roomNumber));

    res.json({
      totalMembers, activeMembers,
      occupiedRooms: occupiedSet.size,
      vacantRooms:   totalRooms - occupiedSet.size,
      totalRooms,
      overdueCount:   overdueMembers.length,  overdueMembers,
      expiringCount:  expiringMembers.length, expiringMembers,
      dueMembersCount: membersDueThi.length,  estimatedDue,
      totalRevenue:   revTotals.totalRevenue,  monthRevenue: monthRevenueActual,
      totalExpenses,  netIncome: revTotals.totalRevenue - totalExpenses,
      cashRevenue:    revTotals.cashRevenue,   onlineRevenue: revTotals.onlineRevenue,
      unreadNotifications: unreadCount,
      trend, roomStatus,
      recentReceipts,
      partPaymentCount: partPaymentRoomNums.size,
      partPaymentReceipts, totalBalanceDue: revTotals.totalBalanceDue,
    });
  } catch(err) { next(err); }
});

module.exports = router;