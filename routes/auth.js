const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const checkAuth = require('../middleware/auth');
const { loadUser } = checkAuth;
const { MODULES } = require('../utils/permissions');

// Users are created and managed under /api/rbac/users (Users, roles & permissions page).

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'Email and password required' });

    const user = await db('users').where('email', email).first();
    if (!user) return res.json({ success: false, message: 'Invalid credentials' });
    if (!user.is_active) return res.json({ success: false, message: 'Account is inactive' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Invalid credentials' });
    await db('users').where('id_users', user.id_users).update({ last_login_at: new Date() });

    const token = jwt.sign(
      { id_users: user.id_users, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ success: true, token, user: await profile(user.id_users) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Who am I: role, permissions, and which module each page belongs to (so the menu and route guard follow
// the same rules as the API).
async function profile(id) {
  const u = await loadUser(id);
  if (!u || !u.is_active) return null;
  return {
    id: u.id_users, name: u.name, email: u.email, role: u.role, role_key: u.role_key, role_name: u.role_name,
    is_super: u.is_super, is_owner_portal: u.is_owner_portal, permissions: [...u.permissions],
    pages: MODULES.flatMap(m => m.pages.map(p => ({ path: p, module: m.key }))),
  };
}

router.get('/me', checkAuth, async (req, res) => {
  try {
    const user = await profile(req.user.id_users);
    if (!user) return res.status(401).json({ success: false, message: 'This account is inactive or no longer exists' });
    res.json({ success: true, user });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Change my own password.
router.post('/password', checkAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || String(new_password).length < 8) return res.status(400).json({ success: false, message: 'The new password must be at least 8 characters' });
    const u = await db('users').where('id_users', req.user.id_users).first();
    if (!u || !(await bcrypt.compare(String(current_password || ''), u.password))) return res.status(400).json({ success: false, message: 'Current password is wrong' });
    await db('users').where('id_users', u.id_users).update({ password: await bcrypt.hash(String(new_password), 11) });
    res.json({ success: true, message: 'Password changed' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;