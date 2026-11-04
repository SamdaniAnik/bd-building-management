// In-process scheduler for the jobs in jobs/definitions.js.
//
// Every minute it works out each enabled job's most recent scheduled time ("slot", server local time) and runs the
// job if that slot hasn't been run yet. The claim is a single conditional UPDATE, so two API processes sharing one
// database never run the same slot twice. A slot missed while the server was down runs once on the next start.
// A job only runs for slots after it was switched on — enabling a 10am SMS job at 3pm waits for tomorrow 10am.
//
// Set SCHEDULER_ENABLED=false to keep this process from running jobs (e.g. on a second API instance).
const { db } = require('../db/schemas');
const { JOBS, resolveOptions } = require('./definitions');

const TICK_MS = 60 * 1000;
const running = new Set();
let timer = null;

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// Most recent scheduled time at or before `now`.
function lastSlot(job, now = new Date()) {
  const minute = Number(job.run_minute) || 0;
  const hour = Number(job.run_hour) || 0;
  if (job.frequency === 'HOURLY') {
    const s = new Date(now); s.setMinutes(minute, 0, 0);
    if (s > now) s.setHours(s.getHours() - 1);
    return s;
  }
  if (job.frequency === 'MONTHLY') {
    const day = Math.min(Math.max(1, Number(job.run_day) || 1), 28);
    let s = new Date(now.getFullYear(), now.getMonth(), Math.min(day, daysIn(now.getFullYear(), now.getMonth())), hour, minute);
    if (s > now) s = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(day, daysIn(now.getFullYear(), now.getMonth() - 1)), hour, minute);
    return s;
  }
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
  if (s > now) s.setDate(s.getDate() - 1);
  return s;
}

// Next scheduled time strictly after `now`.
function nextSlot(job, now = new Date()) {
  const last = lastSlot(job, now);
  if (job.frequency === 'HOURLY') return new Date(last.getTime() + 3600000);
  if (job.frequency === 'MONTHLY') {
    const day = Math.min(Math.max(1, Number(job.run_day) || 1), 28);
    return new Date(last.getFullYear(), last.getMonth() + 1, day, last.getHours(), last.getMinutes());
  }
  const n = new Date(last); n.setDate(n.getDate() + 1);
  return n;
}

// A slot is pending when it is after the job was switched on and hasn't been run.
const isPending = (job, slot) => job.is_enabled && job.enabled_at && slot >= new Date(job.enabled_at) && (!job.last_run_at || new Date(job.last_run_at) < slot);

function nextRunAt(job, now = new Date()) {
  if (!job.is_enabled) return null;
  const slot = lastSlot(job, now);
  return isPending(job, slot) ? now : nextSlot(job, now);
}

// Creates any job rows that don't exist yet, with their defaults.
async function ensureJobs() {
  const rows = Object.entries(JOBS).map(([job_key, def]) => {
    const d = def.defaults;
    return { job_key, is_enabled: !!d.is_enabled, enabled_at: d.is_enabled ? new Date() : null, frequency: d.frequency,
      run_day: d.run_day ?? null, run_hour: d.run_hour ?? 0, run_minute: d.run_minute ?? 0, options: JSON.stringify(resolveOptions(job_key, {})) };
  });
  await db('automation_jobs').insert(rows).onConflict('job_key').ignore();
}

// Runs one job now and records it. Never throws; returns the run row.
async function runJob(key, triggeredBy = 'Scheduler') {
  const def = JOBS[key];
  if (!def) throw Object.assign(new Error('Unknown job'), { status: 404 });
  if (running.has(key)) throw Object.assign(new Error('This job is already running'), { status: 409 });
  running.add(key);
  const [id_runs] = await db('automation_runs').insert({ job_key: key, triggered_by: triggeredBy, status: 'RUNNING' });
  let result;
  try {
    const job = await db('automation_jobs').where({ job_key: key }).first();
    const r = await def.run(resolveOptions(key, job?.options));
    result = { status: r.status === 'NOTHING' ? 'NOTHING' : 'OK', message: String(r.message || 'Done').slice(0, 1000), details: r.details ?? null };
  } catch (err) {
    console.error(`[scheduler] ${key} failed:`, err);
    result = { status: 'FAILED', message: String(err.message || err).slice(0, 1000), details: null };
  } finally {
    running.delete(key);
  }
  await db('automation_runs').where({ id_runs }).update({ status: result.status, message: result.message, finished_at: new Date(),
    details: result.details == null ? null : JSON.stringify(result.details) });
  await db('automation_jobs').where({ job_key: key }).update({ last_status: result.status, last_message: result.message.slice(0, 500) });
  return { id_runs, job_key: key, ...result };
}

async function tick() {
  const now = new Date();
  let jobs;
  try { jobs = await db('automation_jobs').where({ is_enabled: true }); }
  catch (err) { console.error('[scheduler] cannot read jobs:', err.message); return; }
  for (const job of jobs) {
    if (!JOBS[job.job_key] || running.has(job.job_key)) continue;
    const slot = lastSlot(job, now);
    if (!isPending(job, slot)) continue;
    // Claim the slot; only one process wins.
    const claimed = await db('automation_jobs').where({ job_key: job.job_key })
      .where(q => q.whereNull('last_run_at').orWhere('last_run_at', '<', slot)).update({ last_run_at: now });
    if (!claimed) continue;
    runJob(job.job_key, 'Scheduler').catch(err => console.error(`[scheduler] ${job.job_key}:`, err.message));
  }
}

async function start() {
  if (String(process.env.SCHEDULER_ENABLED || 'true').toLowerCase() === 'false') {
    console.log(' Scheduler:         disabled (SCHEDULER_ENABLED=false)');
    return;
  }
  try {
    await ensureJobs();
    // Runs left RUNNING by a crash or restart will never finish.
    await db('automation_runs').where({ status: 'RUNNING' }).update({ status: 'FAILED', message: 'Interrupted (server restarted)', finished_at: new Date() });
  } catch (err) {
    console.error('[scheduler] not started — run the migrations first (npx knex migrate:latest):', err.message);
    return;
  }
  console.log(' Scheduler:         running (checks every minute)');
  tick();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
}

const stop = () => { if (timer) clearInterval(timer); timer = null; };
const isRunning = key => running.has(key);

module.exports = { start, stop, tick, runJob, ensureJobs, lastSlot, nextSlot, nextRunAt, isRunning };
