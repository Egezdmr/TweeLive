import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
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

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({
    database: dbStatus,
    server: 'running',
    timestamp: new Date()
  });
});

// Test endpoint: Create a user
app.post('/api/users', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, password]
    );

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Test endpoint: Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, created_at FROM users');
    res.json({
      success: true,
      count: result.rows.length,
      users: result.rows
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
