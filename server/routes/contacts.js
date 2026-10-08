const express = require('express');

function createRouter({ pool, requireAuth, io, onlineUsers }) {
  const router = express.Router();

// 1. Search users
router.get('/api/users/search', requireAuth, async (req, res) => {
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
router.get('/api/users/online', requireAuth, async (req, res) => {
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
router.get('/api/contacts', requireAuth, async (req, res) => {
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
router.post('/api/contacts/request', requireAuth, async (req, res) => {
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
router.put('/api/contacts/:id/accept', requireAuth, async (req, res) => {
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
router.put('/api/contacts/:id/block', requireAuth, async (req, res) => {
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
router.delete('/api/contacts/:id', requireAuth, async (req, res) => {
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

// Uppdatera personligt statusmeddelande
router.put('/api/users/status-message', requireAuth, async (req, res) => {
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

  return router;
}

module.exports = createRouter;
