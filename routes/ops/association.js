// Flat owners' association: general meetings (AGM / EGM) and committee meetings with attendance, quorum,
// minutes and resolutions; the managing committee; the reserve (sinking) fund; the yearly income & expenditure
// statement (Bangladesh fiscal year, July–June); and a per-owner zakat statement.
// /zakat/portal is the only route flat-owner logins may reach (see app.js).
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, round2, ymd, today, pick, method } = require('./common');
const { isValidBdMobile, normalizeBdMobile, fiscalYearOf } = require('../../utils/bd');
const { getSettings } = require('../../utils/org');
const sms = require('../../utils/sms');

const MEETING_TYPES = ['AGM', 'EGM', 'COMMITTEE'];
const MEETING_STATUS = ['SCHEDULED', 'HELD', 'ADJOURNED', 'CANCELLED'];
const POSITIONS = ['PRESIDENT', 'VICE_PRESIDENT', 'GENERAL_SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'MEMBER'];
const ENTRY_TYPES = ['OPENING', 'CONTRIBUTION', 'INTEREST', 'WITHDRAWAL', 'ADJUSTMENT'];
const RESULTS = ['PASSED', 'REJECTED', 'DEFERRED'];

const activeOwnership = q => q.where(w => w.whereNull('uo.status').orWhere('uo.status', 'ACTIVE'));

// Owners with at least one active flat — the association's members.
const members = () => activeOwnership(db('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners').join('units as u', 'u.id_units', 'uo.id_units'))
  .groupBy('o.id_owners', 'o.full_name', 'o.phone')
  .select('o.id_owners', 'o.full_name', 'o.phone', db.raw("GROUP_CONCAT(DISTINCT u.unit_number ORDER BY u.unit_number SEPARATOR ', ') as flats"), db.raw('COUNT(DISTINCT u.id_units) as flat_count'))
  .orderBy('o.full_name');

const parseJson = v => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return null; } };

// "2025-26" → { from: '2025-07-01', to: '2026-06-30' }
function fyRange(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(fy || ''));
  if (!m) throw bad('Fiscal year must look like 2025-26');
  const y = Number(m[1]);
  return { from: `${y}-07-01`, to: `${y + 1}-06-30` };
}

// ── Overview ────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [mem, committee, next, reserve] = await Promise.all([
      members(),
      currentCommittee(),
      db('association_meetings').where('status', 'SCHEDULED').where('meeting_at', '>=', db.fn.now()).orderBy('meeting_at').first(),
      reserveSummary(),
    ]);
    const lastAgm = await db('association_meetings').where({ meeting_type: 'AGM', status: 'HELD' }).orderBy('meeting_at', 'desc').first();
    res.json({ success: true, members: mem.length, committee, next_meeting: next || null, last_agm: lastAgm || null, reserve_balance_bdt: reserve.balance_bdt,
      agm_overdue: !lastAgm || (Date.now() - new Date(lastAgm.meeting_at).getTime()) > 400 * 86400000 });
  } catch (err) { fail(res, err); }
});

// ── Meetings ────────────────────────────────────────────────────
router.get('/meetings', async (req, res) => {
  try {
    const rows = await db('association_meetings as m').leftJoin('meeting_attendance as a', 'a.id_meetings', 'm.id_meetings')
      .groupBy('m.id_meetings').orderBy('m.meeting_at', 'desc').select('m.*', db.raw('COUNT(a.id) as present_count'));
    const total = (await members()).length;
    res.json({ success: true, members: total, rows: rows.map(r => ({ ...r, resolutions: parseJson(r.resolutions) || [], present_count: Number(r.present_count),
      quorum_needed: Math.ceil(total * Number(r.quorum_percent) / 100), quorum_met: Number(r.present_count) >= Math.ceil(total * Number(r.quorum_percent) / 100) })) });
  } catch (err) { fail(res, err); }
});

router.post('/meetings', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['meeting_type', 'title', 'meeting_at', 'venue', 'agenda', 'quorum_percent', 'status', 'chaired_by', 'minutes']);
    if (!row.title || !String(row.title).trim()) throw bad('Meeting title is required');
    if (!row.meeting_at || Number.isNaN(new Date(row.meeting_at).getTime())) throw bad('Meeting date & time is required');
    row.meeting_at = new Date(row.meeting_at);
    if (row.meeting_type && !MEETING_TYPES.includes(row.meeting_type)) throw bad('Unknown meeting type');
    if (row.status && !MEETING_STATUS.includes(row.status)) throw bad('Unknown status');
    if (row.quorum_percent !== undefined) row.quorum_percent = Math.min(100, Math.max(0, Number(row.quorum_percent) || 0));
    if (b.resolutions !== undefined) {
      const list = (Array.isArray(b.resolutions) ? b.resolutions : []).map(r => ({ text: String(r.text || '').trim().slice(0, 1000), result: RESULTS.includes(r.result) ? r.result : 'PASSED' })).filter(r => r.text);
      row.resolutions = JSON.stringify(list);
    }
    if (b.id_meetings) {
      await db('association_meetings').where({ id_meetings: b.id_meetings }).update(row);
      return res.json({ success: true, message: 'Meeting saved', id: Number(b.id_meetings) });
    }
    const [id] = await db('association_meetings').insert({ ...row, created_by: userName(req) });
    res.json({ success: true, message: 'Meeting scheduled', id });
  } catch (err) { fail(res, err); }
});

router.delete('/meetings/:id', async (req, res) => {
  try {
    await db.transaction(async trx => {
      await trx('meeting_attendance').where({ id_meetings: req.params.id }).del();
      await trx('committee_members').where({ id_meetings: req.params.id }).update({ id_meetings: null });
      await trx('association_meetings').where({ id_meetings: req.params.id }).del();
    });
    res.json({ success: true, message: 'Meeting deleted' });
  } catch (err) { fail(res, err); }
});

router.get('/meetings/:id/attendance', async (req, res) => {
  try {
    const m = await db('association_meetings').where({ id_meetings: req.params.id }).first();
    if (!m) throw bad('Meeting not found');
    const marks = new Map((await db('meeting_attendance').where({ id_meetings: m.id_meetings })).map(a => [a.id_owners, a]));
    const list = (await members()).map(o => ({ ...o, present: marks.has(o.id_owners), attended_as: marks.get(o.id_owners)?.attended_as || 'IN_PERSON', proxy_name: marks.get(o.id_owners)?.proxy_name || '' }));
    const present = list.filter(o => o.present).length;
    const needed = Math.ceil(list.length * Number(m.quorum_percent) / 100);
    res.json({ success: true, meeting: { ...m, resolutions: parseJson(m.resolutions) || [] }, rows: list, present, needed, quorum_met: present >= needed });
  } catch (err) { fail(res, err); }
});

// Body: { present: [{ id_owners, attended_as, proxy_name }] } — replaces the whole register.
router.put('/meetings/:id/attendance', async (req, res) => {
  try {
    const m = await db('association_meetings').where({ id_meetings: req.params.id }).first();
    if (!m) throw bad('Meeting not found');
    const list = Array.isArray(req.body?.present) ? req.body.present : [];
    const rows = list.filter(p => Number(p.id_owners) > 0).map(p => {
      const proxy = p.attended_as === 'PROXY';
      if (proxy && !String(p.proxy_name || '').trim()) throw bad('Enter the proxy’s name for every owner attending by proxy');
      return { id_meetings: m.id_meetings, id_owners: Number(p.id_owners), attended_as: proxy ? 'PROXY' : 'IN_PERSON', proxy_name: proxy ? String(p.proxy_name).trim().slice(0, 150) : null };
    });
    await db.transaction(async trx => {
      await trx('meeting_attendance').where({ id_meetings: m.id_meetings }).del();
      if (rows.length) await trx('meeting_attendance').insert(rows);
    });
    res.json({ success: true, message: `Attendance saved — ${rows.length} present` });
  } catch (err) { fail(res, err); }
});

// SMS the meeting notice to every member (one per phone number).
router.post('/meetings/:id/notice', async (req, res) => {
  try {
    const m = await db('association_meetings').where({ id_meetings: req.params.id }).first();
    if (!m) throw bad('Meeting not found');
    if (m.status !== 'SCHEDULED') throw bad('Only a scheduled meeting can be announced');
    const settings = await getSettings();
    const bn = settings.sms_language !== 'en';
    const tpl = await sms.getTemplate('MEETING_NOTICE');
    if (!tpl || !tpl.is_active) throw bad('The meeting notice SMS template is switched off (Collections → SMS templates)');
    const d = new Date(m.meeting_at);
    const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const seen = new Set();
    const out = { sent: 0, failed: 0, skipped: 0 };
    for (const o of await members()) {
      const msisdn = sms.toMsisdn(o.phone);
      if (!msisdn || seen.has(msisdn)) { out.skipped++; continue; }
      seen.add(msisdn);
      const r = await sms.sendSms({ to: o.phone, recipient_name: o.full_name, template_key: 'MEETING_NOTICE', related_type: 'MEETING', related_key: String(m.id_meetings), created_by: userName(req),
        message: sms.render(bn ? tpl.body_bn : tpl.body_en, { name: o.full_name, title: m.title, when, venue: m.venue || (bn ? 'ভবনের কমিউনিটি হল' : 'the community hall'), org: settings.sms_signature }) });
      out[r.status === 'FAILED' ? 'failed' : 'sent']++;
    }
    await db('association_meetings').where({ id_meetings: m.id_meetings }).update({ notice_sent_at: new Date() });
    res.json({ success: true, message: `Notice sent to ${out.sent} owner(s)${out.failed ? `, ${out.failed} failed` : ''}${out.skipped ? `, ${out.skipped} skipped (no valid / duplicate number)` : ''}`, ...out });
  } catch (err) { fail(res, err); }
});

// ── Managing committee ──────────────────────────────────────────
function currentCommittee() {
  const t = today();
  return db('committee_members').where('term_start', '<=', t).where(w => w.whereNull('term_end').orWhere('term_end', '>=', t))
    .orderByRaw(`FIELD(position, ${POSITIONS.map(() => '?').join(',')})`, POSITIONS).orderBy('member_name');
}

router.get('/committee', async (req, res) => {
  try {
    const t = today();
    const all = await db('committee_members as c').leftJoin('association_meetings as m', 'm.id_meetings', 'c.id_meetings')
      .orderBy('c.term_start', 'desc').orderByRaw(`FIELD(c.position, ${POSITIONS.map(() => '?').join(',')})`, POSITIONS)
      .select('c.*', 'm.title as elected_at_title');
    const rows = all.map(c => ({ ...c, term_start: ymd(c.term_start), term_end: ymd(c.term_end), current: ymd(c.term_start) <= t && (!c.term_end || ymd(c.term_end) >= t) }));
    res.json({ success: true, rows, positions: POSITIONS, owners: await members(), meetings: await db('association_meetings').whereIn('meeting_type', ['AGM', 'EGM']).orderBy('meeting_at', 'desc').select('id_meetings', 'title', 'meeting_at') });
  } catch (err) { fail(res, err); }
});

router.post('/committee', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['id_owners', 'member_name', 'phone', 'position', 'term_start', 'term_end', 'id_meetings']);
    if (row.id_owners) {
      const o = await db('owners').where({ id_owners: row.id_owners }).first();
      if (!o) throw bad('Owner not found');
      row.member_name = row.member_name || o.full_name;
      row.phone = row.phone || o.phone;
    }
    if (!row.member_name || !String(row.member_name).trim()) throw bad('Member name is required');
    if (!POSITIONS.includes(row.position)) throw bad('Choose a position');
    row.term_start = ymd(row.term_start);
    if (!row.term_start) throw bad('Term start date is required');
    row.term_end = ymd(row.term_end) || null;
    if (row.term_end && row.term_end < row.term_start) throw bad('Term end is before term start');
    if (row.phone) {
      if (!isValidBdMobile(row.phone)) throw bad('Phone is not a valid Bangladeshi mobile number');
      row.phone = normalizeBdMobile(row.phone);
    }
    // Only one person can hold an office-bearer post at a time.
    if (row.position !== 'MEMBER') {
      const clash = await db('committee_members').where({ position: row.position }).whereNot('id_committee', b.id_committee || 0)
        .where(w => w.whereNull('term_end').orWhere('term_end', '>=', row.term_start))
        .where(w => (row.term_end ? w.where('term_start', '<=', row.term_end) : w)).first();
      if (clash) throw bad(`${clash.member_name} already holds this post for that period — set their term end date first`);
    }
    if (b.id_committee) {
      await db('committee_members').where({ id_committee: b.id_committee }).update(row);
      return res.json({ success: true, message: 'Committee member updated' });
    }
    const [id] = await db('committee_members').insert(row);
    res.json({ success: true, message: 'Committee member added', id });
  } catch (err) { fail(res, err); }
});

router.delete('/committee/:id', async (req, res) => {
  try {
    await db('committee_members').where({ id_committee: req.params.id }).del();
    res.json({ success: true, message: 'Removed' });
  } catch (err) { fail(res, err); }
});

// ── Reserve fund ────────────────────────────────────────────────
// Contributions collected through a service-charge head flagged "reserve fund" count once the bill is fully
// paid, dated by its last payment. Everything else (opening balance, bank interest, one-off contributions,
// withdrawals) is entered by hand.
async function autoContributions({ from, to } = {}) {
  const q = db('service_charges as c')
    .join('service_charge_lines as l', 'l.id_service_charges', 'c.id_service_charges')
    .join('master_service_charge_heads as h', function () { this.on('h.id_charge_heads', 'l.id_charge_heads').andOn('h.is_reserve_fund', db.raw('1')); })
    .where('c.status', 'PAID')
    .groupBy('c.id_service_charges', 'c.billing_month', 'c.id_units', 'c.due_date')
    .select('c.id_service_charges', 'c.billing_month', 'c.id_units', db.raw('SUM(l.amount_bdt) as amount_bdt'),
      db.raw('COALESCE((SELECT MAX(p.paid_on) FROM service_charge_payments p WHERE p.id_service_charges = c.id_service_charges), c.due_date) as paid_on'));
  let rows = (await q).map(r => ({ ...r, amount_bdt: num(r.amount_bdt), paid_on: ymd(r.paid_on) }));
  if (from) rows = rows.filter(r => r.paid_on >= from);
  if (to) rows = rows.filter(r => r.paid_on <= to);
  return rows;
}

async function reserveSummary({ upTo } = {}) {
  const manual = db('reserve_fund_entries');
  if (upTo) manual.where('entry_date', '<=', upTo);
  const [m, auto] = await Promise.all([manual.select('entry_type').sum({ total: 'amount_bdt' }).groupBy('entry_type'), autoContributions({ to: upTo })]);
  const by = Object.fromEntries(m.map(r => [r.entry_type, num(r.total)]));
  const autoTotal = num(auto.reduce((s, r) => s + r.amount_bdt, 0));
  const balance = round2(Object.values(by).reduce((s, v) => s + v, 0) + autoTotal);
  return { balance_bdt: balance, by_type: { ...by, AUTO_SERVICE_CHARGE: autoTotal } };
}

router.get('/reserve', async (req, res) => {
  try {
    const [entries, auto, summary, heads, proposals] = await Promise.all([
      db('reserve_fund_entries as e').leftJoin('units as u', 'u.id_units', 'e.id_units').leftJoin('committee_proposals as p', 'p.id_proposals', 'e.id_proposals')
        .orderBy('e.entry_date', 'desc').orderBy('e.id_reserve_entries', 'desc').select('e.*', 'u.unit_number', 'p.title as proposal_title'),
      autoContributions(),
      reserveSummary(),
      db('master_service_charge_heads').where({ is_active: true }).select('id_charge_heads', 'head_name_en', 'head_name_bn', 'calculation_basis', 'default_rate_bdt', 'is_reserve_fund'),
      db('committee_proposals').whereIn('status', ['APPROVED', 'IMPLEMENTED']).orderBy('proposal_date', 'desc').select('id_proposals', 'title', 'estimated_cost', 'status'),
    ]);
    // Monthly rows for the service-charge contributions, newest first.
    const byMonth = new Map();
    for (const r of auto) { const k = r.paid_on.slice(0, 7); const x = byMonth.get(k) || { month: k, bills: 0, amount_bdt: 0 }; x.bills++; x.amount_bdt = round2(x.amount_bdt + r.amount_bdt); byMonth.set(k, x); }
    res.json({ success: true, entries: entries.map(e => ({ ...e, entry_date: ymd(e.entry_date), amount_bdt: num(e.amount_bdt) })),
      auto_by_month: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)), summary, heads, proposals, entry_types: ENTRY_TYPES });
  } catch (err) { fail(res, err); }
});

router.post('/reserve', async (req, res) => {
  try {
    const b = req.body || {};
    if (!ENTRY_TYPES.includes(b.entry_type)) throw bad('Choose an entry type');
    let amount = num(b.amount_bdt);
    if (b.entry_type === 'ADJUSTMENT' ? amount === 0 : amount <= 0) throw bad('Enter an amount greater than 0');
    const date = ymd(b.entry_date) || today();
    if (date > today()) throw bad('The entry date cannot be in the future');
    if (b.entry_type === 'OPENING' && (await db('reserve_fund_entries').where({ entry_type: 'OPENING' }).first())) throw bad('An opening balance is already recorded — use an adjustment instead');
    if (b.entry_type === 'WITHDRAWAL') {
      // Spending the fund needs an owners' decision on record.
      if (!b.id_proposals) throw bad('Link the approved committee proposal that authorises this withdrawal');
      const p = await db('committee_proposals').where({ id_proposals: b.id_proposals }).first();
      if (!p || !['APPROVED', 'IMPLEMENTED'].includes(p.status)) throw bad('That proposal is not approved');
      if (!String(b.purpose || '').trim()) throw bad('Write what the money is for');
      const { balance_bdt } = await reserveSummary();
      if (amount > balance_bdt) throw bad(`The fund only has ৳${balance_bdt.toLocaleString('en-IN')}`);
      amount = -amount;
    }
    const [id] = await db('reserve_fund_entries').insert({
      entry_date: date, entry_type: b.entry_type, amount_bdt: amount, id_units: b.id_units || null, id_proposals: b.entry_type === 'WITHDRAWAL' ? b.id_proposals : null,
      purpose: b.purpose ? String(b.purpose).slice(0, 255) : null, payment_method: b.payment_method ? method(b.payment_method) : null,
      reference: b.reference || null, notes: b.notes || null, recorded_by: userName(req),
    });
    res.json({ success: true, message: 'Entry recorded', id });
  } catch (err) { fail(res, err); }
});

router.delete('/reserve/:id', async (req, res) => {
  try {
    await db('reserve_fund_entries').where({ id_reserve_entries: req.params.id }).del();
    res.json({ success: true, message: 'Entry deleted' });
  } catch (err) { fail(res, err); }
});

// Mark which service-charge head is the monthly reserve fund contribution.
router.put('/reserve/heads/:id', async (req, res) => {
  try {
    const n = await db('master_service_charge_heads').where({ id_charge_heads: req.params.id }).update({ is_reserve_fund: !!req.body?.is_reserve_fund });
    if (!n) throw bad('Charge head not found');
    res.json({ success: true, message: req.body?.is_reserve_fund ? 'Payments for this head now go to the reserve fund' : 'Head is no longer counted as reserve fund' });
  } catch (err) { fail(res, err); }
});

// ── Yearly income & expenditure statement ──────────────────────
router.get('/statement', async (req, res) => {
  try {
    const fy = req.query.fy || fiscalYearOf(new Date());
    const { from, to } = fyRange(fy);
    const between = (q, col) => q.where(col, '>=', from).where(col, '<=', to);
    const sum = async (q, col) => num((await q.sum({ s: col }))[0].s);

    const [scCollected, scFines, autoRes, manual, payroll, upkeep, outstanding, opening, closing, upkeepByCat] = await Promise.all([
      sum(between(db('service_charge_payments'), 'paid_on'), 'amount_bdt'),
      sum(between(db('service_charge_payments'), 'paid_on'), 'fine_bdt'),
      autoContributions({ from, to }),
      between(db('reserve_fund_entries'), 'entry_date').select('entry_type').sum({ total: 'amount_bdt' }).groupBy('entry_type'),
      sum(between(db('staff_payslips').where('status', 'PAID'), 'paid_on'), 'net_pay_bdt'),
      sum(between(db('upkeep_logs'), 'done_on'), 'cost_bdt'),
      db('service_charges').whereNot('status', 'PAID').where('due_date', '<=', to).select(db.raw('SUM(monthly_fee - COALESCE(amount_paid, 0)) as s')).then(r => num(r[0].s)),
      reserveSummary({ upTo: ymd(new Date(new Date(`${from}T00:00:00`).getTime() - 86400000)) }),
      reserveSummary({ upTo: to }),
      between(db('upkeep_logs as l').join('upkeep_tasks as t', 't.id_upkeep_tasks', 'l.id_upkeep_tasks'), 'l.done_on').groupBy('t.category').select('t.category').sum({ s: 'l.cost_bdt' }),
    ]);
    const m = Object.fromEntries(manual.map(r => [r.entry_type, num(r.total)]));
    const reserveFromSc = num(autoRes.reduce((s, r) => s + r.amount_bdt, 0));
    const income = [
      { key: 'SERVICE_CHARGE', label: 'Service charge collected (excluding reserve fund share)', label_bn: 'আদায়কৃত সার্ভিস চার্জ (রিজার্ভ ফান্ড অংশ বাদে)', amount_bdt: round2(scCollected - reserveFromSc) },
      { key: 'LATE_FINES', label: 'Late payment fines', label_bn: 'বিলম্ব জরিমানা', amount_bdt: scFines },
    ];
    const expenses = [
      { key: 'PAYROLL', label: 'Staff salaries & bonuses (paid)', label_bn: 'কর্মচারীদের বেতন ও বোনাস (পরিশোধিত)', amount_bdt: payroll },
      ...upkeepByCat.map(r => ({ key: `UPKEEP_${r.category}`, label: `Upkeep — ${r.category.replace(/_/g, ' ').toLowerCase()}`, label_bn: `রক্ষণাবেক্ষণ — ${r.category}`, amount_bdt: num(r.s) })),
    ];
    const totalIncome = round2(income.reduce((s, r) => s + r.amount_bdt, 0));
    const totalExpense = round2(expenses.reduce((s, r) => s + r.amount_bdt, 0));
    res.json({ success: true, fiscal_year: fy, from, to, settings: await getSettings(),
      income, expenses, total_income_bdt: totalIncome, total_expense_bdt: totalExpense, surplus_bdt: round2(totalIncome - totalExpense), upkeep_total_bdt: upkeep,
      reserve: { opening_bdt: opening.balance_bdt, from_service_charge_bdt: reserveFromSc, contributions_bdt: num(m.CONTRIBUTION), interest_bdt: num(m.INTEREST),
        withdrawals_bdt: num(-(m.WITHDRAWAL || 0)), adjustments_bdt: round2(num(m.ADJUSTMENT) + num(m.OPENING)), closing_bdt: closing.balance_bdt },
      service_charge_outstanding_bdt: outstanding, committee: await currentCommittee() });
  } catch (err) { fail(res, err); }
});

// ── Zakat statement ─────────────────────────────────────────────
// Facts from the system that an owner needs for their own zakat calculation: rent received for their flats
// (by ownership share), tenant security deposits they hold (owed back), and dues they owe. The zakat amount
// itself is worked out in the browser from the owner's own savings figures and the nisab they choose.
async function zakatData(ownerId, from, to) {
  const owner = await db('owners').where({ id_owners: ownerId }).select('id_owners', 'full_name', 'phone', 'address').first();
  if (!owner) throw bad('Owner not found');
  const flats = await activeOwnership(db('unit_ownerships as uo').join('units as u', 'u.id_units', 'uo.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings'))
    .where('uo.id_owners', ownerId).select('u.id_units', 'u.unit_number', 'u.area_sqft', 'b.building_name', 'uo.ownership_percentage');
  const share = new Map(flats.map(f => [f.id_units, Number(f.ownership_percentage) / 100]));
  const unitIds = flats.map(f => f.id_units);
  // An agreement naming this owner as landlord is 100% theirs; one with no landlord set is shared by ownership %.
  const shareOf = a => (a.id_owners === ownerId ? 1 : !a.id_owners && share.has(a.id_units) ? share.get(a.id_units) : 0);
  const mine = q => q.where(w => w.where('a.id_owners', ownerId).orWhere(w2 => w2.whereNull('a.id_owners').whereIn('a.id_units', unitIds.length ? unitIds : [0])));

  const rentRows = await mine(db('rent_payments as p').join('rent_invoices as i', 'i.id_rent_invoices', 'p.id_rent_invoices').join('rent_agreements as a', 'a.id_rent_agreements', 'i.id_rent_agreements')
    .join('units as u', 'u.id_units', 'a.id_units')).where('p.paid_on', '>=', from).where('p.paid_on', '<=', to)
    .select('a.id_units', 'a.id_owners', 'u.unit_number', 'p.amount_bdt');
  const rentByFlat = new Map();
  for (const r of rentRows) { const k = r.unit_number; rentByFlat.set(k, round2((rentByFlat.get(k) || 0) + Number(r.amount_bdt) * shareOf(r))); }

  const deposits = (await mine(db('rent_agreements as a').join('tenants as t', 't.id_tenants', 'a.id_tenants').join('units as u', 'u.id_units', 'a.id_units')).where('a.status', 'ACTIVE')
    .select('a.id_units', 'a.id_owners', 'u.unit_number', 't.full_name as tenant', 'a.advance_deposit_bdt'))
    .map(d => ({ unit_number: d.unit_number, tenant: d.tenant, amount_bdt: round2(Number(d.advance_deposit_bdt) * shareOf(d)) })).filter(d => d.amount_bdt > 0);

  const instalments = (await db('owner_payment_schedules as s').leftJoin('units as u', 'u.id_units', 's.id_units').where('s.id_owners', ownerId)
    .whereRaw('s.paid_amount < s.target_amount').where('s.due_date', '<=', to).select('u.unit_number', 's.installment_name', 's.target_amount', 's.paid_amount', 's.due_date'))
    .map(s => ({ unit_number: s.unit_number, item: s.installment_name, due_date: ymd(s.due_date), amount_bdt: round2(Number(s.target_amount) - Number(s.paid_amount)) }));
  const serviceCharges = unitIds.length ? (await db('service_charges as c').join('units as u', 'u.id_units', 'c.id_units').whereIn('c.id_units', unitIds).whereNot('c.status', 'PAID').where('c.due_date', '<=', to)
    .select('c.id_units', 'u.unit_number', 'c.billing_month', 'c.monthly_fee', 'c.amount_paid', 'c.due_date'))
    .map(c => ({ unit_number: c.unit_number, item: `Service charge ${c.billing_month}`, due_date: ymd(c.due_date), amount_bdt: round2((Number(c.monthly_fee) - Number(c.amount_paid || 0)) * share.get(c.id_units)) })).filter(c => c.amount_bdt > 0) : [];

  const sumOf = list => round2(list.reduce((s, r) => s + r.amount_bdt, 0));
  return {
    owner, from, to, flats: flats.map(f => ({ ...f, ownership_percentage: Number(f.ownership_percentage) })),
    rent: { by_flat: [...rentByFlat].map(([unit_number, amount_bdt]) => ({ unit_number, amount_bdt })), total_bdt: round2([...rentByFlat.values()].reduce((s, v) => s + v, 0)) },
    deposits: { rows: deposits, total_bdt: sumOf(deposits) },
    dues: { rows: [...instalments, ...serviceCharges], total_bdt: sumOf([...instalments, ...serviceCharges]) },
  };
}

const zakatRange = q => {
  const to = ymd(q.to) || today();
  const from = ymd(q.from) || ymd(new Date(new Date(`${to}T00:00:00`).getTime() - 354 * 86400000)); // one lunar year back
  if (from > to) throw bad('The start date is after the end date');
  return { from, to };
};

router.get('/zakat/portal', async (req, res) => {
  try {
    const owner = await db('owners').where('login_email', req.user.email).first();
    if (!owner) return res.status(404).json({ success: false, message: 'No flat owner profile is linked to this login' });
    const { from, to } = zakatRange(req.query);
    res.json({ success: true, ...(await zakatData(owner.id_owners, from, to)) });
  } catch (err) { fail(res, err); }
});

router.get('/zakat/:ownerId', async (req, res) => {
  try {
    const { from, to } = zakatRange(req.query);
    res.json({ success: true, ...(await zakatData(Number(req.params.ownerId), from, to)), owners: await members() });
  } catch (err) { fail(res, err); }
});

module.exports = router;
module.exports.members = members;
module.exports.POSITIONS = POSITIONS;
