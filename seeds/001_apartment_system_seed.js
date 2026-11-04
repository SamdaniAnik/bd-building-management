
const bcrypt = require('bcryptjs');

exports.seed = async function(knex) {
  const existingProjects = await knex('projects').count('id_projects as count');
  if (existingProjects[0].count > 0) {
    console.log('Project data already seeded, refreshing tables...');
    await knex('audit_logs').del();
    await knex('notifications').del();
    await knex('approvals').del();
    await knex('cash_bank_accounts').del();
    await knex('lifts').del();
    await knex('common_areas').del();
    await knex('project_expenses').del();
    await knex('change_orders').del();
    await knex('budgets').del();
    await knex('loan_payments').del();
    await knex('loan_disbursements').del();
    await knex('owner_loans').del();
    await knex('owner_ledgers').del();
    await knex('owner_contributions').del();
    await knex('vendor_payments').del();
    await knex('vendor_invoices').del();
    await knex('purchase_orders').del();
    await knex('vendor_quotations').del();
    await knex('boq_items').del();
    await knex('work_allocations').del();
    await knex('construction_works').del();
    await knex('materials').del();
    await knex('vendors').del();
    await knex('unit_rooms').del();
    await knex('unit_ownerships').del();
    await knex('owners').del();
    await knex('units').del();
    await knex('floors').del();
    await knex('projects').del();
  }

  const salt = await bcrypt.genSalt(10);
  const adminPass = await bcrypt.hash('admin123', salt);
  const managerPass = await bcrypt.hash('manager123', salt);
  const accountantPass = await bcrypt.hash('accountant123', salt);
  const ownerPass = await bcrypt.hash('owner123', salt);
  const vendorPass = await bcrypt.hash('vendor123', salt);

  await knex('users').whereIn('email', [
    'admin@gulshanheights.com',
    'manager@gulshanheights.com',
    'accountant@gulshanheights.com',
    'owner.a@gulshanheights.com',
    'vendor@abcconstruction.com'
  ]).del();

  await knex('users').insert([
    { name: 'System Super Admin', email: 'admin@gulshanheights.com', password: adminPass, role: 'admin', is_active: true },
    { name: 'Kabir Hossain (Project Manager)', email: 'manager@gulshanheights.com', password: managerPass, role: 'manager', is_active: true },
    { name: 'Farzana Akter (Chief Accountant)', email: 'accountant@gulshanheights.com', password: accountantPass, role: 'manager', is_active: true },
    { name: 'Engr. Rafiqul Islam (Flat Owner A)', email: 'owner.a@gulshanheights.com', password: ownerPass, role: 'viewer', is_active: true },
    { name: 'ABC Construction (Vendor Portal)', email: 'vendor@abcconstruction.com', password: vendorPass, role: 'viewer', is_active: true }
  ]);

  const [projectId] = await knex('projects').insert({
    project_name: 'Gulshan Heights Luxury Residences',
    project_code: 'GH-2026',
    address: 'Plot 42, Road 71, Gulshan-2, Dhaka 1212',
    description: 'Modern 6-storey multi-unit luxury apartment building with shared common facilities, 2 Otis lifts, solar backup, and individual owner upgrades.',
    start_date: '2026-01-10',
    expected_completion_date: '2027-06-30',
    number_of_buildings: 1,
    number_of_floors: 6,
    number_of_units: 6,
    total_unit_area: 6960.00,
    total_common_area: 2500.00,
    total_construction_area: 9460.00,
    status: 'ACTIVE'
  });

  const floorData = [
    { floor_number: 1, floor_name: '1st Floor (Level 1)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 },
    { floor_number: 2, floor_name: '2nd Floor (Level 2)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 },
    { floor_number: 3, floor_name: '3rd Floor (Level 3)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 },
    { floor_number: 4, floor_name: '4th Floor (Level 4)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 },
    { floor_number: 5, floor_name: '5th Floor (Level 5)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 },
    { floor_number: 6, floor_name: '6th Floor (Level 6)', floor_area: 1576.00, common_area: 416.00, lobby_area: 180.00, stair_area: 120.00, lift_area: 116.00 }
  ];

  const floorIds = [];
  for (const f of floorData) {
    const [fid] = await knex('floors').insert({ ...f, id_projects: projectId });
    floorIds.push(fid);
  }

  const unitNames = ['Unit A', 'Unit B', 'Unit C', 'Unit D', 'Unit E', 'Unit F'];
  const unitIds = [];
  for (let i = 0; i < 6; i++) {
    const [uid] = await knex('units').insert({
      id_projects: projectId,
      id_floors: floorIds[i],
      unit_number: unitNames[i],
      unit_type: '3-BHK Apartment Flat',
      area_sqft: 1160.00,
      bedrooms: 3,
      bathrooms: 3,
      kitchen: 1,
      living_dining: 1,
      balcony_veranda: 2,
      parking: 1,
      storage: 1,
      status: 'UNDER_CONSTRUCTION'
    });
    unitIds.push(uid);

    await knex('unit_rooms').insert([
      { id_units: uid, id_floors: floorIds[i], room_name: 'Master Bedroom', room_type: 'MASTER_BEDROOM', length_feet: 14.0, width_feet: 12.5, area_sqft: 175.00, notes: 'South facing, attached bath & balcony' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Bedroom 2', room_type: 'BEDROOM', length_feet: 12.0, width_feet: 11.5, area_sqft: 138.00, notes: 'East facing, attached bath' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Bedroom 3 / Guest', room_type: 'BEDROOM', length_feet: 11.5, width_feet: 10.5, area_sqft: 120.75, notes: 'With common toilet access' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Living & Dining Hall', room_type: 'LIVING_DINING', length_feet: 22.0, width_feet: 15.0, area_sqft: 330.00, notes: 'Grand open concept' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Modern Kitchen', room_type: 'KITCHEN', length_feet: 11.0, width_feet: 8.5, area_sqft: 93.50, notes: 'Provision for hob, chimney & cabinets' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Attached Master Toilet', room_type: 'ATTACHED_TOILET', length_feet: 7.5, width_feet: 5.5, area_sqft: 41.25, notes: 'Cabinet wash basin' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Attached Toilet 2', room_type: 'ATTACHED_TOILET', length_feet: 7.0, width_feet: 5.0, area_sqft: 35.00, notes: 'Ventilated' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Common Toilet', room_type: 'COMMON_TOILET', length_feet: 6.5, width_feet: 4.5, area_sqft: 29.25, notes: 'Guest toilet' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Front Balcony', room_type: 'BALCONY', length_feet: 10.0, width_feet: 4.5, area_sqft: 45.00, notes: 'Scenic view' },
      { id_units: uid, id_floors: floorIds[i], room_name: 'Kitchen Balcony/Veranda', room_type: 'VERANDA', length_feet: 6.5, width_feet: 4.0, area_sqft: 26.00, notes: 'Washing area' }
    ]);
  }

  const ownersData = [
    { full_name: 'Engr. Rafiqul Islam', phone: '01711223344', email: 'rafiq@gulshanheights.com', address: 'House 14, Road 3, Dhanmondi, Dhaka', identification_reference: 'NID-1981267890123', agreement_date: '2026-01-15', login_email: 'owner.a@gulshanheights.com' },
    { full_name: 'Dr. Sultana Kamal', phone: '01811334455', email: 'sultana@gulshanheights.com', address: 'Apartment 4B, Concord Tower, Banani, Dhaka', identification_reference: 'NID-1985345678901', agreement_date: '2026-01-18', login_email: 'sultana@gulshanheights.com' },
    { full_name: 'Mr. Tanvir Ahmed', phone: '01711998877', email: 'tanvir@gulshanheights.com', address: 'Road 11, Uttara Sector 4, Dhaka', identification_reference: 'NID-1979456789012', agreement_date: '2026-01-20', login_email: 'tanvir@gulshanheights.com' },
    { full_name: 'Mrs. Sabrina Ahmed', phone: '01711998878', email: 'sabrina@gulshanheights.com', address: 'Road 11, Uttara Sector 4, Dhaka', identification_reference: 'NID-1983567890123', agreement_date: '2026-01-20', login_email: 'sabrina@gulshanheights.com' },
    { full_name: 'Barrister Asif Mahmud', phone: '01911556677', email: 'asif@gulshanheights.com', address: 'Suite 901, Supreme Court Bar Association, Dhaka', identification_reference: 'NID-1987678901234', agreement_date: '2026-01-22', login_email: 'asif@gulshanheights.com' },
    { full_name: 'Prof. Farhana Zaman', phone: '01611667788', email: 'farhana@gulshanheights.com', address: 'Dhaka University Residential Area, Fuller Road, Dhaka', identification_reference: 'NID-1976789012345', agreement_date: '2026-01-25', login_email: 'farhana@gulshanheights.com' },
    { full_name: 'Kazi Nabil Hasan', phone: '01511778899', email: 'nabil@gulshanheights.com', address: 'House 8, Road 28, Gulshan-1, Dhaka', identification_reference: 'NID-1984890123456', agreement_date: '2026-01-28', login_email: 'nabil@gulshanheights.com' }
  ];

  const ownerIds = [];
  for (const o of ownersData) {
    const [oid] = await knex('owners').insert(o);
    ownerIds.push(oid);
  }

  await knex('unit_ownerships').insert([
    { id_units: unitIds[0], id_owners: ownerIds[0], ownership_percentage: 100.00, agreement_date: '2026-01-15' },
    { id_units: unitIds[1], id_owners: ownerIds[1], ownership_percentage: 100.00, agreement_date: '2026-01-18' },
    { id_units: unitIds[2], id_owners: ownerIds[2], ownership_percentage: 60.00, agreement_date: '2026-01-20' },
    { id_units: unitIds[2], id_owners: ownerIds[3], ownership_percentage: 40.00, agreement_date: '2026-01-20' },
    { id_units: unitIds[3], id_owners: ownerIds[4], ownership_percentage: 100.00, agreement_date: '2026-01-22' },
    { id_units: unitIds[4], id_owners: ownerIds[5], ownership_percentage: 100.00, agreement_date: '2026-01-25' },
    { id_units: unitIds[5], id_owners: ownerIds[6], ownership_percentage: 100.00, agreement_date: '2026-01-28' }
  ]);

  const vendorsData = [
    { company_name: 'ABC Construction Ltd.', contact_person: 'Md. Alamgir Hossain', phone: '01712001122', email: 'info@abcconstruction.com', address: 'Tejgaon I/A, Dhaka', category: 'CONTRACTOR', trade: 'General Civil & RCC', payment_terms: 'Progressive / Milestone' },
    { company_name: 'Shah Cement Mills Ltd.', contact_person: 'Tariqul Islam', phone: '01819002233', email: 'sales@shahcement.com', address: 'Plot 12, Mohakhali C/A, Dhaka', category: 'CEMENT_SUPPLIER', trade: 'Portland Composite Cement', payment_terms: 'Net 15' },
    { company_name: 'BSRM Steels Ltd.', contact_person: 'Mahfuzur Rahman', phone: '01919003344', email: 'corporate@bsrm.com', address: 'Nasirabad, Chittagong / Dhaka Office', category: 'STEEL_SUPPLIER', trade: '500W TMT Rebar', payment_terms: 'Advance 30%, Delivery 70%' },
    { company_name: 'Sigma Elevators Bangladesh', contact_person: 'Engr. Sajid Karim', phone: '01619004455', email: 'support@sigma-bd.com', address: 'Gulshan Avenue, Dhaka', category: 'LIFT', trade: 'Passenger Elevators & ARD', payment_terms: '30% Advance, 50% Delivery, 20% Commissioning' },
    { company_name: 'RAK Ceramics Bangladesh', contact_person: 'Nazmul Haque', phone: '01519005566', email: 'sales@rakceramics.com.bd', address: 'RAK Tower, Uttara, Dhaka', category: 'TILE_SUPPLIER', trade: 'Porcelain & Granite Tiles', payment_terms: 'Net 30' },
    { company_name: 'Modern Modular Kitchens & Woodworks', contact_person: 'Kamrul Ahsan', phone: '01729006677', email: 'contact@modernkitchens.bd', address: 'Panthapath, Dhaka', category: 'KITCHEN', trade: 'Custom Acrylic & HPL Kitchens', payment_terms: '50% Booking, 50% Handover' }
  ];

  const vendorIds = [];
  for (const v of vendorsData) {
    const [vid] = await knex('vendors').insert(v);
    vendorIds.push(vid);
  }

  await knex('materials').insert([
    { material_name: 'Shah Special Portland Composite Cement (PCC)', category: 'Structural', unit: 'Bags', current_rate: 10.00, previous_rate: 9.50, supplier: 'Shah Cement' },
    { material_name: 'BSRM Ultima 60G / 500W Deformed Steel Bar', category: 'Structural', unit: 'Tons', current_rate: 950.00, previous_rate: 920.00, supplier: 'BSRM Steels Ltd.' },
    { material_name: 'Sylhet Coarse Sand (FM 2.5)', category: 'Structural', unit: 'CFT', current_rate: 45.00, previous_rate: 42.00, supplier: 'Local Dredger Co.' },
    { material_name: 'Gas Burnt Auto Bricks (Grade 1)', category: 'Structural', unit: 'PCS', current_rate: 0.15, previous_rate: 0.14, supplier: 'Mirpur Bricks' },
    { material_name: 'RAK 24x24 Double Charge Glazed Porcelain Tiles', category: 'Finishing', unit: 'SQFT', current_rate: 3.50, previous_rate: 3.20, supplier: 'RAK Ceramics' },
    { material_name: 'BRB 3-Core Flame-Retardant Copper Cable', category: 'Electrical', unit: 'Coils', current_rate: 85.00, previous_rate: 80.00, supplier: 'BRB Cable' }
  ]);

  const [work1] = await knex('construction_works').insert({
    id_projects: projectId,
    id_vendors: vendorIds[0],
    work_name: 'Foundation & Piling Concrete Work',
    work_category: 'Structural',
    work_type: 'COMBINED',
    description: 'Cast-in-situ RCC piling (48 piles, 60ft depth) and heavy foundation mat concrete with 60G steel rebar.',
    estimated_cost: 50000.00,
    actual_cost: 50000.00,
    start_date: '2026-01-15',
    expected_completion: '2026-03-31',
    actual_completion: '2026-03-28',
    progress_percentage: 100,
    status: 'COMPLETED',
    cost_allocation_method: 'AREA_BASED'
  });

  for (let i = 0; i < 6; i++) {
    const allocatedAmt = i === 5 ? 8333.35 : 8333.33;
    await knex('work_allocations').insert({
      id_works: work1,
      id_units: unitIds[i],
      id_owners: i === 2 ? ownerIds[2] : (i > 2 ? ownerIds[i + 1] : ownerIds[i]),
      allocation_percentage: 16.6667,
      allocated_amount: allocatedAmt,
      is_custom: false,
      notes: 'Equal 1,160 sft area share for Unit ' + unitNames[i]
    });
  }

  const [work2] = await knex('construction_works').insert({
    id_projects: projectId,
    id_vendors: vendorIds[3],
    work_name: 'Dual High-Speed Passenger Lifts (2 Units) Supply & Commissioning',
    work_category: 'Facilities & MEP',
    work_type: 'COMBINED',
    description: 'Two 8-passenger VVVF gearless energy efficient lifts with Automatic Rescue Device (ARD) and stainless hairline cabin.',
    estimated_cost: 40000.00,
    actual_cost: 40000.00,
    start_date: '2026-02-01',
    expected_completion: '2026-07-31',
    progress_percentage: 65,
    status: 'IN_PROGRESS',
    cost_allocation_method: 'EQUAL'
  });

  for (let i = 0; i < 6; i++) {
    const allocatedAmt = i === 5 ? 6666.70 : 6666.66;
    await knex('work_allocations').insert({
      id_works: work2,
      id_units: unitIds[i],
      id_owners: i === 2 ? ownerIds[2] : (i > 2 ? ownerIds[i + 1] : ownerIds[i]),
      allocation_percentage: 16.6667,
      allocated_amount: allocatedAmt,
      is_custom: false,
      notes: 'Equal share for 2 lift facility'
    });
  }

  const [work3] = await knex('construction_works').insert({
    id_projects: projectId,
    id_vendors: vendorIds[0],
    work_name: 'RCC Superstructure Frame (Columns, Beams & Slabs)',
    work_category: 'Structural',
    work_type: 'COMBINED',
    description: 'RCC frame casting for 6 residential floors with curing and test cylinder validation.',
    estimated_cost: 120000.00,
    actual_cost: 120000.00,
    start_date: '2026-03-01',
    expected_completion: '2026-09-30',
    progress_percentage: 85,
    status: 'IN_PROGRESS',
    cost_allocation_method: 'AREA_BASED'
  });

  for (let i = 0; i < 6; i++) {
    await knex('work_allocations').insert({
      id_works: work3,
      id_units: unitIds[i],
      id_owners: i === 2 ? ownerIds[2] : (i > 2 ? ownerIds[i + 1] : ownerIds[i]),
      allocation_percentage: 16.6667,
      allocated_amount: 20000.00,
      is_custom: false,
      notes: 'Area share ($20,000 per unit)'
    });
  }

  const [indWork1] = await knex('construction_works').insert({
    id_projects: projectId,
    id_units: unitIds[0],
    id_owners: ownerIds[0],
    id_vendors: vendorIds[5],
    work_name: 'Premium Modular Kitchen Cabinet & Island Upgrade',
    work_category: 'Individual Interior',
    work_type: 'INDIVIDUAL',
    description: 'Spanish acrylic soft-close shutter cabinets, Quartz stone countertop, pull-out tall pantry, and under-cabinet LED strip lights.',
    estimated_cost: 5000.00,
    actual_cost: 5000.00,
    start_date: '2026-04-01',
    expected_completion: '2026-05-15',
    progress_percentage: 75,
    status: 'IN_PROGRESS',
    cost_allocation_method: 'CUSTOM',
    extra_work_status: 'IN_PROGRESS',
    notes: 'Charged ONLY to Unit A / Owner A. Zero liability on Units B-F.'
  });

  await knex('work_allocations').insert({
    id_works: indWork1,
    id_units: unitIds[0],
    id_owners: ownerIds[0],
    allocation_percentage: 100.00,
    allocated_amount: 5000.00,
    is_custom: true,
    notes: 'Individual upgrade solely belonging to Unit A'
  });

  const [indWork2] = await knex('construction_works').insert({
    id_projects: projectId,
    id_units: unitIds[1],
    id_owners: ownerIds[1],
    id_vendors: vendorIds[4],
    work_name: 'Italian Botticino Marble Flooring in Living & Master Bed',
    work_category: 'Individual Interior',
    work_type: 'INDIVIDUAL',
    description: 'Supply & mirror polishing of imported Botticino marble slabs.',
    estimated_cost: 4500.00,
    actual_cost: 4500.00,
    start_date: '2026-04-10',
    expected_completion: '2026-05-20',
    progress_percentage: 50,
    status: 'IN_PROGRESS',
    cost_allocation_method: 'CUSTOM',
    extra_work_status: 'IN_PROGRESS',
    notes: 'Charged ONLY to Unit B.'
  });

  await knex('work_allocations').insert({
    id_works: indWork2,
    id_units: unitIds[1],
    id_owners: ownerIds[1],
    allocation_percentage: 100.00,
    allocated_amount: 4500.00,
    is_custom: true,
    notes: 'Individual upgrade for Unit B'
  });

  await knex('boq_items').insert([
    { id_works: work1, item_name: 'Portland Composite Cement (PCC)', quantity: 500.00, unit: 'Bags', rate: 10.00, amount: 5000.00, subtotal: 5000.00, discount: 0, tax: 0, total: 5000.00 },
    { id_works: work1, item_name: 'BSRM 60G Deformed Rebar Steel', quantity: 40.00, unit: 'Tons', rate: 950.00, amount: 38000.00, subtotal: 38000.00, discount: 0, tax: 0, total: 38000.00 },
    { id_works: work1, item_name: 'Coarse Sand & Stone Chips Aggregates', quantity: 120.00, unit: 'Truckloads', rate: 40.00, amount: 4800.00, subtotal: 4800.00, discount: 0, tax: 0, total: 4800.00 },
    { id_works: work1, item_name: 'Machine Piling Labor & Rig Setup', quantity: 48.00, unit: 'Piles', rate: 45.83, amount: 2200.00, subtotal: 2200.00, discount: 0, tax: 0, total: 2200.00 }
  ]);

  await knex('vendor_quotations').insert([
    { id_works: work1, id_vendors: vendorIds[0], quotation_number: 'QT-ABC-091', quoted_amount: 50000.00, quotation_date: '2026-01-08', status: 'ACCEPTED', terms_and_conditions: 'Includes 10-year structural warranty' },
    { id_works: work1, id_vendors: vendorIds[1], quotation_number: 'QT-SHAH-44', quoted_amount: 52000.00, quotation_date: '2026-01-07', status: 'REJECTED', terms_and_conditions: 'Standard terms' },
    { id_works: work2, id_vendors: vendorIds[3], quotation_number: 'QT-SIGMA-881', quoted_amount: 40000.00, quotation_date: '2026-01-20', status: 'ACCEPTED', terms_and_conditions: '2 years free comprehensive maintenance included' }
  ]);

  const [po1] = await knex('purchase_orders').insert({
    po_number: 'PO-2026-001',
    id_projects: projectId,
    id_works: work1,
    id_vendors: vendorIds[0],
    items_data: JSON.stringify([{ item: 'Piling & Foundation Concrete Works Complete', qty: 1, rate: 50000, total: 50000 }]),
    total_amount: 50000.00,
    delivery_date: '2026-03-31',
    payment_terms: '30% advance, balance progressive',
    status: 'CONFIRMED'
  });

  const [po2] = await knex('purchase_orders').insert({
    po_number: 'PO-2026-002',
    id_projects: projectId,
    id_works: work2,
    id_vendors: vendorIds[3],
    items_data: JSON.stringify([{ item: 'Sigma Dual 8-Passenger VVVF Elevators', qty: 2, rate: 20000, total: 40000 }]),
    total_amount: 40000.00,
    delivery_date: '2026-06-30',
    payment_terms: 'Milestone payment schedule',
    status: 'ISSUED'
  });

  const [inv1] = await knex('vendor_invoices').insert({
    invoice_number: 'INV-001',
    id_vendors: vendorIds[0],
    id_po: po1,
    id_works: work1,
    invoice_date: '2026-03-20',
    due_date: '2026-04-20',
    subtotal: 50000.00,
    tax: 0,
    discount: 0,
    total_amount: 50000.00,
    paid_amount: 30000.00,
    outstanding_amount: 20000.00,
    status: 'PARTIALLY_PAID'
  });

  const [inv2] = await knex('vendor_invoices').insert({
    invoice_number: 'INV-002',
    id_vendors: vendorIds[3],
    id_po: po2,
    id_works: work2,
    invoice_date: '2026-02-15',
    due_date: '2026-03-15',
    subtotal: 40000.00,
    tax: 0,
    discount: 0,
    total_amount: 40000.00,
    paid_amount: 25000.00,
    outstanding_amount: 15000.00,
    status: 'PARTIALLY_PAID'
  });

  await knex('vendor_payments').insert([
    { id_invoices: inv1, id_vendors: vendorIds[0], payment_date: '2026-03-25', amount: 30000.00, payment_type: 'PARTIAL', payment_method: 'BANK_TRANSFER', reference_number: 'EFT-77621-BB', notes: 'Foundation payment 60% released as per site engineer inspection' },
    { id_invoices: inv2, id_vendors: vendorIds[3], payment_date: '2026-02-20', amount: 25000.00, payment_type: 'MILESTONE', payment_method: 'BANK_TRANSFER', reference_number: 'EFT-88123-SCB', notes: 'Advance & hoistway equipment delivery milestone' }
  ]);

  await knex('owner_contributions').insert([
    { id_owners: ownerIds[0], id_units: unitIds[0], id_projects: projectId, amount: 15000.00, payment_date: '2026-01-20', contribution_type: 'INITIAL_DEPOSIT', payment_method: 'BANK_TRANSFER', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'CHQ-001290', receipt_number: 'RCT-2026-001', notes: 'Initial equity booking contribution' },
    { id_owners: ownerIds[0], id_units: unitIds[0], id_projects: projectId, amount: 20000.00, payment_date: '2026-03-10', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'LOAN_FUNDED', bank_or_cash_account: 'Bank Asia Loan Account', reference: 'DISB-BA-1', receipt_number: 'RCT-2026-008', notes: 'Installment 1 from disbursed bank loan' },
    { id_owners: ownerIds[1], id_units: unitIds[1], id_projects: projectId, amount: 32000.00, payment_date: '2026-02-15', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'BANK_TRANSFER', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'EFT-44120', receipt_number: 'RCT-2026-002', notes: 'Milestone 1 & 2 combined' },
    { id_owners: ownerIds[2], id_units: unitIds[2], id_projects: projectId, amount: 18000.00, payment_date: '2026-02-20', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'BANK_TRANSFER', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'EFT-55121', receipt_number: 'RCT-2026-003', notes: 'Tanvir Ahmed 60% share' },
    { id_owners: ownerIds[3], id_units: unitIds[2], id_projects: projectId, amount: 12000.00, payment_date: '2026-02-20', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'BANK_TRANSFER', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'EFT-55122', receipt_number: 'RCT-2026-004', notes: 'Sabrina Ahmed 40% share' },
    { id_owners: ownerIds[4], id_units: unitIds[3], id_projects: projectId, amount: 34000.00, payment_date: '2026-02-28', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'LOAN_FUNDED', bank_or_cash_account: 'DBBL Construction Account', reference: 'DISB-DBBL-1', receipt_number: 'RCT-2026-005', notes: 'Loan funded contribution' },
    { id_owners: ownerIds[5], id_units: unitIds[4], id_projects: projectId, amount: 28000.00, payment_date: '2026-03-05', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'CHEQUE', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'CHQ-99120', receipt_number: 'RCT-2026-006', notes: 'Installment payment' },
    { id_owners: ownerIds[6], id_units: unitIds[5], id_projects: projectId, amount: 29000.00, payment_date: '2026-03-12', contribution_type: 'CONSTRUCTION_INSTALLMENT', payment_method: 'BANK_TRANSFER', bank_or_cash_account: 'Dhaka Bank Project Escrow', reference: 'EFT-88319', receipt_number: 'RCT-2026-007', notes: 'Installment payment' }
  ]);

  await knex('owner_ledgers').insert([
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-01-20', entry_type: 'CREDIT', category: 'OWNER_PAYMENT', description: 'Initial booking deposit payment', debit_amount: 0, credit_amount: 15000.00, running_balance: -15000.00, reference_id: 'RCT-2026-001' },
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-03-10', entry_type: 'CREDIT', category: 'OWNER_PAYMENT', description: 'Bank loan funded construction installment', debit_amount: 0, credit_amount: 20000.00, running_balance: -35000.00, reference_id: 'RCT-2026-008' },
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-03-20', entry_type: 'DEBIT', category: 'COMBINED_COST', description: 'Share of Piling & Foundation Work (Area-based 1,160 sft)', debit_amount: 8333.33, credit_amount: 0, running_balance: -26666.67, reference_id: 'WRK-FOUNDATION' },
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-03-22', entry_type: 'DEBIT', category: 'COMBINED_COST', description: 'Share of Dual Passenger Lifts (Equal allocation)', debit_amount: 6666.67, credit_amount: 0, running_balance: -20000.00, reference_id: 'WRK-LIFT' },
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-03-25', entry_type: 'DEBIT', category: 'COMBINED_COST', description: 'Share of Superstructure RCC Columns & Slabs', debit_amount: 20000.00, credit_amount: 0, running_balance: 0.00, reference_id: 'WRK-RCC' },
    { id_owners: ownerIds[0], id_units: unitIds[0], transaction_date: '2026-04-01', entry_type: 'DEBIT', category: 'INDIVIDUAL_WORK', description: 'Individual Premium Modular Kitchen Cabinet & Island Upgrade', debit_amount: 5000.00, credit_amount: 0, running_balance: 5000.00, reference_id: 'IND-WRK-001' }
  ]);

  const [loan1] = await knex('owner_loans').insert({
    id_owners: ownerIds[0],
    id_units: unitIds[0],
    bank_lender_name: 'Bank Asia Ltd. (Islamic Real Estate Financing)',
    approved_amount: 100000.00,
    disbursed_amount: 70000.00,
    interest_rate: 8.75,
    loan_term_months: 180,
    start_date: '2026-02-01',
    end_date: '2041-01-31',
    monthly_installment: 998.50,
    principal_paid: 2400.00,
    interest_paid: 1200.00,
    outstanding_amount: 67600.00,
    status: 'ACTIVE'
  });

  const [loan2] = await knex('owner_loans').insert({
    id_owners: ownerIds[4],
    id_units: unitIds[3],
    bank_lender_name: 'Dutch-Bangla Bank Ltd. (Fast Loan Home)',
    approved_amount: 80000.00,
    disbursed_amount: 40000.00,
    interest_rate: 9.00,
    loan_term_months: 120,
    start_date: '2026-02-15',
    end_date: '2036-02-14',
    monthly_installment: 1013.40,
    principal_paid: 1500.00,
    interest_paid: 900.00,
    outstanding_amount: 38500.00,
    status: 'ACTIVE'
  });

  await knex('loan_disbursements').insert([
    { id_loans: loan1, disbursement_number: 1, disbursement_date: '2026-02-05', amount: 30000.00, reference_number: 'BA-TRF-01', notes: 'Initial disbursement against piling progress certificate' },
    { id_loans: loan1, disbursement_number: 2, disbursement_date: '2026-03-08', amount: 40000.00, reference_number: 'BA-TRF-02', notes: 'Second disbursement for 3rd floor casting completion' },
    { id_loans: loan2, disbursement_number: 1, disbursement_date: '2026-02-25', amount: 40000.00, reference_number: 'DBBL-TRF-01', notes: 'First milestone release directly into project construction escrow' }
  ]);

  await knex('loan_payments').insert([
    { id_loans: loan1, payment_date: '2026-03-01', amount: 1800.00, principal: 1200.00, interest: 600.00, bank_name: 'Bank Asia', reference: 'AUTODEBIT-01', remaining_balance: 68800.00 },
    { id_loans: loan1, payment_date: '2026-04-01', amount: 1800.00, principal: 1200.00, interest: 600.00, bank_name: 'Bank Asia', reference: 'AUTODEBIT-02', remaining_balance: 67600.00 }
  ]);

  const [b1] = await knex('budgets').insert({ id_projects: projectId, category: 'STRUCTURAL', original_budget: 220000.00, revised_budget: 220000.00, actual_spent: 170000.00, notes: 'Piling, RCC columns, beams, slabs, basement works' });
  const [b2] = await knex('budgets').insert({ id_projects: projectId, category: 'LIFT', original_budget: 45000.00, revised_budget: 50000.00, actual_spent: 40000.00, notes: 'Two VVVF 8-person passenger elevators' });
  const [b3] = await knex('budgets').insert({ id_projects: projectId, category: 'FINISHING', original_budget: 90000.00, revised_budget: 90000.00, actual_spent: 32000.00, notes: 'Tiles, plastering, putty, painting, doors & windows' });
  const [b4] = await knex('budgets').insert({ id_projects: projectId, category: 'ELECTRICAL', original_budget: 35000.00, revised_budget: 35000.00, actual_spent: 12000.00, notes: 'Substation, generator, common wiring, earthing' });
  const [b5] = await knex('budgets').insert({ id_projects: projectId, category: 'CONTINGENCY', original_budget: 20000.00, revised_budget: 15000.00, actual_spent: 3500.00, notes: 'Emergency reserves and price fluctuation buffer' });

  await knex('change_orders').insert({
    id_budgets: b2,
    original_amount: 45000.00,
    change_amount: 5000.00,
    revised_amount: 50000.00,
    reason: 'Upgraded elevator specification to include gearless PMSM motor and full height infrared curtain sensors',
    requested_by: 'Engr. Kabir Hossain (Project Manager)',
    approved_by: 'Building Committee Resolution #04',
    change_date: '2026-02-05',
    status: 'APPROVED'
  });

  await knex('project_expenses').insert([
    { id_projects: projectId, id_works: work1, id_vendors: vendorIds[0], id_invoices: inv1, category: 'Foundation Concrete', expense_type: 'COMBINED', amount: 50000.00, expense_date: '2026-03-25', payment_method: 'BANK_TRANSFER', funding_source: 'PROJECT_FUND', receipt_reference: 'EXP-FND-01', notes: 'Paid $30,000, $20,000 vendor payable remaining' },
    { id_projects: projectId, id_works: work2, id_vendors: vendorIds[3], id_invoices: inv2, category: 'Elevator Milestone', expense_type: 'COMBINED', amount: 40000.00, expense_date: '2026-02-20', payment_method: 'BANK_TRANSFER', funding_source: 'PROJECT_FUND', receipt_reference: 'EXP-LFT-01', notes: 'Lift advance and hoistway equipment' },
    { id_projects: projectId, id_units: unitIds[0], id_owners: ownerIds[0], id_works: indWork1, id_vendors: vendorIds[5], category: 'Kitchen Upgrade', expense_type: 'INDIVIDUAL', amount: 5000.00, expense_date: '2026-04-01', payment_method: 'BANK_TRANSFER', funding_source: 'OWNER_EQUITY', receipt_reference: 'EXP-IND-01', notes: 'Solely belongs to Unit A' }
  ]);

  await knex('lifts').insert([
    { id_projects: projectId, lift_number: 'Lift 1 (Passenger - North Core)', capacity_persons: 8, manufacturer: 'Sigma / LG', id_vendors: vendorIds[3], purchase_cost: 20000.00, installation_cost: 2500.00, civil_work_cost: 1200.00, electrical_cost: 800.00, warranty_years: 2, maintenance_contract: '2-Year Comprehensive Annual Maintenance Contract (AMC)', monthly_maintenance_cost: 80.00 },
    { id_projects: projectId, lift_number: 'Lift 2 (Service/Stretcher - South Core)', capacity_persons: 8, manufacturer: 'Sigma / LG', id_vendors: vendorIds[3], purchase_cost: 20000.00, installation_cost: 2500.00, civil_work_cost: 1200.00, electrical_cost: 800.00, warranty_years: 2, maintenance_contract: '2-Year Comprehensive Annual Maintenance Contract (AMC)', monthly_maintenance_cost: 80.00 }
  ]);

  await knex('common_areas').insert([
    { id_projects: projectId, area_name: 'Ground Floor Grand Reception & Waiting Lounge', area_type: 'LOBBY', area_sqft: 450.00, construction_cost: 8500.00, monthly_maintenance_cost: 50.00, notes: '24/7 security desk and visitor sofa' },
    { id_projects: projectId, area_name: 'Dual Lift Lobbies (All Floors)', area_type: 'LIFT_LOBBY', area_sqft: 600.00, construction_cost: 7200.00, monthly_maintenance_cost: 40.00, notes: 'Granite wall cladding and false ceiling' },
    { id_projects: projectId, area_name: 'Fire Escape & Emergency Staircase', area_type: 'STAIRCASING', area_sqft: 750.00, construction_cost: 6500.00, monthly_maintenance_cost: 20.00, notes: 'Epoxy coated floor with photoluminescent signs' },
    { id_projects: projectId, area_name: 'Acoustic Sound-Proof Generator & Substation Room', area_type: 'GENERATOR', area_sqft: 320.00, construction_cost: 12000.00, monthly_maintenance_cost: 120.00, notes: '100 KVA Perkins standby diesel generator' },
    { id_projects: projectId, area_name: 'Rooftop Community Terrace & Garden', area_type: 'EXTERNAL_WORKS', area_sqft: 1800.00, construction_cost: 9500.00, monthly_maintenance_cost: 60.00, notes: 'Waterproofed membrane with planters and BBQ area' }
  ]);

  await knex('cash_bank_accounts').insert([
    { id_projects: projectId, account_name: 'Gulshan Heights Project Escrow Account', account_type: 'PROJECT_BANK', bank_name: 'Dhaka Bank Ltd.', account_number: '208-100-994821', balance: 142000.00 },
    { id_projects: projectId, account_name: 'Construction Disbursement Account', account_type: 'CONSTRUCTION_ACCOUNT', bank_name: 'Bank Asia Ltd.', account_number: '034-210-449102', balance: 45000.00 },
    { id_projects: projectId, account_name: 'Site Petty Cash Fund', account_type: 'PETTY_CASH', bank_name: 'Site Safe', account_number: 'CASH-SITE-01', balance: 2500.00 }
  ]);

  await knex('approvals').insert([
    { action_type: 'Vendor Milestone Payment Release', amount: 30000.00, tier: 'COMMITTEE', status: 'APPROVED', requested_by: 'Engr. Kabir Hossain (PM)', approved_by: 'Building Committee Chairman', comments: 'Tested concrete cylinder test report (4000 PSI achieved)' },
    { action_type: 'Extra Work Quotation Approval', amount: 5000.00, tier: 'PROJECT_MANAGER', status: 'APPROVED', requested_by: 'Owner A (Rafiqul Islam)', approved_by: 'Project Manager', comments: 'Individual unit kitchen upgrade requested and approved by owner' },
    { action_type: 'Elevator Specification Upgrade Change Order', amount: 5000.00, tier: 'COMMITTEE', status: 'APPROVED', requested_by: 'Site Architect', approved_by: 'All 6 Owners Unanimous Approval', comments: 'Upgraded to VVVF gearless drive' }
  ]);

  await knex('notifications').insert([
    { title: 'Vendor Payment Processed', message: '$30,000 paid to ABC Construction for Foundation completion. Remaining due: $20,000.', type: 'PAYMENT', is_read: false },
    { title: 'Combined Cost Allocated', message: '$50,000 Foundation concrete cost allocated across Units A-F according to area.', type: 'INFO', is_read: false },
    { title: 'New Owner Payment Received', message: 'Owner A contributed $20,000 via Bank Loan Disbursement.', type: 'PAYMENT', is_read: true },
    { title: 'Individual Work In Progress', message: 'Premium Modular Kitchen installation started for Unit A.', type: 'ALERT', is_read: false }
  ]);

  await knex('audit_logs').insert([
    { user_name: 'Admin', action: 'Created Project', entity_type: 'PROJECT', entity_id: 'GH-2026', old_value: null, new_value: 'Gulshan Heights Luxury Residences (6 Units)' },
    { user_name: 'Kabir Hossain', action: 'Updated Material Rate', entity_type: 'MATERIAL', entity_id: 'Cement', old_value: 'Rate: $9.50', new_value: 'Rate: $10.00' },
    { user_name: 'Farzana Akter', action: 'Allocated Combined Expense', entity_type: 'WORK_ALLOCATION', entity_id: 'WRK-FOUNDATION', old_value: null, new_value: 'Allocated $50,000 equally by area across Units A-F ($8,333.33/unit)' },
    { user_name: 'Kabir Hossain', action: 'Created Individual Work', entity_type: 'INDIVIDUAL_WORK', entity_id: 'IND-WRK-001', old_value: null, new_value: 'Premium Modular Kitchen $5,000 assigned solely to Unit A / Owner A' },
    { user_name: 'Farzana Akter', action: 'Recorded Vendor Payment', entity_type: 'VENDOR_PAYMENT', entity_id: 'INV-001', old_value: 'Paid: $0, Outstanding: $50,000', new_value: 'Paid: $30,000, Outstanding: $20,000' },
    { user_name: 'Farzana Akter', action: 'Recorded Loan Disbursement', entity_type: 'LOAN_DISBURSEMENT', entity_id: 'LOAN-001', old_value: 'Disbursed: $30,000', new_value: 'Disbursed: $70,000 of $100,000 approved' }
  ]);

  console.log('Successfully seeded Apartment Construction & Owner Management System database!');
};
