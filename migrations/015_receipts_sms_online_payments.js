// Money receipts / Mushak-6.3, SMS outbox & templates, online payments (SSLCommerz), org settings.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('org_settings'))) {
    await knex.schema.createTable('org_settings', t => {
      t.string('setting_key', 80).primary();
      t.text('setting_value').nullable();
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // Gap-free numbering per document type and fiscal year
  if (!(await knex.schema.hasTable('receipt_sequences'))) {
    await knex.schema.createTable('receipt_sequences', t => {
      t.string('doc_type', 30).notNullable();
      t.string('fiscal_year', 20).notNullable();
      t.integer('last_no').unsigned().notNullable().defaultTo(0);
      t.primary(['doc_type', 'fiscal_year']);
    });
  }

  if (!(await knex.schema.hasTable('money_receipts'))) {
    await knex.schema.createTable('money_receipts', t => {
      t.increments('id_receipts').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('receipt_no', 50).notNullable().unique();
      t.enum('doc_type', ['MONEY_RECEIPT', 'MUSHAK_6_3']).defaultTo('MONEY_RECEIPT');
      t.string('fiscal_year', 20).notNullable();
      t.dateTime('issue_datetime').notNullable();
      t.integer('id_owners').unsigned().nullable();
      t.string('unit_number', 50).nullable();
      t.string('received_from', 200).notNullable();
      t.string('phone', 20).nullable();
      t.text('address').nullable();
      t.string('buyer_bin', 50).nullable();
      t.json('line_items_json').notNullable(); // [{description, uom, qty, unit_price, value, sd_rate, sd, vat_rate, vat, total}]
      t.decimal('subtotal_bdt', 16, 2).defaultTo(0);
      t.decimal('sd_total_bdt', 14, 2).defaultTo(0);
      t.decimal('vat_total_bdt', 14, 2).defaultTo(0);
      t.decimal('total_bdt', 16, 2).notNullable();
      t.string('amount_words_en', 500).nullable();
      t.string('amount_words_bn', 500).nullable();
      t.string('payment_method', 50).defaultTo('CASH');
      t.string('payment_ref', 120).nullable();
      t.string('source_type', 40).defaultTo('MANUAL'); // OWNER_CONTRIBUTION | MFS | ONLINE_PAYMENT | MANUAL
      t.integer('source_id').unsigned().nullable();
      t.string('issued_by', 150).nullable();
      t.enum('status', ['ISSUED', 'CANCELLED']).defaultTo('ISSUED');
      t.string('cancel_reason', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['source_type', 'source_id', 'doc_type'], 'uq_receipt_source');
    });
  }

  if (!(await knex.schema.hasTable('sms_templates'))) {
    await knex.schema.createTable('sms_templates', t => {
      t.string('template_key', 50).primary();
      t.string('name', 150).notNullable();
      t.text('body_en').notNullable();
      t.text('body_bn').notNullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('sms_outbox'))) {
    await knex.schema.createTable('sms_outbox', t => {
      t.increments('id_sms').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('to_number', 20).notNullable();
      t.string('recipient_name', 200).nullable();
      t.text('message').notNullable();
      t.string('template_key', 50).nullable();
      t.enum('encoding', ['GSM', 'UNICODE']).defaultTo('GSM');
      t.integer('segments').defaultTo(1);
      t.string('provider', 30).notNullable();
      t.enum('status', ['SENT', 'FAILED', 'SIMULATED']).notNullable();
      t.text('provider_response').nullable();
      t.string('related_type', 40).nullable(); // SCHEDULE | SERVICE_CHARGE | HOLDING_TAX_Q | RECEIPT | MANUAL
      t.string('related_key', 80).nullable();
      t.string('created_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['related_type', 'related_key']);
    });
  }

  if (!(await knex.schema.hasTable('online_payments'))) {
    await knex.schema.createTable('online_payments', t => {
      t.increments('id_online_payments').primary();
      t.string('tran_id', 60).notNullable().unique();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_owners').unsigned().notNullable();
      t.integer('id_units').unsigned().nullable();
      t.integer('id_schedules').unsigned().nullable();
      t.string('purpose', 200).notNullable();
      t.decimal('amount_bdt', 14, 2).notNullable();
      t.string('currency', 5).defaultTo('BDT');
      t.enum('gateway', ['SSLCOMMERZ', 'MOCK']).notNullable();
      t.enum('status', ['INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'AMOUNT_MISMATCH']).defaultTo('INITIATED');
      t.string('session_key', 120).nullable();
      t.string('val_id', 120).nullable();
      t.string('bank_tran_id', 120).nullable();
      t.string('card_type', 80).nullable(); // e.g. BKASH-BKash, NAGAD-Nagad, VISA-Dutch Bangla
      t.json('gateway_response_json').nullable();
      t.integer('id_contributions').unsigned().nullable();
      t.integer('id_receipts').unsigned().nullable();
      t.string('initiated_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.dateTime('paid_at').nullable();
    });
  }
};

exports.down = async function (knex) {
  for (const tbl of ['online_payments', 'sms_outbox', 'sms_templates', 'money_receipts', 'receipt_sequences', 'org_settings']) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
