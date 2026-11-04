exports.up = async function(knex) {
  if (await knex.schema.hasTable('building_costing')) return;
  await knex.schema.createTable('building_costing', table => {
    table.increments('id_costing').primary();
    table.integer('id_buildings').unsigned().notNullable();
    table.string('cost_category', 100).notNullable();
    table.string('description', 500).nullable();
    table.decimal('quantity', 14, 4).nullable();
    table.string('unit', 50).nullable();
    table.decimal('rate_bdt', 14, 2).nullable();
    table.decimal('amount_bdt', 16, 2).notNullable();
    table.decimal('vat_percent', 6, 2).nullable().defaultTo(0);
    table.decimal('vat_amount_bdt', 14, 2).nullable().defaultTo(0);
    table.decimal('total_with_vat_bdt', 16, 2).nullable();
    table.enum('cost_type',['Land','Construction','Approval','Utility','Administrative','Other']).notNullable().defaultTo('Construction');
    table.date('cost_date').nullable();
    table.enum('payment_status',['Budgeted','Partially Paid','Paid']).notNullable().defaultTo('Budgeted');
    table.decimal('paid_amount_bdt', 16, 2).nullable().defaultTo(0);
    table.text('remarks').nullable();
    table.integer('created_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    table.index(['id_buildings']);
    table.foreign('id_buildings','fk_co_buildings').references('id_buildings').inTable('buildings').onDelete('RESTRICT');
  });
};
exports.down = knex => knex.schema.dropTableIfExists('building_costing');