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
    },
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations', directory: './migrations' },
    seeds: { directory: './seeds' },
  },
};
