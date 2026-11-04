// Sample data for the Bangladesh toolkit (migration 014). Only inserts into empty tables,
// so it is safe to re-run:  npx knex seed:run --specific=007_bd_localization_seed.js
const bd = require('../utils/bd');

const isEmpty = async (knex, table) => {
  const [{ c }] = await knex(table).count({ c: '*' });
  return Number(c) === 0;
};

exports.seed = async function (knex) {
  const P = 3; // Shopno Bilash

  if (await isEmpty(knex, 'material_market_rates')) {
    const items = [
      ['ROD_60G', 'MS Rod 60 Grade (500W)', 'রড ৬০ গ্রেড', 'BSRM', 'Ton', [94500, 96000, 97500]],
      ['ROD_60G_KSRM', 'MS Rod 60 Grade (500W)', 'রড ৬০ গ্রেড', 'KSRM', 'Ton', [93000, 94500, 95500]],
      ['CEMENT_PCC', 'Portland Composite Cement', 'সিমেন্ট (পিসিসি)', 'Shah Cement', 'Bag (50kg)', [530, 540, 535]],
      ['CEMENT_OPC', 'Ordinary Portland Cement', 'সিমেন্ট (ওপিসি)', 'Crown', 'Bag (50kg)', [560, 570, 575]],
      ['BRICK_1ST', 'First Class Brick', 'প্রথম শ্রেণির ইট', 'Auto Bricks', '1000 pcs', [12500, 13000, 13500]],
      ['SAND_SYLHET', 'Sylhet Sand (FM 2.5)', 'সিলেট বালি', null, 'CFT', [58, 60, 62]],
      ['SAND_LOCAL', 'Local Filling Sand', 'লোকাল বালি', null, 'CFT', [22, 22, 24]],
      ['STONE_CHIPS', 'Stone Chips (3/4")', 'পাথর কুচি', 'Bholaganj', 'CFT', [215, 220, 210]],
    ];
    const dates = ['2026-08-01', '2026-09-15', '2026-11-01'];
    const rows = [];
    for (const [key, en, bn, brand, uom, rates] of items) {
      rates.forEach((r, i) => rows.push({ material_key: key, material_name_en: en, material_name_bn: bn, brand, uom, rate_bdt: r, market_location: 'Dhaka (Tejgaon / Kawran Bazar)', rate_date: dates[i], source: 'Site purchase quotes' }));
    }
    await knex('material_market_rates').insert(rows);
  }

  if (await isEmpty(knex, 'bd_work_calendar')) {
    // Lunar holiday dates are approximate and depend on moon sighting — adjust when the
    // government publishes the official holiday list.
    await knex('bd_work_calendar').insert([
      { start_date: '2026-02-21', end_date: '2026-02-21', title_en: 'Shaheed Day & International Mother Language Day', title_bn: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-03-19', end_date: '2026-03-23', title_en: 'Eid-ul-Fitr Holidays (approx.)', title_bn: 'ঈদুল ফিতরের ছুটি', event_type: 'RELIGIOUS_FESTIVAL', work_impact: 'FULL_STOP', festival_bonus_due: true, bonus_amount_per_worker_bdt: 3000 },
      { start_date: '2026-03-26', end_date: '2026-03-26', title_en: 'Independence & National Day', title_bn: 'স্বাধীনতা ও জাতীয় দিবস', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-04-14', end_date: '2026-04-14', title_en: 'Pohela Boishakh (Bangla New Year)', title_bn: 'পহেলা বৈশাখ', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-05-01', end_date: '2026-05-01', title_en: 'May Day', title_bn: 'মে দিবস', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-05-25', end_date: '2026-05-30', title_en: 'Eid-ul-Adha Holidays (approx.)', title_bn: 'ঈদুল আজহার ছুটি', event_type: 'RELIGIOUS_FESTIVAL', work_impact: 'FULL_STOP', festival_bonus_due: true, bonus_amount_per_worker_bdt: 3000 },
      { start_date: '2026-07-06', end_date: '2026-07-10', title_en: 'Heavy monsoon rain — casting suspended', title_bn: 'ভারী বর্ষণ — ঢালাই বন্ধ', event_type: 'WEATHER_MONSOON', work_impact: 'PARTIAL', notes: 'Roof slab casting rescheduled; indoor brickwork continued.' },
      { start_date: '2026-08-05', end_date: '2026-08-05', title_en: 'July Mass Uprising Day', title_bn: 'জুলাই গণঅভ্যুত্থান দিবস', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-10-20', end_date: '2026-10-20', title_en: 'Durga Puja (Bijoya Dashami)', title_bn: 'দুর্গাপূজা (বিজয়া দশমী)', event_type: 'RELIGIOUS_FESTIVAL', work_impact: 'FULL_STOP' },
      { start_date: '2026-12-16', end_date: '2026-12-16', title_en: 'Victory Day', title_bn: 'বিজয় দিবস', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2026-12-25', end_date: '2026-12-25', title_en: 'Christmas Day', title_bn: 'বড়দিন', event_type: 'PUBLIC_HOLIDAY', work_impact: 'FULL_STOP' },
      { start_date: '2027-03-09', end_date: '2027-03-13', title_en: 'Eid-ul-Fitr Holidays 2027 (approx.)', title_bn: 'ঈদুল ফিতরের ছুটি ২০২৭', event_type: 'RELIGIOUS_FESTIVAL', work_impact: 'FULL_STOP', festival_bonus_due: true, bonus_amount_per_worker_bdt: 3500 },
    ]);
  }

  if (await isEmpty(knex, 'flat_registration_estimates')) {
    const mk = (unit, idUnit, buyer, area, price, status) => {
      const calc = bd.computeRegistrationCost({ deed_value_bdt: price, flat_area_sft: area, location_zone: 'ZONE_A_DHAKA_CTG', is_city_corporation: true, include_vat: true });
      return {
        id_projects: P, id_units: idUnit, unit_number: unit, buyer_name: buyer, flat_area_sft: area, deed_value_bdt: price,
        mouza_rate_value_bdt: Math.round(price * 0.8), location_zone: 'ZONE_A_DHAKA_CTG', is_city_corporation: true, include_vat: true,
        rates_json: JSON.stringify(calc.rates), breakdown_json: JSON.stringify(calc.lines), total_cost_bdt: calc.total_cost_bdt,
        sub_registry_office: 'Uttara Sub-Registry Office', status,
      };
    };
    await knex('flat_registration_estimates').insert([
      mk('A-201', 53, 'Engr. Kazi Tariqul Islam', 1420, 9230000, 'PAY_ORDER_READY'),
      mk('A-102', 50, 'Flat Owner (A-102)', 1380, 8970000, 'ESTIMATE'),
    ]);
  }

  if (await isEmpty(knex, 'mfs_transactions')) {
    await knex('mfs_transactions').insert([
      { id_projects: P, provider: 'BKASH', trx_id: 'BKA7X9Q2LM', direction: 'RECEIVED', purpose: 'SERVICE_CHARGE', counterparty_name: 'Engr. Kazi Tariqul Islam', counterparty_wallet: '01711122334', our_wallet: '01810000003', unit_number: 'A-201', amount_bdt: 4500, fee_bdt: 67.5, net_amount_bdt: 4432.5, trx_datetime: '2026-10-05 10:24:00', status: 'VERIFIED', verified_by: 'Accounts', verified_at: '2026-10-05 15:00:00' },
      { id_projects: P, provider: 'NAGAD', trx_id: '7HG4K2PQ', direction: 'RECEIVED', purpose: 'INSTALLMENT', counterparty_name: 'Flat Owner (A-102)', counterparty_wallet: '01700000106', our_wallet: '01810000003', unit_number: 'A-102', amount_bdt: 25000, fee_bdt: 0, net_amount_bdt: 25000, trx_datetime: '2026-10-28 19:02:00', status: 'PENDING_VERIFY' },
      { id_projects: P, provider: 'ROCKET', trx_id: 'RKT55120933', direction: 'RECEIVED', purpose: 'UTILITY_BILL', counterparty_name: 'Flat Owner (A-103)', counterparty_wallet: '01700000107', unit_number: 'A-103', amount_bdt: 1850, fee_bdt: 0, net_amount_bdt: 1850, trx_datetime: '2026-11-01 08:40:00', status: 'PENDING_VERIFY' },
      { id_projects: P, provider: 'BKASH', trx_id: 'BKS3M1W8ZT', direction: 'SENT', purpose: 'LABOUR_WAGE', counterparty_name: 'Md. Rahim (Head Mistry)', counterparty_wallet: '01912345678', our_wallet: '01810000003', amount_bdt: 7000, fee_bdt: 0, net_amount_bdt: 7000, trx_datetime: '2026-10-29 17:30:00', status: 'VERIFIED', verified_by: 'Site Manager', verified_at: '2026-10-29 18:00:00' },
    ]);
  }

  if (await isEmpty(knex, 'tax_withholding_register')) {
    const mk = (vendor, bin, cat, gross, date, extra = {}) => ({
      id_projects: P, vendor_name: vendor, vendor_bin: bin, bill_no: extra.bill_no || null, bill_date: date,
      fiscal_year: bd.fiscalYearOf(date), service_category: cat, gross_amount_bdt: gross,
      ...bd.computeWithholding({ gross_amount_bdt: gross, service_category: cat }), status: 'DEDUCTED', ...extra,
    });
    await knex('tax_withholding_register').insert([
      mk('BSRM Steels Ltd', '000123456-0101', 'SUPPLY_OF_GOODS', 1950000, '2026-09-12', { bill_no: 'BSRM/INV/88231', status: 'CERTIFICATE_ISSUED', tds_challan_no: 'TC-2026-11821', vds_challan_no: 'VC-2026-11822', challan_date: '2026-09-25', mushak_6_6_no: 'M66-2026-0412' }),
      mk('Shah Cement Industries Ltd', '000234567-0202', 'SUPPLY_OF_GOODS', 1080000, '2026-10-08', { bill_no: 'SCI-30122', status: 'DEPOSITED_TREASURY', tds_challan_no: 'TC-2026-12960', vds_challan_no: 'VC-2026-12961', challan_date: '2026-10-20' }),
      mk('Rahman Civil Works (Contractor)', '000345678-0303', 'CONSTRUCTION_CONTRACT', 2400000, '2026-10-30', { bill_no: 'RA-BILL-07' }),
    ]);
  }

  if (await isEmpty(knex, 'holding_tax_register')) {
    const fy = '2026-27';
    const mk = (unit, idUnit, owner, holding, valuation, paidQs) => {
      const calc = bd.computeHoldingTax({ annual_valuation_bdt: valuation, tax_rate_percent: 12, rebate_percent: 0, quarters: paidQs.map(q => ({ q, paid: true, receipt: `DNCC-${unit}-Q${q}`, paid_date: '2026-09-20' })) });
      return {
        id_projects: P, id_units: idUnit, unit_number: unit, owner_name: owner, authority: 'DNCC', holding_no: holding, ward_no: '01',
        fiscal_year: fy, annual_valuation_bdt: valuation, tax_rate_percent: 12, rebate_percent: 0,
        annual_tax_bdt: calc.annual_tax_bdt, paid_bdt: calc.paid_bdt, due_bdt: calc.due_bdt, quarters_json: JSON.stringify(calc.quarters),
        status: bd.holdingStatus(calc.paid_bdt, calc.due_bdt, fy),
      };
    };
    await knex('holding_tax_register').insert([
      mk('A-201', 53, 'Engr. Kazi Tariqul Islam', 'DNCC-01-0457/A-201', 216000, [1, 2]),
      mk('A-102', 50, 'Flat Owner (A-102)', 'DNCC-01-0457/A-102', 198000, [1]),
      mk('A-103', 51, 'Flat Owner (A-103)', 'DNCC-01-0457/A-103', 192000, []),
    ]);
  }
};
