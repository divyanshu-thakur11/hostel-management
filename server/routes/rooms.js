const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const Room   = require('../models/Room');
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

// Auto-create default rooms ONLY when the hostel has no rooms at all (first-time setup).
// Never call this after rooms exist — it would recreate deleted rooms.
async function ensureRoomsExist(hostelId) {
  const count = await Room.countDocuments({ hostelId });
  if (count > 0) return; // rooms already set up — do nothing
  const toCreate = [];
  for (let i = 1; i <= 20; i++) {
    toCreate.push({ hostelId, roomNumber: i, rent: 0, advance: 0, maxCapacity: 6 });
  }
  await Room.insertMany(toCreate, { ordered: false }).catch(() => {});
}

// GET all rooms with config + live member data
router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    await ensureRoomsExist(hostelId);
    const [roomConfigs, allMembers] = await Promise.all([
      Room.find({ hostelId }).sort({ roomNumber: 1 }).lean(),
      Member.find({ hostelId, isActive: true }).lean(),
    ]);
    const rooms = roomConfigs.map(rc => {
      const members = allMembers.filter(m => m.roomNumber === rc.roomNumber);
      return {
        roomNumber:   rc.roomNumber,
        rent:         rc.rent,
        advance:      rc.advance,
        maxCapacity:  rc.maxCapacity,
        notes:        rc.notes,
        memberCount:  members.length,
        status:       members.length === 0 ? 'vacant' : members.length >= rc.maxCapacity ? 'full' : 'occupied',
        members:      members.map(m => ({
          _id: m._id, name: m.name, mobileNo: m.mobileNo,
          memberId: m.memberId, roomJoinDate: m.roomJoinDate,
          policeFormVerified: m.policeFormVerified,
        })),
        _id: rc._id,
      };
    });
    res.json(rooms);
  } catch(err) { next(err); }
});

// GET single room
router.get('/:roomNumber', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const roomNum = parseInt(req.params.roomNumber);
    let roomConfig = await Room.findOne({ hostelId, roomNumber: roomNum }).lean();
    if (!roomConfig) {
      roomConfig = await Room.create({ hostelId, roomNumber: roomNum, rent: 0, advance: 0, maxCapacity: 10 });
    }
    const members = await Member.find({ hostelId, roomNumber: roomNum, isActive: true }).lean();
    res.json({
      ...roomConfig,
      memberCount: members.length,
      status: members.length === 0 ? 'vacant' : members.length >= roomConfig.maxCapacity ? 'full' : 'occupied',
      members,
    });
  } catch(err) { next(err); }
});

// PUT update single room config
router.put('/:roomNumber', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const roomNum = parseInt(req.params.roomNumber);
    const { rent, advance, maxCapacity, notes, reason } = req.body;

    // F2: Record rent history if rent is changing
    const existing = await Room.findOne({ hostelId, roomNumber: roomNum });
    const updateOps = {
      $set: {
        ...(rent        !== undefined && { rent:        parseFloat(rent)       || 0 }),
        ...(advance     !== undefined && { advance:     parseFloat(advance)    || 0 }),
        ...(maxCapacity !== undefined && { maxCapacity: parseInt(maxCapacity)  || 10 }),
        ...(notes       !== undefined && { notes }),
      }
    };
    if (rent !== undefined && existing && parseFloat(rent) !== existing.rent) {
      updateOps.$push = {
        rentHistory: {
          oldRent:   existing.rent,
          newRent:   parseFloat(rent) || 0,
          changedOn: new Date(),
          changedBy: req.user?.name || req.user?.username || 'owner',
          reason:    reason || '',
        }
      };
    }
    const updated = await Room.findOneAndUpdate(
      { hostelId, roomNumber: roomNum },
      updateOps,
      { new: true, upsert: true }
    );
    res.json(updated);
  } catch(err) { next(err); }
});

// PUT bulk update all rooms
router.put('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const { rooms } = req.body;
    if (!Array.isArray(rooms)) return res.status(400).json({ message: 'rooms array required' });
    const ops = rooms.map(r => ({
      updateOne: {
        filter: { hostelId, roomNumber: r.roomNumber },
        update: {
          $set: {
            rent:        parseFloat(r.rent)       || 0,
            advance:     parseFloat(r.advance)    || 0,
            maxCapacity: parseInt(r.maxCapacity)  || 10,
            notes:       r.notes || '',
          }
        },
        upsert: true,
      }
    }));
    await Room.bulkWrite(ops);
    res.json({ message: 'All rooms updated' });
  } catch(err) { next(err); }
});

// POST create a new room
router.post('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const { roomNumber, rent, advance, maxCapacity, notes } = req.body;
    const num = parseInt(roomNumber);
    if (!num || num < 1) return res.status(400).json({ message: 'Valid room number required' });
    const exists = await Room.findOne({ hostelId, roomNumber: num });
    if (exists) return res.status(409).json({ message: `Room ${num} already exists` });
    const room = await Room.create({
      hostelId,
      roomNumber:  num,
      rent:        parseFloat(rent)       || 0,
      advance:     parseFloat(advance)    || 0,
      maxCapacity: parseInt(maxCapacity)  || 6,
      notes:       notes || '',
    });
    res.status(201).json(room);
  } catch(err) { next(err); }
});

// DELETE a room (only if vacant — no active members)
router.delete('/:roomNumber', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel assigned' });
    const roomNum = parseInt(req.params.roomNumber);
    const activeMembers = await Member.countDocuments({ hostelId, roomNumber: roomNum, isActive: true });
    if (activeMembers > 0) {
      return res.status(400).json({ message: `Room ${roomNum} has ${activeMembers} active member(s). Move or deactivate them before deleting the room.` });
    }
    await Room.findOneAndDelete({ hostelId, roomNumber: roomNum });
    res.json({ message: `Room ${roomNum} deleted` });
  } catch(err) { next(err); }
});

module.exports = router;