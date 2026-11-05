// Bangladesh-specific calculation helpers.
// NOTE: statutory rates change with each Finance Act / NBR SRO. The values below are
// defaults only — every endpoint accepts overrides, and they should be verified against
// the current fiscal year's Finance Act before being relied on for a real deed or return.

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Bangladesh fiscal year runs 1 July – 30 June. Returns e.g. "2026-27".
function fiscalYearOf(dateInput) {
  const m = typeof dateInput === 'string' && /^(\d{4})-(\d{2})-\d{2}/.exec(dateInput);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : dateInput ? new Date(dateInput) : new Date();
  const y = d.getFullYear();
  const start = d.getMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Mobile wallet numbers: 11 digits, 013–019 operator prefixes.
function isValidBdMobile(num) {
  return /^01[3-9]\d{8}$/.test(String(num || '').replace(/[\s-]/g, '').replace(/^\+?88/, ''));
}
function normalizeBdMobile(num) {
  return String(num || '').replace(/[\s-]/g, '').replace(/^\+?88/, '');
}

// ── Identity & tax numbers ──────────────────────────────────────────────
const digits = v => String(v || '').replace(/[\s-]/g, '');

// NID: 10 digits (smart card), 13 digits (old laminated) or 17 digits (old number with the birth year in front).
// Returns an error message, or null when the number looks right. With a date of birth, a 17-digit number
// must start with the birth year.
function nidError(nid, dateOfBirth) {
  const n = digits(nid);
  if (!n) return null;
  if (!/^(\d{10}|\d{13}|\d{17})$/.test(n)) return 'NID number must be 10, 13 or 17 digits';
  if (n.length === 17 && dateOfBirth) {
    const year = String(dateOfBirth instanceof Date ? dateOfBirth.getFullYear() : String(dateOfBirth).slice(0, 4));
    if (/^\d{4}$/.test(year) && n.slice(0, 4) !== year) return `A 17-digit NID starts with the birth year — this one starts with ${n.slice(0, 4)}, but the date of birth is in ${year}`;
  }
  return null;
}
// e-TIN: 12 digits. BIN: 9 digits, or 13 with the 4-digit branch suffix (000123456-0101).
const tinError = v => (!digits(v) || /^\d{12}$/.test(digits(v)) ? null : 'e-TIN must be 12 digits');
const binError = v => (!digits(v) || /^(\d{9}|\d{13})$/.test(digits(v)) ? null : 'BIN must be 9 digits (or 13 with the branch code)');

// ── Flat deed registration ──────────────────────────────────────────────
const DEFAULT_REGISTRATION_RATES = {
  stamp_duty_percent: 1.5,
  registration_fee_percent: 1.0,
  local_govt_tax_city_percent: 3.0,   // City Corporation / Cantonment areas
  local_govt_tax_other_percent: 2.0,
  gain_tax_53h_percent: { ZONE_A_DHAKA_CTG: 8.0, ZONE_B_OTHER_CITY: 6.0, ZONE_C_OTHER: 4.0 },
  vat_slabs: [                         // on flat price, by area (sft)
    { upto_sft: 1100, percent: 2.0 },
    { upto_sft: 1600, percent: 4.5 },
    { upto_sft: null, percent: 4.5 },
  ],
  e_mutation_fee_bdt: 1170,            // e-namjari: 20 court fee + 50 notice + 1,100 DCR
  misc_fixed_bdt: 0,                   // deed writer, nokol (certified copy), etc.
};

function mergeRates(overrides = {}) {
  const r = JSON.parse(JSON.stringify(DEFAULT_REGISTRATION_RATES));
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'gain_tax_53h_percent' && typeof v === 'object') Object.assign(r.gain_tax_53h_percent, v);
    else if (k === 'vat_slabs' && Array.isArray(v)) r.vat_slabs = v;
    else if (k in r) r[k] = Number(v);
  }
  return r;
}

function vatPercentForArea(areaSft, slabs) {
  for (const s of slabs) if (s.upto_sft == null || areaSft <= s.upto_sft) return Number(s.percent);
  return 0;
}

function computeRegistrationCost({ deed_value_bdt, mouza_rate_value_bdt, flat_area_sft, location_zone, is_city_corporation, include_vat, rates }) {
  const r = mergeRates(rates);
  const deedValue = Number(deed_value_bdt) || 0;
  // Duties are levied on the higher of declared deed value and govt. mouza value.
  const base = Math.max(deedValue, Number(mouza_rate_value_bdt) || 0);
  const area = Number(flat_area_sft) || 0;
  const zone = r.gain_tax_53h_percent[location_zone] != null ? location_zone : 'ZONE_A_DHAKA_CTG';
  const lgtPct = is_city_corporation === false || is_city_corporation === 0 || is_city_corporation === 'false'
    ? r.local_govt_tax_other_percent : r.local_govt_tax_city_percent;
  const vatPct = vatPercentForArea(area, r.vat_slabs);
  const withVat = !(include_vat === false || include_vat === 0 || include_vat === 'false');

  const lines = [
    { key: 'stamp_duty', label_en: 'Stamp Duty', label_bn: 'স্ট্যাম্প ডিউটি', percent: r.stamp_duty_percent, amount: round2(base * r.stamp_duty_percent / 100) },
    { key: 'registration_fee', label_en: 'Registration Fee', label_bn: 'রেজিস্ট্রেশন ফি', percent: r.registration_fee_percent, amount: round2(base * r.registration_fee_percent / 100) },
    { key: 'local_govt_tax', label_en: 'Local Government Tax', label_bn: 'স্থানীয় সরকার কর', percent: lgtPct, amount: round2(base * lgtPct / 100) },
    { key: 'gain_tax_53h', label_en: 'Gain Tax / AIT (Sec. 53H)', label_bn: 'উৎসে আয়কর (৫৩এইচ)', percent: r.gain_tax_53h_percent[zone], amount: round2(base * r.gain_tax_53h_percent[zone] / 100) },
  ];
  if (withVat) lines.push({ key: 'vat', label_en: `VAT on Flat (${area} sft)`, label_bn: 'ফ্ল্যাটের ভ্যাট (মূসক)', percent: vatPct, amount: round2(deedValue * vatPct / 100) });
  lines.push({ key: 'e_mutation', label_en: 'E-Mutation (Namjari) Fee', label_bn: 'ই-নামজারি ফি', percent: null, amount: round2(r.e_mutation_fee_bdt) });
  if (r.misc_fixed_bdt) lines.push({ key: 'misc', label_en: 'Deed Writer / Misc.', label_bn: 'দলিল লেখক ও অন্যান্য', percent: null, amount: round2(r.misc_fixed_bdt) });

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    assessable_value_bdt: base,
    lines,
    total_cost_bdt: total,
    effective_percent: deedValue ? round2(total / deedValue * 100) : 0,
    grand_total_with_price_bdt: round2(deedValue + total),
    rates: r,
  };
}

// ── Source tax / VDS defaults by service category ─────────────────────────
const DEFAULT_WITHHOLDING = {
  CONSTRUCTION_CONTRACT: { tds: 7.0, vds: 7.5 },
  SUPPLY_OF_GOODS: { tds: 5.0, vds: 7.5 },
  PROFESSIONAL_SERVICE: { tds: 10.0, vds: 15.0 },
  TRANSPORT: { tds: 5.0, vds: 10.0 },
  RENT: { tds: 5.0, vds: 15.0 },
  OTHER: { tds: 0, vds: 0 },
};

// no_tin_uplift_percent > 0 raises the TDS rate for a vendor without a TIN (e.g. 50 → 5% becomes 7.5%).
function computeWithholding({ gross_amount_bdt, service_category, tds_rate_percent, vds_rate_percent, no_tin_uplift_percent }) {
  const def = DEFAULT_WITHHOLDING[service_category] || DEFAULT_WITHHOLDING.OTHER;
  const gross = Number(gross_amount_bdt) || 0;
  const baseTds = tds_rate_percent === undefined || tds_rate_percent === '' ? def.tds : Number(tds_rate_percent);
  const uplift = Math.max(0, Number(no_tin_uplift_percent) || 0);
  const tdsRate = round2(baseTds * (1 + uplift / 100));
  const vdsRate = vds_rate_percent === undefined || vds_rate_percent === '' ? def.vds : Number(vds_rate_percent);
  const tds = round2(gross * tdsRate / 100);
  const vds = round2(gross * vdsRate / 100);
  return { tds_rate_percent: tdsRate, tds_amount_bdt: tds, vds_rate_percent: vdsRate, vds_amount_bdt: vds, net_payable_bdt: round2(gross - tds - vds), no_tin_uplift: uplift > 0 };
}

// ── Holding tax ──────────────────────────────────────────────────────────
function computeHoldingTax({ annual_valuation_bdt, tax_rate_percent, rebate_percent, quarters }) {
  const annual = round2((Number(annual_valuation_bdt) || 0) * (Number(tax_rate_percent) || 0) / 100);
  const net = round2(annual * (1 - (Number(rebate_percent) || 0) / 100));
  const qAmt = round2(net / 4);
  const prev = Array.isArray(quarters) ? quarters : [];
  const q = [1, 2, 3, 4].map(n => {
    const p = prev.find(x => Number(x.q) === n) || {};
    // last quarter absorbs rounding so the four add up exactly
    const amount = n === 4 ? round2(net - qAmt * 3) : qAmt;
    return { q: n, amount, paid: !!p.paid, receipt: p.receipt || null, paid_date: p.paid_date || null };
  });
  const paid = round2(q.filter(x => x.paid).reduce((s, x) => s + x.amount, 0));
  const due = round2(net - paid);
  return { annual_tax_bdt: net, paid_bdt: paid, due_bdt: due, quarters: q };
}

function holdingStatus(paid, due, fiscalYear) {
  if (due <= 0) return 'PAID';
  // FY ends 30 June of its second year; anything still due after that is overdue.
  const endYear = parseInt(String(fiscalYear).slice(0, 4), 10) + 1;
  if (!isNaN(endYear) && new Date() > new Date(`${endYear}-06-30T23:59:59`)) return 'OVERDUE';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

module.exports = {
  round2, fiscalYearOf, isValidBdMobile, normalizeBdMobile, nidError, tinError, binError,
  DEFAULT_REGISTRATION_RATES, computeRegistrationCost,
  DEFAULT_WITHHOLDING, computeWithholding,
  computeHoldingTax, holdingStatus,
};
