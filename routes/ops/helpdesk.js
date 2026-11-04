// Resident helpdesk: complaints from flat owners (owner portal) or logged by staff (phone / walk-in),
// assigned to building staff, with a fix-by deadline per priority, a comment thread, SMS updates and a rating.
// Built on the existing maintenance_tickets table, so tickets from Post-Handover Maintenance appear here too.
// /portal/* is the only part flat-owner logins may reach (see app.js).
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, num } = require('./common');
const { isStaff } = require('../../middleware/auth');
const { getSettings } = require('../../utils/org');
const { isValidBdMobile, normalizeBdMobile } = require('../../utils/bd');
const sms = require('../../utils/sms');

const CATEGORIES = ['LIFT', 'GENERATOR', 'WATER_LEAKAGE', 'ELECTRICAL', 'GAS', 'SECURITY', 'CLEANING', 'PEST_CONTROL', 'PARKING', 'NOISE', 'INTERCOM_CCTV', 'COMMON_AREA', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const ACTIVE = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];
const SOURCES = ['PORTAL', 'STAFF', 'PHONE', 'WALK_IN'];
// Hours to fix, by priority.
const SLA_HOURS = { EMERGENCY: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };
// Residents may reopen a resolved complaint for this long; after that they lodge a new one.
const REOPEN_DAYS = 14;
const STATUS_LABEL = {
  OPEN: ['open', 'খোলা'], ASSIGNED: ['assigned to our staff', 'কর্মীকে দায়িত্ব দেওয়া হয়েছে'], IN_PROGRESS: ['being worked on', 'কাজ চলছে'],
  ON_HOLD: ['on hold', 'স্থগিত'], RESOLVED: ['resolved', 'সমাধান হয়েছে'], CLOSED: ['closed', 'বন্ধ'],
};

const ticketNo = id => `HD-${String(id).padStart(5, '0')}`;
const dueFrom = (createdAt, priority) => new Date(new Date(createdAt || Date.now()).getTime() + (SLA_HOURS[priority] || SLA_HOURS.MEDIUM) * 3600000);
const smsTime = d => {
  const x = new Date(d);
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)} ${p(x.getHours() % 12 || 12)}:${p(x.getMinutes())}${x.getHours() < 12 ? 'am' : 'pm'}`;
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

const baseQuery = () => db('maintenance_tickets as t')
  .leftJoin('units as u', 'u.id_units', 't.id_units')
  .leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
  .leftJoin('owners as o', 'o.id_owners', 't.id_owners')
  .leftJoin('building_staff as s', 's.id_staff', 't.id_staff')
  .select('t.*', 'u.unit_number', 'b.building_name', 'o.full_name as owner_name', 's.full_name as staff_name', 's.phone as staff_phone', 's.role as staff_role');

const shape = r => ({
  ...r, ticket_no: ticketNo(r.id_tickets),
  is_overdue: ACTIVE.includes(r.status) && !!r.due_by && new Date(r.due_by) < new Date(),
});

// Staff dashboard bell (notifications table). Never fails the request.
async function notifyStaff(title, message, type = 'HELPDESK') {
  try { await db('notifications').insert({ title: title.slice(0, 200), message, type }); } catch { /* best effort */ }
}

// Texts the reporter. Returns the SMS result, or null when there is no usable number / template.
async function smsReporter(ticket, templateKey, vars, createdBy) {
  if (!ticket.reporter_phone || !sms.toMsisdn(ticket.reporter_phone)) return null;
  const tpl = await sms.getTemplate(templateKey);
  if (!tpl || tpl.is_active === 0 || tpl.is_active === false) return null;
  const settings = await getSettings();
  const bn = settings.sms_language !== 'en';
  const message = sms.render(bn ? tpl.body_bn : tpl.body_en, {
    name: ticket.reporter_name || '', ticket_no: ticketNo(ticket.id_tickets), title: clean(ticket.title, 40), org: settings.sms_signature,
    ...(typeof vars === 'function' ? vars(bn) : vars),
  });
  return sms.sendSms({ to: ticket.reporter_phone, message, recipient_name: ticket.reporter_name, template_key: templateKey,
    related_type: 'TICKET', related_key: String(ticket.id_tickets), created_by: createdBy });
}

// Shared create path for staff and portal.
async function createTicket(input, { createdBy, source, notify }) {
  const title = clean(input.title, 200);
  const description = clean(input.description, 5000);
  if (!title) throw bad('Give the complaint a short title');
  if (!description) throw bad('Describe the problem');
  const category = CATEGORIES.includes(input.category) ? input.category : 'OTHER';
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'MEDIUM';
  if (input.reporter_phone && !isValidBdMobile(input.reporter_phone)) throw bad('Reporter phone is not a valid Bangladeshi mobile number');
  const id_units = input.id_units ? Number(input.id_units) : null;
  if (id_units && !(await db('units').where({ id_units }).first())) throw bad('Flat not found');
  const id_staff = input.id_staff ? Number(input.id_staff) : null;
  if (id_staff && !(await db('building_staff').where({ id_staff, status: 'ACTIVE' }).first())) throw bad('Choose an active staff member');

  const now = new Date();
  const row = {
    title, description, category, priority, id_units, id_staff,
    id_owners: input.id_owners || null, id_tenants: input.id_tenants || null,
    reporter_name: clean(input.reporter_name, 150) || null,
    reporter_phone: input.reporter_phone ? normalizeBdMobile(input.reporter_phone) : null,
    location: clean(input.location, 150) || null,
    source: SOURCES.includes(source) ? source : 'STAFF',
    status: id_staff ? 'ASSIGNED' : 'OPEN',
    due_by: dueFrom(now, priority), created_at: now, updated_at: now, created_by: createdBy,
  };
  const [id] = await db('maintenance_tickets').insert(row);
  await db('ticket_updates').insert({ id_tickets: id, author_name: createdBy, author_type: source === 'PORTAL' ? 'RESIDENT' : 'STAFF',
    message: 'Complaint lodged', to_status: row.status });
  const ticket = { ...row, id_tickets: id };
  await notifyStaff(`New ${priority === 'EMERGENCY' ? 'EMERGENCY ' : ''}complaint ${ticketNo(id)}`, `${title}${row.location ? ` · ${row.location}` : ''}`,
    priority === 'EMERGENCY' ? 'HELPDESK_URGENT' : 'HELPDESK');
  const smsOut = notify ? await smsReporter(ticket, 'TICKET_RECEIVED', { due_by: smsTime(row.due_by) }, createdBy) : null;
  return { id, ticket_no: ticketNo(id), sms: smsOut };
}

// ── Staff: setup & overview ─────────────────────────────────────
router.get('/setup', async (req, res) => {
  try {
    const staff = await db('building_staff').where({ status: 'ACTIVE' }).orderBy('role').orderBy('full_name').select('id_staff', 'full_name', 'role', 'phone');
    res.json({ success: true, categories: CATEGORIES, priorities: PRIORITIES, statuses: STATUSES, sources: SOURCES, sla_hours: SLA_HOURS, staff });
  } catch (err) { fail(res, err); }
});

router.get('/summary', async (req, res) => {
  try {
    const open = await db('maintenance_tickets').whereIn('status', ACTIVE).select('status', 'priority', 'category', 'due_by');
    const now = new Date();
    const since = new Date(Date.now() - 30 * 86400000);
    const [res30] = await db('maintenance_tickets').whereNotNull('resolved_at').where('resolved_at', '>=', since)
      .select(db.raw('COUNT(*) as n'), db.raw('AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) as avg_min'),
        db.raw('SUM(CASE WHEN due_by IS NULL OR resolved_at <= due_by THEN 1 ELSE 0 END) as on_time'));
    const [rating] = await db('maintenance_tickets').whereNotNull('rating').where('updated_at', '>=', since).select(db.raw('AVG(rating) as avg'), db.raw('COUNT(*) as n'));
    const byCategory = {};
    for (const t of open) byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    const resolved = Number(res30.n);
    res.json({
      success: true,
      open: open.length,
      unassigned: open.filter(t => t.status === 'OPEN').length,
      overdue: open.filter(t => t.due_by && new Date(t.due_by) < now).length,
      emergency: open.filter(t => t.priority === 'EMERGENCY').length,
      resolved_30d: resolved,
      avg_resolution_hours: res30.avg_min != null ? num(Number(res30.avg_min) / 60) : null,
      on_time_percent: resolved ? Math.round((Number(res30.on_time) / resolved) * 100) : null,
      avg_rating: rating.avg != null ? num(rating.avg) : null, ratings: Number(rating.n),
      by_category: byCategory,
    });
  } catch (err) { fail(res, err); }
});

// ── Staff: tickets ──────────────────────────────────────────────
router.get('/tickets', async (req, res) => {
  try {
    const q = baseQuery().limit(Math.min(1000, Number(req.query.limit) || 500));
    const st = req.query.status || 'ACTIVE';
    if (st === 'ACTIVE') q.whereIn('t.status', ACTIVE);
    else if (st === 'DONE') q.whereIn('t.status', ['RESOLVED', 'CLOSED']);
    else if (STATUSES.includes(st)) q.where('t.status', st);
    if (req.query.overdue === '1') q.whereIn('t.status', ACTIVE).where('t.due_by', '<', new Date());
    if (CATEGORIES.includes(req.query.category)) q.where('t.category', req.query.category);
    if (PRIORITIES.includes(req.query.priority)) q.where('t.priority', req.query.priority);
    if (req.query.staff === 'none') q.whereNull('t.id_staff');
    else if (req.query.staff) q.where('t.id_staff', req.query.staff);
    if (req.query.q) {
      const s = `%${req.query.q}%`;
      const idMatch = String(req.query.q).match(/^\s*(?:HD-?)?0*(\d+)\s*$/i);
      q.where(w => {
        w.where('t.title', 'like', s).orWhere('t.description', 'like', s).orWhere('u.unit_number', 'like', s)
          .orWhere('t.reporter_name', 'like', s).orWhere('t.reporter_phone', 'like', s).orWhere('o.full_name', 'like', s);
        if (idMatch) w.orWhere('t.id_tickets', Number(idMatch[1]));
      });
    }
    // Emergencies first, then whatever is closest to (or furthest past) its deadline.
    q.orderByRaw("FIELD(t.priority, 'EMERGENCY', 'HIGH', 'MEDIUM', 'LOW')").orderByRaw('t.due_by IS NULL').orderBy('t.due_by').orderBy('t.id_tickets', 'desc');
    if (st === 'DONE') q.clearOrder().orderBy('t.resolved_at', 'desc').orderBy('t.id_tickets', 'desc');
    res.json({ success: true, rows: (await q).map(shape) });
  } catch (err) { fail(res, err); }
});

router.get('/tickets/:id', async (req, res) => {
  try {
    const t = await baseQuery().where('t.id_tickets', req.params.id).first();
    if (!t) return res.status(404).json({ success: false, message: 'Complaint not found' });
    const updates = await db('ticket_updates').where({ id_tickets: t.id_tickets }).orderBy('created_at').orderBy('id_ticket_updates');
    res.json({ success: true, ticket: shape(t), updates });
  } catch (err) { fail(res, err); }
});

router.post('/tickets', async (req, res) => {
  try {
    const b = req.body || {};
    // Reporter defaults to the flat's primary owner when staff don't type one.
    let owner = null;
    if (b.id_units && !b.reporter_name) {
      owner = await db('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners').where('uo.id_units', b.id_units)
        .where(q => q.whereNull('uo.status').orWhere('uo.status', 'ACTIVE')).orderBy('uo.ownership_percentage', 'desc').select('o.id_owners', 'o.full_name', 'o.phone').first();
    }
    const out = await createTicket({
      ...b,
      id_owners: owner?.id_owners || null,
      reporter_name: b.reporter_name || owner?.full_name,
      reporter_phone: b.reporter_phone || (owner?.phone && isValidBdMobile(owner.phone) ? owner.phone : null),
    }, { createdBy: userName(req), source: b.source || 'STAFF', notify: !!b.notify_sms });
    res.json({ success: true, ...out, message: `Complaint ${out.ticket_no} logged${out.sms ? ` · SMS ${out.sms.status.toLowerCase()}` : ''}` });
  } catch (err) { fail(res, err); }
});

// One endpoint for every staff action: change status / assignee / priority, add a public reply or internal note.
router.post('/tickets/:id/update', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await db('maintenance_tickets').where({ id_tickets: req.params.id }).first();
    if (!t) throw bad('Complaint not found');
    const patch = {};
    const notes = [];
    const now = new Date();

    if (b.id_staff !== undefined && Number(b.id_staff || 0) !== Number(t.id_staff || 0)) {
      if (b.id_staff) {
        const s = await db('building_staff').where({ id_staff: b.id_staff, status: 'ACTIVE' }).first();
        if (!s) throw bad('Choose an active staff member');
        patch.id_staff = s.id_staff;
        notes.push(`Assigned to ${s.full_name}`);
        if (t.status === 'OPEN' && !b.status) patch.status = 'ASSIGNED';
      } else { patch.id_staff = null; notes.push('Unassigned'); }
    }
    if (b.priority && b.priority !== t.priority) {
      if (!PRIORITIES.includes(b.priority)) throw bad('Unknown priority');
      patch.priority = b.priority;
      patch.due_by = dueFrom(t.created_at, b.priority);
      patch.escalated_at = null;
      notes.push(`Priority ${t.priority} → ${b.priority}`);
    }
    if (b.repair_cost !== undefined && b.repair_cost !== '' && num(b.repair_cost) !== num(t.repair_cost)) {
      if (num(b.repair_cost) < 0) throw bad('Repair cost cannot be negative');
      patch.repair_cost = num(b.repair_cost);
      notes.push(`Repair cost Tk ${patch.repair_cost.toLocaleString('en-IN')}`);
    }
    if (b.resolution_notes !== undefined && (clean(b.resolution_notes, 5000) || null) !== (t.resolution_notes || null)) {
      patch.resolution_notes = clean(b.resolution_notes, 5000) || null;
      if (patch.resolution_notes) notes.push(`What was done: ${patch.resolution_notes}`);
    }

    const to = b.status || patch.status;
    if (to && to !== t.status) {
      if (!STATUSES.includes(to)) throw bad('Unknown status');
      patch.status = to;
      if (to === 'RESOLVED') { patch.resolved_at = now; patch.closed_at = null; }
      if (to === 'CLOSED') { patch.closed_at = now; if (!t.resolved_at) patch.resolved_at = now; }
      if (ACTIVE.includes(to) && !ACTIVE.includes(t.status)) {
        patch.resolved_at = null; patch.closed_at = null; patch.escalated_at = null;
        patch.reopen_count = Number(t.reopen_count || 0) + 1;
      }
    } else delete patch.status;

    const message = clean(b.message, 5000);
    const isInternal = !!b.is_internal;
    if (!Object.keys(patch).length && !message) throw bad('Nothing to update');
    if (!t.first_response_at && (patch.status || patch.id_staff || (message && !isInternal))) patch.first_response_at = now;
    patch.updated_at = now;

    await db.transaction(async trx => {
      await trx('maintenance_tickets').where({ id_tickets: t.id_tickets }).update(patch);
      const parts = [...notes, message].filter(Boolean).join('\n');
      await trx('ticket_updates').insert({ id_tickets: t.id_tickets, author_name: userName(req), author_type: 'STAFF', message: parts || null,
        from_status: patch.status ? t.status : null, to_status: patch.status || null, is_internal: isInternal && !patch.status });
    });

    let smsOut = null;
    if (b.notify_sms && (patch.status || (message && !isInternal))) {
      const status = patch.status || t.status;
      smsOut = await smsReporter({ ...t, ...patch }, 'TICKET_UPDATE', bn => ({
        status: (STATUS_LABEL[status] || [status, status])[bn ? 1 : 0],
        note: message && !isInternal ? ` ${clean(message, 80)}` : '',
      }), userName(req));
    }
    res.json({ success: true, message: `${ticketNo(t.id_tickets)} updated${smsOut ? ` · SMS ${smsOut.status.toLowerCase()}` : ''}`, sms: smsOut });
  } catch (err) { fail(res, err); }
});

router.delete('/tickets/:id', async (req, res) => {
  try {
    await db.transaction(async trx => {
      await trx('ticket_updates').where({ id_tickets: req.params.id }).del();
      await trx('maintenance_tickets').where({ id_tickets: req.params.id }).del();
    });
    res.json({ success: true, message: 'Complaint deleted' });
  } catch (err) { fail(res, err); }
});

// ── Owner portal ────────────────────────────────────────────────
// The owner linked to this login (owners.login_email). Staff may preview as ?ownerId=.
async function portalOwner(req) {
  const owner = await db('owners').where('login_email', req.user.email).first();
  if (owner) return owner;
  if (isStaff(req.user)) {
    const id = req.query.ownerId || req.body?.id_owners;
    const preview = id ? await db('owners').where('id_owners', id).first() : await db('owners').whereNotNull('login_email').first();
    if (preview) return preview;
  }
  throw Object.assign(new Error('No flat owner profile is linked to this login'), { status: 404 });
}
const ownerUnitIds = ownerId => db('unit_ownerships').where({ id_owners: ownerId }).where(q => q.whereNull('status').orWhere('status', 'ACTIVE')).pluck('id_units');
const ownTicket = async (owner, id) => {
  const units = await ownerUnitIds(owner.id_owners);
  const t = await db('maintenance_tickets').where({ id_tickets: id })
    .where(q => { q.where('id_owners', owner.id_owners); if (units.length) q.orWhereIn('id_units', units); }).first();
  if (!t) throw Object.assign(new Error('Complaint not found'), { status: 404 });
  return t;
};

router.get('/portal/tickets', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const units = await ownerUnitIds(owner.id_owners);
    const rows = await baseQuery().where(q => { q.where('t.id_owners', owner.id_owners); if (units.length) q.orWhereIn('t.id_units', units); })
      .orderByRaw(`FIELD(t.status, ${ACTIVE.map(() => '?').join(',')}) DESC`, ACTIVE).orderBy('t.id_tickets', 'desc').limit(100);
    const ids = rows.map(r => r.id_tickets);
    const updates = ids.length ? await db('ticket_updates').whereIn('id_tickets', ids).where('is_internal', false).orderBy('created_at').orderBy('id_ticket_updates')
      .select('id_ticket_updates', 'id_tickets', 'author_name', 'author_type', 'message', 'from_status', 'to_status', 'created_at') : [];
    const myUnits = units.length ? await db('units').whereIn('id_units', units).select('id_units', 'unit_number') : [];
    res.json({
      success: true, units: myUnits, categories: CATEGORIES, priorities: PRIORITIES, sla_hours: SLA_HOURS, reopen_days: REOPEN_DAYS,
      // Residents see who is handling it, but not staff phone numbers or internal cost fields.
      rows: rows.map(r => {
        const { staff_phone, repair_cost, created_by, escalated_at, ...pub } = shape(r);
        return { ...pub, updates: updates.filter(u => u.id_tickets === r.id_tickets) };
      }),
    });
  } catch (err) { fail(res, err); }
});

router.post('/portal/tickets', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const b = req.body || {};
    if (b.id_units) {
      const units = await ownerUnitIds(owner.id_owners);
      if (!units.includes(Number(b.id_units))) throw bad('You can only report problems for your own flat or the common area');
    }
    const out = await createTicket({
      title: b.title, description: b.description, category: b.category, priority: b.priority, location: b.location,
      id_units: b.id_units || null, id_owners: owner.id_owners, reporter_name: owner.full_name,
      reporter_phone: owner.phone && isValidBdMobile(owner.phone) ? owner.phone : null,
    }, { createdBy: owner.full_name, source: 'PORTAL', notify: true });
    res.json({ success: true, ...out, message: `Complaint ${out.ticket_no} received. Management has been notified.` });
  } catch (err) { fail(res, err); }
});

// Resident reply. On a resolved/closed complaint, reopen: true sends it back to the team.
router.post('/portal/tickets/:id/comment', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const t = await ownTicket(owner, req.params.id);
    const message = clean(req.body?.message, 2000);
    const reopen = !!req.body?.reopen && !ACTIVE.includes(t.status);
    if (!message) throw bad(reopen ? 'Tell us what is still wrong' : 'Write a message');
    const doneAt = t.closed_at || t.resolved_at;
    if (reopen && doneAt && Date.now() - new Date(doneAt).getTime() > REOPEN_DAYS * 86400000) {
      throw bad(`This complaint was closed more than ${REOPEN_DAYS} days ago. Please lodge a new complaint.`);
    }
    const patch = { updated_at: new Date() };
    // Goes back to whoever handled it, if anyone.
    if (reopen) Object.assign(patch, { status: t.id_staff ? 'ASSIGNED' : 'OPEN', resolved_at: null, closed_at: null, escalated_at: null, rating: null, rating_comment: null,
      reopen_count: Number(t.reopen_count || 0) + 1, due_by: dueFrom(new Date(), t.priority) });
    await db('maintenance_tickets').where({ id_tickets: t.id_tickets }).update(patch);
    await db('ticket_updates').insert({ id_tickets: t.id_tickets, author_name: owner.full_name, author_type: 'RESIDENT', message,
      from_status: reopen ? t.status : null, to_status: reopen ? patch.status : null });
    await notifyStaff(`${reopen ? 'Reopened' : 'Reply on'} ${ticketNo(t.id_tickets)}`, `${owner.full_name}: ${message.slice(0, 200)}`);
    res.json({ success: true, message: reopen ? 'Complaint reopened' : 'Message sent' });
  } catch (err) { fail(res, err); }
});

router.post('/portal/tickets/:id/rate', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const t = await ownTicket(owner, req.params.id);
    if (!['RESOLVED', 'CLOSED'].includes(t.status)) throw bad('You can rate a complaint once it is resolved');
    const rating = Math.round(Number(req.body?.rating));
    if (!(rating >= 1 && rating <= 5)) throw bad('Choose 1 to 5 stars');
    const comment = clean(req.body?.comment, 500) || null;
    const now = new Date();
    await db('maintenance_tickets').where({ id_tickets: t.id_tickets }).update({ rating, rating_comment: comment, status: 'CLOSED', closed_at: t.closed_at || now, updated_at: now });
    await db('ticket_updates').insert({ id_tickets: t.id_tickets, author_name: owner.full_name, author_type: 'RESIDENT',
      message: `Rated ${rating}/5${comment ? `: ${comment}` : ''}`, from_status: t.status !== 'CLOSED' ? t.status : null, to_status: t.status !== 'CLOSED' ? 'CLOSED' : null });
    res.json({ success: true, message: 'Thank you for your feedback' });
  } catch (err) { fail(res, err); }
});

// ── Escalation (called by the scheduler) ────────────────────────
// Flags every active complaint past its deadline once, notes it on the thread, alerts the dashboard,
// and optionally texts a manager. Returns how many were escalated.
async function escalateOverdue({ smsTo, createdBy = 'Scheduler' } = {}) {
  const late = await baseQuery().whereIn('t.status', ACTIVE).whereNotNull('t.due_by').where('t.due_by', '<', new Date()).whereNull('t.escalated_at');
  if (!late.length) return { escalated: 0, message: 'No complaints past their deadline' };
  const now = new Date();
  await db('maintenance_tickets').whereIn('id_tickets', late.map(t => t.id_tickets)).update({ escalated_at: now });
  await db('ticket_updates').insert(late.map(t => ({ id_tickets: t.id_tickets, author_name: 'System', author_type: 'SYSTEM', is_internal: true,
    message: `Past its ${SLA_HOURS[t.priority] || SLA_HOURS.MEDIUM}-hour deadline (${smsTime(t.due_by)}) — escalated` })));
  const list = late.map(t => `${ticketNo(t.id_tickets)} ${clean(t.title, 40)}${t.unit_number ? ` (${t.unit_number})` : ''}`);
  await notifyStaff(`${late.length} complaint(s) overdue`, list.join('\n'), 'HELPDESK_URGENT');
  let smsOut = null;
  if (smsTo && sms.toMsisdn(smsTo)) {
    const settings = await getSettings();
    const msg = `${late.length} complaint(s) overdue: ${list.slice(0, 3).join('; ')}${late.length > 3 ? ` +${late.length - 3} more` : ''} -${settings.sms_signature}`;
    smsOut = await sms.sendSms({ to: smsTo, message: msg, recipient_name: 'Manager', related_type: 'TICKET_ESCALATION', related_key: now.toISOString().slice(0, 13), created_by: createdBy });
  }
  return { escalated: late.length, sms: smsOut?.status || null, message: `${late.length} overdue complaint(s) escalated${smsOut ? ` · manager SMS ${smsOut.status.toLowerCase()}` : ''}` };
}

module.exports = router;
module.exports.escalateOverdue = escalateOverdue;
module.exports.SLA_HOURS = SLA_HOURS;
module.exports.dueFrom = dueFrom;
