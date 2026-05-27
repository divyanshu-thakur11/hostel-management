const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hostel_super_secret_change_in_production';
const COOKIE_NAME = 'hm_token';

// Read token from HttpOnly cookie first, fall back to Authorization header
// (header fallback keeps mobile/API clients working during transition)
const authMiddleware = (req, res, next) => {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) token = auth.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const decoded  = jwt.verify(token, JWT_SECRET);
    req.user       = decoded;
    // hostelId comes from the JWT — never from client params
    req.hostelId   = decoded.hostelId || null;
    next();
  } catch(err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Session expired. Please log in again.' });
    return res.status(401).json({ message: 'Invalid token. Please log in again.' });
  }
};

const ownerOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Owner access only' });
  next();
};

const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied' });
  next();
};

module.exports = { JWT_SECRET, COOKIE_NAME, authMiddleware, ownerOnly, allowRoles };
