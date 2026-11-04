exports.seed = async function(knex) {
  // 1. Create / Update 'Shopno Bilash' Project
  let project = await knex('projects').where({ project_code: 'SHOPNO-BILASH-108' }).first();
  let projectId;

  const projectData = {
    project_name: 'Shopno Bilash (স্বপ্ন বিলাস)',
    project_code: 'SHOPNO-BILASH-108',
    address: 'Plot 42-46, Sector 15, Uttara Third Phase, Dhaka-1230',
    description: '3 Inter-connected Luxury Residential Towers with Central Podium, Mosque, Executive Meeting Hall & Infinity Swimming Pool. 108 Total Units (105 Personal Shares + 3 Common Society Shares).',
    start_date: '2025-01-01',
    expected_completion_date: '2027-12-31',
    number_of_buildings: 3,
    number_of_floors: 9,
    number_of_units: 108,
    total_unit_area: 145800.00, // 108 * 1,350 avg
    total_common_area: 42000.00,
    total_construction_area: 187800.00,
    status: 'ACTIVE'
  };

  if (project) {
    await knex('projects').where({ id_projects: project.id_projects }).update(projectData);
    projectId = project.id_projects;
  } else {
    const [pId] = await knex('projects').insert(projectData);
    projectId = pId;
  }

  // 2. Create the 3 Connected Buildings: Tower A (Padma), Tower B (Meghna), Tower C (Jamuna)
  const towersConfig = [
    { code: 'TWR-A', name: 'Tower A - Padma (পদ্মা)', type: 'RESIDENTIAL', floors: 9, units: 36 },
    { code: 'TWR-B', name: 'Tower B - Meghna (মেঘনা)', type: 'RESIDENTIAL', floors: 9, units: 36 },
    { code: 'TWR-C', name: 'Tower C - Jamuna (যমুনা)', type: 'RESIDENTIAL', floors: 9, units: 36 }
  ];

  const buildingIdMap = {};

  for (const t of towersConfig) {
    let b = await knex('buildings').where({ id_projects: projectId, building_code: t.code }).first();
    const bData = {
            building_name: t.name,
      building_code: t.code,
      building_type: 'Residential',
      total_land_area: 7.50,
      total_land_area_sqft: 5400.00,
      total_floors: t.floors,
      total_units: t.units,
      address: `Shopno Bilash Campus, ${t.name}`,
      status: 'Under Construction',
      created_by: 6
    };

    if (b) {
      await knex('buildings').where({ id_buildings: b.id_buildings }).update(bData);
      buildingIdMap[t.code] = b.id_buildings;
    } else {
      const [newBId] = await knex('buildings').insert(bData);
      buildingIdMap[t.code] = newBId;
    }
  }

  // 3. Create Floors & Units for each of the 3 Buildings (9 Floors x 4 Units/Floor = 36 Units per Tower, Total = 108 Units)
  // Unit numbering: Tower A (A-101 to A-904), Tower B (B-101 to B-904), Tower C (C-101 to C-904)
  // Land share: Total 22.5 Katha for 3 towers = 16,200 SQFT. 16,200 / 108 = 150 SQFT per share = 0.2083 Katha.
  
  const unitSlots = [
    { slot: 'A', nameSuffix: 'Corner 3-BHK North-East', gross: 1420.00, carpet: 1150.00, common: 270.00, beds: 3, baths: 3, balconies: 3, facing: 'North-East', corner: true },
    { slot: 'B', nameSuffix: 'South-East 3-BHK', gross: 1380.00, carpet: 1120.00, common: 260.00, beds: 3, baths: 3, balconies: 2, facing: 'South-East', corner: false },
    { slot: 'C', nameSuffix: 'South-West 3-BHK', gross: 1350.00, carpet: 1090.00, common: 260.00, beds: 3, baths: 3, balconies: 2, facing: 'South-West', corner: false },
    { slot: 'D', nameSuffix: 'Corner 3-BHK North-West', gross: 1320.00, carpet: 1070.00, common: 250.00, beds: 3, baths: 2, balconies: 2, facing: 'North-West', corner: true }
  ];

  // The 3 Common Shares designations:
  // Tower A Unit A-101: Central Mosque & Imam Residence
  // Tower B Unit B-101: Executive Committee Meeting Room & Society Office
  // Tower C Unit C-101: Swimming Pool Club & Guest Hospitality Suite
  const commonSharesMap = {
    'A-101': 'MOSQUE_SUITE',
    'B-101': 'MEETING_ROOM',
    'C-101': 'SWIMMING_POOL_SUITE'
  };

  const createdUnitsMap = {};

  for (const t of towersConfig) {
    const bId = buildingIdMap[t.code];
    const towerPrefix = t.code.split('-')[1]; // 'A', 'B', or 'C'

    for (let fl = 1; fl <= 9; fl++) {
      let floor = await knex('floors').where({ id_projects: projectId, floor_number: fl }).first();
      let floorId = floor ? floor.id_floors : null;
      if (!floorId) {
        const [newFlId] = await knex('floors').insert({
                    floor_number: fl,
          floor_name: `Level ${fl}`,
          common_area: 800.00,
          number_of_units: 12
        });
        floorId = newFlId;
      }

      for (let uIdx = 1; uIdx <= 4; uIdx++) {
        const slotConfig = unitSlots[uIdx - 1];
        const unitNumber = `${towerPrefix}-${fl}0${uIdx}`; // e.g. A-101, B-503, C-904
        const isCommon = Boolean(commonSharesMap[unitNumber]);
        const commonType = commonSharesMap[unitNumber] || null;

        const existingUnit = await knex('units').where({ id_projects: projectId, unit_number: unitNumber }).first();
        const uPayload = {
                    id_buildings: bId,
          id_floors: floorId,
          unit_number: unitNumber,
          unit_slot: slotConfig.slot,
          unit_type: isCommon ? `Common Share: ${commonType}` : `3-BHK ${slotConfig.nameSuffix}`,
          area_sqft: slotConfig.gross,
          carpet_area_sqft: slotConfig.carpet,
          common_area_sqft: slotConfig.common,
          land_share_sqft: 150.00, // 16,200 sqft / 108 = 150 sqft
          land_share_katha: 0.2083, // 150 / 720
          facing_direction: slotConfig.facing,
          is_corner_unit: slotConfig.corner,
          bedrooms: isCommon ? 1 : slotConfig.beds,
          bathrooms: isCommon ? 2 : slotConfig.baths,
          balcony_veranda: slotConfig.balconies,
          status: isCommon ? 'RESERVED' : 'OWNED',
          is_common_share: isCommon ? 1 : 0,
          common_share_type: commonType
        };

        if (existingUnit) {
          await knex('units').where({ id_units: existingUnit.id_units }).update(uPayload);
          createdUnitsMap[unitNumber] = existingUnit.id_units;
        } else {
          const [uId] = await knex('units').insert(uPayload);
          createdUnitsMap[unitNumber] = uId;
        }
      }
    }
  }

  // 4. Owners Setup (Multiple Shares in Multiple Buildings demonstration)
  // Create / Update Common Society Owner for the 3 Common Shares
  let societyOwner = await knex('owners').where({ identification_reference: 'SOCIETY-SB-001' }).first();
  let societyOwnerId;
  if (!societyOwner) {
    const [sId] = await knex('owners').insert({
            full_name: 'Shopno Bilash Owners Welfare Society (Common Share Pool)',
      email: 'society@shopnobilash.org',
      phone: '+8801700000000',
      identification_reference: 'SOCIETY-SB-001',
      address: 'Shopno Bilash Central Office, Unit B-101',
      
      ownership_status: 'ACTIVE'
    });
    societyOwnerId = sId;
  } else {
    societyOwnerId = societyOwner.id_owners;
  }

  // Assign the 3 common shares (A-101, B-101, C-101) to Society Pool
  for (const commonUnitNo of ['A-101', 'B-101', 'C-101']) {
    const uId = createdUnitsMap[commonUnitNo];
    if (uId) {
      await knex('unit_ownerships').where({ id_units: uId }).del();
      await knex('unit_ownerships').insert({
        id_units: uId,
        id_owners: societyOwnerId,
        ownership_percentage: 100.00,
        agreement_date: '2025-01-10',
        status: 'ACTIVE'
      });
    }
  }

  // Key Individual Owners (with multiple shares across multiple buildings)
  const multiShareOwners = [
    {
      name: 'Engr. Kazi Tariqul Islam',
      nid: 'NID-SB-101',
      phone: '+8801711122334',
      email: 'tariqul@consultant.com',
      units: ['A-201', 'B-201', 'C-201'], // 3 shares across all 3 towers!
      note: 'Founding Member - Owns 1 flat in Tower A, 1 flat in Tower B, 1 flat in Tower C'
    },
    {
      name: 'Dr. Farhana Sultana',
      nid: 'NID-SB-102',
      phone: '+8801819988776',
      email: 'dr.farhana@apollo.com.bd',
      units: ['A-301', 'C-702'], // 2 shares in Tower A and Tower C!
      note: 'Associate Professor - Owns flat in Tower A (Padma) & Tower C (Jamuna)'
    },
    {
      name: 'Mr. Anisur Rahman & Mrs. Laila Rahman',
      nid: 'NID-SB-103',
      phone: '+8801912345678',
      email: 'anisur.laila@gmail.com',
      units: ['B-402', 'B-502'], // 2 shares duplex stack in Tower B!
      note: 'Senior Director - Owns 2 stacked flats in Tower B (Meghna)'
    },
    {
      name: 'Barrister Naimul Haque',
      nid: 'NID-SB-104',
      phone: '+8801733445566',
      email: 'naimul@haquelaw.com',
      units: ['A-804', 'B-804'], // 2 penthouse level shares in Tower A & B
      note: 'Supreme Court Advocate - 2 high-floor units in Tower A and Tower B'
    }
  ];

  for (const mOwner of multiShareOwners) {
    let oRecord = await knex('owners').where({ identification_reference: mOwner.nid }).first();
    let ownerId;
    if (!oRecord) {
      const [newOId] = await knex('owners').insert({
                full_name: mOwner.name,
        email: mOwner.email,
        phone: mOwner.phone,
        identification_reference: mOwner.nid,
        address: 'Dhaka, Bangladesh',
        
        ownership_status: 'ACTIVE'
      });
      ownerId = newOId;
    } else {
      ownerId = oRecord.id_owners;
    }

    for (const uNo of mOwner.units) {
      const uId = createdUnitsMap[uNo];
      if (uId) {
        await knex('unit_ownerships').where({ id_units: uId }).del();
        await knex('unit_ownerships').insert({
          id_units: uId,
          id_owners: ownerId,
          ownership_percentage: 100.00,
          agreement_date: '2025-02-15',
          status: 'ACTIVE'
        });
      }
    }
  }

  // Assign remaining units to standard owners up to 105 personal shares
  let ownerSeq = 105;
  for (const unitNo of Object.keys(createdUnitsMap)) {
    // Check if unit is already owned
    const uId = createdUnitsMap[unitNo];
    const existingOwnership = await knex('unit_ownerships').where({ id_units: uId }).first();
    if (!existingOwnership) {
      ownerSeq++;
      const nid = `NID-SB-${ownerSeq}`;
      let dummyOwner = await knex('owners').where({ identification_reference: nid }).first();
      let dOwnerId;
      if (!dummyOwner) {
        const [newDId] = await knex('owners').insert({
                    full_name: `Flat Owner (${unitNo})`,
          email: `owner.${unitNo.toLowerCase()}@shopnobilash.com`,
          phone: `+8801700${String(ownerSeq).padStart(6, '0')}`,
          identification_reference: nid,
          address: 'Dhaka, Bangladesh',
          
          ownership_status: 'ACTIVE'
        });
        dOwnerId = newDId;
      } else {
        dOwnerId = dummyOwner.id_owners;
      }

      await knex('unit_ownerships').insert({
        id_units: uId,
        id_owners: dOwnerId,
        ownership_percentage: 100.00,
        agreement_date: '2025-03-01',
        status: 'ACTIVE'
      });
    }
  }

  // 5. Setup Master Shares Configuration for Shopno Bilash
  await knex('master_shares').where({ id_projects: projectId }).del();
  await knex('master_shares').insert({
        project_title: 'Shopno Bilash (3 Connected Towers, 108 Units & 108 Shares)',
    total_land_katha: 22.50, // 22.5 Katha = 16,200 SQFT
    total_land_sqft: 16200.00,
    total_floors_count: 9,
    units_per_floor: 12, // 4 units x 3 towers = 12 units/floor
    total_units_count: 108,
    personal_shares_count: 105,
    common_shares_count: 3,
    total_shares_count: 108,
    connected_buildings_count: 3,
    connected_campus_name: 'Shopno Bilash Complex',
    total_buildable_area_sqft: 187800.00,
    common_space_percentage: 28.50,
    land_share_allocation_method: 'EQUAL_PER_UNIT', // 16,200 / 108 = 150 SQFT each = 0.2083 Katha
    common_area_allocation_method: 'FLOOR_COMMON_PLUS_BUILDING_COMMON',
    notes: 'Campus contains 3 inter-connected towers: Padma, Meghna, Jamuna. 108 total shares: 105 held by private owners, 3 common shares held in trust for Mosque, Meeting Hall, and Swimming Club.'
  });

  // 6. Setup Works: Campus Common Works vs Building-Specific Works vs Individual Unit Works
  await knex('construction_works').where({ id_projects: projectId }).del();

  const worksData = [
    // --- CAMPUS-WIDE COMMON WORKS (All 108 Units / 105 Personal Shares) ---
    {
            id_buildings: null, // NULL signifies Campus Common
      work_name: 'Central Juma Mosque & Ablution Complex Construction',
      work_category: 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: 'PROJECT_COMMON',
      facility_tag: 'MOSQUE',
      description: 'Capacity for 350 musallis with dedicated acoustic ceiling, mihrab, sound system, and separate women prayer area.',
      estimated_cost: 4500000.00,
      actual_cost: 3800000.00,
      progress_percentage: 85,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'EQUAL' // Split across 108 shares
    },
    {
            id_buildings: null,
      work_name: 'Society Executive Meeting Hall, Audio-Visual & Board Room',
      work_category: 'FINISHING',
      work_type: 'COMBINED',
      scope_level: 'PROJECT_COMMON',
      facility_tag: 'MEETING_ROOM',
      description: 'Air-conditioned conference center with 80-person seating, interactive digital projection, and committee secretariat.',
      estimated_cost: 2200000.00,
      actual_cost: 2150000.00,
      progress_percentage: 95,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'EQUAL'
    },
    {
            id_buildings: null,
      work_name: 'Rooftop Infinity Swimming Pool, Kids Pool & Filtration Plant',
      work_category: 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: 'PROJECT_COMMON',
      facility_tag: 'SWIMMING_POOL',
      description: 'Semi-olympic infinity pool connecting Towers B & C rooftop with automated chlorination and glass safety railings.',
      estimated_cost: 6800000.00,
      actual_cost: 4200000.00,
      progress_percentage: 60,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'EQUAL'
    },
    {
            id_buildings: null,
      work_name: 'Central 630 KVA Substation & Dual 300 KVA Diesel Generators',
      work_category: 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: 'PROJECT_COMMON',
      facility_tag: 'SUBSTATION',
      description: 'Synchronized power plant serving all 3 towers with underground HT cabling and automatic bus-tie transfer.',
      estimated_cost: 9500000.00,
      actual_cost: 9200000.00,
      progress_percentage: 90,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'AREA_BASED'
    },
    {
            id_buildings: null,
      work_name: 'Inter-Building Connecting Skywalks & Ground Podium Plaza',
      work_category: 'STRUCTURAL',
      work_type: 'COMBINED',
      scope_level: 'PROJECT_COMMON',
      facility_tag: 'CENTRAL_PODIUM',
      description: 'Structural steel sky-bridges at 5th level connecting Towers A-B and Towers B-C, plus ground landscaping and fountains.',
      estimated_cost: 5400000.00,
      actual_cost: 3100000.00,
      progress_percentage: 55,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'EQUAL'
    },

    // --- BUILDING-SPECIFIC WORKS (Allocated only to that Building) ---
    {
            id_buildings: buildingIdMap['TWR-A'],
      work_name: 'Tower A (Padma) Dual 10-Passenger High-Speed Elevators',
      work_category: 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: 'BUILDING_SPECIFIC',
      facility_tag: 'ELEVATOR',
      description: '2 high-speed gearless Fuji passenger elevators serving Tower A (Floors 1 to 9). Allocated only to Tower A 36 units.',
      estimated_cost: 5800000.00,
      actual_cost: 5500000.00,
      progress_percentage: 80,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'AREA_BASED'
    },
    {
            id_buildings: buildingIdMap['TWR-B'],
      work_name: 'Tower B (Meghna) Exterior WeatherCoat & Texture Façade',
      work_category: 'FINISHING',
      work_type: 'COMBINED',
      scope_level: 'BUILDING_SPECIFIC',
      facility_tag: 'FACADE',
      description: 'Silicon-based external weather barrier coating for Tower B. Allocated strictly to Tower B 36 units.',
      estimated_cost: 2100000.00,
      actual_cost: 1950000.00,
      progress_percentage: 75,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'AREA_BASED'
    },
    {
            id_buildings: buildingIdMap['TWR-C'],
      work_name: 'Tower C (Jamuna) Rooftop Solar Microgrid & Waterproofing',
      work_category: 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: 'BUILDING_SPECIFIC',
      facility_tag: 'SOLAR_ROOF',
      description: '35KW on-grid solar photovoltaic system and multi-layer chemical waterproofing for Tower C terrace.',
      estimated_cost: 2600000.00,
      actual_cost: 2400000.00,
      progress_percentage: 70,
      status: 'IN_PROGRESS',
      cost_allocation_method: 'EQUAL'
    }
  ];

  for (const w of worksData) {
    w.id_projects = projectId;
    const [wId] = await knex('construction_works').insert(w);

    // Auto-populate work_allocations
    // If PROJECT_COMMON: allocate to all 108 units
    // If BUILDING_SPECIFIC: allocate only to units in that building
    let targetUnitsQuery = knex('units').where({ id_projects: projectId });
    if (w.scope_level === 'BUILDING_SPECIFIC' && w.id_buildings) {
      targetUnitsQuery = targetUnitsQuery.andWhere({ id_buildings: w.id_buildings });
    }

    const targetUnits = await targetUnitsQuery.select('id_units', 'area_sqft');
    const unitCount = targetUnits.length || 1;
    const shareAmount = parseFloat((w.actual_cost / unitCount).toFixed(2));
    const allocPercent = parseFloat((100.0 / unitCount).toFixed(4));

    const allocRecords = targetUnits.map(u => ({
      id_works: wId,
      id_units: u.id_units,
      allocation_percentage: allocPercent,
      allocated_amount: shareAmount,
      is_custom: 0,
      notes: `${w.scope_level === 'PROJECT_COMMON' ? 'Campus-Wide Common' : 'Building-Specific'} share: ${w.work_name}`
    }));

    // Insert allocations in batches of 50
    for (let i = 0; i < allocRecords.length; i += 50) {
      await knex('work_allocations').insert(allocRecords.slice(i, i + 50));
    }
  }

  console.log('Shopno Bilash seed completed successfully: 3 buildings, 108 units, 108 shares, multi-building owners, campus & building works.');
};
