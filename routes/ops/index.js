// Building operations API, mounted at /api/ops (see app.js).
const express = require('express');
const router = express.Router();
const { fail, unitsQuery, primaryOwners } = require('./common');

// Lightweight flat list for dropdowns: { id_units, label, unit_number, building_name, status, area_sqft, owner_name }
router.get('/units', async (req, res) => {
  try {
    const units = await unitsQuery().orderBy('u.id_buildings').orderBy('u.unit_number');
    const owners = await primaryOwners(units.map(u => u.id_units));
    res.json({ success: true, rows: units.map(u => ({ ...u, owner_name: owners[u.id_units]?.full_name || null,
      label: `${u.building_code || (u.building_name ? u.building_name.split(' - ')[0] : '')}${u.building_name || u.building_code ? ' · ' : ''}${u.unit_number}` })) });
  } catch (err) { fail(res, err); }
});

router.use('/tenants', require('./tenants'));
router.use('/billing', require('./billing'));
router.use('/staff', require('./staff'));
router.use('/gate', require('./gate'));
router.use('/helpdesk', require('./helpdesk'));
router.use('/automation', require('./automation'));

module.exports = router;
