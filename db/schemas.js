const { db } = require('./database');
const TABLES = {
  USERS: 'users',
  BUILDINGS: 'buildings',
  BUILDING_LAND_SHAREHOLDERS: 'building_land_shareholders',
  BUILDING_FLOORS: 'building_floors',
  BUILDING_UNITS: 'building_units',
  BUILDING_COSTING: 'building_costing',
  BUILDING_UNIT_PAYMENTS: 'building_unit_payments',
};
const table = (t) => db(t);
module.exports = { db, TABLES, table };
