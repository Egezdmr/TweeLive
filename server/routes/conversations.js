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
router.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
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
    //io.to('conv_' + id).emit('new_message', savedMessage);

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

  return router;
}

module.exports = createRouter;
