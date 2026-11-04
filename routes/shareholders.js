const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const Joi = require('joi');
const checkAuth = require('../middleware/auth');

const schema = Joi.object({
  idBuildings: Joi.number().integer().positive().required(),
  shareholderName: Joi.string().max(250).required(),
  fatherName: Joi.string().max(250).allow('',null).optional(),
  nidNo: Joi.string().max(50).allow('',null).optional(),
  phone: Joi.string().max(20).allow('',null).optional(),
  email: Joi.string().email().max(150).allow('',null).optional(),
  address: Joi.string().allow('',null).optional(),
  landShareKatha: Joi.number().positive().required(),
  landSharePercent: Joi.number().min(0).max(100).required(),
  landShareSqft: Joi.number().allow(null,'').optional(),
  entitledFlatAreaSqft: Joi.number().allow(null,'').optional(),
  entitledFlatCount: Joi.number().integer().min(0).allow(null,'').optional(),
  entitledCarParkCount: Joi.number().min(0).allow(null,'').optional(),
  agreementNo: Joi.string().max(100).allow('',null).optional(),
  agreementDate: Joi.date().allow(null,'').optional(),
  paymentMode: Joi.string().valid('Cash','Flat','Cash + Flat','Plot').allow(null,'').optional(),
  cashAmountBdt: Joi.number().allow(null,'').optional(),
  powerOfAttorneyNo: Joi.string().max(150).allow('',null).optional(),
  powerOfAttorneyDate: Joi.date().allow(null,'').optional(),
  status: Joi.string().valid('Active','Inactive').optional(),
  notes: Joi.string().allow('',null).optional(),
});

const toSnake = d => ({
  id_buildings: d.idBuildings, shareholder_name: d.shareholderName,
  father_name: d.fatherName||null, nid_no: d.nidNo||null, phone: d.phone||null,
  email: d.email||null, address: d.address||null,
  land_share_katha: d.landShareKatha, land_share_percent: d.landSharePercent,
  land_share_sqft: d.landShareSqft||(d.landShareKatha*720),
  entitled_flat_area_sqft: d.entitledFlatAreaSqft||null,
  entitled_flat_count: d.entitledFlatCount||null,
  entitled_car_park_count: d.entitledCarParkCount||null,
  agreement_no: d.agreementNo||null, agreement_date: d.agreementDate||null,
  payment_mode: d.paymentMode||null, cash_amount_bdt: d.cashAmountBdt||null,
  power_of_attorney_no: d.powerOfAttorneyNo||null, power_of_attorney_date: d.powerOfAttorneyDate||null,
  status: d.status||'Active', notes: d.notes||null,
});

router.post('/', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success: false, message: error.details.map(e=>e.message).join(', ') });
    const building = await db('buildings').where('id_buildings', value.idBuildings).first();
    if (!building) return res.json({ success: false, message: 'Building not found' });
    const existing = await db('building_land_shareholders').where('id_buildings', value.idBuildings).where('status','Active').sum('land_share_percent as total').first();
    const current = parseFloat(existing?.total || 0);
    if (current + value.landSharePercent > 100.001)
      return res.json({ success: false, message: `Total share cannot exceed 100%. Currently ${current.toFixed(2)}% allocated. Available: ${(100-current).toFixed(2)}%` });
    const [id] = await db('building_land_shareholders').insert({ ...toSnake(value), created_by: req.user.id_users });
    res.json({ success: true, message: 'Shareholder added', id });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/', checkAuth, async (req, res) => {
  try {
    const { id_buildings, page=1, limit=50 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = db('building_land_shareholders as s').leftJoin('buildings as b','s.id_buildings','b.id_buildings').select('s.*','b.building_name');
    if (id_buildings) q = q.where('s.id_buildings', id_buildings);
    const cr = await q.clone().count('s.id_shareholders as total').first();
    const list = await q.orderBy('s.id_shareholders','desc').limit(parseInt(limit)).offset(offset);
    res.json({ success:true, data:list, total:cr?.total||0 });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/summary', checkAuth, async (req, res) => {
  try {
    const { id_buildings } = req.query;
    if (!id_buildings) return res.json({ success:false, message:'Building required' });
    const data = await db('building_land_shareholders').where('id_buildings', id_buildings).where('status','Active')
      .select(db.raw('SUM(land_share_percent) as total_share_percent'), db.raw('SUM(land_share_katha) as total_share_katha'),
              db.raw('COUNT(*) as shareholder_count'), db.raw('SUM(entitled_flat_area_sqft) as total_entitled_sqft'),
              db.raw('SUM(entitled_flat_count) as total_entitled_flats')).first();
    res.json({ success:true, data });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.get('/dropdown', checkAuth, async (req, res) => {
  try {
    const { id_buildings } = req.query;
    let q = db('building_land_shareholders').select('id_shareholders as value','shareholder_name as label').where('status','Active');
    if (id_buildings) q = q.where('id_buildings', id_buildings);
    res.json({ success:true, data: await q.orderBy('shareholder_name') });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success: false, message: error.details.map(e=>e.message).join(', ') });
    const existing = await db('building_land_shareholders').where('id_buildings', value.idBuildings).where('status','Active').whereNot('id_shareholders', req.params.id).sum('land_share_percent as total').first();
    const current = parseFloat(existing?.total || 0);
    if (current + value.landSharePercent > 100.001)
      return res.json({ success: false, message: `Total share cannot exceed 100%. Others hold ${current.toFixed(2)}%. Max you can set: ${(100-current).toFixed(2)}%` });
    await db('building_land_shareholders').where('id_shareholders', req.params.id).update(toSnake(value));
    res.json({ success:true, message:'Shareholder updated' });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const uc = await db('building_units').where('id_shareholders', req.params.id).count('id_units as c').first();
    if (parseInt(uc?.c) > 0) return res.json({ success:false, message:'Cannot delete: has allocated units' });
    await db('building_land_shareholders').where('id_shareholders', req.params.id).del();
    res.json({ success:true, message:'Shareholder deleted' });
  } catch(err) { res.status(500).json({ success:false }); }
});

module.exports = router;