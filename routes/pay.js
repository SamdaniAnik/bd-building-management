// Online payment for flat owners via SSLCommerz (bKash / Nagad / Rocket / cards).
// /initiate, /config, /my-receipts need a logged-in user; the /sslcommerz/* callbacks are called by
// the gateway (no JWT) and are trusted only after server-to-server validation.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('../db/schemas');
const checkAuth = require('../middleware/auth');
const { round2 } = require('../utils/bd');
const gw = require('../utils/sslcommerz');
const { issueReceipt, parseJson } = require('../utils/receipts');
const { getSettings } = require('../utils/org');
const { loadFineContext, fineFor } = require('../utils/latefee');

const fail = (res, err, code) => res.status(code || err.status || 500).json({ success: false, message: err.message || String(err) });
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function ownerForUser(user, requestedOwnerId) {
  if (checkAuth.isStaff(user)) {
    if (!requestedOwnerId) return null;
    return db('owners').where({ id_owners: requestedOwnerId }).first();
  }
  return db('owners').where({ login_email: user.email }).first();
}

router.get('/config', checkAuth, (req, res) => {
  res.json({ success: true, enabled: !!gw.gatewayMode(), mode: gw.gatewayMode(), sandbox: gw.sandbox() });
});

router.post('/initiate', checkAuth, async (req, res) => {
  try {
    const mode = gw.gatewayMode();
    if (!mode) return fail(res, new Error('Online payment is not configured. Set SSLCZ_STORE_ID and SSLCZ_STORE_PASSWD on the server.'), 503);

    const owner = await ownerForUser(req.user, req.body.id_owners);
    if (!owner) return fail(res, new Error(checkAuth.isStaff(req.user) ? 'Choose the owner to pay for (id_owners)' : 'No flat owner profile is linked to this login'), 400);

    let amount; let purpose; let idUnits = null; let idSchedules = null; let idProjects = null;
    let principal = null; let fine = 0; let daysLate = null;
    if (req.body.id_schedules) {
      const s = await db('owner_payment_schedules').where({ id_schedules: req.body.id_schedules, id_owners: owner.id_owners }).first();
      if (!s) return fail(res, new Error('Instalment not found for this owner'), 404);
      principal = round2(Number(s.target_amount) - Number(s.paid_amount || 0));
      if (principal <= 0 || s.status === 'PAID') return fail(res, new Error('This instalment is already paid'), 400);
      const f = fineFor(await loadFineContext(), 'INSTALLMENT', String(s.id_schedules), principal, s.due_date);
      fine = f.fine; daysLate = f.days_late;
      amount = round2(principal + fine);
      purpose = s.installment_name; idUnits = s.id_units; idSchedules = s.id_schedules;
    } else {
      amount = round2(req.body.amount);
      if (!(amount >= 10)) return fail(res, new Error('Minimum online payment is ৳10'), 400);
      if (amount > 5000000) return fail(res, new Error('Amounts above ৳50 lakh must be paid by bank transfer / pay order'), 400);
      purpose = String(req.body.purpose || 'Advance contribution').slice(0, 200);
      idUnits = req.body.id_units || null;
      principal = amount;
    }
    if (idUnits) {
      const owns = await db('unit_ownerships').where({ id_units: idUnits, id_owners: owner.id_owners }).first();
      if (!owns) return fail(res, new Error('That flat does not belong to this owner'), 400);
      idProjects = (await db('units').where({ id_units: idUnits }).first())?.id_projects || null;
    }

    const tran_id = `SB${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await db('online_payments').insert({
      tran_id, id_projects: idProjects, id_owners: owner.id_owners, id_units: idUnits, id_schedules: idSchedules,
      purpose, amount_bdt: amount, principal_bdt: principal, fine_bdt: fine, fine_days_late: daysLate, gateway: mode, status: 'INITIATED', initiated_by: req.user.email,
    });

    let url;
    if (mode === 'MOCK') url = `${gw.publicApiUrl()}/api/pay/mock/${tran_id}`;
    else {
      try {
        const session = await gw.initSession({ tran_id, amount, product_name: purpose, customer: { name: owner.full_name, email: owner.email, phone: owner.phone, address: owner.address } });
        url = session.url;
        await db('online_payments').where({ tran_id }).update({ session_key: session.session_key });
      } catch (e) {
        await db('online_payments').where({ tran_id }).update({ status: 'FAILED', gateway_response_json: JSON.stringify({ error: e.message }) });
        throw e;
      }
    }
    res.json({ success: true, tran_id, amount, principal, fine, url });
  } catch (err) { fail(res, err); }
});

// Validates with the gateway, then posts the payment exactly once (success redirect and IPN can race).
async function finalize(tran_id, val_id) {
  const p = await db('online_payments').where({ tran_id }).first();
  if (!p) return { status: 'UNKNOWN' };
  if (p.status === 'PAID') return { status: 'PAID', payment: p };
  // A payment that already failed / was cancelled / mismatched is never revived by a later callback.
  if (p.status !== 'INITIATED') return { status: p.status };

  let v;
  if (p.gateway === 'MOCK') {
    if (gw.gatewayMode() !== 'MOCK' || val_id !== `MOCK-${tran_id}`) return { status: 'FAILED', reason: 'Mock gateway disabled or bad val_id' };
    v = { status: 'VALID', tran_id, amount: String(p.amount_bdt), currency: 'BDT', val_id, bank_tran_id: `MOCK${Date.now()}`, card_type: 'MOCK-Test' };
  } else {
    if (!val_id) return { status: 'FAILED', reason: 'Missing val_id' };
    v = await gw.validate(val_id);
  }

  const valid = ['VALID', 'VALIDATED'].includes(v.status) && v.tran_id === tran_id;
  const amountOk = valid && v.currency === 'BDT' && Math.abs(Number(v.amount) - Number(p.amount_bdt)) < 0.01;
  if (!valid || !amountOk) {
    await db('online_payments').where({ tran_id, status: 'INITIATED' }).update({ status: valid ? 'AMOUNT_MISMATCH' : 'FAILED', val_id: val_id || null, gateway_response_json: JSON.stringify(v) });
    return { status: valid ? 'AMOUNT_MISMATCH' : 'FAILED' };
  }

  let posted = false; let contributionId = null;
  await db.transaction(async trx => {
    const locked = await trx('online_payments').where({ tran_id }).forUpdate().first();
    if (locked.status !== 'INITIATED') return;
    const amount = Number(locked.amount_bdt);
    [contributionId] = await trx('owner_contributions').insert({
      id_owners: locked.id_owners, id_units: locked.id_units, id_projects: locked.id_projects, amount, payment_date: today(),
      contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: `ONLINE_${(v.card_type || 'SSLCOMMERZ').split('-')[0]}`.slice(0, 50),
      bank_or_cash_account: 'SSLCommerz Merchant Account', reference: v.bank_tran_id || tran_id, notes: `Online payment ${tran_id}: ${locked.purpose}`,
    });
    const fineAmt = Number(locked.fine_bdt || 0);
    const principalAmt = round2(amount - fineAmt);
    const last = await trx('owner_ledgers').where({ id_owners: locked.id_owners }).orderBy('id_ledger', 'desc').first();
    let balance = Number(last?.running_balance || 0);
    if (fineAmt > 0) {
      // The fine is a new charge on the owner's account, settled by the same payment.
      balance = round2(balance + fineAmt);
      await trx('owner_ledgers').insert({
        id_owners: locked.id_owners, id_units: locked.id_units, transaction_date: today(), entry_type: 'DEBIT', category: 'OTHER_CHARGE',
        description: `Late payment fine — ${locked.purpose} (${locked.fine_days_late} days late)`.slice(0, 255), debit_amount: fineAmt, credit_amount: 0,
        running_balance: balance, reference_id: tran_id,
      });
    }
    await trx('owner_ledgers').insert({
      id_owners: locked.id_owners, id_units: locked.id_units, transaction_date: today(), entry_type: 'CREDIT', category: 'OWNER_PAYMENT',
      description: `Online payment — ${locked.purpose}`.slice(0, 255), debit_amount: 0, credit_amount: amount,
      running_balance: round2(balance - amount), reference_id: tran_id,
    });
    if (locked.id_schedules) {
      const s = await trx('owner_payment_schedules').where({ id_schedules: locked.id_schedules }).forUpdate().first();
      const paid = round2(Number(s.paid_amount || 0) + principalAmt);
      await trx('owner_payment_schedules').where({ id_schedules: s.id_schedules }).update({
        paid_amount: paid, late_fee_applicable: round2(Number(s.late_fee_applicable || 0) + fineAmt),
        ...(paid >= Number(s.target_amount) ? { status: 'PAID', paid_date: today() } : {}),
      });
    }
    await trx('online_payments').where({ tran_id }).update({
      status: 'PAID', val_id: val_id || null, bank_tran_id: v.bank_tran_id || null, card_type: v.card_type || null,
      gateway_response_json: JSON.stringify(v), id_contributions: contributionId, paid_at: new Date(),
    });
    posted = true;
  });

  if (posted) {
    // Receipt + SMS are best-effort: the payment is already safely recorded.
    try {
      const owner = await db('owners').where({ id_owners: p.id_owners }).first();
      const unit = p.id_units ? await db('units').where({ id_units: p.id_units }).first() : null;
      const settings = await getSettings();
      const { receipt } = await issueReceipt({
        id_projects: p.id_projects, id_owners: p.id_owners, unit_number: unit?.unit_number, received_from: owner.full_name, phone: owner.phone, address: owner.address,
        items: [
          { description: `${p.purpose}${unit ? ` — Flat ${unit.unit_number}` : ''}`, qty: 1, unit_price: round2(Number(p.amount_bdt) - Number(p.fine_bdt || 0)) },
          ...(Number(p.fine_bdt) > 0 ? [{ description: `Late payment fine (${p.fine_days_late} days late)`, qty: 1, unit_price: Number(p.fine_bdt) }] : []),
        ],
        payment_method: `Online (${v.card_type || 'SSLCommerz'})`, payment_ref: `${tran_id}${v.bank_tran_id ? ` / ${v.bank_tran_id}` : ''}`,
        source_type: 'ONLINE_PAYMENT', source_id: p.id_online_payments,
      }, { sendSms: settings.sms_auto_payment_received !== 'false', createdBy: 'Online payment' });
      await db('online_payments').where({ tran_id }).update({ id_receipts: receipt.id_receipts });
      await db('owner_contributions').where({ id_contributions: contributionId }).update({ receipt_number: receipt.receipt_no });
    } catch (e) { console.error('Receipt after online payment failed:', e.message); }
  }
  return { status: 'PAID' };
}

const back = (res, status, tran_id) => res.redirect(303, `${gw.frontendUrl()}/apartment/owner-portal?payment=${status}&tran_id=${encodeURIComponent(tran_id || '')}`);

router.post('/sslcommerz/success', async (req, res) => {
  const { tran_id, val_id } = req.body || {};
  try {
    const out = await finalize(tran_id, val_id);
    back(res, out.status === 'PAID' ? 'success' : 'failed', tran_id);
  } catch (e) { console.error('Payment finalize error:', e); back(res, 'error', tran_id); }
});

router.post('/sslcommerz/ipn', async (req, res) => {
  const { tran_id, val_id, status } = req.body || {};
  try {
    if (['FAILED', 'CANCELLED', 'UNATTEMPTED', 'EXPIRED'].includes(String(status).toUpperCase())) {
      await db('online_payments').where({ tran_id, status: 'INITIATED' }).update({ status: String(status).toUpperCase() === 'CANCELLED' ? 'CANCELLED' : 'FAILED', gateway_response_json: JSON.stringify(req.body) });
      return res.json({ success: true });
    }
    const out = await finalize(tran_id, val_id);
    res.json({ success: out.status === 'PAID', status: out.status });
  } catch (e) { console.error('IPN error:', e); res.status(500).json({ success: false }); }
});

for (const [path, status] of [['fail', 'FAILED'], ['cancel', 'CANCELLED']]) {
  router.post(`/sslcommerz/${path}`, async (req, res) => {
    const tran_id = req.body?.tran_id;
    if (tran_id) await db('online_payments').where({ tran_id, status: 'INITIATED' }).update({ status, gateway_response_json: JSON.stringify(req.body) }).catch(() => {});
    back(res, status === 'CANCELLED' ? 'cancelled' : 'failed', tran_id);
  });
}

// Local test checkout page (PAYMENT_MOCK=true, never in production)
router.get('/mock/:tran_id', async (req, res) => {
  if (gw.gatewayMode() !== 'MOCK') return res.status(404).send('Not found');
  const p = await db('online_payments').where({ tran_id: req.params.tran_id }).first();
  if (!p) return res.status(404).send('Unknown transaction');
  const cb = `${gw.publicApiUrl()}/api/pay/sslcommerz`;
  const form = (path, label, color) => `<form method="post" action="${cb}/${path}" style="display:inline"><input type="hidden" name="tran_id" value="${esc(p.tran_id)}"><input type="hidden" name="val_id" value="MOCK-${esc(p.tran_id)}"><button style="background:${color};color:#fff;border:0;padding:12px 20px;border-radius:8px;font-size:15px;cursor:pointer;margin:4px">${label}</button></form>`;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment</title></head>
<body style="font-family:system-ui,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="background:#fff;padding:28px;border-radius:14px;max-width:420px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,.1)">
<div style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:16px">TEST MODE — no real money moves. Configure SSLCommerz for live payments.</div>
<h2 style="margin:0 0 4px">৳${Number(p.amount_bdt).toLocaleString('en-IN')}</h2>${Number(p.fine_bdt) > 0 ? `<div style="color:#b91c1c;font-size:13px">includes late fine ৳${Number(p.fine_bdt).toLocaleString('en-IN')}</div>` : ''}<div style="color:#64748b;margin-bottom:20px">${esc(p.purpose)}<br><small>${esc(p.tran_id)}</small></div>
${form('success', 'Simulate successful payment', '#059669')}${form('fail', 'Simulate failure', '#dc2626')}${form('cancel', 'Cancel', '#64748b')}
</div></body></html>`);
});

// Owners can open their own receipts (staff can open any)
router.get('/my-receipts/:id', checkAuth, async (req, res) => {
  try {
    const r = await db('money_receipts').where({ id_receipts: req.params.id }).first();
    if (!r) return fail(res, new Error('Receipt not found'), 404);
    if (!checkAuth.isStaff(req.user)) {
      const owner = await db('owners').where({ login_email: req.user.email }).first();
      if (!owner || owner.id_owners !== r.id_owners) return fail(res, new Error('Receipt not found'), 404);
    }
    r.line_items_json = parseJson(r.line_items_json);
    res.json({ success: true, receipt: r, settings: await getSettings() });
  } catch (err) { fail(res, err); }
});

module.exports = router;
