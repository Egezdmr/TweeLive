const { randomUUID } = require('node:crypto');

function initChatSocket(io, pool) {
// userId -> Set med socketIds (stödjer flera flikar från samma användare)
const onlineUsers = new Map();
const calls = new Map();
const userCalls = new Map();

function finishCall(call, reason) {
  clearTimeout(call.timer);
  calls.delete(call.id);
  userCalls.delete(call.callerId);
  userCalls.delete(call.recipientId);
  const sockets = new Set([call.callerSocket, ...(onlineUsers.get(call.recipientId) || [])]);
  sockets.forEach(id => io.to(id).emit('webrtc_end_call', { callId: call.id, reason }));
}

io.on('connection', (socket) => {
  function reply(ack, result) {
    if (typeof ack === 'function') ack(result);
  }

  function ownedCall(callId) {
    const call = calls.get(callId);
    if (!call) return null;
    const userId = socket.request?.session?.user?.id;
    if (socket.id === call.callerSocket && userId === call.callerId) return call;
    if (userId === call.recipientId &&
        (!call.recipientSocket || call.recipientSocket === socket.id)) return call;
    return null;
  }

  socket.on('webrtc_call_user', async (data = {}, ack) => {
    try {
      const user = socket.request?.session?.user;
      if (!user) return reply(ack, { success: false, message: 'Logga in för att ringa' });
      const { recipientId, conversationId } = data;
      if (!Number.isSafeInteger(recipientId) || recipientId === user.id ||
          !Number.isSafeInteger(conversationId)) {
        return reply(ack, { success: false, message: 'Ogiltigt videosamtal' });
      }
      const participant = await pool.query(
        `SELECT c.id FROM conversations c
         WHERE c.id = $1 AND c.is_group = FALSE
         AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
         AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = $2)
         AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = $3)`,
        [conversationId, user.id, recipientId]
      );
      if (!participant.rows.length) return reply(ack, { success: false, message: 'Videosamtal kräver en privat chatt där ni båda deltar' });
      const recipients = onlineUsers.get(recipientId);
      if (!recipients?.size) return reply(ack, { success: false, message: 'Kontakten är offline' });
      if (!socket.connected || !socket.request.session?.user) return;
      if (userCalls.has(user.id) || userCalls.has(recipientId)) {
        return reply(ack, { success: false, message: 'Du eller kontakten är redan i ett samtal' });
      }
      const call = {
        id: randomUUID(), callerId: user.id, recipientId, callerSocket: socket.id,
        recipientSocket: null, accepted: false
      };
      calls.set(call.id, call);
      userCalls.set(user.id, call.id);
      userCalls.set(recipientId, call.id);
      call.timer = setTimeout(() => finishCall(call, 'Inget svar'), 45000);
      recipients.forEach(id => io.to(id).emit('webrtc_call_user', {
        callId: call.id, callerId: user.id, username: user.username, conversationId
      }));
      reply(ack, { success: true, callId: call.id });
    } catch (error) {
      console.error('WebRTC call error:', error);
      reply(ack, { success: false, message: 'Kunde inte starta videosamtalet' });
    }
  });

  socket.on('webrtc_answer_call', (data = {}, ack) => {
    const call = ownedCall(data?.callId);
    if (!call || socket.request.session.user.id !== call.recipientId || call.accepted) {
      return reply(ack, { success: false, message: 'Samtalet är inte längre tillgängligt' });
    }
    call.recipientSocket = socket.id;
    call.accepted = true;
    clearTimeout(call.timer);
    (onlineUsers.get(call.recipientId) || []).forEach(id => {
      if (id !== socket.id) io.to(id).emit('webrtc_end_call', { callId: call.id, reason: 'Besvarat i en annan flik' });
    });
    io.to(call.callerSocket).emit('webrtc_answer_call', { callId: call.id });
    reply(ack, { success: true });
  });

  socket.on('webrtc_reject_call', (data = {}, ack) => {
    const call = ownedCall(data?.callId);
    if (!call || call.accepted || socket.request.session.user.id !== call.recipientId) {
      return reply(ack, { success: false, message: 'Samtalet är inte längre tillgängligt' });
    }
    io.to(call.callerSocket).emit('webrtc_reject_call', { callId: call.id });
    finishCall(call, 'Samtalet avvisades');
    reply(ack, { success: true });
  });

  socket.on('webrtc_signal', (data = {}, ack) => {
    const call = ownedCall(data?.callId);
    if (!call || !call.accepted) return reply(ack, { success: false, message: 'Samtalet är avslutat eller saknar behörighet' });
    const { description, candidate } = data;
    const isCaller = socket.id === call.callerSocket;
    const validDescription = description &&
      description.type === (isCaller ? 'offer' : 'answer') &&
      typeof description.sdp === 'string' && description.sdp.length <= 100000;
    const validCandidate = candidate && typeof candidate.candidate === 'string' &&
      candidate.candidate.length <= 4096 &&
      (candidate.sdpMid == null || typeof candidate.sdpMid === 'string') &&
      (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex));
    if ((!validDescription && !validCandidate) || (description && candidate)) {
      return reply(ack, { success: false, message: 'Ogiltig WebRTC-signal' });
    }
    io.to(isCaller ? call.recipientSocket : call.callerSocket).emit('webrtc_signal', {
      callId: call.id,
      ...(validDescription ? { description: { type: description.type, sdp: description.sdp } } : {
        candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex }
      })
    });
    reply(ack, { success: true });
  });

  socket.on('webrtc_end_call', (data = {}, ack) => {
    const call = ownedCall(data?.callId);
    if (!call) return reply(ack, { success: false, message: 'Samtalet är redan avslutat' });
    finishCall(call, 'Samtalet avslutades');
    reply(ack, { success: true });
  });
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
    for (const call of calls.values()) {
      if (call.callerSocket === socket.id || call.recipientSocket === socket.id ||
          (!call.accepted && call.recipientId === socket.data.userId &&
           onlineUsers.get(call.recipientId)?.size === 1)) {
        finishCall(call, 'Kontakten kopplades från');
      }
    }
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
