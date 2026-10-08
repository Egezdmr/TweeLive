const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../index');
const initChatSocket = require('../sockets/chatSocket');

async function startaTestserver(t, query) {
  const anrop = [];
  const utskick = [];
  const pool = {
    async query(sql, params) {
      anrop.push({ sql, params });
      return query(sql, params);
    },
    async connect() {
      return {
        query: pool.query,
        release() { anrop.push({ sql: 'release' }); }
      };
    }
  };
  const application = createApplication({
    pool,
    getDbStatus: () => 'connected',
    hashPassword: async password => `hash:${password}`,
    comparePassword: async (password, hash) => hash === `hash:${password}`,
    supabase: {
      storage: {
        from(bucket) {
          assert.equal(bucket, 'chat_attachments');
          return {
            async upload(name, buffer, options) {
              anrop.push({ fil: name, storlek: buffer.length, options });
              return { data: { path: name }, error: null };
            },
            getPublicUrl(name) {
              return { data: { publicUrl: `https://example.test/${name}` } };
            }
          };
        }
      }
    }
  });
  application.io.to = socketId => ({
    emit(event, payload) { utskick.push({ socketId, event, payload }); }
  });
  application.io.emit = (event, payload) => utskick.push({ event, payload });
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  t.after(() => new Promise(resolve => application.io.close(resolve)));
  const url = `http://127.0.0.1:${application.server.address().port}`;
  let cookie;
  async function request(route, options = {}) {
    const headers = { ...options.headers };
    if (cookie) headers.Cookie = cookie;
    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(url + route, { ...options, headers, body });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json()
      : await response.text();
    return { status: response.status, data, headers: response.headers };
  }
  async function login() {
    const result = await request('/api/login', {
      method: 'POST',
      body: { identifier: 'Jag', password: 'test' }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.success, true);
  }
  return { ...application, request, login, anrop, utskick };
}

function anvandare(sql) {
  if (sql.includes('WHERE username = $1 OR email = $1')) {
    return { rows: [{ id: 1, username: 'Jag', email: 'jag@test.se', password: 'hash:test', status_message: 'Hej' }] };
  }
  throw new Error(`Oväntad SQL: ${sql}`);
}

test('Autentisering, sessioner, validering och statiska filer behåller sina kontrakt', async t => {
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.startsWith('SELECT username') || sql.startsWith('SELECT email')) return { rows: [] };
    if (sql.includes('INSERT INTO users (first_name')) {
      assert.equal(params[4], 'hash:abc');
      return { rows: [{ id: 2, username: 'Ny', email: 'ny@test.se' }] };
    }
    if (sql.includes('INSERT INTO users (username')) return { rows: [{ id: 3, username: 'Test' }] };
    throw new Error(`Oväntad SQL: ${sql}`);
  });
  assert.deepEqual((await app.request('/api/auth/me')).data, { success: false, message: 'Inte inloggad' });
  for (const route of ['/api/contacts', '/api/users/online', '/api/users/search?q=Hej', '/api/conversations/7/messages']) {
    assert.equal((await app.request(route)).status, 401);
  }
  for (const route of ['/api/conversations', '/api/conversations/7/messages', '/api/conversations/7/upload', '/api/contacts/request']) {
    assert.equal((await app.request(route, { method: 'POST' })).status, 401);
  }
  assert.equal((await app.request('/api/login', { method: 'POST', body: {} })).status, 400);
  assert.equal((await app.request('/api/login', { method: 'POST', body: { identifier: 'Jag', password: 'fel' } })).status, 401);
  await app.login();
  assert.deepEqual((await app.request('/api/auth/me')).data.user, {
    id: 1, username: 'Jag', email: 'jag@test.se', status_message: 'Hej'
  });
  assert.deepEqual((await app.request('/api/check-username/Ny')).data, { exists: false });
  assert.deepEqual((await app.request('/api/check-email/ny%40test.se')).data, { exists: false });
  assert.equal((await app.request('/api/register', { method: 'POST', body: {} })).status, 400);
  assert.equal((await app.request('/api/register', {
    method: 'POST',
    body: { firstName: 'Ny', lastName: 'Person', username: 'Ny', email: 'ny@test.se', password: 'abc', gender: 1, birthDate: '2000-01-01' }
  })).data.success, true);
  assert.equal((await app.request('/api/users', { method: 'POST', body: { username: 'Test', email: 'test@test.se', password: 'abc' } })).data.success, true);
  assert.equal((await app.request('/api/status')).data.database, 'connected');
  for (const route of ['/', '/css/style.css', '/js/audio.js', '/js/emojis.js', '/js/chat.js', '/js/main.js', '/emojis/tweegee-glad.svg']) {
    assert.equal((await app.request(route)).status, 200);
  }
  assert.equal((await app.request('/api/auth/logout', { method: 'POST' })).data.success, true);
  assert.equal((await app.request('/api/auth/me')).status, 401);
});

test('Text, nudge och bilagor skickas exakt en gång till varje deltagarsocket', async t => {
  let typ = 'text';
  let tillaten = true;
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.includes('SELECT 1 FROM conversation_participants')) return { rows: tillaten ? [{}] : [] };
    if (sql.includes('INSERT INTO messages')) {
      typ = params[3];
      return { rows: [{ id: 9, conversation_id: 7, sender_id: 1, content: params[2], message_type: typ, created_at: '2026-10-07T12:00:00Z' }] };
    }
    if (sql.startsWith('SELECT user_id FROM conversation_participants')) return { rows: [{ user_id: 1 }, { user_id: '2' }, { user_id: 3 }] };
    if (sql.includes('SELECT m.id')) return { rows: [{ id: 9, message_type: typ }] };
    throw new Error(`Oväntad SQL: ${sql}`);
  });
  await app.login();
  app.onlineUsers.set(1, new Set(['egen']));
  app.onlineUsers.set(2, new Set(['van-a', 'van-b']));
  for (const messageType of ['text', 'nudge']) {
    app.utskick.length = 0;
    const result = await app.request('/api/conversations/7/messages', { method: 'POST', body: { content: ' Hej ', messageType } });
    assert.equal(result.status, 201);
    assert.equal(result.data.message.sender_username, 'Jag');
    assert.equal(result.data.message.content, 'Hej');
    assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'van-a', 'van-b']);
    assert(app.utskick.every(e => e.event === 'new_message' && e.payload.message_type === messageType));
  }
  for (const mime of ['image/png', 'audio/ogg']) {
    app.utskick.length = 0;
    const form = new FormData();
    form.append('file', new Blob(['test'], { type: mime }), 'min bild (1).png');
    const result = await app.request('/api/conversations/7/upload', { method: 'POST', body: form });
    assert.equal(result.status, 201);
    assert.equal(result.data.message.message_type, mime.startsWith('image/') ? 'image' : 'audio');
    assert.match(app.anrop.findLast(a => a.fil).fil, /^[\w.-]+$/);
    assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'van-a', 'van-b']);
  }
  const form = new FormData();
  form.append('file', new Blob(['test'], { type: 'text/plain' }), 'test.txt');
  assert.equal((await app.request('/api/conversations/7/upload', { method: 'POST', body: form })).status, 400);
  assert.equal((await app.request('/api/conversations/7/messages')).data.success, true);
  assert.equal((await app.request('/api/conversations/7/messages', { method: 'POST', body: { content: ' ' } })).status, 400);
  tillaten = false;
  assert.equal((await app.request('/api/conversations/7/messages')).status, 403);
  assert.equal((await app.request('/api/conversations/7/messages', { method: 'POST', body: { content: 'Hej' } })).status, 403);
});

test('Konversationer återanvänds eller skapas med oförändrad transaktion', async t => {
  let finns = true;
  const app = await startaTestserver(t, sql => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.includes('SELECT cp1.conversation_id')) return { rows: finns ? [{ conversation_id: 7 }] : [] };
    if (sql.startsWith('INSERT INTO conversations')) return { rows: [{ id: 8 }] };
    return { rows: [] };
  });
  await app.login();
  assert.equal((await app.request('/api/conversations', { method: 'POST', body: {} })).status, 400);
  assert.equal((await app.request('/api/conversations', { method: 'POST', body: { recipientId: 1 } })).status, 400);
  const existing = await app.request('/api/conversations', { method: 'POST', body: { recipientId: 2 } });
  assert.equal(existing.status, 200);
  assert.equal(existing.data.conversationId, 7);
  finns = false;
  const created = await app.request('/api/conversations', { method: 'POST', body: { recipientId: 2 } });
  assert.equal(created.status, 201);
  assert.equal(created.data.conversationId, 8);
  assert(app.anrop.some(a => a.sql === 'BEGIN'));
  assert(app.anrop.some(a => a.sql === 'COMMIT'));
  assert.equal(app.anrop.filter(a => a.sql === 'release').length, 2);
});

test('Kontakter, förfrågningar och statusmeddelanden behåller sina broadcasts', async t => {
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.includes('ILIKE')) return { rows: [{ id: 2, username: 'Van' }] };
    if (sql.includes('SELECT c.id')) return { rows: [{ id: 10 }] };
    if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 2 }] };
    if (sql.startsWith('SELECT id FROM contacts')) return { rows: [] };
    if (sql.startsWith('SELECT username FROM users')) return { rows: [{ username: 'Jag' }] };
    if (sql.startsWith('INSERT INTO contacts')) return { rows: [{ id: 10, status: 'pending' }] };
    if (sql.startsWith('SELECT user_id, contact_id')) return { rows: [{ user_id: 1, contact_id: 2 }] };
    if (sql.startsWith('SELECT user_id FROM contacts')) return { rows: [{ user_id: 2 }] };
    if (sql.includes('UPDATE users SET status_message')) return { rows: [{ id: 1, status_message: params[0] }] };
    if (sql.includes('UPDATE contacts') || sql.includes('DELETE FROM contacts')) return { rows: [{ id: 10, status: 'accepted' }] };
    throw new Error(`Oväntad SQL: ${sql}`);
  });
  await app.login();
  app.onlineUsers.set(1, new Set(['egen']));
  app.onlineUsers.set(2, new Set(['van']));
  assert.deepEqual((await app.request('/api/users/online')).data.onlineUserIds, [1, 2]);
  assert.equal((await app.request('/api/users/search?q=Van')).data.users[0].id, 2);
  assert.equal((await app.request('/api/users/search')).status, 400);
  assert.deepEqual(Object.keys((await app.request('/api/contacts')).data), ['success', 'friends', 'pendingRequests', 'blocked']);
  assert.equal((await app.request('/api/contacts/request', { method: 'POST', body: { contactId: 2 } })).status, 201);
  assert.equal(app.utskick.at(-1).event, 'friend_request_received');
  app.utskick.length = 0;
  assert.equal((await app.request('/api/contacts/10/accept', { method: 'PUT' })).status, 200);
  assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'van']);
  assert(app.utskick.every(e => e.event === 'friend_request_accepted'));
  assert.equal((await app.request('/api/contacts/10/block', { method: 'PUT' })).status, 200);
  app.utskick.length = 0;
  assert.equal((await app.request('/api/contacts/10', { method: 'DELETE' })).status, 200);
  assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'van']);
  assert(app.utskick.every(e => e.event === 'contact_removed' && e.payload.contactRecordId === 10));
  const status = await app.request('/api/users/status-message', { method: 'PUT', body: { statusMessage: '  Hej  ' } });
  assert.deepEqual(status.data, { success: true, statusMessage: 'Hej' });
  assert.equal((await app.request('/api/auth/me')).data.user.status_message, 'Hej');
  assert.equal(app.utskick.at(-1).event, 'user_status_message_change');
});

test('Socket-rum, typing och flera flikars presence är oförändrade', () => {
  let connection;
  const events = [];
  const io = {
    on(event, handler) { assert.equal(event, 'connection'); connection = handler; },
    emit(event, payload) { events.push({ event, payload }); }
  };
  const { onlineUsers } = initChatSocket(io);
  function socket(id) {
    const handlers = {};
    const rooms = [];
    const s = {
      id,
      on(event, handler) { handlers[event] = handler; },
      join(room) { rooms.push(room); },
      to(room) { return { emit(event, payload) { events.push({ room, event, payload }); } }; }
    };
    connection(s);
    return { handlers, rooms };
  }
  const a = socket('a');
  const b = socket('b');
  a.handlers.user_connected('2');
  b.handlers.user_connected(2);
  assert.equal(onlineUsers.get(2).size, 2);
  assert.equal(events.filter(e => e.payload?.status === 'online').length, 1);
  a.handlers.join_conversation(7);
  assert.deepEqual(a.rooms, ['conv_7']);
  a.handlers.typing_start({ conversationId: 7, username: 'Van' });
  assert.deepEqual(events.at(-1), { room: 'conv_7', event: 'user_typing', payload: { username: 'Van' } });
  a.handlers.typing_stop({ conversationId: 7 });
  assert.equal(events.at(-1).event, 'user_stop_typing');
  a.handlers.disconnect();
  assert.equal(onlineUsers.get(2).size, 1);
  b.handlers.disconnect();
  assert.equal(onlineUsers.has(2), false);
  assert.deepEqual(events.at(-1), { event: 'user_status_change', payload: { userId: 2, status: 'offline' } });
});
