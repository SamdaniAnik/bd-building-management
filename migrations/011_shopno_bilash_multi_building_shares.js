exports.up = async function(knex) {
  // 0. Add id_projects to buildings table if not present
  const hasProjInBuildings = await knex.schema.hasColumn('buildings', 'id_projects');
  if (!hasProjInBuildings) {
    await knex.schema.alterTable('buildings', t => {
      t.integer('id_projects').unsigned().nullable();
    });
  }

  // 1. Add common share columns to units table
  const hasCommonShare = await knex.schema.hasColumn('units', 'is_common_share');
  if (!hasCommonShare) {
    await knex.schema.alterTable('units', t => {
      t.boolean('is_common_share').defaultTo(false);
      t.string('common_share_type', 100).nullable().defaultTo(null); // 'MOSQUE_SUITE', 'MEETING_ROOM', 'SWIMMING_POOL_SUITE', etc.
    });
  }

  // 2. Add scope_level and facility_tag to construction_works
  const hasScopeLevel = await knex.schema.hasColumn('construction_works', 'scope_level');
  if (!hasScopeLevel) {
    await knex.schema.alterTable('construction_works', t => {
      t.string('scope_level', 50).defaultTo('PROJECT_COMMON'); // 'PROJECT_COMMON', 'BUILDING_SPECIFIC', 'FLOOR_COMMON', 'INDIVIDUAL_UNIT'
      t.string('facility_tag', 100).nullable().defaultTo(null); // 'MOSQUE', 'MEETING_ROOM', 'SWIMMING_POOL', etc.
    });
  }

  // 3. Add multi-building and personal/common share fields to master_shares
  const hasPersonalShares = await knex.schema.hasColumn('master_shares', 'personal_shares_count');
  if (!hasPersonalShares) {
    await knex.schema.alterTable('master_shares', t => {
      t.integer('personal_shares_count').defaultTo(105);
      t.integer('common_shares_count').defaultTo(3);
      t.integer('total_shares_count').defaultTo(108);
      t.integer('connected_buildings_count').defaultTo(3);
      t.string('connected_campus_name', 150).nullable().defaultTo('Shopno Bilash');
    });
  }
};

exports.down = async function(knex) {
};
