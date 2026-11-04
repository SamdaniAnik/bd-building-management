exports.up = async function(knex) {
  if (await knex.schema.hasTable('buildings')) return;
  await knex.schema.createTable('buildings', table => {
    table.increments('id_buildings').primary();
    table.string('building_name', 250).notNullable();
    table.string('building_code', 50).nullable().unique();
    table.enum('building_type', ['Residential','Commercial','Mixed']).notNullable().defaultTo('Residential');
    // Land
    table.decimal('total_land_area', 12, 4).notNullable().comment('In Katha');
    table.decimal('total_land_area_sqft', 14, 4).nullable().comment('1 katha=720 sqft in BD');
    table.decimal('far_ratio', 8, 4).nullable();
    table.decimal('total_buildable_area_sqft', 14, 4).nullable();
    // Location BD
    table.string('district', 100).nullable();
    table.string('upazila', 100).nullable();
    table.string('mouza', 150).nullable();
    table.string('dag_no', 100).nullable();
    table.string('khatian_no', 100).nullable();
    table.text('address').nullable();
    // Building specs
    table.integer('total_floors').unsigned().nullable();
    table.integer('basement_floors').unsigned().defaultTo(0);
    table.integer('total_units').unsigned().nullable();
    // RAJUK
    table.string('rajuk_approval_no', 150).nullable();
    table.date('rajuk_approval_date').nullable();
    table.enum('approval_authority', ['RAJUK','KDA','CDA','RDA','Other']).nullable();
    // Financial
    table.decimal('land_purchase_cost', 16, 2).nullable();
    table.decimal('estimated_construction_cost', 16, 2).nullable();
    // Status
    table.enum('status', ['Planning','Under Construction','Completed','Cancelled']).notNullable().defaultTo('Planning');
    table.date('start_date').nullable();
    table.date('completion_date').nullable();
    table.text('notes').nullable();
    table.integer('created_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    table.index(['created_by']);
  });
};
exports.down = knex => knex.schema.dropTableIfExists('buildings');