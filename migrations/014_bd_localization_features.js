// Bangladesh-specific operational features:
// flat registration cost estimates, MFS (bKash/Nagad/Rocket/Upay) payments,
// TDS/VDS withholding register, construction material market rates,
// work calendar (holidays / hartal / monsoon) and City Corporation holding tax.

exports.up = async function (knex) {
  // 1. Flat deed registration cost estimates (buyer-side transfer costs)
  if (!(await knex.schema.hasTable('flat_registration_estimates'))) {
    await knex.schema.createTable('flat_registration_estimates', t => {
      t.increments('id_reg_estimates').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_units').unsigned().nullable();
      t.string('unit_number', 50).nullable();
      t.string('buyer_name', 200).notNullable();
      t.string('buyer_nid', 50).nullable();
      t.string('buyer_tin', 50).nullable();
      t.decimal('flat_area_sft', 10, 2).notNullable();
      t.decimal('deed_value_bdt', 16, 2).notNullable();
      t.decimal('mouza_rate_value_bdt', 16, 2).defaultTo(0); // govt. minimum (mouza) value
      t.enum('location_zone', ['ZONE_A_DHAKA_CTG', 'ZONE_B_OTHER_CITY', 'ZONE_C_OTHER']).defaultTo('ZONE_A_DHAKA_CTG');
      t.boolean('is_city_corporation').defaultTo(true);
      t.boolean('include_vat').defaultTo(true);
      t.json('rates_json').nullable();      // rates used for this estimate
      t.json('breakdown_json').nullable();  // computed lines
      t.decimal('total_cost_bdt', 16, 2).defaultTo(0);
      t.string('sub_registry_office', 150).nullable();
      t.date('planned_registration_date').nullable();
      t.enum('status', ['ESTIMATE', 'PAY_ORDER_READY', 'REGISTERED', 'MUTATION_DONE']).defaultTo('ESTIMATE');
      t.string('deed_no', 100).nullable();
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Mobile Financial Services transactions
  if (!(await knex.schema.hasTable('mfs_transactions'))) {
    await knex.schema.createTable('mfs_transactions', t => {
      t.increments('id_mfs').primary();
      t.integer('id_projects').unsigned().nullable();
      t.enum('provider', ['BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'TAP']).notNullable();
      t.string('trx_id', 50).notNullable().unique();
      t.enum('direction', ['RECEIVED', 'SENT']).defaultTo('RECEIVED');
      t.enum('purpose', ['INSTALLMENT', 'SERVICE_CHARGE', 'UTILITY_BILL', 'VENDOR_PAYMENT', 'LABOUR_WAGE', 'OTHER']).defaultTo('INSTALLMENT');
      t.string('counterparty_name', 200).notNullable();
      t.string('counterparty_wallet', 20).notNullable(); // 01XXXXXXXXX
      t.string('our_wallet', 20).nullable();
      t.string('unit_number', 50).nullable();
      t.decimal('amount_bdt', 14, 2).notNullable();
      t.decimal('fee_bdt', 10, 2).defaultTo(0);
      t.decimal('net_amount_bdt', 14, 2).defaultTo(0);
      t.dateTime('trx_datetime').notNullable();
      t.enum('status', ['PENDING_VERIFY', 'VERIFIED', 'REJECTED']).defaultTo('PENDING_VERIFY');
      t.string('verified_by', 150).nullable();
      t.dateTime('verified_at').nullable();
      t.string('reference_voucher_no', 100).nullable();
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Source tax (TDS / AIT) and VAT deduction at source (VDS) register
  if (!(await knex.schema.hasTable('tax_withholding_register'))) {
    await knex.schema.createTable('tax_withholding_register', t => {
      t.increments('id_withholding').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_vendors').unsigned().nullable();
      t.string('vendor_name', 200).notNullable();
      t.string('vendor_bin', 50).nullable(); // VAT BIN
      t.string('vendor_tin', 50).nullable();
      t.string('bill_no', 100).nullable();
      t.date('bill_date').notNullable();
      t.string('fiscal_year', 20).notNullable(); // e.g. 2026-27 (July–June)
      t.enum('service_category', ['CONSTRUCTION_CONTRACT', 'SUPPLY_OF_GOODS', 'PROFESSIONAL_SERVICE', 'TRANSPORT', 'RENT', 'OTHER']).defaultTo('SUPPLY_OF_GOODS');
      t.decimal('gross_amount_bdt', 16, 2).notNullable();
      t.decimal('tds_rate_percent', 6, 2).defaultTo(0);
      t.decimal('tds_amount_bdt', 14, 2).defaultTo(0);
      t.decimal('vds_rate_percent', 6, 2).defaultTo(0);
      t.decimal('vds_amount_bdt', 14, 2).defaultTo(0);
      t.decimal('net_payable_bdt', 16, 2).defaultTo(0);
      t.string('tds_challan_no', 100).nullable();
      t.string('vds_challan_no', 100).nullable();
      t.date('challan_date').nullable();
      t.string('mushak_6_6_no', 100).nullable(); // VDS certificate
      t.enum('status', ['DEDUCTED', 'DEPOSITED_TREASURY', 'CERTIFICATE_ISSUED']).defaultTo('DEDUCTED');
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Construction material market rate tracker
  if (!(await knex.schema.hasTable('material_market_rates'))) {
    await knex.schema.createTable('material_market_rates', t => {
      t.increments('id_market_rates').primary();
      t.string('material_key', 60).notNullable(); // ROD_60G, CEMENT_PCC, BRICK_1ST ...
      t.string('material_name_en', 150).notNullable();
      t.string('material_name_bn', 150).nullable();
      t.string('brand', 100).nullable();
      t.string('uom', 30).notNullable(); // Ton, Bag (50kg), 1000 pcs, CFT
      t.decimal('rate_bdt', 12, 2).notNullable();
      t.string('market_location', 150).defaultTo('Dhaka');
      t.date('rate_date').notNullable();
      t.string('source', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['material_key', 'rate_date']);
    });
  }

  // 5. Work calendar: holidays, hartal / blockade, monsoon stoppage
  if (!(await knex.schema.hasTable('bd_work_calendar'))) {
    await knex.schema.createTable('bd_work_calendar', t => {
      t.increments('id_calendar').primary();
      t.integer('id_projects').unsigned().nullable();
      t.date('start_date').notNullable();
      t.date('end_date').notNullable();
      t.string('title_en', 200).notNullable();
      t.string('title_bn', 200).nullable();
      t.enum('event_type', ['PUBLIC_HOLIDAY', 'RELIGIOUS_FESTIVAL', 'HARTAL_BLOCKADE', 'WEATHER_MONSOON', 'SITE_SHUTDOWN', 'OTHER']).defaultTo('PUBLIC_HOLIDAY');
      t.enum('work_impact', ['FULL_STOP', 'PARTIAL', 'NONE']).defaultTo('FULL_STOP');
      t.boolean('festival_bonus_due').defaultTo(false);
      t.decimal('bonus_amount_per_worker_bdt', 10, 2).defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 6. City Corporation / Pourashava holding tax register
  if (!(await knex.schema.hasTable('holding_tax_register'))) {
    await knex.schema.createTable('holding_tax_register', t => {
      t.increments('id_holding_tax').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_units').unsigned().nullable();
      t.string('unit_number', 50).notNullable();
      t.string('owner_name', 200).notNullable();
      t.enum('authority', ['DNCC', 'DSCC', 'CCC', 'GCC', 'NCC', 'KCC', 'RCC', 'SCC', 'POURASHAVA', 'OTHER']).defaultTo('DNCC');
      t.string('holding_no', 100).notNullable();
      t.string('ward_no', 20).nullable();
      t.string('fiscal_year', 20).notNullable();
      t.decimal('annual_valuation_bdt', 14, 2).notNullable();
      t.decimal('tax_rate_percent', 6, 2).defaultTo(12.00); // holding + conservancy + lighting combined
      t.decimal('annual_tax_bdt', 14, 2).defaultTo(0);
      t.decimal('rebate_percent', 6, 2).defaultTo(0);
      t.decimal('paid_bdt', 14, 2).defaultTo(0);
      t.decimal('due_bdt', 14, 2).defaultTo(0);
      t.json('quarters_json').nullable(); // [{"q":1,"amount":..,"paid":true,"receipt":".."}]
      t.enum('status', ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE']).defaultTo('UNPAID');
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['unit_number', 'fiscal_year', 'id_projects']);
    });
  }
};

exports.down = async function (knex) {
  for (const tbl of ['holding_tax_register', 'bd_work_calendar', 'material_market_rates', 'tax_withholding_register', 'mfs_transactions', 'flat_registration_estimates']) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
