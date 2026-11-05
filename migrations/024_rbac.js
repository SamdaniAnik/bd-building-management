// Role-based access control: roles, their permissions, and a role per user.
// The old users.role column (admin / manager / viewer) is kept in step for code that still reads it:
// SUPER_ADMIN → admin, owner-portal roles → viewer, every other staff role → manager.
const { DEFAULT_ROLES, ALL_PERMISSIONS } = require('../utils/permissions');

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('roles'))) {
    await knex.schema.createTable('roles', t => {
      t.increments('id_roles').primary();
      t.string('role_key', 40).notNullable().unique();
      t.string('name_en', 100).notNullable();
      t.string('name_bn', 100).nullable();
      t.string('description', 300).nullable();
      t.boolean('is_system').notNullable().defaultTo(false);        // cannot be deleted; SUPER_ADMIN / OWNER permissions are fixed
      t.boolean('is_owner_portal').notNullable().defaultTo(false);  // login sees only the owner portal
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').nullable();
    });
  }
  if (!(await knex.schema.hasTable('role_permissions'))) {
    await knex.schema.createTable('role_permissions', t => {
      t.integer('id_roles').unsigned().notNullable();
      t.string('permission', 60).notNullable();
      t.primary(['id_roles', 'permission']);
    });
  }
  const userCols = {
    id_roles: t => t.integer('id_roles').unsigned().nullable().index(),
    phone: t => t.string('phone', 20).nullable(),
    last_login_at: t => t.timestamp('last_login_at').nullable(),
  };
  for (const [name, add] of Object.entries(userCols)) {
    if (!(await knex.schema.hasColumn('users', name))) await knex.schema.alterTable('users', add);
  }

  for (const r of DEFAULT_ROLES) {
    const exists = await knex('roles').where({ role_key: r.role_key }).first();
    if (exists) continue;
    const [id] = await knex('roles').insert({ role_key: r.role_key, name_en: r.name_en, name_bn: r.name_bn, description: r.description, is_system: !!r.is_system, is_owner_portal: !!r.is_owner_portal });
    const perms = [...new Set(r.perms)].filter(p => ALL_PERMISSIONS.includes(p));
    if (perms.length) await knex('role_permissions').insert(perms.map(permission => ({ id_roles: id, permission })));
  }
  // Existing users: admin → Super admin, viewer → Flat owner, manager → Project manager
  // (the seeded accountant login gets the Accountant role).
  const id = async key => (await knex('roles').where({ role_key: key }).first()).id_roles;
  await knex('users').whereNull('id_roles').where({ role: 'admin' }).update({ id_roles: await id('SUPER_ADMIN') });
  await knex('users').whereNull('id_roles').where({ role: 'viewer' }).update({ id_roles: await id('OWNER') });
  await knex('users').whereNull('id_roles').where({ role: 'manager' }).where('email', 'like', 'accountant@%').update({ id_roles: await id('ACCOUNTANT') });
  await knex('users').whereNull('id_roles').update({ id_roles: await id('MANAGER') });
};

exports.down = async function (knex) {
  for (const c of ['id_roles', 'phone', 'last_login_at']) {
    if (await knex.schema.hasColumn('users', c)) await knex.schema.alterTable('users', t => t.dropColumn(c));
  }
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('roles');
};
