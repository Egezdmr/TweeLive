import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';
import session from 'express-session';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { hashPassword, comparePassword } from '../security/passwordUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../security/.env.local');

dotenv.config({ path: envPath });
dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server);

// Verifiera Supabase environment variabler
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('⚠️  VARNING: SUPABASE_URL eller SUPABASE_ANON_KEY saknas. Filuppladdning kommer inte att fungera.');
}

// Initiera Supabase-klienten
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Konfigurera Multer för minnesutrymme
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

// userId -> Set med socketIds (stödjer flera flikar från samma användare)
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (rawUserId) => {
    const userId = parseInt(rawUserId, 10);
    if (!userId || isNaN(userId)) return;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit('user_status_change', { userId, status: 'online' });
    }
    onlineUsers.get(userId).add(socket.id);
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join('conv_' + conversationId);
  });

  socket.on('typing_start', ({ conversationId, username }) => {
    socket.to('conv_' + conversationId).emit('user_typing', { username });
  });

  socket.on('typing_stop', ({ conversationId }) => {
    socket.to('conv_' + conversationId).emit('user_stop_typing');
  });

  socket.on('disconnect', () => {
    let disconnectedUserId = null;
    for (const [userId, socketIds] of onlineUsers.entries()) {
      if (socketIds.has(socket.id)) {
        socketIds.delete(socket.id);
        disconnectedUserId = userId;

        if (socketIds.size === 0) {
          onlineUsers.delete(userId);
          io.emit('user_status_change', { userId, status: 'offline' });
        }
        break;
      }
    }
  });
});

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
      'SELECT id, username, email, password, status_message FROM users WHERE username = $1 OR email = $1',
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
        email: user.email,
        status_message: user.status_message || ''
      };

      return res.json({
        success: true,
        message: 'Inloggning lyckades!',
        user: {
          id: user.id,
          username: user.username,
          status_message: user.status_message || ''
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

// 1.5. Hämta lista över online-användare
app.get('/api/users/online', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      onlineUserIds: Array.from(onlineUsers.keys()).map(id => parseInt(id))
    });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte hämta online-statusen'
    });
  }
});

// 2. Get all contacts (organized by status)
app.get('/api/contacts', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Get friends (accepted contacts - both directions)
    const friendsResult = await pool.query(
      `SELECT c.id, u.id as user_id, u.username, u.email, u.status_message, c.status, c.created_at
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
      `SELECT c.id, u.id as user_id, u.username, u.email, u.status_message, c.status, c.created_at
       FROM contacts c
       JOIN users u ON u.id = c.user_id
       WHERE c.contact_id = $1 AND c.status = 'pending'`,
      [userId]
    );

    // Get blocked users (this user blocked them)
    const blockedResult = await pool.query(
      `SELECT c.id, u.id as user_id, u.username, u.email, u.status_message, c.status, c.created_at
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

    const requesterInfo = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [userId]
    );

    const socketIds = onlineUsers.get(parseInt(contactId, 10));
    if (socketIds && socketIds.size > 0) {
      socketIds.forEach(socketId => {
        io.to(socketId).emit('friend_request_received', { 
          from: requesterInfo.rows[0].username 
        });
      });
    }

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

    const contactQuery = await pool.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [id]
    );

    if (contactQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Förfrågan hittades inte'
      });
    }

    const requesterUserId = contactQuery.rows[0].user_id;

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

    const currentUserInfo = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [userId]
    );

    const requesterSocketIds = onlineUsers.get(parseInt(requesterUserId, 10));
    if (requesterSocketIds && requesterSocketIds.size > 0) {
      requesterSocketIds.forEach(socketId => {
        io.to(socketId).emit('friend_request_accepted', { 
          from: currentUserInfo.rows[0].username 
        });
      });
    }

    const recipientSocketIds = onlineUsers.get(parseInt(userId, 10));
    if (recipientSocketIds && recipientSocketIds.size > 0) {
      recipientSocketIds.forEach(socketId => {
        io.to(socketId).emit('friend_request_accepted', { 
          from: currentUserInfo.rows[0].username 
        });
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

    const contactQuery = await pool.query(
      'SELECT user_id, contact_id FROM contacts WHERE id = $1',
      [id]
    );

    if (contactQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kontakt hittades inte'
      });
    }

    const { user_id, contact_id } = contactQuery.rows[0];

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

    const targetIds = [parseInt(user_id, 10), parseInt(contact_id, 10)];
    targetIds.forEach(targetId => {
      const socketIds = onlineUsers.get(targetId);
      if (socketIds) {
        socketIds.forEach(sId => io.to(sId).emit('contact_removed', { contactRecordId: parseInt(id, 10) }));
      }
    });

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

// 7. Hitta eller skapa en konversation med en annan användare
app.post('/api/conversations', requireAuth, async (req, res) => {
  const { recipientId } = req.body;
  const userId = req.session.user.id;

  if (!recipientId) {
    return res.status(400).json({
      success: false,
      message: 'recipientId krävs'
    });
  }

  if (parseInt(recipientId) === userId) {
    return res.status(400).json({
      success: false,
      message: 'Du kan inte starta en konversation med dig själv'
    });
  }

  const client = await pool.connect();

  try {
    const existing = await client.query(
      `SELECT cp1.conversation_id
       FROM conversation_participants cp1
       JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
       WHERE cp1.user_id = $1 AND cp2.user_id = $2
       LIMIT 1`,
      [userId, recipientId]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        conversationId: existing.rows[0].conversation_id
      });
    }

    await client.query('BEGIN');

    const newConversation = await client.query(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id'
    );
    const conversationId = newConversation.rows[0].id;

    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [conversationId, userId, recipientId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      conversationId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte skapa konversation'
    });
  } finally {
    client.release();
  }
});

// 8. Hämta meddelandehistorik för en konversation
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    const participant = await pool.query(
      `SELECT 1 FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (participant.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Du har inte åtkomst till denna konversation'
      });
    }

    const result = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_id, u.username as sender_username,
              m.content, m.message_type, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
       LIMIT 50`,
      [id]
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte hämta meddelanden'
    });
  }
});

// 9. Skickar ett nytt meddelande till en konversation
app.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, messageType = 'text' } = req.body;
    const userId = req.session.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Meddelandet kan inte vara tomt'
      });
    }

    const participant = await pool.query(
      `SELECT 1 FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (participant.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Du har inte åtkomst till denna konversation'
      });
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, sender_id, content, message_type, created_at`,
      [id, userId, content.trim(), messageType]
    );

    const savedMessage = {
      ...result.rows[0],
      sender_username: req.session.user.username
    };

    // Skicka till alla som är med i konversationsrummet (om de är där)
    io.to('conv_' + id).emit('new_message', savedMessage);

    // Skicka även direkt till alla anslutna sockets för konversationens deltagare
    const participants = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = $1',
      [id]
    );

    participants.rows.forEach(p => {
      const socketIds = onlineUsers.get(parseInt(p.user_id, 10));
      if (socketIds) {
        socketIds.forEach(sId => {
          io.to(sId).emit('new_message', savedMessage);
        });
      }
    });

    res.status(201).json({
      success: true,
      message: savedMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte skicka meddelandet'
    });
  }
});

// Filuppladdning för bilder och ljud
app.post('/api/conversations/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Ingen fil uppladdad eller ogiltigt filformat (endast bilder och ljud tillåts).'
      });
    }

    // Verifiera att användaren är deltagare i konversationen
    const participantCheck = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Du har inte åtkomst till denna konversation'
      });
    }

    // Rensa filnamn: ersätt specialtecken och mellanslag med understreck
    const sanitizedName = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\s+/g, '_');

    // Generera unikt filnamn
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${sanitizedName}`;

    // Ladda upp till Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat_attachments')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Kunde inte ladda upp filen till molnet'
      });
    }

    // Hämta offentlig URL
    const { data: publicUrlData } = supabase.storage
      .from('chat_attachments')
      .getPublicUrl(fileName);

    const fileUrl = publicUrlData.publicUrl;
    const messageType = req.file.mimetype.startsWith('image/') ? 'image' : 'audio';

    // Spara meddelandet i databasen
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, sender_id, content, message_type, created_at`,
      [id, userId, fileUrl, messageType]
    );

    const savedMessage = {
      ...result.rows[0],
      sender_username: req.session.user.username
    };

    // Skicka meddelandet till alla deltagare
    //io.to('conv_' + id).emit('new_message', savedMessage);

    const participants = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = $1',
      [id]
    );

    participants.rows.forEach(p => {
      const socketIds = onlineUsers.get(parseInt(p.user_id, 10));
      if (socketIds) {
        socketIds.forEach(sId => {
          io.to(sId).emit('new_message', savedMessage);
        });
      }
    });

    res.status(201).json({
      success: true,
      message: savedMessage
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte ladda upp filen'
    });
  }
});

// Uppdatera personligt statusmeddelande
app.put('/api/users/status-message', requireAuth, async (req, res) => {
  try {
    const { statusMessage } = req.body;
    const userId = req.session.user.id;

    const trimmedMessage = (statusMessage || '').trim().substring(0, 120);

    const result = await pool.query(
      'UPDATE users SET status_message = $1 WHERE id = $2 RETURNING id, status_message',
      [trimmedMessage, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Användare hittades inte'
      });
    }

    req.session.user.status_message = trimmedMessage;

    io.emit('user_status_message_change', {
      userId: userId,
      statusMessage: trimmedMessage
    });

    res.json({
      success: true,
      statusMessage: trimmedMessage
    });
  } catch (error) {
    console.error('Update status message error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte uppdatera statusmeddelandet'
    });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
