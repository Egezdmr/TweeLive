    // ===== SESSION MANAGEMENT =====
    function showAuthContainer() {
      stangEmojiMeny();
      document.getElementById('authContainer').style.display = 'block';
      document.getElementById('chatContainer').style.display = 'none';
    }

    // Check if user is already logged in on page load
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.user) {
            currentUserId = data.user.id;
            if (data.user.status_message) {
              sessionStorage.setItem(`status_${currentUserId}`, data.user.status_message);
              document.getElementById('statusMessageInput').value = data.user.status_message;
            }
            socket.emit('user_connected', data.user.id);
            showChatContainer(data.user.username);
          } else {
            showAuthContainer();
          }
        } else {
          showAuthContainer();
        }
      } catch (error) {
        console.error('Kunde inte kontrollera session:', error);
        showAuthContainer();
      }
    });

    // Logout function
    async function performLogout() {
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include'
        });

        if (response.ok) {
          if (socket && socket.connected) {
            socket.disconnect();
            socket.connect();
          }
          unreadCounts = {};
          showAuthContainer();
          document.getElementById('loginForm').reset();
        }
      } catch (error) {
        console.error('Logout error:', error);
      }
    }

    // ===== CONTACTS MANAGEMENT =====

    // Escape HTML för säkerhet
    function escapeHtml(text) {
      if (!text) return '';
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Search users
    async function performSearch() {
      const query = document.getElementById('userSearchInput').value.trim();

      if (!query) {
        document.getElementById('searchResults').style.display = 'none';
        return;
      }

      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
          credentials: 'include'
        });

        const data = await response.json();

        if (data.success && data.users.length > 0) {
          displaySearchResults(data.users);
          document.getElementById('searchResults').style.display = 'block';
        } else {
          document.getElementById('searchResultsList').innerHTML = '<p style="color: #666;">Ingen användare hittad</p>';
          document.getElementById('searchResults').style.display = 'block';
        }
      } catch (error) {
        console.error('Search error:', error);
        document.getElementById('searchResultsList').innerHTML = '<p style="color: red;">Sökfel</p>';
      }
    }

    function handleSearchKeypress(event) {
      if (event.key === 'Enter') {
        performSearch();
      }
    }

    function displaySearchResults(users) {
      const resultsList = document.getElementById('searchResultsList');
      resultsList.innerHTML = '';

      users.forEach(user => {
        const resultItem = document.createElement('div');
        resultItem.style.cssText = 'padding: 8px; background: white; margin-bottom: 5px; border-radius: 3px; border: 1px solid #ddd;';
        resultItem.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${user.username}</strong><br>
              <small style="color: #666;">${user.email}</small>
            </div>
            <button onclick="sendFriendRequest(${user.id})" style="padding: 5px 10px; background: #667eea; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">
              Lägg till
            </button>
          </div>
        `;
        resultsList.appendChild(resultItem);
      });
    }

    async function sendFriendRequest(contactId) {
      try {
        const response = await fetch('/api/contacts/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ contactId })
        });

        const data = await response.json();

        if (data.success) {
          alert('Förfrågan skickad!');
          document.getElementById('userSearchInput').value = '';
          document.getElementById('searchResultsList').innerHTML = '';
          document.getElementById('searchResults').style.display = 'none';
        } else {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Send request error:', error);
        alert('Kunde inte skicka förfrågan');
      }
    }

    // Hämtar både kontakter och väntande förfrågningar
    async function loadContacts() {
      try {
        const response = await fetch('/api/contacts', {
          credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
          const onlineResponse = await fetch('/api/users/online', {
            credentials: 'include'
          });

          const onlineData = await onlineResponse.json();
          if (onlineData.success) {
            onlineUserIds = onlineData.onlineUserIds;
          }

          displayFriends(data.friends || []);

          if (data.pendingRequests && data.pendingRequests.length > 0) {
            displayPendingRequests(data.pendingRequests);
          } else {
            document.getElementById('pendingRequestsList').innerHTML = '<p style="color: #666;">Inga väntande förfrågningar</p>';
          }
        }
      } catch (error) {
        console.error('Load contacts error:', error);
      }
    }

    function displayFriends(friends) {
      const list = document.getElementById('friendsList');

      if (!friends.length) {
        list.innerHTML = '<p style="color: #666; margin: 0; font-size: 11px;">Inga kontakter än</p>';
        return;
      }

      list.innerHTML = '';

      friends.forEach(friend => {
        const isOnline = onlineUserIds.includes(friend.user_id);
        const statusClass = isOnline ? 'status-online' : 'status-offline';
        const unreadCount = unreadCounts[friend.user_id] || 0;
        const statusMessage = friend.status_message ? ' - ' + escapeHtml(friend.status_message) : '';

        const item = document.createElement('div');
        item.setAttribute('data-user-id', friend.user_id);
        item.className = 'friend-item';
        item.style.cssText = 'padding: 6px 4px; background: #e8e8e8; margin-bottom: 2px; cursor: pointer; border-left: 3px solid transparent; font-size: 11px;';
        
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <span class="status-indicator ${statusClass}" style="margin-right: 4px;"></span><strong>${friend.username}</strong>
              <span data-badge-for="${friend.user_id}" style="display: ${unreadCount > 0 ? 'inline-block' : 'none'}; background: #ff6600; color: white; border-radius: 10px; padding: 0px 4px; font-size: 10px; font-weight: bold; margin-left: 4px;">${unreadCount}</span><br>
              <small style="color: #666; font-size: 10px; margin-left: 14px;">${friend.email}</small>
              <div data-status-for="${friend.user_id}" style="color: #999; font-size: 10px; font-style: italic; margin-left: 14px;">${statusMessage}</div>
            </div>
            <button style="padding: 2px 6px; background: #c0c0c0; border: 1px solid #dfce56; border-right: 2px solid #808080; border-bottom: 2px solid #808080; cursor: pointer; font-size: 10px; font-family: Tahoma, Arial; margin-left: 4px;">
              Ta bort
            </button>
          </div>
        `;

        item.addEventListener('click', () => openChatWith(friend));
        item.addEventListener('mouseenter', () => item.style.background = '#d0d0d0');
        item.addEventListener('mouseleave', () => item.style.background = '#e8e8e8');
        
        item.querySelector('button').addEventListener('click', (event) => {
          event.stopPropagation();
          removeContact(friend);
        });

        list.appendChild(item);
      });
    }

    async function removeContact(friend) {
      const confirmed = confirm('Är du säker på att du vill ta bort kontakten?');
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/contacts/${friend.id}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
          if (activeChatUser && activeChatUser.contactRecordId === friend.id) {
            resetChatArea();
          }
          loadContacts();
        } else {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Remove contact error:', error);
        alert('Kunde inte ta bort kontakten');
      }
    }

    function displayPendingRequests(requests) {
      const list = document.getElementById('pendingRequestsList');
      list.innerHTML = '';

      requests.forEach(request => {
        const requestItem = document.createElement('div');
        requestItem.style.cssText = 'padding: 10px; background: white; margin-bottom: 8px; border-radius: 3px; border: 1px solid #ddd;';
        requestItem.innerHTML = `
          <div>
            <strong style="font-size: 12px;">${request.username}</strong>
            <div style="font-size: 11px; color: #666; margin: 5px 0;">${request.email}</div>
            <div style="display: flex; gap: 5px; margin-top: 8px;">
              <button onclick="acceptRequest(${request.id})" style="flex: 1; padding: 5px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">
                Acceptera
              </button>
              <button onclick="rejectRequest(${request.id})" style="flex: 1; padding: 5px; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">
                Avvisa
              </button>
            </div>
          </div>
        `;
        list.appendChild(requestItem);
      });
    }

    async function acceptRequest(contactId) {
      try {
        const response = await fetch(`/api/contacts/${contactId}/accept`, {
          method: 'PUT',
          credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
          loadContacts();
        } else {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Accept error:', error);
      }
    }

    async function rejectRequest(contactId) {
      try {
        const response = await fetch(`/api/contacts/${contactId}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
          loadContacts();
        } else {
          alert('Fel: ' + data.message);
        }
      } catch (error) {
        console.error('Reject error:', error);
      }
    }

    // Visar chattvyn och laddar kontaktlistan
    function showChatContainer(username) {
      currentUsername = username;
      document.getElementById('authContainer').style.display = 'none';
      document.getElementById('chatContainer').style.display = 'flex';
      document.getElementById('usernameDisplay').textContent = username;
      
      // Initiera statusfältet från sessionen
      const statusInput = document.getElementById('statusMessageInput');
      if (currentUserId && sessionStorage.getItem(`status_${currentUserId}`)) {
        statusInput.value = sessionStorage.getItem(`status_${currentUserId}`);
      }
      
      loadContacts();
    }

    // ===== TAB SWITCHING =====
    function switchTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      event.target.classList.add('active');
    }

    // ===== STATUS MESSAGE HANDLER =====
    const statusMessageInput = document.getElementById('statusMessageInput');
    let statusUpdateTimeout = null;

    statusMessageInput.addEventListener('blur', async () => {
      if (!currentUserId) return;
      const statusMessage = statusMessageInput.value.trim();
      
      try {
        const response = await fetch('/api/users/status-message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ statusMessage })
        });

        const data = await response.json();
        if (data.success) {
          sessionStorage.setItem(`status_${currentUserId}`, data.statusMessage);
        }
      } catch (error) {
        console.error('Status update error:', error);
      }
    });

    statusMessageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        statusMessageInput.blur();
      }
    });

    // ===== LOGIN FORM =====
    const loginForm = document.getElementById('loginForm');
    const loginMessage = document.getElementById('loginMessage');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('identifier').value;
      const password = document.getElementById('password').value;

      loginMessage.textContent = 'Loggar in...';
      loginMessage.className = 'message loading';
      loginMessage.style.display = 'block';

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ identifier, password })
        });

        const data = await response.json();

        if (data.success) {
          loginMessage.textContent = '✅ ' + data.message;
          loginMessage.className = 'message success';
          setTimeout(() => {
            currentUserId = data.user?.id || null;
            if (data.user?.status_message) {
              sessionStorage.setItem(`status_${currentUserId}`, data.user.status_message);
              document.getElementById('statusMessageInput').value = data.user.status_message;
            }
            socket.emit('user_connected', currentUserId);
            showChatContainer(data.user?.username || identifier);
            loginForm.reset();
          }, 1500);
        } else {
          loginMessage.textContent = '❌ ' + data.message;
          loginMessage.className = 'message error';
        }
      } catch (error) {
        loginMessage.textContent = '❌ Ett fel uppstod';
        loginMessage.className = 'message error';
      }
    });

    // ===== SIGNUP FORM =====
    const signupForm = document.getElementById('signupForm');
    const signupMessage = document.getElementById('signupMessage');
    const usernameInput = document.getElementById('regUsername');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('regPassword');
    const passwordConfirmInput = document.getElementById('passwordConfirm');

    usernameInput.addEventListener('input', checkUsernameRealtime);
    emailInput.addEventListener('input', validateEmailRealtime);
    passwordConfirmInput.addEventListener('input', validatePasswordsRealtime);

    async function checkUsernameRealtime() {
      const username = usernameInput.value.trim();
      const msg = document.getElementById('usernameMsg');
      if (!username) { msg.style.display = 'none'; return; }

      try {
        const response = await fetch(`/api/check-username/${username}`);
        const data = await response.json();
        if (data.exists) {
          msg.textContent = '❌ Användarnamnet är redan taget';
          msg.className = 'validation-msg error';
        } else {
          msg.textContent = '✅ Användarnamnet är tillgängligt';
          msg.className = 'validation-msg success';
        }
      } catch (error) {
        msg.textContent = '❌ Kunde inte verifiera användarnamn';
        msg.className = 'validation-msg error';
      }
    }

    async function validateEmailRealtime() {
      const email = emailInput.value.trim();
      const msg = document.getElementById('emailMsg');
      if (!email) { msg.style.display = 'none'; return; }

      if (!isValidEmail(email)) {
        msg.textContent = '❌ Ogiltig e-postformat';
        msg.className = 'validation-msg error';
        return;
      }

      try {
        const response = await fetch(`/api/check-email/${encodeURIComponent(email)}`);
        const data = await response.json();
        if (data.exists) {
          msg.innerHTML = '❌ E-postadressen är redan registrerad<br><small>Försök <a href="#" onclick="switchTab(\'login\'); return false;">logga in</a> istället</small>';
          msg.className = 'validation-msg error';
        } else {
          msg.textContent = '✅ E-postadressen är tillgänglig';
          msg.className = 'validation-msg success';
        }
      } catch (error) {
        msg.textContent = '❌ Kunde inte verifiera e-post';
        msg.className = 'validation-msg error';
      }
    }

    function validatePasswordsRealtime() {
      const password = passwordInput.value;
      const confirm = passwordConfirmInput.value;
      const msg = document.getElementById('passwordMsg');

      if (!confirm) { msg.style.display = 'none'; return; }

      if (password === confirm && password.length > 0) {
        msg.textContent = '✅ Lösenorden matchar';
        msg.className = 'validation-msg success';
      } else if (password.length > 0) {
        msg.textContent = '❌ Lösenorden matchar inte';
        msg.className = 'validation-msg error';
      } else {
        msg.style.display = 'none';
      }
    }

    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const firstName = document.getElementById('firstName').value;
      const lastName = document.getElementById('lastName').value;
      const username = usernameInput.value;
      const email = emailInput.value;
      const password = passwordInput.value;
      const passwordConfirm = passwordConfirmInput.value;
      const gender = document.getElementById('gender').value;
      const birthDate = document.getElementById('birthDate').value;

      if (password !== passwordConfirm) {
        signupMessage.textContent = '❌ Lösenorden matchar inte';
        signupMessage.className = 'message error';
        signupMessage.style.display = 'block';
        return;
      }

      if (!isValidEmail(email)) {
        signupMessage.textContent = '❌ Ogiltig e-postformat';
        signupMessage.className = 'message error';
        signupMessage.style.display = 'block';
        return;
      }

      signupMessage.textContent = 'Registrerar...';
      signupMessage.className = 'message loading';
      signupMessage.style.display = 'block';

      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName, lastName, username, email, password,
            gender: parseInt(gender), birthDate
          })
        });

        const data = await response.json();

        if (data.success) {
          signupMessage.textContent = '✅ ' + data.message;
          signupMessage.className = 'message success';
          setTimeout(() => {
            signupForm.reset();
            switchTab('login');
          }, 2000);
        } else {
          signupMessage.textContent = '❌ ' + data.message;
          signupMessage.className = 'message error';
        }
      } catch (error) {
        signupMessage.textContent = '❌ Ett fel uppstod';
        signupMessage.className = 'message error';
      }
    });
