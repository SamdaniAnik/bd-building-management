// Recurring building upkeep: water tank cleaning, pump service, pre-monsoon roof-drain clearing, Aedes (dengue)
// breeding checks, generator service… Each task has a frequency (or a fixed month for yearly seasonal work),
// a next-due date, an assignee, and a log of when it was actually done and what it cost.
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, ymd, today, pick } = require('./common');
const { getSettings } = require('../../utils/org');
const { daysLeft, sendStaged } = require('../../utils/reminders');
const sms = require('../../utils/sms');

const CATEGORIES = ['WATER_TANK', 'PUMP', 'MONSOON', 'DENGUE', 'GENERATOR', 'LIFT', 'FIRE', 'ELECTRICAL', 'PEST_CONTROL', 'CLEANING', 'OTHER'];

// Starting set, added once. Frequencies are common practice in Dhaka buildings — adjust them to your building.
const DEFAULT_TASKS = [
  { task_key: 'WATER_TANK_CLEAN', title_en: 'Clean & disinfect underground and roof water tanks', title_bn: 'আন্ডারগ্রাউন্ড ও ছাদের পানির ট্যাংক পরিষ্কার ও জীবাণুমুক্ত করা', category: 'WATER_TANK', frequency_days: 180 },
  { task_key: 'PUMP_SERVICE', title_en: 'Water pump service (motor, bearings, foot valve)', title_bn: 'পানির পাম্প সার্ভিসিং (মোটর, বিয়ারিং, ফুট ভাল্ব)', category: 'PUMP', frequency_days: 90 },
  { task_key: 'ROOF_DRAINS', title_en: 'Clear roof drains & check roof waterproofing before monsoon', title_bn: 'বর্ষার আগে ছাদের ড্রেন পরিষ্কার ও ওয়াটারপ্রুফিং পরীক্ষা', category: 'MONSOON', frequency_days: 365, season_month: 4 },
  { task_key: 'SURFACE_DRAINS', title_en: 'Clean compound drains & sump pit (waterlogging prevention)', title_bn: 'কম্পাউন্ডের ড্রেন ও সাম্প পিট পরিষ্কার (জলাবদ্ধতা প্রতিরোধ)', category: 'MONSOON', frequency_days: 365, season_month: 5 },
  { task_key: 'AEDES_CHECK', title_en: 'Aedes / dengue check: roof, AC trays, tubs, parking — remove standing water', title_bn: 'এডিস/ডেঙ্গু পরীক্ষা: ছাদ, এসির ট্রে, টব, পার্কিং — জমে থাকা পানি সরানো', category: 'DENGUE', frequency_days: 7 },
  { task_key: 'GENERATOR_SERVICE', title_en: 'Generator service (oil, filters, battery, test run on load)', title_bn: 'জেনারেটর সার্ভিসিং (অয়েল, ফিল্টার, ব্যাটারি, লোডে টেস্ট রান)', category: 'GENERATOR', frequency_days: 90 },
  { task_key: 'LIFT_SERVICE', title_en: 'Lift monthly maintenance visit', title_bn: 'লিফটের মাসিক রক্ষণাবেক্ষণ ভিজিট', category: 'LIFT', frequency_days: 30 },
  { task_key: 'FIRE_DRILL', title_en: 'Fire drill & alarm / hose reel test', title_bn: 'ফায়ার ড্রিল এবং অ্যালার্ম / হোস রিল পরীক্ষা', category: 'FIRE', frequency_days: 180 },
  { task_key: 'EARTHING_CHECK', title_en: 'Electrical panel, earthing & substation check', title_bn: 'বৈদ্যুতিক প্যানেল, আর্থিং ও সাবস্টেশন পরীক্ষা', category: 'ELECTRICAL', frequency_days: 180 },
  { task_key: 'PEST_CONTROL', title_en: 'Common-area pest control (cockroach, rodent)', title_bn: 'কমন এরিয়ায় কীটনাশক প্রয়োগ (তেলাপোকা, ইঁদুর)', category: 'PEST_CONTROL', frequency_days: 90 },
];

async function ensureDefaults() {
  await db('upkeep_tasks').insert(DEFAULT_TASKS.map(t => ({ ...t, is_active: true }))).onConflict('task_key').ignore();
}

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return ymd(x); };

// Next due date after the task was done on `doneOn`.
// Seasonal tasks fall on the 15th of their month, at least a month after the last time.
function nextDue(task, doneOn) {
  if (task.season_month) {
    const m = String(task.season_month).padStart(2, '0');
    const after = addDays(doneOn, 30);
    let y = Number(after.slice(0, 4));
    if (`${y}-${m}-15` < after) y++;
    return `${y}-${m}-15`;
  }
  return addDays(doneOn, Math.max(1, Number(task.frequency_days) || 90));
}

const withState = t => {
  const left = t.next_due_on ? daysLeft(t.next_due_on) : null;
  return { ...t, last_done_on: ymd(t.last_done_on), next_due_on: ymd(t.next_due_on), days_left: left,
    state: !t.is_active ? 'PAUSED' : left === null ? 'UNSCHEDULED' : left < 0 ? 'OVERDUE' : left <= 7 ? 'DUE_SOON' : 'OK' };
};

router.get('/tasks', async (req, res) => {
  try {
    await ensureDefaults();
    const rows = (await db('upkeep_tasks as t').leftJoin('building_staff as s', 's.id_staff', 't.id_staff')
      .select('t.*', 's.full_name as staff_name', 's.phone as staff_phone')).map(withState);
    const order = { OVERDUE: 0, DUE_SOON: 1, UNSCHEDULED: 2, OK: 3, PAUSED: 4 };
    rows.sort((a, b) => order[a.state] - order[b.state] || (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
    const staff = await db('building_staff').where({ status: 'ACTIVE' }).orderBy('full_name').select('id_staff', 'full_name', 'role', 'phone');
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const [{ spent }] = await db('upkeep_logs').where('done_on', '>=', yearStart).sum({ spent: 'cost_bdt' });
    const count = s => rows.filter(r => r.state === s).length;
    res.json({ success: true, rows, staff, categories: CATEGORIES,
      summary: { overdue: count('OVERDUE'), due_soon: count('DUE_SOON'), unscheduled: count('UNSCHEDULED'), spent_this_year_bdt: num(spent) } });
  } catch (err) { fail(res, err); }
});

router.post('/tasks', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['title_en', 'title_bn', 'category', 'frequency_days', 'season_month', 'next_due_on', 'id_staff', 'vendor_name', 'est_cost_bdt', 'notes']);
    if (!row.title_en || !String(row.title_en).trim()) throw bad('Task name is required');
    row.category = CATEGORIES.includes(row.category) ? row.category : 'OTHER';
    row.frequency_days = Math.min(3650, Math.max(1, Math.round(Number(row.frequency_days) || 90)));
    row.season_month = row.season_month ? Math.min(12, Math.max(1, Number(row.season_month))) : null;
    row.next_due_on = ymd(row.next_due_on) || null;
    row.est_cost_bdt = num(row.est_cost_bdt);
    if (b.is_active !== undefined) row.is_active = !!b.is_active;
    if (b.id_upkeep_tasks) {
      await db('upkeep_tasks').where({ id_upkeep_tasks: b.id_upkeep_tasks }).update(row);
      return res.json({ success: true, message: 'Task updated' });
    }
    const [id] = await db('upkeep_tasks').insert({ ...row, is_active: true });
    res.json({ success: true, message: 'Task added', id });
  } catch (err) { fail(res, err); }
});

// Record the work as done; the next due date moves on from the date it was done.
router.post('/tasks/:id/done', async (req, res) => {
  try {
    const task = await db('upkeep_tasks').where({ id_upkeep_tasks: req.params.id }).first();
    if (!task) throw bad('Task not found');
    const b = req.body || {};
    const doneOn = ymd(b.done_on) || today();
    if (doneOn > today()) throw bad('The done date cannot be in the future');
    const next = nextDue(task, doneOn);
    await db.transaction(async trx => {
      await trx('upkeep_logs').insert({ id_upkeep_tasks: task.id_upkeep_tasks, done_on: doneOn, done_by: b.done_by || null, cost_bdt: num(b.cost_bdt), notes: b.notes || null, recorded_by: userName(req) });
      // A back-dated entry older than the latest one doesn't move the schedule backwards.
      if (!task.last_done_on || doneOn >= ymd(task.last_done_on)) await trx('upkeep_tasks').where({ id_upkeep_tasks: task.id_upkeep_tasks }).update({ last_done_on: doneOn, next_due_on: next });
    });
    res.json({ success: true, message: `Recorded — next due ${next}`, next_due_on: next });
  } catch (err) { fail(res, err); }
});

router.get('/tasks/:id/logs', async (req, res) => {
  try {
    res.json({ success: true, rows: await db('upkeep_logs').where({ id_upkeep_tasks: req.params.id }).orderBy('done_on', 'desc').limit(100) });
  } catch (err) { fail(res, err); }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await db.transaction(async trx => {
      await trx('upkeep_logs').where({ id_upkeep_tasks: req.params.id }).del();
      await trx('upkeep_tasks').where({ id_upkeep_tasks: req.params.id }).del();
      await trx('due_reminders_sent').where({ source: 'UPKEEP', source_id: req.params.id }).del();
    });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) { fail(res, err); }
});

// Used by the UPKEEP_REMINDERS job: texts the assigned staff member (or the manager number on the job).
async function sendUpkeepReminders({ daysAhead = 3, smsTo, createdBy = 'Scheduler' } = {}) {
  const settings = await getSettings();
  const bn = settings.sms_language !== 'en';
  const tpl = await sms.getTemplate('UPKEEP_DUE');
  if (!tpl || !tpl.is_active) return { message: 'The upkeep SMS template is switched off', sent: 0 };
  const tasks = (await db('upkeep_tasks as t').leftJoin('building_staff as s', 's.id_staff', 't.id_staff').where('t.is_active', true).whereNotNull('t.next_due_on')
    .select('t.*', 's.full_name as staff_name', 's.phone as staff_phone')).map(withState).filter(t => t.days_left <= daysAhead);
  const dmy = s => s.split('-').reverse().join('/');
  const when = left => (left < 0 ? (bn ? `${-left} দিন পেরিয়ে গেছে` : `was due ${-left} day(s) ago`) : left === 0 ? (bn ? 'আজ' : 'is due today') : (bn ? `${left} দিন বাকি` : `is due in ${left} day(s)`));
  const items = tasks.map(t => ({
    source: 'UPKEEP', source_id: t.id_upkeep_tasks, due_date: t.next_due_on, first_days: daysAhead, phone: t.staff_phone, name: t.staff_name, template_key: 'UPKEEP_DUE',
    message: left => sms.render(bn ? tpl.body_bn : tpl.body_en, { title: bn && t.title_bn ? t.title_bn : t.title_en, when: when(left), due_date: dmy(t.next_due_on), org: settings.sms_signature }),
  }));
  const r = await sendStaged(items, { fallbackPhone: smsTo, createdBy, relatedType: 'UPKEEP' });
  const sent = r.sent + r.simulated;
  return { ...r, message: `${sent} reminder(s) sent${r.failed ? `, ${r.failed} failed` : ''}${r.skipped_no_phone ? `, ${r.skipped_no_phone} skipped — no staff phone or manager number` : ''}` };
}

module.exports = router;
module.exports.sendUpkeepReminders = sendUpkeepReminders;
module.exports.nextDue = nextDue;
