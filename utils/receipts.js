// Issues numbered money receipts and Mushak-6.3 tax invoices, and the "payment received" SMS.
const { db } = require('../db/schemas');
const { fiscalYearOf, round2 } = require('./bd');
const { amountInWordsEn, amountInWordsBn } = require('./words');
const { getSettings } = require('./org');
const sms = require('./sms');

const PREFIX = { MONEY_RECEIPT: 'MR', MUSHAK_6_3: 'VAT' };

const parseJson = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

// Normalises line items and computes SD / VAT / totals. VAT is charged on (value + SD), as on Mushak-6.3.
function computeLines(items, docType) {
  const lines = (items || []).map((it, i) => {
    const qty = Number(it.qty ?? 1) || 1;
    const unitPrice = Number(it.unit_price ?? it.amount ?? 0);
    const value = round2(qty * unitPrice);
    const sdRate = docType === 'MUSHAK_6_3' ? Number(it.sd_rate || 0) : 0;
    const vatRate = docType === 'MUSHAK_6_3' ? Number(it.vat_rate || 0) : 0;
    const sd = round2(value * sdRate / 100);
    const vat = round2((value + sd) * vatRate / 100);
    return { sl: i + 1, description: String(it.description || '').slice(0, 300), uom: it.uom || (docType === 'MUSHAK_6_3' ? 'Service' : ''), qty, unit_price: unitPrice, value, sd_rate: sdRate, sd, vat_rate: vatRate, vat, total: round2(value + sd + vat) };
  }).filter(l => l.description && l.value > 0);
  const sum = f => round2(lines.reduce((s, l) => s + l[f], 0));
  return { lines, subtotal: sum('value'), sd: sum('sd'), vat: sum('vat'), total: sum('total') };
}

async function nextNumber(trx, docType, fy) {
  await trx('receipt_sequences').insert({ doc_type: docType, fiscal_year: fy, last_no: 0 }).onConflict(['doc_type', 'fiscal_year']).ignore();
  const row = await trx('receipt_sequences').where({ doc_type: docType, fiscal_year: fy }).forUpdate().first();
  const n = row.last_no + 1;
  await trx('receipt_sequences').where({ doc_type: docType, fiscal_year: fy }).update({ last_no: n });
  return `${PREFIX[docType]}/${fy}/${String(n).padStart(6, '0')}`;
}

/**
 * Issue a receipt. If source_type/source_id are given and a receipt already exists for that
 * source, the existing receipt is returned (idempotent) with { existing: true }.
 */
async function issueReceipt(input, { sendSms = false, createdBy } = {}) {
  const docType = input.doc_type === 'MUSHAK_6_3' ? 'MUSHAK_6_3' : 'MONEY_RECEIPT';
  const calc = computeLines(input.items, docType);
  if (!calc.lines.length) throw Object.assign(new Error('Add at least one line with a description and an amount'), { status: 400 });
  if (!input.received_from) throw Object.assign(new Error('"Received from" is required'), { status: 400 });
  if (docType === 'MUSHAK_6_3') {
    const s = await getSettings();
    if (!s.bin) throw Object.assign(new Error('Set your VAT BIN under Collections → Settings before issuing Mushak-6.3'), { status: 400 });
  }

  const issueAt = input.issue_datetime ? new Date(input.issue_datetime) : new Date();
  const fy = fiscalYearOf(issueAt);
  const sourceType = input.source_type || 'MANUAL';
  const sourceId = input.source_id || null;

  let receipt; let existing = false;
  await db.transaction(async trx => {
    if (sourceId) {
      const dup = await trx('money_receipts').where({ source_type: sourceType, source_id: sourceId, doc_type: docType }).first();
      if (dup) { receipt = dup; existing = true; return; }
    }
    const receipt_no = await nextNumber(trx, docType, fy);
    const [id] = await trx('money_receipts').insert({
      id_projects: input.id_projects || null, receipt_no, doc_type: docType, fiscal_year: fy, issue_datetime: issueAt,
      id_owners: input.id_owners || null, unit_number: input.unit_number || null,
      received_from: input.received_from, phone: input.phone || null, address: input.address || null, buyer_bin: input.buyer_bin || null,
      line_items_json: JSON.stringify(calc.lines), subtotal_bdt: calc.subtotal, sd_total_bdt: calc.sd, vat_total_bdt: calc.vat, total_bdt: calc.total,
      amount_words_en: amountInWordsEn(calc.total), amount_words_bn: amountInWordsBn(calc.total),
      payment_method: input.payment_method || 'CASH', payment_ref: input.payment_ref || null,
      source_type: sourceType, source_id: sourceId, issued_by: createdBy || null,
    });
    receipt = await trx('money_receipts').where({ id_receipts: id }).first();
  });

  receipt.line_items_json = parseJson(receipt.line_items_json);
  let smsResult = null;
  if (sendSms && !existing && receipt.phone) smsResult = await sendPaymentReceivedSms(receipt, createdBy);
  return { receipt, existing, sms: smsResult };
}

async function sendPaymentReceivedSms(receipt, createdBy) {
  const settings = await getSettings();
  const tpl = await sms.getTemplate('PAYMENT_RECEIVED');
  if (!tpl || !tpl.is_active) return null;
  const bn = settings.sms_language !== 'en';
  const amount = Number(receipt.total_bdt).toLocaleString('en-IN');
  const message = sms.render(bn ? tpl.body_bn : tpl.body_en, {
    name: receipt.received_from, amount, receipt_no: receipt.receipt_no, org: settings.sms_signature,
    unit_part: receipt.unit_number ? (bn ? ` (ফ্ল্যাট ${receipt.unit_number})` : ` for flat ${receipt.unit_number}`) : '',
  });
  return sms.sendSms({ to: receipt.phone, message, recipient_name: receipt.received_from, template_key: 'PAYMENT_RECEIVED', related_type: 'RECEIPT', related_key: receipt.receipt_no, id_projects: receipt.id_projects, created_by: createdBy });
}

module.exports = { computeLines, issueReceipt, sendPaymentReceivedSms, parseJson };
