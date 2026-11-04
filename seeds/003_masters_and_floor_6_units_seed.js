exports.seed = async function(knex) {
  // 1. Populate Master Unit Templates (6 Units per floor: Slots A, B, C, D, E, F)
  // Total 7.5 Katha Land = 5,400 SQFT.
  // 6 Floors x 6 Units = 36 Units.
  // Each unit gets undivided land share proportional to its area.
  // Floor common lobby ~ 420 SFT per floor (70 SFT each).
  // Building common (lift core, staircase, ground floor reception, guard room, sub-station, rooftop community hall) = ~200 SFT each.
  
  await knex('master_unit_templates').del();
  await knex('master_unit_templates').insert([
    {
      unit_slot: 'A',
      template_name: 'Type A - South-East Corner Premium 3-BHK',
      gross_area_sqft: 1450.00,
      carpet_area_sqft: 1180.00,
      common_area_sqft: 270.00, // 70 floor common + 200 building common
      default_land_share_sqft: 165.50, // 5,400 sqft / 36 units proportional
      default_land_share_katha: 0.2299, // 165.50 / 720
      bedrooms: 3,
      bathrooms: 3,
      balconies: 3,
      facing_direction: 'South-East',
      is_corner_unit: true,
      description: 'Corner luxury unit with maximum natural airflow, 3 attached verandas, South-East road view.'
    },
    {
      unit_slot: 'B',
      template_name: 'Type B - South-Facing Standard 3-BHK',
      gross_area_sqft: 1350.00,
      carpet_area_sqft: 1100.00,
      common_area_sqft: 250.00,
      default_land_share_sqft: 154.00,
      default_land_share_katha: 0.2139,
      bedrooms: 3,
      bathrooms: 3,
      balconies: 2,
      facing_direction: 'South',
      is_corner_unit: false,
      description: 'Direct South-facing apartment with spacious master suite and modern open-plan kitchen.'
    },
    {
      unit_slot: 'C',
      template_name: 'Type C - South-West Corner 3-BHK',
      gross_area_sqft: 1400.00,
      carpet_area_sqft: 1140.00,
      common_area_sqft: 260.00,
      default_land_share_sqft: 159.80,
      default_land_share_katha: 0.2219,
      bedrooms: 3,
      bathrooms: 3,
      balconies: 2,
      facing_direction: 'South-West',
      is_corner_unit: true,
      description: 'Corner unit catching western sunset and southern breeze. Double glazed insulated windows.'
    },
    {
      unit_slot: 'D',
      template_name: 'Type D - North-West Corner Compact 3-BHK',
      gross_area_sqft: 1280.00,
      carpet_area_sqft: 1040.00,
      common_area_sqft: 240.00,
      default_land_share_sqft: 146.10,
      default_land_share_katha: 0.2029,
      bedrooms: 3,
      bathrooms: 2,
      balconies: 2,
      facing_direction: 'North-West',
      is_corner_unit: true,
      description: 'High efficiency compact 3-BHK layout with quiet rear view.'
    },
    {
      unit_slot: 'E',
      template_name: 'Type E - North-Facing Standard 2-BHK',
      gross_area_sqft: 1150.00,
      carpet_area_sqft: 930.00,
      common_area_sqft: 220.00,
      default_land_share_sqft: 131.20,
      default_land_share_katha: 0.1822,
      bedrooms: 2,
      bathrooms: 2,
      balconies: 2,
      facing_direction: 'North',
      is_corner_unit: false,
      description: 'Cozy, affordable 2-BHK layout with full dining and family living separation.'
    },
    {
      unit_slot: 'F',
      template_name: 'Type F - North-East Corner 3-BHK',
      gross_area_sqft: 1320.00,
      carpet_area_sqft: 1070.00,
      common_area_sqft: 250.00,
      default_land_share_sqft: 150.60,
      default_land_share_katha: 0.2092,
      bedrooms: 3,
      bathrooms: 3,
      balconies: 2,
      facing_direction: 'North-East',
      is_corner_unit: true,
      description: 'Pleasant morning sunlight with eastern exposure, wide balcony overlooking landscaping.'
    }
  ]);

  // 2. Populate Master Items Catalogue (Standard Materials & Rates in Bangladesh)
  await knex('master_items').del();
  await knex('master_items').insert([
    {
      item_code: 'MAT-CEM-01',
      item_name: 'Portland Composite Cement (PCC 42.5N) - Shah / Bashundhara',
      category: 'STRUCTURAL',
      sub_category: 'Cement',
      unit: 'Bags (50kg)',
      standard_rate: 580.00,
      minimum_stock_alert: 100,
      reorder_quantity: 500,
      technical_specification: 'BDS EN 197-1:2003 CEM II/B-M (S-V-L) 42.5N, 28-day strength >= 42.5 MPa.'
    },
    {
      item_code: 'MAT-STEEL-01',
      item_name: '500W TMT Rebar (16mm / 20mm / 25mm) - BSRM / AKS',
      category: 'STRUCTURAL',
      sub_category: 'Steel / Rod',
      unit: 'Metric Ton',
      standard_rate: 94500.00,
      minimum_stock_alert: 10,
      reorder_quantity: 35,
      technical_specification: 'BDS ISO 6935-2:2006 Grade 500W, Yield Strength >= 500 MPa, High ductility for seismic zone 2/3.'
    },
    {
      item_code: 'MAT-SAND-01',
      item_name: 'Sylhet Coarse Sand (FM 2.5 - 2.8)',
      category: 'STRUCTURAL',
      sub_category: 'Aggregates',
      unit: 'CFT',
      standard_rate: 75.00,
      minimum_stock_alert: 500,
      reorder_quantity: 2000,
      technical_specification: 'Washed coarse sand free from organic silt, fineness modulus 2.5 to 2.8 for RCC structural casting.'
    },
    {
      item_code: 'MAT-BRICK-01',
      item_name: 'First Class Machine-Made Gas Kiln Bricks',
      category: 'STRUCTURAL',
      sub_category: 'Masonry',
      unit: 'Thousand Pcs',
      standard_rate: 13500.00,
      minimum_stock_alert: 5,
      reorder_quantity: 25,
      technical_specification: 'Crushing strength min 2000 PSI, water absorption < 15%, standard 9.5" x 4.5" x 2.75".'
    },
    {
      item_code: 'MAT-STONE-01',
      item_name: 'Bholaganj Black Crushed Stone Chips (3/4" down)',
      category: 'STRUCTURAL',
      sub_category: 'Aggregates',
      unit: 'CFT',
      standard_rate: 185.00,
      minimum_stock_alert: 400,
      reorder_quantity: 1500,
      technical_specification: 'Hard granite/boulder crushed stone, aggregate impact value < 18%.'
    },
    {
      item_code: 'FIN-TILE-01',
      item_name: 'RAK / DBL Homogeneous Mirror Polish Floor Tiles (24"x24")',
      category: 'FINISHING',
      sub_category: 'Tiles',
      unit: 'SFT',
      standard_rate: 145.00,
      minimum_stock_alert: 1000,
      reorder_quantity: 4000,
      technical_specification: 'Double charged porcelain vitrified tile, nano-coating scratch resistant.'
    },
    {
      item_code: 'FIN-PAINT-01',
      item_name: 'Berger WeatherCoat Smooth Luxury Exterior / Interior Silk Emulsion',
      category: 'FINISHING',
      sub_category: 'Paint',
      unit: 'Drum (18.2L)',
      standard_rate: 6850.00,
      minimum_stock_alert: 10,
      reorder_quantity: 30,
      technical_specification: 'Anti-fungal polyurethane emulsion with 7-year weather barrier warranty.'
    },
    {
      item_code: 'ELE-CBL-01',
      item_name: 'BRB / BBS Multi-Strand FR Copper Cable (2.5 sq mm)',
      category: 'ELECTRICAL',
      sub_category: 'Cables',
      unit: 'Coil (100m)',
      standard_rate: 4200.00,
      minimum_stock_alert: 20,
      reorder_quantity: 100,
      technical_specification: '99.99% pure annealed electrolytic copper, Flame Retardant (FR) grade PVC insulation.'
    },
    {
      item_code: 'SAN-PIPE-01',
      item_name: 'National Polymer / RFL uPVC SWR Pipe 4" (Class D)',
      category: 'SANITARY',
      sub_category: 'Plumbing',
      unit: 'Length (10ft)',
      standard_rate: 680.00,
      minimum_stock_alert: 30,
      reorder_quantity: 150,
      technical_specification: 'Soil, Waste and Rainwater UV resistant pipe with rubber ring socket.'
    },
    {
      item_code: 'EQP-GEN-01',
      item_name: 'Perkins / Cummins 150 KVA Soundproof Diesel Canopy Generator',
      category: 'HVAC_GENERATOR',
      sub_category: 'Power Equipment',
      unit: 'Set',
      standard_rate: 2250000.00,
      minimum_stock_alert: 1,
      reorder_quantity: 1,
      technical_specification: 'UK engine, Stamford alternator, DeepSea automatic mains failure (AMF) panel.'
    }
  ]);

  // 3. Populate Master Shares for the Project
  const project = await knex('projects').first();
  const projectId = project ? project.id_projects : 1;

  await knex('master_shares').del();
  await knex('master_shares').insert([
    {
      id_projects: projectId,
      project_title: 'Green Valley Skyline Residence (36 Units Master)',
      total_land_katha: 7.50,
      total_land_sqft: 5400.00, // 7.5 * 720 SFT
      total_floors_count: 6,
      units_per_floor: 6, // 6 units per floor
      total_units_count: 36, // 6 floors * 6 units = 36 flats
      total_buildable_area_sqft: 48600.00, // 8,100 SFT per floor x 6
      common_space_percentage: 24.50,
      land_share_allocation_method: 'PROPORTIONAL_TO_AREA',
      common_area_allocation_method: 'FLOOR_COMMON_PLUS_BUILDING_COMMON',
      notes: 'Standard Bangladeshi joint apartment deed. 1 Katha = 720 SQFT. Undivided and impartible registered land share per flat.'
    }
  ]);

  // 4. Populate Master Works (Standard WBS Catalogue)
  await knex('master_works').del();
  await knex('master_works').insert([
    {
      work_code: 'WBS-SUB-01',
      work_name: 'Piling & Deep Foundation Cast-in-situ Works',
      category: 'STRUCTURAL',
      scope_level: 'BUILDING_COMMON',
      default_allocation_rule: 'ALL_UNITS_AREA_BASED',
      standard_budget_estimate: 8500000.00,
      standard_scope_notes: 'Includes 75 nos 60ft bored cast-in-situ piles, pile caps, foundation beam and sub-surface waterproofing.'
    },
    {
      work_code: 'WBS-FLR-01',
      work_name: 'Floor Lobby & Corridor Tiling & False Ceiling Work',
      category: 'FINISHING',
      scope_level: 'FLOOR_COMMON',
      default_allocation_rule: 'FLOOR_6_UNITS_EQUAL',
      standard_budget_estimate: 240000.00,
      standard_scope_notes: 'Specific to each floor corridor, shared equally by the 6 flat owners on that specific floor.'
    },
    {
      work_code: 'WBS-LIFT-01',
      work_name: 'Dual High-Speed Passenger Elevators (8-Passenger Fuji/Sigma)',
      category: 'FACILITIES_MEP',
      scope_level: 'BUILDING_COMMON',
      default_allocation_rule: 'ALL_UNITS_AREA_BASED',
      standard_budget_estimate: 5800000.00,
      standard_scope_notes: '2 elevators serving all 6 floors, automatic rescue device (ARD), VVVF drive.'
    },
    {
      work_code: 'WBS-GEN-01',
      work_name: 'Sub-station Transformer 250KVA & Soundproof Generator 150KVA',
      category: 'FACILITIES_MEP',
      scope_level: 'BUILDING_COMMON',
      default_allocation_rule: 'ALL_UNITS_AREA_BASED',
      standard_budget_estimate: 4200000.00,
      standard_scope_notes: 'Power backup for all common services, lifts, water pumps, plus 3 light & 2 fan points per flat.'
    },
    {
      work_code: 'WBS-FLAT-INT-01',
      work_name: 'Internal Unit Premium Bath Fixtures & Custom Cabinets',
      category: 'INDIVIDUAL_INTERIOR',
      scope_level: 'INDIVIDUAL_UNIT',
      default_allocation_rule: 'INDIVIDUAL_UNIT_ONLY',
      standard_budget_estimate: 450000.00,
      standard_scope_notes: 'Billed 100% directly to the specific flat owner requesting custom marble counters or branded sanitary fittings.'
    },
    {
      work_code: 'WBS-ROOF-01',
      work_name: 'Rooftop Landscaped Garden, Community Room & Solar Grid',
      category: 'EXTERNAL_CIVIL',
      scope_level: 'BUILDING_COMMON',
      default_allocation_rule: 'ALL_UNITS_EQUAL',
      standard_budget_estimate: 1800000.00,
      standard_scope_notes: 'Rooftop recreation shared by all 36 owners equally.'
    }
  ]);

  // 5. Populate Master Vendor Categories
  await knex('master_vendor_categories').del();
  await knex('master_vendor_categories').insert([
    { category_code: 'VND-RMC', category_name: 'Ready-Mix Concrete Suppliers', trade_type: 'Civil Materials', default_retention_percent: 5.00, default_payment_terms: '15 Days from Cylinder Test' },
    { category_code: 'VND-STL', category_name: 'Steel Rebar Manufacturers', trade_type: 'Structural Rebar', default_retention_percent: 3.00, default_payment_terms: 'Cash against weighbridge challan' },
    { category_code: 'VND-MEP', category_name: 'MEP & Substation Contractors', trade_type: 'Electrical & Mechanical', default_retention_percent: 10.00, default_payment_terms: 'Milestone Progress Bill' },
    { category_code: 'VND-LFT', category_name: 'Elevator & Lift Contractors', trade_type: 'Vertical Transportation', default_retention_percent: 10.00, default_payment_terms: 'LC + Installation Milestones' },
    { category_code: 'VND-FIN', category_name: 'Tiles & Sanitary Ware Distributors', trade_type: 'Architectural Finishing', default_retention_percent: 5.00, default_payment_terms: 'Net 30 Days' },
    { category_code: 'VND-LAB', category_name: 'Civil Labour Contractors', trade_type: 'Labour & Formwork', default_retention_percent: 5.00, default_payment_terms: 'Weekly Measurement Bill' }
  ]);

  // 6. Ensure floors 1 through 6 have their 6 units (Slots A, B, C, D, E, F) created
  const templates = await knex('master_unit_templates').select('*');
  const templateMap = {};
  templates.forEach(t => { templateMap[t.unit_slot] = t; });

  for (let floorNum = 1; floorNum <= 6; floorNum++) {
    // Check or create floor
    let floorRecord = await knex('floors').where({ id_projects: projectId, floor_number: floorNum }).first();
    if (!floorRecord) {
      const [floorId] = await knex('floors').insert({
        id_projects: projectId,
        floor_number: floorNum,
        floor_name: `Floor ${floorNum} (6 Units Level)`,
        floor_type: 'RESIDENTIAL',
        total_units_on_floor: 6,
        floor_common_area_sqft: 420.00
      });
      floorRecord = { id_floors: floorId };
    }

    // Now populate/update the 6 units: A, B, C, D, E, F
    const slots = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const slot of slots) {
      const unitNumber = `${floorNum}${slot}`; // e.g. 1A, 1B, 1C, 1D, 1E, 1F, 2A...
      const tmpl = templateMap[slot] || templateMap['A'];

      const existingUnit = await knex('units').where({ id_projects: projectId, unit_number: unitNumber }).first();
      const unitData = {
        id_projects: projectId,
        id_floors: floorRecord.id_floors,
        unit_number: unitNumber,
        unit_slot: slot,
        unit_type: `${tmpl.bedrooms}-BHK Type ${slot}`,
        area_sqft: tmpl.gross_area_sqft,
        carpet_area_sqft: tmpl.carpet_area_sqft,
        common_area_sqft: tmpl.common_area_sqft,
        land_share_sqft: tmpl.default_land_share_sqft,
        land_share_katha: tmpl.default_land_share_katha,
        facing_direction: tmpl.facing_direction,
        is_corner_unit: tmpl.is_corner_unit,
        bedrooms: tmpl.bedrooms,
        bathrooms: tmpl.bathrooms,
        balcony_veranda: tmpl.balconies,
        status: existingUnit ? existingUnit.status : 'AVAILABLE'
      };

      if (existingUnit) {
        await knex('units').where({ id_units: existingUnit.id_units }).update(unitData);
      } else {
        await knex('units').insert(unitData);
      }
    }
  }
};
