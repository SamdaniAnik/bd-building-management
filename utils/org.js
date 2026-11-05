const { db } = require('../db/schemas');

// Organisation details printed on receipts / used as SMS signature. Editable from the Collections page.
const DEFAULT_SETTINGS = {
  company_name_en: 'Shopno Bilash Construction',
  company_name_bn: 'স্বপ্ন বিলাস কনস্ট্রাকশন',
  address: 'Uttara, Dhaka-1230',
  phone: '',
  email: '',
  bin: '',            // VAT Business Identification Number — required on Mushak-6.3
  tin: '',
  sms_signature: 'Shopno Bilash',
  sms_language: 'bn', // 'bn' | 'en'
  sms_auto_payment_received: 'true',
  receipt_footer: 'This is a computer-generated receipt. Please keep it for your records.',
  whatsapp_enabled: 'false',        // copy every SMS to WhatsApp (see utils/whatsapp.js)
  no_tin_tds_uplift_percent: '50',  // extra source tax when a vendor shows no TIN / return proof — check the current Finance Act
};
const KEYS = Object.keys(DEFAULT_SETTINGS);

async function getSettings(conn = db) {
  const rows = await conn('org_settings').whereIn('setting_key', KEYS);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.setting_key] = r.setting_value ?? '';
  return out;
}

async function saveSettings(values) {
  const rows = Object.entries(values || {})
    .filter(([k]) => KEYS.includes(k))
    .map(([k, v]) => ({ setting_key: k, setting_value: v == null ? '' : String(v).slice(0, 2000), updated_at: new Date() }));
  if (rows.length) await db('org_settings').insert(rows).onConflict('setting_key').merge();
  return getSettings();
}

module.exports = { getSettings, saveSettings, DEFAULT_SETTINGS };
