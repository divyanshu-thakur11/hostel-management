const express = require('express');
const router = express.Router();
const Salary = require('../models/Salary');
const Hostel = require('../models/Hostel');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

router.use(authMiddleware, ownerOnly);

const getHostelId = async (req) => {
  const hId = req.hostelId; // from JWT — never from client
  if (hId) return hId;
  const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
  return first?._id;
};

router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = hostelId ? { hostelId } : {};
    const data = await Salary.find(query).sort({ paidOn: -1 });
    res.json(data);
  } catch(err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    if (!hostelId) return res.status(400).json({ message: 'No hostel found' });
    const entry = new Salary({ ...req.body, hostelId });
    const saved = await entry.save();
    res.status(201).json(saved);
  } catch(err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updated = await Salary.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch(err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Salary.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch(err) { next(err); }
});

module.exports = router;