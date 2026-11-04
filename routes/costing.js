const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const Joi = require('joi');
const checkAuth = require('../middleware/auth');

const schema = Joi.object({
  idBuildings: Joi.number().integer().positive().required(),
  costCategory: Joi.string().max(100).required(),
  description: Joi.string().max(500).allow('',null).optional(),
  quantity: Joi.number().positive().allow(null,'').optional(),
  unit: Joi.string().max(50).allow('',null).optional(),
  rateBdt: Joi.number().min(0).allow(null,'').optional(),
  amountBdt: Joi.number().positive().required(),
  vatPercent: Joi.number().min(0).max(100).optional(),
  vatAmountBdt: Joi.number().min(0).optional(),
  totalWithVatBdt: Joi.number().min(0).allow(null,'').optional(),
  costType: Joi.string().valid('Land','Construction','Approval','Utility','Administrative','Other').optional(),
  costDate: Joi.date().allow(null,'').optional(),
  paymentStatus: Joi.string().valid('Budgeted','Partially Paid','Paid').optional(),
  paidAmountBdt: Joi.number().min(0).optional(),
  remarks: Joi.string().allow('',null).optional(),
});

const toSnake = d => ({
  id_buildings: d.idBuildings, cost_category: d.costCategory,
  description: d.description||null, quantity: d.quantity||null,
  unit: d.unit||null, rate_bdt: d.rateBdt||null, amount_bdt: d.amountBdt,
  vat_percent: d.vatPercent||0, vat_amount_bdt: d.vatAmountBdt||0,
  total_with_vat_bdt: d.totalWithVatBdt||(d.amountBdt+(d.vatAmountBdt||0)),
  cost_type: d.costType||'Construction', cost_date: d.costDate||null,
  payment_status: d.paymentStatus||'Budgeted', paid_amount_bdt: d.paidAmountBdt||0,
  remarks: d.remarks||null,
});

router.post('/', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success:false, message: error.details.map(e=>e.message).join(', ') });
    const [id] = await db('building_costing').insert({ ...toSnake(value), created_by: req.user.id_users });
    res.json({ success:true, message:'Cost entry added', id });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/', checkAuth, async (req, res) => {
  try {
    const { id_buildings, cost_type, payment_status, page=1, limit=100 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = db('building_costing as c').leftJoin('buildings as b','c.id_buildings','b.id_buildings').leftJoin('users as u','c.created_by','u.id_users').select('c.*','b.building_name',db.raw('u.name as created_by_name'));
    if (id_buildings) q = q.where('c.id_buildings', id_buildings);
    if (cost_type) q = q.where('c.cost_type', cost_type);
    if (payment_status) q = q.where('c.payment_status', payment_status);
    const cr = await q.clone().count('c.id_costing as total').first();
    const list = await q.orderBy('c.id_costing','desc').limit(parseInt(limit)).offset(offset);
    res.json({ success:true, data:list, total:cr?.total||0 });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/summary', checkAuth, async (req, res) => {
  try {
    const { id_buildings } = req.query;
    if (!id_buildings) return res.json({ success:false });
    const byType = await db('building_costing').where('id_buildings', id_buildings).groupBy('cost_type').select('cost_type',db.raw('SUM(amount_bdt) as total_bdt'),db.raw('SUM(paid_amount_bdt) as total_paid'));
    const byCategory = await db('building_costing').where('id_buildings', id_buildings).groupBy('cost_category').select('cost_category',db.raw('SUM(amount_bdt) as total_bdt'),db.raw('SUM(paid_amount_bdt) as total_paid')).orderBy('total_bdt','desc');
    const grandTotal = await db('building_costing').where('id_buildings', id_buildings).select(db.raw('SUM(amount_bdt) as total_budget_bdt'),db.raw('SUM(paid_amount_bdt) as total_paid_bdt'),db.raw('SUM(total_with_vat_bdt) as total_with_vat_bdt'),db.raw('COUNT(*) as entry_count')).first();
    const building = await db('buildings').where('id_buildings', id_buildings).select('total_buildable_area_sqft').first();
    const buildableArea = parseFloat(building?.total_buildable_area_sqft||0);
    const costPerSqft = buildableArea > 0 ? (parseFloat(grandTotal?.total_budget_bdt||0)/buildableArea).toFixed(2) : null;
    res.json({ success:true, byType, byCategory, grandTotal, costPerSqft, buildableArea });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.get('/bd-rates', checkAuth, (req, res) => {
  res.json({ success:true, data: {
    constructionRates: {
      "Foundation & Piling (RCC Pile)": { unit:"rft", minRate:1200, maxRate:2500 },
      "RCC Frame Structure": { unit:"sqft", minRate:1800, maxRate:2800 },
      "Brick Work & Masonry": { unit:"sqft", minRate:350, maxRate:600 },
      "Plastering & Finishing": { unit:"sqft", minRate:180, maxRate:350 },
      "Tiles (Floor - Ceramic)": { unit:"sqft", minRate:80, maxRate:250 },
      "Tiles (Floor - Marble)": { unit:"sqft", minRate:300, maxRate:800 },
      "Electrical Work": { unit:"sqft", minRate:150, maxRate:350 },
      "Plumbing & Sanitary": { unit:"sqft", minRate:120, maxRate:280 },
      "Paint Work (Exterior)": { unit:"sqft", minRate:60, maxRate:150 },
      "Doors & Windows (Basic)": { unit:"sqft", minRate:400, maxRate:1200 },
      "Lift (8-person)": { unit:"nos", minRate:2500000, maxRate:6000000 },
      "Generator (30 KVA)": { unit:"nos", minRate:700000, maxRate:1500000 },
    },
    utilityConnectionRates: {
      "WASA Connection": { unit:"connection", minRate:50000, maxRate:200000 },
      "PDB/DESCO Electric": { unit:"connection", minRate:60000, maxRate:300000 },
      "Titas Gas": { unit:"connection", minRate:30000, maxRate:150000 },
    },
    typicalSalePricePerSqft: {
      "Mirpur (Dhaka)": { minRate:5000, maxRate:8000 },
      "Mohammadpur (Dhaka)": { minRate:6000, maxRate:10000 },
      "Uttara (Dhaka)": { minRate:8000, maxRate:14000 },
      "Bashundhara (Dhaka)": { minRate:10000, maxRate:18000 },
      "Gulshan (Dhaka)": { minRate:18000, maxRate:40000 },
      "Dhanmondi (Dhaka)": { minRate:15000, maxRate:30000 },
      "Chittagong City": { minRate:5000, maxRate:15000 },
      "Sylhet City": { minRate:4000, maxRate:10000 },
    },
    landConversion: { "1 Katha":"720 sqft", "1 Bigha":"14400 sqft = 20 katha", "1 Decimal":"435.6 sqft" },
    notes: "Approximate BD market rates 2025-26. Verify with local contractors."
  }});
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success:false, message: error.details.map(e=>e.message).join(', ') });
    await db('building_costing').where('id_costing', req.params.id).update(toSnake(value));
    res.json({ success:true, message:'Cost entry updated' });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.delete('/:id', checkAuth, async (req, res) => {
  try {
    await db('building_costing').where('id_costing', req.params.id).del();
    res.json({ success:true, message:'Cost entry deleted' });
  } catch(err) { res.status(500).json({ success:false }); }
});

module.exports = router;