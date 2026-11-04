exports.up = async function(knex) {
  // 1. Add land share and common share columns to units table if not present
  const hasLandShare = await knex.schema.hasColumn('units', 'land_share_sqft');
  if (!hasLandShare) {
    await knex.schema.alterTable('units', t => {
      t.string('unit_slot', 10).nullable().defaultTo('A'); // A, B, C, D, E, F
      t.decimal('carpet_area_sqft', 12, 2).defaultTo(0);
      t.decimal('common_area_sqft', 12, 2).defaultTo(0); // Common share for this unit
      t.decimal('land_share_sqft', 12, 4).defaultTo(0); // Undivided land share in sqft
      t.decimal('land_share_katha', 10, 4).defaultTo(0); // Land share in Bangladeshi Katha
      t.string('facing_direction', 50).nullable().defaultTo('South');
      t.boolean('is_corner_unit').defaultTo(false);
    });
  }

  // 2. Master for Unit Templates (Per floor 6 units master)
  if (!(await knex.schema.hasTable('master_unit_templates'))) {
    await knex.schema.createTable('master_unit_templates', t => {
      t.increments('id_unit_templates').primary();
      t.string('unit_slot', 10).notNullable(); // A, B, C, D, E, F
      t.string('template_name', 100).notNullable(); // e.g. "Type A - North-East Corner Luxury 3-BHK"
      t.decimal('gross_area_sqft', 12, 2).notNullable();
      t.decimal('carpet_area_sqft', 12, 2).notNullable();
      t.decimal('common_area_sqft', 12, 2).notNullable(); // Share of floor lobby & common
      t.decimal('default_land_share_sqft', 12, 4).defaultTo(0);
      t.decimal('default_land_share_katha', 10, 4).defaultTo(0);
      t.integer('bedrooms').defaultTo(3);
      t.integer('bathrooms').defaultTo(3);
      t.integer('balconies').defaultTo(2);
      t.string('facing_direction', 50).defaultTo('South-East');
      t.boolean('is_corner_unit').defaultTo(true);
      t.text('description').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Master for Materials / Items Catalogue
  if (!(await knex.schema.hasTable('master_items'))) {
    await knex.schema.createTable('master_items', t => {
      t.increments('id_master_items').primary();
      t.string('item_code', 50).notNullable().unique();
      t.string('item_name', 200).notNullable();
      t.enum('category', [
        'STRUCTURAL', 'FINISHING', 'ELECTRICAL', 'PLUMBING', 'SANITARY',
        'HARDWARE', 'ELEVATOR', 'HVAC_GENERATOR', 'SAFETY', 'OTHER'
      ]).defaultTo('STRUCTURAL');
      t.string('sub_category', 100).nullable();
      t.string('unit', 50).notNullable().defaultTo('Bags');
      t.decimal('standard_rate', 14, 2).notNullable().defaultTo(0);
      t.decimal('minimum_stock_alert', 12, 2).defaultTo(50);
      t.decimal('reorder_quantity', 12, 2).defaultTo(200);
      t.integer('preferred_vendor_id').unsigned().nullable();
      t.text('technical_specification').nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Master for Land Shares & Common Space Distribution Rules
  if (!(await knex.schema.hasTable('master_shares'))) {
    await knex.schema.createTable('master_shares', t => {
      t.increments('id_shares_master').primary();
      t.integer('id_projects').unsigned().nullable();
      t.string('project_title', 200).notNullable();
      t.decimal('total_land_katha', 10, 4).notNullable(); // e.g. 7.5 Katha
      t.decimal('total_land_sqft', 14, 4).notNullable(); // 7.5 * 720 = 5,400 sqft in BD
      t.decimal('total_floors_count', 6, 0).defaultTo(6);
      t.decimal('units_per_floor', 4, 0).defaultTo(6); // 6 units per floor!
      t.decimal('total_units_count', 6, 0).defaultTo(36); // 6 x 6 = 36 units!
      t.decimal('total_buildable_area_sqft', 16, 2).defaultTo(0);
      t.decimal('common_space_percentage', 6, 2).defaultTo(25.00); // 25% common space
      t.enum('land_share_allocation_method', ['EQUAL_PER_UNIT', 'PROPORTIONAL_TO_AREA', 'CUSTOM']).defaultTo('PROPORTIONAL_TO_AREA');
      t.enum('common_area_allocation_method', ['FLOOR_COMMON_PLUS_BUILDING_COMMON', 'UNIFORM_ALL_UNITS', 'CUSTOM']).defaultTo('FLOOR_COMMON_PLUS_BUILDING_COMMON');
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 5. Master for Works (Standard WBS Catalogue)
  if (!(await knex.schema.hasTable('master_works'))) {
    await knex.schema.createTable('master_works', t => {
      t.increments('id_master_works').primary();
      t.string('work_code', 50).notNullable().unique();
      t.string('work_name', 200).notNullable();
      t.enum('category', ['STRUCTURAL', 'FACILITIES_MEP', 'FINISHING', 'INDIVIDUAL_INTERIOR', 'EXTERNAL_CIVIL']).defaultTo('STRUCTURAL');
      t.enum('scope_level', ['BUILDING_COMMON', 'FLOOR_COMMON', 'INDIVIDUAL_UNIT']).defaultTo('BUILDING_COMMON');
      t.enum('default_allocation_rule', ['ALL_UNITS_AREA_BASED', 'ALL_UNITS_EQUAL', 'FLOOR_6_UNITS_EQUAL', 'INDIVIDUAL_UNIT_ONLY', 'CUSTOM']).defaultTo('ALL_UNITS_AREA_BASED');
      t.decimal('standard_budget_estimate', 14, 2).defaultTo(0);
      t.text('standard_scope_notes').nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 6. Master for Vendor Profiles (Extended categorization)
  if (!(await knex.schema.hasTable('master_vendor_categories'))) {
    await knex.schema.createTable('master_vendor_categories', t => {
      t.increments('id_vendor_cat').primary();
      t.string('category_code', 50).notNullable().unique();
      t.string('category_name', 150).notNullable();
      t.string('trade_type', 150).notNullable();
      t.decimal('default_retention_percent', 5, 2).defaultTo(5.00);
      t.string('default_payment_terms', 100).defaultTo('Net 30');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  // down if needed
};
