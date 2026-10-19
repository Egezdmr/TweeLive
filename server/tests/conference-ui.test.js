const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createClient(fetch = async () => ({ ok: true, json: async () => ({ success: true, messages: [] }) })) {
  const elements = new Map();
  const handlers = {};
  const sounds = [];
  function element() {
    const classes = new Set();
    return {
      style: {}, dataset: {}, children: [], value: '', textContent: '',
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener() {}, close() {}, showModal() {}, setAttribute() {},
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      set innerHTML(value) { this.children = []; this.textContent = value; },
      querySelector(selector) {
        const id = selector.match(/data-message-id="(\d+)"/)?.[1];
        return this.children.find(child => String(child.dataset.messageId) === id);
      }
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelector: () => null
  };
  const context = vm.createContext({
    document, fetch, console, setTimeout, clearTimeout,
    io: () => ({ on: (event, handler) => { handlers[event] = handler; }, emit() {} }),
    stangEmojiMeny() {}, escapeHtml: text => text,
    visaTextMedEmojier: (el, text) => { el.textContent = text; },
    playMessageSound: () => sounds.push('message'),
    playNudgeSound: () => sounds.push('nudge'),
    playOnlineSound() {}, alert: message => { throw new Error(message); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/chat.js'), 'utf8'), context);
  vm.runInContext('currentUserId = 1', context);
  return { context, handlers, document, sounds, run: code => vm.runInContext(code, context) };
}

test('Privat chattrubrik uppdateras när konversations-id är klart så webcam kan visas', async () => {
  const client = createClient(async url => ({
    ok: true,
    json: async () => url === '/api/conversations'
      ? { success: true, conversationId: 7 }
      : { success: true, messages: [] }
  }));
  client.run(`
    const headerUpdates = [];
    const originalHeaderUpdate = updateActiveChatHeaderUI;
    updateActiveChatHeaderUI = () => {
      headerUpdates.push(activeChatUser.conversationId);
      originalHeaderUpdate();
    };
  `);
  await client.run('openChatWith({ user_id: 2, username: "Van", id: 10 })');
  assert.equal(client.run('headerUpdates.at(-1)'), 7);
});

test('Gruppmeddelanden påverkar inte privata badges, och systemtext renderas säkert', () => {
  const client = createClient();
  client.run('activeChatUser = { id: 2, conversationId: 7 }');
  const message = { id: 1, sender_id: 3, conversation_id: 99, is_group: true, message_type: 'text', content: 'Grupptext' };
  client.handlers.new_message(message);
  assert.equal(client.run('unreadCounts[3] || 0'), 0);
  assert.equal(client.document.getElementById('chatMessagesContainer').children.length, 0);
  client.run('activeChatUser = { conversationId: 99, is_group: true, participants: [] }');
  client.handlers.new_message({ ...message, message_type: 'system', content: '* <Alice> har lämnat *' });
  const system = client.document.getElementById('chatMessagesContainer').children[0];
  assert.equal(system.className, 'msn-system');
  assert.equal(system.textContent, '* <Alice> har lämnat *');
  assert.deepEqual(client.sounds, ['message']);
});

test('Gruppnudge skakar och spelar ljud även för avsändaren, utan dubbla bubblor', () => {
  const client = createClient();
  client.run('activeChatUser = { conversationId: 99, is_group: true, participants: [] }');
  const message = { id: 2, sender_id: 1, sender_username: 'Jag', conversation_id: 99, is_group: true, message_type: 'nudge', created_at: '2026-10-12T08:00:00Z' };
  client.handlers.new_message(message);
  assert.deepEqual(client.sounds, ['nudge']);
  assert(client.document.getElementById('chatArea').classList.contains('nudge-shake'));
  client.run(`appendMessageBubble(${JSON.stringify(message)}, false)`);
  assert.equal(client.document.getElementById('chatMessagesContainer').children.length, 1);
});

test('Skrivindikatorn filtrerar både start och stopp till den aktiva konversationen', () => {
  const client = createClient();
  client.run('activeChatUser = { conversationId: 99, is_group: true }');
  const indicator = client.document.getElementById('typingIndicator');
  client.handlers.user_typing({ conversationId: 7, username: 'Privat' });
  assert.notEqual(indicator.style.display, 'block');
  client.handlers.user_typing({ conversationId: 99, username: 'Alice' });
  assert.equal(indicator.textContent, 'Alice skriver ett meddelande...');
  client.handlers.user_stop_typing({ conversationId: 7 });
  assert.equal(indicator.style.display, 'block');
  client.handlers.user_stop_typing({ conversationId: 99 });
  assert.equal(indicator.style.display, 'none');
});

test('Ett sent privat API-svar får inte skriva över den nya konferensen', async () => {
  let resolvePrivate;
  const client = createClient(url => {
    if (url === '/api/conversations') return new Promise(resolve => { resolvePrivate = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ success: true, messages: [] }) });
  });
  const privateRequest = client.run('openChatWith({ user_id: 2, username: "Van", id: 10 })');
  client.handlers.conference_created({ conversationId: 99, participants: [{ user_id: 1, username: 'Jag' }] });
  resolvePrivate({ ok: true, json: async () => ({ success: true, conversationId: 7 }) });
  await privateRequest;
  assert.equal(client.run('activeChatUser.conversationId'), 99);
  assert.equal(client.run('activeChatUser.is_group'), true);
});
