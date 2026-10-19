(() => {
  const button = document.getElementById('webcamBtn');
  const panel = document.getElementById('webcamPanel');
  const incoming = document.getElementById('webcamIncoming');
  const localVideo = document.getElementById('webcamLocal');
  const remoteVideo = document.getElementById('webcamRemote');
  const status = document.getElementById('webcamStatus');
  const acceptButton = document.getElementById('webcamAccept');
  let call = null;

  function updateButton() {
    button.hidden = !activeChatUser || activeChatUser.is_group || !activeChatUser.conversationId;
    button.disabled = Boolean(call) || !socket.connected;
  }

  function request(event, data) {
    return new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, data, (error, result) => {
        if (error) return reject(new Error('Servern svarade inte på samtalsförfrågan.'));
        if (!result?.success) return reject(new Error(result?.message || 'Samtalet misslyckades.'));
        resolve(result);
      });
    });
  }

  function cleanup(message = 'Samtalet avslutades', notify = true) {
    const previous = call;
    call = null;
    if (previous) {
      clearInterval(previous.ringing);
      clearTimeout(previous.timeout);
      if (previous.id && notify && socket.connected) {
        socket.emit('webrtc_end_call', { callId: previous.id });
      }
      if (previous.peer) {
        previous.peer.onicecandidate = null;
        previous.peer.ontrack = null;
        previous.peer.onconnectionstatechange = null;
        previous.peer.close();
      }
      previous.stream?.getTracks().forEach(track => track.stop());
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject?.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
    incoming.hidden = true;
    panel.hidden = true;
    acceptButton.disabled = false;
    status.textContent = message;
    document.getElementById('webcamNotice').textContent = message;
    updateButton();
  }

  function fail(error, expectedCall) {
    console.error('WebRTC error:', error);
    if (call !== expectedCall) return;
    const mediaErrors = {
      NotAllowedError: 'Kamera eller mikrofon nekades. Tillåt dem i webbläsaren och försök igen.',
      NotFoundError: 'Ingen kamera eller mikrofon hittades.',
      NotReadableError: 'Kamera eller mikrofon kunde inte öppnas. Kontrollera om ett annat program använder dem.'
    };
    cleanup(mediaErrors[error.name] || error.message || 'Kunde inte ansluta videosamtalet.');
  }

  function supported() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('Webcam kräver HTTPS eller localhost och en webbläsare med WebRTC-stöd.');
    }
  }

  async function prepareMedia(current) {
    supported();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // Behörighetsdialogen kan vara öppen när motparten lägger på.
    if (call !== current) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    current.stream = stream;
    localVideo.srcObject = stream;
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    current.peer = peer;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.ontrack = event => {
      if (call !== current) return;
      if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
      remoteVideo.srcObject.addTrack(event.track);
      remoteVideo.play().catch(error => {
        if (call !== current) return;
        console.warn('Webcam playback needs interaction:', error);
        document.getElementById('webcamPlay').hidden = false;
      });
    };
    peer.onicecandidate = event => {
      if (event.candidate && call === current) {
        request('webrtc_signal', { callId: current.id, candidate: event.candidate.toJSON() })
          .catch(error => fail(error, current));
      }
    };
    peer.onconnectionstatechange = () => {
      if (call !== current) return;
      if (peer.connectionState === 'connected') {
        clearTimeout(current.timeout);
        status.textContent = `Ansluten till ${current.username}`;
      } else if (peer.connectionState === 'failed') {
        cleanup('Kunde inte ansluta. Nätverket kan blockera samtal utan TURN.');
      } else if (peer.connectionState === 'disconnected') {
        status.textContent = 'Anslutningen avbröts. Försöker återansluta...';
        clearTimeout(current.timeout);
        current.timeout = setTimeout(() => {
          if (call === current) cleanup('Anslutningen till videosamtalet förlorades.');
        }, 15000);
      }
    };
    return true;
  }

  function showPanel(current, text) {
    panel.hidden = false;
    document.getElementById('webcamTitle').textContent = `Webcam – ${current.username}`;
    document.getElementById('webcamPlay').hidden = true;
    document.getElementById('webcamNotice').textContent = '';
    status.textContent = text;
    updateButton();
  }

  function connectionTimeout(current) {
    clearTimeout(current.timeout);
    current.timeout = setTimeout(() => {
      if (call === current) cleanup('Ingen videoanslutning. STUN räcker inte på alla nätverk; prova ett annat nätverk.');
    }, 45000);
  }

  button.addEventListener('click', async () => {
    if (call || !activeChatUser || activeChatUser.is_group) return;
    const chat = activeChatUser;
    const current = { username: chat.username, caller: true, candidates: [], signals: Promise.resolve() };
    call = current;
    showPanel(current, 'Aktiverar kamera och mikrofon...');
    try {
      await startaLjudKontext();
      if (call !== current || !await prepareMedia(current)) return;
      const result = await request('webrtc_call_user', {
        recipientId: Number(chat.id), conversationId: Number(chat.conversationId)
      });
      if (call !== current) {
        socket.emit('webrtc_end_call', { callId: result.callId });
        return;
      }
      current.id = result.callId;
      status.textContent = `Ringer ${current.username}...`;
      connectionTimeout(current);
    } catch (error) {
      fail(error, current);
    }
  });

  socket.on('webrtc_call_user', data => {
    if (call) {
      socket.emit('webrtc_reject_call', { callId: data.callId });
      return;
    }
    const current = {
      id: data.callId, username: data.username, caller: false,
      candidates: [], signals: Promise.resolve()
    };
    call = current;
    incoming.hidden = false;
    document.getElementById('webcamCaller').textContent = `${data.username} vill starta ett videosamtal.`;
    const ring = () => spelaToner([
      { frekvens: 659, start: 0, langd: 0.18, volym: 0.07 },
      { frekvens: 880, start: 0.22, langd: 0.25, volym: 0.07 }
    ]);
    ring();
    current.ringing = setInterval(ring, 2200);
    current.timeout = setTimeout(() => {
      if (call === current) cleanup('Missat videosamtal');
    }, 45000);
    updateButton();
  });

  acceptButton.addEventListener('click', async () => {
    const current = call;
    if (!current || current.caller || acceptButton.disabled) return;
    acceptButton.disabled = true;
    clearInterval(current.ringing);
    showPanel(current, 'Aktiverar kamera och mikrofon...');
    try {
      await startaLjudKontext();
      if (call !== current || !await prepareMedia(current)) return;
      await request('webrtc_answer_call', { callId: current.id });
      if (call !== current) return;
      incoming.hidden = true;
      status.textContent = 'Ansluter...';
      connectionTimeout(current);
    } catch (error) {
      fail(error, current);
    }
  });

  document.getElementById('webcamReject').addEventListener('click', () => {
    if (call) socket.emit('webrtc_reject_call', { callId: call.id });
    cleanup('Samtalet avvisades', false);
  });

  socket.on('webrtc_answer_call', async ({ callId }) => {
    const current = call;
    if (!current || current.id !== callId || !current.caller) return;
    try {
      status.textContent = 'Ansluter...';
      const offer = await current.peer.createOffer();
      if (call !== current) return;
      await current.peer.setLocalDescription(offer);
      await request('webrtc_signal', { callId, description: current.peer.localDescription.toJSON() });
    } catch (error) {
      fail(error, current);
    }
  });

  socket.on('webrtc_signal', data => {
    const current = call;
    if (!current || current.id !== data.callId) return;
    // ICE kan komma före SDP. Signaler behandlas i ordning.
    current.signals = current.signals.then(async () => {
      if (call !== current) return;
      const peer = current.peer;
      if (data.description) {
        await peer.setRemoteDescription(data.description);
        for (const candidate of current.candidates) await peer.addIceCandidate(candidate);
        current.candidates = [];
        if (data.description.type === 'offer') {
          const answer = await peer.createAnswer();
          if (call !== current) return;
          await peer.setLocalDescription(answer);
          await request('webrtc_signal', { callId: current.id, description: peer.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
        else current.candidates.push(data.candidate);
      }
    }).catch(error => fail(error, current));
  });

  socket.on('webrtc_end_call', ({ callId, reason }) => {
    if (call?.id === callId) cleanup(reason, false);
  });
  socket.on('webrtc_reject_call', ({ callId }) => {
    if (call?.id === callId) cleanup('Samtalet avvisades', false);
  });
  socket.on('disconnect', () => {
    if (call) cleanup('Videosamtalet avslutades när anslutningen stängdes.', false);
    updateButton();
  });
  socket.on('connect', updateButton);
  document.getElementById('webcamHangup').addEventListener('click', () => cleanup());
  document.getElementById('webcamClose').addEventListener('click', () => cleanup());
  document.getElementById('webcamPlay').addEventListener('click', async () => {
    try {
      await remoteVideo.play();
      document.getElementById('webcamPlay').hidden = true;
    } catch (error) {
      console.error('Webcam playback error:', error);
      status.textContent = 'Kunde inte spela videon. Kontrollera webbläsarens behörigheter.';
    }
  });
  window.addEventListener('pagehide', () => cleanup('Samtalet avslutades'));
  new MutationObserver(updateButton).observe(document.getElementById('activeChatHeader'), { childList: true, subtree: true });
  new MutationObserver(updateButton).observe(document.getElementById('chatArea'), { attributes: true, attributeFilter: ['style'] });
  updateButton();
})();
