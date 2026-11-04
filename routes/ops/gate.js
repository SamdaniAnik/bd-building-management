// Gate & community: visitor log (guard desk), parking slot allocation, and the notice board with SMS broadcast.
// /portal/notices is the only route flat-owner logins may reach (see app.js).
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num, ymd, today, unitsQuery, primaryOwners, pick } = require('./common');
const { getSettings } = require('../../utils/org');
const { isValidBdMobile, normalizeBdMobile } = require('../../utils/bd');
const sms = require('../../utils/sms');

const PURPOSES = ['GUEST', 'DELIVERY', 'RIDE_SHARE', 'SERVICE', 'OFFICIAL', 'DOMESTIC_HELP', 'OTHER'];
const SLOT_TYPES = ['CAR', 'MOTORBIKE', 'BICYCLE', 'VISITOR'];
const SLOT_STATUS = ['FREE', 'ALLOCATED', 'RESERVED', 'BLOCKED'];
const CATEGORIES = ['GENERAL', 'MEETING', 'MAINTENANCE', 'UTILITY_OUTAGE', 'PAYMENT', 'SECURITY', 'EMERGENCY'];
const dt = v => (v ? new Date(v) : new Date());

// ── Visitors ────────────────────────────────────────────────────
router.get('/visitors', async (req, res) => {
  try {
    const q = db('visitor_logs as v').leftJoin('units as u', 'u.id_units', 'v.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
      .orderBy('v.check_in', 'desc').limit(Math.min(1000, Number(req.query.limit) || 300))
      .select('v.*', 'u.unit_number', 'b.building_name');
    if (req.query.inside === '1') q.whereNull('v.check_out');
    if (req.query.date) q.whereRaw('DATE(v.check_in) = ?', [ymd(req.query.date)]);
    if (req.query.unit) q.where('v.id_units', req.query.unit);
    if (req.query.q) {
      const s = `%${req.query.q}%`;
      q.where(w => w.where('v.visitor_name', 'like', s).orWhere('v.phone', 'like', s).orWhere('v.vehicle_no', 'like', s).orWhere('u.unit_number', 'like', s));
    }
    const rows = await q;
    const [{ inside }] = await db('visitor_logs').whereNull('check_out').count({ inside: '*' });
    const [{ todayCount }] = await db('visitor_logs').whereRaw('DATE(check_in) = CURDATE()').count({ todayCount: '*' });
    res.json({ success: true, rows, inside_now: Number(inside), today: Number(todayCount) });
  } catch (err) { fail(res, err); }
});

router.post('/visitors', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.visitor_name || !String(b.visitor_name).trim()) throw bad('Visitor name is required');
    if (b.purpose && !PURPOSES.includes(b.purpose)) throw bad('Unknown visit purpose');
    if (b.phone && !isValidBdMobile(b.phone)) throw bad('Phone is not a valid Bangladeshi mobile number');
    const row = pick(b, ['visitor_name', 'purpose', 'id_units', 'host_name', 'company', 'vehicle_no', 'people_count', 'id_card_no', 'notes']);
    const [id] = await db('visitor_logs').insert({ ...row, phone: b.phone ? normalizeBdMobile(b.phone) : null, people_count: Math.max(1, Number(row.people_count) || 1),
      vehicle_no: row.vehicle_no ? String(row.vehicle_no).toUpperCase() : null, check_in: dt(b.check_in), guard_name: b.guard_name || userName(req) });
    res.json({ success: true, message: 'Visitor checked in', id });
  } catch (err) { fail(res, err); }
});

router.post('/visitors/:id/checkout', async (req, res) => {
  try {
    const n = await db('visitor_logs').where({ id_visitors: req.params.id }).whereNull('check_out').update({ check_out: dt(req.body?.check_out) });
    if (!n) throw bad('Visitor already checked out');
    res.json({ success: true, message: 'Visitor checked out' });
  } catch (err) { fail(res, err); }
});

router.delete('/visitors/:id', async (req, res) => {
  try {
    await db('visitor_logs').where({ id_visitors: req.params.id }).del();
    res.json({ success: true, message: 'Entry deleted' });
  } catch (err) { fail(res, err); }
});

// ── Parking ─────────────────────────────────────────────────────
router.get('/parking', async (req, res) => {
  try {
    const rows = await db('parking_slots as p').leftJoin('units as u', 'u.id_units', 'p.id_units').leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
      .orderBy('p.location').orderBy('p.slot_code').select('p.*', 'u.unit_number', 'b.building_name');
    const owners = await primaryOwners([...new Set(rows.filter(r => r.id_units).map(r => r.id_units))]);
    const by = s => rows.filter(r => r.status === s).length;
    res.json({ success: true, rows: rows.map(r => ({ ...r, owner_name: owners[r.id_units]?.full_name || null })),
      summary: { total: rows.length, allocated: by('ALLOCATED'), free: by('FREE'), reserved: by('RESERVED'), blocked: by('BLOCKED'),
        monthly_fee_bdt: num(rows.filter(r => r.status === 'ALLOCATED').reduce((s, r) => s + Number(r.monthly_fee_bdt || 0), 0)) } });
  } catch (err) { fail(res, err); }
});

router.post('/parking', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['slot_code', 'location', 'slot_type', 'id_units', 'vehicle_no', 'vehicle_model', 'monthly_fee_bdt', 'status', 'notes']);
    if (!row.slot_code || !String(row.slot_code).trim()) throw bad('Slot code is required');
    row.slot_code = String(row.slot_code).trim().toUpperCase();
    if (row.slot_type && !SLOT_TYPES.includes(row.slot_type)) throw bad('Unknown slot type');
    if (row.status && !SLOT_STATUS.includes(row.status)) throw bad('Unknown status');
    if (row.vehicle_no) row.vehicle_no = String(row.vehicle_no).toUpperCase();
    // Allocating to a flat implies ALLOCATED; freeing a slot clears the flat and vehicle.
    if (row.id_units && (!row.status || row.status === 'FREE')) row.status = 'ALLOCATED';
    if (row.status === 'FREE') { row.id_units = null; row.vehicle_no = null; row.vehicle_model = null; }
    if (row.status === 'ALLOCATED' && !row.id_units) throw bad('Choose the flat this slot is allocated to');
    const dup = await db('parking_slots').where({ slot_code: row.slot_code }).whereNot('id_parking_slots', b.id_parking_slots || 0).first();
    if (dup) throw bad(`Slot ${row.slot_code} already exists`);
    if (b.id_parking_slots) {
      await db('parking_slots').where({ id_parking_slots: b.id_parking_slots }).update(row);
      return res.json({ success: true, message: 'Slot updated' });
    }
    const [id] = await db('parking_slots').insert({ ...row, status: row.status || 'FREE' });
    res.json({ success: true, message: 'Slot added', id });
  } catch (err) { fail(res, err); }
});

// Quickly add a numbered range, e.g. prefix "B1-" from 1 to 40 at "Basement-1".
router.post('/parking/bulk', async (req, res) => {
  try {
    const { prefix = 'P-', from = 1, to = 10, location = null, slot_type = 'CAR', monthly_fee_bdt = 0 } = req.body || {};
    const a = Number(from); const z = Number(to);
    if (!(a >= 0 && z >= a && z - a < 500)) throw bad('Choose a range of up to 500 slots');
    if (!SLOT_TYPES.includes(slot_type)) throw bad('Unknown slot type');
    const width = String(z).length;
    const rows = [];
    for (let i = a; i <= z; i++) rows.push({ slot_code: `${String(prefix).toUpperCase()}${String(i).padStart(width, '0')}`, location, slot_type, monthly_fee_bdt: num(monthly_fee_bdt), status: 'FREE' });
    const before = await db('parking_slots').whereIn('slot_code', rows.map(r => r.slot_code)).pluck('slot_code');
    const fresh = rows.filter(r => !before.includes(r.slot_code));
    if (fresh.length) await db('parking_slots').insert(fresh);
    res.json({ success: true, message: `${fresh.length} slot(s) added${before.length ? `, ${before.length} already existed` : ''}` });
  } catch (err) { fail(res, err); }
});

router.delete('/parking/:id', async (req, res) => {
  try {
    await db('parking_slots').where({ id_parking_slots: req.params.id }).del();
    res.json({ success: true, message: 'Slot deleted' });
  } catch (err) { fail(res, err); }
});

// ── Notices ─────────────────────────────────────────────────────
const live = q => q.where('publish_date', '<=', today()).where(w => w.whereNull('expiry_date').orWhere('expiry_date', '>=', today()));

router.get('/notices', async (req, res) => {
  try {
    const q = db('notices').orderBy('is_pinned', 'desc').orderBy('publish_date', 'desc').orderBy('id_notices', 'desc').limit(300);
    if (req.query.live === '1') live(q);
    res.json({ success: true, rows: await q });
  } catch (err) { fail(res, err); }
});

// Read-only feed for the owner portal.
router.get('/portal/notices', async (req, res) => {
  try {
    const rows = await live(db('notices')).orderBy('is_pinned', 'desc').orderBy('publish_date', 'desc').limit(20)
      .select('id_notices', 'title_en', 'title_bn', 'body_en', 'body_bn', 'category', 'publish_date', 'expiry_date', 'is_pinned');
    res.json({ success: true, rows });
  } catch (err) { fail(res, err); }
});

router.post('/notices', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['title_en', 'title_bn', 'body_en', 'body_bn', 'category', 'publish_date', 'expiry_date']);
    if (!row.title_en || !row.body_en) throw bad('Title and message (English) are required');
    if (row.category && !CATEGORIES.includes(row.category)) throw bad('Unknown category');
    row.publish_date = ymd(row.publish_date) || today();
    if (row.expiry_date && ymd(row.expiry_date) < row.publish_date) throw bad('Expiry date is before the publish date');
    row.is_pinned = !!b.is_pinned;
    if (b.id_notices) {
      await db('notices').where({ id_notices: b.id_notices }).update(row);
      return res.json({ success: true, message: 'Notice updated', id: Number(b.id_notices) });
    }
    const [id] = await db('notices').insert({ ...row, created_by: userName(req) });
    res.json({ success: true, message: 'Notice published', id });
  } catch (err) { fail(res, err); }
});

router.delete('/notices/:id', async (req, res) => {
  try {
    await db('notices').where({ id_notices: req.params.id }).del();
    res.json({ success: true, message: 'Notice deleted' });
  } catch (err) { fail(res, err); }
});

// Recipients for a broadcast: owners of flats and/or active tenants, one SMS per phone number.
async function recipients({ audience = 'OWNERS', building }) {
  const list = [];
  if (audience === 'OWNERS' || audience === 'ALL') {
    const q = db('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners').join('units as u', 'u.id_units', 'uo.id_units')
      .where(w => w.whereNull('uo.status').orWhere('uo.status', 'ACTIVE')).select('o.full_name as name', 'o.phone');
    if (building) q.where('u.id_buildings', building);
    list.push(...await q);
  }
  if (audience === 'TENANTS' || audience === 'ALL') {
    const q = db('tenants as t').join('units as u', 'u.id_units', 't.id_units').where('t.status', 'ACTIVE').select('t.full_name as name', 't.phone');
    if (building) q.where('u.id_buildings', building);
    list.push(...await q);
  }
  const seen = new Map();
  for (const r of list) { const m = sms.toMsisdn(r.phone); if (m && !seen.has(m)) seen.set(m, r); }
  return { list: [...seen.values()], invalid: list.length - [...seen.keys()].length };
}

router.post('/notices/:id/recipients', async (req, res) => {
  try {
    const { list, invalid } = await recipients(req.body || {});
    res.json({ success: true, count: list.length, skipped: invalid });
  } catch (err) { fail(res, err); }
});

router.post('/notices/:id/broadcast', async (req, res) => {
  try {
    const n = await db('notices').where({ id_notices: req.params.id }).first();
    if (!n) throw bad('Notice not found');
    const settings = await getSettings();
    const tpl = await sms.getTemplate('NOTICE');
    const bn = (req.body?.language || settings.sms_language) !== 'en';
    const title = bn && n.title_bn ? n.title_bn : n.title_en;
    const body = (bn && n.body_bn ? n.body_bn : n.body_en).replace(/\s+/g, ' ').trim();
    const message = sms.render(tpl ? (bn ? tpl.body_bn : tpl.body_en) : '{{title}}: {{body}} -{{org}}', { title, body, org: settings.sms_signature });
    const { list } = await recipients(req.body || {});
    if (!list.length) throw bad('Nobody to send to: no valid mobile numbers for the chosen audience');
    let sent = 0; let failed = 0;
    for (const r of list) {
      const out = await sms.sendSms({ to: r.phone, message, recipient_name: r.name, template_key: 'NOTICE', related_type: 'NOTICE', related_key: String(n.id_notices), created_by: userName(req) });
      if (out.status === 'FAILED') failed++; else sent++;
    }
    await db('notices').where({ id_notices: n.id_notices }).update({ sms_sent: Number(n.sms_sent || 0) + sent, sms_failed: Number(n.sms_failed || 0) + failed, sms_sent_at: new Date() });
    const { segments, encoding } = sms.segmentInfo(message);
    res.json({ success: true, sent, failed, segments, encoding, message: `SMS sent to ${sent} number(s)${failed ? `, ${failed} failed` : ''} · ${segments} part(s) each` });
  } catch (err) { fail(res, err); }
});

module.exports = router;
