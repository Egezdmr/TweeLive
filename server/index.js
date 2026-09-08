import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';
import session from 'express-session';
import { hashPassword, comparePassword } from '../security/passwordUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../security/.env.local');

dotenv.config({ path: envPath });
dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

// Session configuration
app.use(session({
  secret: 'tweelive-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
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

// ===== MIDDLEWARE: CHECK AUTHENTICATION =====
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Inte inloggad'
    });
  }
  next();
}

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

    // Compare passwords using bcrypt
    const passwordMatch = await comparePassword(password, user.password);

    if (passwordMatch) {
      // Save user to session
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };

      return res.json({
        success: true,
        message: 'Inloggning lyckades!'
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

    // Insert new user with hashed password
    const hashedPassword = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (first_name, last_name, username, email, password, gender, birth_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email',
      [firstName, lastName, username, email, hashedPassword, gender, birthDate]
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

// Get current session user
app.get('/api/auth/me', (req, res) => {
  if (req.session.user) {
    return res.json({
      success: true,
      user: req.session.user
    });
  } else {
    return res.status(401).json({
      success: false,
      message: 'Inte inloggad'
    });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Kunde inte logga ut'
      });
    }

    res.clearCookie('connect.sid');
    return res.json({
      success: true,
      message: 'Utloggning lyckades'
    });
  });
});

// ===== PROTECTED ROUTES (Requires authentication) =====

// 1. Search users
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Sökterm krävs'
      });
    }

    const searchTerm = `%${q}%`;
    const result = await pool.query(
      `SELECT id, username, email FROM users
       WHERE (username ILIKE $1 OR email ILIKE $1)
       AND id != $2
       LIMIT 20`,
      [searchTerm, req.session.user.id]
    );

    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte söka användare'
    });
  }
});

// 2. Get all contacts (organized by status)
app.get('/api/contacts', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Get friends (accepted contacts - both directions)
    const friendsResult = await pool.query(
      `SELECT c.id, u.id as user_id, u.username, u.email, c.status, c.created_at
       FROM contacts c
       JOIN users u ON (
         (c.user_id = $1 AND u.id = c.contact_id) OR
         (c.contact_id = $1 AND u.id = c.user_id)
       )
       WHERE c.status = 'accepted'`,
      [userId]
    );

    // Get pending requests (others sending to this user)
    const pendingResult = await pool.query(
      `SELECT c.id, u.id as user_id, u.username, u.email, c.status, c.created_at
       FROM contacts c
       JOIN users u ON u.id = c.user_id
       WHERE c.contact_id = $1 AND c.status = 'pending'`,
      [userId]
    );

    // Get blocked users (this user blocked them)
    const blockedResult = await pool.query(
      `SELECT c.id, u.id as user_id, u.username, u.email, c.status, c.created_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       WHERE c.user_id = $1 AND c.status = 'blocked'`,
      [userId]
    );

    res.json({
      success: true,
      friends: friendsResult.rows,
      pendingRequests: pendingResult.rows,
      blocked: blockedResult.rows
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte hämta kontakter'
    });
  }
});

// 3. Send friend request
app.post('/api/contacts/request', requireAuth, async (req, res) => {
  try {
    const { contactId } = req.body;
    const userId = req.session.user.id;

    // Validation
    if (!contactId) {
      return res.status(400).json({
        success: false,
        message: 'contactId krävs'
      });
    }

    if (contactId === userId) {
      return res.status(400).json({
        success: false,
        message: 'Du kan inte lägga till dig själv'
      });
    }

    // Check if contact exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [contactId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Användaren finns inte'
      });
    }

    // Check if already exists
    const existingCheck = await pool.query(
      `SELECT id FROM contacts
       WHERE (user_id = $1 AND contact_id = $2)
       OR (user_id = $2 AND contact_id = $1)`,
      [userId, contactId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Kontakt finns redan eller en väntande förfrågan är aktiv'
      });
    }

    // Create friend request
    const result = await pool.query(
      `INSERT INTO contacts (user_id, contact_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, status, created_at`,
      [userId, contactId]
    );

    res.status(201).json({
      success: true,
      message: 'Vänskapsförfrågan skickad',
      contact: result.rows[0]
    });
  } catch (error) {
    console.error('Send request error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte skicka vänskapsförfrågan'
    });
  }
});

// 4. Accept friend request
app.put('/api/contacts/:id/accept', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    // Update only if this user is the recipient
    const result = await pool.query(
      `UPDATE contacts
       SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND contact_id = $2 AND status = 'pending'
       RETURNING id, status`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Förfrågan hittades inte eller är redan accepterad'
      });
    }

    res.json({
      success: true,
      message: 'Vänskapsförfrågan accepterad',
      contact: result.rows[0]
    });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte acceptera vänskapsförfrågan'
    });
  }
});

// 5. Block contact
app.put('/api/contacts/:id/block', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    // Update if user is either party in the relationship
    const result = await pool.query(
      `UPDATE contacts
       SET status = 'blocked', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND (user_id = $2 OR contact_id = $2)
       RETURNING id, status`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kontakt hittades inte'
      });
    }

    res.json({
      success: true,
      message: 'Användare blockerad',
      contact: result.rows[0]
    });
  } catch (error) {
    console.error('Block error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte blockera användare'
    });
  }
});

// 6. Delete/reject/unblock contact
app.delete('/api/contacts/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    // Delete only if user is party to this relationship
    const result = await pool.query(
      `DELETE FROM contacts
       WHERE id = $1 AND (user_id = $2 OR contact_id = $2)
       RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kontakt hittades inte'
      });
    }

    res.json({
      success: true,
      message: 'Kontakt borttagen'
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte ta bort kontakt'
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
