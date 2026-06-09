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

// ── Restore from JSON backup ─────────────────────────────────────────────────
// POST /api/backup/restore
// Body: the JSON backup file contents (parsed)
// Strategy: for each collection, delete all existing docs for this hostelId,
//   then re-insert the backed-up docs (stripping _id so Mongo re-generates clean ones,
//   but preserving hostelId). A dry-run param lets the UI show counts before committing.
router.post('/restore', async (req, res, next) => {
  try {
    const hostelId = req.hostelId;
    if (!hostelId) return res.status(400).json({ message: 'Cannot restore: no hostelId in token' });

    const { data, dryRun } = req.body;
    if (!data) return res.status(400).json({ message: 'No data field in request body' });

    const { members = [], archivedMembers = [], receipts = [], electric = [], salaries = [] } = data;

    // Counts for dry-run preview
    const incoming = {
      members:         members.length,
      archivedMembers: archivedMembers.length,
      receipts:        receipts.length,
      electric:        electric.length,
      salaries:        salaries.length,
    };

    if (dryRun) {
      // Just report what would be restored — no writes
      const existing = await Promise.all([
        Member.countDocuments({ hostelId }),
        ArchivedMember.countDocuments({ hostelId }),
        Receipt.countDocuments({ hostelId }),
        Electric.countDocuments({ hostelId }),
        Salary.countDocuments({ hostelId }),
      ]);
      return res.json({
        dryRun: true,
        incoming,
        existing: { members: existing[0], archivedMembers: existing[1], receipts: existing[2], electric: existing[3], salaries: existing[4] },
      });
    }

    // Strip _id from each doc and force hostelId to current user's hostelId
    const clean = (docs) => docs.map(({ _id, __v, ...rest }) => ({ ...rest, hostelId }));

    // Delete existing data for this hostel then re-insert
    await Promise.all([
      Member.deleteMany({ hostelId }),
      ArchivedMember.deleteMany({ hostelId }),
      Receipt.deleteMany({ hostelId }),
      Electric.deleteMany({ hostelId }),
      Salary.deleteMany({ hostelId }),
    ]);

    const results = await Promise.all([
      members.length         ? Member.insertMany(clean(members),         { ordered: false }) : [],
      archivedMembers.length ? ArchivedMember.insertMany(clean(archivedMembers), { ordered: false }) : [],
      receipts.length        ? Receipt.insertMany(clean(receipts),       { ordered: false }) : [],
      electric.length        ? Electric.insertMany(clean(electric),      { ordered: false }) : [],
      salaries.length        ? Salary.insertMany(clean(salaries),        { ordered: false }) : [],
    ]);

    const restored = {
      members:         Array.isArray(results[0]) ? results[0].length : (results[0].insertedCount || 0),
      archivedMembers: Array.isArray(results[1]) ? results[1].length : (results[1].insertedCount || 0),
      receipts:        Array.isArray(results[2]) ? results[2].length : (results[2].insertedCount || 0),
      electric:        Array.isArray(results[3]) ? results[3].length : (results[3].insertedCount || 0),
      salaries:        Array.isArray(results[4]) ? results[4].length : (results[4].insertedCount || 0),
    };

    logger.info('Backup restored', { by: req.user.username, hostelId, restored });
    res.json({ success: true, restored });
  } catch(err) { next(err); }
});

module.exports = router;
