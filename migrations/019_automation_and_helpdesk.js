// 1. Automation: scheduled jobs (monthly rent invoices & service-charge runs, overdue marking,
//    due-date SMS reminders, complaint escalation) with an on/off switch and a run log per job.
// 2. Resident helpdesk: the existing maintenance_tickets table becomes a full complaint desk —
//    reporter, staff assignment, response deadline (SLA), comment thread and resident rating.

exports.up = async function (knex) {
  // ── 1. Automation ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('automation_jobs'))) {
    await knex.schema.createTable('automation_jobs', t => {
      t.string('job_key', 50).primary();
      t.boolean('is_enabled').notNullable().defaultTo(false);
      t.timestamp('enabled_at').nullable();            // runs only for scheduled times after this
      t.enum('frequency', ['HOURLY', 'DAILY', 'MONTHLY']).notNullable().defaultTo('DAILY');
      t.integer('run_day').unsigned().nullable();      // MONTHLY: day of month (1–28)
      t.integer('run_hour').unsigned().defaultTo(9);   // DAILY / MONTHLY: hour, server local time
      t.integer('run_minute').unsigned().defaultTo(0);
      t.json('options').nullable();                    // job-specific settings
      t.timestamp('last_run_at').nullable();
      t.string('last_status', 20).nullable();          // OK | NOTHING | FAILED
      t.string('last_message', 500).nullable();
      t.string('updated_by', 150).nullable();
      t.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
  }
  if (!(await knex.schema.hasTable('automation_runs'))) {
    await knex.schema.createTable('automation_runs', t => {
      t.increments('id_runs').primary();
      t.string('job_key', 50).notNullable().index();
      t.string('triggered_by', 150).notNullable().defaultTo('Scheduler');
      t.timestamp('started_at').defaultTo(knex.fn.now());
      t.timestamp('finished_at').nullable();
      t.string('status', 20).notNullable().defaultTo('RUNNING'); // RUNNING | OK | NOTHING | FAILED
      t.string('message', 1000).nullable();
      t.json('details').nullable();
    });
  }

  // ── 2. Helpdesk ───────────────────────────────────────────────────
  // Free-text category/status so new kinds of complaint don't need a schema change.
  await knex.raw("ALTER TABLE maintenance_tickets MODIFY category VARCHAR(30) NOT NULL DEFAULT 'OTHER'");
  await knex.raw("ALTER TABLE maintenance_tickets MODIFY status VARCHAR(20) NOT NULL DEFAULT 'OPEN'");
  const cols = {
    id_tenants: t => t.integer('id_tenants').unsigned().nullable(),
    reporter_name: t => t.string('reporter_name', 150).nullable(),
    reporter_phone: t => t.string('reporter_phone', 20).nullable(),
    source: t => t.string('source', 20).notNullable().defaultTo('STAFF'), // PORTAL | STAFF | PHONE | WALK_IN
    location: t => t.string('location', 150).nullable(),               // "Kitchen", "Lift 2", "Roof tank"…
    id_staff: t => t.integer('id_staff').unsigned().nullable(),         // building_staff assigned
    due_by: t => t.timestamp('due_by').nullable(),                      // fix-by deadline from priority
    first_response_at: t => t.timestamp('first_response_at').nullable(),
    escalated_at: t => t.timestamp('escalated_at').nullable(),
    closed_at: t => t.timestamp('closed_at').nullable(),
    resolution_notes: t => t.text('resolution_notes').nullable(),
    rating: t => t.tinyint('rating').unsigned().nullable(),              // 1–5 from the resident
    rating_comment: t => t.string('rating_comment', 500).nullable(),
    reopen_count: t => t.integer('reopen_count').unsigned().notNullable().defaultTo(0),
    created_by: t => t.string('created_by', 150).nullable(),
    updated_at: t => t.timestamp('updated_at').nullable(),
  };
  for (const [name, add] of Object.entries(cols)) {
    if (!(await knex.schema.hasColumn('maintenance_tickets', name))) await knex.schema.alterTable('maintenance_tickets', add);
  }
  // Tickets lodged before this migration get a deadline so escalation treats them consistently.
  await knex.raw(`UPDATE maintenance_tickets SET due_by = DATE_ADD(created_at, INTERVAL
    (CASE priority WHEN 'EMERGENCY' THEN 4 WHEN 'HIGH' THEN 24 WHEN 'LOW' THEN 168 ELSE 72 END) HOUR) WHERE due_by IS NULL`);

  if (!(await knex.schema.hasTable('ticket_updates'))) {
    await knex.schema.createTable('ticket_updates', t => {
      t.increments('id_ticket_updates').primary();
      t.integer('id_tickets').unsigned().notNullable().index();
      t.string('author_name', 150).notNullable();
      t.string('author_type', 20).notNullable().defaultTo('STAFF'); // STAFF | RESIDENT | SYSTEM
      t.text('message').nullable();
      t.string('from_status', 20).nullable();
      t.string('to_status', 20).nullable();
      t.boolean('is_internal').notNullable().defaultTo(false); // staff-only note, hidden from the resident
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ticket_updates');
  await knex.schema.dropTableIfExists('automation_runs');
  await knex.schema.dropTableIfExists('automation_jobs');
  for (const c of ['id_tenants', 'reporter_name', 'reporter_phone', 'source', 'location', 'id_staff', 'due_by', 'first_response_at', 'escalated_at',
    'closed_at', 'resolution_notes', 'rating', 'rating_comment', 'reopen_count', 'created_by', 'updated_at']) {
    if (await knex.schema.hasColumn('maintenance_tickets', c)) await knex.schema.alterTable('maintenance_tickets', t => t.dropColumn(c));
  }
  await knex.raw("UPDATE maintenance_tickets SET status = 'OPEN' WHERE status NOT IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED')");
  await knex.raw("UPDATE maintenance_tickets SET category = 'OTHER' WHERE category NOT IN ('LIFT','GENERATOR','WATER_LEAKAGE','ELECTRICAL','SECURITY','CLEANING','OTHER')");
  await knex.raw("ALTER TABLE maintenance_tickets MODIFY category ENUM('LIFT','GENERATOR','WATER_LEAKAGE','ELECTRICAL','SECURITY','CLEANING','OTHER') DEFAULT 'OTHER'");
  await knex.raw("ALTER TABLE maintenance_tickets MODIFY status ENUM('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED') DEFAULT 'OPEN'");
  if (await knex.schema.hasTable('sms_templates')) await knex('sms_templates').whereIn('template_key', ['TICKET_RECEIVED', 'TICKET_UPDATE']).del();
};
