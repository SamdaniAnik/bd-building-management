const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const Joi = require('joi');
const checkAuth = require('../middleware/auth');

const schema = Joi.object({
  idUnits: Joi.number().integer().positive().required(),
  idBuildings: Joi.number().integer().positive().required(),
  paymentNo: Joi.string().max(100).allow('',null).optional(),
  installmentType: Joi.string().max(50).required(),
  amountBdt: Joi.number().positive().required(),
  paymentDate: Joi.date().required(),
  paymentMethod: Joi.string().valid('Cash','Cheque','Bank Transfer','bKash','Nagad','Rocket','Other').required(),
  chequeNo: Joi.string().max(100).allow('',null).optional(),
  bankName: Joi.string().max(200).allow('',null).optional(),
  transactionId: Joi.string().max(150).allow('',null).optional(),
  status: Joi.string().valid('Pending','Received','Bounced','Cancelled').optional(),
  remarks: Joi.string().allow('',null).optional(),
});

router.post('/', checkAuth, async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.json({ success:false, message: error.details.map(e=>e.message).join(', ') });
    const [id] = await db('building_unit_payments').insert({
      id_units: value.idUnits, id_buildings: value.idBuildings,
      payment_no: value.paymentNo||null, installment_type: value.installmentType,
      amount_bdt: value.amountBdt, payment_date: value.paymentDate,
      payment_method: value.paymentMethod, cheque_no: value.chequeNo||null,
      bank_name: value.bankName||null, transaction_id: value.transactionId||null,
      status: value.status||'Received', remarks: value.remarks||null,
      created_by: req.user.id_users,
    });
    res.json({ success:true, message:'Payment recorded', id });
  } catch(err) { console.error(err); res.status(500).json({ success:false, message:'Server error' }); }
});

router.get('/', checkAuth, async (req, res) => {
  try {
    const { id_units, id_buildings, page=1, limit=50 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = db('building_unit_payments as p').leftJoin('building_units as u','p.id_units','u.id_units').select('p.*','u.unit_no');
    if (id_units) q = q.where('p.id_units', id_units);
    if (id_buildings) q = q.where('p.id_buildings', id_buildings);
    const cr = await q.clone().count('p.id_payments as total').first();
    const list = await q.orderBy('p.payment_date','desc').limit(parseInt(limit)).offset(offset);
    res.json({ success:true, data:list, total:cr?.total||0 });
  } catch(err) { res.status(500).json({ success:false }); }
});

router.delete('/:id', checkAuth, async (req, res) => {
  try {
    await db('building_unit_payments').where('id_payments', req.params.id).del();
    res.json({ success:true, message:'Payment deleted' });
  } catch(err) { res.status(500).json({ success:false }); }
});

module.exports = router;