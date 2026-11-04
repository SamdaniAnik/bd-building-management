const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const Joi = require('joi');
const checkAuth = require('../middleware/auth');
const { to: _ } = require('await-to-js');

const schema = Joi.object({
  buildingName: Joi.string().max(250).required().messages({'any.required':'Building name is required'}),
  buildingCode: Joi.string().max(50).allow('',null).optional(),
  buildingType: Joi.string().valid('Residential','Commercial','Mixed').required(),
  totalLandAreaKatha: Joi.number().positive().required(),
  totalLandAreaSqft: Joi.number().allow(null,'').optional(),
  farRatio: Joi.number().allow(null,'').optional(),
  totalBuildableAreaSqft: Joi.number().allow(null,'').optional(),
  district: Joi.string().max(100).allow('',null).optional(),
  upazila: Joi.string().max(100).allow('',null).optional(),
  mouza: Joi.string().max(150).allow('',null).optional(),
  dagNo: Joi.string().max(100).allow('',null).optional(),
  khatianNo: Joi.string().max(100).allow('',null).optional(),
  address: Joi.string().allow('',null).optional(),
  totalFloors: Joi.number().integer().min(0).allow(null,'').optional(),
  basementFloors: Joi.number().integer().min(0).allow(null,'').optional(),
  totalUnits: Joi.number().integer().min(0).allow(null,'').optional(),
  rajukApprovalNo: Joi.string().max(150).allow('',null).optional(),
  rajukApprovalDate: Joi.date().allow(null,'').optional(),
  approvalAuthority: Joi.string().valid('RAJUK','KDA','CDA','RDA','Other').allow(null,'').optional(),
  landPurchaseCost: Joi.number().allow(null,'').optional(),
  estimatedConstructionCost: Joi.number().allow(null,'').optional(),
  status: Joi.string().valid('Planning','Under Construction','Completed','Cancelled').optional(),
  startDate: Joi.date().allow(null,'').optional(),
  completionDate: Joi.date().allow(null,'').optional(),
  notes: Joi.string().allow('',null).optional(),
});

const toSnake = d => ({
  building_name: d.buildingName,
  building_code: d.buildingCode || null,
  building_type: d.buildingType,
  total_land_area: d.totalLandAreaKatha,
  total_land_area_sqft: d.totalLandAreaSqft || (d.totalLandAreaKatha * 720),
  far_ratio: d.farRatio || null,
  total_buildable_area_sqft: d.totalBuildableAreaSqft || null,
  district: d.district || null,
  upazila: d.upazila || null,
  mouza: d.mouza || null,
  dag_no: d.dagNo || null,
  khatian_no: d.khatianNo || null,
  address: d.address || null,
  total_floors: d.totalFloors || null,
  basement_floors: d.basementFloors || 0,
  total_units: d.totalUnits || null,
  rajuk_approval_no: d.rajukApprovalNo || null,
  rajuk_approval_date: d.rajukApprovalDate || null,
  approval_authority: d.approvalAuthority || null,
  land_purchase_cost: d.landPurchaseCost || null,
  estimated_construction_cost: d.estimatedConstructionCost || null,
  status: d.status || 'Planning',
  start_date: d.startDate || null,
  completion_date: d.completionDate || null,
  notes: d.notes || null,
});

// CREATE
router.post('/', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success: false, message: error.details.map(e => e.message).join(', ') });
    if (value.buildingCode) {
      const dup = await db('buildings').where('building_code', value.buildingCode).first();
      if (dup) return res.json({ success: false, message: 'Building code already exists' });
    }
    const [err, result] = await _(db('buildings').insert({ ...toSnake(value), created_by: req.user.id_users }));
    if (err) throw err;
    res.json({ success: true, message: 'Building created successfully', id: result[0] });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// LIST
router.get('/', checkAuth, async (req, res) => {
  try {
    const { page=1, limit=10, search, status, building_type, orderBy='id_buildings', order='desc' } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = db('buildings as b').leftJoin('users as u','b.created_by','u.id_users')
      .select('b.*', db.raw('u.name as created_by_name'));
    if (search) q = q.where(function(){ this.where('b.building_name','like',`%${search}%`).orWhere('b.building_code','like',`%${search}%`).orWhere('b.address','like',`%${search}%`); });
    if (status) q = q.where('b.status', status);
    if (building_type) q = q.where('b.building_type', building_type);
    const [cErr, cr] = await _(q.clone().count('b.id_buildings as total').first());
    const [lErr, list] = await _(q.orderBy(`b.${orderBy}`, order).limit(parseInt(limit)).offset(offset));
    if (cErr || lErr) throw cErr || lErr;
    res.json({ success: true, data: list, total: cr?.total || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET ONE
router.get('/:id', checkAuth, async (req, res) => {
  try {
    const building = await db('buildings').where('id_buildings', req.params.id).first();
    if (!building) return res.json({ success: false, message: 'Building not found' });
    const shareholders = await db('building_land_shareholders').where('id_buildings', req.params.id).select('*');
    const unitsSummary = await db('building_units').where('id_buildings', req.params.id)
      .select('status','unit_type').count('id_units as count').groupBy('status','unit_type');
    const costingSummary = await db('building_costing').where('id_buildings', req.params.id)
      .select(db.raw('SUM(amount_bdt) as total_cost'), db.raw('SUM(paid_amount_bdt) as total_paid')).first();
    res.json({ success: true, building, shareholders, unitsSummary, costingSummary });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// UPDATE
router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success: false, message: error.details.map(e => e.message).join(', ') });
    const existing = await db('buildings').where('id_buildings', req.params.id).first();
    if (!existing) return res.json({ success: false, message: 'Building not found' });
    if (value.buildingCode) {
      const dup = await db('buildings').where('building_code', value.buildingCode).whereNot('id_buildings', req.params.id).first();
      if (dup) return res.json({ success: false, message: 'Building code already exists' });
    }
    await db('buildings').where('id_buildings', req.params.id).update(toSnake(value));
    res.json({ success: true, message: 'Building updated successfully' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// DELETE
router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const unitCount = await db('building_units').where('id_buildings', req.params.id).count('id_units as c').first();
    if (parseInt(unitCount?.c) > 0) return res.json({ success: false, message: 'Cannot delete building with existing units' });
    await db('buildings').where('id_buildings', req.params.id).del();
    res.json({ success: true, message: 'Building deleted successfully' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// DROPDOWN
router.get('/dropdown/list', checkAuth, async (req, res) => {
  try {
    const list = await db('buildings').select('id_buildings as value','building_name as label').orderBy('building_name');
    res.json({ success: true, data: list });
  } catch(err) { res.status(500).json({ success:false }); }
});

module.exports = router;