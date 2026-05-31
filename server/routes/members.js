const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/memberController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/next-id',           ctrl.nextId);
router.get('/archived',          ctrl.listArchived);
router.post('/archived/:id/restore', ctrl.restoreArchived);
router.delete('/archived/:id',   ctrl.deleteArchived);
router.get('/',                  ctrl.list);
router.get('/room/:roomNumber',  ctrl.getByRoom);
router.get('/:id',               ctrl.getOne);
router.post('/',                 ctrl.create);
router.put('/:id',               ctrl.update);
router.post('/:id/vacate',       ctrl.vacate);
router.delete('/:id',            ctrl.remove);

module.exports = router;

// F6: Payment risk score
router.get('/:id/payment-score', async (req, res, next) => {
  try {
    const Receipt = require('../models/Receipt');
    const receipts = await Receipt.find({ memberId: req.params.id }).sort({ receiptDate: 1 }).lean();
    let score = 100;
    const partPaymentCount = receipts.filter(r => r.isPartPayment).length;
    score -= partPaymentCount * 20;
    // Gap penalty
    for (let i = 1; i < receipts.length; i++) {
      const days = (new Date(receipts[i].receiptDate) - new Date(receipts[i-1].receiptDate)) / (1000*60*60*24);
      if (days > 35) score -= 15;
    }
    // Last payment recency
    const lastPaymentDays = receipts.length
      ? Math.floor((Date.now() - new Date(receipts[receipts.length-1].receiptDate)) / (1000*60*60*24))
      : 999;
    if (lastPaymentDays > 40) score -= 10;
    score = Math.max(0, Math.min(100, score));
    const risk = score >= 70 ? 'low' : score >= 40 ? 'medium' : 'high';
    res.json({ score, risk, lastPaymentDays, partPaymentCount });
  } catch(err) { next(err); }
});