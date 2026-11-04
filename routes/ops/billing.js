// Monthly service charge billing.
// A billing run turns the active service-charge heads (Masters) plus any shared bills for the month
// (common-area electricity, generator diesel, water pump…) into one bill per flat. Bills are written to the
// existing service_charges table, so SMS due reminders, late fines and the owner portal pick them up unchanged.
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, round2, ymd, today, isMonth, dayOfMonth, unitsQuery, primaryOwners, method } = require('./common');
const { issueReceipt } = require('../../utils/receipts');
const { loadFineContext, fineFor } = require('../../utils/latefee');

const DEFAULT_STATUSES = ['OWNED', 'COMPLETED', 'HANDED_OVER'];
const ALL_STATUSES = ['AVAILABLE', 'RESERVED', 'OWNED', 'UNDER_CONSTRUCTION', 'COMPLETED', 'HANDED_OVER'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MONTH_NAMES[mo - 1]} ${y}`; };

async function billableUnits({ unit_statuses, include_common_shares }) {
  const statuses = (Array.isArray(unit_statuses) && unit_statuses.length ? unit_statuses : DEFAULT_STATUSES).filter(s => ALL_STATUSES.includes(s));
  const q = unitsQuery().whereIn('u.status', statuses).orderBy('u.id_buildings').orderBy('u.unit_number');
  if (!include_common_shares) q.where(w => w.whereNull('u.is_common_share').orWhere('u.is_common_share', false));
  return { statuses, units: await q };
}

// Works out every flat's bill lines. Pure calculation — nothing is written.
async function computeRun(input) {
  const month = input.billing_month;
  if (!isMonth(month)) throw bad('Choose the billing month');
  const { statuses, units } = await billableUnits(input);
  if (!units.length) throw bad('No flats match the selected statuses');

  const masterHeads = await db('master_service_charge_heads').where({ is_active: true }).orderBy('id_charge_heads');
  const overrides = new Map((input.heads || []).map(h => [Number(h.id_charge_heads), h]));
  const heads = masterHeads
    .map(h => { const o = overrides.get(h.id_charge_heads); return { ...h, rate: o && o.rate !== undefined && o.rate !== '' ? Number(o.rate) : Number(h.default_rate_bdt), include: o ? o.include !== false : true }; })
    .filter(h => h.include);

  const shared = (input.shared_costs || [])
    .map(s => ({ description: String(s.description || '').trim().slice(0, 150), total_bdt: num(s.total_bdt), split: s.split === 'SFT' ? 'SFT' : 'EQUAL' }))
    .filter(s => s.description && s.total_bdt > 0);

  // Meter readings for METER_CONSUMPTION heads ("2026-10" or "October 2026" in billing_month).
  let meters = [];
  if (heads.some(h => h.calculation_basis === 'METER_CONSUMPTION')) {
    meters = await db('utility_meters').whereIn('billing_month', [month, monthLabel(month)]).whereIn('id_units', units.map(u => u.id_units));
  }
  const totalSft = units.reduce((s, u) => s + Number(u.area_sqft || 0), 0);
  const warnings = [];
  if (shared.some(s => s.split === 'SFT') && !totalSft) warnings.push('Flats have no area recorded, so area-based shares are split equally instead.');

  const bills = units.map(u => {
    const sft = Number(u.area_sqft || 0);
    const lines = [];
    for (const h of heads) {
      if (h.calculation_basis === 'SFT_PROPORTIONAL') lines.push({ id_charge_heads: h.id_charge_heads, description: h.head_name_en, basis: h.calculation_basis, quantity: sft, rate_bdt: h.rate, amount_bdt: round2(sft * h.rate) });
      else if (h.calculation_basis === 'METER_CONSUMPTION') {
        const m = meters.filter(x => x.id_units === u.id_units);
        const units_ = m.reduce((s, x) => s + Number(x.consumption_units || 0), 0);
        const amt = round2(m.reduce((s, x) => s + Number(x.consumption_units || 0) * Number(x.unit_rate_bdt || 0), 0));
        lines.push({ id_charge_heads: h.id_charge_heads, description: h.head_name_en, basis: h.calculation_basis, quantity: units_, rate_bdt: null, amount_bdt: amt });
      } else lines.push({ id_charge_heads: h.id_charge_heads, description: h.head_name_en, basis: h.calculation_basis, quantity: null, rate_bdt: h.rate, amount_bdt: round2(h.rate) });
    }
    for (const s of shared) {
      const bySft = s.split === 'SFT' && totalSft > 0;
      const amt = bySft ? round2(s.total_bdt * sft / totalSft) : round2(s.total_bdt / units.length);
      lines.push({ id_charge_heads: null, description: `${s.description} (shared)`, basis: bySft ? 'SHARED_SFT' : 'SHARED_EQUAL', quantity: bySft ? sft : null, rate_bdt: null, amount_bdt: amt });
    }
    const kept = lines.filter(l => l.amount_bdt > 0);
    return { id_units: u.id_units, unit_number: u.unit_number, building_name: u.building_name, area_sqft: sft, lines: kept, total_bdt: round2(kept.reduce((s, l) => s + l.amount_bdt, 0)) };
  }).filter(b => b.total_bdt > 0);

  if (meters.length === 0 && heads.some(h => h.calculation_basis === 'METER_CONSUMPTION')) warnings.push(`No meter readings found for ${monthLabel(month)}; metered heads are left off the bills.`);
  return {
    billing_month: month, due_date: ymd(input.due_date) || dayOfMonth(month, 10), statuses,
    heads: heads.map(h => ({ id_charge_heads: h.id_charge_heads, head_name_en: h.head_name_en, head_name_bn: h.head_name_bn, calculation_basis: h.calculation_basis, rate: h.rate })),
    shared, bills, bill_count: bills.length, total_bdt: round2(bills.reduce((s, b) => s + b.total_bdt, 0)), warnings,
  };
}

// ── Setup data for the generator form ─────────────────────────────
router.get('/setup', async (req, res) => {
  try {
    const heads = await db('master_service_charge_heads').where({ is_active: true }).orderBy('id_charge_heads');
    const counts = await db('units').groupBy('status').select('status', db.raw('COUNT(*) as n'));
    res.json({ success: true, heads, unit_status_counts: counts, default_statuses: DEFAULT_STATUSES, all_statuses: ALL_STATUSES });
  } catch (err) { fail(res, err); }
});

router.post('/preview', async (req, res) => {
  try {
    const run = await computeRun(req.body || {});
    const exists = await db('service_charge_runs').where({ billing_month: run.billing_month }).first();
    res.json({ success: true, ...run, bills: run.bills.slice(0, 500), already_generated: !!exists });
  } catch (err) { fail(res, err); }
});

// Writes a billing run (one bill per flat). Throws if the month already has a run. Used by the route and the scheduler.
async function generateRun(input, generatedBy) {
  const run = await computeRun(input || {});
  let result;
  await db.transaction(async trx => {
    if (await trx('service_charge_runs').where({ billing_month: run.billing_month }).forUpdate().first()) throw bad(`Bills for ${run.billing_month} were already generated. Delete that run first to regenerate.`);
    // Flats that already have a hand-entered bill for this month are left alone.
    const already = new Set(await trx('service_charges').where({ billing_month: run.billing_month }).pluck('id_units'));
    const bills = run.bills.filter(b => !already.has(b.id_units));
    const [id_runs] = await trx('service_charge_runs').insert({
      billing_month: run.billing_month, due_date: run.due_date, bill_count: bills.length, total_bdt: round2(bills.reduce((s, b) => s + b.total_bdt, 0)),
      heads_json: JSON.stringify(run.heads), shared_costs_json: JSON.stringify(run.shared), unit_statuses: run.statuses.join(','), generated_by: generatedBy,
    });
    for (const b of bills) {
      const [id] = await trx('service_charges').insert({ id_units: b.id_units, billing_month: run.billing_month, monthly_fee: b.total_bdt, late_fee: 0, amount_paid: 0, due_date: run.due_date, status: 'UNPAID', id_runs });
      await trx('service_charge_lines').insert(b.lines.map(l => ({ ...l, id_service_charges: id })));
    }
    result = { id_runs, created: bills.length, skipped: already.size };
  });
  return { ...result, warnings: run.warnings, message: `${result.created} bill(s) generated for ${run.billing_month}${result.skipped ? ` · ${result.skipped} flat(s) already had a bill and were skipped` : ''}` };
}

router.post('/generate', async (req, res) => {
  try {
    res.json({ success: true, ...(await generateRun(req.body || {}, userName(req))) });
  } catch (err) { fail(res, err); }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await db('service_charge_runs as r').leftJoin('service_charges as c', 'c.id_runs', 'r.id_runs')
      .groupBy('r.id_runs').orderBy('r.billing_month', 'desc')
      .select('r.id_runs', 'r.billing_month', 'r.due_date', 'r.bill_count', 'r.total_bdt', 'r.generated_by', 'r.created_at',
        db.raw('COALESCE(SUM(c.amount_paid),0) as collected_bdt'), db.raw("SUM(CASE WHEN c.status = 'PAID' THEN 1 ELSE 0 END) as paid_count"));
    res.json({ success: true, rows: runs });
  } catch (err) { fail(res, err); }
});

router.delete('/runs/:id', async (req, res) => {
  try {
    await db.transaction(async trx => {
      const ids = await trx('service_charges').where({ id_runs: req.params.id }).pluck('id_service_charges');
      if (ids.length && await trx('service_charge_payments').whereIn('id_service_charges', ids).first()) throw bad('Payments have been taken against bills in this run, so it cannot be deleted');
      if (ids.length) {
        await trx('service_charge_lines').whereIn('id_service_charges', ids).del();
        await trx('service_charges').whereIn('id_service_charges', ids).del();
      }
      await trx('service_charge_runs').where({ id_runs: req.params.id }).del();
    });
    res.json({ success: true, message: 'Billing run and its unpaid bills deleted' });
  } catch (err) { fail(res, err); }
});

// ── Bills ────────────────────────────────────────────────────────
const withFine = (ctx, c) => {
  const due = round2(Number(c.monthly_fee) - Number(c.amount_paid || 0));
  const f = fineFor(ctx, 'SERVICE_CHARGE', String(c.id_service_charges), due, c.due_date);
  // No active rule → fall back to the fine typed on the bill, once it is overdue (same as SMS reminders).
  const fine = ctx.rules.SERVICE_CHARGE ? f.fine : (f.days_late > 0 && due > 0 ? Number(c.late_fee || 0) : 0);
  return { ...c, due_bdt: due, fine_bdt: fine, days_late: f.days_late, fine_waived: f.waived };
};

router.get('/bills', async (req, res) => {
  try {
    const q = db('service_charges as c').leftJoin('units as u', 'u.id_units', 'c.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
      .orderBy('c.billing_month', 'desc').orderBy('u.id_buildings').orderBy('u.unit_number').limit(2000)
      .select('c.*', 'u.unit_number', 'u.area_sqft', 'b.building_name');
    if (isMonth(req.query.month)) q.where('c.billing_month', req.query.month);
    if (req.query.status === 'DUE') q.whereNot('c.status', 'PAID');
    else if (req.query.status) q.where('c.status', req.query.status);
    if (req.query.q) q.where('u.unit_number', 'like', `%${req.query.q}%`);
    const rows = await q;
    const owners = await primaryOwners([...new Set(rows.map(r => r.id_units))]);
    const ctx = await loadFineContext();
    res.json({ success: true, rows: rows.map(r => ({ ...withFine(ctx, r), owner_name: owners[r.id_units]?.full_name || null, owner_phone: owners[r.id_units]?.phone || null })) });
  } catch (err) { fail(res, err); }
});

router.get('/bills/:id', async (req, res) => {
  try {
    const c = await db('service_charges as c').leftJoin('units as u', 'u.id_units', 'c.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
      .where('c.id_service_charges', req.params.id).select('c.*', 'u.unit_number', 'u.area_sqft', 'b.building_name').first();
    if (!c) return res.status(404).json({ success: false, message: 'Bill not found' });
    const lines = await db('service_charge_lines').where({ id_service_charges: c.id_service_charges }).orderBy('id_lines');
    const payments = await db('service_charge_payments as p').leftJoin('money_receipts as r', 'r.id_receipts', 'p.id_receipts')
      .where('p.id_service_charges', c.id_service_charges).orderBy('p.paid_on').select('p.*', 'r.receipt_no');
    const owner = (await primaryOwners([c.id_units]))[c.id_units] || null;
    res.json({ success: true, bill: withFine(await loadFineContext(), c), lines, payments, owner });
  } catch (err) { fail(res, err); }
});

router.post('/bills/:id/pay', async (req, res) => {
  try {
    const b = req.body || {};
    const amount = num(b.amount_bdt);
    const fine = num(b.fine_bdt);
    if (!(amount > 0) && !(fine > 0)) throw bad('Enter the amount received');
    let bill; let payId;
    await db.transaction(async trx => {
      bill = await trx('service_charges').where({ id_service_charges: req.params.id }).forUpdate().first();
      if (!bill) throw bad('Bill not found');
      const due = round2(Number(bill.monthly_fee) - Number(bill.amount_paid || 0));
      if (amount > due + 0.001) throw bad(`Amount is more than the Tk ${due.toLocaleString('en-IN')} still due on this bill`);
      [payId] = await trx('service_charge_payments').insert({ id_service_charges: bill.id_service_charges, amount_bdt: amount, fine_bdt: fine, paid_on: ymd(b.paid_on) || today(),
        payment_method: method(b.payment_method), reference: b.reference || null, received_by: userName(req) });
      const paid = round2(Number(bill.amount_paid || 0) + amount);
      const status = paid >= Number(bill.monthly_fee) ? 'PAID' : (ymd(bill.due_date) < today() ? 'OVERDUE' : 'UNPAID');
      await trx('service_charges').where({ id_service_charges: bill.id_service_charges }).update({ amount_paid: paid, status });
    });

    let receipt = null; let smsResult = null;
    if (b.issue_receipt !== false) {
      const unit = await unitsQuery().where('u.id_units', bill.id_units).first();
      const owner = (await primaryOwners([bill.id_units]))[bill.id_units];
      const items = [];
      if (amount > 0) items.push({ description: `Service charge – ${monthLabel(bill.billing_month)}`, amount });
      if (fine > 0) items.push({ description: `Late payment fine – ${monthLabel(bill.billing_month)}`, amount: fine });
      const r = await issueReceipt({ received_from: b.received_from || owner?.full_name || `Flat ${unit?.unit_number}`, phone: owner?.phone, id_owners: owner?.id_owners,
        address: owner?.address, unit_number: unit?.unit_number, items, payment_method: method(b.payment_method), payment_ref: b.reference,
        source_type: 'SERVICE_CHARGE_PAYMENT', source_id: payId }, { sendSms: !!b.send_sms, createdBy: userName(req) });
      receipt = r.receipt; smsResult = r.sms;
      await db('service_charge_payments').where({ id_sc_payments: payId }).update({ id_receipts: receipt.id_receipts });
    }
    res.json({ success: true, message: receipt ? `Payment recorded · receipt ${receipt.receipt_no}` : 'Payment recorded', id_receipts: receipt?.id_receipts || null, sms: smsResult });
  } catch (err) { fail(res, err); }
});

// Mark bills past their due date as OVERDUE (also done implicitly whenever a payment is taken).
const refreshOverdue = () => db('service_charges').where({ status: 'UNPAID' }).where('due_date', '<', today()).update({ status: 'OVERDUE' });

router.post('/refresh-overdue', async (req, res) => {
  try {
    const n = await refreshOverdue();
    res.json({ success: true, updated: n, message: `${n} bill(s) marked overdue` });
  } catch (err) { fail(res, err); }
});

// Month-by-month collection summary for the dashboard strip.
router.get('/summary', async (req, res) => {
  try {
    const rows = await db('service_charges').groupBy('billing_month').orderBy('billing_month', 'desc').limit(12)
      .select('billing_month', db.raw('COUNT(*) as bills'), db.raw('SUM(monthly_fee) as billed'), db.raw('SUM(amount_paid) as collected'),
        db.raw("SUM(CASE WHEN status <> 'PAID' THEN monthly_fee - amount_paid ELSE 0 END) as outstanding"),
        db.raw("SUM(CASE WHEN status <> 'PAID' THEN 1 ELSE 0 END) as unpaid"));
    res.json({ success: true, rows: rows.map(r => ({ ...r, bills: Number(r.bills), unpaid: Number(r.unpaid), billed: num(r.billed), collected: num(r.collected), outstanding: num(r.outstanding) })) });
  } catch (err) { fail(res, err); }
});

module.exports = router;

// Exposed for seeds/008_building_operations_seed.js
module.exports.computeRun = computeRun;
// Used by the scheduler (jobs/definitions.js).
module.exports.generateRun = generateRun;
module.exports.refreshOverdue = refreshOverdue;
