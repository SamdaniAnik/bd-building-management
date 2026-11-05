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

// Staff = any login that is not a flat-owner portal login (legacy role 'viewer').
const isStaff = user => !!user && (user.is_owner_portal === undefined ? STAFF_ROLES.includes(user.role) : !user.is_owner_portal);

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

// ── Role-based access control ─────────────────────────────────────
// authorize: loads the user's current role and permissions from the database (cached briefly), refuses
// inactive accounts, then checks the request against utils/permissions.js. Runs after checkAuth.
const { requiredFor, apiPath, under, OWNER_PORTAL_PATHS } = require('../utils/permissions');
const CACHE_MS = 15 * 1000;
const cache = new Map(); // id_users → { at, user }
const invalidate = () => cache.clear();

async function loadUser(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const { db } = require('../db/schemas');
  const u = await db('users as u').leftJoin('roles as r', 'r.id_roles', 'u.id_roles').where('u.id_users', id)
    .select('u.id_users', 'u.name', 'u.email', 'u.role', 'u.is_active', 'u.id_roles', 'r.role_key', 'r.name_en as role_name', 'r.is_owner_portal').first();
  if (!u) { cache.delete(id); return null; }
  const perms = u.id_roles ? await db('role_permissions').where({ id_roles: u.id_roles }).pluck('permission') : [];
  const user = { ...u, is_active: !!u.is_active, is_owner_portal: !!u.is_owner_portal, is_super: u.role_key === 'SUPER_ADMIN', permissions: new Set(perms) };
  cache.set(id, { at: Date.now(), user });
  return user;
}

const can = (user, perm) => !!user && (user.is_super || user.permissions.has(perm));

async function authorize(req, res, next) {
  try {
    const u = await loadUser(req.user?.id_users);
    if (!u || !u.is_active) return res.status(401).json({ success: false, message: 'This account is inactive or no longer exists' });
    // Fresh role on req.user, so code reading req.user.role sees today's role, not the one in the token.
    req.user = { ...req.user, name: u.name, email: u.email, role: u.role, role_key: u.role_key, is_super: u.is_super, is_owner_portal: u.is_owner_portal, permissions: u.permissions };
    req.can = perm => can(u, perm);
    const path = apiPath(req.baseUrl + req.path);
    if (u.is_owner_portal) {
      if (OWNER_PORTAL_PATHS.some(p => under(path, p))) return next();
      return res.status(403).json({ success: false, message: 'Forbidden: this area is for project staff only' });
    }
    if (u.is_super) return next();
    const need = requiredFor(req.method, req.baseUrl + req.path);
    if (need.anyStaff) return next();
    if (need.anyOf && need.anyOf.some(p => u.permissions.has(p))) return next();
    const what = need.superOnly ? 'this area' : need.anyOf.join(' or ');
    return res.status(403).json({ success: false, message: `You do not have permission for ${what}. Ask an administrator to update your role.`, required: need.anyOf || [] });
  } catch (err) { next(err); }
}

module.exports = checkAuth;
module.exports.authorize = authorize;
module.exports.loadUser = loadUser;
module.exports.invalidatePermissions = invalidate;
module.exports.can = can;
module.exports.checkAuth = checkAuth;
module.exports.requireRole = requireRole;
module.exports.staffOr = staffOr;
module.exports.isStaff = isStaff;
module.exports.STAFF_ROLES = STAFF_ROLES;
