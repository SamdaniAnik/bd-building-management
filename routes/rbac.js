// Users, roles & permissions — mounted at /api/rbac (needs users.view / users.edit, see utils/permissions.js).
//
// Escalation guard: someone who is not Super Admin can only hand out roles whose permissions they hold
// themselves, and cannot change Super Admin accounts. Nobody can change their own role or deactivate
// themselves, and the last active Super Admin cannot be removed.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db/schemas');
const { MODULES, GROUPS, ALL_PERMISSIONS, actionsOf } = require('../utils/permissions');
const { invalidatePermissions } = require('../middleware/auth');
const { isValidBdMobile, normalizeBdMobile } = require('../utils/bd');

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || String(err) });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const legacyRole = r => (r.role_key === 'SUPER_ADMIN' ? 'admin' : r.is_owner_portal ? 'viewer' : 'manager');

async function audit(req, action, entity, id, oldV, newV) {
  try {
    await db('audit_logs').insert({ user_name: req.user?.name || 'System', action, entity_type: entity, entity_id: String(id ?? ''),
      old_value: oldV == null ? null : JSON.stringify(oldV), new_value: newV == null ? null : JSON.stringify(newV), created_at: new Date() });
  } catch (e) { console.error('audit:', e.message); }
}

async function roleWithPerms(id) {
  const r = await db('roles').where({ id_roles: id }).first();
  if (!r) return null;
  return { ...r, is_system: !!r.is_system, is_owner_portal: !!r.is_owner_portal, permissions: await db('role_permissions').where({ id_roles: id }).pluck('permission') };
}

// The acting user may grant this role only if it gives nothing they do not have themselves.
function assertCanGrant(req, role) {
  if (req.user.is_super) return;
  if (role.role_key === 'SUPER_ADMIN') throw bad('Only a Super Admin can make someone Super Admin', 403);
  const extra = role.permissions.filter(p => !req.user.permissions.has(p));
  if (extra.length) throw bad(`You cannot give a role with permissions you do not have yourself (${extra.slice(0, 4).join(', ')}${extra.length > 4 ? '…' : ''})`, 403);
}

// ── Catalogue ───────────────────────────────────────────────────
router.get('/catalog', (req, res) => {
  res.json({ success: true, groups: GROUPS,
    modules: MODULES.map(m => ({ key: m.key, group: m.group, en: m.en, bn: m.bn,
      actions: actionsOf(m).map(a => ({ action: a, perm: `${m.key}.${a}`, ...(m.extra || []).find(e => e.action === a) })) })) });
});

// ── Roles ───────────────────────────────────────────────────────
router.get('/roles', async (req, res) => {
  try {
    const roles = await db('roles').orderBy('is_system', 'desc').orderBy('name_en');
    const perms = await db('role_permissions').select('id_roles', 'permission');
    const counts = Object.fromEntries((await db('users').groupBy('id_roles').select('id_roles').count({ n: '*' })).map(r => [r.id_roles, Number(r.n)]));
    res.json({ success: true, rows: roles.map(r => ({ ...r, is_system: !!r.is_system, is_owner_portal: !!r.is_owner_portal, users: counts[r.id_roles] || 0,
      permissions: r.role_key === 'SUPER_ADMIN' ? ALL_PERMISSIONS : perms.filter(p => p.id_roles === r.id_roles).map(p => p.permission) })) });
  } catch (err) { fail(res, err); }
});

router.post('/roles', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name_en || '').trim();
    if (!name) throw bad('Role name is required');
    let perms = [...new Set((Array.isArray(b.permissions) ? b.permissions : []).filter(p => ALL_PERMISSIONS.includes(p)))];
    // Any action on a module implies being able to see it.
    for (const p of [...perms]) { const mod = p.split('.')[0]; if (!perms.includes(`${mod}.view`)) perms.push(`${mod}.view`); }
    const existing = b.id_roles ? await roleWithPerms(b.id_roles) : null;
    if (b.id_roles && !existing) throw bad('Role not found');
    if (existing?.is_system) throw bad('Built-in roles (Super admin, Flat owner) cannot be changed');
    assertCanGrant(req, { role_key: existing?.role_key, permissions: perms });
    if (existing && !req.user.is_super) {
      // Removing permissions from a role you cannot fully hold is also off-limits.
      const removing = existing.permissions.filter(p => !perms.includes(p) && !req.user.permissions.has(p));
      if (removing.length) throw bad('This role has permissions you do not have — only a Super Admin can change it', 403);
    }
    const row = { name_en: name.slice(0, 100), name_bn: b.name_bn ? String(b.name_bn).slice(0, 100) : null, description: b.description ? String(b.description).slice(0, 300) : null };
    let id = existing?.id_roles;
    await db.transaction(async trx => {
      if (existing) await trx('roles').where({ id_roles: id }).update({ ...row, updated_at: new Date() });
      else {
        const key = (String(b.role_key || name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ROLE').slice(0, 40);
        if (await trx('roles').where({ role_key: key }).first()) throw bad(`A role with the key ${key} already exists — choose another name`);
        [id] = await trx('roles').insert({ ...row, role_key: key, is_system: false, is_owner_portal: false });
      }
      await trx('role_permissions').where({ id_roles: id }).del();
      if (perms.length) await trx('role_permissions').insert(perms.map(permission => ({ id_roles: id, permission })));
    });
    invalidatePermissions();
    await audit(req, existing ? 'Updated role' : 'Created role', 'ROLE', id, existing ? { name: existing.name_en, permissions: existing.permissions } : null, { name, permissions: perms });
    res.json({ success: true, message: existing ? 'Role saved — takes effect for its users within seconds' : 'Role created', id });
  } catch (err) { fail(res, err); }
});

router.delete('/roles/:id', async (req, res) => {
  try {
    const r = await roleWithPerms(req.params.id);
    if (!r) throw bad('Role not found');
    if (r.is_system) throw bad('Built-in roles cannot be deleted');
    const [{ n }] = await db('users').where({ id_roles: r.id_roles }).count({ n: '*' });
    if (Number(n)) throw bad(`${n} user(s) still have this role — move them to another role first`);
    assertCanGrant(req, r);
    await db.transaction(async trx => { await trx('role_permissions').where({ id_roles: r.id_roles }).del(); await trx('roles').where({ id_roles: r.id_roles }).del(); });
    invalidatePermissions();
    await audit(req, 'Deleted role', 'ROLE', r.id_roles, { name: r.name_en, permissions: r.permissions }, null);
    res.json({ success: true, message: 'Role deleted' });
  } catch (err) { fail(res, err); }
});

// ── Users ───────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const rows = await db('users as u').leftJoin('roles as r', 'r.id_roles', 'u.id_roles').leftJoin('owners as o', 'o.login_email', 'u.email')
      .orderBy('u.is_active', 'desc').orderBy('u.name')
      .select('u.id_users', 'u.name', 'u.email', 'u.phone', 'u.is_active', 'u.last_login_at', 'u.created_at', 'u.id_roles', 'r.role_key', 'r.name_en as role_name', 'r.is_owner_portal', 'o.id_owners', 'o.full_name as owner_name');
    const owners = await db('owners').orderBy('full_name').select('id_owners', 'full_name', 'phone', 'login_email');
    res.json({ success: true, rows: rows.map(r => ({ ...r, is_active: !!r.is_active, is_owner_portal: !!r.is_owner_portal })), owners, me: req.user.id_users });
  } catch (err) { fail(res, err); }
});

const activeSupers = trx => trx('users as u').join('roles as r', 'r.id_roles', 'u.id_roles').where({ 'r.role_key': 'SUPER_ADMIN', 'u.is_active': true }).count({ n: '*' }).then(r => Number(r[0].n));

// Owner-portal logins are tied to one owner record through owners.login_email.
async function linkOwner(trx, email, ownerId, previousEmail) {
  if (previousEmail) await trx('owners').where({ login_email: previousEmail }).update({ login_email: null });
  if (!ownerId) throw bad('Choose which flat owner this portal login belongs to');
  const o = await trx('owners').where({ id_owners: ownerId }).first();
  if (!o) throw bad('Owner not found');
  if (o.login_email && o.login_email !== email && o.login_email !== previousEmail) {
    const other = await trx('users').where({ email: o.login_email }).first();
    if (other) throw bad(`${o.full_name} already has a portal login (${o.login_email})`);
  }
  await trx('owners').where({ id_owners: ownerId }).update({ login_email: email });
}

router.post('/users', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (!name) throw bad('Name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address — it is the login name');
    if (String(b.password || '').length < 8) throw bad('The password must be at least 8 characters');
    if (b.phone && !isValidBdMobile(b.phone)) throw bad('Phone is not a valid Bangladeshi mobile number');
    const role = await roleWithPerms(b.id_roles);
    if (!role) throw bad('Choose a role');
    assertCanGrant(req, role);
    if (await db('users').where({ email }).first()) throw bad('A user with this email already exists');
    let id;
    await db.transaction(async trx => {
      [id] = await trx('users').insert({ name: name.slice(0, 200), email, phone: b.phone ? normalizeBdMobile(b.phone) : null, password: await bcrypt.hash(String(b.password), 11),
        id_roles: role.id_roles, role: legacyRole(role), is_active: true });
      if (role.is_owner_portal) await linkOwner(trx, email, b.id_owners, null);
    });
    await audit(req, 'Created user', 'USER', id, null, { name, email, role: role.role_key });
    res.json({ success: true, message: `User created — ${email} can log in now`, id });
  } catch (err) { fail(res, err); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const u = await db('users as u').leftJoin('roles as r', 'r.id_roles', 'u.id_roles').where('u.id_users', req.params.id).select('u.*', 'r.role_key', 'r.is_owner_portal').first();
    if (!u) throw bad('User not found');
    const self = u.id_users === req.user.id_users;
    if (u.role_key === 'SUPER_ADMIN' && !req.user.is_super) throw bad('Only a Super Admin can change a Super Admin account', 403);
    const update = {};
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) throw bad('Name is required'); update.name = n.slice(0, 200); }
    if (b.email !== undefined) {
      const email = String(b.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address');
      if (email !== u.email && await db('users').where({ email }).first()) throw bad('Another user already has this email');
      update.email = email;
    }
    if (b.phone !== undefined) { if (b.phone && !isValidBdMobile(b.phone)) throw bad('Phone is not a valid Bangladeshi mobile number'); update.phone = b.phone ? normalizeBdMobile(b.phone) : null; }
    let role = null;
    if (b.id_roles !== undefined && Number(b.id_roles) !== u.id_roles) {
      if (self) throw bad('You cannot change your own role — ask another administrator');
      role = await roleWithPerms(b.id_roles);
      if (!role) throw bad('Role not found');
      assertCanGrant(req, role);
      update.id_roles = role.id_roles; update.role = legacyRole(role);
    }
    if (b.is_active !== undefined) {
      if (self && !b.is_active) throw bad('You cannot deactivate your own account');
      update.is_active = !!b.is_active;
    }
    await db.transaction(async trx => {
      await trx('users').where({ id_users: u.id_users }).update(update);
      if (u.role_key === 'SUPER_ADMIN' && (await activeSupers(trx)) === 0) throw bad('At least one active Super Admin must remain');
      const ownerPortal = role ? role.is_owner_portal : !!u.is_owner_portal;
      const email = update.email || u.email;
      if (ownerPortal && (role || b.id_owners !== undefined || update.email)) {
        const current = await trx('owners').where({ login_email: u.email }).first();
        await linkOwner(trx, email, b.id_owners ?? current?.id_owners, u.email);
      } else if (role && !role.is_owner_portal && u.is_owner_portal) {
        await trx('owners').where({ login_email: u.email }).update({ login_email: null }); // no longer a portal login
      }
    });
    invalidatePermissions();
    await audit(req, 'Updated user', 'USER', u.id_users, { name: u.name, email: u.email, role: u.role_key, is_active: !!u.is_active }, { ...update, role: role?.role_key });
    res.json({ success: true, message: 'User saved' });
  } catch (err) { fail(res, err); }
});

router.post('/users/:id/password', async (req, res) => {
  try {
    const u = await db('users as u').leftJoin('roles as r', 'r.id_roles', 'u.id_roles').where('u.id_users', req.params.id).select('u.id_users', 'u.email', 'r.role_key').first();
    if (!u) throw bad('User not found');
    if (u.role_key === 'SUPER_ADMIN' && !req.user.is_super) throw bad('Only a Super Admin can reset a Super Admin password', 403);
    const pw = String(req.body?.password || '');
    if (pw.length < 8) throw bad('The password must be at least 8 characters');
    await db('users').where({ id_users: u.id_users }).update({ password: await bcrypt.hash(pw, 11) });
    await audit(req, 'Reset password', 'USER', u.id_users, null, { email: u.email });
    res.json({ success: true, message: 'Password reset — tell the user their new password' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
