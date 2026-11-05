require('dotenv').config();
module.exports = {
  development: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DATABASE || 'bd_building_management',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      // DATE columns come back as 'YYYY-MM-DD' strings. As Date objects they were local midnight, which in
      // Dhaka (UTC+6) serialises as the previous day ("2026-03-11T18:00:00.000Z" for 12 March).
      dateStrings: ['DATE'],
    },
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations', directory: './migrations' },
    seeds: { directory: './seeds' },
  },
};
