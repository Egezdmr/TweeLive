    // Socket.io-anslutning för realtidsmeddelanden
    const socket = io({ autoConnect: false });

    // Aktiv chatt just nu (null = ingen vald)
    let activeChatUser = null;
    let currentUsername = null;
    let currentUserId = null;
    let onlineUserIds = [];
    let unreadCounts = {};
    const conferences = new Map();
    let conferenceRevision = 0;
    let loadingConversationId = null;
    let pendingLiveMessages = [];

    socket.on('connect', () => {
      if (!currentUserId) return;
      socket.emit('user_connected', currentUserId);
      conferences.forEach(conference => socket.emit('join_conversation', conference.conversationId));
      if (activeChatUser && activeChatUser.conversationId) {
        socket.emit('join_conversation', activeChatUser.conversationId);
      }
      loadConferences();
    });

    socket.on('chat_error', ({ message }) => {
      console.error('Chat error:', message);
      alert(message);
    });

    socket.on('conference_created', conference => openConference(conference));
    socket.on('conference_participants_changed', ({ conversationId, participants }) => {
      conferenceRevision++;
      const conference = conferences.get(Number(conversationId));
      if (conference) conference.participants = participants;
      if (arAktivKonversation(conversationId)) {
        activeChatUser.participants = participants;
        document.getElementById('typingIndicator').style.display = 'none';
        updateActiveChatHeaderUI();
      }
      updateConferenceTabs();
    });
    socket.on('conference_left', ({ conversationId }) => {
      conferenceRevision++;
      conferences.delete(Number(conversationId));
      if (arAktivKonversation(conversationId)) resetChatArea();
      updateConferenceTabs();
    });

    socket.on('new_message', (message) => {
      const isCurrentActive = activeChatUser && parseInt(activeChatUser.conversationId) === parseInt(message.conversation_id);
      const isFromOtherUser = parseInt(message.sender_id) !== parseInt(currentUserId);

      if (currentUserId && (isFromOtherUser || (message.is_group && message.message_type === 'nudge')) &&
          message.message_type !== 'system') {
        if (message.message_type === 'nudge') playNudgeSound();
        else playMessageSound();
      }

      if (isCurrentActive) {
        if (Number(loadingConversationId) === Number(message.conversation_id)) {
          pendingLiveMessages.push(message);
          return;
        }
        appendMessageBubble(message, true);
        const container = document.getElementById('chatMessagesContainer');
        container.scrollTop = container.scrollHeight;
        if (isFromOtherUser && !message.is_group) {
          markConversationRead(message.conversation_id);
        }
      } else if (isFromOtherUser && !message.is_group && message.message_type !== 'system') {
        const senderId = parseInt(message.sender_id);
        unreadCounts[senderId] = (unreadCounts[senderId] || 0) + 1;
        updateUnreadBadgeUI(senderId);
      }
    });

    socket.on('user_status_change', ({ userId, status }) => {
      if (status === 'online') {
        if (!onlineUserIds.includes(userId)) {
          onlineUserIds.push(userId);
          if (currentUserId && document.querySelector(`#friendsList [data-user-id="${userId}"]`)) {
            playOnlineSound();
          }
        }
      } else {
        onlineUserIds = onlineUserIds.filter(id => id !== userId);
      }
      updateContactStatusUI(userId, status);
    });

    function arAktivKonversation(conversationId) {
      return activeChatUser && parseInt(activeChatUser.conversationId) === parseInt(conversationId);
    }

    socket.on('user_typing', ({ conversationId, username }) => {
      if (!arAktivKonversation(conversationId)) return;
      const indicator = document.getElementById('typingIndicator');
      indicator.textContent = `${username} skriver ett meddelande...`;
      indicator.style.display = 'block';
    });

    socket.on('user_stop_typing', ({ conversationId } = {}) => {
      if (!arAktivKonversation(conversationId)) return;
      const indicator = document.getElementById('typingIndicator');
      indicator.style.display = 'none';
      indicator.textContent = '';
    });

    socket.on('friend_request_received', ({ from }) => {
      loadContacts();
    });

    socket.on('friend_request_accepted', ({ from }) => {
      loadContacts();
    });

    socket.on('contact_removed', ({ contactRecordId }) => {
      if (activeChatUser && parseInt(activeChatUser.contactRecordId) === parseInt(contactRecordId)) {
        resetChatArea();
      }
      loadContacts();
    });

    socket.on('user_status_message_change', ({ userId, statusMessage }) => {
      const el = document.querySelector(`[data-status-for="${userId}"]`);
      if (el) {
        el.textContent = statusMessage ? ` - ${statusMessage}` : '';
      }

      if (activeChatUser && parseInt(activeChatUser.id) === parseInt(userId)) {
        activeChatUser.status_message = statusMessage;
        updateActiveChatHeaderUI();
      }
    });

    // Skrivindikator - debounce timer för typing_stop
    let typingTimeout = null;

    function resetTypingTimeout() {
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        if (activeChatUser && activeChatUser.conversationId) {
          socket.emit('typing_stop', { conversationId: activeChatUser.conversationId });
        }
      }, 2500);
    }

    function updateContactStatusUI(userId, status) {
      const element = document.querySelector(`[data-user-id="${userId}"]`);
      if (!element) return;

      const indicator = element.querySelector('.status-indicator');
      if (!indicator) return;

      if (status === 'online') {
        indicator.classList.remove('status-offline');
        indicator.classList.add('status-online');
        indicator.setAttribute('title', 'Online');
      } else {
        indicator.classList.remove('status-online');
        indicator.classList.add('status-offline');
        indicator.setAttribute('title', 'Offline');
      }
    }

    function updateUnreadBadgeUI(userId) {
      const badge = document.querySelector(`[data-badge-for="${userId}"]`);
      if (!badge) return;

      const count = unreadCounts[userId] || 0;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    function updateActiveChatHeaderUI() {
      if (!activeChatUser) return;
      const headerEl = document.getElementById('activeChatHeader');
      document.getElementById('leaveConferenceBtn').hidden = !activeChatUser.is_group;
      if (activeChatUser.is_group) {
        headerEl.textContent = `Konferenssamtal (${activeChatUser.participants.map(p => p.username).join(', ')})`;
        return;
      }
      const statusText = activeChatUser.status_message 
        ? ` - ${escapeHtml(activeChatUser.status_message)}` 
        : '';
      headerEl.innerHTML = `Chattar med: <strong>${escapeHtml(activeChatUser.username)}</strong>${statusText}`;
    }

    async function markConversationRead(conversationId) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/read`, {
          method: 'POST', credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte spara lässtatus');
      } catch (error) {
        console.error('Mark read error:', error);
        alert('Kunde inte spara lässtatus. Ladda om chatten för att försöka igen.');
      }
    }

    function stopChatTyping() {
      if (activeChatUser && activeChatUser.conversationId) {
        socket.emit('typing_stop', { conversationId: activeChatUser.conversationId });
      }
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = null;
    }

    function updateConferenceTabs() {
      const tabs = document.getElementById('conferenceTabs');
      tabs.replaceChildren();
      tabs.hidden = conferences.size === 0;
      conferences.forEach(conference => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Konferens: ${conference.participants.map(p => p.username).join(', ')}`;
        button.addEventListener('click', () => openConference(conference));
        tabs.appendChild(button);
      });
    }

    async function loadConferences() {
      const revision = conferenceRevision;
      const userId = currentUserId;
      try {
        const response = await fetch('/api/conversations/conferences', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte hämta konferenser');
        if (currentUserId !== userId || conferenceRevision !== revision) return;
        conferences.clear();
        data.conferences.forEach(conference => {
          conferences.set(Number(conference.conversationId), conference);
          socket.emit('join_conversation', conference.conversationId);
        });
        if (activeChatUser && activeChatUser.is_group) {
          const conference = conferences.get(Number(activeChatUser.conversationId));
          if (conference) {
            activeChatUser.participants = conference.participants;
            updateActiveChatHeaderUI();
          } else {
            resetChatArea();
          }
        }
        updateConferenceTabs();
      } catch (error) {
        console.error('Load conferences error:', error);
        alert(error.message);
      }
    }

    function openConference(conference) {
      conferenceRevision++;
      const id = Number(conference.conversationId);
      conferences.set(id, conference);
      updateConferenceTabs();
      if (arAktivKonversation(id)) return;
      stopChatTyping();
      stangEmojiMeny();
      document.getElementById('conferenceInviteDialog').close();
      activeChatUser = { ...conference, is_group: true };
      document.getElementById('chatMessageInput').value = '';
      document.getElementById('typingIndicator').style.display = 'none';
      document.getElementById('typingIndicator').textContent = '';
      document.getElementById('noChatSelected').style.display = 'none';
      document.getElementById('chatArea').style.display = 'flex';
      updateActiveChatHeaderUI();
      socket.emit('join_conversation', id);
      loadConversationMessages(id);
    }

    document.getElementById('inviteConferenceBtn').addEventListener('click', async () => {
      const chat = activeChatUser;
      if (!chat || !chat.conversationId) return;
      const button = document.getElementById('inviteConferenceBtn');
      button.disabled = true;
      try {
        const responses = await Promise.all([
          fetch('/api/contacts', { credentials: 'include' }),
          fetch('/api/users/online', { credentials: 'include' }),
          fetch(`/api/conversations/${chat.conversationId}/participants`, { credentials: 'include' })
        ]);
        const [contacts, online, participants] = await Promise.all(responses.map(async response => {
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte hämta kontakter');
          return data;
        }));
        if (activeChatUser !== chat) return;
        const ids = participants.participants.map(p => Number(p.user_id));
        const friends = contacts.friends.filter(friend =>
          online.onlineUserIds.includes(Number(friend.user_id)) && !ids.includes(Number(friend.user_id))
        );
        const list = document.getElementById('conferenceInviteList');
        list.replaceChildren();
        if (!friends.length) list.textContent = 'Inga fler online-kontakter att bjuda in.';
        friends.forEach(friend => {
          const invite = document.createElement('button');
          invite.type = 'button';
          invite.textContent = friend.username;
          invite.addEventListener('click', async () => {
            if (activeChatUser !== chat) {
              document.getElementById('conferenceInviteDialog').close();
              return;
            }
            list.querySelectorAll('button').forEach(b => { b.disabled = true; });
            try {
              const response = await fetch('/api/conversations/conference', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantIds: [...ids, Number(friend.user_id)] })
              });
              const data = await response.json();
              if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte starta konferensen');
              document.getElementById('conferenceInviteDialog').close();
              openConference(data);
            } catch (error) {
              console.error('Invite conference error:', error);
              alert(error.message);
              list.querySelectorAll('button').forEach(b => { b.disabled = false; });
            }
          });
          list.appendChild(invite);
        });
        document.getElementById('conferenceInviteDialog').showModal();
      } catch (error) {
        console.error('Load invite contacts error:', error);
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('leaveConferenceBtn').addEventListener('click', async () => {
      if (!activeChatUser || !activeChatUser.is_group) return;
      const id = Number(activeChatUser.conversationId);
      const button = document.getElementById('leaveConferenceBtn');
      button.disabled = true;
      try {
        const response = await fetch(`/api/conversations/${id}/leave`, {
          method: 'POST', credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte lämna samtalet');
        conferences.delete(id);
        conferenceRevision++;
        if (arAktivKonversation(id)) resetChatArea();
        updateConferenceTabs();
      } catch (error) {
        console.error('Leave conference error:', error);
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    // Öppnar chattfönstret mot en vald kontakt och hämtar konversationen
    async function openChatWith(friend) {
      stopChatTyping();
      stangEmojiMeny();
      if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
      }
      document.getElementById('typingIndicator').style.display = 'none';
      document.getElementById('typingIndicator').textContent = '';

      unreadCounts[friend.user_id] = 0;
      updateUnreadBadgeUI(friend.user_id);

      activeChatUser = {
        id: friend.user_id,
        username: friend.username,
        status_message: friend.status_message || '',
        contactRecordId: friend.id
      };
      const chat = activeChatUser;
      document.getElementById('chatMessageInput').value = '';

      document.getElementById('noChatSelected').style.display = 'none';
      document.getElementById('chatArea').style.display = 'flex';
      updateActiveChatHeaderUI();
      document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: #666;">Laddar meddelanden...</p>';

      try {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recipientId: friend.user_id })
        });

        const data = await response.json();
        if (activeChatUser !== chat) return;

        if (data.success) {
          activeChatUser.conversationId = data.conversationId;
          updateActiveChatHeaderUI();
          socket.emit('join_conversation', data.conversationId);
          loadConversationMessages(data.conversationId);
        } else {
          document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte öppna konversationen</p>';
        }
      } catch (error) {
        console.error('Open conversation error:', error);
        if (activeChatUser !== chat) return;
        document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte öppna konversationen</p>';
      }
    }

    // Hämtar och visar meddelandehistorik för en konversation
    async function loadConversationMessages(conversationId) {
      const chat = activeChatUser;
      loadingConversationId = conversationId;
      pendingLiveMessages = [];
      document.getElementById('chatMessagesContainer').textContent = 'Laddar meddelanden...';
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          credentials: 'include'
        });

        const data = await response.json();
        if (activeChatUser !== chat) return;
        if (!response.ok || !data.success) throw new Error(data.message || 'Kunde inte ladda meddelanden');
        const container = document.getElementById('chatMessagesContainer');
        container.innerHTML = '';

        const pending = pendingLiveMessages;
        loadingConversationId = null;
        pendingLiveMessages = [];
        if (!data.messages.length && !pending.length) {
          container.innerHTML = '<p style="color: #999; text-align: center;">Inga meddelanden än. Skriv något!</p>';
          return;
        }

        const pendingById = new Map(pending.map(message => [Number(message.id), message]));
        data.messages.forEach(message => {
          const live = pendingById.get(Number(message.id));
          appendMessageBubble(live || message, Boolean(live));
        });
        pending.forEach(message => appendMessageBubble(message, true));
        if (pending.length && !chat.is_group) markConversationRead(conversationId);

        container.scrollTop = container.scrollHeight;
      } catch (error) {
        console.error('Load messages error:', error);
        if (activeChatUser !== chat) return;
        document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte ladda meddelanden</p>';
      } finally {
        if (activeChatUser === chat) loadingConversationId = null;
      }
    }

    // Lägger till en enskild meddelandebubbla i chattfönstret
    function appendMessageBubble(message, isLive = false) {
      const container = document.getElementById('chatMessagesContainer');
      if (container.querySelector(`[data-message-id="${Number(message.id)}"]`)) return;

      if (message.message_type === 'system') {
        const system = document.createElement('div');
        system.className = 'msn-system';
        system.dataset.messageId = message.id;
        system.textContent = message.content;
        container.appendChild(system);
        return;
      }

      if (message.message_type === 'nudge') {
        if (isLive) {
          const chatArea = document.getElementById('chatArea');
          chatArea.classList.remove('nudge-shake');
          void chatArea.offsetWidth;
          chatArea.classList.add('nudge-shake');
          setTimeout(() => chatArea.classList.remove('nudge-shake'), 500);
        }

        const timestamp = new Date(message.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const nudgeWrapper = document.createElement('div');
        nudgeWrapper.className = 'msn-nudge';
        nudgeWrapper.dataset.messageId = message.id;
        nudgeWrapper.textContent = `* ${message.sender_username} skickade en nudge (${timestamp}) *`;
        container.appendChild(nudgeWrapper);
        return;
      }

      const isOwnMessage = parseInt(message.sender_id) === parseInt(currentUserId);
      const timestamp = new Date(message.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      const messageWrapper = document.createElement('div');
      messageWrapper.className = 'msn-message-wrapper';
      messageWrapper.dataset.messageId = message.id;

      const senderLine = document.createElement('div');
      senderLine.className = 'msn-sender-line';
      senderLine.style.color = isOwnMessage ? '#1976d2' : '#d32f2f';
      senderLine.textContent = `${message.sender_username} säger (${timestamp}):`;

      messageWrapper.appendChild(senderLine);

      // Hantera bilder
      if (message.message_type === 'image') {
        const imageContainer = document.createElement('div');
        imageContainer.style.cssText = 'padding-left: 12px; margin-top: 4px;';
        const img = document.createElement('img');
        img.src = message.content;
        img.alt = 'Bifogad bild';
        img.style.cssText = 'max-width: 200px; max-height: 200px; border: 1px solid #ccc; cursor: pointer; border-radius: 3px;';
        img.addEventListener('click', () => window.open(message.content, '_blank'));
        imageContainer.appendChild(img);
        messageWrapper.appendChild(imageContainer);
      }
      // Hantera ljud
      else if (message.message_type === 'audio') {
        const audioContainer = document.createElement('div');
        audioContainer.style.cssText = 'padding-left: 12px; margin-top: 4px;';
        const audio = document.createElement('audio');
        audio.src = message.content;
        audio.controls = true;
        audio.style.cssText = 'max-width: 250px; height: 28px;';
        audioContainer.appendChild(audio);
        messageWrapper.appendChild(audioContainer);
      }
      // Vanlig textmeddelande
      else {
        const messageText = document.createElement('div');
        messageText.className = 'msn-message-text';
        visaTextMedEmojier(messageText, message.content);
        messageWrapper.appendChild(messageText);
      }

      container.appendChild(messageWrapper);
    }

    // Nollställer chattvyn, t.ex. efter borttagen kontakt
    function resetChatArea() {
      stopChatTyping();
      document.getElementById('conferenceInviteDialog').close();
      loadingConversationId = null;
      pendingLiveMessages = [];
      stangEmojiMeny();
      if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
      }
      document.getElementById('typingIndicator').style.display = 'none';
      document.getElementById('typingIndicator').textContent = '';

      activeChatUser = null;
      document.getElementById('chatArea').style.display = 'none';
      document.getElementById('noChatSelected').style.display = 'flex';
      document.getElementById('chatMessagesContainer').innerHTML = '';
    }

    // Skickar meddelandet till backend, mottas via socket för visning
    document.getElementById('chatMessageForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      stangEmojiMeny();

      const input = document.getElementById('chatMessageInput');
      const text = input.value.trim();
      if (!text || !activeChatUser || !activeChatUser.conversationId) return;

      if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
        socket.emit('typing_stop', { conversationId: activeChatUser.conversationId });
      }

      try {
        const response = await fetch(`/api/conversations/${activeChatUser.conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content: text, messageType: 'text' })
        });

        const data = await response.json();

        if (data.success) {
          input.value = '';
        } else {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Send message error:', error);
        alert('Kunde inte skicka meddelandet');
      }
    });

    // Lyssnar på tangenttryckningar för skrivindikator
    document.getElementById('chatMessageInput').addEventListener('input', () => {
      if (!activeChatUser || !activeChatUser.conversationId) return;

      const input = document.getElementById('chatMessageInput');
      if (input.value.trim().length > 0) {
        socket.emit('typing_start', { 
          conversationId: activeChatUser.conversationId, 
          username: currentUsername 
        });
        resetTypingTimeout();
      } else {
        if (typingTimeout) {
          clearTimeout(typingTimeout);
          typingTimeout = null;
        }
        socket.emit('typing_stop', { conversationId: activeChatUser.conversationId });
      }
    });

    // Bifoga fil (bild eller ljud)
    document.getElementById('attachFileBtn').addEventListener('click', () => {
      document.getElementById('chatFileInput').click();
    });

    document.getElementById('chatFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!activeChatUser || !activeChatUser.conversationId) {
        alert('Välj en chatt först');
        return;
      }

      if (file.size > 3 * 1024 * 1024) {
        alert('Filen är för stor (max 3 MB)');
        document.getElementById('chatFileInput').value = '';
        return;
      }

      const attachBtn = document.getElementById('attachFileBtn');
      attachBtn.disabled = true;
      attachBtn.textContent = 'Laddar upp...';

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`/api/conversations/${activeChatUser.conversationId}/upload`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });

        const data = await response.json();

        if (data.success) {
          document.getElementById('chatFileInput').value = '';
        } else {
          alert('Fel: ' + data.message);
          document.getElementById('chatFileInput').value = '';
        }
      } catch (error) {
        console.error('File upload error:', error);
        alert('Kunde inte ladda upp filen');
        document.getElementById('chatFileInput').value = '';
      } finally {
        attachBtn.disabled = false;
        attachBtn.textContent = 'Bifoga...';
      }
    });

    // Skickar en retro-nudge till motparten
    document.getElementById('nudgeBtn').addEventListener('click', async () => {
      if (!activeChatUser || !activeChatUser.conversationId) return;

      try {
        const response = await fetch(`/api/conversations/${activeChatUser.conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content: '* Skickade en nudge *', messageType: 'nudge' })
        });

        const data = await response.json();

        if (!data.success) {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Send nudge error:', error);
        alert('Kunde inte skicka nudge');
      }
    });
