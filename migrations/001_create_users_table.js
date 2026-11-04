exports.up = async function(knex) {
  if (await knex.schema.hasTable('users')) return;
  await knex.schema.createTable('users', table => {
    table.increments('id_users').primary();
    table.string('name', 200).notNullable();
    table.string('email', 200).notNullable().unique();
    table.string('password', 255).notNullable();
    table.enum('role', ['admin','manager','viewer']).notNullable().defaultTo('viewer');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });
};
exports.down = knex => knex.schema.dropTableIfExists('users');