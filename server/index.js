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

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'Användarnamn/e-post och lösenord krävs'
    });
  }

  try {
    // Find user by username OR email
    const result = await pool.query(
      'SELECT id, username, email, password FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Inloggningsuppgifterna är felaktiga'
      });
    }

    const user = result.rows[0];

    // Compare passwords (no hashing for now)
    if (user.password === password) {
      return res.json({
        success: true,
        message: 'Inloggning lyckades!',
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
    } else {
      return res.status(401).json({
        success: false,
        message: 'Inloggningsuppgifterna är felaktiga'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { firstName, lastName, username, email, password, gender, birthDate } = req.body;

  // Validate required fields
  if (!firstName || !lastName || !username || !email || !password || gender === undefined || !birthDate) {
    return res.status(400).json({
      success: false,
      message: 'Alla fält är obligatoriska'
    });
  }

  try {
    // Check if username already exists
    const userCheck = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Användarnamnet är redan taget'
      });
    }

    // Check if email already exists
    const emailCheck = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'E-postadressen är redan registrerad'
      });
    }

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (first_name, last_name, username, email, password, gender, birth_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email',
      [firstName, lastName, username, email, password, gender, birthDate]
    );

    res.json({
      success: true,
      message: 'Registrering lyckades!',
      user: result.rows[0]
    });
  } catch (error) {
    // Handle database constraint errors
    if (error.code === '23505') { // Unique violation
      if (error.detail && error.detail.includes('email')) {
        return res.status(400).json({
          success: false,
          message: 'E-postadressen är redan registrerad'
        });
      } else if (error.detail && error.detail.includes('username')) {
        return res.status(400).json({
          success: false,
          message: 'Användarnamnet är redan taget'
        });
      }
    }

    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registreringen misslyckades: ' + error.message
    });
  }
});

// Check if username exists
app.get('/api/check-username/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const result = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    res.json({
      exists: result.rows.length > 0
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Check if email exists
app.get('/api/check-email/:email', async (req, res) => {
  const { email } = req.params;

  try {
    const result = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    res.json({
      exists: result.rows.length > 0
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
