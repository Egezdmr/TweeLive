    // Socket.io-anslutning för realtidsmeddelanden
    const socket = io();

    // Aktiv chatt just nu (null = ingen vald)
    let activeChatUser = null;
    let currentUsername = null;
    let currentUserId = null;
    let onlineUserIds = [];
    let unreadCounts = {};

    socket.on('new_message', (message) => {
      const isCurrentActive = activeChatUser && parseInt(activeChatUser.conversationId) === parseInt(message.conversation_id);
      const isFromOtherUser = parseInt(message.sender_id) !== parseInt(currentUserId);

      if (currentUserId && isFromOtherUser) {
        if (message.message_type === 'nudge') playNudgeSound();
        else playMessageSound();
      }

      if (isCurrentActive) {
        appendMessageBubble(message, true);
        const container = document.getElementById('chatMessagesContainer');
        container.scrollTop = container.scrollHeight;
      } else if (isFromOtherUser) {
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

    socket.on('user_typing', ({ username }) => {
      const indicator = document.getElementById('typingIndicator');
      indicator.textContent = `${username} skriver ett meddelande...`;
      indicator.style.display = 'block';
    });

    socket.on('user_stop_typing', () => {
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
      const statusText = activeChatUser.status_message 
        ? ` - ${escapeHtml(activeChatUser.status_message)}` 
        : '';
      headerEl.innerHTML = `Chattar med: <strong>${escapeHtml(activeChatUser.username)}</strong>${statusText}`;
    }

    // Öppnar chattfönstret mot en vald kontakt och hämtar konversationen
    async function openChatWith(friend) {
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

        if (data.success) {
          activeChatUser.conversationId = data.conversationId;
          socket.emit('join_conversation', data.conversationId);
          loadConversationMessages(data.conversationId);
        } else {
          document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte öppna konversationen</p>';
        }
      } catch (error) {
        console.error('Open conversation error:', error);
        document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte öppna konversationen</p>';
      }
    }

    // Hämtar och visar meddelandehistorik för en konversation
    async function loadConversationMessages(conversationId) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          credentials: 'include'
        });

        const data = await response.json();
        const container = document.getElementById('chatMessagesContainer');
        container.innerHTML = '';

        if (!data.success || !data.messages.length) {
          container.innerHTML = '<p style="color: #999; text-align: center;">Inga meddelanden än. Skriv något!</p>';
          return;
        }

        data.messages.forEach(message => appendMessageBubble(message, false));

        container.scrollTop = container.scrollHeight;
      } catch (error) {
        console.error('Load messages error:', error);
        document.getElementById('chatMessagesContainer').innerHTML = '<p style="color: red;">Kunde inte ladda meddelanden</p>';
      }
    }

    // Lägger till en enskild meddelandebubbla i chattfönstret
    function appendMessageBubble(message, isLive = false) {
      const container = document.getElementById('chatMessagesContainer');

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
        nudgeWrapper.textContent = `* ${message.sender_username} skickade en nudge (${timestamp}) *`;
        container.appendChild(nudgeWrapper);
        return;
      }

      const isOwnMessage = parseInt(message.sender_id) === parseInt(currentUserId);
      const timestamp = new Date(message.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      const messageWrapper = document.createElement('div');
      messageWrapper.className = 'msn-message-wrapper';

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
