require('./env');
const { Pool } = require('pg');

let dbStatus = 'disconnected';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
  dbStatus = 'connected';
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err.message);
  dbStatus = 'error: ' + err.message;
});

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database query failed:', err.message);
    dbStatus = 'error: ' + err.message;
  } else {
    console.log('✅ Database connected');
    dbStatus = 'connected';
  }
});

// Säkerställer att lässtatus finns för olästa meddelanden
async function sakerstallLasstatus() {
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE');
}

module.exports = { pool, getDbStatus: () => dbStatus, sakerstallLasstatus };
