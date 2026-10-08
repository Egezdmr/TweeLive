const express = require('express');
const path = require('path');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const requireAuth = require('./middleware/requireAuth');
const createAuthRouter = require('./routes/auth');
const createContactsRouter = require('./routes/contacts');
const createConversationsRouter = require('./routes/conversations');
const initChatSocket = require('./sockets/chatSocket');

function createApplication({ pool, getDbStatus, supabase, hashPassword, comparePassword }) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const { onlineUsers } = initChatSocket(io);

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

  app.use(express.static(path.join(__dirname, '../public')));
  app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    database: getDbStatus(),
    server: 'running',
    timestamp: new Date()
  });
});

  app.use(createAuthRouter({ pool, hashPassword, comparePassword }));
  app.use(createContactsRouter({ pool, requireAuth, io, onlineUsers }));
  app.use(createConversationsRouter({ pool, requireAuth, io, onlineUsers, supabase }));

  return { app, server, io, onlineUsers };
}

async function start() {
  const { pool, getDbStatus } = require('./config/db');
  const supabase = require('./services/supabase');
  // Lösenordshjälparna behåller projektets befintliga ES-modulformat.
  const { hashPassword, comparePassword } = await import('../security/passwordUtils.js');
  const { server } = createApplication({ pool, getDbStatus, supabase, hashPassword, comparePassword });
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error('Kunde inte starta servern:', error);
    process.exitCode = 1;
  });
}

module.exports = { createApplication, start };
