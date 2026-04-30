// ============================================================
//  middleware/auth.js — JWT Authentication Middleware
// ============================================================
const jwt  = require('jsonwebtoken');
const { User } = require('../models');

// Protect routes — verifies JWT and attaches user to req
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// Check plan access
const requirePlan = (...plans) => (req, res, next) => {
  if (!plans.includes(req.user.plan)) {
    return res.status(403).json({
      success: false,
      message: `This feature requires the ${plans.join(' or ')} plan. Upgrade at monocomplex.ai/pricing`,
    });
  }
  next();
};

// Check video quota
const checkVideoQuota = async (req, res, next) => {
  const user = req.user;
  if (user.plan !== 'boss' && user.videosThisMonth >= user.videosLimit) {
    return res.status(403).json({
      success: false,
      message: `You've used all ${user.videosLimit} videos this month. Upgrade your plan to continue.`,
    });
  }
  next();
};

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

module.exports = { protect, requirePlan, checkVideoQuota, signToken };
