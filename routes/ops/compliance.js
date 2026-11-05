// Licence & certificate renewals and vendor tax IDs.
//
// The renewals view merges four sources so nothing with an expiry date is missed:
//   RENEWAL  — compliance_renewals (lift licence, fire licence, trade licence, generator, insurance…; editable here)
//   APPROVAL — authority_approvals with an expiry date (RAJUK, Fire NOC…; edited on the Compliance hub)
//   FIRE     — fire extinguisher refill dates (fire_safety_equipment)
//   VENDOR   — vendor trade licences, so you see before paying a vendor whose licence has lapsed
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, ymd, today, pick } = require('./common');
const { isValidBdMobile, normalizeBdMobile, tinError, binError } = require('../../utils/bd');
const { getSettings } = require('../../utils/org');
const { daysLeft, sendStaged } = require('../../utils/reminders');
const sms = require('../../utils/sms');

const ITEM_TYPES = ['LIFT_LICENSE', 'FIRE_LICENSE', 'TRADE_LICENSE', 'GENERATOR', 'BOILER', 'ELECTRICAL_SAFETY', 'INSURANCE', 'WASA', 'GAS', 'ENVIRONMENT', 'OTHER'];
const DEFAULT_REMIND_DAYS = 30;

const state = (left, remind) => (left < 0 ? 'EXPIRED' : left <= remind ? 'DUE_SOON' : 'OK');

// Every dated item from all four sources, soonest first.
async function allRenewals({ includeArchived = false } = {}) {
  const own = db('compliance_renewals').orderBy('expiry_date');
  if (!includeArchived) own.where('status', 'ACTIVE');
  const [renewals, approvals, fire, vendors] = await Promise.all([
    own,
    db('authority_approvals').whereNotNull('expiry_date').whereNot('status', 'EXPIRED'),
    db('fire_safety_equipment').whereNotNull('expiry_refill_date'),
    db('vendors').whereNotNull('trade_license_expiry').where('status', 'ACTIVE'),
  ]);
  const rows = [
    ...renewals.map(r => ({ source: 'RENEWAL', source_id: r.id_renewals, item_type: r.item_type, title: r.title, authority: r.authority, reference_no: r.reference_no,
      issue_date: ymd(r.issue_date), expiry_date: ymd(r.expiry_date), remind_days: r.remind_days, renewal_fee_bdt: num(r.renewal_fee_bdt),
      responsible_name: r.responsible_name, responsible_phone: r.responsible_phone, status: r.status, notes: r.notes, editable: true })),
    ...approvals.map(a => ({ source: 'APPROVAL', source_id: a.id_approvals, item_type: a.authority, title: a.approval_title, authority: a.authority,
      reference_no: a.approval_reference_no || a.application_number, issue_date: ymd(a.approval_date), expiry_date: ymd(a.expiry_date), remind_days: 60 })),
    ...fire.map(f => ({ source: 'FIRE', source_id: f.id_fire_equip, item_type: 'FIRE_EQUIPMENT', title: `${f.equipment_type} — ${f.location_description}`,
      reference_no: f.equipment_tag, issue_date: ymd(f.last_inspection_date), expiry_date: ymd(f.expiry_refill_date), remind_days: 15 })),
    ...vendors.map(v => ({ source: 'VENDOR', source_id: v.id_vendors, item_type: 'VENDOR_TRADE_LICENSE', title: `${v.company_name} — trade licence`,
      reference_no: v.trade_license_no, expiry_date: ymd(v.trade_license_expiry), remind_days: 30 })),
  ];
  for (const r of rows) { r.days_left = daysLeft(r.expiry_date); r.state = r.status === 'ARCHIVED' ? 'ARCHIVED' : state(r.days_left, r.remind_days); }
  return rows.sort((a, b) => a.days_left - b.days_left);
}

router.get('/renewals', async (req, res) => {
  try {
    const rows = await allRenewals({ includeArchived: req.query.archived === '1' });
    const live = rows.filter(r => r.state !== 'ARCHIVED');
    const count = s => live.filter(r => r.state === s).length;
    res.json({ success: true, rows, item_types: ITEM_TYPES,
      summary: { total: live.length, expired: count('EXPIRED'), due_soon: count('DUE_SOON'), ok: count('OK'),
        fees_due_90d_bdt: num(live.filter(r => r.days_left <= 90).reduce((s, r) => s + (r.renewal_fee_bdt || 0), 0)) } });
  } catch (err) { fail(res, err); }
});

router.post('/renewals', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['item_type', 'title', 'authority', 'reference_no', 'issue_date', 'expiry_date', 'remind_days', 'renewal_fee_bdt', 'responsible_name', 'responsible_phone', 'notes']);
    if (!row.title || !String(row.title).trim()) throw bad('Title is required');
    if (!row.expiry_date) throw bad('Expiry date is required');
    row.item_type = ITEM_TYPES.includes(row.item_type) ? row.item_type : 'OTHER';
    row.expiry_date = ymd(row.expiry_date);
    if (row.issue_date) { row.issue_date = ymd(row.issue_date); if (row.issue_date > row.expiry_date) throw bad('Issue date is after the expiry date'); }
    row.remind_days = Math.min(180, Math.max(0, Math.round(Number(row.remind_days ?? DEFAULT_REMIND_DAYS)) || 0));
    row.renewal_fee_bdt = num(row.renewal_fee_bdt);
    if (row.responsible_phone) {
      if (!isValidBdMobile(row.responsible_phone)) throw bad('Responsible person phone is not a valid Bangladeshi mobile');
      row.responsible_phone = normalizeBdMobile(row.responsible_phone);
    }
    if (b.id_renewals) {
      await db('compliance_renewals').where({ id_renewals: b.id_renewals }).update({ ...row, updated_at: new Date() });
      return res.json({ success: true, message: 'Renewal updated', id: Number(b.id_renewals) });
    }
    const [id] = await db('compliance_renewals').insert({ ...row, status: 'ACTIVE', created_by: userName(req) });
    res.json({ success: true, message: 'Added to the renewals register', id });
  } catch (err) { fail(res, err); }
});

// Record that an item was renewed: new expiry (and reference), reminders start over for the new date.
router.post('/renewals/:id/renew', async (req, res) => {
  try {
    const r = await db('compliance_renewals').where({ id_renewals: req.params.id }).first();
    if (!r) throw bad('Renewal not found');
    const b = req.body || {};
    const expiry = ymd(b.expiry_date);
    if (!expiry) throw bad('New expiry date is required');
    if (expiry <= ymd(r.expiry_date)) throw bad('The new expiry date must be after the current one');
    const notes = [r.notes, `Renewed ${today()} by ${userName(req)}: ${ymd(r.expiry_date)} → ${expiry}${b.fee_paid_bdt ? `, fee ৳${num(b.fee_paid_bdt)}` : ''}`].filter(Boolean).join('\n');
    await db('compliance_renewals').where({ id_renewals: r.id_renewals }).update({ issue_date: ymd(b.issue_date) || today(), expiry_date: expiry,
      reference_no: b.reference_no || r.reference_no, notes: notes.slice(-5000), updated_at: new Date() });
    res.json({ success: true, message: `Renewed until ${expiry}` });
  } catch (err) { fail(res, err); }
});

router.post('/renewals/:id/archive', async (req, res) => {
  try {
    const archive = req.body?.archive !== false;
    await db('compliance_renewals').where({ id_renewals: req.params.id }).update({ status: archive ? 'ARCHIVED' : 'ACTIVE', updated_at: new Date() });
    res.json({ success: true, message: archive ? 'Archived — no more reminders' : 'Restored' });
  } catch (err) { fail(res, err); }
});

router.delete('/renewals/:id', async (req, res) => {
  try {
    await db('compliance_renewals').where({ id_renewals: req.params.id }).del();
    await db('due_reminders_sent').where({ source: 'RENEWAL', source_id: req.params.id }).del();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { fail(res, err); }
});

// Used by the RENEWAL_REMINDERS job and the "Send reminders now" button.
async function sendRenewalReminders({ smsTo, createdBy = 'Scheduler' } = {}) {
  const settings = await getSettings();
  const bn = settings.sms_language !== 'en';
  const tpl = await sms.getTemplate('RENEWAL_DUE');
  if (!tpl || !tpl.is_active) return { message: 'The renewal SMS template is switched off', sent: 0 };
  const dmy = s => s.split('-').reverse().join('/');
  const when = left => (left < 0 ? (bn ? `${-left} দিন আগে শেষ হয়েছে` : `expired ${-left} day(s) ago`)
    : left === 0 ? (bn ? 'আজ শেষ হচ্ছে' : 'expires today') : (bn ? `${left} দিন পর শেষ হবে` : `expires in ${left} day(s)`));
  const items = (await allRenewals()).filter(r => r.state !== 'OK').map(r => ({
    source: r.source, source_id: r.source_id, due_date: r.expiry_date, first_days: r.remind_days, phone: r.responsible_phone, name: r.responsible_name,
    template_key: 'RENEWAL_DUE',
    message: left => sms.render(bn ? tpl.body_bn : tpl.body_en, { title: r.title, ref: r.reference_no || '—', when: when(left), due_date: dmy(r.expiry_date), org: settings.sms_signature }),
  }));
  const r = await sendStaged(items, { fallbackPhone: smsTo, createdBy, relatedType: 'RENEWAL' });
  const sent = r.sent + r.simulated;
  return { ...r, message: `${sent} reminder(s) sent${r.simulated ? ` (${r.simulated} simulated)` : ''}${r.failed ? `, ${r.failed} failed` : ''}${r.skipped_no_phone ? `, ${r.skipped_no_phone} skipped — no phone (set "Text this mobile" on the job)` : ''}` };
}

router.post('/renewals/remind-now', async (req, res) => {
  try {
    const job = await db('automation_jobs').where({ job_key: 'RENEWAL_REMINDERS' }).first();
    let opts = job?.options || {};
    if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
    const r = await sendRenewalReminders({ smsTo: req.body?.sms_to || opts.sms_to, createdBy: userName(req) });
    res.json({ success: true, ...r });
  } catch (err) { fail(res, err); }
});

// ── Vendor tax IDs ──────────────────────────────────────────────
router.get('/vendor-tax', async (req, res) => {
  try {
    const rows = await db('vendors').orderBy('company_name')
      .select('id_vendors', 'company_name', 'contact_person', 'phone', 'category', 'status', 'tax_information', 'tin_no', 'bin_no', 'trade_license_no', 'trade_license_expiry');
    const settings = await getSettings();
    const t = today();
    const out = rows.map(v => ({ ...v, trade_license_expiry: ymd(v.trade_license_expiry),
      missing_tin: !v.tin_no, missing_bin: !v.bin_no, license_expired: !!v.trade_license_expiry && ymd(v.trade_license_expiry) < t }));
    const active = out.filter(v => v.status === 'ACTIVE');
    res.json({ success: true, rows: out, no_tin_uplift_percent: Number(settings.no_tin_tds_uplift_percent) || 0,
      summary: { vendors: active.length, missing_tin: active.filter(v => v.missing_tin).length, missing_bin: active.filter(v => v.missing_bin).length, license_expired: active.filter(v => v.license_expired).length } });
  } catch (err) { fail(res, err); }
});

router.put('/vendor-tax/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const clean = v => (v ? String(v).replace(/\s/g, '') : null);
    const tinErr = tinError(b.tin_no); if (tinErr) throw bad(tinErr);
    const binErr = binError(b.bin_no); if (binErr) throw bad(binErr);
    const n = await db('vendors').where({ id_vendors: req.params.id }).update({
      tin_no: clean(b.tin_no), bin_no: clean(b.bin_no), trade_license_no: b.trade_license_no ? String(b.trade_license_no).trim() : null, trade_license_expiry: ymd(b.trade_license_expiry) || null,
    });
    if (!n) throw bad('Vendor not found');
    res.json({ success: true, message: 'Tax IDs saved' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
module.exports.sendRenewalReminders = sendRenewalReminders;
