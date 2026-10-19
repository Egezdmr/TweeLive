const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(getUserMedia) {
  const elements = new Map();
  const handlers = {};
  const windowEvents = {};
  const requests = [];
  const peers = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const observers = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, textContent: '', srcObject: null, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      async play() {}
    });
    return elements.get(id);
  }
  class Peer {
    constructor(config) {
      this.config = config;
      this.candidates = [];
      peers.push(this);
    }
    addTrack() {}
    close() { this.closed = true; }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
    async setLocalDescription(description) { this.localDescription = { ...description, toJSON: () => description }; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
  }
  const socket = {
    connected: true,
    on(event, handler) { handlers[event] = handler; },
    emit(event, data) { requests.push({ event, data }); },
    timeout() { return {
      emit(event, data, callback) {
        requests.push({ event, data });
        callback(null, { success: true, callId: 'call-1' });
      }
    }; }
  };
  const context = vm.createContext({
    socket, activeChatUser: { id: 2, username: 'Van', conversationId: 7 },
    document: { getElementById: element },
    window: { isSecureContext: true, RTCPeerConnection: Peer, addEventListener: (event, handler) => { windowEvents[event] = handler; } },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    RTCPeerConnection: Peer,
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
    startaLjudKontext: async () => true, spelaToner() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, MediaStream: class { addTrack() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/webrtc.js'), 'utf8'), context);
  return { element, handlers, tracks, stream, peers, requests, windowEvents, observers, context };
}

test('Webcam använder bara Google STUN och släpper media och peer vid stängning', async () => {
  const c = client();
  assert.equal(c.element('webcamBtn').hidden, false);
  await c.element('webcamBtn').handlers.click();
  assert.equal(c.element('webcamLocal').srcObject, c.stream);
  assert.deepEqual(JSON.parse(JSON.stringify(c.peers[0].config)), { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  await c.handlers.webrtc_answer_call({ callId: 'call-1' });
  assert(c.requests.some(r => r.event === 'webrtc_signal' && r.data.description.type === 'offer'));
  c.element('webcamClose').handlers.click();
  assert(c.tracks.every(track => track.stopped));
  assert.equal(c.peers[0].closed, true);
  assert.equal(c.element('webcamLocal').srcObject, null);
  assert.equal(c.element('webcamPanel').hidden, true);
  assert(c.requests.some(r => r.event === 'webrtc_end_call'));
});

test('Inkommande ICE köas före offer och media stängs vid disconnect', async () => {
  const c = client();
  c.handlers.webrtc_call_user({ callId: 'incoming', username: 'Van' });
  await c.element('webcamAccept').handlers.click();
  c.handlers.webrtc_signal({ callId: 'incoming', candidate: { candidate: 'ice' } });
  c.handlers.webrtc_signal({ callId: 'incoming', description: { type: 'offer', sdp: 'offer' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.peers[0].candidates.length, 1);
  assert(c.requests.some(r => r.event === 'webrtc_signal' && r.data.description.type === 'answer'));
  c.handlers.disconnect();
  assert(c.tracks.every(track => track.stopped));
  assert.equal(c.peers[0].closed, true);
});

test('Avslut under kamerabehörighet stoppar även en sent levererad ström', async () => {
  let resolveMedia;
  const c = client(() => new Promise(resolve => { resolveMedia = resolve; }));
  c.handlers.webrtc_call_user({ callId: 'incoming', username: 'Van' });
  const accepting = c.element('webcamAccept').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  c.handlers.webrtc_end_call({ callId: 'incoming', reason: 'Avslutat' });
  resolveMedia(c.stream);
  await accepting;
  assert(c.tracks.every(track => track.stopped));
  assert.equal(c.peers.length, 0);
  assert.equal(c.element('webcamIncoming').hidden, true);
});

test('Avvisa startar ingen kamera, gruppchatt döljer webcam och sidstängning avslutar', async () => {
  const c = client();
  c.handlers.webrtc_call_user({ callId: 'incoming', username: 'Van' });
  c.element('webcamReject').handlers.click();
  assert.equal(c.peers.length, 0);
  assert(c.requests.some(r => r.event === 'webrtc_reject_call'));
  vm.runInContext('activeChatUser = { is_group: true, conversationId: 99 }', c.context);
  c.observers.forEach(callback => callback());
  assert.equal(c.element('webcamBtn').hidden, true);
  vm.runInContext('activeChatUser = { id: 2, username: "Van", conversationId: 7 }', c.context);
  await c.element('webcamBtn').handlers.click();
  c.windowEvents.pagehide();
  assert(c.tracks.every(track => track.stopped));
  assert.equal(c.element('webcamPanel').hidden, true);
});

test('Nekad kamerabehörighet stänger inkommande samtal och visar ett tydligt fel', async () => {
  const c = client(async () => {
    const error = new Error('Permission denied');
    error.name = 'NotAllowedError';
    throw error;
  });
  c.handlers.webrtc_call_user({ callId: 'incoming', username: 'Van' });
  await c.element('webcamAccept').handlers.click();
  assert.equal(c.peers.length, 0);
  assert.equal(c.element('webcamIncoming').hidden, true);
  assert.match(c.element('webcamNotice').textContent, /Kamera eller mikrofon nekades/);
  assert(c.requests.some(r => r.event === 'webrtc_end_call'));
});
