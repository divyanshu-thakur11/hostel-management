const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Hostel   = require('../models/Hostel');
const { JWT_SECRET, COOKIE_NAME, authMiddleware, ownerOnly } = require('../middleware/auth');
const logger   = require('../utils/logger');

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   12 * 60 * 60 * 1000,  // 12 hours, matches JWT expiry
};

// ── Login ──────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password required' });
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Invalid credentials or account disabled' });
    if (user.isLocked) {
      const remaining = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ message: `Account locked. Try again in ${remaining} minute(s).` });
    }
    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.incLoginAttempts();
      const left = 5 - (user.loginAttempts + 1);
      return res.status(401).json({ message: left > 0 ? `Invalid credentials. ${left} attempt(s) remaining.` : 'Account locked for 15 minutes.' });
    }
    await user.updateOne({ $set: { loginAttempts: 0, lastLogin: new Date() }, $unset: { lockUntil: 1 } });

    // hostelId embedded in JWT — client never needs to manage it
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role, name: user.name, hostelId: user.hostelId },
      JWT_SECRET, { expiresIn: '12h' }
    );

    // Set HttpOnly cookie
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    logger.info('User logged in', { username: user.username, role: user.role });

    // If password change is required, tell frontend
    if (user.mustChangePassword) {
      return res.json({
        requirePasswordChange: true,
        user: { id: user._id, username: user.username, name: user.name, role: user.role, hostelId: user.hostelId },
      });
    }

    res.json({
      user: { id: user._id, username: user.username, name: user.name, role: user.role, hostelId: user.hostelId, lastLogin: user.lastLogin },
    });
  } catch(err) { next(err); }
});

// ── Logout ─────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ message: 'Logged out' });
});

// ── Me ─────────────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch(err) { next(err); }
});

// ── Change Password ────────────────────────────────────────────────────────────
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const user = await User.findById(req.user.id);
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect' });
    user.password           = newPassword;
    user.mustChangePassword = false;
    await user.save();
    logger.info('Password changed', { username: user.username });
    res.json({ message: 'Password changed successfully' });
  } catch(err) { next(err); }
});

// ── Reset Password (owner only) ────────────────────────────────────────────────
router.post('/users/:id/reset-password', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.password            = newPassword;
    user.mustChangePassword  = true;   // force them to change on next login
    user.loginAttempts       = 0;
    user.lockUntil           = undefined;
    await user.save();
    logger.info('Password reset by owner', { target: user.username, by: req.user.username });
    res.json({ message: `Password reset for ${user.name}. They will be prompted to change it on next login.` });
  } catch(err) { next(err); }
});

// ── List Users ─────────────────────────────────────────────────────────────────
router.get('/users', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch(err) { next(err); }
});

// ── Create Manager ─────────────────────────────────────────────────────────────
router.post('/users', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const { username, password, name, mobile } = req.body;
    if (!username || !password || !name) return res.status(400).json({ message: 'username, password and name required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: `Username "${username}" is already taken.` });
    let hostelId = req.body.hostelId || req.hostelId || null;
    if (!hostelId) {
      const hostel = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
      hostelId = hostel?._id || null;
    }
    const user = new User({ username: username.toLowerCase().trim(), password, name, mobile, role: 'manager', hostelId, mustChangePassword: true });
    await user.save();
    logger.info('Manager created', { username: user.username, by: req.user.username });
    res.status(201).json({ message: `Manager "${name}" created. Username: ${username}. They will be prompted to set a new password on first login.`, user: { username: user.username, name: user.name, role: user.role, hostelId } });
  } catch(err) { next(err); }
});

// ── Toggle User ────────────────────────────────────────────────────────────────
router.put('/users/:id/toggle', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'owner') return res.status(400).json({ message: 'Cannot disable owner account' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ message: `User ${user.isActive ? 'enabled' : 'disabled'}`, isActive: user.isActive });
  } catch(err) { next(err); }
});

// ── User Activity ──────────────────────────────────────────────────────────────
router.get('/users/:id/activity', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('name username role recentActivity lastLogin');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch(err) { next(err); }
});

// ── Delete Manager ─────────────────────────────────────────────────────────────
router.delete('/users/:id', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'owner') return res.status(400).json({ message: 'Cannot delete owner account' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Manager deleted' });
  } catch(err) { next(err); }
});

// ── Assign Hostel to Manager ───────────────────────────────────────────────────
router.put('/users/:id/hostel', authMiddleware, ownerOnly, async (req, res, next) => {
  try {
    const { hostelId } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { hostelId: hostelId || null }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch(err) { next(err); }
});

module.exports = router;
