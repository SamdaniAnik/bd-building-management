// Late payment fine rules (master), per-item waivers, and fine tracking on online payments.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('master_late_fee_rules'))) {
    await knex.schema.createTable('master_late_fee_rules', t => {
      t.increments('id_late_fee_rules').primary();
      t.string('rule_code', 50).notNullable().unique();
      t.enum('item_type', ['INSTALLMENT', 'SERVICE_CHARGE', 'HOLDING_TAX', 'UTILITY_BILL', 'OTHER']).notNullable();
      t.string('item_name_en', 150).notNullable();
      t.string('item_name_bn', 150).nullable();
      // FIXED: flat taka once · PERCENT: % of overdue once · PER_DAY_FIXED: taka per day late
      // PER_DAY_PERCENT: % of overdue per day · PER_MONTH_PERCENT: % of overdue per started 30-day month
      t.enum('fine_type', ['FIXED', 'PERCENT', 'PER_DAY_FIXED', 'PER_DAY_PERCENT', 'PER_MONTH_PERCENT']).notNullable().defaultTo('FIXED');
      t.decimal('fine_amount', 12, 2).notNullable().defaultTo(0); // taka or percent, depending on fine_type
      t.integer('grace_days').unsigned().notNullable().defaultTo(0);
      t.enum('count_from', ['DUE_DATE', 'AFTER_GRACE']).defaultTo('DUE_DATE');
      t.decimal('max_fine_bdt', 12, 2).defaultTo(0); // 0 = no cap
      t.boolean('is_active').defaultTo(true);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex('master_late_fee_rules').insert([
      { rule_code: 'LF-INSTALLMENT', item_type: 'INSTALLMENT', item_name_en: 'Instalment delay charge', item_name_bn: 'কিস্তি বিলম্ব জরিমানা', fine_type: 'PER_MONTH_PERCENT', fine_amount: 2, grace_days: 7, count_from: 'DUE_DATE', max_fine_bdt: 0, notes: '2% of the overdue amount for every started month after a 7-day grace period.' },
      { rule_code: 'LF-SERVICE-CHARGE', item_type: 'SERVICE_CHARGE', item_name_en: 'Service charge late fee', item_name_bn: 'সার্ভিস চার্জ বিলম্ব ফি', fine_type: 'FIXED', fine_amount: 100, grace_days: 10, count_from: 'DUE_DATE', max_fine_bdt: 0 },
      { rule_code: 'LF-HOLDING-TAX', item_type: 'HOLDING_TAX', item_name_en: 'Holding tax surcharge', item_name_bn: 'হোল্ডিং ট্যাক্স সারচার্জ', fine_type: 'PERCENT', fine_amount: 5, grace_days: 0, count_from: 'DUE_DATE', max_fine_bdt: 0, is_active: false, notes: 'Set to match your City Corporation\'s surcharge before switching on.' },
    ]);
  }

  if (!(await knex.schema.hasTable('late_fee_waivers'))) {
    await knex.schema.createTable('late_fee_waivers', t => {
      t.increments('id_waivers').primary();
      t.string('item_type', 30).notNullable();
      t.string('item_key', 60).notNullable(); // schedule id, service charge id, or "<holding id>:<quarter>"
      t.string('reason', 255).notNullable();
      t.decimal('fine_at_waiver_bdt', 12, 2).defaultTo(0);
      t.string('waived_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['item_type', 'item_key']);
    });
  }

  if (!(await knex.schema.hasColumn('online_payments', 'fine_bdt'))) {
    await knex.schema.alterTable('online_payments', t => {
      t.decimal('principal_bdt', 14, 2).nullable();
      t.decimal('fine_bdt', 14, 2).defaultTo(0);
      t.integer('fine_days_late').nullable();
    });
  }

  // Add the {{fine_note}} placeholder to reminder templates that are still at their original text.
  const updates = {
    INSTALLMENT_DUE: ['Tk {{amount}} is due on {{due_date}}.', 'Tk {{amount}}{{fine_note}} is due on {{due_date}}.', '{{amount}} টাকা {{due_date}}', '{{amount}} টাকা{{fine_note}} {{due_date}}'],
    SERVICE_CHARGE_DUE: ['Tk {{amount}} is due on {{due_date}}.', 'Tk {{amount}}{{fine_note}} is due on {{due_date}}.', '{{amount}} টাকা {{due_date}}', '{{amount}} টাকা{{fine_note}} {{due_date}}'],
    HOLDING_TAX_DUE: ['Tk {{amount}} is due by {{due_date}}.', 'Tk {{amount}}{{fine_note}} is due by {{due_date}}.', '{{amount}} টাকা {{due_date}}', '{{amount}} টাকা{{fine_note}} {{due_date}}'],
  };
  if (await knex.schema.hasTable('sms_templates')) {
    for (const [key, [enFrom, enTo, bnFrom, bnTo]] of Object.entries(updates)) {
      const row = await knex('sms_templates').where({ template_key: key }).first();
      if (!row || row.body_en.includes('{{fine_note}}')) continue;
      await knex('sms_templates').where({ template_key: key }).update({ body_en: row.body_en.replace(enFrom, enTo), body_bn: row.body_bn.replace(bnFrom, bnTo) });
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('online_payments', 'fine_bdt')) {
    await knex.schema.alterTable('online_payments', t => { t.dropColumn('principal_bdt'); t.dropColumn('fine_bdt'); t.dropColumn('fine_days_late'); });
  }
  await knex.schema.dropTableIfExists('late_fee_waivers');
  await knex.schema.dropTableIfExists('master_late_fee_rules');
};
