// Bangladesh community features:
// 1. Licence / certificate renewals register (lift, fire, trade licence, generator, insurance…) with SMS reminders.
// 2. Reserve (sinking) fund ledger; a service-charge head can be flagged as the fund's monthly contribution.
// 3. Owners' association: meetings (AGM / EGM / committee), attendance & quorum, minutes, committee members.
// 4. Vendor tax IDs (e-TIN, BIN, trade licence) and the higher source-tax rate when a vendor has no TIN.
// 5. WhatsApp as a second notification channel (sms_outbox.channel).
// 6. Recurring upkeep schedule (water tank cleaning, pump service, pre-monsoon roof drains…) with a work log.
// 7. Tenant ID documents (NID front/back, photo) stored with the tenant record.

exports.up = async function (knex) {
  // ── 1. Renewals ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('compliance_renewals'))) {
    await knex.schema.createTable('compliance_renewals', t => {
      t.increments('id_renewals').primary();
      t.string('item_type', 30).notNullable().defaultTo('OTHER'); // LIFT_LICENSE | FIRE_LICENSE | TRADE_LICENSE | GENERATOR | INSURANCE | ...
      t.string('title', 200).notNullable();
      t.string('authority', 150).nullable();          // "DIFE", "Fire Service & Civil Defence", "DNCC"…
      t.string('reference_no', 100).nullable();
      t.date('issue_date').nullable();
      t.date('expiry_date').notNullable().index();
      t.integer('remind_days').unsigned().notNullable().defaultTo(30); // first reminder this many days before expiry
      t.decimal('renewal_fee_bdt', 12, 2).defaultTo(0);
      t.string('responsible_name', 150).nullable();
      t.string('responsible_phone', 20).nullable();
      t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE | ARCHIVED
      t.text('notes').nullable();
      t.string('created_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').nullable();
    });
  }
  // One row per reminder sent, so a stage (30 / 15 / 7 / 0 days) is never texted twice for the same due date.
  if (!(await knex.schema.hasTable('due_reminders_sent'))) {
    await knex.schema.createTable('due_reminders_sent', t => {
      t.increments('id').primary();
      t.string('source', 20).notNullable();  // RENEWAL | APPROVAL | FIRE | UPKEEP
      t.integer('source_id').unsigned().notNullable();
      t.date('due_date').notNullable();
      t.integer('stage').notNullable();      // days before due (negative = overdue)
      t.timestamp('sent_at').defaultTo(knex.fn.now());
      t.unique(['source', 'source_id', 'due_date', 'stage']);
    });
  }

  // ── 2. Reserve fund ───────────────────────────────────────────────
  if (!(await knex.schema.hasTable('reserve_fund_entries'))) {
    await knex.schema.createTable('reserve_fund_entries', t => {
      t.increments('id_reserve_entries').primary();
      t.date('entry_date').notNullable().index();
      t.string('entry_type', 20).notNullable(); // OPENING | CONTRIBUTION | INTEREST | WITHDRAWAL | ADJUSTMENT
      t.decimal('amount_bdt', 14, 2).notNullable(); // signed: withdrawals are stored negative
      t.integer('id_units').unsigned().nullable();
      t.integer('id_proposals').unsigned().nullable(); // committee approval for a withdrawal
      t.string('purpose', 255).nullable();
      t.string('payment_method', 30).nullable();
      t.string('reference', 100).nullable();
      t.text('notes').nullable();
      t.string('recorded_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasColumn('master_service_charge_heads', 'is_reserve_fund'))) {
    await knex.schema.alterTable('master_service_charge_heads', t => { t.boolean('is_reserve_fund').notNullable().defaultTo(false); });
  }

  // ── 3. Owners' association ────────────────────────────────────────
  if (!(await knex.schema.hasTable('association_meetings'))) {
    await knex.schema.createTable('association_meetings', t => {
      t.increments('id_meetings').primary();
      t.string('meeting_type', 20).notNullable().defaultTo('AGM'); // AGM | EGM | COMMITTEE
      t.string('title', 200).notNullable();
      t.dateTime('meeting_at').notNullable();
      t.string('venue', 200).nullable();
      t.text('agenda').nullable();                 // one item per line
      t.decimal('quorum_percent', 5, 2).notNullable().defaultTo(50);
      t.string('status', 20).notNullable().defaultTo('SCHEDULED'); // SCHEDULED | HELD | ADJOURNED | CANCELLED
      t.string('chaired_by', 150).nullable();
      t.text('minutes').nullable();
      t.json('resolutions').nullable();            // [{ text, result: PASSED|REJECTED|DEFERRED }]
      t.timestamp('notice_sent_at').nullable();
      t.string('created_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('meeting_attendance'))) {
    await knex.schema.createTable('meeting_attendance', t => {
      t.increments('id').primary();
      t.integer('id_meetings').unsigned().notNullable().index();
      t.integer('id_owners').unsigned().notNullable();
      t.string('attended_as', 20).notNullable().defaultTo('IN_PERSON'); // IN_PERSON | PROXY
      t.string('proxy_name', 150).nullable();
      t.unique(['id_meetings', 'id_owners']);
    });
  }
  if (!(await knex.schema.hasTable('committee_members'))) {
    await knex.schema.createTable('committee_members', t => {
      t.increments('id_committee').primary();
      t.integer('id_owners').unsigned().nullable();
      t.string('member_name', 150).notNullable();
      t.string('phone', 20).nullable();
      t.string('position', 30).notNullable().defaultTo('MEMBER'); // PRESIDENT | VICE_PRESIDENT | GENERAL_SECRETARY | JOINT_SECRETARY | TREASURER | MEMBER
      t.date('term_start').notNullable();
      t.date('term_end').nullable();
      t.integer('id_meetings').unsigned().nullable(); // elected at
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // ── 4. Vendor tax IDs ─────────────────────────────────────────────
  const vendorCols = {
    tin_no: t => t.string('tin_no', 20).nullable(),
    bin_no: t => t.string('bin_no', 20).nullable(),
    trade_license_no: t => t.string('trade_license_no', 60).nullable(),
    trade_license_expiry: t => t.date('trade_license_expiry').nullable(),
  };
  for (const [name, add] of Object.entries(vendorCols)) {
    if (!(await knex.schema.hasColumn('vendors', name))) await knex.schema.alterTable('vendors', add);
  }
  if (!(await knex.schema.hasColumn('tax_withholding_register', 'no_tin_uplift'))) {
    await knex.schema.alterTable('tax_withholding_register', t => { t.boolean('no_tin_uplift').notNullable().defaultTo(false); });
  }

  // ── 5. WhatsApp channel ───────────────────────────────────────────
  if (!(await knex.schema.hasColumn('sms_outbox', 'channel'))) {
    await knex.schema.alterTable('sms_outbox', t => { t.string('channel', 10).notNullable().defaultTo('SMS'); });
  }

  // ── 6. Upkeep schedule ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('upkeep_tasks'))) {
    await knex.schema.createTable('upkeep_tasks', t => {
      t.increments('id_upkeep_tasks').primary();
      t.string('task_key', 40).nullable().unique(); // set for the built-in tasks
      t.string('title_en', 200).notNullable();
      t.string('title_bn', 200).nullable();
      t.string('category', 30).notNullable().defaultTo('OTHER');
      t.integer('frequency_days').unsigned().notNullable().defaultTo(90);
      t.integer('season_month').unsigned().nullable(); // yearly tasks pinned to a month (e.g. 4 = before monsoon)
      t.date('last_done_on').nullable();
      t.date('next_due_on').nullable().index();
      t.integer('id_staff').unsigned().nullable();
      t.string('vendor_name', 150).nullable();
      t.decimal('est_cost_bdt', 12, 2).defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('upkeep_logs'))) {
    await knex.schema.createTable('upkeep_logs', t => {
      t.increments('id_upkeep_logs').primary();
      t.integer('id_upkeep_tasks').unsigned().notNullable().index();
      t.date('done_on').notNullable();
      t.string('done_by', 150).nullable();
      t.decimal('cost_bdt', 12, 2).defaultTo(0);
      t.text('notes').nullable();
      t.string('recorded_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // ── 7. Tenant documents ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('tenant_documents'))) {
    await knex.schema.createTable('tenant_documents', t => {
      t.increments('id_tenant_documents').primary();
      t.integer('id_tenants').unsigned().notNullable().index();
      t.string('doc_type', 20).notNullable(); // NID_FRONT | NID_BACK | PHOTO | PASSPORT | OTHER
      t.string('mime', 50).notNullable();
      t.specificType('data', 'MEDIUMTEXT').notNullable(); // base64 data URL, resized in the browser
      t.integer('size_bytes').unsigned().notNullable();
      t.string('uploaded_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  for (const tbl of ['tenant_documents', 'upkeep_logs', 'upkeep_tasks', 'committee_members', 'meeting_attendance', 'association_meetings',
    'reserve_fund_entries', 'due_reminders_sent', 'compliance_renewals']) await knex.schema.dropTableIfExists(tbl);
  const drop = async (tbl, col) => { if (await knex.schema.hasColumn(tbl, col)) await knex.schema.alterTable(tbl, t => t.dropColumn(col)); };
  await drop('master_service_charge_heads', 'is_reserve_fund');
  for (const c of ['tin_no', 'bin_no', 'trade_license_no', 'trade_license_expiry']) await drop('vendors', c);
  await drop('tax_withholding_register', 'no_tin_uplift');
  await drop('sms_outbox', 'channel');
};
