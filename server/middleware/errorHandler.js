const logger = require('../utils/logger');

const notFound = (req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
};

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path, method: req.method });

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: messages[0], errors: messages });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ message: `${field} already exists. Please use a different value.` });
  }
  if (err.name === 'CastError')         return res.status(400).json({ message: 'Invalid ID format' });
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Invalid token. Please log in again.' });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Session expired. Please log in again.' });

  const status = err.status || err.statusCode || 500;
  // Always return the real message — makes debugging possible
  res.status(status).json({ message: err.message || 'Internal server error' });
};

module.exports = { notFound, errorHandler };
