const { test } = require('node:test');
const assert = require('node:assert/strict');
const initChatSocket = require('../sockets/chatSocket');

function setup(t) {
  let connection;
  const events = [];
  const sockets = [];
  let privateChat = true;
  const io = {
    on(event, handler) { connection = handler; },
    emit(event, payload) { events.push({ event, payload }); },
    to(id) { return { emit(event, payload) { events.push({ id, event, payload }); } }; }
  };
  const queries = [];
  initChatSocket(io, {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: privateChat ? [{ id: 7 }] : [] };
    }
  });
  function socket(id, userId) {
    const handlers = {};
    const s = {
      id, data: {}, connected: true, rooms: new Set(),
      request: { session: userId ? { user: { id: userId, username: `User${userId}` } } : {} },
      on(event, handler) { handlers[event] = handler; },
      emit(event, payload) { events.push({ id, event, payload }); },
      join(room) { s.rooms.add(room); }
    };
    connection(s);
    handlers.user_connected(userId);
    sockets.push({ s, handlers });
    return {
      async send(event, data) {
        let result;
        await handlers[event](data, reply => { result = reply; });
        return result;
      },
      disconnect() { s.connected = false; handlers.disconnect(); },
      id
    };
  }
  t.after(() => sockets.forEach(({ handlers }) => handlers.disconnect()));
  return { socket, events, queries, setPrivate(value) { privateChat = value; } };
}

test('WebRTC kräver session, privat deltagarskap och en online-mottagare', async t => {
  const app = setup(t);
  const anon = app.socket('anon');
  const a = app.socket('a', 1);
  app.socket('b', 2);
  assert.equal((await anon.send('webrtc_call_user', { recipientId: 2, conversationId: 7 })).success, false);
  assert.equal((await a.send('webrtc_call_user', { recipientId: 1, conversationId: 7 })).success, false);
  app.setPrivate(false);
  assert.equal((await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 })).success, false);
  assert.match(app.queries[0].sql, /is_group = FALSE/);
  assert.match(app.queries[0].sql, /COUNT\(\*\)[\s\S]*= 2/);
  app.setPrivate(true);
  assert.equal((await a.send('webrtc_call_user', { recipientId: 3, conversationId: 7 })).success, false);
});

test('WebRTC isolerar signalering till två valda sockets och hanterar upptaget och avslut', async t => {
  const app = setup(t);
  const a = app.socket('a', 1);
  const b = app.socket('b', 2);
  const b2 = app.socket('b2', 2);
  const c = app.socket('c', 3);
  const { callId, success } = await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 });
  assert.equal(success, true);
  assert.deepEqual(app.events.filter(e => e.event === 'webrtc_call_user').map(e => e.id), ['b', 'b2']);
  assert.equal((await c.send('webrtc_call_user', { recipientId: 2, conversationId: 7 })).success, false);
  assert.equal((await c.send('webrtc_answer_call', { callId })).success, false);
  assert.equal((await a.send('webrtc_signal', { callId, description: { type: 'offer', sdp: 'test' } })).success, false);
  assert.equal((await b.send('webrtc_answer_call', { callId })).success, true);
  assert.equal((await b2.send('webrtc_signal', { callId, candidate: { candidate: 'ice' } })).success, false);
  assert.equal((await c.send('webrtc_end_call', { callId })).success, false);
  app.events.length = 0;
  assert.equal((await a.send('webrtc_signal', { callId, description: { type: 'offer', sdp: 'test' } })).success, true);
  assert.deepEqual(app.events.map(e => [e.id, e.event]), [['b', 'webrtc_signal']]);
  assert.equal((await b.send('webrtc_signal', { callId, description: { type: 'answer', sdp: 'test' } })).success, true);
  assert.equal((await a.send('webrtc_signal', { callId, candidate: { candidate: 'ice', sdpMid: '0', sdpMLineIndex: 0 } })).success, true);
  assert.equal((await a.send('webrtc_signal', { callId, description: { type: 'answer', sdp: 'test' } })).success, false);
  assert.equal((await b.send('webrtc_end_call', { callId })).success, true);
  assert.equal((await a.send('webrtc_signal', { callId, candidate: { candidate: 'ice' } })).success, false);
  const next = await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 });
  assert.equal(next.success, true);
  b.disconnect();
  assert.equal((await b2.send('webrtc_reject_call', { callId: next.callId })).success, true);
  const again = await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 });
  assert.equal(again.success, true);
  b2.disconnect();
  assert(app.events.some(e => e.event === 'webrtc_end_call' && e.payload.callId === again.callId));
});

test('Obesvarade samtal löper ut och frigör båda användarna', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(t);
  const a = app.socket('a', 1);
  app.socket('b', 2);
  const first = await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 });
  t.mock.timers.tick(45001);
  assert(app.events.some(e => e.event === 'webrtc_end_call' && e.payload.callId === first.callId && e.payload.reason === 'Inget svar'));
  assert.equal((await a.send('webrtc_call_user', { recipientId: 2, conversationId: 7 })).success, true);
  assert.equal((await a.send('webrtc_signal', null)).success, false);
  assert.equal((await a.send('webrtc_end_call', null)).success, false);
});
