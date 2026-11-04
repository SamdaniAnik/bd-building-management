// Master list of collection items (particulars) with default amounts, used on receipts / Mushak-6.3.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('master_receipt_items')) return;
  await knex.schema.createTable('master_receipt_items', t => {
    t.increments('id_receipt_items').primary();
    t.string('item_code', 50).notNullable().unique();
    t.string('item_name_en', 200).notNullable();
    t.string('item_name_bn', 200).nullable();
    t.enum('category', ['FLAT_SALE', 'INSTALLMENT', 'SERVICE_CHARGE', 'UTILITY', 'PARKING', 'TRANSFER_FEE', 'PENALTY', 'OTHER']).defaultTo('OTHER');
    t.string('uom', 30).defaultTo('');
    t.decimal('default_amount_bdt', 14, 2).defaultTo(0); // 0 = enter amount each time
    t.decimal('vat_rate', 6, 2).defaultTo(0);
    t.decimal('sd_rate', 6, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.integer('sort_order').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex('master_receipt_items').insert([
    { item_code: 'RI-BOOKING', item_name_en: 'Booking money', item_name_bn: 'বুকিং মানি', category: 'FLAT_SALE', default_amount_bdt: 500000, sort_order: 1 },
    { item_code: 'RI-DOWNPAY', item_name_en: 'Down payment', item_name_bn: 'ডাউন পেমেন্ট', category: 'FLAT_SALE', default_amount_bdt: 0, sort_order: 2 },
    { item_code: 'RI-INSTALLMENT', item_name_en: 'Construction instalment', item_name_bn: 'নির্মাণ কিস্তি', category: 'INSTALLMENT', default_amount_bdt: 0, sort_order: 3 },
    { item_code: 'RI-SERVICE', item_name_en: 'Monthly service charge', item_name_bn: 'মাসিক সার্ভিস চার্জ', category: 'SERVICE_CHARGE', uom: 'Month', default_amount_bdt: 3000, sort_order: 4 },
    { item_code: 'RI-PARKING', item_name_en: 'Car parking allotment', item_name_bn: 'কার পার্কিং বরাদ্দ', category: 'PARKING', default_amount_bdt: 350000, sort_order: 5 },
    { item_code: 'RI-UTILITY', item_name_en: 'Utility connection charge (gas / electricity / WASA)', item_name_bn: 'ইউটিলিটি সংযোগ চার্জ (গ্যাস / বিদ্যুৎ / ওয়াসা)', category: 'UTILITY', default_amount_bdt: 0, sort_order: 6 },
    { item_code: 'RI-TRANSFER', item_name_en: 'Flat transfer / name change fee', item_name_bn: 'ফ্ল্যাট হস্তান্তর / নাম পরিবর্তন ফি', category: 'TRANSFER_FEE', default_amount_bdt: 25000, sort_order: 7 },
    { item_code: 'RI-RESERVE', item_name_en: 'Reserve / sinking fund contribution', item_name_bn: 'রিজার্ভ ফান্ড চাঁদা', category: 'OTHER', default_amount_bdt: 0, sort_order: 8 },
    { item_code: 'RI-LATEFINE', item_name_en: 'Late payment fine', item_name_bn: 'বিলম্ব জরিমানা', category: 'PENALTY', default_amount_bdt: 0, sort_order: 9 },
  ]);
};
exports.down = async function (knex) { await knex.schema.dropTableIfExists('master_receipt_items'); };
