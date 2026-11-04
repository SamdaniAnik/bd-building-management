exports.seed = async function(knex) {
  const project = await knex('projects').where({ project_code: 'SHOPNO-BILASH-108' }).first() || await knex('projects').first();
  const projectId = project ? project.id_projects : 3;

  // 1. Land Parcels & Multi-Landowner Ownership
  await knex('land_parcels').where({ id_projects: projectId }).del();
  await knex('land_parcels').insert({
    id_projects: projectId,
    mouza: 'Baunia (বাউনিয়া)',
    jl_no: 'J.L. 12',
    cs_khatian: '104',
    sa_khatian: '210',
    rs_khatian: '512',
    bs_khatian: '1204',
    dag_no: 'CS/SA 4521, RS/BS 8892, 8893',
    area_katha: 22.50,
    area_decimal: 37.19,
    area_sqft: 16200.00, // 22.50 * 720
    land_type: 'Nal & Viti Commercial/Residential (নাল ও ভিটি)',
    district: 'Dhaka (ঢাকা)',
    upazila: 'Uttara Thana (উত্তরা)',
    deed_no: 'DEED-11092/2021',
    deed_date: '2021-04-18',
    previous_owner: 'Late Alhaj Shamsul Huda Heir Group',
    mutation_khatian_no: 'DCR-MUT-88902',
    mutation_status: 'APPROVED',
    khajna_tax_status: 'PAID_UP_TO_DATE',
    khajna_last_paid_year: '1431-32 BS (2025-26)',
    mortgage_status: 'UNENCUMBERED',
    landowners_json: JSON.stringify([
      { name: 'Alhaj Abdur Rahman', nid: 'NID-1965-001', share_percent: 40.00, katha: 9.00, phone: '+8801711000001' },
      { name: 'Mr. Kabir Hossain', nid: 'NID-1972-002', share_percent: 30.00, katha: 6.75, phone: '+8801819000002' },
      { name: 'Mrs. Nasreen Sultana', nid: 'NID-1980-003', share_percent: 30.00, katha: 6.75, phone: '+8801912000003' }
    ]),
    notes: 'Mutation & DCR clearance verified by AC Land Office Uttara Revenue Circle. All Land Development Taxes paid up to 1432 BS.'
  });

  // 2. Joint Venture Agreement (JVA) with Landowners
  await knex('joint_venture_agreements').where({ id_projects: projectId }).del();
  await knex('joint_venture_agreements').insert({
    id_projects: projectId,
    agreement_no: 'JVA-SB-2024-UTTARA-01',
    agreement_date: '2024-03-15',
    developer_entity_name: 'Shopno Bilash Co-Ownership Development Consortium',
    landowner_share_percent: 50.00,
    developer_share_percent: 50.00,
    signing_money_bdt: 15000000.00, // ৳1.5 Crore Non-refundable Signing Money
    construction_start_deadline: '2025-01-01',
    handover_deadline: '2027-12-31',
    delay_penalty_per_month_bdt: 75000.00,
    sub_registry_office: 'Uttara Sub-Registry Office, Dhaka',
    status: 'REGISTERED',
    flat_allocation_matrix: JSON.stringify([
      { floor_range: 'Floors 1, 3, 5, 7, 9', assigned_to: 'LANDOWNERS_GROUP (54 Flats)' },
      { floor_range: 'Floors 2, 4, 6, 8 + Penthouses', assigned_to: 'DEVELOPER_POOL_MEMBERS (54 Flats)' }
    ]),
    parking_allocation_matrix: JSON.stringify([
      { basement: 'Basement 1', total_slots: 54, allocated_to: 'Landowners' },
      { basement: 'Basement 2', total_slots: 54, allocated_to: 'Co-Owners & Developer' }
    ]),
    terms_and_conditions: 'Executed in compliance with Real Estate Development and Management Act 2010 (রিয়েল এস্টেট উন্নয়ন ও ব্যবস্থাপনা আইন, ২০১০). Written registered agreement with irrevocable general power of attorney.'
  });

  // 3. Authority Approvals & NOC Checklist
  await knex('authority_approvals').where({ id_projects: projectId }).del();
  await knex('authority_approvals').insert([
    {
      id_projects: projectId,
      authority: 'RAJUK',
      approval_title: 'RAJUK Large & Special Project Permit (রাজউক বিশেষ প্রকল্প ও নগর পরিকল্পনা ছাড়পত্র)',
      approval_type: 'LAND_USE_AND_PLANNING',
      application_number: 'RAJUK-EPMS-2024-8890',
      application_date: '2024-05-10',
      approval_date: '2024-08-22',
      expiry_date: '2027-08-21',
      approval_reference_no: '25.39.0000.112.44.2024.551',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'CS, SA, RS, BS Khatian & DCR', status: 'VERIFIED_APPROVED' },
        { doc: 'Mouza Map with Trace Map', status: 'VERIFIED_APPROVED' },
        { doc: 'Traffic Impact Assessment (TIA)', status: 'VERIFIED_APPROVED' },
        { doc: 'Environment Clearance from DoE', status: 'VERIFIED_APPROVED' }
      ]),
      remarks: 'Sanctioned for 3 inter-connected towers of 9 storeys with FAR 4.25 and 35% mandatory ground greenery.'
    },
    {
      id_projects: projectId,
      authority: 'RAJUK',
      approval_title: 'Building Plan Architectural & Structural Approval (নকশা অনুমোদনপত্র)',
      approval_type: 'BUILDING_PLAN',
      application_number: 'RAJUK-BP-2024-11024',
      application_date: '2024-09-01',
      approval_date: '2024-11-15',
      expiry_date: '2027-11-14',
      approval_reference_no: 'RAJUK/BC-Uttara/11024/2024',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'IAB Registered Architect Drawings', status: 'APPROVED' },
        { doc: 'IEB Structural Design & Soil Test', status: 'APPROVED' },
        { doc: 'Plumbing & Electrical Substation Layout', status: 'APPROVED' }
      ]),
      remarks: 'BNBC 2020 seismic zone 2 & fire separation compliance certified.'
    },
    {
      id_projects: projectId,
      authority: 'FIRE_SERVICE',
      approval_title: 'Fire Service & Civil Defence NOC (ফায়ার সার্ভিস ও সিভিল ডিফেন্স অনাপত্তিপত্র)',
      approval_type: 'FIRE_SAFETY_NOC',
      application_number: 'FSCD-HQ-2024-6632',
      application_date: '2024-07-15',
      approval_date: '2024-10-05',
      expiry_date: '2025-10-04',
      approval_reference_no: 'FSCD/NOC/2024/9912',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'Dual Emergency Staircase Layout', status: 'APPROVED' },
        { doc: 'Underground 15,000 Gallon Dedicated Fire Tank', status: 'APPROVED' },
        { doc: '750 GPM Diesel Fire Pump Specifications', status: 'APPROVED' }
      ]),
      remarks: 'Annual renewal inspection due October 2025.'
    },
    {
      id_projects: projectId,
      authority: 'DOE_ENVIRONMENT',
      approval_title: 'Department of Environment Clearance (পরিবেশ অধিদপ্তর ছাড়পত্র)',
      approval_type: 'ENVIRONMENT_NOC',
      application_number: 'DOE-DH-2024-341',
      application_date: '2024-06-01',
      approval_date: '2024-09-12',
      expiry_date: '2026-09-11',
      approval_reference_no: 'DoE/Clearance/Orange-B/2024/331',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'Sewage Treatment & Septic Soak-well Plan', status: 'APPROVED' },
        { doc: 'Noise Insulation for 150KVA Generator', status: 'APPROVED' }
      ]),
      remarks: 'Orange-B category environmental clearance approved.'
    },
    {
      id_projects: projectId,
      authority: 'CIVIL_AVIATION',
      approval_title: 'Civil Aviation Authority Height Clearance (বেসামরিক বিমান চলাচল কর্তৃপক্ষ উচ্চতা ছাড়পত্র)',
      approval_type: 'AVIATION_HEIGHT_NOC',
      application_number: 'CAAB-ATS-2024-192',
      application_date: '2024-05-18',
      approval_date: '2024-07-28',
      expiry_date: '2029-07-27',
      approval_reference_no: 'CAAB/51.01.0000.119.2024.192',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'WGS-84 Coordinates Survey', status: 'APPROVED' },
        { doc: 'Top of Structure Elevation Benchmark', status: 'APPROVED' }
      ]),
      remarks: 'Cleared up to 125 feet AMSL (Above Mean Sea Level).'
    },
    {
      id_projects: projectId,
      authority: 'WASA',
      approval_title: 'Dhaka WASA Deep Tube-well & Water Connection Sanction (ঢাকা ওয়াসা অনুমোদন)',
      approval_type: 'WATER_SEWERAGE_NOC',
      application_number: 'WASA-MODS-ZONE9-2024-551',
      application_date: '2024-08-01',
      approval_date: '2024-10-20',
      expiry_date: '2026-10-19',
      approval_reference_no: 'WASA/MODS-9/Conn/2024/774',
      status: 'APPROVED',
      document_checklist: JSON.stringify([
        { doc: 'Water Demand Calculation (108 Flats x 6 Person)', status: 'APPROVED' },
        { doc: '6-inch Submersible Deep Tube-well Permit', status: 'APPROVED' }
      ]),
      remarks: 'Daily water supply quota 65,000 Litres sanctioned.'
    }
  ]);

  // 4. BNBC 2020 Compliance Records
  await knex('bnbc_compliance_records').where({ id_projects: projectId }).del();
  await knex('bnbc_compliance_records').insert([
    {
      id_projects: projectId,
      category: 'STRUCTURAL',
      requirement_name: 'BNBC 2020 Seismic Load Analysis (Zone 2 Factor Z=0.20)',
      specification_clause: 'BNBC 2020 Part 6 Chapter 2: Response Modification Coefficient R=8 for Special Moment Resisting Frames (SMRF)',
      evidence_document: 'ETABS 3D Finite Element Structural Model Report & PE Certification',
      responsible_engineer: 'Engr. Dr. M. A. Rashid, PE (IEB-14201)',
      compliance_status: 'COMPLIANT',
      verification_date: '2024-10-15',
      notes: 'Structural safety verified against magnitude 7.5 earthquake.'
    },
    {
      id_projects: projectId,
      category: 'STRUCTURAL',
      requirement_name: 'Bored Cast-in-Situ Piling Capacity (Factor of Safety >= 2.5)',
      specification_clause: 'BNBC 2020 Part 6 Chapter 3: Static Pile Load Test to 200% Design Load',
      evidence_document: 'Pile Load Test ASTM D1143 & Ultrasonic Pile Integrity Test (PIT) Reports',
      responsible_engineer: 'Engr. Tareq Mahmud (Geotechnical Consultant)',
      compliance_status: 'COMPLIANT',
      verification_date: '2025-01-20',
      notes: 'All 75 piles tested; minimum ultimate capacity achieved 210 Tons per pile.'
    },
    {
      id_projects: projectId,
      category: 'FIRE_SAFETY',
      requirement_name: 'Dual 2-Hour Fire Rated Emergency Enclosed Staircases',
      specification_clause: 'BNBC 2020 Part 4 Section 3.8: Pressurized Smoke-Free Escape Routes & Self-Closing UL Fire Doors',
      evidence_document: 'Fire Protection Architectural Detail Drawing Sheets FP-01 to FP-09',
      responsible_engineer: 'Architect Shamsul Wares, FIAB',
      compliance_status: 'COMPLIANT',
      verification_date: '2024-11-10',
      notes: 'Fire doors with 120-minute thermal barrier installed on every residential landing.'
    },
    {
      id_projects: projectId,
      category: 'ACCESSIBILITY',
      requirement_name: 'Universal Accessibility Entry Ramp & Corridor Clearance',
      specification_clause: 'BNBC 2020 Part 3 Chapter 2: Maximum 1:12 Ramp Slope with Non-Slip Surface & Dual Handrails',
      evidence_document: 'Architectural Ground Landscape & Entrance Detail Drawing GD-03',
      responsible_engineer: 'Architect Farhana Rahman, MIAB',
      compliance_status: 'COMPLIANT',
      verification_date: '2024-11-20',
      notes: 'Full wheelchair accessibility from drop-off to elevator lobbies.'
    }
  ]);

  // 5. Fire Safety Equipment Dashboard
  await knex('fire_safety_equipment').where({ id_projects: projectId }).del();
  await knex('fire_safety_equipment').insert([
    { id_projects: projectId, equipment_tag: 'EXT-A-G01', equipment_type: 'ABC Dry Powder 5kg', location_description: 'Tower A Ground Lobby', installation_date: '2025-02-01', last_inspection_date: '2026-08-15', expiry_refill_date: '2027-02-01', status: 'ACTIVE_READY', inspector_name: 'Fire Tech BD Ltd' },
    { id_projects: projectId, equipment_tag: 'EXT-A-FL05', equipment_type: 'CO2 Extinguisher 3kg', location_description: 'Tower A Level 5 Skywalk', installation_date: '2025-02-01', last_inspection_date: '2026-08-15', expiry_refill_date: '2027-02-01', status: 'ACTIVE_READY', inspector_name: 'Fire Tech BD Ltd' },
    { id_projects: projectId, equipment_tag: 'PUMP-MAIN-01', equipment_type: '750 GPM Diesel Fire Engine Pump', location_description: 'Central Underground Pump Room', installation_date: '2025-01-10', last_inspection_date: '2026-09-01', expiry_refill_date: '2027-01-10', status: 'ACTIVE_READY', inspector_name: 'National Fire Engineers' },
    { id_projects: projectId, equipment_tag: 'ALARM-CTRL-01', equipment_type: 'Addressable 8-Loop Fire Alarm Control Panel', location_description: 'Central Security Guard Station', installation_date: '2025-01-15', last_inspection_date: '2026-09-10', expiry_refill_date: '2026-10-15', status: 'REFILL_DUE', inspector_name: 'Safety First Automation' }
  ]);

  // 6. Utility Meters (DESCO, WASA, Generator)
  await knex('utility_meters').where({ id_projects: projectId }).del();
  await knex('utility_meters').insert([
    { id_projects: projectId, unit_number: 'A-201', utility_type: 'ELECTRICITY', meter_number: 'DESCO-DIG-884102', previous_reading: 1420.00, current_reading: 1680.00, consumption_units: 260.00, uom: 'kWh', unit_rate_bdt: 9.80, billing_month: 'September 2026', total_amount_bdt: 2548.00, payment_status: 'PAID' },
    { id_projects: projectId, unit_number: 'B-201', utility_type: 'ELECTRICITY', meter_number: 'DESCO-DIG-884103', previous_reading: 2100.00, current_reading: 2390.00, consumption_units: 290.00, uom: 'kWh', unit_rate_bdt: 9.80, billing_month: 'September 2026', total_amount_bdt: 2842.00, payment_status: 'PAID' },
    { id_projects: projectId, unit_number: 'C-201', utility_type: 'ELECTRICITY', meter_number: 'DESCO-DIG-884104', previous_reading: 1850.00, current_reading: 2110.00, consumption_units: 260.00, uom: 'kWh', unit_rate_bdt: 9.80, billing_month: 'September 2026', total_amount_bdt: 2548.00, payment_status: 'PAID' },
    { id_projects: projectId, unit_number: 'A-101 (Mosque)', utility_type: 'WATER', meter_number: 'WASA-SUB-001', previous_reading: 4200.00, current_reading: 4750.00, consumption_units: 550.00, uom: 'Gallons x 10', unit_rate_bdt: 18.50, billing_month: 'September 2026', total_amount_bdt: 10175.00, payment_status: 'PAID' },
    { id_projects: projectId, unit_number: 'Central Substation', utility_type: 'GENERATOR_BACKUP', meter_number: 'GEN-RUN-HOUR-01', previous_reading: 420.00, current_reading: 458.00, consumption_units: 38.00, uom: 'Operating Hours', unit_rate_bdt: 680.00, billing_month: 'September 2026', total_amount_bdt: 25840.00, payment_status: 'PAID' }
  ]);

  // 7. Property Handover & Area Difference (Real Estate Act 2010 Compliance)
  await knex('property_handovers').where({ id_projects: projectId }).del();
  await knex('property_handovers').insert([
    {
      id_projects: projectId,
      id_units: 1, // sample unit
      unit_number: 'A-201',
      owner_name: 'Engr. Kazi Tariqul Islam',
      approved_area_sft: 1420.00,
      final_measured_area_sft: 1432.50,
      area_difference_sft: 12.50, // Delivered 12.5 SFT more
      rate_per_sft_bdt: 4500.00,
      area_adjustment_amount_bdt: 56250.00,
      adjustment_settlement: 'SETTLED_WITH_OWNER',
      snag_list: JSON.stringify([
        { item: 'Master bathroom tile grout sealing', status: 'FIXED_VERIFIED' },
        { item: 'Balcony aluminum sliding lock tension adjustment', status: 'FIXED_VERIFIED' },
        { item: 'Main door teak veneer final protective lacquer', status: 'FIXED_VERIFIED' }
      ]),
      keys_handed_over: true,
      access_cards_issued: true,
      possession_date: '2026-09-15',
      handover_status: 'HANDED_OVER_POSSESSED',
      possession_letter_ref: 'POSS-SB-2026-A201',
      remarks: 'Joint final survey conducted with owner. Handover possession letter signed and electricity meter reading recorded.'
    },
    {
      id_projects: projectId,
      id_units: 2,
      unit_number: 'B-201',
      owner_name: 'Engr. Kazi Tariqul Islam',
      approved_area_sft: 1380.00,
      final_measured_area_sft: 1380.00,
      area_difference_sft: 0.00,
      rate_per_sft_bdt: 4500.00,
      area_adjustment_amount_bdt: 0.00,
      adjustment_settlement: 'NO_DIFFERENCE',
      snag_list: JSON.stringify([
        { item: 'Kitchen exhaust hood wiring test', status: 'FIXED_VERIFIED' }
      ]),
      keys_handed_over: true,
      access_cards_issued: true,
      possession_date: '2026-09-15',
      handover_status: 'HANDED_OVER_POSSESSED',
      possession_letter_ref: 'POSS-SB-2026-B201',
      remarks: 'Zero area discrepancy. Perfect execution according to architectural layout.'
    }
  ]);

  // 8. Vendor Baki (Credit) Ledger
  await knex('vendor_baki_ledger').where({ id_projects: projectId }).del();
  await knex('vendor_baki_ledger').insert([
    {
      id_projects: projectId,
      vendor_name: 'Shah & Bashundhara Cement Distributors (উত্তরা সিমেন্ট এজেন্সি)',
      trade_specialty: 'Cement & Binding Materials',
      total_purchased_bdt: 5400000.00,
      total_paid_bdt: 4600000.00,
      current_baki_bdt: 800000.00,
      credit_limit_bdt: 1200000.00,
      payment_terms: 'Weekly payment against delivery challan (প্রতি রবিবার বিল প্রদান)'
    },
    {
      id_projects: projectId,
      vendor_name: 'BSRM & AKS Steel Trading (মেসার্স সততা স্টিল করপোরেশন)',
      trade_specialty: '500W TMT Rebar Supply',
      total_purchased_bdt: 9800000.00,
      total_paid_bdt: 8600000.00,
      current_baki_bdt: 1200000.00,
      credit_limit_bdt: 2000000.00,
      payment_terms: '15 days credit from weighbridge challan'
    },
    {
      id_projects: projectId,
      vendor_name: 'Sylhet Sand & Bholaganj Stone Syndicate (জাফলং স্টোন কর্পোরেশন)',
      trade_specialty: 'Coarse Sand & Granite Stone Chips',
      total_purchased_bdt: 3200000.00,
      total_paid_bdt: 2750000.00,
      current_baki_bdt: 450000.00,
      credit_limit_bdt: 800000.00,
      payment_terms: 'Payment on measurement after truck unload'
    }
  ]);

  // 9. Cheque Register & Clearing
  await knex('cheque_register').where({ id_projects: projectId }).del();
  await knex('cheque_register').insert([
    {
      id_projects: projectId,
      cheque_number: 'DBBL-CQ-990214',
      bank_name: 'Dutch-Bangla Bank Ltd',
      branch_name: 'Uttara Branch, Dhaka',
      account_no: '107.120.44892',
      payee_or_drawer: 'Engr. Kazi Tariqul Islam (Owner Payment)',
      amount_bdt: 500000.00,
      issue_date: '2026-09-01',
      deposit_date: '2026-09-02',
      clearance_date: '2026-09-03',
      cheque_type: 'INWARD_COLLECTION',
      status: 'CLEARED',
      reference_voucher_no: 'MR-2026-000188',
      remarks: 'Cleared via BEFTN electronic clearing house.'
    },
    {
      id_projects: projectId,
      cheque_number: 'IBBL-CQ-771209',
      bank_name: 'Islami Bank Bangladesh Ltd',
      branch_name: 'Sector 3 Branch, Uttara',
      account_no: '205.021.33912',
      payee_or_drawer: 'BSRM & AKS Steel Trading (Vendor Payment)',
      amount_bdt: 1200000.00,
      issue_date: '2026-09-10',
      deposit_date: '2026-09-11',
      clearance_date: '2026-09-12',
      cheque_type: 'OUTWARD_PAYMENT',
      status: 'CLEARED',
      reference_voucher_no: 'PAY-2026-000304',
      remarks: 'Payment towards 16mm rebar challan #441.'
    },
    {
      id_projects: projectId,
      cheque_number: 'BRAC-CQ-441290',
      bank_name: 'BRAC Bank Ltd',
      branch_name: 'Gulshan Branch',
      account_no: '150.102.88412',
      payee_or_drawer: 'Dr. Farhana Sultana (Installment Cheque)',
      amount_bdt: 350000.00,
      issue_date: '2026-09-25',
      deposit_date: '2026-09-26',
      clearance_date: '2026-09-28',
      cheque_type: 'INWARD_COLLECTION',
      status: 'CLEARED',
      reference_voucher_no: 'MR-2026-000195',
      remarks: 'Flat C-702 installment payment.'
    }
  ]);

  console.log('Bangladesh Compliance & Property seed completed successfully!');
};
