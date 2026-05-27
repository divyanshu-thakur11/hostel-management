const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const Receipt = require('../models/Receipt');
const Electric = require('../models/Electric');
const Salary = require('../models/Salary');
const Hostel = require('../models/Hostel');
const Notification = require('../models/Notification');
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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const baseQ = hostelId ? { hostelId } : {};

    const hostel = hostelId ? await Hostel.findById(hostelId) : null;
    const totalRooms = hostel?.totalRooms || 20;

    const [
      totalMembers, activeMembers, allReceipts,
      thisMonthReceipts, allSalaries,
      overdueMembers, expiringMembers, occupiedRoomNums, unreadCount,
    ] = await Promise.all([
      Member.countDocuments(baseQ),
      Member.countDocuments({ ...baseQ, isActive: true, roomNumber: { $ne: null } }),
      Receipt.find(baseQ).lean(),
      Receipt.find({ ...baseQ, receiptDate: { $gte: startOfMonth } }).lean(),
      Salary.find(baseQ).lean(),
      Member.find({ ...baseQ, isActive: true, roomLeavingDate: { $lt: now, $ne: null } }).select('name roomNumber roomLeavingDate rent').lean(),
      Member.find({ ...baseQ, isActive: true, roomLeavingDate: { $gte: now, $lte: in7days } }).select('name roomNumber roomLeavingDate').lean(),
      Member.distinct('roomNumber', { ...baseQ, isActive: true, roomNumber: { $ne: null } }),
      hostelId ? Notification.countDocuments({ hostelId, isRead: false }) : 0,
    ]);

    const totalRevenue = allReceipts.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const monthRevenue = thisMonthReceipts.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const totalExpenses = allSalaries.reduce((s, r) => s + (r.totalExpense || r.netSalary || 0), 0);
    const cashRevenue = allReceipts.filter(r => r.modeOfPayment === 'cash').reduce((s, r) => s + (r.totalAmount || 0), 0);
    const onlineRevenue = allReceipts.filter(r => r.modeOfPayment === 'online').reduce((s, r) => s + (r.totalAmount || 0), 0);

    // 6-month revenue trend
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const amount = allReceipts.filter(r => new Date(r.receiptDate) >= start && new Date(r.receiptDate) < end).reduce((s, r) => s + (r.totalAmount || 0), 0);
      trend.push({ month: start.toLocaleString('en-IN', { month: 'short' }) + ' ' + start.getFullYear(), amount });
    }

    // Room status map
    const occupiedSet = new Set(occupiedRoomNums.map(n => parseInt(n)));
    const roomStatus = Array.from({ length: totalRooms }, (_, i) => ({
      roomNumber: i + 1,
      status: occupiedSet.has(i + 1) ? 'occupied' : 'vacant',
    }));

    // Estimated dues (members with rent set but no receipt this month)
    const activeRoomMembers = await Member.find({ ...baseQ, isActive: true, roomNumber: { $ne: null }, rent: { $gt: 0 } }).select('name roomNumber rent mobileNo').lean();
    const thisMonthRoomsPaid = new Set(thisMonthReceipts.filter(r => r.packageName === 'rent').map(r => r.roomNumber));
    const membersDueThi = activeRoomMembers.filter(m => !thisMonthRoomsPaid.has(m.roomNumber));
    const estimatedDue = membersDueThi.reduce((s, m) => s + (m.rent || 0), 0);

    // Part payments with outstanding balances
    const partPaymentReceipts = allReceipts
      .filter(r => r.isPartPayment && (r.balanceDue || 0) > 0)
      .sort((a, b) => (b.balanceDue || 0) - (a.balanceDue || 0))
      .slice(0, 20);
    const totalBalanceDue = allReceipts.reduce((s, r) => s + (r.balanceDue || 0), 0);
    const partPaymentRoomNums = new Set(partPaymentReceipts.map(r => r.roomNumber));

    // Fix income to use amountPaid not totalAmount
    const totalRevenueActual = allReceipts.reduce((s, r) => s + (r.amountPaid || r.totalAmount || 0), 0);
    const monthRevenueActual = thisMonthReceipts.reduce((s, r) => s + (r.amountPaid || r.totalAmount || 0), 0);
    const cashRevenueActual  = allReceipts.filter(r => r.modeOfPayment === 'cash').reduce((s, r) => s + (r.amountPaid || r.totalAmount || 0), 0);
    const onlineRevenueActual= allReceipts.filter(r => r.modeOfPayment === 'online').reduce((s, r) => s + (r.amountPaid || r.totalAmount || 0), 0);

    res.json({
      totalMembers,
      activeMembers,
      occupiedRooms: occupiedSet.size,
      vacantRooms: totalRooms - occupiedSet.size,
      totalRooms,
      overdueCount: overdueMembers.length,
      overdueMembers,
      expiringCount: expiringMembers.length,
      expiringMembers,
      dueMembersCount: membersDueThi.length,
      estimatedDue,
      totalRevenue: totalRevenueActual,
      monthRevenue: monthRevenueActual,
      totalExpenses,
      netIncome: totalRevenueActual - totalExpenses,
      cashRevenue: cashRevenueActual,
      onlineRevenue: onlineRevenueActual,
      unreadNotifications: unreadCount,
      trend,
      roomStatus,
      recentReceipts: allReceipts.sort((a, b) => new Date(b.receiptDate) - new Date(a.receiptDate)).slice(0, 8),
      partPaymentCount: partPaymentRoomNums.size,
      partPaymentReceipts,
      totalBalanceDue,
    });
  } catch(err) { next(err); }
});

module.exports = router;