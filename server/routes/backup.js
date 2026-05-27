const express = require('express');
const router = express.Router();
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const Member = require('../models/Member');
const ArchivedMember = require('../models/ArchivedMember');
const Receipt = require('../models/Receipt');
const Electric = require('../models/Electric');
const Salary = require('../models/Salary');
const Hostel = require('../models/Hostel');
const logger = require('../utils/logger');

router.use(authMiddleware, ownerOnly);

// Full JSON export (DB backup)
router.get('/export-json', async (req, res, next) => {
  try {
    const hostelId = req.hostelId; // from JWT
    const q = hostelId ? { hostelId } : {};
    const [members, archived, receipts, electric, salaries, hostels] = await Promise.all([
      Member.find(q).lean(),
      ArchivedMember.find(q).lean(),
      Receipt.find(q).lean(),
      Electric.find(q).lean(),
      Salary.find(q).lean(),
      Hostel.find({ isActive: true }).lean(),
    ]);
    const backup = {
      exportedAt: new Date().toISOString(),
      version: '8.0',
      hostelId: hostelId || 'all',
      counts: { members: members.length, archived: archived.length, receipts: receipts.length, electric: electric.length, salaries: salaries.length },
      data: { hostels, members, archivedMembers: archived, receipts, electric, salaries },
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="hostel-backup-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(backup);
    logger.info('Backup exported', { by: req.user.username, hostelId });
  } catch(err) { next(err); }
});

// Excel CSV export (per collection)
router.get('/export-csv/:collection', async (req, res, next) => {
  try {
    const hostelId = req.hostelId; // from JWT
    const q = hostelId ? { hostelId } : {};
    const col = req.params.collection;

    let data = [], headers = [];

    if (col === 'members') {
      data = await Member.find(q).lean();
      headers = ['memberId','name','mobileNo','fathersName','fathersMobileNo','aadharNumber','roomNumber','rent','advance','admissionDate','roomJoinDate','roomLeavingDate','permanentAddress','studentOccupation','policeFormVerified'];
    } else if (col === 'receipts') {
      data = await Receipt.find(q).lean();
      headers = ['billNumber','receiptDate','roomNumber','memberName','memberMobile','packageName','totalAmount','modeOfPayment','fromDate','toDate','notes'];
    } else if (col === 'electric') {
      data = await Electric.find(q).lean();
      headers = ['roomNumber','month','year','startReading','endReading','unitsConsumed','ratePerUnit','totalAmount'];
    } else if (col === 'salary') {
      data = await Salary.find(q).lean();
      headers = ['employeeName','role','month','year','basicSalary','allowances','deductions','netSalary','totalExpense','modeOfPayment','paidDate','notes'];
    } else {
      return res.status(400).json({ message: 'Unknown collection' });
    }

    const fmt = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toLocaleDateString('en-IN');
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v).replace(/,/g, ';').replace(/\n/g, ' ');
    };

    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => fmt(row[h])).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${col}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch(err) { next(err); }
});

module.exports = router;
