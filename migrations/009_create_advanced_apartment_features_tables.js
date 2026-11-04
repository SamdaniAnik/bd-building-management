exports.up = async function(knex) {
  // 1. Drawing & Floor Plan Revisions (Never overwrite: Rev 01, Rev 02, etc.)
  if (!(await knex.schema.hasTable('drawings'))) {
    await knex.schema.createTable('drawings', t => {
      t.increments('id_drawings').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('drawing_code', 100).notNullable();
      t.string('title', 200).notNullable();
      t.enum('category', ['ARCHITECTURAL', 'STRUCTURAL', 'ELECTRICAL', 'PLUMBING', 'FLOOR_PLAN', 'ELEVATION', 'SECTION']).defaultTo('ARCHITECTURAL');
      t.integer('current_revision').defaultTo(1);
      t.string('status', 50).defaultTo('APPROVED'); // DRAFT, UNDER_REVIEW, APPROVED, SUPERSEDED
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('drawing_revisions'))) {
    await knex.schema.createTable('drawing_revisions', t => {
      t.increments('id_revisions').primary();
      t.integer('id_drawings').unsigned().notNullable();
      t.integer('revision_number').notNullable();
      t.string('revision_code', 50).notNullable(); // e.g. Rev 01, Rev 02
      t.date('upload_date').notNullable();
      t.string('uploaded_by', 150).notNullable();
      t.text('revision_reason').nullable();
      t.string('file_url', 255).nullable();
      t.string('approval_status', 50).defaultTo('APPROVED');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Contractor Contracts & Progress Billing (Retention, Advance Recovery)
  if (!(await knex.schema.hasTable('contractor_contracts'))) {
    await knex.schema.createTable('contractor_contracts', t => {
      t.increments('id_contracts').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.string('contract_number', 100).notNullable().unique();
      t.string('contract_title', 200).notNullable();
      t.decimal('contract_value', 16, 2).notNullable();
      t.decimal('retention_percentage', 5, 2).defaultTo(5.00); // 5% default
      t.decimal('advance_paid', 14, 2).defaultTo(0);
      t.decimal('advance_recovered', 14, 2).defaultTo(0);
      t.decimal('retention_held', 14, 2).defaultTo(0);
      t.decimal('work_completed_percentage', 5, 2).defaultTo(0);
      t.date('start_date').nullable();
      t.date('end_date').nullable();
      t.text('scope_of_work').nullable();
      t.string('status', 50).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('contractor_progress_bills'))) {
    await knex.schema.createTable('contractor_progress_bills', t => {
      t.increments('id_progress_bills').primary();
      t.integer('id_contracts').unsigned().notNullable();
      t.string('bill_number', 100).notNullable();
      t.date('billing_date').notNullable();
      t.decimal('cumulative_work_percent', 5, 2).notNullable();
      t.decimal('gross_claim_amount', 14, 2).notNullable();
      t.decimal('advance_recovery_amount', 14, 2).defaultTo(0);
      t.decimal('retention_amount', 14, 2).defaultTo(0);
      t.decimal('previous_payments', 14, 2).defaultTo(0);
      t.decimal('net_payable_amount', 14, 2).notNullable();
      t.string('status', 50).defaultTo('APPROVED'); // SUBMITTED, CERTIFIED, APPROVED, PAID
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Site Petty Cash & Daily Expenses
  if (!(await knex.schema.hasTable('site_petty_expenses'))) {
    await knex.schema.createTable('site_petty_expenses', t => {
      t.increments('id_site_expenses').primary();
      t.integer('id_projects').unsigned().nullable();
      t.date('expense_date').notNullable();
      t.enum('category', [
        'TRANSPORTATION', 'LABOUR_FOOD', 'SMALL_TOOLS', 'EMERGENCY_MATERIALS',
        'DELIVERY_CHARGES', 'LOADING_UNLOADING', 'TEMPORARY_ELECTRICITY', 'TEMPORARY_WATER', 'OTHER'
      ]).defaultTo('TRANSPORTATION');
      t.decimal('amount', 12, 2).notNullable();
      t.string('payee', 150).nullable();
      t.string('entered_by', 150).notNullable();
      t.string('receipt_number', 100).nullable();
      t.text('description').nullable();
      t.string('photo_receipt_url', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Labour Roster & Daily Attendance
  if (!(await knex.schema.hasTable('labour_workers'))) {
    await knex.schema.createTable('labour_workers', t => {
      t.increments('id_workers').primary();
      t.string('worker_name', 150).notNullable();
      t.enum('worker_type', ['MASON', 'HELPER', 'ELECTRICIAN', 'PLUMBER', 'ROD_BINDER', 'CARPENTER', 'PAINTER', 'FOREMAN']).defaultTo('HELPER');
      t.decimal('daily_rate', 10, 2).notNullable();
      t.string('phone', 50).nullable();
      t.string('contractor_agency', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('labour_attendance'))) {
    await knex.schema.createTable('labour_attendance', t => {
      t.increments('id_attendance').primary();
      t.integer('id_workers').unsigned().notNullable();
      t.date('attendance_date').notNullable();
      t.decimal('hours_worked', 4, 1).defaultTo(8.0);
      t.decimal('overtime_hours', 4, 1).defaultTo(0);
      t.decimal('calculated_pay', 10, 2).notNullable();
      t.string('work_performed', 255).nullable();
      t.string('status', 50).defaultTo('PRESENT');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 5. Site Material Inventory & Reorder Alerts
  if (!(await knex.schema.hasTable('site_inventory'))) {
    await knex.schema.createTable('site_inventory', t => {
      t.increments('id_inventory').primary();
      t.integer('id_materials').unsigned().notNullable();
      t.decimal('opening_stock', 12, 2).defaultTo(0);
      t.decimal('purchased_qty', 12, 2).defaultTo(0);
      t.decimal('used_qty', 12, 2).defaultTo(0);
      t.decimal('damaged_qty', 12, 2).defaultTo(0);
      t.decimal('current_stock', 12, 2).notNullable().defaultTo(0);
      t.decimal('minimum_reorder_stock', 12, 2).defaultTo(50);
      t.timestamp('last_updated').defaultTo(knex.fn.now());
    });
  }

  // 6. Goods Delivery & 3-Way Matching (PO vs Goods Received vs Invoice)
  if (!(await knex.schema.hasTable('goods_deliveries'))) {
    await knex.schema.createTable('goods_deliveries', t => {
      t.increments('id_deliveries').primary();
      t.integer('id_po').unsigned().nullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.string('delivery_challan_no', 100).notNullable();
      t.date('delivery_date').notNullable();
      t.string('material_item', 200).notNullable();
      t.decimal('po_ordered_qty', 12, 2).notNullable();
      t.decimal('received_qty', 12, 2).notNullable();
      t.decimal('damaged_qty', 12, 2).defaultTo(0);
      t.decimal('accepted_qty', 12, 2).notNullable();
      t.string('received_by', 150).notNullable();
      t.boolean('is_three_way_matched').defaultTo(false);
      t.text('matching_notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 7. Owner Committee Proposals & Voting
  if (!(await knex.schema.hasTable('committee_proposals'))) {
    await knex.schema.createTable('committee_proposals', t => {
      t.increments('id_proposals').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('title', 200).notNullable();
      t.text('description').notNullable();
      t.decimal('estimated_cost', 14, 2).defaultTo(0);
      t.string('proposed_by', 150).notNullable();
      t.date('proposal_date').notNullable();
      t.date('voting_deadline').nullable();
      t.enum('status', ['OPEN', 'APPROVED', 'REJECTED', 'IMPLEMENTED']).defaultTo('OPEN');
      t.integer('votes_for').defaultTo(0);
      t.integer('votes_against').defaultTo(0);
      t.integer('votes_abstain').defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('proposal_votes'))) {
    await knex.schema.createTable('proposal_votes', t => {
      t.increments('id_votes').primary();
      t.integer('id_proposals').unsigned().notNullable();
      t.integer('id_owners').unsigned().notNullable();
      t.enum('vote', ['FOR', 'AGAINST', 'ABSTAIN']).notNullable();
      t.text('comments').nullable();
      t.timestamp('voted_at').defaultTo(knex.fn.now());
      t.unique(['id_proposals', 'id_owners']);
    });
  }

  // 8. Payment Installment Schedule per Unit/Owner
  if (!(await knex.schema.hasTable('owner_payment_schedules'))) {
    await knex.schema.createTable('owner_payment_schedules', t => {
      t.increments('id_schedules').primary();
      t.integer('id_units').unsigned().notNullable();
      t.integer('id_owners').unsigned().notNullable();
      t.string('installment_name', 100).notNullable(); // e.g. Installment 1 - Piling
      t.decimal('target_amount', 14, 2).notNullable();
      t.decimal('paid_amount', 14, 2).defaultTo(0);
      t.date('due_date').notNullable();
      t.date('paid_date').nullable();
      t.decimal('late_fee_applicable', 10, 2).defaultTo(0);
      t.enum('status', ['PAID', 'DUE', 'UPCOMING', 'OVERDUE']).defaultTo('UPCOMING');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 9. Post-Handover Facilities Maintenance & Service Charges (Sections 31-35)
  if (!(await knex.schema.hasTable('service_charges'))) {
    await knex.schema.createTable('service_charges', t => {
      t.increments('id_service_charges').primary();
      t.integer('id_units').unsigned().notNullable();
      t.string('billing_month', 20).notNullable(); // e.g. 2026-10
      t.decimal('monthly_fee', 10, 2).notNullable().defaultTo(150.00);
      t.decimal('late_fee', 10, 2).defaultTo(0);
      t.decimal('amount_paid', 10, 2).defaultTo(0);
      t.date('due_date').notNullable();
      t.enum('status', ['PAID', 'UNPAID', 'OVERDUE']).defaultTo('UNPAID');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('maintenance_tickets'))) {
    await knex.schema.createTable('maintenance_tickets', t => {
      t.increments('id_tickets').primary();
      t.integer('id_units').unsigned().nullable();
      t.integer('id_owners').unsigned().nullable();
      t.string('title', 200).notNullable();
      t.enum('category', ['LIFT', 'GENERATOR', 'WATER_LEAKAGE', 'ELECTRICAL', 'SECURITY', 'CLEANING', 'OTHER']).defaultTo('OTHER');
      t.text('description').notNullable();
      t.enum('priority', ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).defaultTo('MEDIUM');
      t.enum('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).defaultTo('OPEN');
      t.string('assigned_contractor', 150).nullable();
      t.decimal('repair_cost', 10, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('resolved_at').nullable();
    });
  }

  if (!(await knex.schema.hasTable('asset_warranties'))) {
    await knex.schema.createTable('asset_warranties', t => {
      t.increments('id_warranties').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('asset_name', 150).notNullable();
      t.string('vendor_name', 150).notNullable();
      t.date('start_date').notNullable();
      t.date('expiration_date').notNullable();
      t.text('coverage_terms').nullable();
      t.string('contact_hotline', 50).nullable();
      t.string('status', 50).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 10. Site Photos & Visual Timeline (GPS/Location tag)
  if (!(await knex.schema.hasTable('construction_site_photos'))) {
    await knex.schema.createTable('construction_site_photos', t => {
      t.increments('id_photos').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_works').unsigned().nullable();
      t.string('title', 200).notNullable();
      t.date('photo_date').notNullable();
      t.string('stage_tag', 100).defaultTo('Foundation');
      t.string('photo_url', 255).notNullable();
      t.string('taken_by', 150).notNullable();
      t.string('gps_coordinates', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  // Can drop if needed
};
