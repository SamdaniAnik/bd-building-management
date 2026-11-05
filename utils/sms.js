// SMS gateway adapter for Bangladeshi providers.
//
//   SMS_PROVIDER=log          (default) — nothing is sent; messages are stored as SIMULATED
//   SMS_PROVIDER=bulksmsbd    — needs SMS_API_KEY, SMS_SENDER_ID
//   SMS_PROVIDER=sslwireless  — needs SMS_API_TOKEN, SMS_SID
//
// Confirm the endpoint and parameters with your provider's current API docs before going live.
const { db } = require('../db/schemas');

const DEFAULT_TEMPLATES = {
  INSTALLMENT_DUE: {
    name: 'Instalment due reminder',
    body_en: 'Dear {{name}}, instalment "{{item}}" for flat {{unit}} - Tk {{amount}}{{fine_note}} is due on {{due_date}}. Please pay on time to avoid late fee. -{{org}}',
    body_bn: 'প্রিয় {{name}}, ফ্ল্যাট {{unit}}-এর "{{item}}" কিস্তি {{amount}} টাকা{{fine_note}} {{due_date}} তারিখের মধ্যে পরিশোধ করুন। -{{org}}',
  },
  SERVICE_CHARGE_DUE: {
    name: 'Service charge due reminder',
    body_en: 'Dear {{name}}, service charge for flat {{unit}} ({{item}}) Tk {{amount}}{{fine_note}} is due on {{due_date}}. -{{org}}',
    body_bn: 'প্রিয় {{name}}, ফ্ল্যাট {{unit}}-এর {{item}} মাসের সার্ভিস চার্জ {{amount}} টাকা{{fine_note}} {{due_date}} তারিখের মধ্যে পরিশোধ করুন। -{{org}}',
  },
  HOLDING_TAX_DUE: {
    name: 'Holding tax quarter reminder',
    body_en: 'Dear {{name}}, holding tax {{item}} for flat {{unit}} Tk {{amount}}{{fine_note}} is due by {{due_date}}. -{{org}}',
    body_bn: 'প্রিয় {{name}}, ফ্ল্যাট {{unit}}-এর হোল্ডিং ট্যাক্স ({{item}}) {{amount}} টাকা{{fine_note}} {{due_date}} তারিখের মধ্যে পরিশোধ করুন। -{{org}}',
  },
  RENT_DUE: {
    name: 'Rent due reminder',
    body_en: 'Dear {{name}}, rent for flat {{unit}} ({{item}}) Tk {{amount}} is due on {{due_date}}. -{{org}}',
    body_bn: 'প্রিয় {{name}}, ফ্ল্যাট {{unit}}-এর {{item}} মাসের ভাড়া {{amount}} টাকা {{due_date}} তারিখের মধ্যে পরিশোধ করুন। -{{org}}',
  },
  NOTICE: {
    name: 'Notice board broadcast',
    body_en: '{{title}}: {{body}} -{{org}}',
    body_bn: '{{title}}: {{body}} -{{org}}',
  },
  TICKET_RECEIVED: {
    name: 'Complaint received',
    body_en: 'Dear {{name}}, your complaint {{ticket_no}} ({{title}}) has been received. We aim to resolve it by {{due_by}}. -{{org}}',
    body_bn: 'প্রিয় {{name}}, আপনার অভিযোগ {{ticket_no}} ({{title}}) গ্রহণ করা হয়েছে। {{due_by}}-এর মধ্যে সমাধানের চেষ্টা করা হবে। -{{org}}',
  },
  TICKET_UPDATE: {
    name: 'Complaint status update',
    body_en: 'Dear {{name}}, complaint {{ticket_no}} ({{title}}) is now {{status}}.{{note}} -{{org}}',
    body_bn: 'প্রিয় {{name}}, অভিযোগ {{ticket_no}} ({{title}}) এখন {{status}}।{{note}} -{{org}}',
  },
  RENEWAL_DUE: {
    name: 'Licence / certificate renewal reminder',
    body_en: '{{title}} ({{ref}}) {{when}} on {{due_date}}. Please arrange the renewal. -{{org}}',
    body_bn: '{{title}} ({{ref}}) — মেয়াদ {{due_date}} তারিখে {{when}}। নবায়নের ব্যবস্থা নিন। -{{org}}',
  },
  UPKEEP_DUE: {
    name: 'Building upkeep task reminder',
    body_en: 'Upkeep: {{title}} {{when}} on {{due_date}}. Please do it and record it in the system. -{{org}}',
    body_bn: 'রক্ষণাবেক্ষণ: {{title}} — নির্ধারিত তারিখ {{due_date}} ({{when}})। কাজ শেষে সিস্টেমে লিখে রাখুন। -{{org}}',
  },
  MEETING_NOTICE: {
    name: "Owners' meeting notice",
    body_en: 'Dear {{name}}, {{title}} will be held on {{when}} at {{venue}}. Your presence is requested. -{{org}}',
    body_bn: 'প্রিয় {{name}}, {{title}} {{when}} তারিখে {{venue}}-এ অনুষ্ঠিত হবে। আপনার উপস্থিতি কাম্য। -{{org}}',
  },
  ELECTION_NOTICE: {
    name: 'Committee election voting notice',
    body_en: 'Dear {{name}}, voting for {{title}} is open from {{opens}} to {{closes}}. Vote in the owner portal or at the polling booth. Your vote is secret. -{{org}}',
    body_bn: 'প্রিয় {{name}}, {{title}}-এর ভোটগ্রহণ {{opens}} থেকে {{closes}} পর্যন্ত। মালিক পোর্টালে বা ভোটকেন্দ্রে ভোট দিন। আপনার ভোট গোপন থাকবে। -{{org}}',
  },
  PAYMENT_RECEIVED: {
    name: 'Payment received confirmation',
    body_en: 'Dear {{name}}, we have received Tk {{amount}}{{unit_part}}. Receipt no {{receipt_no}}. Thank you. -{{org}}',
    body_bn: 'প্রিয় {{name}}, আপনার {{amount}} টাকা পরিশোধ গ্রহণ করা হয়েছে{{unit_part}}। রসিদ নং {{receipt_no}}। ধন্যবাদ। -{{org}}',
  },
};

async function ensureTemplates() {
  const rows = Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => ({ template_key: k, ...v }));
  await db('sms_templates').insert(rows).onConflict('template_key').ignore();
}

async function getTemplate(key) {
  await ensureTemplates();
  return db('sms_templates').where({ template_key: key }).first();
}

const render = (body, vars) => String(body).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());

// 01XXXXXXXXX / +8801XXXXXXXXX → 8801XXXXXXXXX, or null if not a BD mobile
function toMsisdn(num) {
  const n = String(num || '').replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^8801[3-9]\d{8}$/.test(n)) return n;
  if (/^01[3-9]\d{8}$/.test(n)) return '88' + n;
  return null;
}

// GSM-7 basic charset check (approximate) → otherwise UCS-2 (Bangla is always UNICODE)
function segmentInfo(message) {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(message);
  const len = [...message].length;
  if (gsm) return { encoding: 'GSM', segments: len <= 160 ? 1 : Math.ceil(len / 153) };
  return { encoding: 'UNICODE', segments: len <= 70 ? 1 : Math.ceil(len / 67) };
}

function providerStatus() {
  const provider = (process.env.SMS_PROVIDER || 'log').toLowerCase();
  const missing = {
    bulksmsbd: ['SMS_API_KEY', 'SMS_SENDER_ID'],
    sslwireless: ['SMS_API_TOKEN', 'SMS_SID'],
  }[provider]?.filter(k => !process.env[k]) || [];
  return { provider, live: provider !== 'log' && missing.length === 0, missing };
}

async function deliver(msisdn, message) {
  const { provider, live, missing } = providerStatus();
  if (provider === 'log') return { status: 'SIMULATED', response: 'SMS_PROVIDER=log — not sent' };
  if (!live) return { status: 'FAILED', response: `Provider ${provider} not configured: missing ${missing.join(', ')}` };

  const signal = AbortSignal.timeout(15000);
  if (provider === 'bulksmsbd') {
    const url = new URL(process.env.SMS_API_URL || 'http://bulksmsbd.net/api/smsapi');
    url.search = new URLSearchParams({ api_key: process.env.SMS_API_KEY, type: 'text', number: msisdn, senderid: process.env.SMS_SENDER_ID, message }).toString();
    const r = await fetch(url, { signal });
    const text = await r.text();
    let ok = r.ok;
    try { const j = JSON.parse(text); ok = ok && Number(j.response_code) === 202; } catch { /* non-JSON body */ }
    return { status: ok ? 'SENT' : 'FAILED', response: text.slice(0, 1000) };
  }
  if (provider === 'sslwireless') {
    const r = await fetch(process.env.SMS_API_URL || 'https://smsplus.sslwireless.com/api/v3/send-sms', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ api_token: process.env.SMS_API_TOKEN, sid: process.env.SMS_SID, msisdn, sms: message, csms_id: `SB${Date.now()}${Math.floor(Math.random() * 1000)}` }),
    });
    const text = await r.text();
    let ok = r.ok;
    try { const j = JSON.parse(text); ok = ok && String(j.status).toUpperCase() === 'SUCCESS'; } catch { /* non-JSON body */ }
    return { status: ok ? 'SENT' : 'FAILED', response: text.slice(0, 1000) };
  }
  return { status: 'FAILED', response: `Unknown SMS_PROVIDER "${provider}"` };
}

// Sends one SMS and records it in sms_outbox. Never throws for delivery errors.
async function sendSms({ to, message, recipient_name, template_key, related_type, related_key, id_projects, created_by }) {
  const msisdn = toMsisdn(to);
  const { encoding, segments } = segmentInfo(message);
  const { provider } = providerStatus();
  let result;
  if (!msisdn) result = { status: 'FAILED', response: `Invalid Bangladeshi mobile number: ${to}` };
  else {
    try { result = await deliver(msisdn, message); }
    catch (e) { result = { status: 'FAILED', response: `Gateway error: ${e.message}` }; }
  }
  const base = {
    id_projects: id_projects || null, to_number: msisdn || String(to || '').slice(0, 20), recipient_name: recipient_name || null,
    message, template_key: template_key || null, related_type: related_type || null, related_key: related_key || null, created_by: created_by || null,
  };
  const [id] = await db('sms_outbox').insert({ ...base, encoding, segments, provider, status: result.status, provider_response: result.response, channel: 'SMS' });
  const whatsapp = msisdn ? await mirrorToWhatsApp(base, msisdn) : null;
  return { id, ...result, to: msisdn, segments, encoding, whatsapp };
}

// When "Also send on WhatsApp" is switched on (Collections → settings), every SMS is copied to WhatsApp.
// The SMS result stays the one that counts; a WhatsApp failure is only logged in the outbox.
async function mirrorToWhatsApp(base, msisdn) {
  const { getSettings } = require('./org');
  if ((await getSettings()).whatsapp_enabled !== 'true') return null;
  const wa = require('./whatsapp');
  let r;
  try { r = await wa.deliver(msisdn, base.message); }
  catch (e) { r = { status: 'FAILED', response: `WhatsApp error: ${e.message}` }; }
  await db('sms_outbox').insert({ ...base, encoding: 'UNICODE', segments: 1, provider: `whatsapp-${wa.status().provider}`, status: r.status, provider_response: r.response, channel: 'WHATSAPP' });
  return r.status;
}

module.exports = { DEFAULT_TEMPLATES, ensureTemplates, getTemplate, render, toMsisdn, segmentInfo, providerStatus, sendSms };
