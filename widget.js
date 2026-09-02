// ==============================================================================
// SMILEX UNIVERSAL CHAT WIDGET SDK (chat.smilex.vn/widget.js)
// 1-Line Embeddable Live Chat + AI Concierge + 2-Way Telegram Sync
// ==============================================================================

(function () {
  if (window.__SmileXChatLoaded) return;
  window.__SmileXChatLoaded = true;

  // 1. DISCOVER SCRIPT TAG & ATTRIBUTES
  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    for (let s of scripts) {
      if (s.src && s.src.includes('widget.js')) return s;
    }
    return scripts[scripts.length - 1];
  })();

  const HUB_ORIGIN = currentScript?.src ? new URL(currentScript.src).origin : 'https://chat.smilex.vn';
  const siteId = currentScript?.getAttribute('data-site') || 'default';
  const botName = currentScript?.getAttribute('data-name') || 'SmileX Concierge';
  const primaryColor = currentScript?.getAttribute('data-color') || '#6366f1';
  const groupId = currentScript?.getAttribute('data-group') || '';
  const avatarIcon = currentScript?.getAttribute('data-avatar') || '💬';
  const welcomeText = currentScript?.getAttribute('data-welcome') || '👋 Chào bạn! Chúng tôi có thể giúp gì cho bạn hôm nay?';
  const customPrompt = currentScript?.getAttribute('data-prompt') || '';

  // 2. INJECT CSS
  const cssId = 'smilex-chat-widget-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = `${HUB_ORIGIN}/widget.css`;
    document.head.appendChild(link);
  }

  // Inject Custom Color Variable
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    :root {
      --sx-primary: ${primaryColor} !important;
      --sx-primary-glow: ${primaryColor}66 !important;
    }
  `;
  document.head.appendChild(styleEl);

  // 3. PERSISTENT SESSION
  const storageKey = `sx_chat_${siteId}`;
  let sessionId = localStorage.getItem(storageKey);
  if (!sessionId) {
    sessionId = `${siteId}_` + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
    localStorage.setItem(storageKey, sessionId);
  }

  let isChatOpen = false;
  let pollTimer = null;

  // 4. CREATE DOM ELEMENTS
  function initDOM() {
    // Launcher Button
    const launcher = document.createElement('button');
    launcher.className = 'sx-chat-launcher';
    launcher.id = 'sxChatLauncher';
    launcher.title = 'Trò chuyện trực tuyến';
    launcher.innerHTML = `
      <span>${avatarIcon}</span>
      <span class="sx-chat-pulse"></span>
    `;
    launcher.onclick = toggleChat;
    document.body.appendChild(launcher);

    // Chat Window
    const win = document.createElement('div');
    win.className = 'sx-chat-window';
    win.id = 'sxChatWindow';
    win.innerHTML = `
      <div class="sx-chat-header">
        <div class="sx-chat-header-info">
          <div class="sx-chat-avatar">${avatarIcon}</div>
          <div>
            <div class="sx-chat-title">${escapeHtml(botName)}</div>
            <div class="sx-chat-status">
              <span class="sx-status-dot"></span> Đang trực tuyến 24/7
            </div>
          </div>
        </div>
        <button class="sx-chat-close" id="sxChatClose" title="Đóng chat">✕</button>
      </div>

      <div class="sx-chat-messages" id="sxChatMessages"></div>

      <form class="sx-chat-input-area" id="sxChatForm">
        <input type="text" id="sxChatInput" class="sx-chat-input" placeholder="Nhập tin nhắn..." autocomplete="off" required>
        <button type="submit" class="sx-chat-send">➤</button>
      </form>
    `;

    document.body.appendChild(win);

    document.getElementById('sxChatClose').onclick = toggleChat;
    document.getElementById('sxChatForm').onsubmit = handleChatSubmit;
  }

  function toggleChat() {
    const win = document.getElementById('sxChatWindow');
    if (!win) return;
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
      win.classList.add('sx-open');
      loadMessages();
      startPolling();
      setTimeout(() => {
        document.getElementById('sxChatInput')?.focus();
      }, 200);
    } else {
      win.classList.remove('sx-open');
      stopPolling();
    }
  }

  function openChatWithMessage(initialMsg, guestName = '', guestPhone = '') {
    const win = document.getElementById('sxChatWindow');
    if (!win) return;
    isChatOpen = true;
    win.classList.add('sx-open');
    if (initialMsg) {
      sendChatMessage(initialMsg, guestName, guestPhone);
    } else {
      loadMessages();
    }
    startPolling();
  }

  async function loadMessages() {
    try {
      const res = await fetch(`${HUB_ORIGIN}/api/chat?action=get&siteId=${siteId}&sessionId=${sessionId}&welcome=${encodeURIComponent(welcomeText)}`);
      const data = await res.json();
      if (data.success && data.messages) {
        renderMessages(data.messages);
      }
    } catch (err) {
      console.error('SmileX Chat Load error:', err);
    }
  }

  function renderMessages(messages) {
    const container = document.getElementById('sxChatMessages');
    if (!container) return;

    container.innerHTML = messages.map(m => {
      let author = '';
      if (m.sender === 'ai') author = `🌟 ${botName}`;
      else if (m.sender === 'admin') author = '👨‍💻 Tư Vấn Viên Trực Tiếp';

      return `
        <div class="sx-msg ${m.sender}">
          ${author ? `<span class="sx-author-tag">${author}</span>` : ''}
          <div>${escapeHtml(m.text)}</div>
          <span class="sx-msg-time">${m.timestamp || ''}</span>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  }

  async function handleChatSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('sxChatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    await sendChatMessage(text);
  }

  async function sendChatMessage(text, guestName = '', guestPhone = '') {
    const container = document.getElementById('sxChatMessages');
    if (container) {
      const tempDiv = document.createElement('div');
      tempDiv.className = 'sx-msg user';
      tempDiv.innerHTML = `<div>${escapeHtml(text)}</div><span class="sx-msg-time">Đang gửi...</span>`;
      container.appendChild(tempDiv);
      container.scrollTop = container.scrollHeight;
    }

    try {
      const res = await fetch(`${HUB_ORIGIN}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          siteId,
          sessionId,
          botName,
          groupId,
          customPrompt,
          message: text,
          guestName: guestName || localStorage.getItem('sx_guest_name') || 'Khách Web',
          guestPhone: guestPhone || localStorage.getItem('sx_guest_phone') || ''
        })
      });
      const data = await res.json();
      if (data.success && data.messages) {
        renderMessages(data.messages);
      }
    } catch (err) {
      console.error('SmileX Chat Send error:', err);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadMessages, 3000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  // 5. GLOBAL SDK EXPORT & BACKWARD COMPATIBILITY
  window.SmileXChat = {
    open: () => { if (!isChatOpen) toggleChat(); },
    close: () => { if (isChatOpen) toggleChat(); },
    toggle: toggleChat,
    send: (text, name, phone) => openChatWithMessage(text, name, phone),
    getSessionId: () => sessionId
  };

  // Backwards compatibility for any website calling legacy toggleChat / quickBookPrompt
  window.toggleChat = toggleChat;
  window.openChatWithMessage = openChatWithMessage;
  window.quickBookPrompt = (text) => openChatWithMessage(text);

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDOM);
  } else {
    initDOM();
  }
})();
