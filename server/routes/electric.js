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
    const entry = new Electric({ ...req.body, hostelId });
    const saved = await entry.save();
    res.status(201).json(saved);
  } catch(err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updated = await Electric.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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
