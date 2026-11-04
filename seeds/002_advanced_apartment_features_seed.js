
exports.seed = async function(knex) {
  // 1. Drawings & Revision Control (Never overwrite old drawings)
  await knex('drawing_revisions').del();
  await knex('drawings').del();

  const [d1] = await knex('drawings').insert({
    id_projects: 1,
    drawing_code: 'DWG-ARCH-01',
    title: 'Architectural Master Typical Floor Plan (Units A–F)',
    category: 'FLOOR_PLAN',
    current_revision: 3,
    status: 'APPROVED'
  });

  const [d2] = await knex('drawings').insert({
    id_projects: 1,
    drawing_code: 'DWG-STR-04',
    title: 'Structural Column Schedule & Foundation Reinforcement Detail',
    category: 'STRUCTURAL',
    current_revision: 2,
    status: 'APPROVED'
  });

  await knex('drawing_revisions').insert([
    { id_drawings: d1, revision_number: 1, revision_code: 'Rev 01', upload_date: '2026-01-05', uploaded_by: 'Arch. Farhan Rahman', revision_reason: 'Initial architectural design submission for RAJUK review', file_url: '/drawings/floorplan_rev01.pdf', approval_status: 'SUPERSEDED' },
    { id_drawings: d1, revision_number: 2, revision_code: 'Rev 02', upload_date: '2026-01-20', uploaded_by: 'Arch. Farhan Rahman', revision_reason: 'Updated kitchen balcony ventilation and fire lobby widening', file_url: '/drawings/floorplan_rev02.pdf', approval_status: 'SUPERSEDED' },
    { id_drawings: d1, revision_number: 3, revision_code: 'Rev 03 (Current)', upload_date: '2026-02-10', uploaded_by: 'Arch. Farhan Rahman', revision_reason: 'Final committee approved floor layout with exact 1,160 SFT per unit', file_url: '/drawings/floorplan_rev03_final.pdf', approval_status: 'APPROVED' },
    { id_drawings: d2, revision_number: 1, revision_code: 'Rev 01', upload_date: '2026-01-12', uploaded_by: 'Engr. Saiful Azim', revision_reason: 'Initial mat foundation layout', file_url: '/drawings/struct_rev01.pdf', approval_status: 'SUPERSEDED' },
    { id_drawings: d2, revision_number: 2, revision_code: 'Rev 02 (Current)', upload_date: '2026-01-28', uploaded_by: 'Engr. Saiful Azim', revision_reason: 'Reinforced pile cap detailing based on soil test report', file_url: '/drawings/struct_rev02_final.pdf', approval_status: 'APPROVED' }
  ]);

  // 2. Contractor Contracts & Progress Billing (Retention, Advance Recovery)
  await knex('contractor_progress_bills').del();
  await knex('contractor_contracts').del();

  const vendor = await knex('vendors').first();
  const [contractId] = await knex('contractor_contracts').insert({
    id_projects: 1,
    id_vendors: vendor ? vendor.id_vendors : 1,
    contract_number: 'CNT-2026-ABC-01',
    contract_title: 'Main Civil & RCC Structural Works Contract',
    contract_value: 200000.00,
    retention_percentage: 5.00, // 5% retention
    advance_paid: 20000.00,
    advance_recovered: 8000.00,
    retention_held: 4000.00,
    work_completed_percentage: 40.00,
    start_date: '2026-01-15',
    end_date: '2026-11-30',
    scope_of_work: 'Piling, mat foundation, RCC columns, beams, slabs up to 6th floor rooftop and external brick masonry walls.',
    status: 'ACTIVE'
  });

  // Example Progress Billing Calculation (Section 7):
  // Contract Value = $200,000, Work completed = 40% -> Gross Claim = $80,000
  // Advance recovery = $8,000, Retention 5% = $4,000, Previous payments = $30,000 -> Net Payable = $38,000
  await knex('contractor_progress_bills').insert({
    id_contracts: contractId,
    bill_number: 'IPC-01-FEB2026',
    billing_date: '2026-02-28',
    cumulative_work_percent: 40.00,
    gross_claim_amount: 80000.00,
    advance_recovery_amount: 8000.00,
    retention_amount: 4000.00,
    previous_payments: 30000.00,
    net_payable_amount: 38000.00,
    status: 'CERTIFIED'
  });

  // 3. Site Petty Cash Expenses (Mobile Site Manager)
  await knex('site_petty_expenses').del();
  await knex('site_petty_expenses').insert([
    { id_projects: 1, expense_date: '2026-03-24', category: 'TRANSPORTATION', amount: 45.00, payee: 'Local Pickup Truck', entered_by: 'Site Supervisor Tariq', receipt_number: 'RCP-SITE-101', description: 'Emergency sand transport from Gabtoli ghat' },
    { id_projects: 1, expense_date: '2026-03-25', category: 'LABOUR_FOOD', amount: 80.00, payee: 'Bismillah Restaurant', entered_by: 'Site Supervisor Tariq', receipt_number: 'RCP-SITE-102', description: 'Night shift slab casting overtime meal for 16 workers' },
    { id_projects: 1, expense_date: '2026-03-27', category: 'SMALL_TOOLS', amount: 65.00, payee: 'Gulshan Hardware', entered_by: 'Site Supervisor Tariq', receipt_number: 'RCP-SITE-103', description: 'Binding wire pliers, cutting blades and safety goggles' },
    { id_projects: 1, expense_date: '2026-03-28', category: 'TEMPORARY_WATER', amount: 120.00, payee: 'Dhaka WASA Water Tanker', entered_by: 'Site Supervisor Tariq', receipt_number: 'RCP-SITE-104', description: 'Water tanker supply for concrete curing' }
  ]);

  // 4. Labour Roster & Attendance
  await knex('labour_attendance').del();
  await knex('labour_workers').del();

  const [w1] = await knex('labour_workers').insert({ worker_name: 'Mokbul Hossain', worker_type: 'MASON', daily_rate: 35.00, phone: '01711000111', contractor_agency: 'ABC Labour Pool' });
  const [w2] = await knex('labour_workers').insert({ worker_name: 'Jahirul Islam', worker_type: 'HELPER', daily_rate: 22.00, phone: '01711000222', contractor_agency: 'ABC Labour Pool' });
  const [w3] = await knex('labour_workers').insert({ worker_name: 'Shahinur Rahman', worker_type: 'ROD_BINDER', daily_rate: 32.00, phone: '01711000333', contractor_agency: 'BSRM Sub-team' });
  const [w4] = await knex('labour_workers').insert({ worker_name: 'Kamrul Hasan', worker_type: 'ELECTRICIAN', daily_rate: 38.00, phone: '01711000444', contractor_agency: 'Eastern Tubes' });

  await knex('labour_attendance').insert([
    { id_workers: w1, attendance_date: '2026-03-30', hours_worked: 8.0, overtime_hours: 2.0, calculated_pay: 43.75, work_performed: '4th Floor beam bottom shuttering & leveling' },
    { id_workers: w2, attendance_date: '2026-03-30', hours_worked: 8.0, overtime_hours: 2.0, calculated_pay: 27.50, work_performed: 'Concrete mixer feeding and aggregate transport' },
    { id_workers: w3, attendance_date: '2026-03-30', hours_worked: 8.0, overtime_hours: 0.0, calculated_pay: 32.00, work_performed: 'Rebar tying for south column node' },
    { id_workers: w4, attendance_date: '2026-03-30', hours_worked: 8.0, overtime_hours: 1.0, calculated_pay: 42.75, work_performed: 'PVC conduit layout in 4th floor slab before casting' }
  ]);

  // 5. Site Material Inventory & Reorder Alerts
  await knex('site_inventory').del();
  const materials = await knex('materials').select('*');
  if (materials.length > 0) {
    // Cement has low stock to demonstrate Section 14 Reorder Alert: 80 bags < 100 bags minimum!
    await knex('site_inventory').insert([
      { id_materials: materials[0].id_materials, opening_stock: 100, purchased_qty: 500, used_qty: 520, damaged_qty: 0, current_stock: 80.00, minimum_reorder_stock: 100.00 },
      { id_materials: materials[1].id_materials, opening_stock: 10, purchased_qty: 40, used_qty: 32, damaged_qty: 0, current_stock: 18.00, minimum_reorder_stock: 5.00 },
      { id_materials: materials[2].id_materials, opening_stock: 1000, purchased_qty: 5000, used_qty: 4200, damaged_qty: 0, current_stock: 1800.00, minimum_reorder_stock: 500.00 }
    ]);
  }

  // 6. Goods Delivery & 3-Way Matching (Section 15 & 16)
  await knex('goods_deliveries').del();
  await knex('goods_deliveries').insert([
    { id_vendors: vendor ? vendor.id_vendors : 1, delivery_challan_no: 'CHL-SHAH-9912', delivery_date: '2026-03-18', material_item: 'Portland Composite Cement (PCC)', po_ordered_qty: 500.00, received_qty: 480.00, damaged_qty: 5.00, accepted_qty: 475.00, received_by: 'Site Engr. Tanmoy Roy', is_three_way_matched: false, matching_notes: 'FLAG: PO ordered 500 bags, delivered 480 bags, 5 damaged. Discrepancy flagged for invoice review.' },
    { id_vendors: vendor ? vendor.id_vendors : 1, delivery_challan_no: 'CHL-BSRM-4421', delivery_date: '2026-03-22', material_item: 'BSRM 60G Deformed Rebar Steel', po_ordered_qty: 40.00, received_qty: 40.00, damaged_qty: 0.00, accepted_qty: 40.00, received_by: 'Site Engr. Tanmoy Roy', is_three_way_matched: true, matching_notes: 'MATCHED: PO 40 tons, Delivery 40 tons, Weight bridge slip matched.' }
  ]);

  // 7. Owner Committee Proposals & Voting (Section 20)
  await knex('proposal_votes').del();
  await knex('committee_proposals').del();

  const [prop1] = await knex('committee_proposals').insert({
    id_projects: 1,
    title: 'Installation of 20 KVA Solar Power Backup on Rooftop',
    description: 'Propose installing a tier-1 solar net-metering photovoltaic grid tied system on the rooftop to power both lifts, water pump, and common lighting, cutting monthly power bills by 65%.',
    estimated_cost: 18000.00,
    proposed_by: 'Engr. Rafiqul Islam (Flat Owner A)',
    proposal_date: '2026-03-15',
    voting_deadline: '2026-04-15',
    status: 'APPROVED',
    votes_for: 5,
    votes_against: 1,
    votes_abstain: 0
  });

  const owners = await knex('owners').select('*');
  if (owners.length >= 6) {
    await knex('proposal_votes').insert([
      { id_proposals: prop1, id_owners: owners[0].id_owners, vote: 'FOR', comments: 'Essential long-term green investment' },
      { id_proposals: prop1, id_owners: owners[1].id_owners, vote: 'FOR', comments: 'Reduces generator fuel noise and operational cost' },
      { id_proposals: prop1, id_owners: owners[2].id_owners, vote: 'FOR', comments: 'Fully agree' },
      { id_proposals: prop1, id_owners: owners[4].id_owners, vote: 'FOR', comments: 'Approved' },
      { id_proposals: prop1, id_owners: owners[5].id_owners, vote: 'FOR', comments: 'Good initiative' },
      { id_proposals: prop1, id_owners: owners[6].id_owners, vote: 'AGAINST', comments: 'Would prefer higher capacity generator instead' }
    ]);
  }

  // 8. Planned Payment Schedules (Section 23)
  await knex('owner_payment_schedules').del();
  const units = await knex('units').select('*');
  if (units.length > 0 && owners.length > 0) {
    await knex('owner_payment_schedules').insert([
      { id_units: units[0].id_units, id_owners: owners[0].id_owners, installment_name: 'Milestone 1 - Foundation & Piling Casting', target_amount: 15000.00, paid_amount: 15000.00, due_date: '2026-01-20', paid_date: '2026-01-20', status: 'PAID' },
      { id_units: units[0].id_units, id_owners: owners[0].id_owners, installment_name: 'Milestone 2 - 3rd Floor RCC Slabs Casting', target_amount: 20000.00, paid_amount: 20000.00, due_date: '2026-03-10', paid_date: '2026-03-10', status: 'PAID' },
      { id_units: units[0].id_units, id_owners: owners[0].id_owners, installment_name: 'Milestone 3 - Rooftop Slab Casting Complete', target_amount: 10000.00, paid_amount: 0.00, due_date: '2026-05-15', status: 'UPCOMING' },
      { id_units: units[0].id_units, id_owners: owners[0].id_owners, installment_name: 'Milestone 4 - Brickwork, Plaster & 2 Lifts Handover', target_amount: 10000.00, paid_amount: 0.00, due_date: '2026-08-30', status: 'UPCOMING' }
    ]);
  }

  // 9. Post-Handover Facilities & Warranty Management (Sections 31-35)
  await knex('maintenance_tickets').del();
  await knex('service_charges').del();
  await knex('asset_warranties').del();

  await knex('asset_warranties').insert([
    { id_projects: 1, asset_name: 'Dual Sigma Passenger Elevators (2 Lifts)', vendor_name: 'Sigma Elevators Bangladesh', start_date: '2026-03-01', expiration_date: '2028-02-28', coverage_terms: 'Full comprehensive replacement of controller cards, traction motor, guide shoes and 24/7 rescue service.', contact_hotline: '01619004455' },
    { id_projects: 1, asset_name: 'Basement & Rooftop Polymer Bitumen Waterproofing', vendor_name: 'Berger Fosroc Chemicals', start_date: '2026-02-15', expiration_date: '2036-02-14', coverage_terms: '10-Year leak-free performance guarantee against water seepage.', contact_hotline: '01712334455' }
  ]);

  if (units.length > 0) {
    await knex('maintenance_tickets').insert([
      { id_units: units[0].id_units, id_owners: owners[0].id_owners, title: 'Temporary water pressure fluctuations in Level 1', category: 'WATER_LEAKAGE', description: 'During pressure testing of the vertical riser pipe, lower pressure noted in attached master bath.', priority: 'MEDIUM', status: 'RESOLVED', assigned_contractor: 'Eastern Plumbing', repair_cost: 0.00 }
    ]);

    await knex('service_charges').insert([
      { id_units: units[0].id_units, billing_month: '2026-04', monthly_fee: 150.00, amount_paid: 150.00, due_date: '2026-04-10', status: 'PAID' },
      { id_units: units[1].id_units, billing_month: '2026-04', monthly_fee: 150.00, amount_paid: 150.00, due_date: '2026-04-10', status: 'PAID' }
    ]);
  }

  // 10. Construction Site Photos & Visual Timeline (Section 37 & 38)
  await knex('construction_site_photos').del();
  await knex('construction_site_photos').insert([
    { id_projects: 1, title: 'Piling Rig Drilling & Steel Cage Insertion', photo_date: '2026-01-22', stage_tag: 'Piling', photo_url: 'https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=600&q=80', taken_by: 'Site Engr. Tanmoy Roy', gps_coordinates: '23.7925° N, 90.4078° E (Gulshan-2)', notes: 'Rig drilled to 62 feet depth. Soil bearing layer verified.' },
    { id_projects: 1, title: 'Heavy Mat Foundation Ready for Pouring', photo_date: '2026-02-15', stage_tag: 'Foundation', photo_url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=600&q=80', taken_by: 'Site Engr. Tanmoy Roy', gps_coordinates: '23.7925° N, 90.4078° E (Gulshan-2)', notes: 'BSRM 60G steel binding complete. 500 bags cement dispatched.' },
    { id_projects: 1, title: 'Superstructure Column & Beam Formwork (Level 3)', photo_date: '2026-03-25', stage_tag: 'Superstructure', photo_url: 'https://images.unsplash.com/photo-1590496793929-36417d3117de?auto=format&fit=crop&w=600&q=80', taken_by: 'Site Engr. Tanmoy Roy', gps_coordinates: '23.7925° N, 90.4078° E (Gulshan-2)', notes: 'Level 3 shuttering inspected before casting.' }
  ]);

  console.log('Advanced apartment features seeded successfully!');
};
