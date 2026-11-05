// Site inventory with a stock ledger and per-work material planning.
//
// materials           — the item list (cement, sand, rod, bricks…), now with a code, reorder level and average cost.
// work_material_requirements — what each work needs, e.g. Piling: 50 bags cement, 20 cft sand.
// stock_movements     — every quantity in or out of the store: opening, receipt from a supplier, issue to a work,
//                       return from a work, damage / wastage, and count adjustments. Stock on hand is the sum.
// site_inventory (old summary table) is kept in step with the ledger so existing screens still add up.

exports.up = async function (knex) {
  const matCols = {
    item_code: t => t.string('item_code', 30).nullable(),
    reorder_level: t => t.decimal('reorder_level', 14, 2).notNullable().defaultTo(0),
    avg_cost: t => t.decimal('avg_cost', 14, 4).notNullable().defaultTo(0),   // moving average purchase cost per unit
    is_active: t => t.boolean('is_active').notNullable().defaultTo(true),
  };
  for (const [name, add] of Object.entries(matCols)) {
    if (!(await knex.schema.hasColumn('materials', name))) await knex.schema.alterTable('materials', add);
  }

  if (!(await knex.schema.hasTable('work_material_requirements'))) {
    await knex.schema.createTable('work_material_requirements', t => {
      t.increments('id_requirements').primary();
      t.integer('id_works').unsigned().notNullable().index();
      t.integer('id_materials').unsigned().notNullable();
      t.decimal('required_qty', 14, 2).notNullable();
      t.string('notes', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['id_works', 'id_materials']);
    });
  }

  if (!(await knex.schema.hasTable('stock_movements'))) {
    await knex.schema.createTable('stock_movements', t => {
      t.increments('id_movements').primary();
      t.date('movement_date').notNullable().index();
      t.integer('id_materials').unsigned().notNullable().index();
      t.string('movement_type', 20).notNullable();   // OPENING | RECEIPT | ISSUE | RETURN | DAMAGE | ADJUSTMENT
      t.decimal('qty', 14, 2).notNullable();          // signed: + into the store, − out of it
      t.decimal('unit_cost', 14, 4).nullable();       // receipt: purchase price; issue: average cost at the time
      t.integer('id_works').unsigned().nullable().index();
      t.integer('id_vendors').unsigned().nullable();
      t.string('reference', 100).nullable();          // challan / memo / requisition no.
      t.string('person', 150).nullable();             // received from / issued to (contractor, site engineer)
      t.string('notes', 500).nullable();
      t.string('recorded_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // Carry the current summary stock over as opening balances.
    const rows = await knex('site_inventory as s').join('materials as m', 'm.id_materials', 's.id_materials')
      .select('s.id_materials', 's.current_stock', 's.minimum_reorder_stock', 's.last_updated', 'm.current_rate');
    for (const r of rows) {
      const d = r.last_updated ? new Date(r.last_updated) : new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (Number(r.current_stock) !== 0) {
        await knex('stock_movements').insert({ movement_date: date, id_materials: r.id_materials, movement_type: 'OPENING', qty: r.current_stock,
          unit_cost: r.current_rate, notes: 'Opening balance carried over from the old stock summary', recorded_by: 'Migration' });
      }
      await knex('materials').where({ id_materials: r.id_materials }).update({ reorder_level: r.minimum_reorder_stock || 0, avg_cost: r.current_rate || 0 });
    }
    await knex.raw('UPDATE materials SET avg_cost = current_rate WHERE avg_cost = 0');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('stock_movements');
  await knex.schema.dropTableIfExists('work_material_requirements');
  for (const c of ['item_code', 'reorder_level', 'avg_cost', 'is_active']) {
    if (await knex.schema.hasColumn('materials', c)) await knex.schema.alterTable('materials', t => t.dropColumn(c));
  }
};
