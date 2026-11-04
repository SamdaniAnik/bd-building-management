// Helpers shared by the building-operations routers (tenants, billing, staff, gate).
const { db } = require('../../db/schemas');
const { round2 } = require('../../utils/bd');

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || String(err) });
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const userName = req => req.user?.name || 'Staff';
const num = v => round2(Number(v) || 0);

const ymd = d => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const today = () => ymd(new Date());
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const daysInMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
// Day `day` of month "YYYY-MM", clamped to the month's length (due day 31 → 30 Nov).
const dayOfMonth = (m, day) => `${m}-${String(Math.min(Math.max(1, Number(day) || 1), daysInMonth(m))).padStart(2, '0')}`;
const monthsBetween = (fromYmd, toMonth) => {
  const [fy, fm] = fromYmd.slice(0, 7).split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

// "Tower A - Padma · A-102" style label used in every dropdown and table.
const unitsQuery = (conn = db) => conn('units as u')
  .leftJoin('buildings as b', 'b.id_buildings', 'u.id_buildings')
  .leftJoin('floors as f', 'f.id_floors', 'u.id_floors')
  .select('u.id_units', 'u.unit_number', 'u.area_sqft', 'u.status', 'u.is_common_share', 'u.id_buildings',
    'b.building_name', 'b.building_code', 'f.floor_number');

// Primary owner (highest share) per unit: { [id_units]: { id_owners, full_name, phone } }
async function primaryOwners(unitIds, conn = db) {
  if (!unitIds.length) return {};
  const rows = await conn('unit_ownerships as uo').join('owners as o', 'o.id_owners', 'uo.id_owners')
    .whereIn('uo.id_units', unitIds).where(q => q.whereNull('uo.status').orWhere('uo.status', 'ACTIVE'))
    .orderBy('uo.ownership_percentage', 'desc')
    .select('uo.id_units', 'o.id_owners', 'o.full_name', 'o.phone', 'o.address');
  const out = {};
  for (const r of rows) if (!out[r.id_units]) out[r.id_units] = r;
  return out;
}

// Only the listed keys, with '' → null, so a request can't write arbitrary columns.
const pick = (body, keys) => {
  const out = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k] === '' ? null : body[k];
  return out;
};

const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'BANK', 'CHEQUE', 'CARD'];
const method = m => (PAYMENT_METHODS.includes(String(m || '').toUpperCase()) ? String(m).toUpperCase() : 'CASH');

module.exports = { db, fail, bad, userName, num, round2, ymd, today, isMonth, daysInMonth, dayOfMonth, monthsBetween, unitsQuery, primaryOwners, pick, PAYMENT_METHODS, method };
