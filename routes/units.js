const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const Joi = require('joi');
const checkAuth = require('../middleware/auth');

const schema = Joi.object({
  idBuildings: Joi.number().integer().positive().required(),
  idFloors: Joi.number().integer().positive().allow(null,'').optional(),
  unitNo: Joi.string().max(50).required(),
  unitName: Joi.string().max(150).allow('',null).optional(),
  unitType: Joi.string().valid('Residential Flat','Commercial Space','Office','Shop','Car Park','Store Room').required(),
  grossAreaSqft: Joi.number().positive().allow(null,'').optional(),
  carpetAreaSqft: Joi.number().positive().allow(null,'').optional(),
  superBuiltUpAreaSqft: Joi.number().positive().allow(null,'').optional(),
  balconyAreaSqft: Joi.number().min(0).allow(null,'').optional(),
  carParkCount: Joi.number().integer().min(0).optional(),
  bedCount: Joi.string().allow(null,'').optional(),
  bathCount: Joi.number().integer().min(0).allow(null,'').optional(),
  isCornerUnit: Joi.boolean().optional(),
  facingDirection: Joi.string().max(50).allow('',null).optional(),
  pricePerSqftBdt: Joi.number().min(0).allow(null,'').optional(),
  totalPriceBdt: Joi.number().min(0).allow(null,'').optional(),
  carParkPriceBdt: Joi.number().min(0).allow(null,'').optional(),
  utilityConnectionBdt: Joi.number().min(0).allow(null,'').optional(),
  totalSalePriceBdt: Joi.number().min(0).allow(null,'').optional(),
  allocationType: Joi.string().valid('Developer Share','Land Owner Share','Sold','Reserved','Available').optional(),
  idShareholders: Joi.number().integer().positive().allow(null,'').optional(),
  buyerName: Joi.string().max(250).allow('',null).optional(),
  buyerPhone: Joi.string().max(20).allow('',null).optional(),
  buyerNid: Joi.string().max(50).allow('',null).optional(),
  bookingDate: Joi.date().allow(null,'').optional(),
  handoverDate: Joi.date().allow(null,'').optional(),
  status: Joi.string().valid('Available','Booked','Sold','Under Construction','Handed Over').optional(),
  notes: Joi.string().allow('',null).optional(),
});

const toSnake = d => ({
  id_buildings: d.idBuildings, id_floors: d.idFloors||null,
  unit_no: d.unitNo, unit_name: d.unitName||null, unit_type: d.unitType,
  gross_area_sqft: d.grossAreaSqft||null, carpet_area_sqft: d.carpetAreaSqft||null,
  super_built_up_area_sqft: d.superBuiltUpAreaSqft||null, balcony_area_sqft: d.balconyAreaSqft||null,
  car_park_count: d.carParkCount||0, bed_count: d.bedCount||null, bath_count: d.bathCount||null,
  is_corner_unit: d.isCornerUnit?1:0, facing_direction: d.facingDirection||null,
  price_per_sqft_bdt: d.pricePerSqftBdt||null, total_price_bdt: d.totalPriceBdt||null,
  car_park_price_bdt: d.carParkPriceBdt||null, utility_connection_bdt: d.utilityConnectionBdt||null,
  total_sale_price_bdt: d.totalSalePriceBdt||null, allocation_type: d.allocationType||'Available',
  id_shareholders: d.idShareholders||null, buyer_name: d.buyerName||null,
  buyer_phone: d.buyerPhone||null, buyer_nid: d.buyerNid||null,
  booking_date: d.bookingDate||null, handover_date: d.handoverDate||null,
  status: d.status||'Available', notes: d.notes||null,
});

router.post('/', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success:false, message: error.details.map(e=>e.message).join(', ') });
    const dup = await db('building_units').where('id_buildings', value.idBuildings).where('unit_no', value.unitNo).first();
    if (dup) return res.json({ success:false, message: `Unit "${value.unitNo}" already exists in this building` });
    const [id] = await db('building_units').insert({ ...toSnake(value), created_by: req.user.id_users });
    res.json({ success:true, message:'Unit created', id });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/', checkAuth, async (req, res) => {
  try {
    const { id_buildings, unit_type, status, allocation_type, page=1, limit=100 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = db('building_units as u')
      .leftJoin('building_floors as f','u.id_floors','f.id_floors')
      .leftJoin('building_land_shareholders as s','u.id_shareholders','s.id_shareholders')
      .leftJoin('buildings as b','u.id_buildings','b.id_buildings')
      .select('u.*','f.floor_name','s.shareholder_name','b.building_name');
    if (id_buildings) q = q.where('u.id_buildings', id_buildings);
    if (unit_type) q = q.where('u.unit_type', unit_type);
    if (status) q = q.where('u.status', status);
    if (allocation_type) q = q.where('u.allocation_type', allocation_type);
    const cr = await q.clone().count('u.id_units as total').first();
    const list = await q.orderBy('u.unit_no','asc').limit(parseInt(limit)).offset(offset);
    res.json({ success:true, data:list, total:cr?.total||0 });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/summary', checkAuth, async (req, res) => {
  try {
    const { id_buildings } = req.query;
    if (!id_buildings) return res.json({ success:false });
    const data = await db('building_units').where('id_buildings', id_buildings).select(
      db.raw('COUNT(*) as total_units'),
      db.raw('SUM(CASE WHEN status="Available" THEN 1 ELSE 0 END) as available'),
      db.raw('SUM(CASE WHEN status="Booked" THEN 1 ELSE 0 END) as booked'),
      db.raw('SUM(CASE WHEN status="Sold" THEN 1 ELSE 0 END) as sold'),
      db.raw('SUM(CASE WHEN status="Handed Over" THEN 1 ELSE 0 END) as handed_over'),
      db.raw('SUM(CASE WHEN allocation_type="Land Owner Share" THEN 1 ELSE 0 END) as land_owner_units'),
      db.raw('SUM(CASE WHEN allocation_type="Developer Share" THEN 1 ELSE 0 END) as developer_units'),
      db.raw('SUM(super_built_up_area_sqft) as total_super_built_up_sqft'),
      db.raw('SUM(total_sale_price_bdt) as total_sale_value'),
      db.raw('SUM(CASE WHEN status="Sold" THEN total_sale_price_bdt ELSE 0 END) as sold_value'),
    ).first();
    res.json({ success:true, data });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.get('/:id', checkAuth, async (req, res) => {
  try {
    const unit = await db('building_units as u').leftJoin('building_floors as f','u.id_floors','f.id_floors')
      .leftJoin('building_land_shareholders as s','u.id_shareholders','s.id_shareholders')
      .leftJoin('buildings as b','u.id_buildings','b.id_buildings')
      .where('u.id_units', req.params.id).select('u.*','f.floor_name','s.shareholder_name','b.building_name').first();
    if (!unit) return res.json({ success:false, message:'Unit not found' });
    const paymentSummary = await db('building_unit_payments').where('id_units', req.params.id).where('status','Received').select(db.raw('SUM(amount_bdt) as total_received'),db.raw('COUNT(*) as payment_count')).first();
    res.json({ success:true, unit, paymentSummary });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success:false, message: error.details.map(e=>e.message).join(', ') });
    const dup = await db('building_units').where('id_buildings', value.idBuildings).where('unit_no', value.unitNo).whereNot('id_units', req.params.id).first();
    if (dup) return res.json({ success:false, message:`Unit "${value.unitNo}" already exists` });
    await db('building_units').where('id_units', req.params.id).update(toSnake(value));
    res.json({ success:true, message:'Unit updated' });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const pc = await db('building_unit_payments').where('id_units', req.params.id).count('id_payments as c').first();
    if (parseInt(pc?.c) > 0) return res.json({ success:false, message:'Cannot delete unit with payment records' });
    await db('building_units').where('id_units', req.params.id).del();
    res.json({ success:true, message:'Unit deleted' });
  } catch(err) { res.status(500).json({ success:false }); }
});

module.exports = router;