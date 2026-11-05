// Executive committee elections with secret ballots and ballot symbols (প্রতীক).
//
// Secrecy: who voted (election_voters) and what was voted (election_ballots + election_ballot_choices) are kept
// in separate tables with nothing linking them. Ballots get a random UUID key and only a date, never a time,
// and choice rows have no auto-increment id, so neither insert order nor timestamps can match a ballot to a voter.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('elections'))) {
    await knex.schema.createTable('elections', t => {
      t.increments('id_elections').primary();
      t.string('title', 200).notNullable();
      t.integer('id_meetings').unsigned().nullable();   // AGM / EGM the election belongs to
      t.dateTime('voting_opens_at').notNullable();
      t.dateTime('voting_closes_at').notNullable();
      t.date('term_start').notNullable();               // term of the committee being elected
      t.date('term_end').nullable();
      t.boolean('is_secret').notNullable().defaultTo(true);
      t.string('vote_basis', 20).notNullable().defaultTo('PER_OWNER'); // PER_OWNER | PER_FLAT
      t.string('status', 20).notNullable().defaultTo('DRAFT');        // DRAFT | OPEN | CLOSED | PUBLISHED | CANCELLED
      t.text('rules_note').nullable();
      t.timestamp('notice_sent_at').nullable();
      t.timestamp('published_at').nullable();
      t.boolean('committee_installed').notNullable().defaultTo(false);
      t.string('created_by', 150).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('election_positions'))) {
    await knex.schema.createTable('election_positions', t => {
      t.increments('id_positions').primary();
      t.integer('id_elections').unsigned().notNullable().index();
      t.string('position', 30).notNullable();   // PRESIDENT | VICE_PRESIDENT | GENERAL_SECRETARY | JOINT_SECRETARY | TREASURER | MEMBER
      t.integer('seats').unsigned().notNullable().defaultTo(1);
      t.integer('sort_order').unsigned().notNullable().defaultTo(0);
      t.unique(['id_elections', 'position']);
    });
  }
  if (!(await knex.schema.hasTable('election_candidates'))) {
    await knex.schema.createTable('election_candidates', t => {
      t.increments('id_candidates').primary();
      t.integer('id_elections').unsigned().notNullable().index();
      t.integer('id_positions').unsigned().notNullable().index();
      t.integer('id_owners').unsigned().notNullable();
      t.string('symbol_key', 30).notNullable();
      t.string('manifesto', 500).nullable();
      t.string('status', 20).notNullable().defaultTo('APPROVED'); // APPROVED | WITHDRAWN
      t.boolean('won_by_lot').notNullable().defaultTo(false);     // tie at the last seat settled by drawing lots
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['id_elections', 'id_owners']);    // one post per person per election
      t.unique(['id_elections', 'symbol_key']);   // each symbol used once
    });
  }
  // Who has voted — never what they voted.
  if (!(await knex.schema.hasTable('election_voters'))) {
    await knex.schema.createTable('election_voters', t => {
      t.increments('id').primary();
      t.integer('id_elections').unsigned().notNullable();
      t.integer('id_owners').unsigned().notNullable();
      t.timestamp('voted_at').defaultTo(knex.fn.now());
      t.string('channel', 20).notNullable().defaultTo('PORTAL'); // PORTAL | BOOTH
      t.string('recorded_by', 150).nullable();                   // staff member running the booth
      t.unique(['id_elections', 'id_owners']);
    });
  }
  if (!(await knex.schema.hasTable('election_ballots'))) {
    await knex.schema.createTable('election_ballots', t => {
      t.string('id_ballots', 36).primary();      // random UUID
      t.integer('id_elections').unsigned().notNullable().index();
      t.string('receipt_code', 12).notNullable().unique();
      t.integer('weight').unsigned().notNullable().defaultTo(1); // flats owned, when voting is per flat
      t.date('cast_on').notNullable();
      t.integer('id_owners').unsigned().nullable(); // only filled for an open (non-secret) election
    });
  }
  if (!(await knex.schema.hasTable('election_ballot_choices'))) {
    await knex.schema.createTable('election_ballot_choices', t => {
      t.string('id_ballots', 36).notNullable();
      t.integer('id_positions').unsigned().notNullable();
      t.integer('id_candidates').unsigned().notNullable().index();
      t.primary(['id_ballots', 'id_candidates']);
    });
  }
};

exports.down = async function (knex) {
  for (const tbl of ['election_ballot_choices', 'election_ballots', 'election_voters', 'election_candidates', 'election_positions', 'elections']) {
    await knex.schema.dropTableIfExists(tbl);
  }
  if (await knex.schema.hasTable('sms_templates')) await knex('sms_templates').where({ template_key: 'ELECTION_NOTICE' }).del();
};
