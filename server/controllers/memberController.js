const Member = require('../models/Member');
const ArchivedMember = require('../models/ArchivedMember');
const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
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
    const { search, room, active } = req.query;
    const base = hostelId ? { hostelId } : {};
    if (room) base.roomNumber = parseInt(room);
    if (active === 'true') { base.isActive = true; base.roomNumber = { $ne: null }; }
    const query = search ? {
      ...base,
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { mobileNo: { $regex: search } },
        { memberId: { $regex: search, $options: 'i' } },
        { aadharNumber: { $regex: search } },
        { fathersName: { $regex: search, $options: 'i' } },
        { roomNumber: isNaN(parseInt(search)) ? undefined : parseInt(search) },
      ].filter(Boolean),
    } : base;
    const [data, total] = await Promise.all([
      Member.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Member.countDocuments(query),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
  } catch(err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });
    res.json(member);
  } catch(err) { next(err); }
};

exports.getByRoom = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const members = await Member.find({ hostelId, roomNumber: parseInt(req.params.roomNumber), isActive: true }).lean();
    res.json(members);
  } catch(err) { next(err); }
};

exports.nextId = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const year = new Date().getFullYear();
    const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
    const last = await Member.findOne({ hostelId, registrationYear: shortYear }).sort({ memberIdNumber: -1 });
    const nextNum = last ? (last.memberIdNumber || 0) + 1 : 1;
    res.json({ nextNumber: nextNum, memberId: `SS/${shortYear}/${String(nextNum).padStart(3, '0')}`, year: shortYear });
  } catch(err) { next(err); }
};

exports.create = async (req, res, next) => {
  let session = null;
  try { session = await mongoose.startSession(); session.startTransaction(); } catch(e) { session = null; }
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) { if (session) { try { await session.abortTransaction(); } catch(e2) {} } return res.status(400).json({ message: 'No hostel assigned. Contact owner.' }); }

    const { name, mobileNo, aadharNumber, fathersName, fathersMobileNo, permanentAddress, fathersOccupation, roomNumber, forceSave } = req.body;
    const errors = validate.collect([
      validate.required(name, 'Name'),
      validate.required(mobileNo, 'Mobile number'),
      validate.required(aadharNumber, 'Aadhar number'),
      validate.required(fathersName, "Father's name"),
      validate.required(fathersMobileNo, "Father's mobile"),
      validate.required(permanentAddress, 'Permanent address'),
      validate.required(fathersOccupation, "Father's occupation"),
      validate.mobile(mobileNo, 'Mobile number'),
      validate.mobile(fathersMobileNo, "Father's mobile"),
      validate.aadhar(aadharNumber),
    ]);
    if (errors.length) { if (session) { try { await session.abortTransaction(); } catch(e2) {} } return res.status(400).json({ message: errors[0], errors }); }

    // F2: Duplicate detection (skip if forceSave=true)
    if (!forceSave) {
      const lev = (a, b) => {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m+1 }, (_, i) => Array.from({ length: n+1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
        for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
      };
      const existing = await Member.find({ hostelId, isActive: { $ne: false } }).select('name mobileNo _id').lean();
      const nameLower = (name || '').toLowerCase();
      const mobileFirst8 = (mobileNo || '').replace(/\D/g,'').slice(0,8);
      const dup = existing.find(m => {
        const dist = lev(nameLower, (m.name||'').toLowerCase());
        const mobileMatch = mobileFirst8 && (m.mobileNo||'').replace(/\D/g,'').slice(0,8) === mobileFirst8;
        return dist <= 3 && mobileMatch;
      });
      if (dup) {
        if (session) { try { await session.abortTransaction(); } catch(e2) {} }
        return res.status(409).json({ duplicate: true, existingMember: dup });
      }
    }

    if (roomNumber) {
      const hostel = await Hostel.findById(hostelId);
      const totalRooms = hostel?.totalRooms || 20;
      if (roomNumber < 1 || roomNumber > totalRooms)
        { if (session) { try { await session.abortTransaction(); } catch(e2) {} } return res.status(400).json({ message: `Room ${roomNumber} does not exist. This hostel has ${totalRooms} rooms.` }); }
      const occupants  = await Member.countDocuments({ hostelId, roomNumber: parseInt(roomNumber), isActive: true });
      const roomDoc    = await Room.findOne({ hostelId, roomNumber: parseInt(roomNumber) }).catch(() => null);
      const maxCap     = roomDoc?.maxCapacity || 999;
      if (maxCap < 999 && occupants >= maxCap)
        { if (session) { try { await session.abortTransaction(); } catch(e2) {} } return res.status(409).json({ message: `Room ${roomNumber} is full (${occupants}/${maxCap} members). Go to Rooms section to increase capacity if needed.` }); }
    }

    const data = { ...req.body, hostelId };
    if (data.memberIdNumber) {
      const year = new Date().getFullYear();
      const shortYear = `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
      data.memberId = `SS/${shortYear}/${String(data.memberIdNumber).padStart(3, '0')}`;
      data.registrationYear = shortYear;
    }
    const saved = await Member.create(data);
    await audit.log({ hostelId, action: 'CREATE_MEMBER', entity: 'member', entityId: saved._id, description: `Added ${saved.name}${saved.roomNumber ? ` to Room ${saved.roomNumber}` : ''}`, user: req.user });
    await notify.create({ hostelId, type: 'new_member', title: `New member: ${saved.name}`, message: `${saved.name} added${saved.roomNumber ? ` to Room ${saved.roomNumber}` : ''}`, memberId: saved._id, memberName: saved.name, roomNumber: saved.roomNumber, priority: 'low' });
    if (session) await session.commitTransaction();
    res.status(201).json(saved);
  } catch(err) { if (session) { try { await session.abortTransaction(); } catch(e2) {} } next(err); }
  finally { if (session) { try { session.endSession(); } catch(e3) {} }; }
};

exports.update = async (req, res, next) => {
  // Try with transaction first; fall back to non-transactional if replica set not available
  let session = null;
  try { session = await mongoose.startSession(); session.startTransaction(); } catch(e) { session = null; }

  try {
    const existing = await Member.findById(req.params.id);
    if (!existing) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ message: 'Member not found' });
    }

    const { mobileNo, aadharNumber, fathersMobileNo, roomNumber } = req.body;
    const errors = validate.collect([
      mobileNo ? validate.mobile(mobileNo, 'Mobile number') : null,
      fathersMobileNo ? validate.mobile(fathersMobileNo, "Father's mobile") : null,
      aadharNumber ? validate.aadhar(aadharNumber) : null,
    ]);
    if (errors.length) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ message: errors[0], errors });
    }

    if (roomNumber && parseInt(roomNumber) !== existing.roomNumber) {
      const hostelId = existing.hostelId;
      const hostel = await Hostel.findById(hostelId);
      const totalRooms = hostel?.totalRooms || 20;
      if (parseInt(roomNumber) < 1 || parseInt(roomNumber) > totalRooms) {
        if (session) await session.abortTransaction();
        return res.status(400).json({ message: `Room ${roomNumber} does not exist.` });
      }
      const occupants = await Member.countDocuments({ hostelId, roomNumber: parseInt(roomNumber), isActive: true, _id: { $ne: existing._id } });
      const roomDocU  = await Room.findOne({ hostelId, roomNumber: parseInt(roomNumber) }).catch(() => null);
      const maxCapU   = roomDocU?.maxCapacity || 999;
      if (maxCapU < 999 && occupants >= maxCapU) {
        if (session) await session.abortTransaction();
        return res.status(409).json({ message: `Room ${roomNumber} is full (${occupants}/${maxCapU} members). Go to Rooms section to increase capacity.` });
      }
    }

    const data = { ...req.body };
    if (data.memberIdNumber) {
      const year = new Date().getFullYear();
      const shortYear = String(year).slice(2) + '-' + String(year + 1).slice(2);
      data.memberId = 'SS/' + shortYear + '/' + String(data.memberIdNumber).padStart(3, '0');
      data.registrationYear = shortYear;
    }

    const updated = await Member.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: false });
    await audit.log({ hostelId: existing.hostelId, action: 'UPDATE_MEMBER', entity: 'member', entityId: updated._id, description: 'Updated ' + updated.name, user: req.user });
    if (session) await session.commitTransaction();
    res.json(updated);
  } catch(err) {
    if (session) { try { await session.abortTransaction(); } catch(e2) {} }
    next(err);
  } finally {
    if (session) { try { session.endSession(); } catch(e3) {} }
  }
};

exports.vacate = async (req, res, next) => {
  let session = null;
  try { session = await mongoose.startSession(); session.startTransaction(); } catch(e) { session = null; }
  try {
    const member = await Member.findById(req.params.id);
    if (!member) { if (session) { try { await session.abortTransaction(); } catch(e2) {} } return res.status(404).json({ message: 'Member not found' }); }
    const obj = member.toObject(); delete obj._id;
    const archived = await ArchivedMember.create({ ...obj, originalId: member._id.toString(), vacatedOn: new Date(), vacatedReason: req.body.reason || 'Left hostel', originalCreatedAt: member.createdAt });
    await Member.findByIdAndDelete(req.params.id);
    await audit.log({ hostelId: member.hostelId, action: 'VACATE_MEMBER', entity: 'member', entityId: member._id, description: `${member.name} vacated Room ${member.roomNumber}. Reason: ${req.body.reason || 'Left hostel'}`, user: req.user });
    await notify.create({ hostelId: member.hostelId, type: 'member_left', title: `Member left: ${member.name}`, message: `${member.name} vacated Room ${member.roomNumber}`, memberId: member._id, memberName: member.name, roomNumber: member.roomNumber, priority: 'low' });
    if (session) await session.commitTransaction();
    res.json({ message: 'Vacated and archived', archived });
  } catch(err) { if (session) { try { await session.abortTransaction(); } catch(e2) {} } next(err); }
  finally { if (session) { try { session.endSession(); } catch(e3) {} }; }
};

exports.remove = async (req, res, next) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    await audit.log({ hostelId: member.hostelId, action: 'DELETE_MEMBER', entity: 'member', entityId: member._id, description: `Deleted ${member.name}`, user: req.user });
    res.json({ message: 'Member deleted' });
  } catch(err) { next(err); }
};

exports.listArchived = async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const query = hostelId ? { hostelId } : {};
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { mobileNo: { $regex: req.query.search } },
        { roomNumber: isNaN(parseInt(req.query.search)) ? undefined : parseInt(query.search) },
      ].filter(Boolean);
    }
    const [data, total] = await Promise.all([
      ArchivedMember.find(query).sort({ vacatedOn: -1 }).skip(skip).limit(limit).lean(),
      ArchivedMember.countDocuments(query),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit) });
  } catch(err) { next(err); }
};

exports.restoreArchived = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const archived = await ArchivedMember.findById(req.params.id).session(session);
    if (!archived) { await session.abortTransaction(); return res.status(404).json({ message: 'Archived member not found' }); }
    const obj = archived.toObject();
    ['_id','originalId','vacatedOn','vacatedReason','originalCreatedAt'].forEach(k => delete obj[k]);
    const [member] = await Member.create([{ ...obj, roomNumber: null, isActive: true }], { session });
    await ArchivedMember.findByIdAndDelete(req.params.id).session(session);
    await audit.log({ hostelId: archived.hostelId, action: 'RESTORE_MEMBER', entity: 'member', entityId: member._id, description: `Restored ${archived.name} from archive`, user: req.user });
    await session.commitTransaction();
    res.json(member);
  } catch(err) { await session.abortTransaction(); next(err); }
  finally { session.endSession(); }
};

exports.deleteArchived = async (req, res, next) => {
  try {
    await ArchivedMember.findByIdAndDelete(req.params.id);
    res.json({ message: 'Permanently deleted' });
  } catch(err) { next(err); }
};