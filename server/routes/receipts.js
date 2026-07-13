const express    = require('express');
const mongoose   = require('mongoose');
const router     = express.Router();
const ctrl       = require('../controllers/receiptController');
const { authMiddleware } = require('../middleware/auth');
const Hostel     = require('../models/Hostel');

router.use(authMiddleware);

const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    if (req.hostelId) return req.hostelId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

router.get('/next-numbers',             ctrl.nextNumbers);
router.post('/reset-serial',            ctrl.resetSerial);
router.patch('/:id/clear-due',          ctrl.clearDue);
router.get('/room/:roomNumber/summary', ctrl.roomSummary);
router.get('/room/:roomNumber',         ctrl.byRoom);
router.get('/',                         ctrl.list);
router.post('/',                        ctrl.create);
router.put('/:id',                      ctrl.update);
router.delete('/:id',                   ctrl.remove);

module.exports = router;
