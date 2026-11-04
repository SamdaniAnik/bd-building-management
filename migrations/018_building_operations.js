// Building operations after handover:
//   1. Tenants (DMP tenant information form fields), rent agreements, monthly rent invoices & payments
//   2. Monthly service charge billing runs with per-head bill lines (bills land in the existing service_charges table)
//   3. Building staff (guards, caretaker, cleaners…), attendance, salary advances and payslips with festival bonus
//   4. Gate visitor log, parking slots, and a notice board with SMS broadcast

exports.up = async function (knex) {
  // ── 1. Tenants & rent ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tenants'))) {
    await knex.schema.createTable('tenants', t => {
      t.increments('id_tenants').primary();
      t.integer('id_units').unsigned().notNullable().index();
      t.string('full_name', 150).notNullable();
      t.string('father_name', 150).nullable();
      t.date('date_of_birth').nullable();
      t.enum('marital_status', ['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED']).nullable();
      t.text('permanent_address').nullable();
      t.string('occupation', 150).nullable();
      t.string('workplace_address', 255).nullable();
      t.string('religion', 50).nullable();
      t.string('education', 100).nullable();
      t.string('phone', 20).notNullable();
      t.string('email', 150).nullable();
      t.string('nid_no', 30).nullable();
      t.string('passport_no', 30).nullable();
      t.string('emergency_name', 150).nullable();
      t.string('emergency_relation', 50).nullable();
      t.string('emergency_phone', 20).nullable();
      t.string('emergency_address', 255).nullable();
      t.json('family_members').nullable();   // [{ name, age, occupation, phone, relation }]
      t.json('domestic_helpers').nullable(); // [{ name, nid_no, phone, permanent_address }]
      t.json('drivers').nullable();          // [{ name, nid_no, phone, permanent_address }]
      t.string('prev_landlord_name', 150).nullable();
      t.string('prev_landlord_phone', 20).nullable();
      t.string('prev_address', 255).nullable();
      t.string('reason_for_leaving_prev', 255).nullable();
      t.date('move_in_date').nullable();
      t.date('move_out_date').nullable();
      t.enum('status', ['ACTIVE', 'LEFT']).notNullable().defaultTo('ACTIVE');
      t.boolean('police_form_submitted').defaultTo(false);
      t.date('police_form_date').nullable();
      t.string('police_station', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  if (!(await knex.schema.hasTable('rent_agreements'))) {
    await knex.schema.createTable('rent_agreements', t => {
      t.increments('id_rent_agreements').primary();
      t.integer('id_tenants').unsigned().notNullable().index();
      t.integer('id_units').unsigned().notNullable().index();
      t.integer('id_owners').unsigned().nullable(); // landlord
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.decimal('monthly_rent_bdt', 12, 2).notNullable();
      t.decimal('other_monthly_bdt', 12, 2).defaultTo(0); // gas/water/service charge collected with rent
      t.string('other_monthly_label', 150).nullable();
      t.decimal('advance_deposit_bdt', 12, 2).defaultTo(0);
      t.integer('due_day').unsigned().defaultTo(5); // rent due on this day of each month
      t.decimal('annual_increase_percent', 5, 2).defaultTo(0);
      t.integer('notice_period_months').unsigned().defaultTo(2);
      t.enum('status', ['ACTIVE', 'ENDED']).notNullable().defaultTo('ACTIVE');
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('rent_invoices'))) {
    await knex.schema.createTable('rent_invoices', t => {
      t.increments('id_rent_invoices').primary();
      t.integer('id_rent_agreements').unsigned().notNullable();
      t.string('billing_month', 7).notNullable(); // YYYY-MM
      t.decimal('rent_bdt', 12, 2).notNullable();
      t.decimal('other_bdt', 12, 2).defaultTo(0);
      t.decimal('total_bdt', 12, 2).notNullable();
      t.decimal('amount_paid', 12, 2).defaultTo(0);
      t.date('due_date').notNullable();
      t.enum('status', ['UNPAID', 'PARTIAL', 'PAID']).notNullable().defaultTo('UNPAID');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['id_rent_agreements', 'billing_month']);
    });
  }

  if (!(await knex.schema.hasTable('rent_payments'))) {
    await knex.schema.createTable('rent_payments', t => {
      t.increments('id_rent_payments').primary();
      t.integer('id_rent_invoices').unsigned().notNullable().index();
      t.decimal('amount_bdt', 12, 2).notNullable();
      t.date('paid_on').notNullable();
      t.string('payment_method', 30).defaultTo('CASH');
      t.string('reference', 100).nullable();
      t.integer('id_receipts').unsigned().nullable();
      t.string('received_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // ── 2. Service charge billing ─────────────────────────────────────
  if (!(await knex.schema.hasTable('service_charge_runs'))) {
    await knex.schema.createTable('service_charge_runs', t => {
      t.increments('id_runs').primary();
      t.string('billing_month', 7).notNullable().unique(); // YYYY-MM
      t.date('due_date').notNullable();
      t.integer('bill_count').unsigned().defaultTo(0);
      t.decimal('total_bdt', 14, 2).defaultTo(0);
      t.json('heads_json').nullable();       // rates used for each head
      t.json('shared_costs_json').nullable(); // pooled bills split across flats
      t.string('unit_statuses', 200).nullable();
      t.string('generated_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasColumn('service_charges', 'id_runs'))) {
    await knex.schema.alterTable('service_charges', t => {
      t.integer('id_runs').unsigned().nullable().index();
    });
  }

  if (!(await knex.schema.hasTable('service_charge_lines'))) {
    await knex.schema.createTable('service_charge_lines', t => {
      t.increments('id_lines').primary();
      t.integer('id_service_charges').unsigned().notNullable().index();
      t.integer('id_charge_heads').unsigned().nullable();
      t.string('description', 200).notNullable();
      t.string('basis', 40).nullable(); // FLAT_EQUAL | SFT_PROPORTIONAL | METER_CONSUMPTION | FIXED | SHARED_EQUAL | SHARED_SFT
      t.decimal('quantity', 12, 2).nullable(); // sft or meter units, when relevant
      t.decimal('rate_bdt', 12, 4).nullable();
      t.decimal('amount_bdt', 12, 2).notNullable();
    });
  }

  if (!(await knex.schema.hasTable('service_charge_payments'))) {
    await knex.schema.createTable('service_charge_payments', t => {
      t.increments('id_sc_payments').primary();
      t.integer('id_service_charges').unsigned().notNullable().index();
      t.decimal('amount_bdt', 12, 2).notNullable(); // towards the bill
      t.decimal('fine_bdt', 12, 2).defaultTo(0);     // late fine collected on top
      t.date('paid_on').notNullable();
      t.string('payment_method', 30).defaultTo('CASH');
      t.string('reference', 100).nullable();
      t.integer('id_receipts').unsigned().nullable();
      t.string('received_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // ── 3. Building staff & payroll ───────────────────────────────────
  if (!(await knex.schema.hasTable('building_staff'))) {
    await knex.schema.createTable('building_staff', t => {
      t.increments('id_staff').primary();
      t.string('full_name', 150).notNullable();
      t.enum('role', ['GUARD', 'CARETAKER', 'CLEANER', 'LIFT_OPERATOR', 'ELECTRICIAN', 'PLUMBER', 'GARDENER', 'DRIVER', 'MANAGER', 'OTHER']).notNullable().defaultTo('GUARD');
      t.enum('shift', ['DAY', 'NIGHT', 'ROTATING', 'GENERAL']).defaultTo('GENERAL');
      t.string('phone', 20).nullable();
      t.string('nid_no', 30).nullable();
      t.text('permanent_address').nullable();
      t.string('emergency_contact', 150).nullable();
      t.date('join_date').nullable();
      t.decimal('monthly_salary_bdt', 12, 2).notNullable().defaultTo(0);
      t.string('payment_method', 30).defaultTo('CASH'); // CASH | BKASH | NAGAD | BANK
      t.string('wallet_or_account', 50).nullable();
      t.string('agency_name', 150).nullable(); // when supplied by a security agency
      t.enum('status', ['ACTIVE', 'LEFT']).notNullable().defaultTo('ACTIVE');
      t.date('leave_date').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('staff_attendance'))) {
    await knex.schema.createTable('staff_attendance', t => {
      t.increments('id_staff_attendance').primary();
      t.integer('id_staff').unsigned().notNullable();
      t.date('att_date').notNullable();
      t.enum('status', ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY']).notNullable().defaultTo('PRESENT');
      t.decimal('overtime_hours', 5, 2).defaultTo(0);
      t.string('note', 200).nullable();
      t.unique(['id_staff', 'att_date']);
    });
  }

  if (!(await knex.schema.hasTable('staff_advances'))) {
    await knex.schema.createTable('staff_advances', t => {
      t.increments('id_staff_advances').primary();
      t.integer('id_staff').unsigned().notNullable().index();
      t.decimal('amount_bdt', 12, 2).notNullable();
      t.date('given_on').notNullable();
      t.decimal('monthly_recovery_bdt', 12, 2).defaultTo(0); // 0 = recover in full next payslip
      t.decimal('recovered_bdt', 12, 2).defaultTo(0);
      t.string('reason', 200).nullable();
      t.enum('status', ['OPEN', 'SETTLED']).notNullable().defaultTo('OPEN');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('staff_payslips'))) {
    await knex.schema.createTable('staff_payslips', t => {
      t.increments('id_payslips').primary();
      t.integer('id_staff').unsigned().notNullable();
      t.string('salary_month', 7).notNullable(); // YYYY-MM
      t.decimal('basic_bdt', 12, 2).notNullable();
      t.integer('days_in_month').unsigned().notNullable();
      t.decimal('unpaid_days', 5, 1).defaultTo(0);
      t.decimal('absence_deduction_bdt', 12, 2).defaultTo(0);
      t.decimal('overtime_hours', 6, 2).defaultTo(0);
      t.decimal('overtime_bdt', 12, 2).defaultTo(0);
      t.decimal('bonus_bdt', 12, 2).defaultTo(0);
      t.string('bonus_label', 100).nullable(); // e.g. Eid-ul-Fitr bonus
      t.decimal('advance_recovery_bdt', 12, 2).defaultTo(0);
      t.decimal('other_deduction_bdt', 12, 2).defaultTo(0);
      t.decimal('net_pay_bdt', 12, 2).notNullable();
      t.enum('status', ['DRAFT', 'PAID']).notNullable().defaultTo('DRAFT');
      t.date('paid_on').nullable();
      t.string('payment_method', 30).nullable();
      t.string('payment_ref', 100).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['id_staff', 'salary_month']);
    });
  }

  // ── 4. Gate, parking & notices ────────────────────────────────────
  if (!(await knex.schema.hasTable('visitor_logs'))) {
    await knex.schema.createTable('visitor_logs', t => {
      t.increments('id_visitors').primary();
      t.string('visitor_name', 150).notNullable();
      t.string('phone', 20).nullable();
      t.enum('purpose', ['GUEST', 'DELIVERY', 'RIDE_SHARE', 'SERVICE', 'OFFICIAL', 'DOMESTIC_HELP', 'OTHER']).notNullable().defaultTo('GUEST');
      t.integer('id_units').unsigned().nullable().index();
      t.string('host_name', 150).nullable(); // resident who approved the visit
      t.string('company', 150).nullable();   // courier / service company
      t.string('vehicle_no', 30).nullable();
      t.integer('people_count').unsigned().defaultTo(1);
      t.string('id_card_no', 50).nullable();
      t.dateTime('check_in').notNullable();
      t.dateTime('check_out').nullable();
      t.string('guard_name', 150).nullable();
      t.string('notes', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['check_in']);
    });
  }

  if (!(await knex.schema.hasTable('parking_slots'))) {
    await knex.schema.createTable('parking_slots', t => {
      t.increments('id_parking_slots').primary();
      t.string('slot_code', 30).notNullable().unique();
      t.string('location', 100).nullable(); // Basement-1, Ground floor…
      t.enum('slot_type', ['CAR', 'MOTORBIKE', 'BICYCLE', 'VISITOR']).notNullable().defaultTo('CAR');
      t.integer('id_units').unsigned().nullable().index();
      t.string('vehicle_no', 30).nullable(); // e.g. DHAKA METRO-GA 12-3456
      t.string('vehicle_model', 100).nullable();
      t.decimal('monthly_fee_bdt', 10, 2).defaultTo(0);
      t.enum('status', ['FREE', 'ALLOCATED', 'RESERVED', 'BLOCKED']).notNullable().defaultTo('FREE');
      t.string('notes', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('notices'))) {
    await knex.schema.createTable('notices', t => {
      t.increments('id_notices').primary();
      t.string('title_en', 200).notNullable();
      t.string('title_bn', 200).nullable();
      t.text('body_en').notNullable();
      t.text('body_bn').nullable();
      t.enum('category', ['GENERAL', 'MEETING', 'MAINTENANCE', 'UTILITY_OUTAGE', 'PAYMENT', 'SECURITY', 'EMERGENCY']).notNullable().defaultTo('GENERAL');
      t.date('publish_date').notNullable();
      t.date('expiry_date').nullable();
      t.boolean('is_pinned').defaultTo(false);
      t.integer('sms_sent').unsigned().defaultTo(0);
      t.integer('sms_failed').unsigned().defaultTo(0);
      t.dateTime('sms_sent_at').nullable();
      t.string('created_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (await knex.schema.hasTable('sms_templates')) {
    await knex('sms_templates').insert([
      { template_key: 'RENT_DUE', name: 'Rent due reminder',
        body_en: 'Dear {{name}}, rent for flat {{unit}} ({{item}}) Tk {{amount}} is due on {{due_date}}. -{{org}}',
        body_bn: 'প্রিয় {{name}}, ফ্ল্যাট {{unit}}-এর {{item}} মাসের ভাড়া {{amount}} টাকা {{due_date}} তারিখের মধ্যে পরিশোধ করুন। -{{org}}' },
      { template_key: 'NOTICE', name: 'Notice board broadcast',
        body_en: '{{title}}: {{body}} -{{org}}',
        body_bn: '{{title}}: {{body}} -{{org}}' },
    ]).onConflict('template_key').ignore();
  }
};

exports.down = async function (knex) {
  for (const tbl of ['notices', 'parking_slots', 'visitor_logs', 'staff_payslips', 'staff_advances', 'staff_attendance', 'building_staff',
    'service_charge_payments', 'service_charge_lines', 'service_charge_runs', 'rent_payments', 'rent_invoices', 'rent_agreements', 'tenants']) {
    await knex.schema.dropTableIfExists(tbl);
  }
  if (await knex.schema.hasColumn('service_charges', 'id_runs')) {
    await knex.schema.alterTable('service_charges', t => { t.dropColumn('id_runs'); });
  }
  if (await knex.schema.hasTable('sms_templates')) await knex('sms_templates').whereIn('template_key', ['RENT_DUE', 'NOTICE']).del();
};
