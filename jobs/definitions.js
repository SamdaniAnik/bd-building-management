// What each scheduled job does. The scheduler (jobs/scheduler.js) decides when; this file decides what.
// Every run() returns { status: 'OK' | 'NOTHING', message, details? } and may throw (→ FAILED).
const { db } = require('../db/schemas');
const { ymd, today, dayOfMonth } = require('../routes/ops/common');

const thisMonth = () => today().slice(0, 7);

const JOBS = {
  RENT_INVOICES: {
    title: 'Monthly rent invoices',
    title_bn: 'মাসিক ভাড়ার ইনভয়েস',
    description: 'Creates this month’s rent invoice for every active rent agreement. Agreements that already have one are skipped.',
    description_bn: 'প্রতিটি চালু ভাড়া চুক্তির জন্য চলতি মাসের ইনভয়েস তৈরি করে। আগে থেকে থাকলে বাদ দেয়।',
    frequencies: ['MONTHLY'],
    defaults: { frequency: 'MONTHLY', run_day: 1, run_hour: 8, run_minute: 0, is_enabled: false },
    options: [],
    async run() {
      const { generateRentInvoices } = require('../routes/ops/tenants');
      const r = await generateRentInvoices(thisMonth());
      return { status: r.created ? 'OK' : 'NOTHING', message: r.message, details: r };
    },
  },

  SERVICE_CHARGE_RUN: {
    title: 'Monthly service charge bills',
    title_bn: 'মাসিক সার্ভিস চার্জ বিল',
    description: 'Runs the service-charge billing for this month using the active charge heads in Masters (no shared costs). Skipped if the month was already billed — for months with shared bills (diesel, common electricity) generate by hand instead.',
    description_bn: 'মাস্টারের চালু চার্জ হেড দিয়ে চলতি মাসের সার্ভিস চার্জ বিল তৈরি করে (শেয়ার্ড খরচ ছাড়া)। মাসটি আগেই বিল হলে বাদ দেয়।',
    frequencies: ['MONTHLY'],
    defaults: { frequency: 'MONTHLY', run_day: 1, run_hour: 8, run_minute: 15, is_enabled: false },
    options: [{ key: 'due_day', type: 'number', min: 1, max: 28, default: 10, label: 'Bills due on day', label_bn: 'পরিশোধের শেষ দিন (তারিখ)' }],
    async run(opts) {
      const { generateRun } = require('../routes/ops/billing');
      const month = thisMonth();
      if (await db('service_charge_runs').where({ billing_month: month }).first()) return { status: 'NOTHING', message: `${month} is already billed` };
      const r = await generateRun({ billing_month: month, due_date: dayOfMonth(month, opts.due_day) }, 'Scheduler');
      return { status: r.created ? 'OK' : 'NOTHING', message: r.message + (r.warnings?.length ? ` · ${r.warnings.join(' ')}` : ''), details: r };
    },
  },

  REFRESH_OVERDUE: {
    title: 'Mark overdue service charges',
    title_bn: 'বকেয়া সার্ভিস চার্জ চিহ্নিত করা',
    description: 'Every day, marks unpaid service-charge bills past their due date as OVERDUE so reports and late fines are up to date.',
    description_bn: 'প্রতিদিন মেয়াদ পেরোনো অপরিশোধিত সার্ভিস চার্জ বিলকে বকেয়া হিসেবে চিহ্নিত করে।',
    frequencies: ['DAILY', 'HOURLY'],
    defaults: { frequency: 'DAILY', run_hour: 0, run_minute: 30, is_enabled: true },
    options: [],
    async run() {
      const { refreshOverdue } = require('../routes/ops/billing');
      const n = await refreshOverdue();
      return { status: n ? 'OK' : 'NOTHING', message: `${n} bill(s) marked overdue` };
    },
  },

  DUE_REMINDERS: {
    title: 'Owner due-date SMS reminders',
    title_bn: 'মালিকদের বকেয়া এসএমএস রিমাইন্ডার',
    description: 'Texts flat owners about instalments, service charges and holding tax due within the next few days or already overdue. Anyone texted in the last 3 days is skipped, so overdue owners get at most one SMS every 3 days.',
    description_bn: 'আগামী কয়েক দিনে বা ইতিমধ্যে বকেয়া কিস্তি, সার্ভিস চার্জ ও হোল্ডিং ট্যাক্সের জন্য মালিকদের এসএমএস পাঠায়। গত ৩ দিনে পাঠানো হলে বাদ দেয়।',
    frequencies: ['DAILY'],
    defaults: { frequency: 'DAILY', run_hour: 10, run_minute: 0, is_enabled: false },
    options: [{ key: 'days_ahead', type: 'number', min: 0, max: 30, default: 3, label: 'Remind this many days before due', label_bn: 'মেয়াদের কত দিন আগে' }],
    async run(opts) {
      const { dueCandidates, sendDueReminders } = require('../routes/collections');
      const rows = (await dueCandidates(opts.days_ahead, null)).filter(r => r.valid_phone);
      if (!rows.length) return { status: 'NOTHING', message: 'Nothing due' };
      const r = await sendDueReminders(rows, 'Scheduler');
      const any = r.results.sent + r.results.simulated + r.results.failed;
      return { status: any ? 'OK' : 'NOTHING', message: r.message, details: r.results };
    },
  },

  RENT_REMINDERS: {
    title: 'Tenant rent SMS reminders',
    title_bn: 'ভাড়াটিয়াদের ভাড়ার এসএমএস রিমাইন্ডার',
    description: 'Texts tenants whose rent invoice is unpaid and due within the next few days or overdue, repeating every few days until paid.',
    description_bn: 'যেসব ভাড়াটিয়ার ভাড়া কয়েক দিনের মধ্যে বা ইতিমধ্যে বকেয়া, তাদের এসএমএস পাঠায়; পরিশোধ না হওয়া পর্যন্ত কয়েক দিন পরপর।',
    frequencies: ['DAILY'],
    defaults: { frequency: 'DAILY', run_hour: 10, run_minute: 5, is_enabled: false },
    options: [
      { key: 'days_ahead', type: 'number', min: 0, max: 30, default: 2, label: 'Remind this many days before due', label_bn: 'মেয়াদের কত দিন আগে' },
      { key: 'repeat_days', type: 'number', min: 1, max: 30, default: 3, label: 'Repeat every N days while unpaid', label_bn: 'বকেয়া থাকলে কত দিন পরপর' },
    ],
    async run(opts) {
      const { remindRentInvoices } = require('../routes/ops/tenants');
      const until = ymd(new Date(Date.now() + opts.days_ahead * 86400000));
      const ids = await db('rent_invoices').whereNot('status', 'PAID').where('due_date', '<=', until).pluck('id_rent_invoices');
      if (!ids.length) return { status: 'NOTHING', message: 'No rent due' };
      const r = await remindRentInvoices(ids, 'Scheduler', { skipRecentDays: opts.repeat_days });
      return { status: r.sent + r.failed ? 'OK' : 'NOTHING', message: r.message, details: r };
    },
  },

  HELPDESK_ESCALATION: {
    title: 'Escalate overdue complaints',
    title_bn: 'মেয়াদোত্তীর্ণ অভিযোগ এসকেলেশন',
    description: 'Flags resident complaints that have passed their fix-by deadline, alerts the dashboard, and (optionally) texts a manager. Each complaint is escalated once.',
    description_bn: 'নির্ধারিত সময় পেরিয়ে যাওয়া অভিযোগ চিহ্নিত করে, ড্যাশবোর্ডে জানায় এবং চাইলে ম্যানেজারকে এসএমএস পাঠায়।',
    frequencies: ['HOURLY'],
    defaults: { frequency: 'HOURLY', run_minute: 5, is_enabled: true },
    options: [{ key: 'sms_to', type: 'phone', default: '', label: 'Also text this manager mobile (optional)', label_bn: 'এই ম্যানেজার মোবাইলে এসএমএস (ঐচ্ছিক)' }],
    async run(opts) {
      const { escalateOverdue } = require('../routes/ops/helpdesk');
      const r = await escalateOverdue({ smsTo: opts.sms_to || null });
      return { status: r.escalated ? 'OK' : 'NOTHING', message: r.message, details: r };
    },
  },

  RENEWAL_REMINDERS: {
    title: 'Licence & certificate renewal reminders',
    title_bn: 'লাইসেন্স ও সনদ নবায়নের রিমাইন্ডার',
    description: 'Texts the person responsible (or the mobile below) when a lift / fire / trade licence, RAJUK or Fire NOC, extinguisher refill or vendor trade licence is close to expiry: at the item’s first-reminder day, then 15, 7, 1 and 0 days before, then weekly for up to 4 weeks after it lapses.',
    description_bn: 'লিফট/ফায়ার/ট্রেড লাইসেন্স, রাজউক বা ফায়ার এনওসি, অগ্নিনির্বাপক রিফিলের মেয়াদ শেষ হওয়ার আগে দায়িত্বপ্রাপ্ত ব্যক্তিকে এসএমএস পাঠায়: প্রথম রিমাইন্ডার, তারপর ১৫, ৭, ১ ও ০ দিন আগে, মেয়াদ শেষে সাপ্তাহিক।',
    frequencies: ['DAILY'],
    defaults: { frequency: 'DAILY', run_hour: 9, run_minute: 30, is_enabled: false },
    options: [{ key: 'sms_to', type: 'phone', default: '', label: 'Text this mobile when an item has no responsible person', label_bn: 'দায়িত্বপ্রাপ্ত না থাকলে এই মোবাইলে' }],
    async run(opts) {
      const { sendRenewalReminders } = require('../routes/ops/compliance');
      const r = await sendRenewalReminders({ smsTo: opts.sms_to || null });
      return { status: r.sent + r.simulated + r.failed ? 'OK' : 'NOTHING', message: r.message, details: r };
    },
  },

  UPKEEP_REMINDERS: {
    title: 'Building upkeep reminders',
    title_bn: 'ভবন রক্ষণাবেক্ষণের রিমাইন্ডার',
    description: 'Texts the assigned staff member (or the mobile below) a few days before a scheduled upkeep task — tank cleaning, pump service, Aedes check, roof drains — and weekly while it is overdue.',
    description_bn: 'ট্যাংক পরিষ্কার, পাম্প সার্ভিস, এডিস পরীক্ষা, ছাদের ড্রেন ইত্যাদির নির্ধারিত তারিখের কয়েক দিন আগে দায়িত্বপ্রাপ্ত কর্মীকে এসএমএস পাঠায়; বকেয়া থাকলে সাপ্তাহিক।',
    frequencies: ['DAILY'],
    defaults: { frequency: 'DAILY', run_hour: 8, run_minute: 30, is_enabled: false },
    options: [
      { key: 'days_ahead', type: 'number', min: 0, max: 30, default: 3, label: 'Remind this many days before due', label_bn: 'নির্ধারিত তারিখের কত দিন আগে' },
      { key: 'sms_to', type: 'phone', default: '', label: 'Text this mobile when no staff member is assigned', label_bn: 'কর্মী নির্ধারিত না থাকলে এই মোবাইলে' },
    ],
    async run(opts) {
      const { sendUpkeepReminders } = require('../routes/ops/upkeep');
      const r = await sendUpkeepReminders({ daysAhead: opts.days_ahead, smsTo: opts.sms_to || null });
      return { status: r.sent + r.simulated + r.failed ? 'OK' : 'NOTHING', message: r.message, details: r };
    },
  },
};

// Job options with defaults filled in and values clamped to the definition.
function resolveOptions(key, stored) {
  const def = JOBS[key];
  let raw = stored;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  raw = raw || {};
  const out = {};
  for (const o of def.options) {
    const v = raw[o.key];
    if (o.type === 'number') {
      const n = Number(v);
      out[o.key] = v === undefined || v === null || v === '' || Number.isNaN(n) ? o.default : Math.min(o.max, Math.max(o.min, Math.round(n)));
    } else out[o.key] = v === undefined || v === null ? o.default : String(v).trim();
  }
  return out;
}

module.exports = { JOBS, resolveOptions };
