exports.up = async function(knex) {
  if (await knex.schema.hasTable('building_unit_payments')) return;
  await knex.schema.createTable('building_unit_payments', table => {
    table.increments('id_payments').primary();
    table.integer('id_units').unsigned().notNullable();
    table.integer('id_buildings').unsigned().notNullable();
    table.string('payment_no', 100).nullable();
    table.string('installment_type', 50).notNullable();
    table.decimal('amount_bdt', 16, 2).notNullable();
    table.date('payment_date').notNullable();
    table.enum('payment_method',['Cash','Cheque','Bank Transfer','bKash','Nagad','Rocket','Other']).notNullable().defaultTo('Cash');
    table.string('cheque_no', 100).nullable();
    table.string('bank_name', 200).nullable();
    table.string('transaction_id', 150).nullable();
    table.enum('status',['Pending','Received','Bounced','Cancelled']).notNullable().defaultTo('Received');
    table.text('remarks').nullable();
    table.integer('created_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    table.index(['id_units']);
    table.index(['id_buildings']);
    table.foreign('id_units','fk_pay_units').references('id_units').inTable('building_units').onDelete('RESTRICT');
    table.foreign('id_buildings','fk_pay_buildings').references('id_buildings').inTable('buildings').onDelete('RESTRICT');
  });
};
exports.down = knex => knex.schema.dropTableIfExists('building_unit_payments');