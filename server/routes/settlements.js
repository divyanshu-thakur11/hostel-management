const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const Settlement     = require('../models/Settlement');
const Member         = require('../models/Member');
const ArchivedMember = require('../models/ArchivedMember');
const Receipt        = require('../models/Receipt');
const Electric       = require('../models/Electric');
const Hostel         = require('../models/Hostel');
const audit          = require('../services/audit');
const { snapshotOf } = require('../services/settlements');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const byWho = (req) => ({ byName: req.user?.name || req.user?.username || '', byRole: req.user?.role || '' });
const METHODS = ['', 'cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online_other'];

// The member as they are now — active, or archived after vacating (same key either way).
async function resolveMember(hostelId, key) {
  if (!mongoose.isValidObjectId(key)) return null;
  const scope = hostelId ? { hostelId } : {};
  const m = await Member.findOne({ _id: key, ...scope }).lean();
  if (m) return { key, isActive: true, ...snapshotOf(m), admissionDate: m.admissionDate };
  const a = await ArchivedMember.findOne({ $or: [{ originalId: key }, { _id: key }], ...scope }).lean();
  if (a) return { key, isActive: false, ...snapshotOf(a, { vacatedOn: a.vacatedOn, vacatedReason: a.vacatedReason }), admissionDate: a.admissionDate };
  return null;
}

const withSummary = (doc) => {
  const o = doc.toObject ? doc.toObject() : doc;
  return { ...o, summary: Settlement.summarize(o.items) };
};

// List — one row per member that has a settlement record (for status badges in the picker).
router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const docs = await Settlement.find(hostelId ? { hostelId } : {}).select('-snapshot -history').sort({ updatedAt: -1 }).lean();
    res.json(docs.map(d => ({ ...d, summary: Settlement.summarize(d.items) })));
  } catch (err) { next(err); }
});

// Everything needed for one member's Final Settlement tab: who they are, the
// saved settlement (if any) and their complete money history.
router.get('/member/:key', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const key = req.params.key;
    const settlement = await Settlement.findOne({ hostelId, memberKey: key });
    let member = await resolveMember(hostelId, key);
    if (!member && settlement) {
      // Member record is gone (e.g. permanently deleted from the archive) — the frozen copy still answers.
      const m = settlement.member?.toObject ? settlement.member.toObject() : settlement.member;
      member = { key, isActive: false, ...m };
    }
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const from = member.roomJoinDate || member.admissionDate || null;
    const vacated = member.vacatedOn ? new Date(member.vacatedOn) : null;
    const end = vacated ? new Date(vacated.getTime() + 45 * 86400000) : new Date();

    // Receipts made out to this member (alone, or as one of an "All Members" receipt)…
    const linked = await Receipt.find({ hostelId, $or: [{ memberId: key }, { 'members.memberId': key }] })
      .sort({ receiptDate: 1, createdAt: 1 }).lean();
    // …plus, optionally, other receipts for the same room during their stay (shared rooms).
    let roomOnly = [];
    if (member.roomNumber) {
      const q = { hostelId, roomNumber: member.roomNumber, _id: { $nin: linked.map(r => r._id) }, receiptDate: { $lte: end } };
      if (from) q.receiptDate.$gte = from;
      roomOnly = await Receipt.find(q).sort({ receiptDate: 1, createdAt: 1 }).lean();
    }
    const includeRoom = req.query.includeRoom === '1';
    const receipts = [
      ...linked.map(r => ({ ...r, _linked: true })),
      ...(includeRoom ? roomOnly.map(r => ({ ...r, _linked: false })) : []),
    ].sort((a, b) => new Date(a.receiptDate) - new Date(b.receiptDate));

    let electric = [];
    if (member.roomNumber) {
      electric = await Electric.find({ hostelId, roomNumber: member.roomNumber }).sort({ year: 1, month: 1 }).lean();
      if (from) {
        const fk = new Date(from).getFullYear() * 12 + new Date(from).getMonth() + 1;
        const ek = (vacated || new Date()).getFullYear() * 12 + (vacated || new Date()).getMonth() + 2;
        electric = electric.filter(e => { const k = e.year * 12 + e.month; return k >= fk && k <= ek; });
      }
    }

    res.json({
      member,
      settlement: settlement ? withSummary(settlement) : null,
      history: { receipts, electric, roomOnlyCount: roomOnly.length, includeRoom },
    });
  } catch (err) { next(err); }
});

// Save the editable statement (items + notes). Every change is diffed against what
// was stored and written to the settlement's own history and the global audit log.
router.put('/member/:key', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const key = req.params.key;
    const { items, notes } = req.body;
    const reason = String(req.body.reason || '').trim();
    if (!Array.isArray(items)) return res.status(400).json({ message: 'items must be a list' });

    const member = await resolveMember(hostelId, key);
    let doc = await Settlement.findOne({ hostelId, memberKey: key });
    if (!member && !doc) return res.status(404).json({ message: 'Member not found' });
    if (doc && doc.status === 'settled') return res.status(409).json({ message: 'This settlement is finalized. The owner must reopen it before it can be edited.' });

    // Validate + normalise incoming lines
    const clean = [];
    for (const it of items) {
      if (!Settlement.ITEM_TYPES[it.type]) return res.status(400).json({ message: `Unknown line type: ${it.type}` });
      const amount = round2(it.amount);
      if (!(amount >= 0) || isNaN(amount)) return res.status(400).json({ message: `Amount for "${it.label || it.type}" must be a number ≥ 0` });
      if (!String(it.label || '').trim()) return res.status(400).json({ message: 'Every line needs a description.' });
      if (it.method !== undefined && !METHODS.includes(it.method)) return res.status(400).json({ message: 'Unknown payment method on a line.' });
      clean.push({
        _id: it._id && mongoose.isValidObjectId(it._id) ? it._id : undefined,
        type: it.type, label: String(it.label).trim(), amount,
        date: it.date ? new Date(it.date) : undefined,
        method: it.method || '', referenceNo: String(it.referenceNo || '').trim(), notes: String(it.notes || '').trim(),
        source: it.source === 'auto' ? 'auto' : 'manual', refKey: it.refKey || '',
      });
    }

    const prevItems = doc ? doc.items.map(i => i.toObject()) : [];
    const prevById = new Map(prevItems.map(i => [String(i._id), i]));
    const incomingIds = new Set(clean.filter(i => i._id).map(i => String(i._id)));

    const changes = [];
    clean.forEach(i => {
      const p = i._id ? prevById.get(String(i._id)) : null;
      if (!p) { changes.push({ field: `added: ${i.label}`, from: null, to: i.amount }); return; }
      ['type', 'label', 'amount', 'method', 'referenceNo', 'notes'].forEach(f => {
        if (String(p[f] ?? '') !== String(i[f] ?? '')) changes.push({ field: `${p.label} · ${f}`, from: p[f] ?? null, to: i[f] ?? null });
      });
      const pd = p.date ? new Date(p.date).toISOString().slice(0, 10) : '';
      const nd = i.date ? i.date.toISOString().slice(0, 10) : '';
      if (pd !== nd) changes.push({ field: `${p.label} · date`, from: pd || null, to: nd || null });
    });
    prevItems.forEach(p => { if (!incomingIds.has(String(p._id))) changes.push({ field: `removed: ${p.label}`, from: p.amount, to: null }); });
    const newNotes = notes === undefined ? (doc?.notes || '') : String(notes);
    if (doc && newNotes !== (doc.notes || '')) changes.push({ field: 'notes', from: doc.notes || '', to: newNotes });

    if (!changes.length && doc) return res.json(withSummary(doc));
    const touchesExisting = changes.some(c => !String(c.field).startsWith('added: '));
    if (doc && touchesExisting && !reason) return res.status(400).json({ message: 'Please enter a reason for changing or removing existing lines.' });

    const entry = { at: new Date(), ...byWho(req), action: doc ? 'edited' : 'created', reason, changes,
      summary: doc ? `${changes.length} change(s) saved` : 'Settlement started' };

    if (!doc) {
      doc = new Settlement({ hostelId, memberKey: key, member: snapshotOf(member, { vacatedOn: member.vacatedOn, vacatedReason: member.vacatedReason }), status: 'open', items: clean, notes: newNotes, history: [entry] });
    } else {
      doc.items = clean;
      doc.notes = newNotes;
      // Keep the frozen member copy fresh while they are still here.
      if (member && member.isActive) doc.member = snapshotOf(member);
      doc.history.push(entry);
    }
    await doc.save();

    const s = Settlement.summarize(doc.items);
    await audit.log({ hostelId, action: 'SETTLEMENT_EDIT', entity: 'settlement', entityId: doc._id,
      description: `Final settlement — ${doc.member?.name || 'member'} (Room ${doc.member?.roomNumber ?? '—'}): ${changes.length} change(s)${reason ? ` — ${reason}` : ''}. Net ₹${s.net}`,
      user: req.user, meta: { memberKey: key, reason, changes, summary: s } });
    res.json(withSummary(doc));
  } catch (err) { next(err); }
});

// Finalize → statement number + frozen snapshot of the member's history.
router.post('/member/:key/finalize', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const key = req.params.key;
    const doc = await Settlement.findOne({ hostelId, memberKey: key });
    if (!doc) return res.status(404).json({ message: 'Save the settlement first.' });
    if (doc.status === 'settled') return res.status(409).json({ message: 'Already finalized.' });
    if (!doc.items.length) return res.status(400).json({ message: 'Add at least one line before finalizing.' });

    const snapshot = req.body.snapshot;
    if (snapshot !== undefined && JSON.stringify(snapshot || {}).length > 600000) return res.status(400).json({ message: 'Snapshot too large.' });

    if (!doc.statementNo) {
      const year = new Date().getFullYear();
      const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
      const last = await Settlement.findOne({ hostelId, statementYear: shortYear }).sort({ statementSerial: -1 });
      const serial = (last?.statementSerial || 0) + 1;
      doc.statementYear = shortYear; doc.statementSerial = serial;
      doc.statementNo = `FS/${shortYear}/${String(serial).padStart(3, '0')}`;
    }
    doc.status = 'settled';
    doc.settledAt = new Date();
    doc.settledBy = req.user?.name || req.user?.username || '';
    if (snapshot !== undefined) doc.snapshot = snapshot;
    const s = Settlement.summarize(doc.items);
    doc.history.push({ at: new Date(), ...byWho(req), action: 'finalized', reason: String(req.body.reason || '').trim(), changes: [],
      summary: `Finalized as ${doc.statementNo}. Net ₹${s.net} (${s.state.replace('_', ' ')})` });
    await doc.save();
    await audit.log({ hostelId, action: 'SETTLEMENT_FINALIZE', entity: 'settlement', entityId: doc._id,
      description: `Final settlement ${doc.statementNo} issued — ${doc.member?.name} (Room ${doc.member?.roomNumber ?? '—'}). Net ₹${s.net}`, user: req.user, meta: { memberKey: key, summary: s } });
    res.json(withSummary(doc));
  } catch (err) { next(err); }
});

// Owner-only: reopen a finalized statement to correct it (reason required, audited).
router.post('/member/:key/reopen', ownerOnly, async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Please enter a reason for reopening.' });
    const doc = await Settlement.findOne({ hostelId, memberKey: req.params.key });
    if (!doc) return res.status(404).json({ message: 'Settlement not found' });
    if (doc.status !== 'settled') return res.status(409).json({ message: 'It is not finalized.' });
    doc.status = 'open';
    doc.history.push({ at: new Date(), ...byWho(req), action: 'reopened', reason, changes: [], summary: `Reopened (was ${doc.statementNo})` });
    await doc.save();
    await audit.log({ hostelId, action: 'SETTLEMENT_REOPEN', entity: 'settlement', entityId: doc._id,
      description: `Final settlement ${doc.statementNo} reopened — ${doc.member?.name}: ${reason}`, user: req.user, meta: { memberKey: req.params.key, reason } });
    res.json(withSummary(doc));
  } catch (err) { next(err); }
});

module.exports = router;
