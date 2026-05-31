const express    = require('express');
const mongoose   = require('mongoose');
const router     = express.Router();
const ctrl       = require('../controllers/receiptController');
const { authMiddleware } = require('../middleware/auth');
const Hostel     = require('../models/Hostel');

router.use(authMiddleware);

// helper — same pattern as every other route
const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    if (req.hostelId) return req.hostelId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

router.get('/next-numbers',             ctrl.nextNumbers);
router.get('/room/:roomNumber/summary', ctrl.roomSummary);
router.get('/room/:roomNumber',         ctrl.byRoom);
router.get('/',                         ctrl.list);
router.post('/',                        ctrl.create);
router.delete('/:id',                   ctrl.remove);

// F8: Natural-language query — AI generates pipeline, server runs it safely
const ALLOWED_COLLECTIONS = ['receipts', 'members'];
const BLOCKED_STAGES = ['$out','$merge','$indexStats','$currentOp','$planCacheStats','$lookup'];

router.post('/query', async (req, res) => {
  try {
    const { collection, pipeline } = req.body;
    if (!ALLOWED_COLLECTIONS.includes(collection))
      return res.status(400).json({ message: 'Invalid collection' });
    if (!Array.isArray(pipeline))
      return res.status(400).json({ message: 'Invalid pipeline' });
    const pipeStr = JSON.stringify(pipeline);
    if (BLOCKED_STAGES.some(s => pipeStr.includes(s)))
      return res.status(400).json({ message: 'Blocked pipeline stage' });

    const Model = collection === 'receipts'
      ? require('../models/Receipt')
      : require('../models/Member');

    const hostelId = await getHostelId(req);
    // Always inject hostelId as first $match — cannot be overridden by client
    const safePipeline = [
      { $match: { hostelId: new mongoose.Types.ObjectId(String(hostelId)) } },
      ...pipeline,
      { $limit: 100 },   // always cap results
    ];
    const result = await Model.aggregate(safePipeline);
    res.json(result);
  } catch(err) {
    res.status(400).json({ message: 'Query failed: ' + err.message });
  }
});

module.exports = router;