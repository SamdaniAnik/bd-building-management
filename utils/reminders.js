// Staged reminders for things with a due date (licence renewals, upkeep tasks).
//
// An item gets one reminder per stage: at `first` days before it is due, then 15, 7, 1 and 0 days before,
// then once a week while overdue (up to 4 weeks). If the server was down over a stage, only the latest
// stage is sent — never a burst of catch-up messages. Sent stages are recorded in due_reminders_sent.
const { db } = require('../db/schemas');
const sms = require('./sms');

const MAX_OVERDUE_WEEKS = 4;

const ymd = d => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayYmd = () => ymd(new Date());

// Whole days from today to `due` (negative when overdue), on local calendar dates.
function daysLeft(due, from = todayYmd()) {
  const [a, b] = [from, ymd(due)].map(s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86400000);
}

// The stage an item is in today, or null when it is not yet time for the first reminder.
function currentStage(left, first) {
  if (left < 0) {
    const week = Math.ceil(-left / 7);            // 1st week overdue → -1, 2nd → -2…
    return week > MAX_OVERDUE_WEEKS ? null : -week;
  }
  const stages = [...new Set([first, 15, 7, 1, 0].filter(s => s <= first))].sort((x, y) => x - y);
  return stages.find(s => s >= left) ?? null;    // smallest stage not yet passed
}

// items: [{ source, source_id, due_date, first_days, phone, name, message(left) }]
// fallbackPhone: used when an item has no valid phone of its own.
async function sendStaged(items, { fallbackPhone, createdBy = 'Scheduler', relatedType }) {
  const out = { sent: 0, simulated: 0, failed: 0, skipped_no_phone: 0, already_sent: 0, not_due: 0 };
  for (const it of items) {
    const left = daysLeft(it.due_date);
    const stage = currentStage(left, Math.max(0, Number(it.first_days) || 0));
    if (stage === null) { out.not_due++; continue; }
    const key = { source: it.source, source_id: it.source_id, due_date: ymd(it.due_date), stage };
    if (await db('due_reminders_sent').where(key).first()) { out.already_sent++; continue; }
    const phone = sms.toMsisdn(it.phone) ? it.phone : (sms.toMsisdn(fallbackPhone) ? fallbackPhone : null);
    if (!phone) { out.skipped_no_phone++; continue; }
    const r = await sms.sendSms({ to: phone, message: it.message(left), recipient_name: it.name || null, template_key: it.template_key || null,
      related_type: relatedType, related_key: `${it.source}:${it.source_id}:${stage}`, created_by: createdBy });
    if (r.status === 'FAILED') { out.failed++; continue; } // not recorded, so tomorrow retries
    await db('due_reminders_sent').insert(key).onConflict(['source', 'source_id', 'due_date', 'stage']).ignore();
    out[r.status === 'SENT' ? 'sent' : 'simulated']++;
  }
  return out;
}

module.exports = { daysLeft, currentStage, sendStaged, ymd, todayYmd };
