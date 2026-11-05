// Flat & share transfer (ফ্ল্যাট / শেয়ার হস্তান্তর).
//
// A transfer moves all or part of a flat's ownership (its share %) from one or more owners to one or more
// people — by sale, gift (হেবা), inheritance (উত্তরাধিকার), transfer of a booking before registration, or a
// rearrangement between co-owners. unit_ownerships stays the CURRENT register; every change made by a
// transfer is kept here with the percentages before and after.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('ownership_transfers'))) {
    await knex.schema.createTable('ownership_transfers', t => {
      t.increments('id_transfers').primary();
      t.string('transfer_no', 20).notNullable().unique();        // TR-2026-0001
      t.integer('id_units').unsigned().notNullable().index();
      t.string('transfer_type', 20).notNullable();                 // SALE | GIFT | INHERITANCE | BOOKING | INTERNAL
      t.string('status', 20).notNullable().defaultTo('DRAFT');    // DRAFT | APPROVED | COMPLETED | CANCELLED
      t.date('application_date').notNullable();
      t.date('effective_date').nullable();                         // ownership changes on this date
      t.decimal('consideration_bdt', 16, 2).defaultTo(0);          // sale price
      // Registration (sale / gift deed) and mutation
      t.string('deed_no', 60).nullable();
      t.date('deed_date').nullable();
      t.string('sub_registry_office', 150).nullable();
      t.decimal('deed_value_bdt', 16, 2).nullable();
      t.string('mutation_no', 60).nullable();                      // নামজারি / DCR
      t.date('mutation_date').nullable();
      t.string('succession_cert_no', 100).nullable();              // ওয়ারিশ সনদ / succession certificate
      t.string('bank_release_ref', 100).nullable();                // bank NOC when the flat had a home loan
      // Transfer fee and dues clearance
      t.decimal('transfer_fee_bdt', 12, 2).defaultTo(0);
      t.boolean('fee_waived').notNullable().defaultTo(false);
      t.integer('id_receipts').unsigned().nullable();
      t.json('dues_snapshot').nullable();                          // clearance check at approval
      t.string('dues_override_reason', 500).nullable();            // approved with dues outstanding (e.g. buyer takes them over)
      // What moves with the flat on completion
      t.boolean('move_instalments').notNullable().defaultTo(false);
      t.boolean('move_rent_agreements').notNullable().defaultTo(true);
      t.text('notes').nullable();
      t.string('created_by', 150).nullable();
      t.string('approved_by', 150).nullable();
      t.timestamp('approved_at').nullable();
      t.string('completed_by', 150).nullable();
      t.timestamp('completed_at').nullable();
      t.string('cancel_reason', 500).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('ownership_transfer_parties'))) {
    await knex.schema.createTable('ownership_transfer_parties', t => {
      t.increments('id').primary();
      t.integer('id_transfers').unsigned().notNullable().index();
      t.string('side', 4).notNullable();                 // FROM | TO
      t.integer('id_owners').unsigned().notNullable();
      t.decimal('percent', 6, 2).notNullable();          // share given (FROM) or received (TO)
      t.decimal('before_percent', 6, 2).nullable();      // filled on completion
      t.decimal('after_percent', 6, 2).nullable();
      t.string('relation', 60).nullable();               // heir's relation to the deceased, etc.
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ownership_transfer_parties');
  await knex.schema.dropTableIfExists('ownership_transfers');
};
