// Collections: money receipts / Mushak-6.3, SMS due reminders & outbox, online payment log, org settings.
// Mounted behind checkAuth + staff-only in app.js.
const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const { round2 } = require('../utils/bd');
const { issueReceipt, parseJson, computeLines } = require('../utils/receipts');
const { getSettings, saveSettings } = require('../utils/org');
const sms = require('../utils/sms');
const { amountInWordsEn, amountInWordsBn } = require('../utils/words');
const { gatewayMode, sandbox } = require('../utils/sslcommerz');
const { loadFineContext, fineFor } = require('../utils/latefee');

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || String(err) });
const userName = req => req.user?.name || 'Staff';
const ymd = d => {
  if (!d) return null;
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const dmy = d => { const [y, m, dd] = ymd(d).split('-'); return `${dd}/${m}/${y}`; };
const CONTRIBUTION_LABEL = {
  INITIAL_DEPOSIT: 'Initial deposit / booking money', CONSTRUCTION_INSTALLMENT: 'Construction instalment', MONTHLY_CONTRIBUTION: 'Monthly contribution',
  SPECIAL_CONTRIBUTION: 'Special contribution', EMERGENCY_CONTRIBUTION: 'Emergency contribution', LOAN_FUNDED: 'Loan-funded contribution',
};
const MFS_PURPOSE = { INSTALLMENT: 'Instalment', SERVICE_CHARGE: 'Service charge', UTILITY_BILL: 'Utility bill', VENDOR_PAYMENT: 'Vendor payment', LABOUR_WAGE: 'Labour wage', OTHER: 'Payment' };

// ── Settings ─────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    res.json({ success: true, settings: await getSettings(), sms: sms.providerStatus(), whatsapp: require('../utils/whatsapp').status(), gateway: { mode: gatewayMode(), sandbox: sandbox() } });
  } catch (err) { fail(res, err); }
});
router.put('/settings', async (req, res) => {
  try {
    if (!req.can?.('collections.settings')) return res.status(403).json({ success: false, message: 'You do not have permission to change organisation settings' });
    res.json({ success: true, message: 'Settings saved', settings: await saveSettings(req.body) });
  } catch (err) { fail(res, err); }
});

// ── Receipts ─────────────────────────────────────────────────
router.get('/unreceipted', async (req, res) => {
  try {
    const contributions = await db('owner_contributions as oc')
      .join('owners as o', 'o.id_owners', 'oc.id_owners')
      .leftJoin('units as u', 'u.id_units', 'oc.id_units')
      .leftJoin('money_receipts as mr', function () { this.on('mr.source_id', 'oc.id_contributions').andOn('mr.source_type', db.raw('?', ['OWNER_CONTRIBUTION'])); })
      .whereNull('mr.id_receipts')
      .select('oc.id_contributions as source_id', 'oc.amount', 'oc.payment_date as date', 'oc.payment_method', 'oc.reference', 'oc.contribution_type',
        'o.full_name as name', 'o.phone', 'u.unit_number')
      .orderBy('oc.payment_date', 'desc').limit(200);
    const mfs = await db('mfs_transactions as m')
      .leftJoin('money_receipts as mr', function () { this.on('mr.source_id', 'm.id_mfs').andOn('mr.source_type', db.raw('?', ['MFS'])); })
      .whereNull('mr.id_receipts').where({ 'm.status': 'VERIFIED', 'm.direction': 'RECEIVED' })
      .select('m.id_mfs as source_id', 'm.amount_bdt as amount', 'm.trx_datetime as date', 'm.provider as payment_method', 'm.trx_id as reference', 'm.purpose',
        'm.counterparty_name as name', 'm.counterparty_wallet as phone', 'm.unit_number')
      .orderBy('m.trx_datetime', 'desc').limit(200);
    const rows = [
      ...contributions.map(c => ({ ...c, source_type: 'OWNER_CONTRIBUTION', description: CONTRIBUTION_LABEL[c.contribution_type] || 'Owner contribution' })),
      ...mfs.map(m => ({ ...m, source_type: 'MFS', description: `${MFS_PURPOSE[m.purpose] || 'Payment'} via ${m.payment_method}` })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, rows });
  } catch (err) { fail(res, err); }
});

router.get('/receipts', async (req, res) => {
  try {
    const q = db('money_receipts').orderBy('id_receipts', 'desc').limit(Math.min(500, Number(req.query.limit) || 200));
    if (req.query.status) q.where({ status: req.query.status });
    if (req.query.doc_type) q.where({ doc_type: req.query.doc_type });
    if (req.query.q) {
      const s = `%${req.query.q}%`;
      q.where(w => w.where('receipt_no', 'like', s).orWhere('received_from', 'like', s).orWhere('unit_number', 'like', s).orWhere('payment_ref', 'like', s));
    }
    const rows = await q.select('id_receipts', 'receipt_no', 'doc_type', 'issue_datetime', 'received_from', 'unit_number', 'phone', 'total_bdt', 'vat_total_bdt', 'payment_method', 'payment_ref', 'source_type', 'status', 'issued_by');
    res.json({ success: true, rows });
  } catch (err) { fail(res, err); }
});

router.get('/receipts/:id', async (req, res) => {
  try {
    const r = await db('money_receipts').where({ id_receipts: req.params.id }).first();
    if (!r) return res.status(404).json({ success: false, message: 'Receipt not found' });
    r.line_items_json = parseJson(r.line_items_json);
    res.json({ success: true, receipt: r, settings: await getSettings() });
  } catch (err) { fail(res, err); }
});

// Live totals + amount in words while the form is being filled in
router.post('/receipts/preview', (req, res) => {
  const calc = computeLines(req.body.items, req.body.doc_type);
  res.json({ success: true, ...calc, words_en: amountInWordsEn(calc.total), words_bn: amountInWordsBn(calc.total) });
});

router.post('/receipts', async (req, res) => {
  try {
    const out = await issueReceipt({ ...req.body, source_type: 'MANUAL', source_id: null }, { sendSms: !!req.body.send_sms, createdBy: userName(req) });
    res.json({ success: true, message: `Receipt ${out.receipt.receipt_no} issued${out.sms ? ` · SMS ${out.sms.status.toLowerCase()}` : ''}`, ...out });
  } catch (err) { fail(res, err); }
});

router.post('/receipts/from-source', async (req, res) => {
  try {
    const { source_type, source_id, doc_type, send_sms, vat_rate } = req.body;
    let input;
    if (source_type === 'OWNER_CONTRIBUTION') {
      const c = await db('owner_contributions as oc').join('owners as o', 'o.id_owners', 'oc.id_owners').leftJoin('units as u', 'u.id_units', 'oc.id_units')
        .where('oc.id_contributions', source_id).select('oc.*', 'o.full_name', 'o.phone', 'o.address', 'u.unit_number').first();
      if (!c) return res.status(404).json({ success: false, message: 'Contribution not found' });
      input = {
        id_projects: c.id_projects, id_owners: c.id_owners, unit_number: c.unit_number, received_from: c.full_name, phone: c.phone, address: c.address,
        items: [{ description: `${CONTRIBUTION_LABEL[c.contribution_type] || 'Owner contribution'}${c.unit_number ? ` — Flat ${c.unit_number}` : ''}`, qty: 1, unit_price: Number(c.amount), vat_rate }],
        payment_method: c.payment_method, payment_ref: c.reference, issue_datetime: c.payment_date,
      };
    } else if (source_type === 'MFS') {
      const m = await db('mfs_transactions').where({ id_mfs: source_id }).first();
      if (!m) return res.status(404).json({ success: false, message: 'MFS transaction not found' });
      if (m.status !== 'VERIFIED' || m.direction !== 'RECEIVED') return res.status(400).json({ success: false, message: 'Only verified incoming transactions can be receipted' });
      input = {
        id_projects: m.id_projects, unit_number: m.unit_number, received_from: m.counterparty_name, phone: m.counterparty_wallet,
        items: [{ description: `${MFS_PURPOSE[m.purpose] || 'Payment'}${m.unit_number ? ` — Flat ${m.unit_number}` : ''}`, qty: 1, unit_price: Number(m.amount_bdt), vat_rate }],
        payment_method: m.provider, payment_ref: `TrxID ${m.trx_id}`, issue_datetime: m.trx_datetime,
      };
    } else return res.status(400).json({ success: false, message: 'source_type must be OWNER_CONTRIBUTION or MFS' });

    const out = await issueReceipt({ ...input, doc_type, source_type, source_id }, { sendSms: !!send_sms, createdBy: userName(req) });
    if (!out.existing) {
      if (source_type === 'OWNER_CONTRIBUTION') await db('owner_contributions').where({ id_contributions: source_id }).update({ receipt_number: out.receipt.receipt_no });
      if (source_type === 'MFS') await db('mfs_transactions').where({ id_mfs: source_id }).update({ reference_voucher_no: out.receipt.receipt_no });
    }
    res.json({ success: true, message: out.existing ? `Already receipted as ${out.receipt.receipt_no}` : `Receipt ${out.receipt.receipt_no} issued${out.sms ? ` · SMS ${out.sms.status.toLowerCase()}` : ''}`, ...out });
  } catch (err) { fail(res, err); }
});

router.post('/receipts/:id/cancel', async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ success: false, message: 'Give a reason for cancelling' });
    // Numbers are never reused; the cancelled receipt stays on file for audit.
    const n = await db('money_receipts').where({ id_receipts: req.params.id, status: 'ISSUED' }).update({ status: 'CANCELLED', cancel_reason: `${reason} (by ${userName(req)})` });
    if (!n) return res.status(404).json({ success: false, message: 'Receipt not found or already cancelled' });
    await db('audit_logs').insert({ user_name: userName(req), action: 'CANCEL_RECEIPT', entity_type: 'money_receipt', entity_id: String(req.params.id), new_value: JSON.stringify({ reason }), created_at: new Date() }).catch(() => {});
    res.json({ success: true, message: 'Receipt cancelled' });
  } catch (err) { fail(res, err); }
});

// ── SMS ──────────────────────────────────────────────────────
// Holding tax quarters fall due at the end of each quarter of the July–June fiscal year.
const quarterDue = (fy, q) => {
  const y = parseInt(String(fy).slice(0, 4), 10);
  return [`${y}-09-30`, `${y}-12-31`, `${y + 1}-03-31`, `${y + 1}-06-30`][q - 1];
};

async function dueCandidates(days, projectId) {
  const today = ymd(new Date());
  const until = ymd(new Date(Date.now() + days * 86400000));
  const settings = await getSettings();
  const bn = settings.sms_language !== 'en';
  const tpls = {};
  for (const k of ['INSTALLMENT_DUE', 'SERVICE_CHARGE_DUE', 'HOLDING_TAX_DUE']) tpls[k] = await sms.getTemplate(k);
  const out = [];
  const fineCtx = await loadFineContext();
  // r.amount = unpaid principal; the fine (if any) is added on top and mentioned in the SMS.
  const push = (tplKey, related_type, related_key, r, fineType, fineKey) => {
    const tpl = tpls[tplKey];
    if (!tpl || !tpl.is_active) return;
    const f = fineFor(fineCtx, fineType, fineKey, r.amount, r.due_date);
    const fine = f.waived ? 0 : (r.fixedFine != null && !fineCtx.rules[fineType] ? r.fixedFine : f.fine);
    const total = round2(r.amount + fine);
    const fineNote = fine > 0 ? (bn ? ` (বিলম্ব জরিমানা ${fine.toLocaleString('en-IN')} টাকাসহ)` : ` (incl. late fine Tk ${fine.toLocaleString('en-IN')})`) : '';
    out.push({
      key: `${related_type}:${related_key}`, related_type, related_key, template_key: tplKey,
      name: r.name, phone: r.phone, unit: r.unit, item: r.item, principal: r.amount, fine, fine_waived: f.waived, days_late: f.days_late,
      amount: total, due_date: r.due_date, overdue: r.due_date < today,
      message: sms.render(bn ? tpl.body_bn : tpl.body_en, { ...r, amount: total.toLocaleString('en-IN'), fine_note: fineNote, due_date: dmy(r.due_date), org: settings.sms_signature }),
    });
  };

  const sch = db('owner_payment_schedules as s').join('owners as o', 'o.id_owners', 's.id_owners').leftJoin('units as u', 'u.id_units', 's.id_units')
    .whereNot('s.status', 'PAID').whereRaw('s.paid_amount < s.target_amount').where('s.due_date', '<=', until)
    .select('s.id_schedules', 's.installment_name', 's.target_amount', 's.paid_amount', 's.due_date', 'o.id_owners', 'o.full_name', 'o.phone', 'u.unit_number');
  if (projectId) sch.where('u.id_projects', projectId);
  for (const s of await sch) push('INSTALLMENT_DUE', 'SCHEDULE', `${s.id_schedules}:${s.id_owners}`, { name: s.full_name, phone: s.phone, unit: s.unit_number, item: s.installment_name, amount: round2(s.target_amount - s.paid_amount), due_date: ymd(s.due_date) }, 'INSTALLMENT', String(s.id_schedules));

  const sc = db('service_charges as c').join('unit_ownerships as uo', 'uo.id_units', 'c.id_units').join('owners as o', 'o.id_owners', 'uo.id_owners').join('units as u', 'u.id_units', 'c.id_units')
    .whereIn('c.status', ['UNPAID', 'OVERDUE']).where('c.due_date', '<=', until)
    .select('c.id_service_charges', 'c.billing_month', 'c.monthly_fee', 'c.late_fee', 'c.amount_paid', 'c.due_date', 'o.id_owners', 'o.full_name', 'o.phone', 'u.unit_number');
  if (projectId) sc.where('u.id_projects', projectId);
  for (const c of await sc) {
    // Without an active SERVICE_CHARGE rule, fall back to the late_fee typed on the bill.
    const amt = round2(Number(c.monthly_fee) - Number(c.amount_paid || 0));
    if (amt > 0) push('SERVICE_CHARGE_DUE', 'SERVICE_CHARGE', `${c.id_service_charges}:${c.id_owners}`, { name: c.full_name, phone: c.phone, unit: c.unit_number, item: c.billing_month, amount: amt, due_date: ymd(c.due_date), fixedFine: Number(c.late_fee || 0) }, 'SERVICE_CHARGE', String(c.id_service_charges));
  }

  const ht = db('holding_tax_register as h').whereNot('h.status', 'PAID');
  if (projectId) ht.where('h.id_projects', projectId);
  for (const h of await ht) {
    const owners = await db('units as u').join('unit_ownerships as uo', 'uo.id_units', 'u.id_units').join('owners as o', 'o.id_owners', 'uo.id_owners')
      .where('u.unit_number', h.unit_number).modify(q => { if (h.id_projects) q.where('u.id_projects', h.id_projects); })
      .select('o.id_owners', 'o.full_name', 'o.phone');
    for (const q of parseJson(h.quarters_json) || []) {
      const due = quarterDue(h.fiscal_year, q.q);
      if (q.paid || due > until) continue;
      for (const o of owners) push('HOLDING_TAX_DUE', 'HOLDING_TAX_Q', `${h.id_holding_tax}:${q.q}:${o.id_owners}`, { name: o.full_name, phone: o.phone, unit: h.unit_number, item: `${h.fiscal_year} Q${q.q}`, amount: Number(q.amount), due_date: due }, 'HOLDING_TAX', `${h.id_holding_tax}:${q.q}`);
    }
  }

  // Mark anything already texted in the last 3 days so staff don't spam owners.
  if (out.length) {
    const since = new Date(Date.now() - 3 * 86400000);
    const recent = await db('sms_outbox').whereIn('related_key', out.map(o => o.related_key)).whereIn('status', ['SENT', 'SIMULATED']).where('created_at', '>=', since).select('related_type', 'related_key', 'created_at');
    const last = new Map(recent.map(r => [`${r.related_type}:${r.related_key}`, r.created_at]));
    out.forEach(o => { o.last_sent_at = last.get(o.key) || null; o.valid_phone = !!sms.toMsisdn(o.phone); });
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

router.get('/sms/status', (req, res) => res.json({ success: true, ...sms.providerStatus() }));

router.get('/sms/due', async (req, res) => {
  try {
    const days = Math.max(0, Math.min(90, Number(req.query.days ?? 7)));
    res.json({ success: true, days, rows: await dueCandidates(days, req.query.projectId ? Number(req.query.projectId) : null) });
  } catch (err) { fail(res, err); }
});

// Texts the given due reminders. Anything already texted in the last 3 days is skipped unless force is set.
async function sendDueReminders(rows, createdBy, { force = false } = {}) {
  const results = { sent: 0, simulated: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    if (r.last_sent_at && !force) { results.skipped++; continue; }
    const out = await sms.sendSms({ to: r.phone, message: r.message, recipient_name: r.name, template_key: r.template_key, related_type: r.related_type, related_key: r.related_key, created_by: createdBy });
    results[out.status === 'SENT' ? 'sent' : out.status === 'SIMULATED' ? 'simulated' : 'failed']++;
  }
  const parts = Object.entries(results).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  return { results, message: `Reminders: ${parts.join(', ') || 'nothing to send'}` };
}

router.post('/sms/send-due', async (req, res) => {
  try {
    const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
    if (!keys.length) return res.status(400).json({ success: false, message: 'Select at least one reminder' });
    const days = Math.max(0, Math.min(90, Number(req.body.days ?? 30)));
    const rows = (await dueCandidates(days, null)).filter(r => keys.includes(r.key));
    res.json({ success: true, ...(await sendDueReminders(rows, userName(req), { force: !!req.body.force })) });
  } catch (err) { fail(res, err); }
});

router.post('/sms/send', async (req, res) => {
  try {
    const { to, message, name } = req.body || {};
    if (!sms.toMsisdn(to)) return res.status(400).json({ success: false, message: 'Enter a valid Bangladeshi mobile number' });
    if (!String(message || '').trim()) return res.status(400).json({ success: false, message: 'Message is empty' });
    const out = await sms.sendSms({ to, message: String(message).trim(), recipient_name: name, related_type: 'MANUAL', created_by: userName(req) });
    res.status(out.status === 'FAILED' ? 502 : 200).json({ success: out.status !== 'FAILED', message: out.status === 'FAILED' ? `SMS failed: ${out.response}` : `SMS ${out.status.toLowerCase()} (${out.segments} part${out.segments > 1 ? 's' : ''})`, ...out });
  } catch (err) { fail(res, err); }
});

router.get('/sms/outbox', async (req, res) => {
  try {
    const rows = await db('sms_outbox').orderBy('id_sms', 'desc').limit(300);
    res.json({ success: true, rows });
  } catch (err) { fail(res, err); }
});

router.get('/sms/templates', async (req, res) => {
  try {
    await sms.ensureTemplates();
    res.json({ success: true, rows: await db('sms_templates').orderBy('template_key') });
  } catch (err) { fail(res, err); }
});

router.put('/sms/templates/:key', async (req, res) => {
  try {
    const { body_en, body_bn, is_active } = req.body || {};
    if (!String(body_en || '').trim() || !String(body_bn || '').trim()) return res.status(400).json({ success: false, message: 'Both English and Bangla text are required' });
    const n = await db('sms_templates').where({ template_key: req.params.key }).update({ body_en, body_bn, is_active: is_active !== false, updated_at: new Date() });
    if (!n) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: 'Template saved' });
  } catch (err) { fail(res, err); }
});

// ── Online payments log ──────────────────────────────────────
router.get('/online-payments', async (req, res) => {
  try {
    const rows = await db('online_payments as p').join('owners as o', 'o.id_owners', 'p.id_owners').leftJoin('money_receipts as r', 'r.id_receipts', 'p.id_receipts')
      .select('p.id_online_payments', 'p.tran_id', 'p.purpose', 'p.amount_bdt', 'p.gateway', 'p.status', 'p.card_type', 'p.bank_tran_id', 'p.created_at', 'p.paid_at', 'p.id_receipts', 'r.receipt_no', 'o.full_name as owner_name', 'p.initiated_by')
      .orderBy('p.id_online_payments', 'desc').limit(300);
    res.json({ success: true, rows, gateway: { mode: gatewayMode(), sandbox: sandbox() } });
  } catch (err) { fail(res, err); }
});

// ── Late payment fines ───────────────────────────────────────
const FINE_TYPES = ['FIXED', 'PERCENT', 'PER_DAY_FIXED', 'PER_DAY_PERCENT', 'PER_MONTH_PERCENT'];
const ITEM_TYPES = ['INSTALLMENT', 'SERVICE_CHARGE', 'HOLDING_TAX', 'UTILITY_BILL', 'OTHER'];

router.get('/late-fee-rules', async (req, res) => {
  try { res.json({ success: true, rows: await db('master_late_fee_rules').orderBy(['item_type', 'id_late_fee_rules']) }); } catch (err) { fail(res, err); }
});

router.post('/late-fee-rules', async (req, res) => {
  try {
    const b = req.body || {};
    if (!ITEM_TYPES.includes(b.item_type)) return res.status(400).json({ success: false, message: 'Choose what the fine applies to' });
    if (!FINE_TYPES.includes(b.fine_type)) return res.status(400).json({ success: false, message: 'Choose a fine type' });
    if (!String(b.item_name_en || '').trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    const amount = Number(b.fine_amount);
    if (!(amount >= 0)) return res.status(400).json({ success: false, message: 'Fine amount must be 0 or more' });
    if (b.fine_type.includes('PERCENT') && amount > 100) return res.status(400).json({ success: false, message: 'A percentage fine cannot exceed 100%' });
    const row = {
      item_type: b.item_type, item_name_en: b.item_name_en.trim(), item_name_bn: b.item_name_bn || null,
      fine_type: b.fine_type, fine_amount: amount, grace_days: Math.max(0, parseInt(b.grace_days || 0, 10)),
      count_from: b.count_from === 'AFTER_GRACE' ? 'AFTER_GRACE' : 'DUE_DATE', max_fine_bdt: Math.max(0, Number(b.max_fine_bdt || 0)),
      is_active: b.is_active !== false && b.is_active !== 0, notes: b.notes || null,
    };
    // Only one active rule per item type — activating this one switches the others off.
    await db.transaction(async trx => {
      let id = b.id_late_fee_rules;
      if (id) await trx('master_late_fee_rules').where({ id_late_fee_rules: id }).update(row);
      else [id] = await trx('master_late_fee_rules').insert({ ...row, rule_code: (b.rule_code || `LF-${b.item_type}-${Date.now().toString(36)}`).toUpperCase().slice(0, 50) });
      if (row.is_active) await trx('master_late_fee_rules').where({ item_type: row.item_type, is_active: true }).whereNot({ id_late_fee_rules: id }).update({ is_active: false });
    });
    res.json({ success: true, message: 'Late fine rule saved' });
  } catch (err) { fail(res, err); }
});

router.delete('/late-fee-rules/:id', async (req, res) => {
  try {
    await db('master_late_fee_rules').where({ id_late_fee_rules: req.params.id }).del();
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) { fail(res, err); }
});

// Preview what a rule would charge, for the master form
router.post('/late-fee-rules/preview', (req, res) => {
  const { computeFine } = require('../utils/latefee');
  const b = req.body || {};
  const rule = { ...b, is_active: true };
  const due = new Date(Date.now() - Number(b.days_late || 0) * 86400000);
  res.json({ success: true, ...computeFine(rule, { outstanding: Number(b.outstanding || 0), due_date: due }) });
});

// Every overdue item with its current fine (one row per item, not per owner)
router.get('/late-fees', async (req, res) => {
  try {
    const rows = (await dueCandidates(0, null)).filter(r => r.overdue);
    const seen = new Set();
    const items = [];
    for (const r of rows) {
      const fineType = { SCHEDULE: 'INSTALLMENT', SERVICE_CHARGE: 'SERVICE_CHARGE', HOLDING_TAX_Q: 'HOLDING_TAX' }[r.related_type];
      const parts = r.related_key.split(':');
      const itemKey = r.related_type === 'HOLDING_TAX_Q' ? `${parts[0]}:${parts[1]}` : parts[0];
      if (seen.has(`${fineType}:${itemKey}`)) continue;
      seen.add(`${fineType}:${itemKey}`);
      items.push({ item_type: fineType, item_key: itemKey, name: r.name, unit: r.unit, item: r.item, due_date: r.due_date, days_late: r.days_late, principal: r.principal, fine: r.fine, waived: r.fine_waived });
    }
    const waivers = await db('late_fee_waivers').orderBy('id_waivers', 'desc');
    res.json({ success: true, rows: items, waivers, total_fine: round2(items.reduce((s, i) => s + i.fine, 0)) });
  } catch (err) { fail(res, err); }
});

router.post('/late-fees/waive', async (req, res) => {
  try {
    const { item_type, item_key, reason, fine } = req.body || {};
    if (!['INSTALLMENT', 'SERVICE_CHARGE', 'HOLDING_TAX'].includes(item_type) || !item_key) return res.status(400).json({ success: false, message: 'Unknown item' });
    if (String(reason || '').trim().length < 3) return res.status(400).json({ success: false, message: 'Give a reason for waiving the fine' });
    await db('late_fee_waivers').insert({ item_type, item_key: String(item_key), reason: String(reason).trim().slice(0, 255), fine_at_waiver_bdt: Number(fine || 0), waived_by: userName(req) })
      .onConflict(['item_type', 'item_key']).merge();
    await db('audit_logs').insert({ user_name: userName(req), action: 'WAIVE_LATE_FEE', entity_type: item_type, entity_id: String(item_key), new_value: JSON.stringify({ reason, fine }), created_at: new Date() }).catch(() => {});
    res.json({ success: true, message: 'Late fine waived' });
  } catch (err) { fail(res, err); }
});

router.delete('/late-fees/waive/:type/:key', async (req, res) => {
  try {
    await db('late_fee_waivers').where({ item_type: req.params.type, item_key: req.params.key }).del();
    res.json({ success: true, message: 'Waiver removed — the fine applies again' });
  } catch (err) { fail(res, err); }
});

// ── Receipt items master (particulars with default amounts) ──
const RI_CATEGORIES = ['FLAT_SALE', 'INSTALLMENT', 'SERVICE_CHARGE', 'UTILITY', 'PARKING', 'TRANSFER_FEE', 'PENALTY', 'OTHER'];
router.get('/receipt-items', async (req, res) => {
  try {
    const q = db('master_receipt_items').orderBy([{ column: 'sort_order' }, { column: 'id_receipt_items' }]);
    if (req.query.active) q.where({ is_active: true });
    res.json({ success: true, rows: await q });
  } catch (err) { fail(res, err); }
});

router.post('/receipt-items', async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.item_name_en || '').trim()) return res.status(400).json({ success: false, message: 'Item name is required' });
    const num = (v, max) => { const n = Number(v || 0); return n >= 0 && (max == null || n <= max) ? n : NaN; };
    const row = {
      item_name_en: b.item_name_en.trim().slice(0, 200), item_name_bn: b.item_name_bn ? String(b.item_name_bn).slice(0, 200) : null,
      category: RI_CATEGORIES.includes(b.category) ? b.category : 'OTHER', uom: String(b.uom || '').slice(0, 30),
      default_amount_bdt: num(b.default_amount_bdt), vat_rate: num(b.vat_rate, 100), sd_rate: num(b.sd_rate, 100),
      is_active: b.is_active !== false && b.is_active !== 0, sort_order: parseInt(b.sort_order || 0, 10) || 0,
    };
    if ([row.default_amount_bdt, row.vat_rate, row.sd_rate].some(Number.isNaN)) return res.status(400).json({ success: false, message: 'Amounts must be 0 or more, and rates at most 100%' });
    if (b.id_receipt_items) await db('master_receipt_items').where({ id_receipt_items: b.id_receipt_items }).update(row);
    else {
      const code = String(b.item_code || `RI-${Date.now().toString(36)}`).toUpperCase().replace(/\s+/g, '-').slice(0, 50);
      if (await db('master_receipt_items').where({ item_code: code }).first()) return res.status(409).json({ success: false, message: `Code ${code} already exists` });
      await db('master_receipt_items').insert({ ...row, item_code: code });
    }
    res.json({ success: true, message: 'Receipt item saved' });
  } catch (err) { fail(res, err); }
});

router.delete('/receipt-items/:id', async (req, res) => {
  try {
    await db('master_receipt_items').where({ id_receipt_items: req.params.id }).del();
    res.json({ success: true, message: 'Receipt item deleted' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
// Used by the scheduler (jobs/definitions.js).
module.exports.dueCandidates = dueCandidates;
module.exports.sendDueReminders = sendDueReminders;
