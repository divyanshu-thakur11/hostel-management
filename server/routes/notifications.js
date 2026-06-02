const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authMiddleware } = require('../middleware/auth');
const { generateAutoNotifications } = require('../services/notifications');
const Hostel = require('../models/Hostel');

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

// Get notifications
router.get('/', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    // Auto-generate before returning
    await generateAutoNotifications(hostelId);
    const query = hostelId ? { hostelId } : {};
    if (req.query.unread === 'true') query.isRead = false;
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(100);
    const unreadCount = await Notification.countDocuments({ ...query, isRead: false });
    res.json({ notifications, unreadCount });
  } catch(err) { next(err); }
});

// Mark as read
router.put('/:id/read', async (req, res, next) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ message: 'Marked as read' });
  } catch(err) { next(err); }
});

// Mark all as read
router.put('/read-all', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = hostelId ? { hostelId } : {};
    await Notification.updateMany(query, { isRead: true });
    res.json({ message: 'All marked as read' });
  } catch(err) { next(err); }
});

// Delete old read notifications
router.delete('/clear-read', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = { isRead: true };
    if (hostelId) query.hostelId = hostelId;
    await Notification.deleteMany(query);
    res.json({ message: 'Cleared read notifications' });
  } catch(err) { next(err); }
});

// Clear ALL notifications (read + unread)
router.delete('/clear-all', async (req, res, next) => {
  try {
    const hostelId = await getHostelId(req);
    const query = hostelId ? { hostelId } : {};
    await Notification.deleteMany(query);
    res.json({ message: 'All notifications cleared' });
  } catch(err) { next(err); }
});

// Delete single notification
router.delete('/:id', async (req, res, next) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: 'Notification deleted' });
  } catch(err) { next(err); }
});

module.exports = router;