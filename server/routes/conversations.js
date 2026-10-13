const express = require('express');
const multer = require('multer');

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

function createRouter({ pool, requireAuth, io, onlineUsers, supabase }) {
  const router = express.Router();

  function notifyParticipants(participants, event, payload) {
    participants.forEach(p => {
      const socketIds = onlineUsers.get(Number(p.user_id));
      if (socketIds) {
        socketIds.forEach(socketId => io.to(socketId).emit(event, payload));
      }
    });
  }

  async function getParticipants(conversationId) {
    return pool.query(
      `SELECT cp.user_id, u.username FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = $1 ORDER BY cp.user_id`,
      [conversationId]
    );
  }

router.post('/api/conversations/conference', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { participantIds } = req.body;
  if (!Array.isArray(participantIds) ||
      participantIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ success: false, message: 'Ogiltig deltagarlista' });
  }
  const ids = [...new Set([userId, ...participantIds])];
  if (ids.length < 3) {
    return res.status(400).json({ success: false, message: 'En konferens kräver minst tre deltagare' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const users = await client.query(
      'SELECT id AS user_id, username FROM users WHERE id = ANY($1::int[]) ORDER BY id', [ids]
    );
    if (users.rows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'En deltagare finns inte' });
    }
    const created = await client.query('INSERT INTO conversations (is_group) VALUES (TRUE) RETURNING id');
    const conversationId = created.rows[0].id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       SELECT $1, unnest($2::int[])`, [conversationId, ids]
    );
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type)
       VALUES ($1, $2, $3, 'system')`,
      [conversationId, userId, `* Konferenssamtal startat med: ${users.rows.map(u => u.username).join(', ')} *`]
    );
    await client.query('COMMIT');

    const payload = { conversationId, is_group: true, participants: users.rows };
    users.rows.forEach(p => {
      const socketIds = onlineUsers.get(Number(p.user_id));
      if (socketIds) {
        socketIds.forEach(socketId => io.in(socketId).socketsJoin('conv_' + conversationId));
      }
    });
    notifyParticipants(users.rows, 'conference_created', payload);
    res.status(201).json({ success: true, ...payload });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Create conference error:', error);
    res.status(500).json({ success: false, message: 'Kunde inte starta konferenssamtalet' });
  } finally {
    if (client) client.release();
  }
});

router.post('/api/conversations/:id/leave', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const group = await client.query(
      'SELECT id FROM conversations WHERE id = $1 AND is_group = TRUE FOR UPDATE', [id]
    );
    if (!group.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Detta är inte ett konferenssamtal' });
    }
    const removed = await client.query(
      'DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 RETURNING user_id',
      [id, userId]
    );
    if (!removed.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Du deltar inte i samtalet' });
    }
    const result = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type)
       VALUES ($1, $2, $3, 'system')
       RETURNING id, conversation_id, sender_id, content, message_type, created_at`,
      [id, userId, `* ${req.session.user.username} har lämnat samtalet *`]
    );
    const participants = await client.query(
      `SELECT cp.user_id, u.username FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = $1 ORDER BY cp.user_id`, [id]
    );
    await client.query('COMMIT');
    const socketIds = onlineUsers.get(userId);
    if (socketIds) socketIds.forEach(socketId => io.in(socketId).socketsLeave('conv_' + id));
    notifyParticipants([{ user_id: userId }], 'conference_left', { conversationId: Number(id) });
    notifyParticipants(participants.rows, 'conference_participants_changed', {
      conversationId: Number(id), participants: participants.rows
    });
    notifyParticipants(participants.rows, 'new_message', {
      ...result.rows[0], sender_username: req.session.user.username, is_group: true
    });
    res.json({ success: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Leave conference error:', error);
    res.status(500).json({ success: false, message: 'Kunde inte lämna samtalet' });
  } finally {
    if (client) client.release();
  }
});

router.get('/api/conversations/:id/participants', requireAuth, async (req, res) => {
  try {
    const participants = await getParticipants(req.params.id);
    if (!participants.rows.some(p => Number(p.user_id) === req.session.user.id)) {
      return res.status(403).json({ success: false, message: 'Du har inte åtkomst till denna konversation' });
    }
    res.json({ success: true, participants: participants.rows });
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ success: false, message: 'Kunde inte hämta deltagare' });
  }
});

router.get('/api/conversations/conferences', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id AS "conversationId", c.is_group,
              json_agg(json_build_object('user_id', u.id, 'username', u.username) ORDER BY u.id) AS participants
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
       JOIN users u ON u.id = cp.user_id
       WHERE c.is_group = TRUE AND EXISTS (
         SELECT 1 FROM conversation_participants mine
         WHERE mine.conversation_id = c.id AND mine.user_id = $1
       )
       GROUP BY c.id ORDER BY c.id`,
      [req.session.user.id]
    );
    res.json({ success: true, conferences: result.rows });
  } catch (error) {
    console.error('Get conferences error:', error);
    res.status(500).json({ success: false, message: 'Kunde inte hämta konferenssamtalen' });
  }
});

// 7. Hitta eller skapa en konversation med en annan användare
router.post('/api/conversations', requireAuth, async (req, res) => {
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
       JOIN conversations c ON c.id = cp1.conversation_id AND c.is_group = FALSE
       WHERE cp1.user_id = $1 AND cp2.user_id = $2
       AND (SELECT COUNT(*) FROM conversation_participants cp
            WHERE cp.conversation_id = cp1.conversation_id) = 2
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
router.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
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

    await pool.query(
      `UPDATE messages SET is_read = TRUE
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
       AND EXISTS (SELECT 1 FROM conversations WHERE id = $1 AND is_group = FALSE)`,
      [id, userId]
    );

    const result = await pool.query(
      `SELECT * FROM (
       SELECT m.id, m.conversation_id, m.sender_id, u.username as sender_username,
              m.content, m.message_type, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 50
       ) AS recent_messages
       ORDER BY created_at ASC, id ASC`,
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

// Markerar inkommande meddelanden som lästa när chatten redan är öppen
router.post('/api/conversations/:id/read', requireAuth, async (req, res) => {
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

    await pool.query(
      `UPDATE messages SET is_read = TRUE
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
       AND EXISTS (SELECT 1 FROM conversations WHERE id = $1 AND is_group = FALSE)`,
      [id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunde inte markera meddelanden som lästa'
    });
  }
});

// 9. Skickar ett nytt meddelande till en konversation
router.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, messageType = 'text' } = req.body;
    const userId = req.session.user.id;

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Meddelandet kan inte vara tomt'
      });
    }
    if (!['text', 'nudge', 'image', 'audio'].includes(messageType)) {
      return res.status(400).json({ success: false, message: 'Ogiltig meddelandetyp' });
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
    //io.to('conv_' + id).emit('new_message', savedMessage);

    // Skicka även direkt till alla anslutna sockets för konversationens deltagare
    const participants = await pool.query(
      `SELECT user_id, c.is_group FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id WHERE conversation_id = $1`,
      [id]
    );

    savedMessage.is_group = participants.rows.some(p => p.is_group);
    notifyParticipants(participants.rows, 'new_message', savedMessage);

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
router.post('/api/conversations/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
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
      `SELECT user_id, c.is_group FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id WHERE conversation_id = $1`,
      [id]
    );

    savedMessage.is_group = participants.rows.some(p => p.is_group);
    notifyParticipants(participants.rows, 'new_message', savedMessage);

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

  return router;
}

module.exports = createRouter;
