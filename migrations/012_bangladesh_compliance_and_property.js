exports.up = async function(knex) {
  // 1. Land Parcels & Ownership Information
  if (!(await knex.schema.hasTable('land_parcels'))) {
    await knex.schema.createTable('land_parcels', t => {
      t.increments('id_land_parcels').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('mouza', 150).notNullable();
      t.string('jl_no', 50).notNullable();
      t.string('cs_khatian', 50).nullable();
      t.string('sa_khatian', 50).nullable();
      t.string('rs_khatian', 50).nullable();
      t.string('bs_khatian', 50).nullable();
      t.string('dag_no', 100).notNullable();
      t.decimal('area_katha', 10, 4).notNullable();
      t.decimal('area_decimal', 10, 4).nullable();
      t.decimal('area_sqft', 14, 2).notNullable();
      t.string('land_type', 100).defaultTo('Nal / Viti (নাল/ভিটি)');
      t.string('district', 100).defaultTo('Dhaka');
      t.string('upazila', 100).defaultTo('Uttara / Mirpur');
      t.string('deed_no', 100).nullable();
      t.date('deed_date').nullable();
      t.string('previous_owner', 200).nullable();
      t.string('mutation_khatian_no', 100).nullable();
      t.enum('mutation_status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('APPROVED');
      t.enum('khajna_tax_status', ['PAID_UP_TO_DATE', 'OVERDUE', 'EXEMPT']).defaultTo('PAID_UP_TO_DATE');
      t.string('khajna_last_paid_year', 20).defaultTo('1431-32 BS (2025-26)');
      t.enum('mortgage_status', ['UNENCUMBERED', 'MORTGAGED_TO_BANK', 'RELEASED']).defaultTo('UNENCUMBERED');
      t.json('landowners_json').nullable(); // [{"name":"Alhaj Abdur Rahman","share":40},{"name":"Mr. Karim","share":30},{"name":"Mrs. Nasreen","share":30}]
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Joint Venture Agreement (JVA) with Landowners
  if (!(await knex.schema.hasTable('joint_venture_agreements'))) {
    await knex.schema.createTable('joint_venture_agreements', t => {
      t.increments('id_jva').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('agreement_no', 100).notNullable().unique();
      t.date('agreement_date').notNullable();
      t.string('developer_entity_name', 200).notNullable();
      t.decimal('landowner_share_percent', 5, 2).defaultTo(50.00);
      t.decimal('developer_share_percent', 5, 2).defaultTo(50.00);
      t.decimal('signing_money_bdt', 14, 2).defaultTo(0);
      t.date('construction_start_deadline').nullable();
      t.date('handover_deadline').nullable();
      t.decimal('delay_penalty_per_month_bdt', 12, 2).defaultTo(50000.00);
      t.json('flat_allocation_matrix').nullable(); // [{"unit":"A-201","assigned_to":"LANDOWNER"},{"unit":"A-202","assigned_to":"DEVELOPER"}]
      t.json('parking_allocation_matrix').nullable();
      t.string('sub_registry_office', 150).defaultTo('Uttara Sub-Registry Office');
      t.enum('status', ['DRAFT', 'SIGNED_NOTARIZED', 'REGISTERED', 'FULFILLED', 'DISPUTED']).defaultTo('REGISTERED');
      t.text('terms_and_conditions').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Authority Approvals & NOCs (RAJUK, CDA, Fire, DoE, Aviation, WASA)
  if (!(await knex.schema.hasTable('authority_approvals'))) {
    await knex.schema.createTable('authority_approvals', t => {
      t.increments('id_approvals').primary();
      t.integer('id_projects').unsigned().nullable();
      t.enum('authority', ['RAJUK', 'CDA', 'KDA', 'RDA', 'CITY_CORPORATION', 'FIRE_SERVICE', 'DOE_ENVIRONMENT', 'CIVIL_AVIATION', 'WASA', 'TITAS_GAS']).notNullable();
      t.string('approval_title', 200).notNullable();
      t.string('approval_type', 100).notNullable(); // 'LAND_USE', 'BUILDING_PLAN', 'OCCUPANCY_CERTIFICATE', 'SPECIAL_PROJECT', 'FIRE_NOC'
      t.string('application_number', 100).notNullable();
      t.date('application_date').nullable();
      t.date('approval_date').nullable();
      t.date('expiry_date').nullable();
      t.string('approval_reference_no', 150).nullable();
      t.enum('status', ['NOT_STARTED', 'SUBMITTED', 'UNDER_INSPECTION', 'APPROVED', 'REVISED_REQUIRED', 'EXPIRED']).defaultTo('APPROVED');
      t.json('document_checklist').nullable(); // [{"item":"Architectural Drawing","status":"APPROVED"},{"item":"Soil Test","status":"APPROVED"}]
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. BNBC 2020 Compliance Records
  if (!(await knex.schema.hasTable('bnbc_compliance_records'))) {
    await knex.schema.createTable('bnbc_compliance_records', t => {
      t.increments('id_bnbc').primary();
      t.integer('id_projects').unsigned().nullable();
      t.enum('category', ['STRUCTURAL', 'FIRE_SAFETY', 'ACCESSIBILITY', 'ELECTRICAL_MEP', 'ENVIRONMENTAL']).notNullable();
      t.string('requirement_name', 200).notNullable();
      t.text('specification_clause').nullable(); // e.g. "BNBC 2020 Part 6 Section 2.5: Zone 2 Seismic Factor Z=0.20"
      t.string('evidence_document', 200).nullable();
      t.string('responsible_engineer', 150).nullable();
      t.enum('compliance_status', ['COMPLIANT', 'IN_REVIEW', 'ACTION_REQUIRED', 'EXEMPT']).defaultTo('COMPLIANT');
      t.date('verification_date').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 5. Fire Safety Equipment & Inspections
  if (!(await knex.schema.hasTable('fire_safety_equipment'))) {
    await knex.schema.createTable('fire_safety_equipment', t => {
      t.increments('id_fire_equip').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('equipment_tag', 50).notNullable(); // e.g. 'EXT-A-01', 'ALARM-B-FL05'
      t.string('equipment_type', 100).notNullable(); // 'ABC Dry Powder 5kg', 'CO2 Extinguisher 3kg', 'Fire Hose Reel', 'Smoke Detector'
      t.string('location_description', 200).notNullable();
      t.date('installation_date').nullable();
      t.date('last_inspection_date').nullable();
      t.date('expiry_refill_date').nullable();
      t.enum('status', ['ACTIVE_READY', 'REFILL_DUE', 'MAINTENANCE_REQUIRED', 'EXPIRED']).defaultTo('ACTIVE_READY');
      t.string('inspector_name', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 6. Utility Meters (Electricity, Water, Gas, Generator Sub-meters)
  if (!(await knex.schema.hasTable('utility_meters'))) {
    await knex.schema.createTable('utility_meters', t => {
      t.increments('id_utility_meters').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_units').unsigned().nullable();
      t.string('unit_number', 50).nullable();
      t.enum('utility_type', ['ELECTRICITY', 'WATER', 'GAS_LPG', 'GENERATOR_BACKUP']).notNullable();
      t.string('meter_number', 100).notNullable();
      t.decimal('previous_reading', 12, 2).defaultTo(0);
      t.decimal('current_reading', 12, 2).defaultTo(0);
      t.decimal('consumption_units', 12, 2).defaultTo(0);
      t.string('uom', 20).defaultTo('kWh / Gallons');
      t.decimal('unit_rate_bdt', 10, 2).defaultTo(10.50);
      t.string('billing_month', 50).defaultTo('October 2026');
      t.decimal('total_amount_bdt', 12, 2).defaultTo(0);
      t.enum('payment_status', ['UNBILLED', 'BILLED', 'PAID', 'OVERDUE']).defaultTo('PAID');
      t.timestamp('reading_date').defaultTo(knex.fn.now());
    });
  }

  // 7. Property Handover, Possession & Area Difference (Real Estate Act 2010 Compliance)
  if (!(await knex.schema.hasTable('property_handovers'))) {
    await knex.schema.createTable('property_handovers', t => {
      t.increments('id_handovers').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_units').unsigned().notNullable();
      t.string('unit_number', 50).notNullable();
      t.string('owner_name', 150).notNullable();
      t.decimal('approved_area_sft', 10, 2).notNullable();
      t.decimal('final_measured_area_sft', 10, 2).notNullable();
      t.decimal('area_difference_sft', 10, 2).defaultTo(0); // final - approved
      t.decimal('rate_per_sft_bdt', 12, 2).defaultTo(0);
      t.decimal('area_adjustment_amount_bdt', 14, 2).defaultTo(0); // compensation or extra payment
      t.enum('adjustment_settlement', ['NO_DIFFERENCE', 'SETTLED_WITH_OWNER', 'PENDING_REFUND', 'PENDING_COLLECTION']).defaultTo('NO_DIFFERENCE');
      t.json('snag_list').nullable(); // [{"item":"Master bath tile grout","status":"FIXED"},{"item":"Balcony latch","status":"FIXED"}]
      t.boolean('keys_handed_over').defaultTo(true);
      t.boolean('access_cards_issued').defaultTo(true);
      t.date('possession_date').nullable();
      t.enum('handover_status', ['INSPECTION_PENDING', 'SNAGS_IN_PROGRESS', 'READY_FOR_HANDOVER', 'HANDED_OVER_POSSESSED']).defaultTo('HANDED_OVER_POSSESSED');
      t.string('possession_letter_ref', 100).nullable();
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 8. Vendor Baki (Credit) Ledger & Worker Advances
  if (!(await knex.schema.hasTable('vendor_baki_ledger'))) {
    await knex.schema.createTable('vendor_baki_ledger', t => {
      t.increments('id_baki').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_vendors').unsigned().nullable();
      t.string('vendor_name', 200).notNullable();
      t.string('trade_specialty', 100).notNullable();
      t.decimal('total_purchased_bdt', 14, 2).defaultTo(0);
      t.decimal('total_paid_bdt', 14, 2).defaultTo(0);
      t.decimal('current_baki_bdt', 14, 2).defaultTo(0); // purchased - paid
      t.decimal('credit_limit_bdt', 14, 2).defaultTo(500000.00);
      t.string('payment_terms', 100).defaultTo('Every Alternate Thursday (বৃহস্পতিবার)');
      t.timestamp('last_transaction_date').defaultTo(knex.fn.now());
    });
  }

  // 9. Cheque Management & Clearing Register
  if (!(await knex.schema.hasTable('cheque_register'))) {
    await knex.schema.createTable('cheque_register', t => {
      t.increments('id_cheques').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('cheque_number', 50).notNullable();
      t.string('bank_name', 150).notNullable(); // 'Dutch-Bangla Bank Ltd', 'Islami Bank Bangladesh Ltd', 'BRAC Bank'
      t.string('branch_name', 100).defaultTo('Uttara Branch');
      t.string('account_no', 100).nullable();
      t.string('payee_or_drawer', 200).notNullable();
      t.decimal('amount_bdt', 14, 2).notNullable();
      t.date('issue_date').notNullable();
      t.date('deposit_date').nullable();
      t.date('clearance_date').nullable();
      t.enum('cheque_type', ['INWARD_COLLECTION', 'OUTWARD_PAYMENT']).defaultTo('INWARD_COLLECTION');
      t.enum('status', ['ISSUED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED']).defaultTo('CLEARED');
      t.string('reference_voucher_no', 100).nullable(); // MR-2026-000123 or VOU-2026-000456
      t.text('remarks').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
};
