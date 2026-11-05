// Site inventory & material planning, mounted at /api/inventory (staff only).
//
// Plan  — each work lists the materials it needs (Piling: 50 bags cement, 20 cft sand…).
// Store — every receipt, issue, return, damage and count adjustment is a row in stock_movements;
//         stock on hand and the moving-average cost are always worked out from that ledger.
// Gap   — what open works still need minus what is in the store = what to buy.
const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');

const TYPES = ['OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'DAMAGE', 'ADJUSTMENT'];
const OUT = ['ISSUE', 'DAMAGE'];
const CLOSED_WORK = ['COMPLETED', 'CANCELLED'];
const EPS = 0.0001;

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || String(err) });
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const who = req => req.user?.name || 'Staff';
const ymd = d => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const today = () => ymd(new Date());

// Replays a material's ledger in date order: stock on hand, moving-average cost, and the first date stock
// would go below zero (null when it never does). Receipts (and openings) with a cost move the average;
// everything else leaves it unchanged.
async function replay(materialId, conn = db, { skipId = null } = {}) {
  const rows = await conn('stock_movements').where({ id_materials: materialId }).modify(q => { if (skipId) q.whereNot('id_movements', skipId); })
    .orderBy('movement_date').orderBy('id_movements');
  let qty = 0; let avg = 0; let negativeOn = null;
  for (const r of rows) {
    const q = Number(r.qty);
    if (['OPENING', 'RECEIPT'].includes(r.movement_type) && q > 0 && r.unit_cost != null) {
      avg = qty + q > EPS ? (Math.max(qty, 0) * avg + q * Number(r.unit_cost)) / (Math.max(qty, 0) + q) : Number(r.unit_cost);
    }
    qty += q;
    if (qty < -EPS && !negativeOn) negativeOn = ymd(r.movement_date);
  }
  return { on_hand: round2(qty), avg_cost: round4(avg), negative_on: negativeOn };
}

// Keeps materials.avg_cost and the old site_inventory summary in step with the ledger.
async function sync(materialId, conn) {
  const { on_hand, avg_cost } = await replay(materialId, conn);
  await conn('materials').where({ id_materials: materialId }).update({ avg_cost });
  const [t] = await conn('stock_movements').where({ id_materials: materialId }).select(
    conn.raw("SUM(CASE WHEN movement_type='OPENING' THEN qty ELSE 0 END) as opening"),
    conn.raw("SUM(CASE WHEN movement_type='RECEIPT' THEN qty ELSE 0 END) as purchased"),
    conn.raw("-SUM(CASE WHEN movement_type IN ('ISSUE','RETURN') THEN qty ELSE 0 END) as used"),
    conn.raw("-SUM(CASE WHEN movement_type='DAMAGE' THEN qty ELSE 0 END) as damaged"));
  const m = await conn('materials').where({ id_materials: materialId }).first();
  const row = { opening_stock: round2(t.opening), purchased_qty: round2(t.purchased), used_qty: round2(t.used), damaged_qty: round2(t.damaged), current_stock: on_hand, minimum_reorder_stock: m.reorder_level, last_updated: new Date() };
  const s = await conn('site_inventory').where({ id_materials: materialId }).first();
  if (s) await conn('site_inventory').where({ id_inventory: s.id_inventory }).update(row);
  else await conn('site_inventory').insert({ id_materials: materialId, ...row });
  return { on_hand, avg_cost };
}

// Net quantity issued to a work per material (issues minus returns), as positive numbers.
async function issuedToWork(workId, conn = db) {
  const rows = await conn('stock_movements').where({ id_works: workId }).whereIn('movement_type', ['ISSUE', 'RETURN'])
    .groupBy('id_materials').select('id_materials').sum({ q: 'qty' }).select(conn.raw('SUM(-qty * COALESCE(unit_cost,0)) as cost'));
  return new Map(rows.map(r => [r.id_materials, { qty: round2(-Number(r.q)), cost: round2(r.cost) }]));
}

async function onHandAll(conn = db) {
  const rows = await conn('stock_movements').groupBy('id_materials').select('id_materials').sum({ q: 'qty' });
  return new Map(rows.map(r => [r.id_materials, round2(r.q)]));
}

// Remaining requirement (required − net issued, never below 0) of every open work, per material.
async function openNeeds(conn = db) {
  const reqs = await conn('work_material_requirements as r').join('construction_works as w', 'w.id_works', 'r.id_works')
    .whereNotIn('w.status', CLOSED_WORK).select('r.id_works', 'r.id_materials', 'r.required_qty', 'w.work_name');
  const issued = await conn('stock_movements').whereNotNull('id_works').whereIn('movement_type', ['ISSUE', 'RETURN'])
    .groupBy('id_works', 'id_materials').select('id_works', 'id_materials').sum({ q: 'qty' });
  const iss = new Map(issued.map(i => [`${i.id_works}:${i.id_materials}`, -Number(i.q)]));
  const byMat = new Map();
  for (const r of reqs) {
    const left = round2(Math.max(0, Number(r.required_qty) - (iss.get(`${r.id_works}:${r.id_materials}`) || 0)));
    if (left <= 0) continue;
    const x = byMat.get(r.id_materials) || { remaining: 0, works: [] };
    x.remaining = round2(x.remaining + left); x.works.push({ id_works: r.id_works, work_name: r.work_name, remaining: left });
    byMat.set(r.id_materials, x);
  }
  return byMat;
}

// ── Items ───────────────────────────────────────────────────────
router.get('/items', async (req, res) => {
  try {
    const [items, stock, needs] = await Promise.all([db('materials').orderBy('category').orderBy('material_name'), onHandAll(), openNeeds()]);
    const rows = items.map(m => {
      const on = stock.get(m.id_materials) || 0;
      const need = needs.get(m.id_materials)?.remaining || 0;
      const reorder = Number(m.reorder_level) || 0;
      return { ...m, on_hand: on, value_bdt: round2(on * Number(m.avg_cost)), needed_by_open_works: need, shortfall: round2(Math.max(0, need - on)),
        state: on <= 0 ? 'OUT' : on < need ? 'SHORT' : reorder && on <= reorder ? 'LOW' : 'OK' };
    });
    const active = rows.filter(r => r.is_active);
    res.json({ success: true, rows, types: TYPES,
      summary: { items: active.length, value_bdt: round2(active.reduce((s, r) => s + r.value_bdt, 0)),
        short: active.filter(r => r.state === 'SHORT' || r.state === 'OUT').length, low: active.filter(r => r.state === 'LOW').length },
      vendors: await db('vendors').where('status', 'ACTIVE').orderBy('company_name').select('id_vendors', 'company_name'),
      works: await db('construction_works').orderBy('status').orderBy('work_name').select('id_works', 'work_name', 'work_category', 'status') });
  } catch (err) { fail(res, err); }
});

router.post('/items', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.material_name || '').trim();
    if (!name) throw bad('Material name is required');
    const unit = String(b.unit || '').trim();
    if (!unit) throw bad('Unit is required (bag, cft, ton, pcs…)');
    const row = { material_name: name.slice(0, 200), unit: unit.slice(0, 50), category: b.category || null, supplier: b.supplier || null,
      item_code: b.item_code ? String(b.item_code).trim().toUpperCase().slice(0, 30) : null, reorder_level: Math.max(0, Number(b.reorder_level) || 0) };
    if (row.item_code) {
      const dup = await db('materials').where({ item_code: row.item_code }).whereNot('id_materials', b.id_materials || 0).first();
      if (dup) throw bad(`Code ${row.item_code} is already used by ${dup.material_name}`);
    }
    if (b.is_active !== undefined) row.is_active = !!b.is_active;
    if (b.id_materials) {
      const cur = await db('materials').where({ id_materials: b.id_materials }).first();
      if (!cur) throw bad('Material not found');
      if (cur.unit !== row.unit && (await db('stock_movements').where({ id_materials: cur.id_materials }).first())) throw bad('The unit cannot change once stock has moved — add a new material instead');
      if (b.current_rate !== undefined && Number(b.current_rate) !== Number(cur.current_rate)) Object.assign(row, { previous_rate: cur.current_rate, current_rate: Math.max(0, Number(b.current_rate) || 0), last_updated_date: today() });
      await db('materials').where({ id_materials: cur.id_materials }).update(row);
      return res.json({ success: true, message: 'Material saved', id: cur.id_materials });
    }
    const rate = Math.max(0, Number(b.current_rate) || 0);
    const [id] = await db('materials').insert({ ...row, current_rate: rate, previous_rate: rate, avg_cost: rate, last_updated_date: today(), is_active: true });
    res.json({ success: true, message: 'Material added', id });
  } catch (err) { fail(res, err); }
});

// Ledger with a running balance.
router.get('/items/:id/ledger', async (req, res) => {
  try {
    const m = await db('materials').where({ id_materials: req.params.id }).first();
    if (!m) throw bad('Material not found');
    const rows = await db('stock_movements as s').leftJoin('construction_works as w', 'w.id_works', 's.id_works').leftJoin('vendors as v', 'v.id_vendors', 's.id_vendors')
      .where('s.id_materials', m.id_materials).orderBy('s.movement_date').orderBy('s.id_movements').select('s.*', 'w.work_name', 'v.company_name as vendor_name');
    let bal = 0;
    const out = rows.map(r => { bal = round2(bal + Number(r.qty)); return { ...r, qty: Number(r.qty), balance: bal }; }).reverse();
    res.json({ success: true, material: m, rows: out, ...(await replay(m.id_materials)) });
  } catch (err) { fail(res, err); }
});

// ── Movements ───────────────────────────────────────────────────
router.get('/movements', async (req, res) => {
  try {
    const q = db('stock_movements as s').join('materials as m', 'm.id_materials', 's.id_materials').leftJoin('construction_works as w', 'w.id_works', 's.id_works')
      .leftJoin('vendors as v', 'v.id_vendors', 's.id_vendors').orderBy('s.movement_date', 'desc').orderBy('s.id_movements', 'desc').limit(Math.min(1000, Number(req.query.limit) || 300))
      .select('s.*', 'm.material_name', 'm.unit', 'w.work_name', 'v.company_name as vendor_name');
    if (req.query.material) q.where('s.id_materials', req.query.material);
    if (req.query.work) q.where('s.id_works', req.query.work);
    if (TYPES.includes(req.query.type)) q.where('s.movement_type', req.query.type);
    if (req.query.from) q.where('s.movement_date', '>=', ymd(req.query.from));
    if (req.query.to) q.where('s.movement_date', '<=', ymd(req.query.to));
    res.json({ success: true, rows: (await q).map(r => ({ ...r, qty: Number(r.qty) })) });
  } catch (err) { fail(res, err); }
});

// One movement. Quantities are entered as positive numbers; the type decides the direction.
// ADJUSTMENT takes counted_qty (what a physical count found) and books the difference.
async function recordMovement(b, user, trx) {
  if (!TYPES.includes(b.movement_type)) throw bad('Choose what kind of movement this is');
  const m = await trx('materials').where({ id_materials: b.id_materials }).forUpdate().first(); // one movement per material at a time
  if (!m) throw bad('Choose the material');
  const date = ymd(b.movement_date) || today();
  if (date > today()) throw bad('The date cannot be in the future');
  const { on_hand } = await replay(m.id_materials, trx);
  let qty;
  if (b.movement_type === 'ADJUSTMENT') {
    const counted = Number(b.counted_qty);
    if (!(counted >= 0)) throw bad('Enter the quantity counted in the store');
    qty = round2(counted - on_hand);
    if (Math.abs(qty) < 0.005) throw bad(`The count matches the books (${on_hand} ${m.unit}) — nothing to adjust`);
    if (!String(b.notes || '').trim()) throw bad('Say why the count differs (e.g. theft, spillage, miscount)');
  } else {
    const n = round2(Number(b.qty));
    if (!(n > 0)) throw bad('Enter a quantity greater than 0');
    qty = OUT.includes(b.movement_type) ? -n : n;
  }
  const row = { movement_date: date, id_materials: m.id_materials, movement_type: b.movement_type, qty, reference: b.reference || null, person: b.person || null,
    notes: b.notes ? String(b.notes).slice(0, 500) : null, recorded_by: user };

  if (b.movement_type === 'RECEIPT' || b.movement_type === 'OPENING') {
    const cost = b.unit_cost === undefined || b.unit_cost === '' ? Number(m.current_rate) : Number(b.unit_cost);
    if (!(cost >= 0)) throw bad('Enter the purchase rate per unit');
    row.unit_cost = cost;
    if (b.movement_type === 'RECEIPT') {
      row.id_vendors = b.id_vendors || null;
      if (cost !== Number(m.current_rate)) await trx('materials').where({ id_materials: m.id_materials }).update({ previous_rate: m.current_rate, current_rate: cost, last_updated_date: date });
    }
  }
  if (['ISSUE', 'RETURN'].includes(b.movement_type)) {
    const work = await trx('construction_works').where({ id_works: b.id_works }).first();
    if (!work) throw bad('Choose the work this material is for');
    row.id_works = work.id_works;
    row.unit_cost = Number(m.avg_cost) || Number(m.current_rate) || 0;
    const issued = (await issuedToWork(work.id_works, trx)).get(m.id_materials)?.qty || 0;
    if (b.movement_type === 'ISSUE') {
      if (CLOSED_WORK.includes(work.status)) throw bad(`"${work.work_name}" is ${work.status.toLowerCase()} — reopen it or issue to another work`);
      if (-qty - on_hand > EPS) throw bad(`Only ${on_hand} ${m.unit} of ${m.material_name} in the store`);
      const reqRow = await trx('work_material_requirements').where({ id_works: work.id_works, id_materials: m.id_materials }).first();
      const required = reqRow ? Number(reqRow.required_qty) : 0;
      if (issued - qty - required > EPS) {
        const reason = String(b.over_issue_reason || '').trim();
        if (!reason) {
          throw Object.assign(bad(reqRow
            ? `This takes ${work.work_name} to ${round2(issued - qty)} ${m.unit}, over its plan of ${required}. Give a reason to issue the extra.`
            : `${m.material_name} is not in the plan for ${work.work_name}. Add it to the plan, or give a reason to issue anyway.`), { over_issue: true });
        }
        row.notes = [row.notes, `Over plan: ${reason}`].filter(Boolean).join(' · ').slice(0, 500);
      }
    } else if (qty - issued > EPS) throw bad(`Only ${issued} ${m.unit} was issued to ${work.work_name} — cannot return more`);
  }
  if (b.movement_type === 'DAMAGE') {
    if (-qty - on_hand > EPS) throw bad(`Only ${on_hand} ${m.unit} in the store`);
    if (!String(b.notes || '').trim()) throw bad('Describe the damage or wastage');
  }
  const [id] = await trx('stock_movements').insert(row);
  // A back-dated movement must not leave the store negative on any earlier day.
  const check = await replay(m.id_materials, trx);
  if (check.negative_on) throw bad(`On ${check.negative_on} the store would have had less than nothing — check the date`);
  const after = await sync(m.id_materials, trx);
  return { id, qty, unit: m.unit, name: m.material_name, on_hand: after.on_hand };
}

router.post('/movements', async (req, res) => {
  try {
    let r;
    await db.transaction(async trx => { r = await recordMovement(req.body || {}, who(req), trx); });
    const verb = { OPENING: 'Opening stock recorded', RECEIPT: 'Received', ISSUE: 'Issued', RETURN: 'Returned to store', DAMAGE: 'Written off', ADJUSTMENT: 'Stock adjusted' }[req.body.movement_type];
    res.json({ success: true, message: `${verb}: ${Math.abs(r.qty)} ${r.unit} ${r.name} · now ${r.on_hand} in store`, ...r });
  } catch (err) { res.status(err.status || 500).json({ success: false, message: err.message, over_issue: !!err.over_issue }); }
});

router.delete('/movements/:id', async (req, res) => {
  try {
    await db.transaction(async trx => {
      const mv = await trx('stock_movements').where({ id_movements: req.params.id }).first();
      if (!mv) throw bad('Movement not found');
      await trx('materials').where({ id_materials: mv.id_materials }).forUpdate().first();
      const check = await replay(mv.id_materials, trx, { skipId: mv.id_movements });
      if (check.negative_on) throw bad(`Removing this would leave the store negative from ${check.negative_on} — remove the later issues first`);
      await trx('stock_movements').where({ id_movements: mv.id_movements }).del();
      await sync(mv.id_materials, trx);
    });
    res.json({ success: true, message: 'Movement removed' });
  } catch (err) { fail(res, err); }
});

// ── Work material plan ──────────────────────────────────────────
async function workPlan(workId) {
  const work = await db('construction_works').where({ id_works: workId }).first();
  if (!work) throw Object.assign(new Error('Work not found'), { status: 404 });
  const [reqs, issued, stock] = await Promise.all([
    db('work_material_requirements as r').join('materials as m', 'm.id_materials', 'r.id_materials').where('r.id_works', workId).orderBy('m.material_name')
      .select('r.*', 'm.material_name', 'm.unit', 'm.avg_cost', 'm.current_rate'),
    issuedToWork(workId), onHandAll(),
  ]);
  const ids = new Set(reqs.map(r => r.id_materials));
  const rows = reqs.map(r => {
    const iss = issued.get(r.id_materials) || { qty: 0, cost: 0 };
    const remaining = round2(Math.max(0, Number(r.required_qty) - iss.qty));
    const on = stock.get(r.id_materials) || 0;
    return { ...r, required_qty: Number(r.required_qty), issued_qty: iss.qty, issued_cost_bdt: iss.cost, remaining, on_hand: on,
      est_remaining_cost_bdt: round2(remaining * Number(r.current_rate)), over_issued: round2(Math.max(0, iss.qty - Number(r.required_qty))),
      state: remaining <= 0 ? 'DONE' : on >= remaining ? 'READY' : on > 0 ? 'PARTIAL' : 'NONE' };
  });
  // Materials issued to the work without being in its plan.
  const unplanned = [];
  for (const [id, iss] of issued) if (!ids.has(id) && iss.qty > 0) {
    const m = await db('materials').where({ id_materials: id }).first();
    unplanned.push({ id_materials: id, material_name: m?.material_name, unit: m?.unit, issued_qty: iss.qty, issued_cost_bdt: iss.cost });
  }
  return { work, rows, unplanned,
    summary: { lines: rows.length, ready: rows.filter(r => ['READY', 'DONE'].includes(r.state)).length,
      issued_cost_bdt: round2([...issued.values()].reduce((s, i) => s + i.cost, 0)), remaining_cost_bdt: round2(rows.reduce((s, r) => s + r.est_remaining_cost_bdt, 0)) } };
}

router.get('/works', async (req, res) => {
  try {
    const works = await db('construction_works').orderByRaw("FIELD(status,'IN_PROGRESS') DESC").orderBy('work_name').select('id_works', 'work_name', 'work_category', 'status', 'start_date');
    const counts = Object.fromEntries((await db('work_material_requirements').groupBy('id_works').select('id_works').count({ n: '*' })).map(r => [r.id_works, Number(r.n)]));
    res.json({ success: true, rows: works.map(w => ({ ...w, plan_lines: counts[w.id_works] || 0 })) });
  } catch (err) { fail(res, err); }
});

router.get('/works/:id', async (req, res) => {
  try { res.json({ success: true, ...(await workPlan(req.params.id)) }); } catch (err) { fail(res, err); }
});

// Add or change one line of a work's plan.
router.post('/works/:id/requirements', async (req, res) => {
  try {
    const work = await db('construction_works').where({ id_works: req.params.id }).first();
    if (!work) throw bad('Work not found');
    const b = req.body || {};
    const m = await db('materials').where({ id_materials: b.id_materials }).first();
    if (!m) throw bad('Choose the material');
    const qty = round2(Number(b.required_qty));
    if (!(qty > 0)) throw bad('Enter the quantity needed');
    await db('work_material_requirements').insert({ id_works: work.id_works, id_materials: m.id_materials, required_qty: qty, notes: b.notes || null })
      .onConflict(['id_works', 'id_materials']).merge({ required_qty: qty, notes: b.notes || null });
    res.json({ success: true, message: `${work.work_name}: ${qty} ${m.unit} ${m.material_name}` });
  } catch (err) { fail(res, err); }
});

router.delete('/works/:id/requirements/:materialId', async (req, res) => {
  try {
    await db('work_material_requirements').where({ id_works: req.params.id, id_materials: req.params.materialId }).del();
    res.json({ success: true, message: 'Removed from the plan (anything already issued stays on record)' });
  } catch (err) { fail(res, err); }
});

// Copy the plan of another work (e.g. Tower B piling from Tower A piling), optionally scaled.
router.post('/works/:id/copy-from/:sourceId', async (req, res) => {
  try {
    const factor = Number(req.body?.factor) || 1;
    if (!(factor > 0 && factor <= 100)) throw bad('Scale must be between 0 and 100');
    const src = await db('work_material_requirements').where({ id_works: req.params.sourceId });
    if (!src.length) throw bad('That work has no material plan to copy');
    for (const r of src) {
      await db('work_material_requirements').insert({ id_works: Number(req.params.id), id_materials: r.id_materials, required_qty: round2(Number(r.required_qty) * factor), notes: r.notes })
        .onConflict(['id_works', 'id_materials']).merge(['required_qty', 'notes']);
    }
    res.json({ success: true, message: `${src.length} line(s) copied${factor !== 1 ? ` × ${factor}` : ''}` });
  } catch (err) { fail(res, err); }
});

// Issue everything still needed by a work, as far as the store allows.
router.post('/works/:id/issue-all', async (req, res) => {
  try {
    const plan = await workPlan(req.params.id);
    if (CLOSED_WORK.includes(plan.work.status)) throw bad('This work is closed');
    const done = []; const short = [];
    await db.transaction(async trx => {
      for (const r of plan.rows) {
        if (r.remaining <= 0) continue;
        const qty = round2(Math.min(r.remaining, r.on_hand));
        if (qty > 0) {
          await recordMovement({ movement_type: 'ISSUE', id_materials: r.id_materials, id_works: plan.work.id_works, qty, movement_date: req.body?.movement_date,
            person: req.body?.person, reference: req.body?.reference }, who(req), trx);
          done.push(`${qty} ${r.unit} ${r.material_name}`);
        }
        if (qty < r.remaining) short.push(`${round2(r.remaining - qty)} ${r.unit} ${r.material_name}`);
      }
    });
    if (!done.length) throw bad(short.length ? `Nothing in store to issue — short: ${short.join(', ')}` : 'Everything in the plan is already issued');
    res.json({ success: true, message: `Issued ${done.join(', ')}${short.length ? `. Still short: ${short.join(', ')}` : ''}`, short });
  } catch (err) { fail(res, err); }
});

// ── Shortages / purchase plan ───────────────────────────────────
router.get('/shortages', async (req, res) => {
  try {
    const keepBuffer = req.query.buffer !== '0';
    const [items, stock, needs] = await Promise.all([db('materials').where('is_active', true), onHandAll(), openNeeds()]);
    const rows = items.map(m => {
      const on = stock.get(m.id_materials) || 0;
      const need = needs.get(m.id_materials);
      const remaining = need?.remaining || 0;
      const reorder = Number(m.reorder_level) || 0;
      const buy = round2(Math.max(0, remaining + (keepBuffer ? reorder : 0) - on));
      return { id_materials: m.id_materials, material_name: m.material_name, unit: m.unit, supplier: m.supplier, rate: Number(m.current_rate),
        on_hand: on, needed: remaining, reorder_level: reorder, shortfall: round2(Math.max(0, remaining - on)), to_buy: buy, est_cost_bdt: round2(buy * Number(m.current_rate)), works: need?.works || [] };
    }).filter(r => r.to_buy > 0).sort((a, b) => b.est_cost_bdt - a.est_cost_bdt);
    res.json({ success: true, rows, total_bdt: round2(rows.reduce((s, r) => s + r.est_cost_bdt, 0)), with_buffer: keepBuffer });
  } catch (err) { fail(res, err); }
});

module.exports = router;
