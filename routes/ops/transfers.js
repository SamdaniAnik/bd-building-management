// Flat & share transfer (ফ্ল্যাট / শেয়ার হস্তান্তর).
//
// DRAFT     — application: flat, type, who gives what share (FROM), who receives it (TO), fee, deed details.
// APPROVED  — the association / developer clearance (অনাপত্তি সনদ): dues checked and snapshotted, fee paid or
//             waived, bank release for a mortgaged flat, succession certificate for inheritance.
// COMPLETED — ownership register (unit_ownerships) changes on the effective date; unpaid instalments and rent
//             agreements can move to the new owner. The before/after share of every party is kept.
// CANCELLED — any time before completion.
//
// Types: SALE, GIFT (হেবা), INHERITANCE (উত্তরাধিকার), BOOKING (allotment transferred before registration),
// INTERNAL (shares rearranged between people who already own the flat).
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, round2, ymd, today, unitsQuery, method } = require('./common');
const { isValidBdMobile, normalizeBdMobile, nidError } = require('../../utils/bd');
const { issueReceipt } = require('../../utils/receipts');
const { getSettings } = require('../../utils/org');
const sms = require('../../utils/sms');

const TYPES = ['SALE', 'GIFT', 'INHERITANCE', 'BOOKING', 'INTERNAL'];
const NEEDS_DEED = ['SALE', 'GIFT'];
const EPS = 0.005;

const activeOwnership = q => q.where(w => w.whereNull('uo.status').orWhere('uo.status', 'ACTIVE'));

async function currentOwners(unitId, conn = db) {
  return activeOwnership(conn('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners'))
    .where('uo.id_units', unitId).orderBy('uo.ownership_percentage', 'desc')
    .select('uo.id_unit_ownerships', 'uo.id_owners', 'uo.ownership_percentage', 'o.full_name', 'o.phone', 'o.identification_reference', 'o.address');
}

async function nextTransferNo(trx) {
  const year = today().slice(0, 4);
  const last = await trx('ownership_transfers').where('transfer_no', 'like', `TR-${year}-%`).orderBy('transfer_no', 'desc').forUpdate().first();
  const n = last ? Number(last.transfer_no.split('-')[2]) + 1 : 1;
  return `TR-${year}-${String(n).padStart(4, '0')}`;
}

// What stands against the flat and its outgoing owners. `blocking` items stop approval unless overridden.
async function duesCheck(unitId, sellerIds) {
  const t = today();
  const items = [];
  const sc = await db('service_charges').where({ id_units: unitId }).whereNot('status', 'PAID').where('due_date', '<=', t)
    .select('billing_month', 'monthly_fee', 'amount_paid', 'due_date');
  for (const c of sc) {
    const amt = round2(Number(c.monthly_fee) - Number(c.amount_paid || 0));
    if (amt > 0) items.push({ kind: 'SERVICE_CHARGE', label: `Service charge ${c.billing_month}`, label_bn: `সার্ভিস চার্জ ${c.billing_month}`, due_date: ymd(c.due_date), amount_bdt: amt, blocking: true });
  }
  const sellers = sellerIds.length ? sellerIds : [0];
  const sch = await db('owner_payment_schedules').where({ id_units: unitId }).whereIn('id_owners', sellers).whereRaw('paid_amount < target_amount')
    .select('id_owners', 'installment_name', 'target_amount', 'paid_amount', 'due_date');
  for (const s of sch) {
    const amt = round2(Number(s.target_amount) - Number(s.paid_amount));
    const due = ymd(s.due_date) <= t;
    items.push({ kind: due ? 'INSTALMENT_DUE' : 'INSTALMENT_FUTURE', label: `${s.installment_name}${due ? '' : ' (not yet due)'}`, label_bn: `${s.installment_name}${due ? '' : ' (মেয়াদ আসেনি)'}`,
      due_date: ymd(s.due_date), amount_bdt: amt, blocking: due, id_owners: s.id_owners, partly_paid: Number(s.paid_amount) > 0 });
  }
  const ht = await db('holding_tax_register').where({ id_units: unitId }).where('due_bdt', '>', 0).select('fiscal_year', 'due_bdt', 'authority');
  for (const h of ht) items.push({ kind: 'HOLDING_TAX', label: `Holding tax ${h.fiscal_year} (${h.authority})`, label_bn: `হোল্ডিং ট্যাক্স ${h.fiscal_year}`, amount_bdt: num(h.due_bdt), blocking: true });
  const loans = await db('owner_loans').where({ id_units: unitId }).whereIn('id_owners', sellers).where('status', 'ACTIVE').where('outstanding_amount', '>', 0)
    .select('id_loans', 'id_owners', 'bank_lender_name', 'outstanding_amount');
  const blockingTotal = round2(items.filter(i => i.blocking).reduce((s, i) => s + i.amount_bdt, 0));
  const futureTotal = round2(items.filter(i => i.kind === 'INSTALMENT_FUTURE').reduce((s, i) => s + i.amount_bdt, 0));
  return { checked_on: t, items, blocking_total_bdt: blockingTotal, future_instalments_bdt: futureTotal,
    loans: loans.map(l => ({ ...l, outstanding_amount: num(l.outstanding_amount) })) };
}

async function loadTransfer(id) {
  const tr = await db('ownership_transfers').where({ id_transfers: id }).first();
  if (!tr) throw Object.assign(new Error('Transfer not found'), { status: 404 });
  const parties = await db('ownership_transfer_parties as p').join('owners as o', 'o.id_owners', 'p.id_owners').where('p.id_transfers', id)
    .orderBy('p.side').orderBy('p.id').select('p.*', 'o.full_name', 'o.phone', 'o.identification_reference', 'o.address');
  tr.dues_snapshot = typeof tr.dues_snapshot === 'string' ? JSON.parse(tr.dues_snapshot) : tr.dues_snapshot;
  for (const k of ['application_date', 'effective_date', 'deed_date', 'mutation_date']) tr[k] = ymd(tr[k]);
  const unit = await unitsQuery().where('u.id_units', tr.id_units).first();
  return { ...tr, unit, from: parties.filter(p => p.side === 'FROM'), to: parties.filter(p => p.side === 'TO') };
}

// Checks the parties against the current register. Returns { from, to } with numbers cleaned.
function checkParties(type, from, to, owners) {
  const holding = new Map(owners.map(o => [o.id_owners, Number(o.ownership_percentage)]));
  if (!from.length) throw bad('Add who is transferring their share');
  if (!to.length) throw bad('Add who receives the share');
  const seen = new Set();
  for (const f of from) {
    if (seen.has(f.id_owners)) throw bad('An owner is listed twice on the transferring side');
    seen.add(f.id_owners);
    if (!holding.has(f.id_owners)) throw bad('Someone on the transferring side does not own this flat now');
    if (!(f.percent > 0)) throw bad('Each transferring owner must give more than 0%');
    if (f.percent - holding.get(f.id_owners) > EPS) throw bad(`An owner holds ${holding.get(f.id_owners)}% but is giving ${f.percent}%`);
    if (type === 'INHERITANCE' && Math.abs(f.percent - holding.get(f.id_owners)) > EPS) throw bad('In an inheritance the deceased owner’s whole share passes to the heirs');
  }
  if (type === 'INHERITANCE' && from.length !== 1) throw bad('An inheritance transfers one deceased owner’s share');
  const toSeen = new Set();
  for (const x of to) {
    if (toSeen.has(x.id_owners)) throw bad('A person is listed twice on the receiving side');
    toSeen.add(x.id_owners);
    if (seen.has(x.id_owners)) throw bad('The same person cannot be on both sides');
    if (!(x.percent > 0)) throw bad('Each receiver must get more than 0%');
    if (type === 'INTERNAL' && !holding.has(x.id_owners)) throw bad('An internal transfer is only between people who already own this flat');
  }
  const out = round2(from.reduce((s, f) => s + f.percent, 0));
  const inn = round2(to.reduce((s, f) => s + f.percent, 0));
  if (Math.abs(out - inn) > EPS) throw bad(`Shares do not balance: ${out}% given but ${inn}% received`);
  return { out };
}

// New people on the receiving side (buyers, heirs) are added to owners when the draft is saved.
async function resolveReceiver(x, trx) {
  if (x.id_owners) {
    if (!(await trx('owners').where({ id_owners: x.id_owners }).first())) throw bad('Receiver not found');
    return Number(x.id_owners);
  }
  const p = x.new_owner || {};
  const name = String(p.full_name || '').trim();
  if (!name) throw bad('Enter the new owner’s full name');
  if (!isValidBdMobile(p.phone)) throw bad(`Enter a valid Bangladeshi mobile number for ${name}`);
  const nidErr = nidError(p.nid_no);
  if (nidErr) throw bad(`${name}: ${nidErr}`);
  const phone = normalizeBdMobile(p.phone);
  const nid = p.nid_no ? String(p.nid_no).replace(/[\s-]/g, '') : null;
  // Re-use the person if they are already on file with the same NID.
  if (nid) { const same = await trx('owners').where({ identification_reference: nid }).first(); if (same) return same.id_owners; }
  const [id] = await trx('owners').insert({ full_name: name.slice(0, 200), phone, identification_reference: nid, address: p.address || null, email: p.email || null, ownership_status: 'ACTIVE' });
  return id;
}

// ── Lookups ─────────────────────────────────────────────────────
router.get('/lookup', async (req, res) => {
  try {
    const units = await unitsQuery().orderBy('u.id_buildings').orderBy('u.unit_number');
    const own = await activeOwnership(db('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners'))
      .select('uo.id_units', 'uo.id_owners', 'uo.ownership_percentage', 'o.full_name');
    const by = {};
    for (const o of own) (by[o.id_units] ||= []).push({ id_owners: o.id_owners, full_name: o.full_name, ownership_percentage: Number(o.ownership_percentage) });
    const fee = await db('master_receipt_items').where({ item_code: 'RI-TRANSFER' }).first().catch(() => null);
    res.json({ success: true, types: TYPES, default_fee_bdt: fee ? num(fee.default_amount_bdt) : 0,
      units: units.map(u => ({ ...u, owners: by[u.id_units] || [] })),
      owners: await db('owners').orderBy('full_name').select('id_owners', 'full_name', 'phone', 'identification_reference') });
  } catch (err) { fail(res, err); }
});

router.get('/', async (req, res) => {
  try {
    const q = db('ownership_transfers as t').leftJoin('units as u', 'u.id_units', 't.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
      .orderBy('t.id_transfers', 'desc').select('t.*', 'u.unit_number', 'b.building_name');
    if (req.query.status) q.where('t.status', req.query.status);
    if (req.query.unit) q.where('t.id_units', req.query.unit);
    const rows = await q;
    const parties = rows.length ? await db('ownership_transfer_parties as p').join('owners as o', 'o.id_owners', 'p.id_owners')
      .whereIn('p.id_transfers', rows.map(r => r.id_transfers)).select('p.id_transfers', 'p.side', 'p.percent', 'o.full_name') : [];
    const names = (id, side) => parties.filter(p => p.id_transfers === id && p.side === side).map(p => `${p.full_name} (${Number(p.percent)}%)`).join(', ');
    const count = s => rows.filter(r => r.status === s).length;
    res.json({ success: true, rows: rows.map(r => ({ ...r, application_date: ymd(r.application_date), effective_date: ymd(r.effective_date), from_names: names(r.id_transfers, 'FROM'), to_names: names(r.id_transfers, 'TO') })),
      summary: { draft: count('DRAFT'), approved: count('APPROVED'), completed: count('COMPLETED'),
        fees_bdt: num(rows.filter(r => r.status !== 'CANCELLED' && !r.fee_waived).reduce((s, r) => s + Number(r.transfer_fee_bdt || 0), 0)) } });
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const tr = await loadTransfer(req.params.id);
    const owners = await currentOwners(tr.id_units);
    // Live check while the application is open; the snapshot taken at approval afterwards.
    const dues = tr.status === 'DRAFT' ? await duesCheck(tr.id_units, tr.from.map(f => f.id_owners)) : tr.dues_snapshot;
    const receipt = tr.id_receipts ? await db('money_receipts').where({ id_receipts: tr.id_receipts }).select('id_receipts', 'receipt_no', 'total_bdt', 'issue_datetime').first() : null;
    res.json({ success: true, transfer: tr, current_owners: owners, dues, receipt, settings: await getSettings() });
  } catch (err) { fail(res, err); }
});

// Chain of title for one flat: every completed transfer, oldest first.
router.get('/history/:unitId', async (req, res) => {
  try {
    const ids = await db('ownership_transfers').where({ id_units: req.params.unitId, status: 'COMPLETED' }).orderBy('effective_date').orderBy('id_transfers').pluck('id_transfers');
    res.json({ success: true, rows: await Promise.all(ids.map(loadTransfer)), current_owners: await currentOwners(req.params.unitId) });
  } catch (err) { fail(res, err); }
});

// Live dues for a flat and the chosen outgoing owners (while drafting).
router.get('/dues/:unitId', async (req, res) => {
  try {
    const sellers = String(req.query.from || '').split(',').map(Number).filter(Boolean);
    res.json({ success: true, ...(await duesCheck(Number(req.params.unitId), sellers)) });
  } catch (err) { fail(res, err); }
});

// ── Draft ───────────────────────────────────────────────────────
const DRAFT_FIELDS = ['application_date', 'consideration_bdt', 'deed_no', 'deed_date', 'sub_registry_office', 'deed_value_bdt', 'mutation_no', 'mutation_date',
  'succession_cert_no', 'bank_release_ref', 'transfer_fee_bdt', 'notes'];

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!TYPES.includes(b.transfer_type)) throw bad('Choose the type of transfer');
    const existing = b.id_transfers ? await db('ownership_transfers').where({ id_transfers: b.id_transfers }).first() : null;
    if (b.id_transfers && !existing) throw bad('Transfer not found');
    // After approval only the registration / mutation details may still be filled in.
    if (existing && existing.status !== 'DRAFT') {
      if (existing.status !== 'APPROVED') throw bad('This transfer is closed');
      const late = {};
      for (const k of ['deed_no', 'deed_date', 'sub_registry_office', 'deed_value_bdt', 'mutation_no', 'mutation_date', 'notes']) if (b[k] !== undefined) late[k] = b[k] === '' ? null : b[k];
      for (const k of ['deed_date', 'mutation_date']) if (late[k]) late[k] = ymd(late[k]);
      await db('ownership_transfers').where({ id_transfers: existing.id_transfers }).update(late);
      return res.json({ success: true, message: 'Registration details saved', id: existing.id_transfers });
    }
    const unitId = Number(b.id_units);
    if (!(await db('units').where({ id_units: unitId }).first())) throw bad('Choose the flat');
    const open = await db('ownership_transfers').where({ id_units: unitId }).whereIn('status', ['DRAFT', 'APPROVED']).whereNot('id_transfers', b.id_transfers || 0).first();
    if (open) throw bad(`Flat already has an open transfer (${open.transfer_no}) — finish or cancel it first`);

    const row = {};
    for (const k of DRAFT_FIELDS) if (b[k] !== undefined) row[k] = b[k] === '' ? null : b[k];
    for (const k of ['application_date', 'deed_date', 'mutation_date']) if (row[k]) row[k] = ymd(row[k]);
    row.application_date = row.application_date || today();
    row.consideration_bdt = num(row.consideration_bdt);
    row.transfer_fee_bdt = num(row.transfer_fee_bdt);
    if (row.deed_value_bdt != null) row.deed_value_bdt = num(row.deed_value_bdt);
    row.fee_waived = !!b.fee_waived;
    row.move_rent_agreements = b.move_rent_agreements !== false;

    const owners = await currentOwners(unitId);
    let id;
    await db.transaction(async trx => {
      const from = (b.from || []).map(f => ({ id_owners: Number(f.id_owners), percent: round2(Number(f.percent)) }));
      const to = [];
      for (const x of b.to || []) to.push({ id_owners: await resolveReceiver(x, trx), percent: round2(Number(x.percent)), relation: x.relation ? String(x.relation).slice(0, 60) : null });
      const { out } = checkParties(b.transfer_type, from, to, owners);
      // Unpaid instalments can only follow the flat when one person takes over the whole of it.
      const unitTotal = round2(owners.reduce((s, o) => s + Number(o.ownership_percentage), 0));
      row.move_instalments = !!b.move_instalments && to.length === 1 && Math.abs(out - unitTotal) <= EPS;
      if (existing) {
        id = existing.id_transfers;
        await trx('ownership_transfers').where({ id_transfers: id }).update({ ...row, id_units: unitId, transfer_type: b.transfer_type });
        await trx('ownership_transfer_parties').where({ id_transfers: id }).del();
      } else {
        [id] = await trx('ownership_transfers').insert({ ...row, id_units: unitId, transfer_type: b.transfer_type, status: 'DRAFT', transfer_no: await nextTransferNo(trx), created_by: userName(req) });
      }
      await trx('ownership_transfer_parties').insert([
        ...from.map(f => ({ id_transfers: id, side: 'FROM', id_owners: f.id_owners, percent: f.percent })),
        ...to.map(x => ({ id_transfers: id, side: 'TO', id_owners: x.id_owners, percent: x.percent, relation: x.relation })),
      ]);
    });
    res.json({ success: true, message: existing ? 'Transfer saved' : 'Transfer application created', id });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const tr = await db('ownership_transfers').where({ id_transfers: req.params.id }).first();
    if (!tr) throw bad('Transfer not found');
    if (tr.status !== 'DRAFT' || tr.id_receipts) throw bad('Only a draft with no fee receipt can be deleted — cancel it instead');
    await db.transaction(async trx => {
      await trx('ownership_transfer_parties').where({ id_transfers: tr.id_transfers }).del();
      await trx('ownership_transfers').where({ id_transfers: tr.id_transfers }).del();
    });
    res.json({ success: true, message: 'Draft deleted' });
  } catch (err) { fail(res, err); }
});

// ── Transfer fee ────────────────────────────────────────────────
router.post('/:id/fee', async (req, res) => {
  try {
    const tr = await loadTransfer(req.params.id);
    if (!['DRAFT', 'APPROVED'].includes(tr.status)) throw bad('This transfer is closed');
    if (tr.id_receipts) throw bad('The fee is already recorded');
    if (tr.fee_waived || !(Number(tr.transfer_fee_bdt) > 0)) throw bad('No transfer fee is set for this transfer');
    const b = req.body || {};
    const payer = [...tr.from, ...tr.to].find(p => p.id_owners === Number(b.paid_by)) || tr.to[0];
    const { receipt } = await issueReceipt({
      id_owners: payer.id_owners, unit_number: tr.unit?.unit_number, received_from: payer.full_name, phone: payer.phone, address: payer.address,
      items: [{ description: `Flat transfer fee — ${tr.unit?.unit_number} (${tr.transfer_no})`, amount: Number(tr.transfer_fee_bdt) }],
      payment_method: method(b.payment_method), payment_ref: b.payment_ref || null, source_type: 'OWNERSHIP_TRANSFER', source_id: tr.id_transfers,
    }, { sendSms: !!b.send_sms, createdBy: userName(req) });
    await db('ownership_transfers').where({ id_transfers: tr.id_transfers }).update({ id_receipts: receipt.id_receipts });
    res.json({ success: true, message: `Fee received — receipt ${receipt.receipt_no}`, id_receipts: receipt.id_receipts });
  } catch (err) { fail(res, err); }
});

// ── Approve: clearance (অনাপত্তি সনদ) ─────────────────────────────
router.post('/:id/approve', async (req, res) => {
  try {
    const tr = await loadTransfer(req.params.id);
    if (tr.status !== 'DRAFT') throw bad('Only a draft can be approved');
    const owners = await currentOwners(tr.id_units);
    checkParties(tr.transfer_type, tr.from.map(f => ({ id_owners: f.id_owners, percent: Number(f.percent) })), tr.to.map(x => ({ id_owners: x.id_owners, percent: Number(x.percent) })), owners);
    const b = req.body || {};
    const dues = await duesCheck(tr.id_units, tr.from.map(f => f.id_owners));
    const reason = String(b.dues_override_reason || '').trim();
    if (dues.blocking_total_bdt > 0 && !reason) {
      throw bad(`৳${dues.blocking_total_bdt.toLocaleString('en-IN')} is outstanding on this flat. Collect it first, or give a reason to approve anyway (e.g. the buyer takes over the dues).`);
    }
    if (dues.loans.length && !String(b.bank_release_ref || tr.bank_release_ref || '').trim()) {
      throw bad(`The flat is mortgaged to ${dues.loans.map(l => l.bank_lender_name).join(', ')}. Enter the bank’s release / NOC reference first.`);
    }
    if (tr.transfer_type === 'INHERITANCE' && !String(b.succession_cert_no || tr.succession_cert_no || '').trim()) throw bad('Enter the succession certificate (ওয়ারিশ সনদ) number');
    if (!tr.fee_waived && Number(tr.transfer_fee_bdt) > 0 && !tr.id_receipts) throw bad('Record the transfer fee first, or waive it');
    await db('ownership_transfers').where({ id_transfers: tr.id_transfers }).update({
      status: 'APPROVED', approved_by: userName(req), approved_at: new Date(), dues_snapshot: JSON.stringify(dues), dues_override_reason: reason || null,
      bank_release_ref: b.bank_release_ref || tr.bank_release_ref || null, succession_cert_no: b.succession_cert_no || tr.succession_cert_no || null,
    });
    res.json({ success: true, message: 'Approved — the clearance letter can now be printed' });
  } catch (err) { fail(res, err); }
});

// ── Complete: change the ownership register ─────────────────────
router.post('/:id/complete', async (req, res) => {
  try {
    const tr = await loadTransfer(req.params.id);
    if (tr.status !== 'APPROVED') throw bad('Approve the transfer before completing it');
    const b = req.body || {};
    const deedNo = String(b.deed_no ?? tr.deed_no ?? '').trim();
    const deedDate = ymd(b.deed_date || tr.deed_date);
    if (NEEDS_DEED.includes(tr.transfer_type) && (!deedNo || !deedDate)) throw bad('Enter the registered deed number and date');
    const effective = ymd(b.effective_date) || deedDate || today();
    if (effective > today()) throw bad('The effective date cannot be in the future');
    const warnings = [];
    let moved = { instalments: 0, rent_agreements: 0 };
    await db.transaction(async trx => {
      // Lock the flat's ownership rows so two transfers cannot race.
      const rows = await activeOwnership(trx('unit_ownerships as uo')).where('uo.id_units', tr.id_units).forUpdate().select('uo.*');
      const cur = new Map(rows.map(r => [r.id_owners, r]));
      const totalBefore = round2(rows.reduce((s, r) => s + Number(r.ownership_percentage), 0));
      checkParties(tr.transfer_type, tr.from.map(f => ({ id_owners: f.id_owners, percent: Number(f.percent) })), tr.to.map(x => ({ id_owners: x.id_owners, percent: Number(x.percent) })),
        rows.map(r => ({ id_owners: r.id_owners, ownership_percentage: r.ownership_percentage })));
      for (const f of tr.from) {
        const r = cur.get(f.id_owners);
        const before = Number(r.ownership_percentage);
        const after = round2(before - Number(f.percent));
        if (after <= EPS) await trx('unit_ownerships').where({ id_unit_ownerships: r.id_unit_ownerships }).del();
        else await trx('unit_ownerships').where({ id_unit_ownerships: r.id_unit_ownerships }).update({ ownership_percentage: after });
        await trx('ownership_transfer_parties').where({ id: f.id }).update({ before_percent: before, after_percent: Math.max(0, after) });
      }
      for (const x of tr.to) {
        const r = cur.get(x.id_owners)
          || await trx('unit_ownerships').where({ id_units: tr.id_units, id_owners: x.id_owners }).first(); // an old inactive row (unique key)
        const before = r && (!r.status || r.status === 'ACTIVE') ? Number(r.ownership_percentage) : 0;
        const after = round2(before + Number(x.percent));
        if (r) await trx('unit_ownerships').where({ id_unit_ownerships: r.id_unit_ownerships }).update({ ownership_percentage: after, status: 'ACTIVE', agreement_date: before ? r.agreement_date : effective });
        else await trx('unit_ownerships').insert({ id_units: tr.id_units, id_owners: x.id_owners, ownership_percentage: after, agreement_date: effective, status: 'ACTIVE' });
        await trx('ownership_transfer_parties').where({ id: x.id }).update({ before_percent: before, after_percent: after });
      }
      const [{ s }] = await activeOwnership(trx('unit_ownerships as uo')).where('uo.id_units', tr.id_units).sum({ s: 'uo.ownership_percentage' });
      if (Math.abs(Number(s) - totalBefore) > EPS) throw new Error(`Ownership total changed from ${totalBefore}% to ${Number(s)}% — transfer rolled back`);

      // Unpaid instalments follow the flat (one receiver taking over the whole flat; set when drafting).
      if (tr.move_instalments && tr.to.length === 1) {
        moved.instalments = await trx('owner_payment_schedules').where({ id_units: tr.id_units }).whereIn('id_owners', tr.from.map(f => f.id_owners))
          .where('paid_amount', 0).update({ id_owners: tr.to[0].id_owners });
        const partly = await trx('owner_payment_schedules').where({ id_units: tr.id_units }).whereIn('id_owners', tr.from.map(f => f.id_owners))
          .whereRaw('paid_amount > 0 AND paid_amount < target_amount').count({ n: '*' });
        if (Number(partly[0].n)) warnings.push(`${partly[0].n} part-paid instalment(s) stay with the previous owner — settle them separately`);
      }
      // Rent agreements naming an outgoing owner who no longer owns the flat as landlord.
      if (tr.move_rent_agreements) {
        const gone = tr.from.filter(f => !(cur.get(f.id_owners) && Number(cur.get(f.id_owners).ownership_percentage) - Number(f.percent) > EPS)).map(f => f.id_owners);
        if (gone.length) moved.rent_agreements = await trx('rent_agreements').where({ id_units: tr.id_units, status: 'ACTIVE' }).whereIn('id_owners', gone)
          .update({ id_owners: tr.to.length === 1 ? tr.to[0].id_owners : null });
      }
      await trx('ownership_transfers').where({ id_transfers: tr.id_transfers }).update({
        status: 'COMPLETED', effective_date: effective, deed_no: deedNo || null, deed_date: deedDate || null,
        sub_registry_office: b.sub_registry_office ?? tr.sub_registry_office, deed_value_bdt: b.deed_value_bdt != null && b.deed_value_bdt !== '' ? num(b.deed_value_bdt) : tr.deed_value_bdt,
        completed_by: userName(req), completed_at: new Date(),
      });
    });
    // Outgoing owners with no flat left who still sit on the committee.
    const leaving = tr.from.map(f => f.id_owners);
    const stillOwn = new Set(await activeOwnership(db('unit_ownerships as uo')).whereIn('uo.id_owners', leaving).pluck('uo.id_owners'));
    const t = today();
    const onCommittee = await db('committee_members').whereIn('id_owners', leaving.filter(o => !stillOwn.has(o)))
      .where('term_start', '<=', t).where(w => w.whereNull('term_end').orWhere('term_end', '>=', t)).select('member_name', 'position');
    for (const c of onCommittee) warnings.push(`${c.member_name} no longer owns a flat but is still on the committee (${c.position.replace(/_/g, ' ').toLowerCase()})`);
    if (b.send_sms) await notifyParties(tr, effective, userName(req));
    res.json({ success: true, message: `Ownership transferred from ${effective}${moved.instalments ? ` · ${moved.instalments} instalment(s) moved` : ''}${moved.rent_agreements ? ` · ${moved.rent_agreements} rent agreement(s) updated` : ''}`, warnings });
  } catch (err) { fail(res, err); }
});

async function notifyParties(tr, effective, by) {
  const settings = await getSettings();
  const bn = settings.sms_language !== 'en';
  const dmy = effective.split('-').reverse().join('/');
  const unit = tr.unit?.unit_number || '';
  for (const p of [...tr.from, ...tr.to]) {
    if (!sms.toMsisdn(p.phone)) continue;
    const gave = p.side === 'FROM';
    const msg = bn
      ? `প্রিয় ${p.full_name}, ফ্ল্যাট ${unit}-এর ${Number(p.percent)}% মালিকানা ${dmy} তারিখে ${gave ? 'হস্তান্তর করা হয়েছে' : 'আপনার নামে হস্তান্তরিত হয়েছে'} (${tr.transfer_no})। -${settings.sms_signature}`
      : `Dear ${p.full_name}, ${Number(p.percent)}% ownership of flat ${unit} has been ${gave ? 'transferred out of your name' : 'transferred to you'} from ${dmy} (${tr.transfer_no}). -${settings.sms_signature}`;
    await sms.sendSms({ to: p.phone, message: msg, recipient_name: p.full_name, related_type: 'TRANSFER', related_key: tr.transfer_no, created_by: by });
  }
}

router.post('/:id/cancel', async (req, res) => {
  try {
    const tr = await db('ownership_transfers').where({ id_transfers: req.params.id }).first();
    if (!tr) throw bad('Transfer not found');
    if (!['DRAFT', 'APPROVED'].includes(tr.status)) throw bad('Only an open transfer can be cancelled');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw bad('Give a reason for cancelling');
    await db('ownership_transfers').where({ id_transfers: tr.id_transfers }).update({ status: 'CANCELLED', cancel_reason: reason.slice(0, 500) });
    res.json({ success: true, message: tr.id_receipts ? 'Cancelled. A transfer fee was received — refund it separately if needed.' : 'Cancelled' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
