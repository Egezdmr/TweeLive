function initChatSocket(io, pool) {
// userId -> Set med socketIds (stödjer flera flikar från samma användare)
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (rawUserId) => {
    const userId = pool
      ? socket.request.session?.user?.id
      : parseInt(rawUserId, 10);
    if (!userId || isNaN(userId)) return;
    socket.data.userId = userId;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit('user_status_change', { userId, status: 'online' });
    }
    onlineUsers.get(userId).add(socket.id);
  });

  socket.on('join_conversation', async (conversationId) => {
    try {
      if (pool) {
        const participant = await pool.query(
          'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
          [conversationId, socket.data.userId]
        );
        if (!participant.rows.length) {
          socket.emit('chat_error', { message: 'Du har inte åtkomst till denna konversation' });
          return;
        }
      }
      socket.join('conv_' + conversationId);
    } catch (error) {
      console.error('Join conversation error:', error);
      socket.emit('chat_error', { message: 'Kunde inte ansluta till samtalet' });
    }
  });

  socket.on('typing_start', ({ conversationId, username }) => {
    if (!socket.rooms.has('conv_' + conversationId)) return;
    if (pool) username = socket.request.session?.user?.username;
    socket.to('conv_' + conversationId).emit('user_typing', { conversationId, username });
  });

  socket.on('typing_stop', ({ conversationId }) => {
    if (!socket.rooms.has('conv_' + conversationId)) return;
    socket.to('conv_' + conversationId).emit('user_stop_typing', { conversationId });
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

  return { onlineUsers };
}

module.exports = initChatSocket;
