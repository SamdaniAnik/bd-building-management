exports.up = async function(knex) {
  // 1. Projects table
  if (!(await knex.schema.hasTable('projects'))) {
    await knex.schema.createTable('projects', t => {
      t.increments('id_projects').primary();
      t.string('project_name', 200).notNullable();
      t.string('project_code', 50).notNullable().unique();
      t.string('address', 255).nullable();
      t.text('description').nullable();
      t.date('start_date').nullable();
      t.date('expected_completion_date').nullable();
      t.date('actual_completion_date').nullable();
      t.integer('number_of_buildings').defaultTo(1);
      t.integer('number_of_floors').defaultTo(6);
      t.integer('number_of_units').defaultTo(6);
      t.decimal('total_unit_area', 14, 2).defaultTo(0);
      t.decimal('total_common_area', 14, 2).defaultTo(0);
      t.decimal('total_construction_area', 14, 2).defaultTo(0);
      t.enum('status', ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 2. Project Floors
  if (!(await knex.schema.hasTable('floors'))) {
    await knex.schema.createTable('floors', t => {
      t.increments('id_floors').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_buildings').unsigned().nullable();
      t.integer('floor_number').notNullable();
      t.string('floor_name', 100).notNullable();
      t.decimal('floor_area', 12, 2).defaultTo(0);
      t.integer('number_of_units').defaultTo(1);
      t.decimal('common_area', 12, 2).defaultTo(0);
      t.decimal('lobby_area', 12, 2).defaultTo(0);
      t.decimal('stair_area', 12, 2).defaultTo(0);
      t.decimal('lift_area', 12, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Units
  if (!(await knex.schema.hasTable('units'))) {
    await knex.schema.createTable('units', t => {
      t.increments('id_units').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_buildings').unsigned().nullable();
      t.integer('id_floors').unsigned().nullable();
      t.string('unit_number', 50).notNullable();
      t.string('unit_type', 100).defaultTo('Apartment');
      t.decimal('area_sqft', 12, 2).notNullable().defaultTo(0);
      t.integer('bedrooms').defaultTo(3);
      t.integer('bathrooms').defaultTo(3);
      t.integer('kitchen').defaultTo(1);
      t.integer('living_dining').defaultTo(1);
      t.integer('balcony_veranda').defaultTo(2);
      t.integer('parking').defaultTo(1);
      t.integer('storage').defaultTo(1);
      t.enum('status', ['AVAILABLE', 'RESERVED', 'OWNED', 'UNDER_CONSTRUCTION', 'COMPLETED', 'HANDED_OVER']).defaultTo('UNDER_CONSTRUCTION');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 4. Owners
  if (!(await knex.schema.hasTable('owners'))) {
    await knex.schema.createTable('owners', t => {
      t.increments('id_owners').primary();
      t.string('full_name', 200).notNullable();
      t.string('phone', 50).notNullable();
      t.string('email', 150).nullable();
      t.text('address').nullable();
      t.string('identification_reference', 100).nullable();
      t.date('agreement_date').nullable();
      t.string('ownership_status', 50).defaultTo('ACTIVE');
      t.string('login_email', 150).nullable().unique();
      t.string('login_password', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 5. Unit Ownership (Supports multi-owner per unit, e.g. Owner 1: 60%, Owner 2: 40%)
  if (!(await knex.schema.hasTable('unit_ownerships'))) {
    await knex.schema.createTable('unit_ownerships', t => {
      t.increments('id_unit_ownerships').primary();
      t.integer('id_units').unsigned().notNullable();
      t.integer('id_owners').unsigned().notNullable();
      t.decimal('ownership_percentage', 6, 2).notNullable().defaultTo(100.00);
      t.date('agreement_date').nullable();
      t.string('status', 50).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['id_units', 'id_owners']);
    });
  }

  // 6. Unit Rooms & Areas (Length x Width = Area)
  if (!(await knex.schema.hasTable('unit_rooms'))) {
    await knex.schema.createTable('unit_rooms', t => {
      t.increments('id_rooms').primary();
      t.integer('id_units').unsigned().notNullable();
      t.integer('id_floors').unsigned().nullable();
      t.string('room_name', 100).notNullable();
      t.enum('room_type', [
        'MASTER_BEDROOM', 'BEDROOM', 'LIVING_ROOM', 'DINING', 'LIVING_DINING',
        'KITCHEN', 'TOILET', 'COMMON_TOILET', 'ATTACHED_TOILET', 'BALCONY',
        'VERANDA', 'STORE', 'OTHER'
      ]).defaultTo('BEDROOM');
      t.decimal('length_feet', 8, 2).defaultTo(0);
      t.decimal('width_feet', 8, 2).defaultTo(0);
      t.decimal('area_sqft', 10, 2).defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 7. Vendors
  if (!(await knex.schema.hasTable('vendors'))) {
    await knex.schema.createTable('vendors', t => {
      t.increments('id_vendors').primary();
      t.string('company_name', 200).notNullable();
      t.string('contact_person', 150).nullable();
      t.string('phone', 50).notNullable();
      t.string('email', 150).nullable();
      t.text('address').nullable();
      t.enum('category', [
        'CONTRACTOR', 'CEMENT_SUPPLIER', 'STEEL_SUPPLIER', 'TILE_SUPPLIER',
        'ELECTRICAL', 'PLUMBING', 'LIFT', 'KITCHEN', 'PAINTING', 'CARPENTRY', 'OTHER'
      ]).defaultTo('CONTRACTOR');
      t.string('trade', 100).nullable();
      t.string('tax_information', 100).nullable();
      t.string('bank_information', 255).nullable();
      t.string('payment_terms', 100).defaultTo('Net 30');
      t.enum('status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 8. Materials
  if (!(await knex.schema.hasTable('materials'))) {
    await knex.schema.createTable('materials', t => {
      t.increments('id_materials').primary();
      t.string('material_name', 200).notNullable();
      t.enum('category', ['Structural', 'Finishing', 'Electrical', 'Plumbing', 'Sanitary', 'Other']).defaultTo('Structural');
      t.string('unit', 50).notNullable().defaultTo('Bags');
      t.decimal('current_rate', 12, 2).defaultTo(0);
      t.decimal('previous_rate', 12, 2).defaultTo(0);
      t.string('supplier', 200).nullable();
      t.date('last_updated_date').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 9. Construction Works (Combined and Individual)
  if (!(await knex.schema.hasTable('construction_works'))) {
    await knex.schema.createTable('construction_works', t => {
      t.increments('id_works').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_buildings').unsigned().nullable();
      t.integer('id_floors').unsigned().nullable();
      t.integer('id_units').unsigned().nullable(); // null for combined work
      t.integer('id_owners').unsigned().nullable(); // null for combined work
      t.integer('id_vendors').unsigned().nullable();
      t.string('work_name', 255).notNullable();
      t.string('work_category', 100).notNullable().defaultTo('Structural');
      t.enum('work_type', ['COMBINED', 'INDIVIDUAL', 'EXTRA_WORK']).notNullable().defaultTo('COMBINED');
      t.text('description').nullable();
      t.decimal('estimated_cost', 14, 2).defaultTo(0);
      t.decimal('actual_cost', 14, 2).defaultTo(0);
      t.date('start_date').nullable();
      t.date('expected_completion').nullable();
      t.date('actual_completion').nullable();
      t.integer('progress_percentage').defaultTo(0);
      t.enum('status', ['DRAFT', 'REQUESTED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).defaultTo('IN_PROGRESS');
      t.enum('cost_allocation_method', ['EQUAL', 'AREA_BASED', 'PERCENTAGE', 'CUSTOM']).defaultTo('AREA_BASED');
      t.enum('extra_work_status', [
        'NOT_APPLICABLE', 'REQUESTED', 'QUOTATION', 'OWNER_APPROVAL',
        'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'PAID'
      ]).defaultTo('NOT_APPLICABLE');
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 10. Work Allocations (Unit/Owner breakdown for combined or individual works)
  if (!(await knex.schema.hasTable('work_allocations'))) {
    await knex.schema.createTable('work_allocations', t => {
      t.increments('id_work_allocations').primary();
      t.integer('id_works').unsigned().notNullable();
      t.integer('id_units').unsigned().notNullable();
      t.integer('id_owners').unsigned().nullable();
      t.decimal('allocation_percentage', 8, 4).defaultTo(0);
      t.decimal('allocated_amount', 14, 2).notNullable().defaultTo(0);
      t.boolean('is_custom').defaultTo(false);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 11. BOQ (Bill of Quantities)
  if (!(await knex.schema.hasTable('boq_items'))) {
    await knex.schema.createTable('boq_items', t => {
      t.increments('id_boq').primary();
      t.integer('id_works').unsigned().notNullable();
      t.integer('id_materials').unsigned().nullable();
      t.string('item_name', 200).notNullable();
      t.decimal('quantity', 12, 2).notNullable().defaultTo(0);
      t.string('unit', 50).defaultTo('Unit');
      t.decimal('rate', 12, 2).notNullable().defaultTo(0);
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('subtotal', 14, 2).defaultTo(0);
      t.decimal('discount', 12, 2).defaultTo(0);
      t.decimal('tax', 12, 2).defaultTo(0);
      t.decimal('total', 14, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 12. Vendor Quotations
  if (!(await knex.schema.hasTable('vendor_quotations'))) {
    await knex.schema.createTable('vendor_quotations', t => {
      t.increments('id_quotations').primary();
      t.integer('id_works').unsigned().notNullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.string('quotation_number', 100).notNullable();
      t.decimal('quoted_amount', 14, 2).notNullable().defaultTo(0);
      t.date('quotation_date').nullable();
      t.date('valid_until').nullable();
      t.text('terms_and_conditions').nullable();
      t.enum('status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED']).defaultTo('SUBMITTED');
      t.string('document_url', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 13. Purchase Orders
  if (!(await knex.schema.hasTable('purchase_orders'))) {
    await knex.schema.createTable('purchase_orders', t => {
      t.increments('id_po').primary();
      t.string('po_number', 100).notNullable().unique();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_works').unsigned().nullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.json('items_data').nullable();
      t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
      t.date('delivery_date').nullable();
      t.string('payment_terms', 100).nullable();
      t.text('notes').nullable();
      t.enum('status', ['DRAFT', 'ISSUED', 'CONFIRMED', 'DELIVERED', 'CANCELLED']).defaultTo('ISSUED');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 14. Vendor Invoices
  if (!(await knex.schema.hasTable('vendor_invoices'))) {
    await knex.schema.createTable('vendor_invoices', t => {
      t.increments('id_invoices').primary();
      t.string('invoice_number', 100).notNullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.integer('id_po').unsigned().nullable();
      t.integer('id_works').unsigned().nullable();
      t.date('invoice_date').notNullable();
      t.date('due_date').nullable();
      t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax', 12, 2).defaultTo(0);
      t.decimal('discount', 12, 2).defaultTo(0);
      t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('paid_amount', 14, 2).defaultTo(0);
      t.decimal('outstanding_amount', 14, 2).notNullable().defaultTo(0);
      t.enum('status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).defaultTo('APPROVED');
      t.string('attachment_url', 255).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 15. Vendor Payments
  if (!(await knex.schema.hasTable('vendor_payments'))) {
    await knex.schema.createTable('vendor_payments', t => {
      t.increments('id_payments').primary();
      t.integer('id_invoices').unsigned().nullable();
      t.integer('id_vendors').unsigned().notNullable();
      t.date('payment_date').notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.enum('payment_type', ['ADVANCE', 'PARTIAL', 'MILESTONE', 'FINAL', 'RETENTION', 'REFUND', 'ADJUSTMENT']).defaultTo('PARTIAL');
      t.enum('payment_method', ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'ONLINE', 'OTHER']).defaultTo('BANK_TRANSFER');
      t.string('reference_number', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 16. Owner Contributions & Payments
  if (!(await knex.schema.hasTable('owner_contributions'))) {
    await knex.schema.createTable('owner_contributions', t => {
      t.increments('id_contributions').primary();
      t.integer('id_owners').unsigned().notNullable();
      t.integer('id_units').unsigned().nullable();
      t.integer('id_projects').unsigned().nullable();
      t.decimal('amount', 14, 2).notNullable();
      t.date('payment_date').notNullable();
      t.enum('contribution_type', [
        'INITIAL_DEPOSIT', 'CONSTRUCTION_INSTALLMENT', 'MONTHLY_CONTRIBUTION',
        'SPECIAL_CONTRIBUTION', 'EMERGENCY_CONTRIBUTION', 'LOAN_FUNDED'
      ]).defaultTo('CONSTRUCTION_INSTALLMENT');
      t.enum('payment_method', ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'LOAN', 'OTHER']).defaultTo('BANK_TRANSFER');
      t.string('bank_or_cash_account', 150).nullable();
      t.string('reference', 100).nullable();
      t.string('receipt_number', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 17. Owner Ledgers (Double-entry / transaction ledger per owner)
  if (!(await knex.schema.hasTable('owner_ledgers'))) {
    await knex.schema.createTable('owner_ledgers', t => {
      t.increments('id_ledger').primary();
      t.integer('id_owners').unsigned().notNullable();
      t.integer('id_units').unsigned().nullable();
      t.date('transaction_date').notNullable();
      t.enum('entry_type', ['DEBIT', 'CREDIT']).notNullable();
      t.enum('category', [
        'COMBINED_COST', 'INDIVIDUAL_WORK', 'EXTRA_WORK', 'OTHER_CHARGE',
        'OWNER_PAYMENT', 'ADJUSTMENT', 'REFUND'
      ]).notNullable();
      t.string('description', 255).notNullable();
      t.decimal('debit_amount', 14, 2).defaultTo(0);
      t.decimal('credit_amount', 14, 2).defaultTo(0);
      t.decimal('running_balance', 14, 2).defaultTo(0);
      t.string('reference_id', 100).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 18. Owner Bank Loans
  if (!(await knex.schema.hasTable('owner_loans'))) {
    await knex.schema.createTable('owner_loans', t => {
      t.increments('id_loans').primary();
      t.integer('id_owners').unsigned().notNullable();
      t.integer('id_units').unsigned().nullable();
      t.string('bank_lender_name', 200).notNullable();
      t.decimal('approved_amount', 14, 2).notNullable();
      t.decimal('disbursed_amount', 14, 2).defaultTo(0);
      t.decimal('interest_rate', 5, 2).defaultTo(9.00);
      t.integer('loan_term_months').defaultTo(120);
      t.date('start_date').nullable();
      t.date('end_date').nullable();
      t.decimal('monthly_installment', 12, 2).defaultTo(0);
      t.decimal('principal_paid', 14, 2).defaultTo(0);
      t.decimal('interest_paid', 14, 2).defaultTo(0);
      t.decimal('outstanding_amount', 14, 2).defaultTo(0);
      t.enum('status', ['ACTIVE', 'PAID', 'DEFAULTED', 'CLOSED']).defaultTo('ACTIVE');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }

  // 19. Loan Disbursements
  if (!(await knex.schema.hasTable('loan_disbursements'))) {
    await knex.schema.createTable('loan_disbursements', t => {
      t.increments('id_disbursements').primary();
      t.integer('id_loans').unsigned().notNullable();
      t.integer('disbursement_number').defaultTo(1);
      t.date('disbursement_date').notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.string('reference_number', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 20. Loan Payments
  if (!(await knex.schema.hasTable('loan_payments'))) {
    await knex.schema.createTable('loan_payments', t => {
      t.increments('id_loan_payments').primary();
      t.integer('id_loans').unsigned().notNullable();
      t.date('payment_date').notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.decimal('principal', 14, 2).defaultTo(0);
      t.decimal('interest', 14, 2).defaultTo(0);
      t.string('bank_name', 150).nullable();
      t.string('reference', 100).nullable();
      t.decimal('remaining_balance', 14, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 21. Project Budgets
  if (!(await knex.schema.hasTable('budgets'))) {
    await knex.schema.createTable('budgets', t => {
      t.increments('id_budgets').primary();
      t.integer('id_projects').unsigned().nullable();
      t.enum('category', [
        'STRUCTURAL', 'FINISHING', 'ELECTRICAL', 'PLUMBING', 'LIFT',
        'COMMON_FACILITIES', 'INDIVIDUAL_WORK', 'PROFESSIONAL_FEES',
        'ADMINISTRATIVE_EXPENSES', 'CONTINGENCY'
      ]).notNullable();
      t.decimal('original_budget', 14, 2).notNullable().defaultTo(0);
      t.decimal('revised_budget', 14, 2).notNullable().defaultTo(0);
      t.decimal('actual_spent', 14, 2).defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 22. Change Orders
  if (!(await knex.schema.hasTable('change_orders'))) {
    await knex.schema.createTable('change_orders', t => {
      t.increments('id_change_orders').primary();
      t.integer('id_budgets').unsigned().notNullable();
      t.decimal('original_amount', 14, 2).notNullable();
      t.decimal('change_amount', 14, 2).notNullable();
      t.decimal('revised_amount', 14, 2).notNullable();
      t.text('reason').notNullable();
      t.string('requested_by', 150).nullable();
      t.string('approved_by', 150).nullable();
      t.date('change_date').notNullable();
      t.enum('status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('APPROVED');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 23. Project Expenses (Core accounting transaction)
  if (!(await knex.schema.hasTable('project_expenses'))) {
    await knex.schema.createTable('project_expenses', t => {
      t.increments('id_expenses').primary();
      t.integer('id_projects').unsigned().nullable();
      t.integer('id_buildings').unsigned().nullable();
      t.integer('id_floors').unsigned().nullable();
      t.integer('id_units').unsigned().nullable();
      t.integer('id_owners').unsigned().nullable();
      t.integer('id_works').unsigned().nullable();
      t.integer('id_vendors').unsigned().nullable();
      t.integer('id_invoices').unsigned().nullable();
      t.string('category', 100).notNullable();
      t.enum('expense_type', ['COMBINED', 'INDIVIDUAL']).notNullable().defaultTo('COMBINED');
      t.decimal('amount', 14, 2).notNullable();
      t.date('expense_date').notNullable();
      t.string('payment_method', 100).defaultTo('BANK_TRANSFER');
      t.enum('funding_source', ['OWNER_EQUITY', 'BANK_LOAN', 'PROJECT_FUND', 'PETTY_CASH']).defaultTo('PROJECT_FUND');
      t.string('receipt_reference', 100).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 24. Common Areas
  if (!(await knex.schema.hasTable('common_areas'))) {
    await knex.schema.createTable('common_areas', t => {
      t.increments('id_common_areas').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('area_name', 150).notNullable();
      t.enum('area_type', [
        'LOBBY', 'STAIRCASING', 'LIFT_LOBBY', 'CORRIDOR', 'COMMON_ELECTRICAL',
        'COMMON_PLUMBING', 'WATER_SYSTEM', 'GENERATOR', 'FIRE_SAFETY', 'EXTERNAL_WORKS'
      ]).defaultTo('LOBBY');
      t.decimal('area_sqft', 12, 2).defaultTo(0);
      t.decimal('construction_cost', 14, 2).defaultTo(0);
      t.decimal('monthly_maintenance_cost', 10, 2).defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 25. Lift Management (2 Lifts for current project)
  if (!(await knex.schema.hasTable('lifts'))) {
    await knex.schema.createTable('lifts', t => {
      t.increments('id_lifts').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('lift_number', 50).notNullable();
      t.integer('capacity_persons').defaultTo(8);
      t.string('manufacturer', 150).nullable();
      t.integer('id_vendors').unsigned().nullable();
      t.decimal('purchase_cost', 14, 2).defaultTo(0);
      t.decimal('installation_cost', 14, 2).defaultTo(0);
      t.decimal('civil_work_cost', 14, 2).defaultTo(0);
      t.decimal('electrical_cost', 14, 2).defaultTo(0);
      t.integer('warranty_years').defaultTo(2);
      t.string('maintenance_contract', 200).nullable();
      t.decimal('monthly_maintenance_cost', 12, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 26. Cash & Bank Accounts
  if (!(await knex.schema.hasTable('cash_bank_accounts'))) {
    await knex.schema.createTable('cash_bank_accounts', t => {
      t.increments('id_accounts').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('account_name', 150).notNullable();
      t.enum('account_type', ['PROJECT_BANK', 'CONSTRUCTION_ACCOUNT', 'LOAN_ACCOUNT', 'SITE_CASH', 'PETTY_CASH']).notNullable();
      t.string('bank_name', 150).nullable();
      t.string('account_number', 100).nullable();
      t.decimal('balance', 16, 2).defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 27. Approvals
  if (!(await knex.schema.hasTable('approvals'))) {
    await knex.schema.createTable('approvals', t => {
      t.increments('id_approvals').primary();
      t.string('action_type', 100).notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.string('tier', 50).defaultTo('PROJECT_MANAGER'); // <1k PM, 1k-10k PM+Acc, >10k Committee
      t.enum('status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('APPROVED');
      t.string('requested_by', 150).nullable();
      t.string('approved_by', 150).nullable();
      t.text('comments').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 28. Notifications
  if (!(await knex.schema.hasTable('notifications'))) {
    await knex.schema.createTable('notifications', t => {
      t.increments('id_notifications').primary();
      t.integer('id_users').unsigned().nullable();
      t.string('title', 200).notNullable();
      t.text('message').notNullable();
      t.string('type', 50).defaultTo('INFO');
      t.boolean('is_read').defaultTo(false);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 29. Audit Logs
  if (!(await knex.schema.hasTable('audit_logs'))) {
    await knex.schema.createTable('audit_logs', t => {
      t.increments('id_audit').primary();
      t.string('user_name', 150).notNullable().defaultTo('System');
      t.string('action', 150).notNullable();
      t.string('entity_type', 100).notNullable();
      t.string('entity_id', 100).nullable();
      t.text('old_value').nullable();
      t.text('new_value').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  // Can drop in reverse order if needed
};
