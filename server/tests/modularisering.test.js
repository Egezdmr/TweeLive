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
  for (const route of ['/api/contacts', '/api/users/online', '/api/users/search?q=Hej', '/api/conversations/7/messages', '/api/conversations/conferences', '/api/conversations/7/participants']) {
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

for (const isGroup of [false, true]) {
test(`Text, nudge och bilagor skickas en gång per socket (${isGroup ? 'konferens' : 'privat'})`, async t => {
  let typ = 'text';
  let tillaten = true;
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.includes('SELECT 1 FROM conversation_participants')) return { rows: tillaten ? [{}] : [] };
    if (sql.includes('INSERT INTO messages')) {
      typ = params[3];
      return { rows: [{ id: 9, conversation_id: 7, sender_id: 1, content: params[2], message_type: typ, created_at: '2026-10-07T12:00:00Z' }] };
    }
    if (sql.startsWith('SELECT user_id, c.is_group FROM conversation_participants')) {
      return { rows: [1, '2', 3].map(user_id => ({ user_id, is_group: isGroup })) };
    }
    if (sql.includes('SELECT m.id')) return { rows: [{ id: 9, message_type: typ }] };
    if (sql.includes('UPDATE messages SET is_read = TRUE')) return { rows: [], rowCount: 1 };
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
    assert.equal(result.data.message.is_group, isGroup);
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
    assert.equal(result.data.message.is_group, isGroup);
    assert.match(app.anrop.findLast(a => a.fil).fil, /^[\w.-]+$/);
    assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'van-a', 'van-b']);
  }
  const form = new FormData();
  form.append('file', new Blob(['test'], { type: 'text/plain' }), 'test.txt');
  assert.equal((await app.request('/api/conversations/7/upload', { method: 'POST', body: form })).status, 400);
  assert.equal((await app.request('/api/conversations/7/messages')).data.success, true);
  const lasMarkering = app.anrop.findLast(a => a.sql.includes('UPDATE messages SET is_read = TRUE'));
  assert.deepEqual(lasMarkering.params, ['7', 1]);
  assert.match(lasMarkering.sql, /sender_id != \$2/);
  app.anrop.length = 0;
  assert.equal((await app.request('/api/conversations/7/read', { method: 'POST' })).data.success, true);
  assert(app.anrop.some(a => a.sql.includes('UPDATE messages SET is_read = TRUE')));
  assert.equal((await app.request('/api/conversations/7/messages', { method: 'POST', body: { content: ' ' } })).status, 400);
  tillaten = false;
  app.anrop.length = 0;
  assert.equal((await app.request('/api/conversations/7/messages')).status, 403);
  assert.equal((await app.request('/api/conversations/7/read', { method: 'POST' })).status, 403);
  assert(!app.anrop.some(a => a.sql.includes('UPDATE messages')));
  assert.equal((await app.request('/api/conversations/7/messages', { method: 'POST', body: { content: 'Hej' } })).status, 403);
});
}

test('Historiken hämtar senaste 50 och returnerar dem i läsordning vid varje omladdning', async t => {
  const expected = Array.from({ length: 50 }, (_, i) => ({
    id: i + 16, conversation_id: 7, sender_id: 2, sender_username: 'Van',
    content: `Meddelande ${i + 16}`, message_type: 'text', created_at: '2026-10-12T08:00:00Z'
  }));
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (sql.includes('SELECT 1 FROM conversation_participants')) return { rows: [{}] };
    if (sql.startsWith('UPDATE messages')) return { rows: [] };
    if (sql.includes('SELECT m.id')) {
      assert.deepEqual(params, ['7']);
      assert.match(sql, /ORDER BY m.created_at DESC, m.id DESC\s+LIMIT 50/);
      assert.match(sql, /ORDER BY created_at ASC, id ASC/);
      return { rows: expected };
    }
    throw new Error(`Oväntad SQL: ${sql}`);
  });
  await app.login();
  for (let reload = 0; reload < 2; reload++) {
    const result = await app.request('/api/conversations/7/messages');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.messages, expected);
    assert.equal(result.data.messages.at(-1).id, 65);
  }
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
  const lookup = app.anrop.find(a => a.sql.includes('SELECT cp1.conversation_id')).sql;
  assert.match(lookup, /c.is_group = FALSE/);
  assert.match(lookup, /COUNT\(\*\)[\s\S]*= 2/);
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
  assert.match(app.anrop.find(a => a.sql.includes('AS unread_count')).sql, /m\.is_read = FALSE/);
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
      data: {},
      rooms: new Set(),
      on(event, handler) { handlers[event] = handler; },
      join(room) { rooms.push(room); s.rooms.add(room); },
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
  assert.deepEqual(events.at(-1), { room: 'conv_7', event: 'user_typing', payload: { conversationId: 7, username: 'Van' } });
  a.handlers.typing_stop({ conversationId: 7 });
  assert.equal(events.at(-1).event, 'user_stop_typing');
  assert.deepEqual(events.at(-1).payload, { conversationId: 7 });
  a.handlers.disconnect();
  assert.equal(onlineUsers.get(2).size, 1);
  b.handlers.disconnect();
  assert.equal(onlineUsers.has(2), false);
  assert.deepEqual(events.at(-1), { event: 'user_status_change', payload: { userId: 2, status: 'offline' } });
});

test('Konferenser är separata, notifieras en gång och kan lämnas utan att ändra privata samtal', async t => {
  let member = true;
  let missingUser = false;
  let failInsert = false;
  const users = [{ user_id: 1, username: 'Jag' }, { user_id: 2, username: 'Van' }, { user_id: 3, username: 'Ny' }];
  const app = await startaTestserver(t, (sql, params) => {
    if (sql.includes('WHERE username = $1 OR email = $1')) return anvandare(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM users WHERE id = ANY')) return { rows: missingUser ? users.slice(0, 2) : users };
    if (sql.startsWith('INSERT INTO conversations (is_group)')) return { rows: [{ id: 99 }] };
    if (sql.startsWith('INSERT INTO conversation_participants')) {
      if (failInsert) throw new Error('Testat databasfel');
      assert.deepEqual(params, [99, [1, 2, 3]]);
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO messages')) {
      return { rows: [{ id: 5, conversation_id: 99, sender_id: 1, content: params[2], message_type: 'system' }] };
    }
    if (sql.startsWith('SELECT id FROM conversations')) return { rows: params[0] === '7' ? [] : [{ id: 99 }] };
    if (sql.startsWith('DELETE FROM conversation_participants')) {
      const wasMember = member;
      member = false;
      return { rows: wasMember ? [{ user_id: 1 }] : [] };
    }
    if (sql.includes('SELECT cp.user_id, u.username')) return { rows: member ? users : users.slice(1) };
    if (sql.includes('json_agg')) return { rows: member ? [{ conversationId: 99, is_group: true, participants: users }] : [] };
    if (sql.includes('SELECT 1 FROM conversation_participants')) return { rows: member ? [{}] : [] };
    if (sql.includes('SELECT m.id')) return { rows: [{ id: 5, content: '* Konferenssamtal startat *', message_type: 'system' }] };
    if (sql.startsWith('UPDATE messages')) return { rows: [] };
    throw new Error(`Oväntad SQL: ${sql}`);
  });
  const rooms = [];
  app.io.in = socketId => ({
    socketsJoin(room) { rooms.push({ socketId, room, action: 'join' }); },
    socketsLeave(room) { rooms.push({ socketId, room, action: 'leave' }); }
  });
  assert.equal((await app.request('/api/conversations/conference', { method: 'POST', body: { participantIds: [1, 2, 3] } })).status, 401);
  await app.login();
  app.onlineUsers.set(1, new Set(['egen']));
  app.onlineUsers.set(2, new Set(['van-a', 'van-b']));
  app.onlineUsers.set(3, new Set(['ny']));
  for (const participantIds of [null, [1, 2], [1, '2', 3], [1, -2, 3]]) {
    assert.equal((await app.request('/api/conversations/conference', { method: 'POST', body: { participantIds } })).status, 400);
  }
  missingUser = true;
  assert.equal((await app.request('/api/conversations/conference', { method: 'POST', body: { participantIds: [1, 2, 3] } })).status, 400);
  missingUser = false;
  failInsert = true;
  assert.equal((await app.request('/api/conversations/conference', { method: 'POST', body: { participantIds: [1, 2, 3] } })).status, 500);
  assert.equal(app.utskick.length, 0);
  assert.equal(app.anrop.at(-2).sql, 'ROLLBACK');
  failInsert = false;
  const created = await app.request('/api/conversations/conference', { method: 'POST', body: { participantIds: [2, 3, 3] } });
  assert.equal(created.status, 201);
  assert.equal(created.data.conversationId, 99);
  assert.deepEqual(created.data.participants, users);
  assert.deepEqual(app.utskick.map(e => e.socketId).sort(), ['egen', 'ny', 'van-a', 'van-b']);
  assert(app.utskick.every(e => e.event === 'conference_created'));
  assert.equal(rooms.filter(r => r.action === 'join').length, 4);
  const system = app.anrop.findLast(a => a.sql.includes('INSERT INTO messages'));
  assert.equal(system.params[2], '* Konferenssamtal startat med: Jag, Van, Ny *');
  assert(!app.anrop.some(a => /UPDATE conversations|UPDATE messages.*conversation_id/.test(a.sql)));
  assert.equal((await app.request('/api/conversations/99/participants')).data.participants.length, 3);
  assert.equal((await app.request('/api/conversations/conferences')).data.conferences[0].conversationId, 99);
  assert.equal((await app.request('/api/conversations/7/leave', { method: 'POST' })).status, 400);
  assert.equal(member, true);
  app.utskick.length = 0;
  assert.equal((await app.request('/api/conversations/99/leave', { method: 'POST' })).status, 200);
  assert.equal(rooms.filter(r => r.action === 'leave').length, 1);
  const messages = app.utskick.filter(e => e.event === 'new_message');
  assert.deepEqual(messages.map(e => e.socketId).sort(), ['ny', 'van-a', 'van-b']);
  assert(messages.every(e => e.payload.is_group && e.payload.content === '* Jag har lämnat samtalet *'));
  assert.equal((await app.request('/api/conversations/99/messages')).status, 403);
  assert.equal((await app.request('/api/conversations/99/messages', { method: 'POST', body: { content: 'Hej' } })).status, 403);
  assert.equal((await app.request('/api/conversations/99/participants')).status, 403);
  assert.equal((await app.request('/api/conversations/99/leave', { method: 'POST' })).status, 403);
  assert.deepEqual((await app.request('/api/conversations/conferences')).data.conferences, []);
});
