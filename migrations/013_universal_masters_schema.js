exports.up = async function(knex) {
  // 1. Master for Common Facilities & Amenities (Mosque, Pool, Meeting Hall, Substation, Skywalks, etc.)
  if (!(await knex.schema.hasTable('master_common_facilities'))) {
    await knex.schema.createTable('master_common_facilities', t => {
      t.increments('id_common_facilities').primary();
      t.string('facility_code', 50).notNullable().unique();
      t.string('facility_name', 200).notNullable();
      t.string('category', 100).defaultTo('RECREATION_COMMUNITY'); // 'WORSHIP', 'COMMUNITY', 'WELLNESS', 'INFRASTRUCTURE', 'SECURITY'
      t.string('capacity', 100).nullable(); // '350 Musallis', '80 Persons'
      t.string('default_cost_share_rule', 100).defaultTo('SPLIT_ALL_SHARES_EQUAL');
      t.decimal('maintenance_monthly_budget_bdt', 12, 2).defaultTo(0);
      t.string('allocated_unit_number', 50).nullable(); // e.g. A-101, B-101, C-101
      t.text('description').nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Master for Labour Trades & Daily Wage Rates
  if (!(await knex.schema.hasTable('master_labour_trades'))) {
    await knex.schema.createTable('master_labour_trades', t => {
      t.increments('id_labour_trades').primary();
      t.string('trade_code', 50).notNullable().unique();
      t.string('trade_name_en', 150).notNullable();
      t.string('trade_name_bn', 150).notNullable(); // যেমন: রাজমিস্ত্রি, রডমিস্ত্রি, কাঠমিস্ত্রি
      t.decimal('standard_daily_wage_bdt', 10, 2).notNullable().defaultTo(850.00);
      t.decimal('overtime_rate_per_hour_bdt', 10, 2).notNullable().defaultTo(120.00);
      t.enum('skill_level', ['HEAD_MISTRY', 'SKILLED', 'SEMI_SKILLED', 'HELPER_JOGALI']).defaultTo('SKILLED');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Master for Utility Services & Tariffs
  if (!(await knex.schema.hasTable('master_utility_services'))) {
    await knex.schema.createTable('master_utility_services', t => {
      t.increments('id_utility_services').primary();
      t.string('service_code', 50).notNullable().unique();
      t.string('service_name', 150).notNullable();
      t.string('provider_authority', 100).defaultTo('DESCO / DPDC / WASA');
      t.string('uom', 50).defaultTo('kWh / Gallon / Hour');
      t.decimal('standard_unit_rate_bdt', 10, 2).defaultTo(9.80);
      t.decimal('monthly_demand_charge_bdt', 10, 2).defaultTo(150.00);
      t.string('connection_type', 100).defaultTo('3-Phase 400V LT / Commercial WASA');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Master for Building Service Charge Heads (Post-Handover Maintenance)
  if (!(await knex.schema.hasTable('master_service_charge_heads'))) {
    await knex.schema.createTable('master_service_charge_heads', t => {
      t.increments('id_charge_heads').primary();
      t.string('head_code', 50).notNullable().unique();
      t.string('head_name_en', 150).notNullable();
      t.string('head_name_bn', 150).notNullable();
      t.enum('calculation_basis', ['FLAT_EQUAL', 'SFT_PROPORTIONAL', 'METER_CONSUMPTION', 'FIXED']).defaultTo('FLAT_EQUAL');
      t.decimal('default_rate_bdt', 10, 2).defaultTo(1500.00);
      t.string('frequency', 50).defaultTo('Monthly (মাসিক)');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 5. Master for Bank Accounts (Company / Society Accounts)
  if (!(await knex.schema.hasTable('master_bank_accounts'))) {
    await knex.schema.createTable('master_bank_accounts', t => {
      t.increments('id_bank_accounts').primary();
      t.string('account_code', 50).notNullable().unique();
      t.string('bank_name', 150).notNullable();
      t.string('branch_name', 150).notNullable();
      t.string('account_title', 200).notNullable();
      t.string('account_number', 100).notNullable();
      t.string('routing_number', 50).nullable();
      t.enum('account_type', ['CURRENT', 'SAVINGS', 'SOCIETY_COLLECTION', 'ESCROW_JVA', 'RESERVE_FUND']).defaultTo('CURRENT');
      t.decimal('opening_balance_bdt', 14, 2).defaultTo(0);
      t.decimal('current_balance_bdt', 14, 2).defaultTo(0);
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 6. Master for Tax & VAT Withholding Rules (Real Estate Act & NBR Compliance)
  if (!(await knex.schema.hasTable('master_tax_rules'))) {
    await knex.schema.createTable('master_tax_rules', t => {
      t.increments('id_tax_rules').primary();
      t.string('rule_code', 50).notNullable().unique();
      t.string('tax_name', 150).notNullable();
      t.enum('tax_type', ['VAT_MUSHAK', 'AIT_INCOME_TAX', 'STAMP_DUTY', 'HOLDING_TAX', 'OTHER']).defaultTo('VAT_MUSHAK');
      t.decimal('tax_rate_percent', 6, 2).notNullable().defaultTo(7.50);
      t.boolean('is_withholding_mandatory').defaultTo(true);
      t.decimal('minimum_threshold_bdt', 14, 2).defaultTo(25000.00);
      t.text('nbr_statutory_reference').nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 7. Master for Handover Snag & Defect Inspection Categories
  if (!(await knex.schema.hasTable('master_snag_categories'))) {
    await knex.schema.createTable('master_snag_categories', t => {
      t.increments('id_snag_cat').primary();
      t.string('category_code', 50).notNullable().unique();
      t.string('category_name_en', 150).notNullable();
      t.string('category_name_bn', 150).notNullable();
      t.string('default_remedy_sla_days', 50).defaultTo('7 Days');
      t.string('trade_responsible', 100).defaultTo('Finishing Contractor');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
};
