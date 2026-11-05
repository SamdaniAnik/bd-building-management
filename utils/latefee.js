// Late payment fine calculation, driven by master_late_fee_rules (one active rule per item type).
const { db } = require('../db/schemas');

const DAY = 86400000;
const ymd = d => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // DATE columns arrive as strings
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
// Whole calendar days between two dates, ignoring time of day / timezone
const daysBetween = (from, to) => Math.round((new Date(`${ymd(to)}T00:00:00`) - new Date(`${ymd(from)}T00:00:00`)) / DAY);

/**
 * fine for one overdue item.
 *   rule: master_late_fee_rules row · outstanding: unpaid principal · due_date: date · asOf: date (default today)
 * Returns { fine, days_late, chargeable_days }.
 */
function computeFine(rule, { outstanding, due_date, asOf = new Date() }) {
  const out = Number(outstanding) || 0;
  const daysLate = Math.max(0, daysBetween(due_date, asOf));
  if (!rule || !rule.is_active || out <= 0 || daysLate <= Number(rule.grace_days || 0)) return { fine: 0, days_late: daysLate, chargeable_days: 0 };

  const days = rule.count_from === 'AFTER_GRACE' ? daysLate - Number(rule.grace_days || 0) : daysLate;
  const amt = Number(rule.fine_amount) || 0;
  let fine;
  switch (rule.fine_type) {
    case 'FIXED': fine = amt; break;
    case 'PERCENT': fine = out * amt / 100; break;
    case 'PER_DAY_FIXED': fine = amt * days; break;
    case 'PER_DAY_PERCENT': fine = out * amt / 100 * days; break;
    case 'PER_MONTH_PERCENT': fine = out * amt / 100 * Math.ceil(days / 30); break;
    default: fine = 0;
  }
  const cap = Number(rule.max_fine_bdt) || 0;
  if (cap > 0) fine = Math.min(fine, cap);
  return { fine: Math.round(fine), days_late: daysLate, chargeable_days: days }; // fines are charged in whole taka
}

async function activeRules(conn = db) {
  const rows = await conn('master_late_fee_rules').where({ is_active: true }).orderBy('id_late_fee_rules', 'asc');
  const map = {};
  for (const r of rows) if (!map[r.item_type]) map[r.item_type] = r;
  return map;
}

async function waiverSet(conn = db) {
  const rows = await conn('late_fee_waivers').select('item_type', 'item_key', 'reason', 'waived_by', 'created_at');
  return new Map(rows.map(r => [`${r.item_type}:${r.item_key}`, r]));
}

/** Convenience: fine for an item, honouring waivers. Pass preloaded rules/waivers when looping. */
function fineFor({ rules, waivers }, itemType, itemKey, outstanding, dueDate, asOf) {
  const waiver = waivers.get(`${itemType}:${itemKey}`);
  const calc = computeFine(rules[itemType], { outstanding, due_date: dueDate, asOf });
  if (waiver) return { ...calc, fine: 0, waived: true, waived_fine: calc.fine, waiver };
  return { ...calc, waived: false };
}

async function loadFineContext(conn = db) {
  const [rules, waivers] = await Promise.all([activeRules(conn), waiverSet(conn)]);
  return { rules, waivers };
}

module.exports = { computeFine, activeRules, waiverSet, fineFor, loadFineContext, daysBetween };
