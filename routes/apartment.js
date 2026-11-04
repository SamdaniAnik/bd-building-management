const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const checkAuth = require('../middleware/auth');
const { loadFineContext, fineFor } = require('../utils/latefee');

// Audit logger helper
async function logAudit(userName, action, entityType, entityId, oldValue, newValue) {
  try {
    await db('audit_logs').insert({
      user_name: userName || 'System',
      action,
      entity_type: entityType,
      entity_id: String(entityId || ''),
      old_value: oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : null,
      new_value: newValue ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : null,
      created_at: new Date()
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 0. PROJECTS LIST & SWITCHER
// ─────────────────────────────────────────────────────────────
router.get('/projects', async (req, res) => {
  try {
    const projects = await db('projects').select('*').orderBy('id_projects', 'desc');
    res.json({ success: true, projects });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1. DASHBOARD & KPIS
// ─────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const pId = req.query.projectId ? parseInt(req.query.projectId) : 3; // Default to Shopno Bilash (id 3)
    const project = await db('projects').where({ id_projects: pId }).first()
      || await db('projects').where({ project_code: 'SHOPNO-BILASH-108' }).first()
      || await db('projects').first();
    const projectId = project ? project.id_projects : 3;
    const units = await db('units').where({ id_projects: projectId }).select('*');
    const works = await db('construction_works').where({ id_projects: projectId }).select('*');
    const contributions = await db('owner_contributions').select('*');
    const invoices = await db('vendor_invoices').select('*');
    const vendorPayments = await db('vendor_payments').select('*');
    const loans = await db('owner_loans').select('*');
    const budgets = await db('budgets').select('*');

    // Total Project Cost: sum of all actual costs of works
    const totalProjectCost = works.reduce((sum, w) => sum + parseFloat(w.actual_cost || w.estimated_cost || 0), 0);
    const combinedCost = works.filter(w => w.work_type === 'COMBINED').reduce((sum, w) => sum + parseFloat(w.actual_cost || 0), 0);
    const individualCost = works.filter(w => w.work_type === 'INDIVIDUAL' || w.work_type === 'EXTRA_WORK').reduce((sum, w) => sum + parseFloat(w.actual_cost || 0), 0);

    // Total Owner Contributions Paid
    const totalPaid = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);

    // Total Invoices & Vendor Payable
    const totalVendorInvoiced = invoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    const totalVendorPaid = vendorPayments.reduce((sum, vp) => sum + parseFloat(vp.amount || 0), 0);
    const vendorPayable = Math.max(0, totalVendorInvoiced - totalVendorPaid);

    // Total Owner Liability & Receivable
    const totalLiability = totalProjectCost;
    const ownerReceivable = Math.max(0, totalLiability - totalPaid);

    // Loans
    const totalLoanApproved = loans.reduce((sum, l) => sum + parseFloat(l.approved_amount || 0), 0);
    const totalLoanDisbursed = loans.reduce((sum, l) => sum + parseFloat(l.disbursed_amount || 0), 0);
    const totalLoanOutstanding = loans.reduce((sum, l) => sum + parseFloat(l.outstanding_amount || 0), 0);

    // Cost by Category
    const categoryMap = {};
    works.forEach(w => {
      const cat = w.work_category || 'General';
      categoryMap[cat] = (categoryMap[cat] || 0) + parseFloat(w.actual_cost || 0);
    });
    const costByCategory = Object.keys(categoryMap).map(k => ({ category: k, amount: categoryMap[k] }));

    // Cost by Unit
    const allocations = await db('work_allocations').select('*');
    const unitMap = {};
    units.forEach(u => {
      unitMap[u.id_units] = {
        unit_id: u.id_units,
        unit_number: u.unit_number,
        area_sqft: parseFloat(u.area_sqft),
        combined_share: 0,
        individual_cost: 0,
        total_liability: 0,
        total_paid: 0,
        outstanding: 0
      };
    });

    allocations.forEach(a => {
      if (unitMap[a.id_units]) {
        unitMap[a.id_units].total_liability += parseFloat(a.allocated_amount || 0);
        if (a.is_custom) {
          unitMap[a.id_units].individual_cost += parseFloat(a.allocated_amount || 0);
        } else {
          unitMap[a.id_units].combined_share += parseFloat(a.allocated_amount || 0);
        }
      }
    });

    contributions.forEach(c => {
      if (c.id_units && unitMap[c.id_units]) {
        unitMap[c.id_units].total_paid += parseFloat(c.amount || 0);
      }
    });

    Object.values(unitMap).forEach(u => {
      u.outstanding = Math.max(0, u.total_liability - u.total_paid);
    });

    const costByUnit = Object.values(unitMap);

    // Budget vs Actual
    const budgetVsActual = budgets.map(b => ({
      category: b.category,
      budget: parseFloat(b.revised_budget || b.original_budget || 0),
      actual: parseFloat(b.actual_spent || 0),
      variance: parseFloat(b.revised_budget || 0) - parseFloat(b.actual_spent || 0),
      variance_percent: b.revised_budget > 0 ? (((b.revised_budget - b.actual_spent) / b.revised_budget) * 100).toFixed(1) : 0
    }));

    // Recent audits & notifications
    const recentAudits = await db('audit_logs').orderBy('created_at', 'desc').limit(6);
    const notifications = await db('notifications').orderBy('created_at', 'desc').limit(5);

    res.json({
      success: true,
      data: {
        project,
        kpis: {
          total_project_cost: totalProjectCost,
          total_paid: totalPaid,
          total_outstanding: ownerReceivable,
          vendor_payable: vendorPayable,
          owner_receivable: ownerReceivable,
          combined_cost: combinedCost,
          individual_cost: individualCost,
          total_loan_approved: totalLoanApproved,
          total_loan_disbursed: totalLoanDisbursed,
          total_loan_outstanding: totalLoanOutstanding,
          total_units: units.length,
          overall_progress: 78
        },
        costByCategory,
        costByUnit,
        budgetVsActual,
        recentAudits,
        notifications
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. UNITS & APARTMENT DETAILS
// ─────────────────────────────────────────────────────────────
router.get('/units', async (req, res) => {
  try {
    const pId = req.query.projectId ? parseInt(req.query.projectId) : 3;
    let unitQuery = db('units')
      .leftJoin('floors', 'units.id_floors', 'floors.id_floors')
      .leftJoin('buildings', 'units.id_buildings', 'buildings.id_buildings');
    if (pId) {
      unitQuery = unitQuery.where('units.id_projects', pId);
    }
    const units = await unitQuery
      .select('units.*', 'floors.floor_name', 'floors.floor_number', 'buildings.building_name', 'buildings.building_code')
      .orderBy('units.id_buildings', 'asc')
      .orderBy('units.unit_number', 'asc');

    const ownerships = await db('unit_ownerships')
      .join('owners', 'unit_ownerships.id_owners', 'owners.id_owners')
      .select('unit_ownerships.*', 'owners.full_name', 'owners.phone', 'owners.email');

    const allocations = await db('work_allocations').select('*');
    const contributions = await db('owner_contributions').select('*');

    const result = units.map(u => {
      const unitOwners = ownerships.filter(o => o.id_units === u.id_units);
      const unitAllocations = allocations.filter(a => a.id_units === u.id_units);
      const combinedShare = unitAllocations.filter(a => !a.is_custom).reduce((sum, a) => sum + parseFloat(a.allocated_amount || 0), 0);
      const individualCost = unitAllocations.filter(a => a.is_custom).reduce((sum, a) => sum + parseFloat(a.allocated_amount || 0), 0);
      const totalLiability = combinedShare + individualCost;
      const totalPaid = contributions.filter(c => c.id_units === u.id_units).reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
      const outstanding = Math.max(0, totalLiability - totalPaid);

      return {
        ...u,
        owners: unitOwners,
        combined_share: combinedShare,
        individual_cost: individualCost,
        total_liability: totalLiability,
        total_paid: totalPaid,
        outstanding
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get units error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/units/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const unit = await db('units').where('id_units', id).first();
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });

    const rooms = await db('unit_rooms').where('id_units', id);
    const ownerships = await db('unit_ownerships')
      .join('owners', 'unit_ownerships.id_owners', 'owners.id_owners')
      .where('unit_ownerships.id_units', id)
      .select('unit_ownerships.*', 'owners.full_name', 'owners.phone', 'owners.email', 'owners.address', 'owners.identification_reference');

    const works = await db('work_allocations')
      .join('construction_works', 'work_allocations.id_works', 'construction_works.id_works')
      .where('work_allocations.id_units', id)
      .select('work_allocations.*', 'construction_works.work_name', 'construction_works.work_type', 'construction_works.status as work_status', 'construction_works.actual_cost as total_work_cost');

    const contributions = await db('owner_contributions')
      .where('id_units', id)
      .orderBy('payment_date', 'desc');

    const loans = await db('owner_loans')
      .where('id_units', id);

    const combinedShare = works.filter(w => !w.is_custom).reduce((sum, w) => sum + parseFloat(w.allocated_amount || 0), 0);
    const individualCost = works.filter(w => w.is_custom).reduce((sum, w) => sum + parseFloat(w.allocated_amount || 0), 0);
    const totalLiability = combinedShare + individualCost;
    const totalPaid = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
    const outstanding = Math.max(0, totalLiability - totalPaid);

    res.json({
      success: true,
      data: {
        ...unit,
        rooms,
        owners: ownerships,
        works,
        contributions,
        loans,
        financial_summary: {
          combined_share: combinedShare,
          individual_cost: individualCost,
          total_liability: totalLiability,
          total_paid: totalPaid,
          outstanding
        }
      }
    });
  } catch (err) {
    console.error('Unit details error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. OWNERS & MULTI-OWNER MANAGEMENT
// ─────────────────────────────────────────────────────────────
router.get('/owners', async (req, res) => {
  try {
    const pId = req.query.projectId ? parseInt(req.query.projectId) : 3;
    let ownersQuery = db('owners');
    if (pId) {
      const ownerIdsInProject = await db('unit_ownerships')
        .join('units', 'unit_ownerships.id_units', 'units.id_units')
        .where('units.id_projects', pId)
        .distinct('unit_ownerships.id_owners');
      const ids = ownerIdsInProject.map(r => r.id_owners);
      if (ids.length > 0) {
        ownersQuery = ownersQuery.whereIn('id_owners', ids);
      }
    }
    const owners = await ownersQuery.select('*').orderBy('id_owners', 'asc');
    const ownerships = await db('unit_ownerships')
      .join('units', 'unit_ownerships.id_units', 'units.id_units')
      .select('unit_ownerships.*', 'units.unit_number', 'units.area_sqft');

    const contributions = await db('owner_contributions').select('*');
    const allocations = await db('work_allocations').select('*');
    const loans = await db('owner_loans').select('*');

    const result = owners.map(o => {
      const myUnits = ownerships.filter(uo => uo.id_owners === o.id_owners);
      const myLoans = loans.filter(l => l.id_owners === o.id_owners);
      const totalLoanApproved = myLoans.reduce((sum, l) => sum + parseFloat(l.approved_amount || 0), 0);
      const totalLoanDisbursed = myLoans.reduce((sum, l) => sum + parseFloat(l.disbursed_amount || 0), 0);

      // Calculate liability proportional to ownership percentage
      let totalLiability = 0;
      myUnits.forEach(u => {
        const unitAlloc = allocations.filter(a => a.id_units === u.id_units);
        const unitCost = unitAlloc.reduce((sum, a) => sum + parseFloat(a.allocated_amount || 0), 0);
        totalLiability += (unitCost * (parseFloat(u.ownership_percentage || 100) / 100));
      });

      const totalPaid = contributions.filter(c => c.id_owners === o.id_owners).reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
      const outstanding = Math.max(0, totalLiability - totalPaid);

      return {
        ...o,
        units: myUnits,
        total_liability: totalLiability,
        total_paid: totalPaid,
        outstanding,
        loan_approved: totalLoanApproved,
        loan_disbursed: totalLoanDisbursed
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Owners error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/owners/:id/ledger', async (req, res) => {
  try {
    const { id } = req.params;
    const owner = await db('owners').where('id_owners', id).first();
    if (!owner) return res.status(404).json({ success: false, message: 'Owner not found' });

    const ledger = await db('owner_ledgers')
      .where('id_owners', id)
      .orderBy('transaction_date', 'asc');

    const contributions = await db('owner_contributions').where('id_owners', id).orderBy('payment_date', 'desc');

    res.json({ success: true, data: { owner, ledger, contributions } });
  } catch (err) {
    console.error('Owner ledger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. CONSTRUCTION WORKS & COMBINED COST ALLOCATION ENGINE
// ─────────────────────────────────────────────────────────────
router.get('/works', async (req, res) => {
  try {
    const works = await db('construction_works')
      .leftJoin('vendors', 'construction_works.id_vendors', 'vendors.id_vendors')
      .leftJoin('units', 'construction_works.id_units', 'units.id_units')
      .leftJoin('owners', 'construction_works.id_owners', 'owners.id_owners')
      .select(
        'construction_works.*',
        'vendors.company_name as vendor_name',
        'units.unit_number',
        'owners.full_name as owner_name'
      )
      .orderBy('construction_works.id_works', 'asc');

    const allocations = await db('work_allocations')
      .join('units', 'work_allocations.id_units', 'units.id_units')
      .select('work_allocations.*', 'units.unit_number');

    const worksWithAlloc = works.map(w => ({
      ...w,
      allocations: allocations.filter(a => a.id_works === w.id_works)
    }));

    res.json({ success: true, data: worksWithAlloc });
  } catch (err) {
    console.error('Works error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/apartment/works - Create work and allocate
router.post('/works', async (req, res) => {
  try {
    const {
      work_name,
      work_category,
      work_type, // COMBINED or INDIVIDUAL or EXTRA_WORK
      description,
      estimated_cost,
      actual_cost,
      start_date,
      expected_completion,
      progress_percentage,
      status,
      id_vendors,
      id_units,
      id_owners,
      cost_allocation_method, // EQUAL, AREA_BASED, PERCENTAGE, CUSTOM
      custom_allocations // optional array of { id_units, allocated_amount, allocation_percentage }
    } = req.body;

    const project = await db('projects').first();
    const finalAmount = parseFloat(actual_cost || estimated_cost || 0);

    const [workId] = await db('construction_works').insert({
      id_projects: project ? project.id_projects : 1,
      id_vendors: id_vendors || null,
      id_units: (work_type === 'INDIVIDUAL' || work_type === 'EXTRA_WORK') ? id_units : null,
      id_owners: (work_type === 'INDIVIDUAL' || work_type === 'EXTRA_WORK') ? id_owners : null,
      work_name,
      work_category: work_category || 'General',
      work_type: work_type || 'COMBINED',
      description,
      estimated_cost: estimated_cost || finalAmount,
      actual_cost: finalAmount,
      start_date,
      expected_completion,
      progress_percentage: progress_percentage || 0,
      status: status || 'IN_PROGRESS',
      cost_allocation_method: cost_allocation_method || 'AREA_BASED',
      extra_work_status: work_type === 'EXTRA_WORK' ? 'REQUESTED' : 'NOT_APPLICABLE'
    });

    // ALLOCATION ENGINE:
    if (work_type === 'INDIVIDUAL' || work_type === 'EXTRA_WORK') {
      // Individual work strictly allocated 100% to the specific unit/owner
      await db('work_allocations').insert({
        id_works: workId,
        id_units: id_units,
        id_owners: id_owners || null,
        allocation_percentage: 100.00,
        allocated_amount: finalAmount,
        is_custom: true,
        notes: `Individual work assigned exclusively to Unit ${id_units}`
      });

      // Also record debit in owner ledger if owner specified
      if (id_owners) {
        await db('owner_ledgers').insert({
          id_owners,
          id_units,
          transaction_date: start_date || new Date().toISOString().split('T')[0],
          entry_type: 'DEBIT',
          category: work_type === 'EXTRA_WORK' ? 'EXTRA_WORK' : 'INDIVIDUAL_WORK',
          description: `${work_name} (Individual Upgrade)`,
          debit_amount: finalAmount,
          credit_amount: 0,
          running_balance: finalAmount,
          reference_id: `WRK-${workId}`
        });
      }
    } else {
      // COMBINED WORK: allocate among all units
      const units = await db('units').select('*');
      const totalUnits = units.length;
      const totalArea = units.reduce((sum, u) => sum + parseFloat(u.area_sqft || 0), 0);

      let allocatedSum = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        let unitAmt = 0;
        let pct = 0;

        if (cost_allocation_method === 'EQUAL') {
          pct = (100 / totalUnits);
          unitAmt = parseFloat((finalAmount / totalUnits).toFixed(2));
        } else if (cost_allocation_method === 'AREA_BASED') {
          pct = totalArea > 0 ? (parseFloat(u.area_sqft) / totalArea) * 100 : (100 / totalUnits);
          unitAmt = parseFloat(((parseFloat(u.area_sqft) / totalArea) * finalAmount).toFixed(2));
        } else if (custom_allocations && custom_allocations.length > 0) {
          const match = custom_allocations.find(ca => String(ca.id_units) === String(u.id_units));
          if (match) {
            unitAmt = parseFloat(match.allocated_amount || 0);
            pct = parseFloat(match.allocation_percentage || 0);
          }
        }

        // Adjust rounding on last unit to ensure sum equals exact total
        if (i === units.length - 1) {
          unitAmt = parseFloat((finalAmount - allocatedSum).toFixed(2));
        }
        allocatedSum += unitAmt;

        // Get owner for unit
        const uOwner = await db('unit_ownerships').where('id_units', u.id_units).first();

        await db('work_allocations').insert({
          id_works: workId,
          id_units: u.id_units,
          id_owners: uOwner ? uOwner.id_owners : null,
          allocation_percentage: pct,
          allocated_amount: unitAmt,
          is_custom: false,
          notes: `Combined work allocation via ${cost_allocation_method}`
        });

        if (uOwner) {
          await db('owner_ledgers').insert({
            id_owners: uOwner.id_owners,
            id_units: u.id_units,
            transaction_date: start_date || new Date().toISOString().split('T')[0],
            entry_type: 'DEBIT',
            category: 'COMBINED_COST',
            description: `${work_name} (Combined Share)`,
            debit_amount: unitAmt,
            credit_amount: 0,
            running_balance: unitAmt,
            reference_id: `WRK-${workId}`
          });
        }
      }
    }

    await logAudit(req.user ? req.user.name : 'Admin', 'Created Construction Work', 'WORK', workId, null, { work_name, finalAmount, work_type });

    res.json({ success: true, message: 'Work created and cost allocated successfully', id: workId });
  } catch (err) {
    console.error('Create work error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PREVIEW ALLOCATION BEFORE SAVING (Section 10 Requirement)
router.post('/preview-allocation', async (req, res) => {
  try {
    const { amount, method, custom_amounts } = req.body;
    const finalAmount = parseFloat(amount || 0);
    const units = await db('units').select('*');
    const totalUnits = units.length;
    const totalArea = units.reduce((sum, u) => sum + parseFloat(u.area_sqft || 0), 0);

    let allocatedSum = 0;
    const allocations = units.map((u, i) => {
      let unitAmt = 0;
      let pct = 0;

      if (method === 'EQUAL') {
        pct = (100 / totalUnits);
        unitAmt = parseFloat((finalAmount / totalUnits).toFixed(2));
      } else if (method === 'AREA_BASED') {
        pct = totalArea > 0 ? (parseFloat(u.area_sqft) / totalArea) * 100 : (100 / totalUnits);
        unitAmt = parseFloat(((parseFloat(u.area_sqft) / totalArea) * finalAmount).toFixed(2));
      } else if (method === 'CUSTOM' && custom_amounts) {
        unitAmt = parseFloat(custom_amounts[u.id_units] || 0);
        pct = finalAmount > 0 ? (unitAmt / finalAmount) * 100 : 0;
      }

      if (i === units.length - 1 && method !== 'CUSTOM') {
        unitAmt = parseFloat((finalAmount - allocatedSum).toFixed(2));
        pct = finalAmount > 0 ? (unitAmt / finalAmount) * 100 : 0;
      }
      allocatedSum += unitAmt;

      return {
        id_units: u.id_units,
        unit_number: u.unit_number,
        area_sqft: parseFloat(u.area_sqft),
        percentage: parseFloat(pct.toFixed(2)),
        amount: unitAmt
      };
    });

    const sumCheck = allocations.reduce((s, a) => s + a.amount, 0);

    res.json({
      success: true,
      data: {
        total_amount: finalAmount,
        method,
        allocations,
        calculated_sum: sumCheck,
        is_balanced: Math.abs(sumCheck - finalAmount) < 0.05
      }
    });
  } catch (err) {
    console.error('Preview allocation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Extra Work Workflow (Section 12: REQUESTED -> QUOTATION -> OWNER APPROVAL -> APPROVED -> IN PROGRESS -> COMPLETED -> INVOICED -> PAID)
router.patch('/works/:id/extra-work-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db('construction_works').where('id_works', id).update({
      extra_work_status: status,
      updated_at: new Date()
    });
    await logAudit(req.user ? req.user.name : 'Admin', 'Updated Extra Work Status', 'WORK', id, null, status);
    res.json({ success: true, message: `Extra work updated to ${status}` });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. BOQ & MATERIALS MANAGEMENT
// ─────────────────────────────────────────────────────────────
router.get('/materials', async (req, res) => {
  try {
    const materials = await db('materials').select('*').orderBy('id_materials', 'asc');
    res.json({ success: true, data: materials });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/materials', async (req, res) => {
  try {
    const { material_name, category, unit, current_rate, previous_rate, supplier } = req.body;
    const [id] = await db('materials').insert({
      material_name, category, unit,
      current_rate: current_rate || 0,
      previous_rate: previous_rate || 0,
      supplier,
      last_updated_date: new Date().toISOString().split('T')[0]
    });
    await logAudit(req.user ? req.user.name : 'Admin', 'Created Material', 'MATERIAL', id, null, material_name);
    res.json({ success: true, message: 'Material added', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/boq/:workId', async (req, res) => {
  try {
    const { workId } = req.params;
    const items = await db('boq_items').where('id_works', workId).orderBy('id_boq', 'asc');
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/boq', async (req, res) => {
  try {
    const { id_works, item_name, quantity, unit, rate, discount, tax } = req.body;
    const qty = parseFloat(quantity || 0);
    const rt = parseFloat(rate || 0);
    const amount = qty * rt;
    const disc = parseFloat(discount || 0);
    const tx = parseFloat(tax || 0);
    const total = amount - disc + tx;

    const [id] = await db('boq_items').insert({
      id_works,
      item_name,
      quantity: qty,
      unit: unit || 'Unit',
      rate: rt,
      amount,
      subtotal: amount,
      discount: disc,
      tax: tx,
      total
    });

    res.json({ success: true, message: 'BOQ item recorded', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 6. VENDORS, QUOTATIONS, POS, INVOICES, PAYMENTS & LEDGER
// ─────────────────────────────────────────────────────────────
router.get('/vendors', async (req, res) => {
  try {
    const vendors = await db('vendors').select('*').orderBy('id_vendors', 'asc');
    const invoices = await db('vendor_invoices').select('*');
    const payments = await db('vendor_payments').select('*');

    const result = vendors.map(v => {
      const vInvoices = invoices.filter(i => i.id_vendors === v.id_vendors);
      const vPayments = payments.filter(p => p.id_vendors === v.id_vendors);
      const totalInvoiced = vInvoices.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
      const totalPaid = vPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const outstanding = Math.max(0, totalInvoiced - totalPaid);

      return {
        ...v,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        outstanding
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/vendors/:id/ledger', async (req, res) => {
  try {
    const { id } = req.params;
    const vendor = await db('vendors').where('id_vendors', id).first();
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const invoices = await db('vendor_invoices').where('id_vendors', id).orderBy('invoice_date', 'asc');
    const payments = await db('vendor_payments').where('id_vendors', id).orderBy('payment_date', 'asc');

    // Build chronological ledger entries
    const ledger = [];
    let runningBalance = 0;

    const allEvents = [
      ...invoices.map(i => ({ date: i.invoice_date, type: 'INVOICE', ref: i.invoice_number, desc: `Invoice #${i.invoice_number}`, debit: parseFloat(i.total_amount), credit: 0 })),
      ...payments.map(p => ({ date: p.payment_date, type: 'PAYMENT', ref: p.reference_number, desc: `Payment (${p.payment_type})`, debit: 0, credit: parseFloat(p.amount) }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    allEvents.forEach(e => {
      runningBalance += (e.debit - e.credit);
      ledger.push({ ...e, balance: runningBalance });
    });

    const totalInvoiced = invoices.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const outstanding = Math.max(0, totalInvoiced - totalPaid);

    res.json({
      success: true,
      data: {
        vendor,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        outstanding,
        ledger,
        invoices,
        payments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/vendor-invoices', async (req, res) => {
  try {
    const invoices = await db('vendor_invoices')
      .join('vendors', 'vendor_invoices.id_vendors', 'vendors.id_vendors')
      .leftJoin('construction_works', 'vendor_invoices.id_works', 'construction_works.id_works')
      .select('vendor_invoices.*', 'vendors.company_name as vendor_name', 'construction_works.work_name')
      .orderBy('vendor_invoices.id_invoices', 'desc');
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/vendor-invoices', async (req, res) => {
  try {
    const { invoice_number, id_vendors, id_works, invoice_date, due_date, total_amount } = req.body;
    const tot = parseFloat(total_amount || 0);
    const [id] = await db('vendor_invoices').insert({
      invoice_number,
      id_vendors,
      id_works: id_works || null,
      invoice_date: invoice_date || new Date().toISOString().split('T')[0],
      due_date,
      subtotal: tot,
      total_amount: tot,
      paid_amount: 0,
      outstanding_amount: tot,
      status: 'APPROVED'
    });
    await logAudit(req.user ? req.user.name : 'Accountant', 'Created Vendor Invoice', 'INVOICE', id, null, { invoice_number, tot });
    res.json({ success: true, message: 'Vendor invoice created', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/vendor-payments', async (req, res) => {
  try {
    const { id_invoices, id_vendors, payment_date, amount, payment_type, payment_method, reference_number, notes } = req.body;
    const amt = parseFloat(amount || 0);

    const [id] = await db('vendor_payments').insert({
      id_invoices: id_invoices || null,
      id_vendors,
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      amount: amt,
      payment_type: payment_type || 'PARTIAL',
      payment_method: payment_method || 'BANK_TRANSFER',
      reference_number,
      notes
    });

    if (id_invoices) {
      const inv = await db('vendor_invoices').where('id_invoices', id_invoices).first();
      if (inv) {
        const newPaid = parseFloat(inv.paid_amount || 0) + amt;
        const newDue = Math.max(0, parseFloat(inv.total_amount) - newPaid);
        const newStatus = newDue === 0 ? 'PAID' : (newPaid > 0 ? 'PARTIALLY_PAID' : 'APPROVED');
        await db('vendor_invoices').where('id_invoices', id_invoices).update({
          paid_amount: newPaid,
          outstanding_amount: newDue,
          status: newStatus
        });
      }
    }

    await logAudit(req.user ? req.user.name : 'Accountant', 'Recorded Vendor Payment', 'VENDOR_PAYMENT', id, null, { amount: amt, id_vendors });
    res.json({ success: true, message: 'Vendor payment recorded successfully', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 7. OWNER CONTRIBUTIONS, PAYMENTS & FINANCES
// ─────────────────────────────────────────────────────────────
router.get('/contributions', async (req, res) => {
  try {
    const list = await db('owner_contributions')
      .join('owners', 'owner_contributions.id_owners', 'owners.id_owners')
      .leftJoin('units', 'owner_contributions.id_units', 'units.id_units')
      .select('owner_contributions.*', 'owners.full_name as owner_name', 'units.unit_number')
      .orderBy('owner_contributions.payment_date', 'desc');
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/contributions', async (req, res) => {
  try {
    const { id_owners, id_units, amount, payment_date, contribution_type, payment_method, bank_or_cash_account, reference, receipt_number, notes } = req.body;
    const amt = parseFloat(amount || 0);

    const [id] = await db('owner_contributions').insert({
      id_owners,
      id_units: id_units || null,
      id_projects: 1,
      amount: amt,
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      contribution_type: contribution_type || 'CONSTRUCTION_INSTALLMENT',
      payment_method: payment_method || 'BANK_TRANSFER',
      bank_or_cash_account: bank_or_cash_account || 'Project Escrow Account',
      reference,
      receipt_number: receipt_number || `RCT-${Date.now().toString().slice(-6)}`,
      notes
    });

    // Record credit in owner ledger
    await db('owner_ledgers').insert({
      id_owners,
      id_units: id_units || null,
      transaction_date: payment_date || new Date().toISOString().split('T')[0],
      entry_type: 'CREDIT',
      category: 'OWNER_PAYMENT',
      description: `Owner payment (${contribution_type})`,
      debit_amount: 0,
      credit_amount: amt,
      running_balance: -amt,
      reference_id: receipt_number || `PAY-${id}`
    });

    await logAudit(req.user ? req.user.name : 'Accountant', 'Recorded Owner Payment', 'OWNER_CONTRIBUTION', id, null, { id_owners, amt });
    res.json({ success: true, message: 'Owner contribution registered and credited to ledger', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 8. LOANS & DISBURSEMENTS (SEPARATE FUNDING FROM EXPENSES)
// ─────────────────────────────────────────────────────────────
router.get('/loans', async (req, res) => {
  try {
    const loans = await db('owner_loans')
      .join('owners', 'owner_loans.id_owners', 'owners.id_owners')
      .leftJoin('units', 'owner_loans.id_units', 'units.id_units')
      .select('owner_loans.*', 'owners.full_name as owner_name', 'units.unit_number')
      .orderBy('owner_loans.id_loans', 'asc');

    const disbursements = await db('loan_disbursements').select('*');
    const payments = await db('loan_payments').select('*');

    const result = loans.map(l => ({
      ...l,
      disbursements: disbursements.filter(d => d.id_loans === l.id_loans),
      payments: payments.filter(p => p.id_loans === l.id_loans)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/loans/:id/disbursements', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, disbursement_date, reference_number, notes } = req.body;
    const amt = parseFloat(amount || 0);

    const [disbId] = await db('loan_disbursements').insert({
      id_loans: id,
      disbursement_number: (await db('loan_disbursements').where('id_loans', id).count('id_disbursements as count'))[0].count + 1,
      disbursement_date: disbursement_date || new Date().toISOString().split('T')[0],
      amount: amt,
      reference_number,
      notes
    });

    // Update disbursed amount on loan
    const loan = await db('owner_loans').where('id_loans', id).first();
    if (loan) {
      const newDisb = parseFloat(loan.disbursed_amount || 0) + amt;
      const newOut = Math.max(0, newDisb - parseFloat(loan.principal_paid || 0));
      await db('owner_loans').where('id_loans', id).update({
        disbursed_amount: newDisb,
        outstanding_amount: newOut
      });
    }

    await logAudit(req.user ? req.user.name : 'Accountant', 'Recorded Loan Disbursement', 'LOAN', id, null, { amt });
    res.json({ success: true, message: 'Loan disbursement recorded', id: disbId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 9. BUDGETS & CHANGE ORDERS
// ─────────────────────────────────────────────────────────────
router.get('/budgets', async (req, res) => {
  try {
    const budgets = await db('budgets').select('*').orderBy('id_budgets', 'asc');
    const changeOrders = await db('change_orders').select('*');

    const result = budgets.map(b => ({
      ...b,
      change_orders: changeOrders.filter(co => co.id_budgets === b.id_budgets)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/budgets/change-order', async (req, res) => {
  try {
    const { id_budgets, change_amount, reason, requested_by, approved_by } = req.body;
    const budget = await db('budgets').where('id_budgets', id_budgets).first();
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });

    const orig = parseFloat(budget.revised_budget || budget.original_budget);
    const delta = parseFloat(change_amount || 0);
    const revised = orig + delta;

    const [id] = await db('change_orders').insert({
      id_budgets,
      original_amount: orig,
      change_amount: delta,
      revised_amount: revised,
      reason,
      requested_by,
      approved_by,
      change_date: new Date().toISOString().split('T')[0],
      status: 'APPROVED'
    });

    await db('budgets').where('id_budgets', id_budgets).update({
      revised_budget: revised
    });

    await logAudit(req.user ? req.user.name : 'Admin', 'Approved Change Order', 'BUDGET', id_budgets, orig, revised);
    res.json({ success: true, message: 'Change order recorded and revised budget updated', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 10. FACILITIES: 2 LIFTS & COMMON AREAS
// ─────────────────────────────────────────────────────────────
router.get('/facilities', async (req, res) => {
  try {
    const lifts = await db('lifts')
      .leftJoin('vendors', 'lifts.id_vendors', 'vendors.id_vendors')
      .select('lifts.*', 'vendors.company_name as vendor_name');
    const commonAreas = await db('common_areas').select('*');
    res.json({ success: true, data: { lifts, common_areas: commonAreas } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 11. CASH & BANK MANAGEMENT
// ─────────────────────────────────────────────────────────────
router.get('/cash-bank', async (req, res) => {
  try {
    const accounts = await db('cash_bank_accounts').select('*');
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 12. APPROVALS, NOTIFICATIONS & AUDIT LOGS
// ─────────────────────────────────────────────────────────────
router.get('/approvals', async (req, res) => {
  try {
    const approvals = await db('approvals').select('*').orderBy('id_approvals', 'desc');
    res.json({ success: true, data: approvals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/approvals/:id/decide', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comments } = req.body;
    await db('approvals').where('id_approvals', id).update({
      status: status || 'APPROVED',
      comments,
      approved_by: req.user ? req.user.name : 'Admin'
    });
    await logAudit(req.user ? req.user.name : 'Admin', `Approval ${status}`, 'APPROVAL', id, null, status);
    res.json({ success: true, message: `Approval ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const notifications = await db('notifications').orderBy('created_at', 'desc').limit(20);
    res.json({ success: true, data: notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await db('audit_logs').orderBy('created_at', 'desc').limit(50);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 13. OWNER PORTAL (STRICT DATA ISOLATION)
// ─────────────────────────────────────────────────────────────
router.get('/owner-portal/me', checkAuth, async (req, res) => {
  try {
    // Locate the owner corresponding to current user
    const owner = await db('owners').where('login_email', req.user.email).first();
    if (!owner) {
      // Staff may preview the portal (optionally ?ownerId=). An owner login with no linked
      // owner record must never fall through to someone else's data.
      if (!checkAuth.isStaff(req.user)) return res.status(404).json({ success: false, message: 'No flat owner profile is linked to this login' });
      const preview = req.query.ownerId ? await db('owners').where('id_owners', req.query.ownerId).first() : await db('owners').whereNotNull('login_email').first();
      if (!preview) return res.status(404).json({ success: false, message: 'Owner not found' });
      return res.json({ success: true, preview: true, data: await getOwnerPortalData(preview.id_owners) });
    }
    const data = await getOwnerPortalData(owner.id_owners);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Owner portal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function getOwnerPortalData(ownerId) {
  const owner = await db('owners').where('id_owners', ownerId).first();
  const ownerships = await db('unit_ownerships')
    .join('units', 'unit_ownerships.id_units', 'units.id_units')
    .where('unit_ownerships.id_owners', ownerId)
    .select('unit_ownerships.*', 'units.unit_number', 'units.area_sqft', 'units.status as unit_status');

  const unitIds = ownerships.map(o => o.id_units);
  const works = await db('work_allocations')
    .join('construction_works', 'work_allocations.id_works', 'construction_works.id_works')
    .whereIn('work_allocations.id_units', unitIds)
    .select('work_allocations.*', 'construction_works.work_name', 'construction_works.work_type', 'construction_works.progress_percentage', 'construction_works.status as work_status');

  const combinedShare = works.filter(w => !w.is_custom).reduce((sum, w) => sum + parseFloat(w.allocated_amount || 0), 0);
  const individualCost = works.filter(w => w.is_custom).reduce((sum, w) => sum + parseFloat(w.allocated_amount || 0), 0);
  const totalLiability = combinedShare + individualCost;

  const contributions = await db('owner_contributions')
    .where('id_owners', ownerId)
    .orderBy('payment_date', 'desc');

  const totalPaid = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
  const outstanding = Math.max(0, totalLiability - totalPaid);

  const loans = await db('owner_loans').where('id_owners', ownerId);
  const ledger = await db('owner_ledgers').where('id_owners', ownerId).orderBy('transaction_date', 'asc');
  const fineCtx = await loadFineContext();
  const schedules = (await db('owner_payment_schedules').where('id_owners', ownerId).orderBy('due_date', 'asc')).map(s => {
    const outstanding = Math.max(0, Number(s.target_amount) - Number(s.paid_amount || 0));
    const f = s.status === 'PAID' ? { fine: 0, days_late: 0, waived: false } : fineFor(fineCtx, 'INSTALLMENT', String(s.id_schedules), outstanding, s.due_date);
    return { ...s, outstanding, late_fine: f.fine, days_late: f.days_late, fine_waived: f.waived };
  });
  const receipts = await db('money_receipts').where({ id_owners: ownerId, status: 'ISSUED' }).orderBy('issue_datetime', 'desc')
    .select('id_receipts', 'receipt_no', 'doc_type', 'issue_datetime', 'total_bdt', 'payment_method').catch(() => []);

  return {
    owner,
    units: ownerships,
    financial_summary: {
      total_liability: totalLiability,
      combined_cost: combinedShare,
      individual_cost: individualCost,
      total_paid: totalPaid,
      outstanding,
      loan_approved: loans.reduce((s, l) => s + parseFloat(l.approved_amount || 0), 0),
      loan_disbursed: loans.reduce((s, l) => s + parseFloat(l.disbursed_amount || 0), 0),
      loan_outstanding: loans.reduce((s, l) => s + parseFloat(l.outstanding_amount || 0), 0)
    },
    works,
    contributions,
    loans,
    ledger,
    schedules,
    receipts
  };
}




// ─────────────────────────────────────────────────────────────
// 14. CASH FLOW FORECASTING (Section 1)
// ─────────────────────────────────────────────────────────────
router.get('/cash-flow-forecast', async (req, res) => {
  try {
    const project = await db('projects').first();
    const works = await db('construction_works').select('*');
    const contributions = await db('owner_contributions').select('*');
    const loans = await db('owner_loans').select('*');
    const cashAccounts = await db('cash_bank_accounts').select('*');
    const currentLiquidity = cashAccounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);

    // Dynamic 6-Month Projected Cash Flow (Months 1 to 6)
    const months = ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'];
    const forecast = [
      { month: 'Apr 2026', projected_expense: 45000, projected_collection: 50000, projected_loan_disbursed: 20000 },
      { month: 'May 2026', projected_expense: 80000, projected_collection: 65000, projected_loan_disbursed: 10000 }, // Shortfall warning
      { month: 'Jun 2026', projected_expense: 60000, projected_collection: 55000, projected_loan_disbursed: 15000 },
      { month: 'Jul 2026', projected_expense: 75000, projected_collection: 70000, projected_loan_disbursed: 20000 },
      { month: 'Aug 2026', projected_expense: 50000, projected_collection: 60000, projected_loan_disbursed: 0 },
      { month: 'Sep 2026', projected_expense: 40000, projected_collection: 45000, projected_loan_disbursed: 0 }
    ];

    let runningCash = currentLiquidity;
    const computedForecast = forecast.map(f => {
      const totalInflow = f.projected_collection + f.projected_loan_disbursed;
      const netCash = totalInflow - f.projected_expense;
      runningCash += netCash;
      const hasShortfall = totalInflow < f.projected_expense;
      return {
        ...f,
        total_inflow: totalInflow,
        net_cash: netCash,
        projected_closing_balance: runningCash,
        has_shortfall: hasShortfall,
        shortfall_amount: hasShortfall ? f.projected_expense - totalInflow : 0
      };
    });

    res.json({
      success: true,
      data: {
        current_liquid_reserves: currentLiquidity,
        forecast_period: '6-Month Rolling',
        forecast: computedForecast,
        shortfall_alerts: computedForecast.filter(f => f.has_shortfall)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 15. COST PER SQUARE FOOT ANALYTICS (Section 2)
// ─────────────────────────────────────────────────────────────
router.get('/cost-per-sft', async (req, res) => {
  try {
    const project = await db('projects').first();
    const works = await db('construction_works').select('*');
    const units = await db('units').select('*');
    const allocations = await db('work_allocations').select('*');

    const totalConstSft = parseFloat(project ? project.total_construction_area : 9460) || 9460;
    const totalUnitSft = parseFloat(project ? project.total_unit_area : 6960) || 6960;

    const totalCost = works.reduce((s, w) => s + parseFloat(w.actual_cost || 0), 0);
    const combinedCost = works.filter(w => w.work_type === 'COMBINED').reduce((s, w) => s + parseFloat(w.actual_cost || 0), 0);
    const individualCost = works.filter(w => w.work_type === 'INDIVIDUAL' || w.work_type === 'EXTRA_WORK').reduce((s, w) => s + parseFloat(w.actual_cost || 0), 0);
    const structuralCost = works.filter(w => w.work_category === 'Structural').reduce((s, w) => s + parseFloat(w.actual_cost || 0), 0);
    const facilitiesCost = works.filter(w => w.work_category === 'Facilities & MEP').reduce((s, w) => s + parseFloat(w.actual_cost || 0), 0);

    const overallCostPerSft = (totalCost / totalConstSft).toFixed(2);
    const combinedPerSft = (combinedCost / totalUnitSft).toFixed(2);
    const structuralPerSft = (structuralCost / totalConstSft).toFixed(2);
    const facilitiesPerSft = (facilitiesCost / totalConstSft).toFixed(2);

    // Unit-wise Cost Per SFT
    const unitSftBreakdown = units.map(u => {
      const uAlloc = allocations.filter(a => a.id_units === u.id_units);
      const uCost = uAlloc.reduce((s, a) => s + parseFloat(a.allocated_amount || 0), 0);
      const uArea = parseFloat(u.area_sqft || 1160);
      return {
        id_units: u.id_units,
        unit_number: u.unit_number,
        area_sqft: uArea,
        total_cost: uCost,
        cost_per_sft: (uCost / uArea).toFixed(2)
      };
    });

    res.json({
      success: true,
      data: {
        total_construction_sft: totalConstSft,
        total_unit_sft: totalUnitSft,
        metrics: {
          overall_cost_per_sft: parseFloat(overallCostPerSft),
          combined_cost_per_sft: parseFloat(combinedPerSft),
          structural_cost_per_sft: parseFloat(structuralPerSft),
          facilities_cost_per_sft: parseFloat(facilitiesPerSft)
        },
        units: unitSftBreakdown
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 16. ROOM-LEVEL COSTING HIERARCHY (Section 3)
// ─────────────────────────────────────────────────────────────
router.get('/room-level-costing', async (req, res) => {
  try {
    const units = await db('units').select('*');
    const rooms = await db('unit_rooms').select('*');

    // Cost rates per SFT for finishes
    // Master Bed: $15/sft; Living/Dining: $14/sft; Kitchen: $35/sft (tiles+cabinets+plumbing); Bathrooms: $28/sft (tiles+sanitary)
    const result = units.map(u => {
      const uRooms = rooms.filter(r => r.id_units === u.id_units);
      const roomCosts = uRooms.map(r => {
        let ratePerSft = 12.0;
        let details = 'Standard finishing, putty and emulsion paint';
        if (r.room_type === 'KITCHEN') {
          ratePerSft = 35.0;
          details = 'Quartz counter, glazed wall tiles, gas & sink lines';
        } else if (r.room_type.includes('TOILET')) {
          ratePerSft = 28.0;
          details = 'Non-slip porcelain tiles, commode, concealed stop cocks';
        } else if (r.room_type === 'MASTER_BEDROOM') {
          ratePerSft = 16.0;
          details = 'Mirror polish 24x24 tiles, AC line, false ceiling pelmet';
        } else if (r.room_type === 'LIVING_DINING') {
          ratePerSft = 15.0;
          details = 'Polished tiles, chandelier point, premium wall wash';
        }

        const area = parseFloat(r.area_sqft || 0);
        const estimatedFinishingCost = area * ratePerSft;

        return {
          id_rooms: r.id_rooms,
          room_name: r.room_name,
          room_type: r.room_type,
          length_feet: r.length_feet,
          width_feet: r.width_feet,
          area_sqft: area,
          rate_per_sft: ratePerSft,
          estimated_cost: estimatedFinishingCost,
          details
        };
      });

      const totalUnitRoomCost = roomCosts.reduce((s, r) => s + r.estimated_cost, 0);

      return {
        unit_id: u.id_units,
        unit_number: u.unit_number,
        area_sqft: u.area_sqft,
        total_finishing_cost: totalUnitRoomCost,
        rooms: roomCosts
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 17. DRAWINGS & REVISION CONTROL (Sections 4 & 5)
// ─────────────────────────────────────────────────────────────
router.get('/drawings', async (req, res) => {
  try {
    const drawings = await db('drawings').select('*').orderBy('id_drawings', 'asc');
    const revisions = await db('drawing_revisions').select('*').orderBy('revision_number', 'desc');

    const result = drawings.map(d => ({
      ...d,
      revisions: revisions.filter(r => r.id_drawings === d.id_drawings)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/drawings/revision', async (req, res) => {
  try {
    const { id_drawings, revision_reason, uploaded_by, file_url } = req.body;
    const drawing = await db('drawings').where('id_drawings', id_drawings).first();
    if (!drawing) return res.status(404).json({ success: false, message: 'Drawing not found' });

    const newRevNum = (drawing.current_revision || 1) + 1;
    const revCode = `Rev 0${newRevNum} (Current)`;

    // Supersede previous revisions
    await db('drawing_revisions').where('id_drawings', id_drawings).update({ approval_status: 'SUPERSEDED' });

    const [id] = await db('drawing_revisions').insert({
      id_drawings,
      revision_number: newRevNum,
      revision_code: revCode,
      upload_date: new Date().toISOString().split('T')[0],
      uploaded_by: uploaded_by || (req.user ? req.user.name : 'Architect'),
      revision_reason,
      file_url: file_url || `/drawings/drawing_${id_drawings}_rev0${newRevNum}.pdf`,
      approval_status: 'APPROVED'
    });

    await db('drawings').where('id_drawings', id_drawings).update({ current_revision: newRevNum });
    await logAudit(req.user ? req.user.name : 'Architect', 'Uploaded Drawing Revision', 'DRAWING', id_drawings, `Rev 0${newRevNum - 1}`, revCode);

    res.json({ success: true, message: `Revision Rev 0${newRevNum} registered successfully!`, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 18. CONTRACTOR CONTRACTS & PROGRESS BILLING (Sections 6-9)
// ─────────────────────────────────────────────────────────────
router.get('/contractors', async (req, res) => {
  try {
    const contracts = await db('contractor_contracts')
      .join('vendors', 'contractor_contracts.id_vendors', 'vendors.id_vendors')
      .select('contractor_contracts.*', 'vendors.company_name', 'vendors.phone', 'vendors.email')
      .orderBy('contractor_contracts.id_contracts', 'asc');

    const bills = await db('contractor_progress_bills').select('*').orderBy('billing_date', 'desc');

    const result = contracts.map(c => ({
      ...c,
      bills: bills.filter(b => b.id_contracts === c.id_contracts)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/contractors/progress-bills', async (req, res) => {
  try {
    const { id_contracts, bill_number, cumulative_work_percent, gross_claim_amount, advance_recovery_amount, retention_amount, previous_payments } = req.body;
    const gross = parseFloat(gross_claim_amount || 0);
    const adv = parseFloat(advance_recovery_amount || 0);
    const ret = parseFloat(retention_amount || 0);
    const prev = parseFloat(previous_payments || 0);
    const netPayable = gross - adv - ret - prev;

    const [id] = await db('contractor_progress_bills').insert({
      id_contracts,
      bill_number,
      billing_date: new Date().toISOString().split('T')[0],
      cumulative_work_percent: parseFloat(cumulative_work_percent || 0),
      gross_claim_amount: gross,
      advance_recovery_amount: adv,
      retention_amount: ret,
      previous_payments: prev,
      net_payable_amount: netPayable,
      status: 'APPROVED'
    });

    // Update contract cumulative metrics
    const contract = await db('contractor_contracts').where('id_contracts', id_contracts).first();
    if (contract) {
      await db('contractor_contracts').where('id_contracts', id_contracts).update({
        work_completed_percentage: parseFloat(cumulative_work_percent || 0),
        advance_recovered: parseFloat(contract.advance_recovered || 0) + adv,
        retention_held: parseFloat(contract.retention_held || 0) + ret
      });
    }

    await logAudit(req.user ? req.user.name : 'Project Manager', 'Certified Contractor Progress Bill', 'CONTRACT_BILL', id, null, { netPayable, bill_number });
    res.json({ success: true, message: `Interim Progress Bill ${bill_number} certified for payment of ৳${netPayable.toLocaleString("en-IN")}`, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 19. SITE PETTY CASH EXPENSES (Section 10)
// ─────────────────────────────────────────────────────────────
router.get('/site-expenses', async (req, res) => {
  try {
    const list = await db('site_petty_expenses').select('*').orderBy('expense_date', 'desc');
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/site-expenses', async (req, res) => {
  try {
    const { category, amount, payee, description, receipt_number } = req.body;
    const [id] = await db('site_petty_expenses').insert({
      id_projects: 1,
      expense_date: new Date().toISOString().split('T')[0],
      category: category || 'TRANSPORTATION',
      amount: parseFloat(amount || 0),
      payee,
      entered_by: req.user ? req.user.name : 'Site Supervisor',
      receipt_number: receipt_number || `RCP-${Date.now().toString().slice(-4)}`,
      description
    });
    res.json({ success: true, message: 'Site petty cash expense recorded', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 20. LABOUR MANAGEMENT & ATTENDANCE (Sections 11 & 12)
// ─────────────────────────────────────────────────────────────
router.get('/labour', async (req, res) => {
  try {
    const workers = await db('labour_workers').select('*');
    const attendance = await db('labour_attendance')
      .join('labour_workers', 'labour_attendance.id_workers', 'labour_workers.id_workers')
      .select('labour_attendance.*', 'labour_workers.worker_name', 'labour_workers.worker_type', 'labour_workers.daily_rate')
      .orderBy('labour_attendance.attendance_date', 'desc');

    res.json({ success: true, data: { workers, attendance } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/labour/attendance', async (req, res) => {
  try {
    const { id_workers, hours_worked, overtime_hours, work_performed } = req.body;
    const worker = await db('labour_workers').where('id_workers', id_workers).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    const hours = parseFloat(hours_worked || 8.0);
    const ot = parseFloat(overtime_hours || 0);
    const hourlyRate = parseFloat(worker.daily_rate) / 8.0;
    const calcPay = (hours * hourlyRate) + (ot * hourlyRate * 1.5);

    const [id] = await db('labour_attendance').insert({
      id_workers,
      attendance_date: new Date().toISOString().split('T')[0],
      hours_worked: hours,
      overtime_hours: ot,
      calculated_pay: calcPay,
      work_performed,
      status: 'PRESENT'
    });

    res.json({ success: true, message: `Daily attendance logged. Pay: ৳${calcPay.toFixed(2)}`, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 21. INVENTORY, REORDER ALERTS & 3-WAY MATCHING (Sections 13-16)
// ─────────────────────────────────────────────────────────────
router.get('/inventory', async (req, res) => {
  try {
    const inventory = await db('site_inventory')
      .join('materials', 'site_inventory.id_materials', 'materials.id_materials')
      .select(
        'site_inventory.*',
        'materials.material_name',
        'materials.category as material_category',
        'materials.unit',
        'materials.current_rate'
      );

    const deliveries = await db('goods_deliveries')
      .join('vendors', 'goods_deliveries.id_vendors', 'vendors.id_vendors')
      .select('goods_deliveries.*', 'vendors.company_name as vendor_name')
      .orderBy('goods_deliveries.delivery_date', 'desc');

    const reorderAlerts = inventory.filter(i => parseFloat(i.current_stock) <= parseFloat(i.minimum_reorder_stock));

    res.json({
      success: true,
      data: {
        inventory,
        deliveries,
        reorder_alerts: reorderAlerts
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 22. OWNER COMMITTEE PROPOSALS & VOTING (Section 20)
// ─────────────────────────────────────────────────────────────
router.get('/proposals', async (req, res) => {
  try {
    const proposals = await db('committee_proposals').select('*').orderBy('id_proposals', 'desc');
    const votes = await db('proposal_votes')
      .join('owners', 'proposal_votes.id_owners', 'owners.id_owners')
      .select('proposal_votes.*', 'owners.full_name as owner_name');

    const result = proposals.map(p => ({
      ...p,
      votes: votes.filter(v => v.id_proposals === p.id_proposals)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/proposals/:id/vote', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { vote, comments } = req.body;
    let ownerId = 1;
    const owner = await db('owners').where('login_email', req.user.email).first();
    if (owner) ownerId = owner.id_owners;

    // Delete previous vote if any
    await db('proposal_votes').where({ id_proposals: id, id_owners: ownerId }).del();

    await db('proposal_votes').insert({
      id_proposals: id,
      id_owners: ownerId,
      vote: vote || 'FOR',
      comments
    });

    // Recount
    const votesFor = (await db('proposal_votes').where({ id_proposals: id, vote: 'FOR' }).count('id_votes as count'))[0].count;
    const votesAgainst = (await db('proposal_votes').where({ id_proposals: id, vote: 'AGAINST' }).count('id_votes as count'))[0].count;
    const votesAbstain = (await db('proposal_votes').where({ id_proposals: id, vote: 'ABSTAIN' }).count('id_votes as count'))[0].count;

    await db('committee_proposals').where('id_proposals', id).update({
      votes_for: votesFor,
      votes_against: votesAgainst,
      votes_abstain: votesAbstain,
      status: votesFor >= 4 ? 'APPROVED' : 'OPEN'
    });

    res.json({ success: true, message: 'Vote recorded successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 23. PAYMENT SCHEDULES & MONTHLY STATEMENTS (Sections 21-25)
// ─────────────────────────────────────────────────────────────
router.get('/payment-schedules', async (req, res) => {
  try {
    const schedules = await db('owner_payment_schedules')
      .join('owners', 'owner_payment_schedules.id_owners', 'owners.id_owners')
      .join('units', 'owner_payment_schedules.id_units', 'units.id_units')
      .select('owner_payment_schedules.*', 'owners.full_name as owner_name', 'units.unit_number')
      .orderBy('owner_payment_schedules.due_date', 'asc');

    res.json({ success: true, data: schedules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 24. POST-HANDOVER FACILITIES & WARRANTIES (Sections 31-35)
// ─────────────────────────────────────────────────────────────
router.get('/post-handover', async (req, res) => {
  try {
    const tickets = await db('maintenance_tickets')
      .leftJoin('units', 'maintenance_tickets.id_units', 'units.id_units')
      .leftJoin('owners', 'maintenance_tickets.id_owners', 'owners.id_owners')
      .select('maintenance_tickets.*', 'units.unit_number', 'owners.full_name as owner_name')
      .orderBy('maintenance_tickets.created_at', 'desc');

    const serviceCharges = await db('service_charges')
      .join('units', 'service_charges.id_units', 'units.id_units')
      .select('service_charges.*', 'units.unit_number')
      .orderBy('service_charges.due_date', 'desc');

    const warranties = await db('asset_warranties').select('*');

    res.json({
      success: true,
      data: {
        tickets,
        service_charges: serviceCharges,
        warranties,
        maintenance_fund_balance: 14500.00
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/post-handover/tickets', async (req, res) => {
  try {
    const { title, category, description, priority, id_units } = req.body;
    const [id] = await db('maintenance_tickets').insert({
      id_units: id_units || 1,
      title,
      category: category || 'OTHER',
      description,
      priority: priority || 'MEDIUM',
      status: 'OPEN',
      // Same fix-by deadline as the Helpdesk (routes/ops/helpdesk.js) so escalation covers these too.
      due_by: require('./ops/helpdesk').dueFrom(new Date(), priority || 'MEDIUM'),
      source: 'STAFF',
      created_by: req.user?.name || 'Staff'
    });
    res.json({ success: true, message: 'Maintenance ticket lodged', id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 25. SITE PHOTOS TIMELINE (Sections 36-38)
// ─────────────────────────────────────────────────────────────
router.get('/site-photos', async (req, res) => {
  try {
    const photos = await db('construction_site_photos').select('*').orderBy('photo_date', 'desc');
    res.json({ success: true, data: photos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 26. DATA EXPORT & PROJECT BACKUP (Section 42)
// ─────────────────────────────────────────────────────────────
router.get('/export-project-backup', async (req, res) => {
  try {
    const project = await db('projects').first();
    const units = await db('units').select('*');
    const owners = await db('owners').select('*');
    const works = await db('construction_works').select('*');
    const allocations = await db('work_allocations').select('*');
    const vendors = await db('vendors').select('*');
    const invoices = await db('vendor_invoices').select('*');
    const payments = await db('vendor_payments').select('*');
    const contributions = await db('owner_contributions').select('*');
    const loans = await db('owner_loans').select('*');
    const budgets = await db('budgets').select('*');
    const drawings = await db('drawings').select('*');
    const auditLogs = await db('audit_logs').select('*');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=project_backup_gulshan_heights.json');
    res.json({
      success: true,
      backup_timestamp: new Date().toISOString(),
      project,
      units,
      owners,
      works,
      allocations,
      vendors,
      invoices,
      payments,
      contributions,
      loans,
      budgets,
      drawings,
      auditLogs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────
// 19. MASTER DATA MANAGEMENT (6 UNITS/FLOOR, ITEMS, SHARES, WORKS, VENDORS)
// ─────────────────────────────────────────────────────────────

// 19.1 Master Unit Templates (Slots A through F)
router.get('/masters/unit-templates', async (req, res) => {
  try {
    const templates = await db('master_unit_templates').orderBy('unit_slot', 'asc');
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/masters/unit-templates', async (req, res) => {
  try {
    const {
      id_unit_templates,
      unit_slot,
      template_name,
      gross_area_sqft,
      carpet_area_sqft,
      common_area_sqft,
      default_land_share_sqft,
      default_land_share_katha,
      bedrooms,
      bathrooms,
      balconies,
      facing_direction,
      is_corner_unit,
      description
    } = req.body;

    if (id_unit_templates) {
      await db('master_unit_templates').where({ id_unit_templates }).update({
        template_name,
        gross_area_sqft,
        carpet_area_sqft,
        common_area_sqft,
        default_land_share_sqft,
        default_land_share_katha,
        bedrooms,
        bathrooms,
        balconies,
        facing_direction,
        is_corner_unit,
        description
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'UPDATE', 'MASTER_UNIT_TEMPLATE', id_unit_templates, null, req.body);
    } else {
      await db('master_unit_templates').insert({
        unit_slot,
        template_name,
        gross_area_sqft,
        carpet_area_sqft,
        common_area_sqft,
        default_land_share_sqft,
        default_land_share_katha,
        bedrooms,
        bathrooms,
        balconies,
        facing_direction,
        is_corner_unit,
        description
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'CREATE', 'MASTER_UNIT_TEMPLATE', unit_slot, null, req.body);
    }

    const templates = await db('master_unit_templates').orderBy('unit_slot', 'asc');
    res.json({ success: true, message: 'Unit template saved successfully', templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.2 Master Items Catalogue
router.get('/masters/items', async (req, res) => {
  try {
    const items = await db('master_items').orderBy('item_code', 'asc');
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/masters/items', async (req, res) => {
  try {
    const {
      id_master_items,
      item_code,
      item_name,
      category,
      sub_category,
      unit,
      standard_rate,
      minimum_stock_alert,
      reorder_quantity,
      technical_specification,
      is_active
    } = req.body;

    if (id_master_items) {
      await db('master_items').where({ id_master_items }).update({
        item_code,
        item_name,
        category,
        sub_category,
        unit,
        standard_rate,
        minimum_stock_alert,
        reorder_quantity,
        technical_specification,
        is_active: is_active !== undefined ? is_active : true
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'UPDATE', 'MASTER_ITEM', id_master_items, null, req.body);
    } else {
      await db('master_items').insert({
        item_code,
        item_name,
        category,
        sub_category,
        unit,
        standard_rate,
        minimum_stock_alert,
        reorder_quantity,
        technical_specification,
        is_active: is_active !== undefined ? is_active : true
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'CREATE', 'MASTER_ITEM', item_code, null, req.body);
    }

    const items = await db('master_items').orderBy('item_code', 'asc');
    res.json({ success: true, message: 'Item master saved successfully', items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.3 Master Shares & Common Unit Distribution
router.get('/masters/shares', async (req, res) => {
  try {
    const shareConfig = await db('master_shares').first();
    const unitTemplates = await db('master_unit_templates').orderBy('unit_slot', 'asc');
    const allUnits = await db('units')
      .leftJoin('floors', 'units.id_floors', 'floors.id_floors')
      .select(
        'units.*',
        'floors.floor_number',
        'floors.floor_name'
      )
      .orderBy('units.id_floors', 'asc')
      .orderBy('units.unit_slot', 'asc');

    res.json({
      success: true,
      shareConfig: shareConfig || {},
      unitTemplates,
      allUnits,
      kathaToSqftFactor: 720 // Standard Bangladeshi Land Measure
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/masters/shares', async (req, res) => {
  try {
    const {
      id_shares_master,
      project_title,
      total_land_katha,
      total_land_sqft,
      total_floors_count,
      units_per_floor,
      total_units_count,
      total_buildable_area_sqft,
      common_space_percentage,
      land_share_allocation_method,
      common_area_allocation_method,
      notes
    } = req.body;

    const data = {
      project_title: project_title || 'Apartment Construction Project',
      total_land_katha: Number(total_land_katha) || 7.5,
      total_land_sqft: Number(total_land_sqft) || (Number(total_land_katha) * 720),
      total_floors_count: Number(total_floors_count) || 6,
      units_per_floor: Number(units_per_floor) || 6,
      total_units_count: Number(total_units_count) || 36,
      total_buildable_area_sqft: Number(total_buildable_area_sqft) || 48600,
      common_space_percentage: Number(common_space_percentage) || 25,
      land_share_allocation_method: land_share_allocation_method || 'PROPORTIONAL_TO_AREA',
      common_area_allocation_method: common_area_allocation_method || 'FLOOR_COMMON_PLUS_BUILDING_COMMON',
      notes: notes || ''
    };

    if (id_shares_master) {
      await db('master_shares').where({ id_shares_master }).update(data);
    } else {
      const existing = await db('master_shares').first();
      if (existing) {
        await db('master_shares').where({ id_shares_master: existing.id_shares_master }).update(data);
      } else {
        await db('master_shares').insert(data);
      }
    }

    const updated = await db('master_shares').first();
    res.json({ success: true, message: 'Shares configuration saved successfully', shareConfig: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Recalculate land share & common shares for all 36 units based on current master formula
router.post('/masters/recalculate-shares', async (req, res) => {
  try {
    const config = await db('master_shares').first();
    if (!config) {
      return res.status(400).json({ success: false, message: 'Shares configuration not found' });
    }

    const units = await db('units').select('*');
    const totalArea = units.reduce((acc, u) => acc + (parseFloat(u.area_sqft) || 0), 0) || 1;
    const totalLandSqft = parseFloat(config.total_land_sqft) || (parseFloat(config.total_land_katha) * 720);

    for (const unit of units) {
      let landSqft = 0;
      if (config.land_share_allocation_method === 'EQUAL_PER_UNIT') {
        landSqft = totalLandSqft / units.length;
      } else {
        // Proportional to area
        const unitArea = parseFloat(unit.area_sqft) || 1200;
        landSqft = (unitArea / totalArea) * totalLandSqft;
      }
      const landKatha = landSqft / 720;

      // Common area allocation
      // 25% common area: floor lobby (30%) + building core (70%)
      const carpet = parseFloat(unit.carpet_area_sqft) || (parseFloat(unit.area_sqft) * 0.82);
      const common = parseFloat(unit.area_sqft) - carpet;

      await db('units').where({ id_units: unit.id_units }).update({
        land_share_sqft: parseFloat(landSqft.toFixed(4)),
        land_share_katha: parseFloat(landKatha.toFixed(4)),
        carpet_area_sqft: parseFloat(carpet.toFixed(2)),
        common_area_sqft: parseFloat(common.toFixed(2))
      });
    }

    res.json({
      success: true,
      message: `Recalculated land shares (Katha & SQFT) and common unit shares for ${units.length} units successfully`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.4 Master Works (Standard WBS Catalogue)
router.get('/masters/works', async (req, res) => {
  try {
    const works = await db('master_works').orderBy('work_code', 'asc');
    res.json({ success: true, works });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/masters/works', async (req, res) => {
  try {
    const {
      id_master_works,
      work_code,
      work_name,
      category,
      scope_level,
      default_allocation_rule,
      standard_budget_estimate,
      standard_scope_notes,
      is_active
    } = req.body;

    if (id_master_works) {
      await db('master_works').where({ id_master_works }).update({
        work_code,
        work_name,
        category,
        scope_level,
        default_allocation_rule,
        standard_budget_estimate,
        standard_scope_notes,
        is_active: is_active !== undefined ? is_active : true
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'UPDATE', 'MASTER_WORK', id_master_works, null, req.body);
    } else {
      await db('master_works').insert({
        work_code,
        work_name,
        category,
        scope_level,
        default_allocation_rule,
        standard_budget_estimate,
        standard_scope_notes,
        is_active: is_active !== undefined ? is_active : true
      });
      await logAudit(req.user ? req.user.username : 'Admin', 'CREATE', 'MASTER_WORK', work_code, null, req.body);
    }

    const works = await db('master_works').orderBy('work_code', 'asc');
    res.json({ success: true, message: 'Work master item saved successfully', works });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.5 Master Vendor Categories
router.get('/masters/vendor-categories', async (req, res) => {
  try {
    const categories = await db('master_vendor_categories').orderBy('category_code', 'asc');
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/masters/vendor-categories', async (req, res) => {
  try {
    const {
      id_vendor_cat,
      category_code,
      category_name,
      trade_type,
      default_retention_percent,
      default_payment_terms
    } = req.body;

    if (id_vendor_cat) {
      await db('master_vendor_categories').where({ id_vendor_cat }).update({
        category_code,
        category_name,
        trade_type,
        default_retention_percent,
        default_payment_terms
      });
    } else {
      await db('master_vendor_categories').insert({
        category_code,
        category_name,
        trade_type,
        default_retention_percent,
        default_payment_terms
      });
    }

    const categories = await db('master_vendor_categories').orderBy('category_code', 'asc');
    res.json({ success: true, message: 'Vendor category saved successfully', categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.6 Floor-by-Floor 6-Unit Auto-Generator
router.post('/masters/generate-floor-6-units', async (req, res) => {
  try {
    const { floor_number, floor_name } = req.body;
    const floorNum = parseInt(floor_number);
    if (!floorNum || floorNum < 1) {
      return res.status(400).json({ success: false, message: 'Valid floor number is required' });
    }

    const project = await db('projects').first();
    const projectId = project ? project.id_projects : 1;

    // Check or create floor
    let floor = await db('floors').where({ id_projects: projectId, floor_number: floorNum }).first();
    if (!floor) {
      const [floorId] = await db('floors').insert({
        id_projects: projectId,
        floor_number: floorNum,
        floor_name: floor_name || `Floor ${floorNum} (6 Units Level)`,
        floor_type: 'RESIDENTIAL',
        total_units_on_floor: 6,
        floor_common_area_sqft: 420.00
      });
      floor = { id_floors: floorId };
    }

    // Retrieve master unit templates (Slots A to F)
    const templates = await db('master_unit_templates').orderBy('unit_slot', 'asc');
    const templateMap = {};
    templates.forEach(t => { templateMap[t.unit_slot] = t; });

    const slots = ['A', 'B', 'C', 'D', 'E', 'F'];
    const createdUnits = [];

    for (const slot of slots) {
      const unitNumber = `${floorNum}${slot}`;
      const tmpl = templateMap[slot] || templateMap['A'] || {
        gross_area_sqft: 1300,
        carpet_area_sqft: 1050,
        common_area_sqft: 250,
        default_land_share_sqft: 150,
        default_land_share_katha: 0.208,
        bedrooms: 3,
        bathrooms: 3,
        balconies: 2,
        facing_direction: 'South',
        is_corner_unit: false
      };

      const existing = await db('units').where({ id_projects: projectId, unit_number: unitNumber }).first();
      const unitPayload = {
        id_projects: projectId,
        id_floors: floor.id_floors,
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
        status: existing ? existing.status : 'AVAILABLE'
      };

      if (existing) {
        await db('units').where({ id_units: existing.id_units }).update(unitPayload);
        createdUnits.push(unitNumber + ' (Updated)');
      } else {
        await db('units').insert(unitPayload);
        createdUnits.push(unitNumber + ' (Created)');
      }
    }

    res.json({
      success: true,
      message: `Generated 6 units (Slots A through F) for Floor ${floorNum}`,
      floorNumber: floorNum,
      units: createdUnits
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



// ─────────────────────────────────────────────────────────────
// 20. SHOPNO BILASH MULTI-TOWER & CAMPUS COST ALLOCATION SYSTEM
// ─────────────────────────────────────────────────────────────

// 20.1 Project Overview & Multi-Building Matrix
router.get('/shopno-bilash/overview', async (req, res) => {
  try {
    const project = await db('projects').where({ project_code: 'SHOPNO-BILASH-108' }).first() 
      || await db('projects').where('project_name', 'like', '%Shopno Bilash%').first();

    if (!project) {
      return res.status(404).json({ success: false, message: 'Shopno Bilash project not found' });
    }

    const projectId = project.id_projects;

    // 1. Buildings (Towers A, B, C)
    const buildings = await db('buildings')
      .where({ id_projects: projectId })
      .select('*')
      .orderBy('building_code', 'asc');

    // 2. Units Summary
    const units = await db('units')
      .where({ id_projects: projectId })
      .select('*')
      .orderBy('id_buildings', 'asc')
      .orderBy('unit_number', 'asc');

    const totalUnitsCount = units.length;
    const commonSharesUnits = units.filter(u => u.is_common_share);
    const personalUnits = units.filter(u => !u.is_common_share);

    // 3. Multi-Building Owners
    const ownershipRows = await db('unit_ownerships')
      .join('units', 'unit_ownerships.id_units', 'units.id_units')
      .join('owners', 'unit_ownerships.id_owners', 'owners.id_owners')
      .leftJoin('buildings', 'units.id_buildings', 'buildings.id_buildings')
      .where('units.id_projects', projectId)
      .select(
        'owners.id_owners',
        'owners.full_name',
        'owners.phone',
        'owners.email',
        'units.id_units',
        'units.unit_number',
        'units.area_sqft',
        'units.land_share_katha',
        'units.is_common_share',
        'units.common_share_type',
        'buildings.building_name',
        'buildings.building_code'
      );

    // Group by owner
    const ownersMap = {};
    ownershipRows.forEach(row => {
      if (!ownersMap[row.id_owners]) {
        ownersMap[row.id_owners] = {
          id_owners: row.id_owners,
          full_name: row.full_name,
          phone: row.phone,
          email: row.email,
          shares_count: 0,
          buildings_set: new Set(),
          units: [],
          total_sft: 0,
          total_katha: 0,
          is_society_entity: row.full_name.includes('Society')
        };
      }
      ownersMap[row.id_owners].shares_count++;
      ownersMap[row.id_owners].buildings_set.add(row.building_code || row.building_name);
      ownersMap[row.id_owners].units.push({
        unit_number: row.unit_number,
        building: row.building_code || row.building_name,
        area_sqft: parseFloat(row.area_sqft) || 0,
        land_share_katha: parseFloat(row.land_share_katha) || 0,
        is_common_share: !!row.is_common_share,
        common_share_type: row.common_share_type
      });
      ownersMap[row.id_owners].total_sft += parseFloat(row.area_sqft) || 0;
      ownersMap[row.id_owners].total_katha += parseFloat(row.land_share_katha) || 0;
    });

    const ownersList = Object.values(ownersMap).map(o => ({
      ...o,
      buildings_count: o.buildings_set.size,
      buildings: Array.from(o.buildings_set)
    }));

    const multiBuildingOwners = ownersList.filter(o => o.buildings_count > 1);

    // 4. Works & Facilities
    const works = await db('construction_works')
      .leftJoin('buildings', 'construction_works.id_buildings', 'buildings.id_buildings')
      .where('construction_works.id_projects', projectId)
      .select(
        'construction_works.*',
        'buildings.building_name',
        'buildings.building_code'
      )
      .orderBy('construction_works.id_works', 'asc');

    const campusCommonWorks = works.filter(w => w.scope_level === 'PROJECT_COMMON');
    const buildingSpecificWorks = works.filter(w => w.scope_level === 'BUILDING_SPECIFIC');

    // Totals
    const totalCampusCommonCost = campusCommonWorks.reduce((acc, w) => acc + (parseFloat(w.actual_cost) || 0), 0);
    const totalBuildingWorksCost = buildingSpecificWorks.reduce((acc, w) => acc + (parseFloat(w.actual_cost) || 0), 0);
    const totalConstructionCost = totalCampusCommonCost + totalBuildingWorksCost;

    // Per Share Allocations:
    // Campus common cost allocated to all 108 shares
    const campusCommonCostPerShare = totalUnitsCount > 0 ? (totalCampusCommonCost / totalUnitsCount) : 0;

    // Building-wise cost per share (36 units per building)
    const buildingCostPerShare = {};
    for (const b of buildings) {
      const bWorks = buildingSpecificWorks.filter(w => w.id_buildings === b.id_buildings);
      const bTotal = bWorks.reduce((acc, w) => acc + (parseFloat(w.actual_cost) || 0), 0);
      const bUnitsCount = b.total_units || 36;
      buildingCostPerShare[b.building_code] = {
        totalCost: bTotal,
        unitsCount: bUnitsCount,
        costPerUnit: bUnitsCount > 0 ? (bTotal / bUnitsCount) : 0
      };
    }

    res.json({
      success: true,
      project,
      stats: {
        totalBuildings: buildings.length,
        totalFloors: project.number_of_floors || 9,
        totalUnits: totalUnitsCount,
        totalShares: 108,
        personalShares: personalUnits.length,
        commonShares: commonSharesUnits.length,
        totalCampusCommonCost,
        totalBuildingWorksCost,
        totalConstructionCost,
        campusCommonCostPerShare,
        multiBuildingOwnersCount: multiBuildingOwners.length
      },
      buildings,
      commonSharesUnits,
      multiBuildingOwners,
      allOwners: ownersList,
      campusCommonWorks,
      buildingSpecificWorks,
      buildingCostPerShare
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 20.2 Create or Allocate New Facility / Work
router.post('/shopno-bilash/works', async (req, res) => {
  try {
    const {
      work_name,
      work_category,
      scope_level, // 'PROJECT_COMMON' or 'BUILDING_SPECIFIC'
      id_buildings,
      facility_tag, // 'MOSQUE', 'MEETING_ROOM', 'SWIMMING_POOL', etc.
      description,
      estimated_cost,
      actual_cost,
      cost_allocation_method
    } = req.body;

    const project = await db('projects').where({ project_code: 'SHOPNO-BILASH-108' }).first();
    const projectId = project ? project.id_projects : 3;

    const [workId] = await db('construction_works').insert({
      id_projects: projectId,
      id_buildings: scope_level === 'BUILDING_SPECIFIC' ? id_buildings : null,
      work_name,
      work_category: work_category || 'FACILITIES_MEP',
      work_type: 'COMBINED',
      scope_level: scope_level || 'PROJECT_COMMON',
      facility_tag: facility_tag || 'GENERAL',
      description,
      estimated_cost: Number(estimated_cost) || 0,
      actual_cost: Number(actual_cost) || Number(estimated_cost) || 0,
      progress_percentage: 0,
      status: 'IN_PROGRESS',
      cost_allocation_method: cost_allocation_method || 'EQUAL'
    });

    // Auto-allocate to target units
    let targetUnitsQuery = db('units').where({ id_projects: projectId });
    if (scope_level === 'BUILDING_SPECIFIC' && id_buildings) {
      targetUnitsQuery = targetUnitsQuery.andWhere({ id_buildings });
    }

    const targetUnits = await targetUnitsQuery.select('id_units', 'area_sqft');
    const unitCount = targetUnits.length || 1;
    const effectiveCost = Number(actual_cost) || Number(estimated_cost) || 0;
    const shareAmount = parseFloat((effectiveCost / unitCount).toFixed(2));
    const allocPercent = parseFloat((100.0 / unitCount).toFixed(4));

    const allocRecords = targetUnits.map(u => ({
      id_works: workId,
      id_units: u.id_units,
      allocation_percentage: allocPercent,
      allocated_amount: shareAmount,
      is_custom: 0,
      notes: `${scope_level === 'PROJECT_COMMON' ? 'Campus-Wide Common' : 'Building-Specific'} Work: ${work_name}`
    }));

    for (let i = 0; i < allocRecords.length; i += 50) {
      await db('work_allocations').insert(allocRecords.slice(i, i + 50));
    }

    res.json({
      success: true,
      message: `Work created and allocated to ${targetUnits.length} units successfully!`,
      workId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 20.3 Owner Cross-Building Portfolio View
router.get('/shopno-bilash/owner-portfolio/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const owner = await db('owners').where({ id_owners: ownerId }).first();
    if (!owner) {
      return res.status(404).json({ success: false, message: 'Owner not found' });
    }

    const units = await db('unit_ownerships')
      .join('units', 'unit_ownerships.id_units', 'units.id_units')
      .leftJoin('buildings', 'units.id_buildings', 'buildings.id_buildings')
      .where('unit_ownerships.id_owners', ownerId)
      .select(
        'units.*',
        'buildings.building_name',
        'buildings.building_code',
        'unit_ownerships.ownership_percentage',
        'unit_ownerships.agreement_date'
      );

    // Get allocations for this owner's units
    const unitIds = units.map(u => u.id_units);
    const allocations = await db('work_allocations')
      .join('construction_works', 'work_allocations.id_works', 'construction_works.id_works')
      .whereIn('work_allocations.id_units', unitIds)
      .select(
        'work_allocations.*',
        'construction_works.work_name',
        'construction_works.scope_level',
        'construction_works.facility_tag'
      );

    // Sum liabilities by unit
    const unitSummaries = units.map(u => {
      const uAllocs = allocations.filter(a => a.id_units === u.id_units);
      const campusAllocs = uAllocs.filter(a => a.scope_level === 'PROJECT_COMMON');
      const buildingAllocs = uAllocs.filter(a => a.scope_level === 'BUILDING_SPECIFIC');

      const campusCost = campusAllocs.reduce((s, a) => s + parseFloat(a.allocated_amount || 0), 0);
      const buildingCost = buildingAllocs.reduce((s, a) => s + parseFloat(a.allocated_amount || 0), 0);
      const totalLiability = campusCost + buildingCost;

      return {
        ...u,
        campusCommonCost: campusCost,
        buildingSpecificCost: buildingCost,
        totalLiability,
        allocationsCount: uAllocs.length
      };
    });

    const grandTotalLiability = unitSummaries.reduce((s, u) => s + u.totalLiability, 0);

    res.json({
      success: true,
      owner,
      units: unitSummaries,
      grandTotalLiability,
      totalSharesOwned: units.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────
// 21. BANGLADESH COMPLIANCE & PROPERTY MANAGEMENT LAYER
// ─────────────────────────────────────────────────────────────

router.get('/compliance/overview', async (req, res) => {
  try {
    const pId = req.query.projectId ? parseInt(req.query.projectId) : 3;

    const land = await db('land_parcels').where({ id_projects: pId }).first() || await db('land_parcels').first();
    const jva = await db('joint_venture_agreements').where({ id_projects: pId }).first() || await db('joint_venture_agreements').first();
    const approvals = await db('authority_approvals').where({ id_projects: pId }).orderBy('id_approvals', 'asc');
    const bnbc = await db('bnbc_compliance_records').where({ id_projects: pId }).orderBy('id_bnbc', 'asc');
    const fireEquipment = await db('fire_safety_equipment').where({ id_projects: pId }).orderBy('id_fire_equip', 'asc');
    const utilityMeters = await db('utility_meters').where({ id_projects: pId }).orderBy('id_utility_meters', 'asc');
    const handovers = await db('property_handovers').where({ id_projects: pId }).orderBy('id_handovers', 'asc');
    const bakiLedger = await db('vendor_baki_ledger').where({ id_projects: pId }).orderBy('id_baki', 'asc');
    const cheques = await db('cheque_register').where({ id_projects: pId }).orderBy('id_cheques', 'asc');

    // Parse JSON fields if they are strings
    if (land && typeof land.landowners_json === 'string') {
      try { land.landowners_json = JSON.parse(land.landowners_json); } catch(e){}
    }
    if (jva) {
      if (typeof jva.flat_allocation_matrix === 'string') {
        try { jva.flat_allocation_matrix = JSON.parse(jva.flat_allocation_matrix); } catch(e){}
      }
      if (typeof jva.parking_allocation_matrix === 'string') {
        try { jva.parking_allocation_matrix = JSON.parse(jva.parking_allocation_matrix); } catch(e){}
      }
    }
    approvals.forEach(a => {
      if (typeof a.document_checklist === 'string') {
        try { a.document_checklist = JSON.parse(a.document_checklist); } catch(e){}
      }
    });
    handovers.forEach(h => {
      if (typeof h.snag_list === 'string') {
        try { h.snag_list = JSON.parse(h.snag_list); } catch(e){}
      }
    });

    // Summary calculations
    const totalBaki = bakiLedger.reduce((s, b) => s + parseFloat(b.current_baki_bdt || 0), 0);
    const totalChequesInward = cheques.filter(c => c.cheque_type === 'INWARD_COLLECTION').reduce((s, c) => s + parseFloat(c.amount_bdt || 0), 0);
    const totalChequesOutward = cheques.filter(c => c.cheque_type === 'OUTWARD_PAYMENT').reduce((s, c) => s + parseFloat(c.amount_bdt || 0), 0);
    const activeFireEquip = fireEquipment.filter(f => f.status === 'ACTIVE_READY').length;
    const pendingNOCs = approvals.filter(a => a.status !== 'APPROVED').length;

    res.json({
      success: true,
      land,
      jva,
      approvals,
      bnbc,
      fireEquipment,
      utilityMeters,
      handovers,
      bakiLedger,
      cheques,
      metrics: {
        totalBaki,
        totalChequesInward,
        totalChequesOutward,
        activeFireEquip,
        totalFireEquip: fireEquipment.length,
        approvedNOCs: approvals.filter(a => a.status === 'APPROVED').length,
        totalNOCs: approvals.length,
        totalHandovers: handovers.length
      }
    });
  } catch (err) {
    console.error('Compliance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update or add Approval NOC
router.post('/compliance/approvals', async (req, res) => {
  try {
    const { id_approvals, authority, approval_title, approval_type, application_number, application_date, approval_date, expiry_date, approval_reference_no, status, remarks } = req.body;
    const pId = req.body.id_projects || 3;

    if (id_approvals) {
      await db('authority_approvals').where({ id_approvals }).update({
        authority, approval_title, approval_type, application_number, application_date, approval_date, expiry_date, approval_reference_no, status, remarks
      });
    } else {
      await db('authority_approvals').insert({
        id_projects: pId,
        authority, approval_title, approval_type, application_number, application_date, approval_date, expiry_date, approval_reference_no, status: status || 'SUBMITTED', remarks
      });
    }
    res.json({ success: true, message: 'Approval / NOC updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update or add Utility Meter Reading
router.post('/compliance/meters', async (req, res) => {
  try {
    const { id_utility_meters, unit_number, utility_type, meter_number, previous_reading, current_reading, unit_rate_bdt, billing_month } = req.body;
    const pId = req.body.id_projects || 3;

    const prev = parseFloat(previous_reading || 0);
    const curr = parseFloat(current_reading || 0);
    const consumption = Math.max(0, curr - prev);
    const rate = parseFloat(unit_rate_bdt || 10.50);
    const totalAmount = consumption * rate;

    if (id_utility_meters) {
      await db('utility_meters').where({ id_utility_meters }).update({
        unit_number, utility_type, meter_number, previous_reading: prev, current_reading: curr, consumption_units: consumption, unit_rate_bdt: rate, billing_month, total_amount_bdt: totalAmount
      });
    } else {
      await db('utility_meters').insert({
        id_projects: pId,
        unit_number, utility_type, meter_number, previous_reading: prev, current_reading: curr, consumption_units: consumption, unit_rate_bdt: rate, billing_month, total_amount_bdt: totalAmount, payment_status: 'BILLED'
      });
    }
    res.json({ success: true, message: 'Utility meter reading recorded successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Record Handover & Snag Check
router.post('/compliance/handovers', async (req, res) => {
  try {
    const { id_handovers, unit_number, owner_name, approved_area_sft, final_measured_area_sft, rate_per_sft_bdt, possession_date, handover_status, remarks } = req.body;
    const pId = req.body.id_projects || 3;

    const appArea = parseFloat(approved_area_sft || 0);
    const measArea = parseFloat(final_measured_area_sft || 0);
    const diff = measArea - appArea;
    const rate = parseFloat(rate_per_sft_bdt || 4500);
    const adjAmount = Math.abs(diff * rate);
    const settlement = diff === 0 ? 'NO_DIFFERENCE' : diff > 0 ? 'PENDING_COLLECTION' : 'PENDING_REFUND';

    if (id_handovers) {
      await db('property_handovers').where({ id_handovers }).update({
        unit_number, owner_name, approved_area_sft: appArea, final_measured_area_sft: measArea, area_difference_sft: diff, rate_per_sft_bdt: rate, area_adjustment_amount_bdt: adjAmount, adjustment_settlement: settlement, possession_date, handover_status, remarks
      });
    } else {
      await db('property_handovers').insert({
        id_projects: pId,
        id_units: 1,
        unit_number, owner_name, approved_area_sft: appArea, final_measured_area_sft: measArea, area_difference_sft: diff, rate_per_sft_bdt: rate, area_adjustment_amount_bdt: adjAmount, adjustment_settlement: settlement, possession_date, handover_status: handover_status || 'READY_FOR_HANDOVER', remarks
      });
    }
    res.json({ success: true, message: 'Handover record updated according to Real Estate Act 2010' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Vendor Baki
router.post('/compliance/baki', async (req, res) => {
  try {
    const { id_baki, vendor_name, trade_specialty, total_purchased_bdt, total_paid_bdt, credit_limit_bdt, payment_terms } = req.body;
    const pId = req.body.id_projects || 3;

    const purchased = parseFloat(total_purchased_bdt || 0);
    const paid = parseFloat(total_paid_bdt || 0);
    const baki = Math.max(0, purchased - paid);

    if (id_baki) {
      await db('vendor_baki_ledger').where({ id_baki }).update({
        vendor_name, trade_specialty, total_purchased_bdt: purchased, total_paid_bdt: paid, current_baki_bdt: baki, credit_limit_bdt, payment_terms
      });
    } else {
      await db('vendor_baki_ledger').insert({
        id_projects: pId,
        vendor_name, trade_specialty, total_purchased_bdt: purchased, total_paid_bdt: paid, current_baki_bdt: baki, credit_limit_bdt, payment_terms
      });
    }
    res.json({ success: true, message: 'Vendor baki ledger entry saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Record Cheque
router.post('/compliance/cheques', async (req, res) => {
  try {
    const { id_cheques, cheque_number, bank_name, branch_name, payee_or_drawer, amount_bdt, issue_date, deposit_date, clearance_date, cheque_type, status, reference_voucher_no, remarks } = req.body;
    const pId = req.body.id_projects || 3;

    if (id_cheques) {
      await db('cheque_register').where({ id_cheques }).update({
        cheque_number, bank_name, branch_name, payee_or_drawer, amount_bdt, issue_date, deposit_date, clearance_date, cheque_type, status, reference_voucher_no, remarks
      });
    } else {
      await db('cheque_register').insert({
        id_projects: pId,
        cheque_number, bank_name, branch_name, payee_or_drawer, amount_bdt, issue_date, deposit_date, clearance_date, cheque_type, status: status || 'ISSUED', reference_voucher_no, remarks
      });
    }
    res.json({ success: true, message: 'Cheque record registered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



// -------------------------------------------------------------
// 22. UNIVERSAL MASTERS REPOSITORY (ZERO STATIC / ZERO HARDCODING)
// -------------------------------------------------------------

// Aggregate endpoint for all 12 system masters
router.get('/universal-masters', async (req, res) => {
  try {
    const [
      unitTemplates,
      sharesConfig,
      materialsCatalogue,
      worksWbs,
      vendorCategories,
      commonFacilities,
      labourTrades,
      utilityServices,
      serviceChargeHeads,
      bankAccounts,
      taxRules,
      snagCategories
    ] = await Promise.all([
      db('master_unit_templates').orderBy('unit_slot', 'asc'),
      db('master_shares').first(),
      db('master_items').orderBy('item_code', 'asc'),
      db('master_works').orderBy('work_code', 'asc'),
      db('master_vendor_categories').orderBy('category_code', 'asc'),
      db('master_common_facilities').orderBy('facility_code', 'asc'),
      db('master_labour_trades').orderBy('standard_daily_wage_bdt', 'desc'),
      db('master_utility_services').orderBy('service_code', 'asc'),
      db('master_service_charge_heads').orderBy('head_code', 'asc'),
      db('master_bank_accounts').orderBy('bank_name', 'asc'),
      db('master_tax_rules').orderBy('tax_rate_percent', 'desc'),
      db('master_snag_categories').orderBy('category_code', 'asc')
    ]);

    res.json({
      success: true,
      data: {
        unitTemplates,
        sharesConfig: sharesConfig || {
          total_land_area_katha: 22.5,
          total_project_shares: 108,
          personal_shares_count: 105,
          common_shares_count: 3,
          connected_buildings_count: 3,
          sqft_per_share: 1350,
          land_share_per_unit_katha: 0.2083,
          common_facility_units: ['A-101', 'B-101', 'C-101']
        },
        materialsCatalogue,
        worksWbs,
        vendorCategories,
        commonFacilities,
        labourTrades,
        utilityServices,
        serviceChargeHeads,
        bankAccounts,
        taxRules,
        snagCategories
      }
    });
  } catch (err) {
    console.error('Error fetching universal masters:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Common Facilities Master CRUD
router.post('/masters/common-facilities', async (req, res) => {
  try {
    const { id_common_facilities, facility_code, facility_name, category, capacity, default_cost_share_rule, maintenance_monthly_budget_bdt, allocated_unit_number, description, is_active } = req.body;
    if (id_common_facilities) {
      await db('master_common_facilities').where({ id_common_facilities }).update({
        facility_code, facility_name, category, capacity, default_cost_share_rule, maintenance_monthly_budget_bdt, allocated_unit_number, description, is_active: is_active ?? true
      });
    } else {
      await db('master_common_facilities').insert({
        facility_code, facility_name, category, capacity, default_cost_share_rule, maintenance_monthly_budget_bdt, allocated_unit_number, description, is_active: is_active ?? true
      });
    }
    const facilities = await db('master_common_facilities').orderBy('facility_code', 'asc');
    res.json({ success: true, message: 'Common facility master record saved', facilities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/common-facilities/:id', async (req, res) => {
  try {
    await db('master_common_facilities').where({ id_common_facilities: req.params.id }).del();
    res.json({ success: true, message: 'Facility deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Labour Trades Master CRUD
router.post('/masters/labour-trades', async (req, res) => {
  try {
    const { id_labour_trades, trade_code, trade_name_en, trade_name_bn, standard_daily_wage_bdt, overtime_rate_per_hour_bdt, skill_level, is_active } = req.body;
    if (id_labour_trades) {
      await db('master_labour_trades').where({ id_labour_trades }).update({
        trade_code, trade_name_en, trade_name_bn, standard_daily_wage_bdt, overtime_rate_per_hour_bdt, skill_level, is_active: is_active ?? true
      });
    } else {
      await db('master_labour_trades').insert({
        trade_code, trade_name_en, trade_name_bn, standard_daily_wage_bdt, overtime_rate_per_hour_bdt, skill_level, is_active: is_active ?? true
      });
    }
    const trades = await db('master_labour_trades').orderBy('standard_daily_wage_bdt', 'desc');
    res.json({ success: true, message: 'Labour trade saved successfully', trades });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/labour-trades/:id', async (req, res) => {
  try {
    await db('master_labour_trades').where({ id_labour_trades: req.params.id }).del();
    res.json({ success: true, message: 'Labour trade deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Utility Services Master CRUD
router.post('/masters/utility-services', async (req, res) => {
  try {
    const { id_utility_services, service_code, service_name, provider_authority, uom, standard_unit_rate_bdt, monthly_demand_charge_bdt, connection_type, is_active } = req.body;
    if (id_utility_services) {
      await db('master_utility_services').where({ id_utility_services }).update({
        service_code, service_name, provider_authority, uom, standard_unit_rate_bdt, monthly_demand_charge_bdt, connection_type, is_active: is_active ?? true
      });
    } else {
      await db('master_utility_services').insert({
        service_code, service_name, provider_authority, uom, standard_unit_rate_bdt, monthly_demand_charge_bdt, connection_type, is_active: is_active ?? true
      });
    }
    const utilities = await db('master_utility_services').orderBy('service_code', 'asc');
    res.json({ success: true, message: 'Utility service master saved', utilities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/utility-services/:id', async (req, res) => {
  try {
    await db('master_utility_services').where({ id_utility_services: req.params.id }).del();
    res.json({ success: true, message: 'Utility service deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Service Charge Heads CRUD
router.post('/masters/service-charge-heads', async (req, res) => {
  try {
    const { id_charge_heads, head_code, head_name_en, head_name_bn, calculation_basis, default_rate_bdt, frequency, is_active } = req.body;
    if (id_charge_heads) {
      await db('master_service_charge_heads').where({ id_charge_heads }).update({
        head_code, head_name_en, head_name_bn, calculation_basis, default_rate_bdt, frequency, is_active: is_active ?? true
      });
    } else {
      await db('master_service_charge_heads').insert({
        head_code, head_name_en, head_name_bn, calculation_basis, default_rate_bdt, frequency, is_active: is_active ?? true
      });
    }
    const heads = await db('master_service_charge_heads').orderBy('head_code', 'asc');
    res.json({ success: true, message: 'Service charge head saved', heads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/service-charge-heads/:id', async (req, res) => {
  try {
    await db('master_service_charge_heads').where({ id_charge_heads: req.params.id }).del();
    res.json({ success: true, message: 'Charge head deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bank Accounts Master CRUD
router.post('/masters/bank-accounts', async (req, res) => {
  try {
    const { id_bank_accounts, account_code, bank_name, branch_name, account_title, account_number, routing_number, account_type, opening_balance_bdt, current_balance_bdt, is_active } = req.body;
    if (id_bank_accounts) {
      await db('master_bank_accounts').where({ id_bank_accounts }).update({
        account_code, bank_name, branch_name, account_title, account_number, routing_number, account_type, opening_balance_bdt, current_balance_bdt, is_active: is_active ?? true
      });
    } else {
      await db('master_bank_accounts').insert({
        account_code, bank_name, branch_name, account_title, account_number, routing_number, account_type, opening_balance_bdt, current_balance_bdt: current_balance_bdt || opening_balance_bdt || 0, is_active: is_active ?? true
      });
    }
    const accounts = await db('master_bank_accounts').orderBy('bank_name', 'asc');
    res.json({ success: true, message: 'Bank account master saved', accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/bank-accounts/:id', async (req, res) => {
  try {
    await db('master_bank_accounts').where({ id_bank_accounts: req.params.id }).del();
    res.json({ success: true, message: 'Bank account deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Tax & VAT Rules CRUD
router.post('/masters/tax-rules', async (req, res) => {
  try {
    const { id_tax_rules, rule_code, tax_name, tax_type, tax_rate_percent, is_withholding_mandatory, minimum_threshold_bdt, nbr_statutory_reference, is_active } = req.body;
    if (id_tax_rules) {
      await db('master_tax_rules').where({ id_tax_rules }).update({
        rule_code, tax_name, tax_type, tax_rate_percent, is_withholding_mandatory: is_withholding_mandatory ?? true, minimum_threshold_bdt, nbr_statutory_reference, is_active: is_active ?? true
      });
    } else {
      await db('master_tax_rules').insert({
        rule_code, tax_name, tax_type, tax_rate_percent, is_withholding_mandatory: is_withholding_mandatory ?? true, minimum_threshold_bdt, nbr_statutory_reference, is_active: is_active ?? true
      });
    }
    const rules = await db('master_tax_rules').orderBy('tax_rate_percent', 'desc');
    res.json({ success: true, message: 'Tax/VAT rule saved', rules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/tax-rules/:id', async (req, res) => {
  try {
    await db('master_tax_rules').where({ id_tax_rules: req.params.id }).del();
    res.json({ success: true, message: 'Tax rule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Snag Categories CRUD
router.post('/masters/snag-categories', async (req, res) => {
  try {
    const { id_snag_cat, category_code, category_name_en, category_name_bn, default_remedy_sla_days, trade_responsible, is_active } = req.body;
    if (id_snag_cat) {
      await db('master_snag_categories').where({ id_snag_cat }).update({
        category_code, category_name_en, category_name_bn, default_remedy_sla_days, trade_responsible, is_active: is_active ?? true
      });
    } else {
      await db('master_snag_categories').insert({
        category_code, category_name_en, category_name_bn, default_remedy_sla_days, trade_responsible, is_active: is_active ?? true
      });
    }
    const categories = await db('master_snag_categories').orderBy('category_code', 'asc');
    res.json({ success: true, message: 'Snag category saved', categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/snag-categories/:id', async (req, res) => {
  try {
    await db('master_snag_categories').where({ id_snag_cat: req.params.id }).del();
    res.json({ success: true, message: 'Snag category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Deletions for previous masters as well
router.delete('/masters/items/:id', async (req, res) => {
  try {
    await db('master_items').where({ id_master_items: req.params.id }).del();
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/works/:id', async (req, res) => {
  try {
    await db('master_works').where({ id_master_works: req.params.id }).del();
    res.json({ success: true, message: 'Work deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/masters/vendor-categories/:id', async (req, res) => {
  try {
    await db('master_vendor_categories').where({ id_vendor_cat: req.params.id }).del();
    res.json({ success: true, message: 'Vendor category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

