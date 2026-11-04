exports.seed = async function(knex) {
  // 1. Common Facilities
  const countFac = await knex('master_common_facilities').count('id_common_facilities as cnt');
  if (countFac[0].cnt === 0 || countFac[0].cnt === '0') {
    await knex('master_common_facilities').insert([
      {
        facility_code: 'FAC-MOSQUE-01',
        facility_name: 'Central Jam-e Masjid (মসজিদ কমপ্লেক্স)',
        category: 'WORSHIP',
        capacity: '350 Musallis',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 25000.00,
        allocated_unit_number: 'A-101 (Padma Tower)',
        description: 'Centrally air-conditioned prayer hall with dedicated wudu khana and Quran library.'
      },
      {
        facility_code: 'FAC-COMM-02',
        facility_name: 'Community & Meeting Hall (কমিউনিটি হল)',
        category: 'COMMUNITY',
        capacity: '120 Persons',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 15000.00,
        allocated_unit_number: 'B-101 (Meghna Tower)',
        description: 'Multi-purpose air-conditioned event room for AGM, Eid gatherings, and resident meetings.'
      },
      {
        facility_code: 'FAC-POOL-03',
        facility_name: 'Rooftop Infinity Swimming Pool (সুইমিং পুল)',
        category: 'WELLNESS',
        capacity: '40 Bathers',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 35000.00,
        allocated_unit_number: 'C-101 (Jamuna Tower)',
        description: 'Ozone filtration swimming pool with separate kids wading pool and sun deck.'
      },
      {
        facility_code: 'FAC-SUBST-04',
        facility_name: 'Electrical Substation & Generator Room (সাবস্টেশন)',
        category: 'INFRASTRUCTURE',
        capacity: '1250 kVA Transformer + 500 kVA Cummins DG',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 45000.00,
        allocated_unit_number: 'Basement-1 Shared',
        description: 'Heavy power room housing HT switchgear, transformer, AVR, and acoustic generator sets.'
      },
      {
        facility_code: 'FAC-SKYWALK-05',
        facility_name: 'Tri-Tower Interconnection Skywalk Bridges (স্কাইওয়াক)',
        category: 'INFRASTRUCTURE',
        capacity: 'Continuous Pedestrian Flow',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 8000.00,
        allocated_unit_number: 'Level-5 & Level-8 Links',
        description: 'Structural steel cantilever skybridges interconnecting Padma, Meghna, and Jamuna Towers for fire egress and inter-building transit.'
      },
      {
        facility_code: 'FAC-GYM-06',
        facility_name: 'Modern Fitness Center & Gymnasium (জিমনেসিয়াম)',
        category: 'WELLNESS',
        capacity: '35 Persons',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 18000.00,
        allocated_unit_number: 'Padma Level-2 Common',
        description: 'Equipped with cardio machines, free weights, steam shower, and rubberized gym flooring.'
      },
      {
        facility_code: 'FAC-CARE-07',
        facility_name: 'Caretaker & Security Control Suite (কেয়ারটেকার অফিস)',
        category: 'SECURITY',
        capacity: '10 Personnel',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 12000.00,
        allocated_unit_number: 'Ground Floor Gatehouse',
        description: '24/7 CCTV surveillance server room, security muster post, and estate manager workstation.'
      },
      {
        facility_code: 'FAC-ROOF-08',
        facility_name: 'Lush Rooftop Garden & Walking Track (ছাদ বাগান)',
        category: 'RECREATION_COMMUNITY',
        capacity: '150 Persons',
        default_cost_share_rule: 'EQUAL_ALL_SHARES',
        maintenance_monthly_budget_bdt: 12000.00,
        allocated_unit_number: 'Rooftop All Towers',
        description: 'Landscaped rooftop garden with pergolas, seating benches, and non-slip jogging track.'
      }
    ]);
  }

  // 2. Labour Trades & Wages
  const countTrades = await knex('master_labour_trades').count('id_labour_trades as cnt');
  if (countTrades[0].cnt === 0 || countTrades[0].cnt === '0') {
    await knex('master_labour_trades').insert([
      {
        trade_code: 'TRD-MASON-HEAD',
        trade_name_en: 'Head Mason (হেড রাজমিস্ত্রি)',
        trade_name_bn: 'প্রধান রাজমিস্ত্রি',
        standard_daily_wage_bdt: 1100.00,
        overtime_rate_per_hour_bdt: 160.00,
        skill_level: 'HEAD_MISTRY'
      },
      {
        trade_code: 'TRD-MASON-GEN',
        trade_name_en: 'Brick & Plaster Mason (রাজমিস্ত্রি)',
        trade_name_bn: 'সাধারণ রাজমিস্ত্রি',
        standard_daily_wage_bdt: 900.00,
        overtime_rate_per_hour_bdt: 130.00,
        skill_level: 'SKILLED'
      },
      {
        trade_code: 'TRD-ROD-BINDER',
        trade_name_en: 'Steel Rebar Binder (রড বাইন্ডার)',
        trade_name_bn: 'রড মিস্ত্রি',
        standard_daily_wage_bdt: 950.00,
        overtime_rate_per_hour_bdt: 140.00,
        skill_level: 'SKILLED'
      },
      {
        trade_code: 'TRD-SHUTTER-CARP',
        trade_name_en: 'Formwork / Shuttering Carpenter (শাটারিং মিস্ত্রি)',
        trade_name_bn: 'শাটারিং মিস্ত্রি',
        standard_daily_wage_bdt: 950.00,
        overtime_rate_per_hour_bdt: 140.00,
        skill_level: 'SKILLED'
      },
      {
        trade_code: 'TRD-ELECTRICIAN',
        trade_name_en: 'Licensed Electrician (ইলেকট্রিশিয়ান)',
        trade_name_bn: 'ইলেকট্রিশিয়ান',
        standard_daily_wage_bdt: 1000.00,
        overtime_rate_per_hour_bdt: 150.00,
        skill_level: 'SKILLED'
      },
      {
        trade_code: 'TRD-PLUMBER',
        trade_name_en: 'Sanitary & Pipe Plumber (প্লাম্বার)',
        trade_name_bn: 'প্লাম্বার মিস্ত্রি',
        standard_daily_wage_bdt: 950.00,
        overtime_rate_per_hour_bdt: 140.00,
        skill_level: 'SKILLED'
      },
      {
        trade_code: 'TRD-HELPER-JOGALI',
        trade_name_en: 'Construction Helper / Jogali (যোগালী / হেল্পার)',
        trade_name_bn: 'নির্মাণ সহকারী (যোগালী)',
        standard_daily_wage_bdt: 650.00,
        overtime_rate_per_hour_bdt: 90.00,
        skill_level: 'HELPER_JOGALI'
      }
    ]);
  }

  // 3. Utility Services & Tariffs
  const countUtil = await knex('master_utility_services').count('id_utility_services as cnt');
  if (countUtil[0].cnt === 0 || countUtil[0].cnt === '0') {
    await knex('master_utility_services').insert([
      {
        service_code: 'UTIL-DESCO-GRID',
        service_name: 'DESCO / DPDC 3-Phase Grid Electricity',
        provider_authority: 'DESCO / DPDC',
        uom: 'kWh (Unit)',
        standard_unit_rate_bdt: 10.50,
        monthly_demand_charge_bdt: 200.00,
        connection_type: 'LT Commercial / Residential 400V'
      },
      {
        service_code: 'UTIL-WASA-WATER',
        service_name: 'Dhaka WASA Piped Water & Sewerage',
        provider_authority: 'Dhaka WASA',
        uom: '1000 Litres (1 Kilo-Litre)',
        standard_unit_rate_bdt: 16.70,
        monthly_demand_charge_bdt: 500.00,
        connection_type: '2-inch Deep Tube Piped Connection'
      },
      {
        service_code: 'UTIL-LPG-RETIC',
        service_name: 'Central Reticulated LPG Gas Supply',
        provider_authority: 'Bashundhara / Jamuna LPG Reticulation',
        uom: 'Cubic Meter (m³)',
        standard_unit_rate_bdt: 120.00,
        monthly_demand_charge_bdt: 150.00,
        connection_type: 'Manifold Cylinder Bank with Gas Flow Meter'
      },
      {
        service_code: 'UTIL-GEN-BACKUP',
        service_name: 'Standby Diesel Generator Emergency Power',
        provider_authority: 'Internal Cummins 500kVA DG',
        uom: 'Diesel Run Hour',
        standard_unit_rate_bdt: 38.00,
        monthly_demand_charge_bdt: 300.00,
        connection_type: 'Automatic Transfer Switch (ATS) 100% Backup'
      }
    ]);
  }

  // 4. Service Charge Heads
  const countCharges = await knex('master_service_charge_heads').count('id_charge_heads as cnt');
  if (countCharges[0].cnt === 0 || countCharges[0].cnt === '0') {
    await knex('master_service_charge_heads').insert([
      {
        head_code: 'CHG-SECURITY',
        head_name_en: '24/7 Security Guards & CCTV Surveillance',
        head_name_bn: 'নিরাপত্তা প্রহরী ও সিসিটিভি রক্ষণাবেক্ষণ',
        calculation_basis: 'FLAT_EQUAL',
        default_rate_bdt: 1200.00,
        frequency: 'Monthly (মাসিক)'
      },
      {
        head_code: 'CHG-CLEANING',
        head_name_en: 'Common Stairs, Corridors & Garbage Collection',
        head_name_bn: 'কমন স্পেস পরিচ্ছন্নতা ও বর্জ্য অপসারণ',
        calculation_basis: 'FLAT_EQUAL',
        default_rate_bdt: 600.00,
        frequency: 'Monthly (মাসিক)'
      },
      {
        head_code: 'CHG-LIFT-AMC',
        head_name_en: 'Passenger & Stretcher Lift AMC Maintenance',
        head_name_bn: 'লিফট অ্যানুয়াল মেইনটেন্যান্স (AMC)',
        calculation_basis: 'FLAT_EQUAL',
        default_rate_bdt: 800.00,
        frequency: 'Monthly (মাসিক)'
      },
      {
        head_code: 'CHG-GEN-FUEL',
        head_name_en: 'Generator Diesel Fuel & Filter Service',
        head_name_bn: 'জেনারেটর ডিজেল জ্বালানী ও সার্ভিসিং',
        calculation_basis: 'FLAT_EQUAL',
        default_rate_bdt: 1000.00,
        frequency: 'Monthly (মাসিক)'
      },
      {
        head_code: 'CHG-COMMON-POWER',
        head_name_en: 'Common Area & Substation Electricity Bill',
        head_name_bn: 'কমন করিডোর ও পাম্পের বিদ্যুৎ বিল',
        calculation_basis: 'FLAT_EQUAL',
        default_rate_bdt: 900.00,
        frequency: 'Monthly (মাসিক)'
      },
      {
        head_code: 'CHG-RESERVE-FUND',
        head_name_en: 'Building Sinking / Capital Reserve Fund',
        head_name_bn: 'জরুরী মেরামত ও রিজার্ভ ফান্ড',
        calculation_basis: 'SFT_PROPORTIONAL',
        default_rate_bdt: 1.50,
        frequency: 'Monthly (মাসিক ৳১.৫০/বর্গফুট)'
      }
    ]);
  }

  // 5. Bank Accounts
  const countBank = await knex('master_bank_accounts').count('id_bank_accounts as cnt');
  if (countBank[0].cnt === 0 || countBank[0].cnt === '0') {
    await knex('master_bank_accounts').insert([
      {
        account_code: 'BANK-DBBL-CD-01',
        bank_name: 'Dutch-Bangla Bank PLC (DBBL)',
        branch_name: 'Uttara Model Town Branch, Sector 3',
        account_title: 'Shopno Bilash Construction Master Account',
        account_number: '124.110.0049281',
        routing_number: '090264281',
        account_type: 'CURRENT',
        opening_balance_bdt: 5000000.00,
        current_balance_bdt: 18450000.00
      },
      {
        account_code: 'BANK-IBBL-SND-02',
        bank_name: 'Islami Bank Bangladesh PLC (IBBL)',
        branch_name: 'Mirpur-10 Branch, Dhaka',
        account_title: 'Shopno Bilash Society Escrow Reserve',
        account_number: '2050.218.0100.9934',
        routing_number: '125272993',
        account_type: 'ESCROW_JVA',
        opening_balance_bdt: 2000000.00,
        current_balance_bdt: 8750000.00
      },
      {
        account_code: 'BANK-BRAC-COL-03',
        bank_name: 'BRAC Bank PLC',
        branch_name: 'Gulshan-1 Branch, Dhaka',
        account_title: 'Shopno Bilash Flat Owners Collection A/C',
        account_number: '1501.2045.9812.001',
        routing_number: '060261981',
        account_type: 'SOCIETY_COLLECTION',
        opening_balance_bdt: 1000000.00,
        current_balance_bdt: 6320000.00
      },
      {
        account_code: 'BANK-CITY-PAY-04',
        bank_name: 'The City Bank PLC',
        branch_name: 'Banani Branch, Dhaka',
        account_title: 'Shopno Bilash Vendor Procurement Disbursement',
        account_number: '3101.4589.62001',
        routing_number: '225261458',
        account_type: 'CURRENT',
        opening_balance_bdt: 500000.00,
        current_balance_bdt: 4120000.00
      },
      {
        account_code: 'MFS-BKASH-MERCHANT',
        bank_name: 'bKash Merchant Account (বিকাশ মার্চেন্ট)',
        branch_name: 'Dhaka Digital Headquarters',
        account_title: 'Shopno Bilash Maintenance & Service Charge',
        account_number: '01713998822',
        routing_number: 'N/A',
        account_type: 'SOCIETY_COLLECTION',
        opening_balance_bdt: 50000.00,
        current_balance_bdt: 385000.00
      }
    ]);
  }

  // 6. Tax & VAT Rules
  const countTax = await knex('master_tax_rules').count('id_tax_rules as cnt');
  if (countTax[0].cnt === 0 || countTax[0].cnt === '0') {
    await knex('master_tax_rules').insert([
      {
        rule_code: 'TAX-VAT-APART-7.5',
        tax_name: 'VAT on Residential Flat Sale (মূল্য সংযোজন কর - মূসক)',
        tax_type: 'VAT_MUSHAK',
        tax_rate_percent: 7.50,
        is_withholding_mandatory: true,
        minimum_threshold_bdt: 0.00,
        nbr_statutory_reference: 'NBR SRO 186-AIN/2021/147-Mushak: Real Estate Development Flat Sales VAT rate 7.5% up to 1600 SFT.'
      },
      {
        rule_code: 'TAX-AIT-FLAT-5',
        tax_name: 'Advance Income Tax on Flat Registration (AIT)',
        tax_type: 'AIT_INCOME_TAX',
        tax_rate_percent: 5.00,
        is_withholding_mandatory: true,
        minimum_threshold_bdt: 0.00,
        nbr_statutory_reference: 'Income Tax Act 2023 Section 125: Advance tax on transfer of property/apartment at sub-registrar.'
      },
      {
        rule_code: 'TAX-STAMP-DUTY-1.5',
        tax_name: 'Deed Registration Stamp Duty (স্ট্যাম্প ডিউটি)',
        tax_type: 'STAMP_DUTY',
        tax_rate_percent: 1.50,
        is_withholding_mandatory: true,
        minimum_threshold_bdt: 0.00,
        nbr_statutory_reference: 'Stamp Act 1899 & Bangladesh Finance Act: 1.5% Stamp duty on declared deed value.'
      },
      {
        rule_code: 'TAX-LGT-2.0',
        tax_name: 'Local Government Tax / City Corporation Transfer Tax',
        tax_type: 'HOLDING_TAX',
        tax_rate_percent: 2.00,
        is_withholding_mandatory: true,
        minimum_threshold_bdt: 0.00,
        nbr_statutory_reference: 'Dhaka North City Corporation (DNCC) 2% local authority transfer fee.'
      },
      {
        rule_code: 'TAX-VDS-PROCURE-7.5',
        tax_name: 'VDS Withholding on Construction Procurement (উৎস কর্তন মূসক)',
        tax_type: 'VAT_MUSHAK',
        tax_rate_percent: 7.50,
        is_withholding_mandatory: true,
        minimum_threshold_bdt: 25000.00,
        nbr_statutory_reference: 'NBR VAT Withholding Rules 2020: 7.5% deduction at source on construction contractor bills.'
      }
    ]);
  }

  // 7. Handover Snag & Defect Inspection Categories
  const countSnag = await knex('master_snag_categories').count('id_snag_cat as cnt');
  if (countSnag[0].cnt === 0 || countSnag[0].cnt === '0') {
    await knex('master_snag_categories').insert([
      {
        category_code: 'SNAG-CARPENTRY',
        category_name_en: 'Door, Shutter, Frame & Lock Fitment',
        category_name_bn: 'দরজা, ফ্রেম ও লক ত্রুটি',
        default_remedy_sla_days: '5 Days',
        trade_responsible: 'Solid Wood Carpentry Vendor'
      },
      {
        category_code: 'SNAG-TILE-GROUT',
        category_name_en: 'Floor Tiles, Hollow Sound & Grout Joint Finishing',
        category_name_bn: 'মেঝের টাইলস ও গ্রাউটিং ত্রুটি',
        default_remedy_sla_days: '7 Days',
        trade_responsible: 'RAK Ceramics Finishing Contractor'
      },
      {
        category_code: 'SNAG-SANITARY',
        category_name_en: 'CP Fitting, Basin Leakage, Commode Flushing & Traps',
        category_name_bn: 'স্যানিটারি ফিটিংস ও পাইপলাইন লিকেজ',
        default_remedy_sla_days: '3 Days',
        trade_responsible: 'Sanitary Plumbing Contractor'
      },
      {
        category_code: 'SNAG-ELECTRICAL',
        category_name_en: 'Circuit Breaker Trip, Earthing Check, Switch Alignment',
        category_name_bn: 'সুইচ-সকেট ও আর্থিং ত্রুটি',
        default_remedy_sla_days: '2 Days',
        trade_responsible: 'BBS Cables / Electrical Contractor'
      },
      {
        category_code: 'SNAG-ALUMINIUM',
        category_name_en: 'Thai Sliding Window Smoothness, Weather Seal & Glass Tint',
        category_name_bn: 'থাই গ্লাস ও অ্যালুমিনিয়াম স্লাইডিং ত্রুটি',
        default_remedy_sla_days: '5 Days',
        trade_responsible: 'Chittagong Aluminium Contractor'
      },
      {
        category_code: 'SNAG-PAINT-COAT',
        category_name_en: 'Wall Putty Flaking, Damp Seepage & Final Plastic Coat',
        category_name_bn: 'রং, ড্যাম্প ও পুটি ফিনিশিং ত্রুটি',
        default_remedy_sla_days: '7 Days',
        trade_responsible: 'Berger Paints Master Applicator'
      }
    ]);
  }
};
