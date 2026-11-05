// Tenants (ভাড়াটিয়া), rent agreements, monthly rent invoices and rent collection.
// Tenant records carry every field of the DMP tenant information form so it can be printed for the thana.
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, round2, ymd, today, isMonth, dayOfMonth, monthsBetween, unitsQuery, primaryOwners, pick, method } = require('./common');
const { issueReceipt } = require('../../utils/receipts');
const { getSettings } = require('../../utils/org');
const { isValidBdMobile, normalizeBdMobile, nidError } = require('../../utils/bd');
const sms = require('../../utils/sms');

const TENANT_FIELDS = ['id_units', 'full_name', 'father_name', 'date_of_birth', 'marital_status', 'permanent_address', 'occupation', 'workplace_address',
  'religion', 'education', 'phone', 'email', 'nid_no', 'passport_no', 'emergency_name', 'emergency_relation', 'emergency_phone', 'emergency_address',
  'prev_landlord_name', 'prev_landlord_phone', 'prev_address', 'reason_for_leaving_prev', 'move_in_date', 'police_form_submitted', 'police_form_date',
  'police_station', 'notes'];
const PEOPLE_FIELDS = ['family_members', 'domestic_helpers', 'drivers'];
const AGREEMENT_FIELDS = ['id_tenants', 'id_units', 'id_owners', 'start_date', 'end_date', 'monthly_rent_bdt', 'other_monthly_bdt', 'other_monthly_label',
  'advance_deposit_bdt', 'due_day', 'annual_increase_percent', 'notice_period_months', 'notes'];

const parseList = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const cleanPeople = list => parseList(list)
  .map(p => Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 200)])))
  .filter(p => p.name);

// Rent for a month, with the annual increase compounded on each agreement anniversary.
const rentFor = (a, month) => {
  const years = Math.max(0, Math.floor(monthsBetween(ymd(a.start_date), month) / 12));
  return round2(Number(a.monthly_rent_bdt) * Math.pow(1 + Number(a.annual_increase_percent || 0) / 100, years));
};
const covers = (a, month) => ymd(a.start_date).slice(0, 7) <= month && (!a.end_date || ymd(a.end_date).slice(0, 7) >= month);

// ── Overview ─────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const [{ active }] = await db('tenants').where({ status: 'ACTIVE' }).count({ active: '*' });
    const [{ units }] = await db('tenants').where({ status: 'ACTIVE' }).countDistinct({ units: 'id_units' });
    const [{ pending }] = await db('tenants').where({ status: 'ACTIVE' }).where(q => q.whereNull('police_form_submitted').orWhere('police_form_submitted', false)).count({ pending: '*' });
    const agreements = await db('rent_agreements').where({ status: 'ACTIVE' });
    const rentRoll = round2(agreements.filter(a => covers(a, month)).reduce((s, a) => s + rentFor(a, month) + Number(a.other_monthly_bdt || 0), 0));
    const [due] = await db('rent_invoices').whereNot({ status: 'PAID' }).select(db.raw('COALESCE(SUM(total_bdt - amount_paid),0) as outstanding'), db.raw('COUNT(*) as n'));
    const [coll] = await db('rent_invoices').where({ billing_month: month }).select(db.raw('COALESCE(SUM(total_bdt),0) as billed'), db.raw('COALESCE(SUM(amount_paid),0) as collected'));
    const expiring = await db('rent_agreements as a').join('tenants as t', 't.id_tenants', 'a.id_tenants')
      .where('a.status', 'ACTIVE').whereNotNull('a.end_date').where('a.end_date', '<=', db.raw('DATE_ADD(CURDATE(), INTERVAL 60 DAY)'))
      .select('a.id_rent_agreements', 'a.end_date', 't.full_name', 't.id_units').orderBy('a.end_date');
    res.json({ success: true, month, active_tenants: Number(active), occupied_units: Number(units), police_forms_pending: Number(pending),
      rent_roll_bdt: rentRoll, billed_bdt: num(coll.billed), collected_bdt: num(coll.collected),
      outstanding_bdt: num(due.outstanding), unpaid_invoices: Number(due.n), expiring_agreements: expiring });
  } catch (err) { fail(res, err); }
});

// ── Tenants ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const q = db('tenants as t').orderBy('t.status').orderBy('t.full_name');
    if (req.query.status) q.where('t.status', req.query.status);
    if (req.query.q) {
      const s = `%${req.query.q}%`;
      q.where(w => w.where('t.full_name', 'like', s).orWhere('t.phone', 'like', s).orWhere('t.nid_no', 'like', s));
    }
    const rows = await q.select('t.id_tenants', 't.id_units', 't.full_name', 't.phone', 't.nid_no', 't.occupation', 't.move_in_date', 't.move_out_date',
      't.status', 't.police_form_submitted', 't.police_form_date', 't.family_members');
    const ids = rows.map(r => r.id_tenants);
    const agreements = ids.length ? await db('rent_agreements').whereIn('id_tenants', ids).where({ status: 'ACTIVE' }) : [];
    const dues = ids.length ? await db('rent_invoices as i').join('rent_agreements as a', 'a.id_rent_agreements', 'i.id_rent_agreements')
      .whereIn('a.id_tenants', ids).whereNot('i.status', 'PAID').groupBy('a.id_tenants')
      .select('a.id_tenants', db.raw('SUM(i.total_bdt - i.amount_paid) as due'), db.raw('COUNT(*) as months')) : [];
    const month = today().slice(0, 7);
    res.json({ success: true, rows: rows.map(r => {
      const a = agreements.find(x => x.id_tenants === r.id_tenants);
      const d = dues.find(x => x.id_tenants === r.id_tenants);
      return { ...r, family_count: parseList(r.family_members).length, family_members: undefined,
        agreement: a ? { id_rent_agreements: a.id_rent_agreements, monthly_rent_bdt: rentFor(a, month), other_monthly_bdt: num(a.other_monthly_bdt), end_date: a.end_date, due_day: a.due_day } : null,
        due_bdt: num(d?.due), due_months: Number(d?.months || 0) };
    }) });
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next(); // let /invoices etc. match
  try {
    const t = await db('tenants').where({ id_tenants: req.params.id }).first();
    if (!t) return res.status(404).json({ success: false, message: 'Tenant not found' });
    for (const k of PEOPLE_FIELDS) t[k] = parseList(t[k]);
    const unit = await unitsQuery().where('u.id_units', t.id_units).first();
    const agreements = await db('rent_agreements as a').leftJoin('owners as o', 'o.id_owners', 'a.id_owners')
      .where('a.id_tenants', t.id_tenants).orderBy('a.start_date', 'desc')
      .select('a.*', 'o.full_name as landlord_name', 'o.phone as landlord_phone', 'o.address as landlord_address');
    const invoices = agreements.length ? await db('rent_invoices').whereIn('id_rent_agreements', agreements.map(a => a.id_rent_agreements)).orderBy('billing_month', 'desc') : [];
    const landlord = agreements[0]?.landlord_name ? { full_name: agreements[0].landlord_name, phone: agreements[0].landlord_phone, address: agreements[0].landlord_address }
      : (await primaryOwners([t.id_units]))[t.id_units] || null;
    res.json({ success: true, tenant: t, unit, agreements, invoices, landlord, settings: await getSettings() });
  } catch (err) { fail(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, TENANT_FIELDS);
    if (!row.full_name || !String(row.full_name).trim()) throw bad('Tenant name is required');
    if (!row.id_units) throw bad('Choose the flat');
    if (!isValidBdMobile(row.phone)) throw bad('Enter a valid Bangladeshi mobile number (01XXXXXXXXX)');
    row.phone = normalizeBdMobile(row.phone);
    if (row.emergency_phone) {
      if (!isValidBdMobile(row.emergency_phone)) throw bad('Emergency contact number is not a valid Bangladeshi mobile');
      row.emergency_phone = normalizeBdMobile(row.emergency_phone);
    }
    const nidErr = nidError(row.nid_no, row.date_of_birth);
    if (nidErr) throw bad(nidErr);
    if (row.nid_no) row.nid_no = String(row.nid_no).replace(/[\s-]/g, '');
    if (!(await db('units').where({ id_units: row.id_units }).first())) throw bad('Flat not found');
    row.police_form_submitted = !!row.police_form_submitted;
    for (const k of PEOPLE_FIELDS) if (b[k] !== undefined) row[k] = JSON.stringify(cleanPeople(b[k]));

    if (b.id_tenants) {
      await db('tenants').where({ id_tenants: b.id_tenants }).update(row);
      return res.json({ success: true, message: 'Tenant updated', id: Number(b.id_tenants) });
    }
    const [id] = await db('tenants').insert({ ...row, status: 'ACTIVE', move_in_date: row.move_in_date || today() });
    res.json({ success: true, message: 'Tenant added', id });
  } catch (err) { fail(res, err); }
});

router.post('/:id/move-out', async (req, res) => {
  try {
    const date = ymd(req.body?.move_out_date) || today();
    await db.transaction(async trx => {
      const n = await trx('tenants').where({ id_tenants: req.params.id, status: 'ACTIVE' }).update({ status: 'LEFT', move_out_date: date });
      if (!n) throw bad('Tenant is not active');
      await trx('rent_agreements').where({ id_tenants: req.params.id, status: 'ACTIVE' }).update({ status: 'ENDED', end_date: date });
    });
    res.json({ success: true, message: 'Tenant marked as moved out and the rent agreement ended' });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const paid = await db('rent_payments as p').join('rent_invoices as i', 'i.id_rent_invoices', 'p.id_rent_invoices')
      .join('rent_agreements as a', 'a.id_rent_agreements', 'i.id_rent_agreements').where('a.id_tenants', req.params.id).first();
    if (paid) throw bad('This tenant has rent payments on record. Mark them as moved out instead of deleting.');
    await db.transaction(async trx => {
      const ags = await trx('rent_agreements').where({ id_tenants: req.params.id }).pluck('id_rent_agreements');
      if (ags.length) await trx('rent_invoices').whereIn('id_rent_agreements', ags).del();
      await trx('rent_agreements').where({ id_tenants: req.params.id }).del();
      await trx('tenant_documents').where({ id_tenants: req.params.id }).del();
      await trx('tenants').where({ id_tenants: req.params.id }).del();
    });
    res.json({ success: true, message: 'Tenant deleted' });
  } catch (err) { fail(res, err); }
});

// ── Rent agreements ──────────────────────────────────────────────
router.post('/agreements', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, AGREEMENT_FIELDS);
    const tenant = await db('tenants').where({ id_tenants: row.id_tenants }).first();
    if (!tenant) throw bad('Tenant not found');
    row.id_units = row.id_units || tenant.id_units;
    if (!row.start_date) throw bad('Start date is required');
    if (!(Number(row.monthly_rent_bdt) > 0)) throw bad('Monthly rent must be more than zero');
    if (row.end_date && ymd(row.end_date) < ymd(row.start_date)) throw bad('End date is before the start date');
    row.due_day = Math.min(31, Math.max(1, Number(row.due_day) || 5));
    if (!row.id_owners) row.id_owners = (await primaryOwners([row.id_units]))[row.id_units]?.id_owners || null;

    if (b.id_rent_agreements) {
      await db('rent_agreements').where({ id_rent_agreements: b.id_rent_agreements }).update(row);
      return res.json({ success: true, message: 'Agreement updated', id: Number(b.id_rent_agreements) });
    }
    const id = await db.transaction(async trx => {
      // One running agreement per tenant: a new one replaces the old.
      await trx('rent_agreements').where({ id_tenants: row.id_tenants, status: 'ACTIVE' }).update({ status: 'ENDED', end_date: ymd(row.start_date) });
      const [newId] = await trx('rent_agreements').insert({ ...row, status: 'ACTIVE' });
      return newId;
    });
    res.json({ success: true, message: 'Rent agreement saved', id });
  } catch (err) { fail(res, err); }
});

router.post('/agreements/:id/end', async (req, res) => {
  try {
    const n = await db('rent_agreements').where({ id_rent_agreements: req.params.id, status: 'ACTIVE' }).update({ status: 'ENDED', end_date: ymd(req.body?.end_date) || today() });
    if (!n) throw bad('Agreement is not active');
    res.json({ success: true, message: 'Agreement ended' });
  } catch (err) { fail(res, err); }
});

// ── Rent invoices ────────────────────────────────────────────────
const invoiceSelect = q => q
  .join('rent_agreements as a', 'a.id_rent_agreements', 'i.id_rent_agreements')
  .join('tenants as t', 't.id_tenants', 'a.id_tenants')
  .select('i.*', 'a.id_tenants', 'a.id_units', 'a.other_monthly_label', 't.full_name as tenant_name', 't.phone as tenant_phone');

router.get('/invoices', async (req, res) => {
  try {
    const q = invoiceSelect(db('rent_invoices as i')).orderBy('i.billing_month', 'desc').orderBy('t.full_name').limit(1000);
    if (isMonth(req.query.month)) q.where('i.billing_month', req.query.month);
    if (req.query.status === 'DUE') q.whereNot('i.status', 'PAID');
    else if (req.query.status) q.where('i.status', req.query.status);
    if (req.query.tenant) q.where('a.id_tenants', req.query.tenant);
    res.json({ success: true, rows: await q });
  } catch (err) { fail(res, err); }
});

// Creates the month's invoice for every active agreement that doesn't have one yet. Used by the route and the scheduler.
async function generateRentInvoices(month) {
  if (!isMonth(month)) throw bad('Choose a month (YYYY-MM)');
  const agreements = (await db('rent_agreements').where({ status: 'ACTIVE' })).filter(a => covers(a, month));
  const existing = new Set(await db('rent_invoices').where({ billing_month: month }).pluck('id_rent_agreements'));
  const rows = agreements.filter(a => !existing.has(a.id_rent_agreements)).map(a => {
    const rent = rentFor(a, month); const other = num(a.other_monthly_bdt);
    return { id_rent_agreements: a.id_rent_agreements, billing_month: month, rent_bdt: rent, other_bdt: other, total_bdt: round2(rent + other), due_date: dayOfMonth(month, a.due_day), status: 'UNPAID' };
  });
  if (rows.length) await db('rent_invoices').insert(rows);
  return { created: rows.length, skipped: agreements.length - rows.length,
    message: rows.length ? `${rows.length} rent invoice(s) created for ${month}` : `No new invoices: every active agreement already has a ${month} invoice` };
}

router.post('/invoices/generate', async (req, res) => {
  try {
    res.json({ success: true, ...(await generateRentInvoices(req.body?.billing_month)) });
  } catch (err) { fail(res, err); }
});

router.post('/invoices/:id/pay', async (req, res) => {
  try {
    const b = req.body || {};
    const amount = num(b.amount_bdt);
    if (!(amount > 0)) throw bad('Enter the amount received');
    let payId; let inv;
    await db.transaction(async trx => {
      inv = await invoiceSelect(trx('rent_invoices as i')).where('i.id_rent_invoices', req.params.id).forUpdate().first();
      if (!inv) throw bad('Invoice not found');
      const due = round2(Number(inv.total_bdt) - Number(inv.amount_paid));
      if (due <= 0) throw bad('This invoice is already fully paid');
      if (amount > due + 0.001) throw bad(`Amount is more than the Tk ${due.toLocaleString('en-IN')} still due`);
      [payId] = await trx('rent_payments').insert({ id_rent_invoices: inv.id_rent_invoices, amount_bdt: amount, paid_on: ymd(b.paid_on) || today(),
        payment_method: method(b.payment_method), reference: b.reference || null, received_by: userName(req) });
      const paid = round2(Number(inv.amount_paid) + amount);
      await trx('rent_invoices').where({ id_rent_invoices: inv.id_rent_invoices }).update({ amount_paid: paid, status: paid >= Number(inv.total_bdt) ? 'PAID' : 'PARTIAL' });
    });
    let receipt = null; let smsResult = null;
    if (b.issue_receipt) {
      const unit = await unitsQuery().where('u.id_units', inv.id_units).first();
      const items = [{ description: `House rent – ${inv.billing_month}`, amount: Math.min(amount, Number(inv.rent_bdt)) }];
      if (amount > Number(inv.rent_bdt)) items.push({ description: inv.other_monthly_label || 'Other charges with rent', amount: round2(amount - Number(inv.rent_bdt)) });
      const r = await issueReceipt({ received_from: inv.tenant_name, phone: inv.tenant_phone, unit_number: unit?.unit_number, items,
        payment_method: method(b.payment_method), payment_ref: b.reference, source_type: 'RENT_PAYMENT', source_id: payId },
      { sendSms: !!b.send_sms, createdBy: userName(req) });
      receipt = r.receipt; smsResult = r.sms;
      await db('rent_payments').where({ id_rent_payments: payId }).update({ id_receipts: receipt.id_receipts });
    }
    res.json({ success: true, message: receipt ? `Payment recorded · receipt ${receipt.receipt_no}` : 'Payment recorded', id_receipts: receipt?.id_receipts || null, sms: smsResult });
  } catch (err) { fail(res, err); }
});

router.delete('/invoices/:id', async (req, res) => {
  try {
    if (await db('rent_payments').where({ id_rent_invoices: req.params.id }).first()) throw bad('Payments are recorded against this invoice; it cannot be deleted');
    await db('rent_invoices').where({ id_rent_invoices: req.params.id }).del();
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { fail(res, err); }
});

// Sends the RENT_DUE SMS for the given unpaid invoices. skipRecentDays > 0 skips invoices texted that recently.
async function remindRentInvoices(ids, createdBy, { skipRecentDays = 0 } = {}) {
  const settings = await getSettings();
  const tpl = await sms.getTemplate('RENT_DUE');
  if (!tpl) throw bad('The RENT_DUE SMS template is missing');
  const bn = settings.sms_language !== 'en';
  let rows = await invoiceSelect(db('rent_invoices as i')).whereIn('i.id_rent_invoices', ids).whereNot('i.status', 'PAID');
  let skipped = 0;
  if (skipRecentDays > 0 && rows.length) {
    const since = new Date(Date.now() - skipRecentDays * 86400000);
    const recent = new Set(await db('sms_outbox').where({ related_type: 'RENT_INVOICE' }).whereIn('status', ['SENT', 'SIMULATED']).where('created_at', '>=', since)
      .whereIn('related_key', rows.map(r => String(r.id_rent_invoices))).pluck('related_key'));
    const before = rows.length;
    rows = rows.filter(r => !recent.has(String(r.id_rent_invoices)));
    skipped = before - rows.length;
  }
  const units = Object.fromEntries((await unitsQuery().whereIn('u.id_units', rows.map(r => r.id_units))).map(u => [u.id_units, u.unit_number]));
  let sent = 0; let failed = 0;
  for (const r of rows) {
    const message = sms.render(bn ? tpl.body_bn : tpl.body_en, { name: r.tenant_name, unit: units[r.id_units] || '', item: r.billing_month,
      amount: round2(Number(r.total_bdt) - Number(r.amount_paid)).toLocaleString('en-IN'), due_date: ymd(r.due_date), org: settings.sms_signature });
    const out = await sms.sendSms({ to: r.tenant_phone, message, recipient_name: r.tenant_name, template_key: 'RENT_DUE', related_type: 'RENT_INVOICE', related_key: String(r.id_rent_invoices), created_by: createdBy });
    if (out.status === 'FAILED') failed++; else sent++;
  }
  return { sent, failed, skipped, message: `${sent} reminder(s) sent${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped (texted recently)` : ''}` };
}

router.post('/invoices/remind', async (req, res) => {
  try {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Select at least one invoice');
    res.json({ success: true, ...(await remindRentInvoices(ids, userName(req))) });
  } catch (err) { fail(res, err); }
});

// ── ID documents (NID front/back, photo…) ────────────────────────
// Images arrive as data URLs already resized in the browser; they are kept in the database and only
// served through these staff-only routes, never as public files.
const DOC_TYPES = ['NID_FRONT', 'NID_BACK', 'PHOTO', 'PASSPORT', 'OTHER'];
const MAX_DOC_BYTES = 1.5 * 1024 * 1024;

router.get('/:id/documents', async (req, res) => {
  try {
    const rows = await db('tenant_documents').where({ id_tenants: req.params.id }).orderBy('id_tenant_documents')
      .select('id_tenant_documents', 'doc_type', 'mime', 'size_bytes', 'uploaded_by', 'created_at');
    res.json({ success: true, rows });
  } catch (err) { fail(res, err); }
});

router.post('/:id/documents', async (req, res) => {
  try {
    const { doc_type, data } = req.body || {};
    if (!DOC_TYPES.includes(doc_type)) throw bad('Unknown document type');
    const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
    if (!m) throw bad('Upload a JPG, PNG, WebP or PDF file');
    const size = Math.floor(m[2].length * 3 / 4);
    if (size > MAX_DOC_BYTES) throw bad('File is too large (max 1.5 MB)');
    if (!(await db('tenants').where({ id_tenants: req.params.id }).first())) throw bad('Tenant not found');
    // One NID front / back / photo per tenant: a new upload replaces the old one.
    if (doc_type !== 'OTHER') await db('tenant_documents').where({ id_tenants: req.params.id, doc_type }).del();
    const [id] = await db('tenant_documents').insert({ id_tenants: req.params.id, doc_type, mime: m[1], data, size_bytes: size, uploaded_by: userName(req) });
    res.json({ success: true, message: 'Document uploaded', id });
  } catch (err) { fail(res, err); }
});

router.get('/documents/:docId', async (req, res) => {
  try {
    const d = await db('tenant_documents').where({ id_tenant_documents: req.params.docId }).first();
    if (!d) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true, doc: d });
  } catch (err) { fail(res, err); }
});

router.delete('/documents/:docId', async (req, res) => {
  try {
    await db('tenant_documents').where({ id_tenant_documents: req.params.docId }).del();
    res.json({ success: true, message: 'Document deleted' });
  } catch (err) { fail(res, err); }
});

module.exports = router;

// Used by the scheduler (jobs/definitions.js).
module.exports.generateRentInvoices = generateRentInvoices;
module.exports.remindRentInvoices = remindRentInvoices;
