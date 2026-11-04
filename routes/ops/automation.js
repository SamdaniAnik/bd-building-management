// Automation settings: switch scheduled jobs on/off, set their time, run one now, and see the run log.
// Any staff member can view and "run now"; only admins change schedules.
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName } = require('./common');
const { requireRole } = require('../../middleware/auth');
const { isValidBdMobile, normalizeBdMobile } = require('../../utils/bd');
const { JOBS, resolveOptions } = require('../../jobs/definitions');
const scheduler = require('../../jobs/scheduler');
const sms = require('../../utils/sms');

const parse = v => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

router.get('/jobs', async (req, res) => {
  try {
    await scheduler.ensureJobs();
    const rows = await db('automation_jobs');
    const byKey = Object.fromEntries(rows.map(r => [r.job_key, r]));
    const now = new Date();
    const jobs = Object.entries(JOBS).map(([key, def]) => {
      const j = byKey[key];
      return {
        job_key: key, title: def.title, title_bn: def.title_bn, description: def.description, description_bn: def.description_bn,
        frequencies: def.frequencies, option_fields: def.options,
        is_enabled: !!j.is_enabled, frequency: j.frequency, run_day: j.run_day, run_hour: j.run_hour, run_minute: j.run_minute,
        options: resolveOptions(key, j.options), last_run_at: j.last_run_at, last_status: j.last_status, last_message: j.last_message,
        updated_by: j.updated_by, next_run_at: scheduler.nextRunAt(j, now), running: scheduler.isRunning(key),
      };
    });
    const smsStatus = sms.providerStatus();
    res.json({ success: true, jobs, server_time: now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      scheduler_enabled: String(process.env.SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false', sms: smsStatus });
  } catch (err) { fail(res, err); }
});

router.put('/jobs/:key', requireRole('admin'), async (req, res) => {
  try {
    const key = req.params.key;
    const def = JOBS[key];
    if (!def) throw bad('Unknown job');
    const b = req.body || {};
    const job = await db('automation_jobs').where({ job_key: key }).first();
    if (!job) throw bad('Unknown job');
    const patch = { updated_by: userName(req) };
    let scheduleChanged = false;

    if (b.frequency !== undefined) {
      if (!def.frequencies.includes(b.frequency)) throw bad(`This job can run ${def.frequencies.join(' or ').toLowerCase()} only`);
      if (b.frequency !== job.frequency) { patch.frequency = b.frequency; scheduleChanged = true; }
    }
    const int = (v, lo, hi, label) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${label} must be between ${lo} and ${hi}`);
      return n;
    };
    if (b.run_day !== undefined && b.run_day !== null) { const v = int(b.run_day, 1, 28, 'Day of month'); if (v !== job.run_day) { patch.run_day = v; scheduleChanged = true; } }
    if (b.run_hour !== undefined) { const v = int(b.run_hour, 0, 23, 'Hour'); if (v !== job.run_hour) { patch.run_hour = v; scheduleChanged = true; } }
    if (b.run_minute !== undefined) { const v = int(b.run_minute, 0, 59, 'Minute'); if (v !== job.run_minute) { patch.run_minute = v; scheduleChanged = true; } }
    if ((patch.frequency || job.frequency) === 'MONTHLY' && !(patch.run_day || job.run_day)) patch.run_day = 1;

    if (b.options !== undefined) {
      const opts = resolveOptions(key, b.options);
      for (const o of def.options) {
        if (o.type === 'phone' && opts[o.key]) {
          if (!isValidBdMobile(opts[o.key])) throw bad(`${o.label}: not a valid Bangladeshi mobile number`);
          opts[o.key] = normalizeBdMobile(opts[o.key]);
        }
      }
      patch.options = JSON.stringify(opts);
    }

    if (b.is_enabled !== undefined) patch.is_enabled = !!b.is_enabled;
    const nowEnabled = patch.is_enabled ?? !!job.is_enabled;
    // Switching on, or moving the time, starts from the next scheduled time rather than firing for one already past.
    if (nowEnabled && (!job.is_enabled || scheduleChanged)) patch.enabled_at = new Date();

    await db('automation_jobs').where({ job_key: key }).update(patch);
    const saved = await db('automation_jobs').where({ job_key: key }).first();
    res.json({ success: true, message: `${def.title}: ${saved.is_enabled ? 'on' : 'off'}`, next_run_at: scheduler.nextRunAt(saved) });
  } catch (err) { fail(res, err); }
});

router.post('/jobs/:key/run', async (req, res) => {
  try {
    if (!JOBS[req.params.key]) throw bad('Unknown job');
    await scheduler.ensureJobs();
    const r = await scheduler.runJob(req.params.key, userName(req));
    res.status(r.status === 'FAILED' ? 500 : 200).json({ success: r.status !== 'FAILED', ...r, message: r.message });
  } catch (err) { fail(res, err); }
});

router.get('/runs', async (req, res) => {
  try {
    const q = db('automation_runs').orderBy('id_runs', 'desc').limit(Math.min(500, Number(req.query.limit) || 100));
    if (req.query.job && JOBS[req.query.job]) q.where('job_key', req.query.job);
    if (req.query.status) q.where('status', req.query.status);
    const rows = await q;
    res.json({ success: true, rows: rows.map(r => ({ ...r, details: parse(r.details), title: JOBS[r.job_key]?.title || r.job_key, title_bn: JOBS[r.job_key]?.title_bn })) });
  } catch (err) { fail(res, err); }
});

module.exports = router;
