exports.up = async function(knex) {
  if (await knex.schema.hasTable('building_floors')) return;
  await knex.schema.createTable('building_floors', table => {
    table.increments('id_floors').primary();
    table.integer('id_buildings').unsigned().notNullable();
    table.string('floor_name', 100).notNullable();
    table.integer('floor_number').notNullable();
    table.decimal('total_floor_area_sqft', 12, 4).nullable();
    table.decimal('net_sellable_area_sqft', 12, 4).nullable();
    table.integer('unit_count').unsigned().defaultTo(0);
    table.text('notes').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    table.index(['id_buildings']);
    table.foreign('id_buildings','fk_fl_buildings').references('id_buildings').inTable('buildings').onDelete('CASCADE');
  });
};
exports.down = knex => knex.schema.dropTableIfExists('building_floors');