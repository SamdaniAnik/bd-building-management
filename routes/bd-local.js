const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const bd = require('../utils/bd');

const DEFAULT_PROJECT = 3;
const projectOf = req => parseInt(req.query.projectId || req.body?.id_projects || DEFAULT_PROJECT, 10);

const parseJson = v => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};

// mysql2 returns DATE columns as local-midnight Date objects
const toYmd = d => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const truthy = (v, dflt = true) => (v === undefined || v === null || v === '' ? dflt : !(v === false || v === 0 || v === '0' || v === 'false'));

const fail = (res, err, code = 500) => res.status(code).json({ success: false, message: err.message || String(err) });

async function logAudit(req, action, entityType, entityId, newValue) {
  try {
    await db('audit_logs').insert({
      user_name: req.body?.user_name || 'System',
      action, entity_type: entityType, entity_id: String(entityId || ''),
      new_value: newValue ? JSON.stringify(newValue) : null,
      created_at: new Date(),
    });
  } catch (e) { console.error('Audit log error:', e.message); }
}

// Working days lost between [from, to] — Fridays are the weekly holiday and not counted.
function computeLostDays(events, from, to) {
  const byDate = new Map();
  for (const e of events) {
    if (e.work_impact === 'NONE') continue;
    const weight = e.work_impact === 'FULL_STOP' ? 1 : 0.5;
    const s = new Date(`${toYmd(e.start_date)}T00:00:00`);
    const en = new Date(`${toYmd(e.end_date)}T00:00:00`);
    for (let d = new Date(s); d <= en; d.setDate(d.getDate() + 1)) {
      const k = toYmd(d);
      if (k < from || k > to || d.getDay() === 5) continue;
      byDate.set(k, Math.max(byDate.get(k) || 0, weight));
    }
  }
  return [...byDate.values()].reduce((a, b) => a + b, 0);
}

// ─────────────────────────────────────────────────────────────
// OVERVIEW (all tabs in one call)
// ─────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const pId = projectOf(req);
    const [registrations, mfs, withholding, calendar, holding, rateRows, workerCount] = await Promise.all([
      db('flat_registration_estimates').where({ id_projects: pId }).orderBy('id_reg_estimates', 'desc'),
      db('mfs_transactions').where({ id_projects: pId }).orderBy('trx_datetime', 'desc'),
      db('tax_withholding_register').where({ id_projects: pId }).orderBy('bill_date', 'desc'),
      db('bd_work_calendar').where(q => q.where({ id_projects: pId }).orWhereNull('id_projects')).orderBy('start_date', 'asc'),
      db('holding_tax_register').where({ id_projects: pId }).orderBy('unit_number', 'asc'),
      db('material_market_rates').orderBy([{ column: 'material_key' }, { column: 'rate_date', order: 'desc' }, { column: 'id_market_rates', order: 'desc' }]),
      db('labour_workers').count({ c: '*' }).first(),
    ]);

    registrations.forEach(r => { r.rates_json = parseJson(r.rates_json); r.breakdown_json = parseJson(r.breakdown_json); });
    holding.forEach(h => { h.quarters_json = parseJson(h.quarters_json); });

    // Latest market rate per material + change vs. previous entry
    const marketRates = [];
    const grouped = {};
    for (const r of rateRows) (grouped[r.material_key] ||= []).push(r);
    for (const rows of Object.values(grouped)) {
      const [latest, prev] = rows;
      const change = prev ? bd.round2(((latest.rate_bdt - prev.rate_bdt) / prev.rate_bdt) * 100) : 0;
      marketRates.push({ ...latest, previous_rate_bdt: prev ? prev.rate_bdt : null, change_percent: change, history: rows.slice(0, 12).reverse().map(x => ({ date: toYmd(x.rate_date), rate: Number(x.rate_bdt) })) });
    }

    // Calendar metrics for the current calendar year
    const year = parseInt(req.query.year || new Date().getFullYear(), 10);
    const from = `${year}-01-01`, to = `${year}-12-31`;
    const today = toYmd(new Date());
    const yearEvents = calendar.filter(e => toYmd(e.end_date) >= from && toYmd(e.start_date) <= to);
    const workers = Number(workerCount?.c || 0);
    const upcomingBonus = calendar.filter(e => e.festival_bonus_due && toYmd(e.start_date) >= today);

    const sum = (arr, f) => bd.round2(arr.reduce((s, x) => s + Number(x[f] || 0), 0));
    const currentFy = bd.fiscalYearOf(new Date());
    const fyWithholding = withholding.filter(w => w.fiscal_year === currentFy);

    res.json({
      success: true,
      fiscal_year: currentFy,
      registrations, mfs, withholding, calendar, holding, marketRates,
      defaults: { registration: bd.DEFAULT_REGISTRATION_RATES, withholding: bd.DEFAULT_WITHHOLDING },
      metrics: {
        registrationCount: registrations.length,
        registrationPipelineBdt: sum(registrations.filter(r => r.status !== 'MUTATION_DONE'), 'total_cost_bdt'),
        mfsVerifiedBdt: sum(mfs.filter(m => m.status === 'VERIFIED' && m.direction === 'RECEIVED'), 'net_amount_bdt'),
        mfsPendingCount: mfs.filter(m => m.status === 'PENDING_VERIFY').length,
        tdsFyBdt: sum(fyWithholding, 'tds_amount_bdt'),
        vdsFyBdt: sum(fyWithholding, 'vds_amount_bdt'),
        withholdingNotDeposited: withholding.filter(w => w.status === 'DEDUCTED').length,
        lostWorkingDaysYear: computeLostDays(yearEvents, from, to),
        lostWorkingDaysToDate: computeLostDays(yearEvents, from, today < to ? today : to),
        calendarYear: year,
        activeWorkers: workers,
        nextFestivalBonus: upcomingBonus[0] ? {
          title: upcomingBonus[0].title_en, date: toYmd(upcomingBonus[0].start_date),
          per_worker: Number(upcomingBonus[0].bonus_amount_per_worker_bdt), total: bd.round2(workers * upcomingBonus[0].bonus_amount_per_worker_bdt),
        } : null,
        holdingDueBdt: sum(holding, 'due_bdt'),
        holdingPaidBdt: sum(holding, 'paid_bdt'),
      },
    });
  } catch (err) { console.error('bd-local overview:', err); fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 1. FLAT REGISTRATION COST
// ─────────────────────────────────────────────────────────────
router.get('/registration/defaults', (req, res) => res.json({ success: true, rates: bd.DEFAULT_REGISTRATION_RATES }));

// POST with { preview: true } returns the calculation without saving.
router.post('/registration', async (req, res) => {
  try {
    const b = req.body || {};
    if (!(Number(b.deed_value_bdt) > 0)) return fail(res, new Error('Deed value must be greater than 0'), 400);
    if (!(Number(b.flat_area_sft) > 0)) return fail(res, new Error('Flat area (sft) must be greater than 0'), 400);
    const calc = bd.computeRegistrationCost(b);
    if (b.preview) return res.json({ success: true, calculation: calc });
    if (!b.buyer_name) return fail(res, new Error('Buyer name is required'), 400);

    const row = {
      id_projects: projectOf(req),
      id_units: b.id_units || null,
      unit_number: b.unit_number || null,
      buyer_name: b.buyer_name, buyer_nid: b.buyer_nid || null, buyer_tin: b.buyer_tin || null,
      flat_area_sft: b.flat_area_sft, deed_value_bdt: b.deed_value_bdt,
      mouza_rate_value_bdt: b.mouza_rate_value_bdt || 0,
      location_zone: b.location_zone || 'ZONE_A_DHAKA_CTG',
      is_city_corporation: truthy(b.is_city_corporation),
      include_vat: truthy(b.include_vat),
      rates_json: JSON.stringify(calc.rates),
      breakdown_json: JSON.stringify(calc.lines),
      total_cost_bdt: calc.total_cost_bdt,
      sub_registry_office: b.sub_registry_office || null,
      planned_registration_date: b.planned_registration_date || null,
      status: b.status || 'ESTIMATE',
      deed_no: b.deed_no || null,
      remarks: b.remarks || null,
    };
    let id = b.id_reg_estimates;
    if (id) await db('flat_registration_estimates').where({ id_reg_estimates: id }).update(row);
    else [id] = await db('flat_registration_estimates').insert(row);
    await logAudit(req, id === b.id_reg_estimates ? 'UPDATE' : 'CREATE', 'flat_registration_estimate', id, { unit: row.unit_number, total: row.total_cost_bdt });
    res.json({ success: true, message: 'Registration cost estimate saved', id, calculation: calc });
  } catch (err) { fail(res, err); }
});

router.delete('/registration/:id', async (req, res) => {
  try {
    await db('flat_registration_estimates').where({ id_reg_estimates: req.params.id }).del();
    res.json({ success: true, message: 'Estimate deleted' });
  } catch (err) { fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 2. MFS (bKash / Nagad / Rocket / Upay)
// ─────────────────────────────────────────────────────────────
router.post('/mfs', async (req, res) => {
  try {
    const b = req.body || {};
    const trxId = String(b.trx_id || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(trxId)) return fail(res, new Error('TrxID must be 6–20 letters/digits'), 400);
    if (!bd.isValidBdMobile(b.counterparty_wallet)) return fail(res, new Error('Wallet must be a valid 11-digit BD mobile number (01XXXXXXXXX)'), 400);
    if (b.our_wallet && !bd.isValidBdMobile(b.our_wallet)) return fail(res, new Error('Our wallet number is not a valid BD mobile number'), 400);
    const amount = Number(b.amount_bdt);
    if (!(amount > 0)) return fail(res, new Error('Amount must be greater than 0'), 400);

    const dup = await db('mfs_transactions').where({ trx_id: trxId }).first();
    if (dup) return fail(res, new Error(`TrxID ${trxId} is already recorded (${dup.counterparty_name}, ৳${dup.amount_bdt})`), 409);

    const fee = Number(b.fee_bdt || 0);
    const net = b.direction === 'SENT' ? amount + fee : amount - fee;
    const [id] = await db('mfs_transactions').insert({
      id_projects: projectOf(req),
      provider: b.provider || 'BKASH', trx_id: trxId,
      direction: b.direction || 'RECEIVED', purpose: b.purpose || 'INSTALLMENT',
      counterparty_name: b.counterparty_name, counterparty_wallet: bd.normalizeBdMobile(b.counterparty_wallet),
      our_wallet: b.our_wallet ? bd.normalizeBdMobile(b.our_wallet) : null,
      unit_number: b.unit_number || null,
      amount_bdt: amount, fee_bdt: fee, net_amount_bdt: bd.round2(net),
      trx_datetime: b.trx_datetime ? new Date(b.trx_datetime) : new Date(),
      status: 'PENDING_VERIFY', reference_voucher_no: b.reference_voucher_no || null, remarks: b.remarks || null,
    });
    await logAudit(req, 'CREATE', 'mfs_transaction', id, { trx_id: trxId, amount });
    res.json({ success: true, message: `${b.provider || 'BKASH'} transaction ${trxId} recorded — pending verification`, id });
  } catch (err) { fail(res, err); }
});

router.patch('/mfs/:id/verify', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['VERIFIED', 'REJECTED', 'PENDING_VERIFY'].includes(status)) return fail(res, new Error('Invalid status'), 400);
    const n = await db('mfs_transactions').where({ id_mfs: req.params.id }).update({
      status, verified_by: req.body.verified_by || 'Accounts', verified_at: status === 'PENDING_VERIFY' ? null : new Date(),
    });
    if (!n) return fail(res, new Error('Transaction not found'), 404);
    await logAudit(req, status, 'mfs_transaction', req.params.id, { status });
    res.json({ success: true, message: `Transaction marked ${status.replace('_', ' ').toLowerCase()}` });
  } catch (err) { fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 3. TDS / VDS WITHHOLDING
// ─────────────────────────────────────────────────────────────
router.post('/withholding', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vendor_name) return fail(res, new Error('Vendor name is required'), 400);
    if (!(Number(b.gross_amount_bdt) > 0)) return fail(res, new Error('Gross bill amount must be greater than 0'), 400);
    const billDate = b.bill_date || toYmd(new Date());
    const calc = bd.computeWithholding(b);
    if (b.preview) return res.json({ success: true, calculation: calc, fiscal_year: bd.fiscalYearOf(billDate) });

    const row = {
      id_projects: projectOf(req), id_vendors: b.id_vendors || null,
      vendor_name: b.vendor_name, vendor_bin: b.vendor_bin || null, vendor_tin: b.vendor_tin || null,
      bill_no: b.bill_no || null, bill_date: billDate, fiscal_year: bd.fiscalYearOf(billDate),
      service_category: b.service_category || 'SUPPLY_OF_GOODS',
      gross_amount_bdt: b.gross_amount_bdt, ...calc,
      tds_challan_no: b.tds_challan_no || null, vds_challan_no: b.vds_challan_no || null,
      challan_date: b.challan_date || null, mushak_6_6_no: b.mushak_6_6_no || null,
      status: b.status || 'DEDUCTED', remarks: b.remarks || null,
    };
    let id = b.id_withholding;
    if (id) await db('tax_withholding_register').where({ id_withholding: id }).update(row);
    else [id] = await db('tax_withholding_register').insert(row);
    await logAudit(req, 'SAVE', 'tax_withholding', id, { vendor: row.vendor_name, tds: calc.tds_amount_bdt, vds: calc.vds_amount_bdt });
    res.json({ success: true, message: `Withholding saved — TDS ৳${calc.tds_amount_bdt}, VDS ৳${calc.vds_amount_bdt}`, id, calculation: calc });
  } catch (err) { fail(res, err); }
});

router.patch('/withholding/:id/deposit', async (req, res) => {
  try {
    const b = req.body || {};
    const update = {
      tds_challan_no: b.tds_challan_no || null, vds_challan_no: b.vds_challan_no || null,
      challan_date: b.challan_date || toYmd(new Date()), mushak_6_6_no: b.mushak_6_6_no || null,
    };
    update.status = update.mushak_6_6_no ? 'CERTIFICATE_ISSUED' : 'DEPOSITED_TREASURY';
    const n = await db('tax_withholding_register').where({ id_withholding: req.params.id }).update(update);
    if (!n) return fail(res, new Error('Record not found'), 404);
    res.json({ success: true, message: 'Treasury challan recorded' });
  } catch (err) { fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 4. MATERIAL MARKET RATES
// ─────────────────────────────────────────────────────────────
router.post('/market-rates', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.material_key || !b.material_name_en || !b.uom) return fail(res, new Error('Material, name and unit are required'), 400);
    if (!(Number(b.rate_bdt) > 0)) return fail(res, new Error('Rate must be greater than 0'), 400);
    const [id] = await db('material_market_rates').insert({
      material_key: String(b.material_key).toUpperCase(), material_name_en: b.material_name_en,
      material_name_bn: b.material_name_bn || null, brand: b.brand || null, uom: b.uom,
      rate_bdt: b.rate_bdt, market_location: b.market_location || 'Dhaka',
      rate_date: b.rate_date || toYmd(new Date()), source: b.source || null,
    });
    res.json({ success: true, message: 'Market rate recorded', id });
  } catch (err) { fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 5. WORK CALENDAR
// ─────────────────────────────────────────────────────────────
router.post('/calendar', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title_en || !b.start_date) return fail(res, new Error('Title and start date are required'), 400);
    const end = b.end_date || b.start_date;
    if (end < b.start_date) return fail(res, new Error('End date cannot be before start date'), 400);
    const row = {
      id_projects: b.applies_all_projects ? null : projectOf(req),
      start_date: b.start_date, end_date: end, title_en: b.title_en, title_bn: b.title_bn || null,
      event_type: b.event_type || 'PUBLIC_HOLIDAY', work_impact: b.work_impact || 'FULL_STOP',
      festival_bonus_due: truthy(b.festival_bonus_due, false), bonus_amount_per_worker_bdt: b.bonus_amount_per_worker_bdt || 0,
      notes: b.notes || null,
    };
    let id = b.id_calendar;
    if (id) await db('bd_work_calendar').where({ id_calendar: id }).update(row);
    else [id] = await db('bd_work_calendar').insert(row);
    res.json({ success: true, message: 'Calendar event saved', id });
  } catch (err) { fail(res, err); }
});

router.delete('/calendar/:id', async (req, res) => {
  try {
    await db('bd_work_calendar').where({ id_calendar: req.params.id }).del();
    res.json({ success: true, message: 'Calendar event removed' });
  } catch (err) { fail(res, err); }
});

// ─────────────────────────────────────────────────────────────
// 6. HOLDING TAX
// ─────────────────────────────────────────────────────────────
router.post('/holding-tax', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.unit_number || !b.owner_name || !b.holding_no) return fail(res, new Error('Unit, owner and holding number are required'), 400);
    if (!(Number(b.annual_valuation_bdt) > 0)) return fail(res, new Error('Annual valuation must be greater than 0'), 400);
    const fy = b.fiscal_year || bd.fiscalYearOf(new Date());
    const existing = b.id_holding_tax ? await db('holding_tax_register').where({ id_holding_tax: b.id_holding_tax }).first() : null;
    const calc = bd.computeHoldingTax({ ...b, quarters: existing ? parseJson(existing.quarters_json) : [] });
    const row = {
      id_projects: projectOf(req), id_units: b.id_units || null,
      unit_number: b.unit_number, owner_name: b.owner_name, authority: b.authority || 'DNCC',
      holding_no: b.holding_no, ward_no: b.ward_no || null, fiscal_year: fy,
      annual_valuation_bdt: b.annual_valuation_bdt, tax_rate_percent: b.tax_rate_percent ?? 12,
      rebate_percent: b.rebate_percent || 0,
      annual_tax_bdt: calc.annual_tax_bdt, paid_bdt: calc.paid_bdt, due_bdt: calc.due_bdt,
      quarters_json: JSON.stringify(calc.quarters), status: bd.holdingStatus(calc.paid_bdt, calc.due_bdt, fy),
      remarks: b.remarks || null,
    };
    let id = b.id_holding_tax;
    if (id) await db('holding_tax_register').where({ id_holding_tax: id }).update(row);
    else {
      const dup = await db('holding_tax_register').where({ unit_number: row.unit_number, fiscal_year: fy, id_projects: row.id_projects }).first();
      if (dup) return fail(res, new Error(`Holding tax for ${row.unit_number} (FY ${fy}) already exists`), 409);
      [id] = await db('holding_tax_register').insert(row);
    }
    res.json({ success: true, message: `Holding tax saved — annual ৳${calc.annual_tax_bdt}`, id });
  } catch (err) { fail(res, err); }
});

router.patch('/holding-tax/:id/quarter', async (req, res) => {
  try {
    const rec = await db('holding_tax_register').where({ id_holding_tax: req.params.id }).first();
    if (!rec) return fail(res, new Error('Record not found'), 404);
    const qNo = Number(req.body?.q);
    if (![1, 2, 3, 4].includes(qNo)) return fail(res, new Error('Quarter must be 1–4'), 400);
    const quarters = (parseJson(rec.quarters_json) || []).map(x => Number(x.q) === qNo
      ? { ...x, paid: !!req.body.paid, receipt: req.body.receipt || x.receipt || null, paid_date: req.body.paid ? (req.body.paid_date || toYmd(new Date())) : null }
      : x);
    const calc = bd.computeHoldingTax({ ...rec, quarters });
    await db('holding_tax_register').where({ id_holding_tax: rec.id_holding_tax }).update({
      quarters_json: JSON.stringify(calc.quarters), paid_bdt: calc.paid_bdt, due_bdt: calc.due_bdt,
      status: bd.holdingStatus(calc.paid_bdt, calc.due_bdt, rec.fiscal_year),
    });
    res.json({ success: true, message: `Q${qNo} marked ${req.body.paid ? 'paid' : 'unpaid'}` });
  } catch (err) { fail(res, err); }
});

module.exports = router;
