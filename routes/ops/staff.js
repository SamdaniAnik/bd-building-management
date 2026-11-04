// Building staff (guards, caretaker, cleaners, lift operators…): daily attendance, salary advances, monthly payslips
// with festival (Eid / Puja) bonus, overtime and advance recovery.
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, round2, ymd, today, isMonth, daysInMonth, pick, method } = require('./common');
const { isValidBdMobile, normalizeBdMobile } = require('../../utils/bd');

const ROLES = ['GUARD', 'CARETAKER', 'CLEANER', 'LIFT_OPERATOR', 'ELECTRICIAN', 'PLUMBER', 'GARDENER', 'DRIVER', 'MANAGER', 'OTHER'];
const STAFF_FIELDS = ['full_name', 'role', 'shift', 'phone', 'nid_no', 'permanent_address', 'emergency_contact', 'join_date', 'monthly_salary_bdt',
  'payment_method', 'wallet_or_account', 'agency_name', 'notes'];
const ATT = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY'];

// ── Staff register ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const q = db('building_staff').orderBy('status').orderBy('role').orderBy('full_name');
    if (req.query.status) q.where({ status: req.query.status });
    const rows = await q;
    const adv = await db('staff_advances').where({ status: 'OPEN' }).groupBy('id_staff').select('id_staff', db.raw('SUM(amount_bdt - recovered_bdt) as open_bdt'));
    const map = Object.fromEntries(adv.map(a => [a.id_staff, num(a.open_bdt)]));
    const active = rows.filter(r => r.status === 'ACTIVE');
    res.json({ success: true, rows: rows.map(r => ({ ...r, open_advance_bdt: map[r.id_staff] || 0 })),
      summary: { active: active.length, monthly_payroll_bdt: round2(active.reduce((s, r) => s + Number(r.monthly_salary_bdt), 0)), open_advances_bdt: round2(Object.values(map).reduce((s, v) => s + v, 0)) } });
  } catch (err) { fail(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, STAFF_FIELDS);
    if (!row.full_name || !String(row.full_name).trim()) throw bad('Name is required');
    if (row.role && !ROLES.includes(row.role)) throw bad('Unknown role');
    if (row.phone) {
      if (!isValidBdMobile(row.phone)) throw bad('Enter a valid Bangladeshi mobile number (01XXXXXXXXX)');
      row.phone = normalizeBdMobile(row.phone);
    }
    if (row.nid_no && !/^(\d{10}|\d{13}|\d{17})$/.test(String(row.nid_no).replace(/\s/g, ''))) throw bad('NID number must be 10, 13 or 17 digits');
    if (!(Number(row.monthly_salary_bdt) >= 0)) throw bad('Monthly salary is required');
    if (b.id_staff) {
      await db('building_staff').where({ id_staff: b.id_staff }).update(row);
      return res.json({ success: true, message: 'Staff record updated', id: Number(b.id_staff) });
    }
    const [id] = await db('building_staff').insert({ ...row, join_date: row.join_date || today(), status: 'ACTIVE' });
    res.json({ success: true, message: 'Staff member added', id });
  } catch (err) { fail(res, err); }
});

router.post('/:id/leave', async (req, res) => {
  try {
    const n = await db('building_staff').where({ id_staff: req.params.id, status: 'ACTIVE' }).update({ status: 'LEFT', leave_date: ymd(req.body?.leave_date) || today() });
    if (!n) throw bad('Staff member is not active');
    res.json({ success: true, message: 'Marked as left' });
  } catch (err) { fail(res, err); }
});

router.post('/:id/rejoin', async (req, res) => {
  try {
    await db('building_staff').where({ id_staff: req.params.id }).update({ status: 'ACTIVE', leave_date: null });
    res.json({ success: true, message: 'Marked as active again' });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (await db('staff_payslips').where({ id_staff: req.params.id }).first()) throw bad('This person has payslips on record. Mark them as left instead.');
    await db.transaction(async trx => {
      await trx('staff_attendance').where({ id_staff: req.params.id }).del();
      await trx('staff_advances').where({ id_staff: req.params.id }).del();
      await trx('building_staff').where({ id_staff: req.params.id }).del();
    });
    res.json({ success: true, message: 'Staff record deleted' });
  } catch (err) { fail(res, err); }
});

// ── Attendance ──────────────────────────────────────────────────
// Staff on the rolls on `date`, with that day's mark (null = not marked yet).
router.get('/attendance', async (req, res) => {
  try {
    const date = ymd(req.query.date) || today();
    const staff = await db('building_staff').where(q => q.where('status', 'ACTIVE').orWhere('leave_date', '>=', date))
      .where(q => q.whereNull('join_date').orWhere('join_date', '<=', date)).orderBy('role').orderBy('full_name');
    const marks = await db('staff_attendance').where({ att_date: date });
    const map = Object.fromEntries(marks.map(m => [m.id_staff, m]));
    res.json({ success: true, date, rows: staff.map(s => ({ id_staff: s.id_staff, full_name: s.full_name, role: s.role, shift: s.shift,
      status: map[s.id_staff]?.status || null, overtime_hours: num(map[s.id_staff]?.overtime_hours), note: map[s.id_staff]?.note || '' })) });
  } catch (err) { fail(res, err); }
});

router.post('/attendance', async (req, res) => {
  try {
    const date = ymd(req.body?.date);
    if (!date) throw bad('Date is required');
    if (date > today()) throw bad('Attendance cannot be marked for a future date');
    const entries = (req.body?.entries || []).filter(e => e.id_staff && ATT.includes(e.status));
    if (!entries.length) throw bad('Mark at least one person');
    await db('staff_attendance').insert(entries.map(e => ({ id_staff: e.id_staff, att_date: date, status: e.status, overtime_hours: num(e.overtime_hours), note: e.note ? String(e.note).slice(0, 200) : null })))
      .onConflict(['id_staff', 'att_date']).merge(['status', 'overtime_hours', 'note']);
    res.json({ success: true, message: `Attendance saved for ${entries.length} staff` });
  } catch (err) { fail(res, err); }
});

async function monthAttendance(month, staffIds) {
  if (!staffIds.length) return {};
  const rows = await db('staff_attendance').whereIn('id_staff', staffIds).where('att_date', '>=', `${month}-01`).where('att_date', '<=', `${month}-${daysInMonth(month)}`)
    .groupBy('id_staff').select('id_staff',
      db.raw("SUM(status = 'PRESENT') as present"), db.raw("SUM(status = 'ABSENT') as absent"),
      db.raw("SUM(status = 'LEAVE') as leave_days"), db.raw("SUM(status = 'HALF_DAY') as half_days"), db.raw('COALESCE(SUM(overtime_hours),0) as ot_hours'));
  return Object.fromEntries(rows.map(r => [r.id_staff, { present: Number(r.present), absent: Number(r.absent), leave: Number(r.leave_days), half: Number(r.half_days), ot_hours: num(r.ot_hours) }]));
}

router.get('/attendance/month', async (req, res) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const staff = await db('building_staff').where(q => q.where('status', 'ACTIVE').orWhere('leave_date', '>=', `${month}-01`)).orderBy('full_name');
    const att = await monthAttendance(month, staff.map(s => s.id_staff));
    const days = await db('staff_attendance').whereIn('id_staff', staff.map(s => s.id_staff)).where('att_date', '>=', `${month}-01`).where('att_date', '<=', `${month}-${daysInMonth(month)}`)
      .select('id_staff', 'att_date', 'status');
    const grid = {};
    for (const d of days) (grid[d.id_staff] ||= {})[Number(ymd(d.att_date).slice(8))] = d.status;
    res.json({ success: true, month, days_in_month: daysInMonth(month), rows: staff.map(s => ({ id_staff: s.id_staff, full_name: s.full_name, role: s.role, ...(att[s.id_staff] || { present: 0, absent: 0, leave: 0, half: 0, ot_hours: 0 }), days: grid[s.id_staff] || {} })) });
  } catch (err) { fail(res, err); }
});

// ── Advances ────────────────────────────────────────────────────
router.get('/advances', async (req, res) => {
  try {
    const q = db('staff_advances as a').join('building_staff as s', 's.id_staff', 'a.id_staff').orderBy('a.given_on', 'desc').select('a.*', 's.full_name', 's.role');
    if (req.query.status) q.where('a.status', req.query.status);
    res.json({ success: true, rows: await q });
  } catch (err) { fail(res, err); }
});

router.post('/advances', async (req, res) => {
  try {
    const b = req.body || {};
    if (!(await db('building_staff').where({ id_staff: b.id_staff }).first())) throw bad('Choose a staff member');
    const amount = num(b.amount_bdt);
    if (!(amount > 0)) throw bad('Enter the advance amount');
    const [id] = await db('staff_advances').insert({ id_staff: b.id_staff, amount_bdt: amount, given_on: ymd(b.given_on) || today(),
      monthly_recovery_bdt: Math.min(amount, num(b.monthly_recovery_bdt)), reason: b.reason || null, status: 'OPEN' });
    res.json({ success: true, message: 'Advance recorded', id });
  } catch (err) { fail(res, err); }
});

router.delete('/advances/:id', async (req, res) => {
  try {
    const a = await db('staff_advances').where({ id_staff_advances: req.params.id }).first();
    if (!a) throw bad('Advance not found');
    if (Number(a.recovered_bdt) > 0) throw bad('Part of this advance has already been recovered from salary; it cannot be deleted');
    await db('staff_advances').where({ id_staff_advances: req.params.id }).del();
    res.json({ success: true, message: 'Advance deleted' });
  } catch (err) { fail(res, err); }
});

// ── Payroll ─────────────────────────────────────────────────────
// opts: { salary_month, bonus_label, bonus_percent, bonus_staff_ids?, overtime_multiplier }
async function computePayroll(opts) {
  const month = opts.salary_month;
  if (!isMonth(month)) throw bad('Choose the salary month');
  const first = `${month}-01`; const days = daysInMonth(month); const last = `${month}-${days}`;
  const staff = await db('building_staff')
    .where(q => q.whereNull('join_date').orWhere('join_date', '<=', last))
    .where(q => q.where('status', 'ACTIVE').orWhere('leave_date', '>=', first)).orderBy('role').orderBy('full_name');
  const att = await monthAttendance(month, staff.map(s => s.id_staff));
  const advances = await db('staff_advances').where({ status: 'OPEN' }).orderBy('given_on');
  const bonusPct = Math.max(0, Number(opts.bonus_percent) || 0);
  const bonusFor = Array.isArray(opts.bonus_staff_ids) && opts.bonus_staff_ids.length ? new Set(opts.bonus_staff_ids.map(Number)) : null;
  const otMult = Number(opts.overtime_multiplier) > 0 ? Number(opts.overtime_multiplier) : 2;

  return staff.map(s => {
    const basic = Number(s.monthly_salary_bdt);
    const a = att[s.id_staff] || { present: 0, absent: 0, leave: 0, half: 0, ot_hours: 0 };
    // Days off the rolls this month (joined mid-month / left mid-month) are unpaid.
    const join = s.join_date ? ymd(s.join_date) : null; const leave = s.leave_date ? ymd(s.leave_date) : null;
    const notEmployed = (join && join > first ? Number(join.slice(8)) - 1 : 0) + (leave && leave < last ? days - Number(leave.slice(8)) : 0);
    const unpaid = Math.min(days, a.absent + a.half * 0.5 + notEmployed);
    const perDay = basic / days;
    const deduction = round2(perDay * unpaid);
    const overtime = round2(perDay / 8 * otMult * a.ot_hours);
    const bonus = bonusPct && (!bonusFor || bonusFor.has(s.id_staff)) ? round2(basic * bonusPct / 100) : 0;
    const gross = round2(basic - deduction + overtime + bonus);
    let recovery = 0;
    for (const adv of advances.filter(x => x.id_staff === s.id_staff)) {
      const left = round2(Number(adv.amount_bdt) - Number(adv.recovered_bdt));
      const instalment = Number(adv.monthly_recovery_bdt) > 0 ? Math.min(left, Number(adv.monthly_recovery_bdt)) : left;
      recovery = round2(recovery + instalment);
    }
    recovery = Math.min(recovery, Math.max(0, gross)); // never take home less than zero
    return { id_staff: s.id_staff, full_name: s.full_name, role: s.role, payment_method: s.payment_method, wallet_or_account: s.wallet_or_account,
      salary_month: month, basic_bdt: basic, days_in_month: days, unpaid_days: unpaid, absence_deduction_bdt: deduction,
      overtime_hours: a.ot_hours, overtime_bdt: overtime, bonus_bdt: bonus, bonus_label: bonus ? (opts.bonus_label || 'Festival bonus') : null,
      advance_recovery_bdt: recovery, other_deduction_bdt: 0, net_pay_bdt: round2(gross - recovery), attendance: a };
  });
}

router.post('/payroll/preview', async (req, res) => {
  try {
    const rows = await computePayroll(req.body || {});
    const existing = await db('staff_payslips').where({ salary_month: req.body.salary_month }).select('id_staff', 'status');
    const ex = Object.fromEntries(existing.map(e => [e.id_staff, e.status]));
    res.json({ success: true, rows: rows.map(r => ({ ...r, existing_status: ex[r.id_staff] || null })), total_net_bdt: round2(rows.reduce((s, r) => s + r.net_pay_bdt, 0)) });
  } catch (err) { fail(res, err); }
});

// Writes DRAFT payslips. Existing drafts for the month are recalculated; PAID ones are never touched.
router.post('/payroll/generate', async (req, res) => {
  try {
    const rows = await computePayroll(req.body || {});
    let created = 0; let updated = 0; let locked = 0;
    await db.transaction(async trx => {
      const existing = Object.fromEntries((await trx('staff_payslips').where({ salary_month: req.body.salary_month }).forUpdate()).map(e => [e.id_staff, e]));
      for (const r of rows) {
        const { full_name, role, payment_method, wallet_or_account, attendance, ...slip } = r;
        const ex = existing[r.id_staff];
        if (ex?.status === 'PAID') { locked++; continue; }
        if (ex) { await trx('staff_payslips').where({ id_payslips: ex.id_payslips }).update(slip); updated++; }
        else { await trx('staff_payslips').insert({ ...slip, status: 'DRAFT' }); created++; }
      }
    });
    res.json({ success: true, created, updated, locked, message: `${created} payslip(s) created${updated ? `, ${updated} draft(s) recalculated` : ''}${locked ? `, ${locked} already paid and left unchanged` : ''}` });
  } catch (err) { fail(res, err); }
});

router.get('/payslips', async (req, res) => {
  try {
    const q = db('staff_payslips as p').join('building_staff as s', 's.id_staff', 'p.id_staff').orderBy('p.salary_month', 'desc').orderBy('s.full_name')
      .select('p.*', 's.full_name', 's.role', 's.phone', 's.nid_no', 's.payment_method as default_method', 's.wallet_or_account');
    if (isMonth(req.query.month)) q.where('p.salary_month', req.query.month);
    if (req.query.id_staff) q.where('p.id_staff', req.query.id_staff);
    res.json({ success: true, rows: await q });
  } catch (err) { fail(res, err); }
});

router.post('/payslips/:id/adjust', async (req, res) => {
  try {
    const p = await db('staff_payslips').where({ id_payslips: req.params.id }).first();
    if (!p) throw bad('Payslip not found');
    if (p.status === 'PAID') throw bad('This payslip is already paid');
    const other = num(req.body?.other_deduction_bdt);
    const bonus = req.body?.bonus_bdt !== undefined ? num(req.body.bonus_bdt) : Number(p.bonus_bdt);
    const net = round2(Number(p.basic_bdt) - Number(p.absence_deduction_bdt) + Number(p.overtime_bdt) + bonus - Number(p.advance_recovery_bdt) - other);
    if (net < 0) throw bad('Net pay would be negative');
    await db('staff_payslips').where({ id_payslips: p.id_payslips }).update({ other_deduction_bdt: other, bonus_bdt: bonus, bonus_label: bonus ? (req.body?.bonus_label || p.bonus_label || 'Bonus') : null, net_pay_bdt: net });
    res.json({ success: true, message: 'Payslip updated' });
  } catch (err) { fail(res, err); }
});

// Pays a payslip and books its advance recovery against the oldest open advances first.
router.post('/payslips/:id/pay', async (req, res) => {
  try {
    await db.transaction(async trx => {
      const p = await trx('staff_payslips').where({ id_payslips: req.params.id }).forUpdate().first();
      if (!p) throw bad('Payslip not found');
      if (p.status === 'PAID') throw bad('This payslip is already paid');
      let toRecover = Number(p.advance_recovery_bdt);
      const advances = await trx('staff_advances').where({ id_staff: p.id_staff, status: 'OPEN' }).orderBy('given_on').forUpdate();
      for (const a of advances) {
        if (toRecover <= 0) break;
        const take = Math.min(toRecover, round2(Number(a.amount_bdt) - Number(a.recovered_bdt)));
        const recovered = round2(Number(a.recovered_bdt) + take);
        await trx('staff_advances').where({ id_staff_advances: a.id_staff_advances }).update({ recovered_bdt: recovered, status: recovered >= Number(a.amount_bdt) ? 'SETTLED' : 'OPEN' });
        toRecover = round2(toRecover - take);
      }
      await trx('staff_payslips').where({ id_payslips: p.id_payslips }).update({ status: 'PAID', paid_on: ymd(req.body?.paid_on) || today(),
        payment_method: method(req.body?.payment_method), payment_ref: req.body?.payment_ref || null });
    });
    res.json({ success: true, message: `Salary marked as paid by ${userName(req)}` });
  } catch (err) { fail(res, err); }
});

router.delete('/payslips/:id', async (req, res) => {
  try {
    const n = await db('staff_payslips').where({ id_payslips: req.params.id, status: 'DRAFT' }).del();
    if (!n) throw bad('Only draft payslips can be deleted');
    res.json({ success: true, message: 'Draft payslip deleted' });
  } catch (err) { fail(res, err); }
});

module.exports = router;

// Exposed for seeds/008_building_operations_seed.js
module.exports.computePayroll = computePayroll;
