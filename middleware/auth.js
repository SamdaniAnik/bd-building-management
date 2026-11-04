const jwt = require('jsonwebtoken');

const STAFF_ROLES = ['admin', 'manager'];

// Verifies the Bearer JWT and sets req.user = { id_users, name, email, role }.
const checkAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ success: false, message: 'Server misconfigured: JWT_SECRET is not set' });
    }
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token' });
  }
};

const isStaff = user => !!user && STAFF_ROLES.includes(user.role);

// Only the given roles may continue. Use after checkAuth.
const requireRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  return res.status(403).json({ success: false, message: 'Forbidden: insufficient permissions' });
};

// Staff may use the whole router; other roles (owners = 'viewer') only the listed path prefixes.
const staffOr = (allowedPrefixes = []) => (req, res, next) => {
  if (isStaff(req.user)) return next();
  if (allowedPrefixes.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  return res.status(403).json({ success: false, message: 'Forbidden: this area is for project staff only' });
};

module.exports = checkAuth;
module.exports.checkAuth = checkAuth;
module.exports.requireRole = requireRole;
module.exports.staffOr = staffOr;
module.exports.isStaff = isStaff;
module.exports.STAFF_ROLES = STAFF_ROLES;
