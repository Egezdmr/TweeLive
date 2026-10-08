function initChatSocket(io) {
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

  return { onlineUsers };
}

module.exports = initChatSocket;
