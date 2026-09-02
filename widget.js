// ==============================================================================
// SMILEX UNIVERSAL CHAT WIDGET SDK v2.0 (chat.smilex.vn/widget.js)
// Human-Like Cloaking • Typing Indicator • Proactive Bubble • Quick Chips • Sound
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

  // Humanized Bot Names (Strictly avoid AI/Bot terminology)
  const defaultNames = {
    'web': 'Ngọc Mai • SmileX Web',
    'web-design': 'Ngọc Mai • SmileX Web',
    'bike': 'Lễ Tân • SmileX Bike',
    'bike-rental': 'Lễ Tân • SmileX Bike',
    'default': 'Tư Vấn Viên SmileX'
  };
  const botName = currentScript?.getAttribute('data-name') || defaultNames[siteId] || defaultNames['default'];
  const primaryColor = currentScript?.getAttribute('data-color') || (siteId.includes('bike') ? '#ea580c' : '#6366f1');
  const groupId = currentScript?.getAttribute('data-group') || '';
  const avatarIcon = currentScript?.getAttribute('data-avatar') || (siteId.includes('bike') ? '🚴' : '👩‍💼');
  const welcomeText = currentScript?.getAttribute('data-welcome') || (
    siteId.includes('bike')
      ? 'Dạ em chào anh/chị! Em là lễ tân SmileX Bike Pleiku. Mình đang quan tâm thuê dòng xe nào hay cần giao tận nơi nhắn em hỗ trợ liền nha!'
      : 'Dạ em chào anh/chị! Em là Ngọc Mai, chuyên viên tư vấn SmileX. Mình đang cần làm website hay cần báo giá mẫu nào cứ nhắn em tư vấn nha!'
  );
  const customPrompt = currentScript?.getAttribute('data-prompt') || '';

  // Quick action chips by site
  const defaultChips = {
    'web': ['💰 Báo giá web 1 triệu', '⏱️ Thời gian bàn giao', '🚀 Tư vấn mẫu web', '📞 Để lại SĐT tư vấn'],
    'bike': ['🛵 Bảng giá xe', '📍 Địa chỉ & Giao xe', '📋 Quy định đặt cọc', '📞 Đặt xe ngay']
  };
  const chipsAttr = currentScript?.getAttribute('data-chips');
  const chipsList = chipsAttr ? chipsAttr.split(',').map(s => s.trim()) : (defaultChips[siteId] || ['💰 Báo giá dịch vụ', '📍 Địa chỉ & Liên hệ', '📞 Hỗ trợ trực tiếp']);

  // 2. INJECT CSS
  const cssId = 'smilex-chat-widget-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = `${HUB_ORIGIN}/widget.css?v=2.1`;
    document.head.appendChild(link);
  }

  // Inject Dynamic Theme Variables
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
  let isSending = false;
  let lastMessageCount = 0;

  // Sound Notification via Web Audio API
  function playBeep() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  // 4. CREATE DOM ELEMENTS
  function initDOM() {
    // Proactive Welcome Bubble (nhú ra sau 5s nếu khách chưa mở chat)
    const proactiveBubble = document.createElement('div');
    proactiveBubble.className = 'sx-proactive-bubble';
    proactiveBubble.id = 'sxProactiveBubble';
    proactiveBubble.innerHTML = `
      <button class="sx-proactive-close" id="sxProactiveClose" title="Đóng">✕</button>
      <div class="sx-proactive-bubble-content">
        <div class="sx-proactive-avatar">${avatarIcon}</div>
        <div class="sx-proactive-text">${escapeHtml(welcomeText.slice(0, 85))}...</div>
      </div>
    `;
    document.body.appendChild(proactiveBubble);

    proactiveBubble.onclick = (e) => {
      if (e.target.id === 'sxProactiveClose') {
        e.stopPropagation();
        hideProactiveBubble();
        sessionStorage.setItem('sx_bubble_closed', '1');
        return;
      }
      hideProactiveBubble();
      if (!isChatOpen) toggleChat();
    };

    // Launcher Button
    const launcher = document.createElement('button');
    launcher.className = 'sx-chat-launcher';
    launcher.id = 'sxChatLauncher';
    launcher.title = 'Trò chuyện cùng tư vấn viên';
    launcher.innerHTML = `
      <span>${avatarIcon}</span>
      <span class="sx-chat-pulse"></span>
      <span class="sx-unread-badge" id="sxUnreadBadge">1</span>
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
              <span class="sx-status-dot"></span> Đang trực tuyến • Trả lời ngay
            </div>
          </div>
        </div>
        <button class="sx-chat-close" id="sxChatClose" title="Thu nhỏ">✕</button>
      </div>

      <div class="sx-chat-messages" id="sxChatMessages"></div>

      <div class="sx-quick-chips" id="sxQuickChips">
        ${chipsList.map(chip => `<button type="button" class="sx-chip-btn" data-text="${escapeHtml(chip)}">${escapeHtml(chip)}</button>`).join('')}
      </div>

      <form class="sx-chat-input-area" id="sxChatForm">
        <input type="text" id="sxChatInput" class="sx-chat-input" placeholder="Nhập câu hỏi hoặc số điện thoại..." autocomplete="off" required>
        <button type="submit" class="sx-chat-send" title="Gửi">➤</button>
      </form>
    `;

    document.body.appendChild(win);

    document.getElementById('sxChatClose').onclick = toggleChat;
    document.getElementById('sxChatForm').onsubmit = handleChatSubmit;

    // Quick chips click
    win.querySelectorAll('.sx-chip-btn').forEach(btn => {
      btn.onclick = () => {
        const text = btn.getAttribute('data-text');
        if (text) sendChatMessage(text);
      };
    });

    // Schedule Proactive Bubble after 5s
    if (!sessionStorage.getItem('sx_bubble_closed') && !isChatOpen) {
      setTimeout(() => {
        if (!isChatOpen && !sessionStorage.getItem('sx_bubble_closed')) {
          proactiveBubble.classList.add('sx-show');
          playBeep();
        }
      }, 5000);
    }

    // Auto-Resume State if user previously had chat open
    const savedState = localStorage.getItem(`sx_chat_open_${siteId}`);
    if (savedState === '1') {
      toggleChat(false); // open without toggle sound
    } else {
      // Pre-fetch messages in background
      loadMessages(false);
    }
  }

  function hideProactiveBubble() {
    const bubble = document.getElementById('sxProactiveBubble');
    if (bubble) bubble.classList.remove('sx-show');
  }

  function toggleChat(playNotice = true) {
    const win = document.getElementById('sxChatWindow');
    if (!win) return;
    isChatOpen = !isChatOpen;
    localStorage.setItem(`sx_chat_open_${siteId}`, isChatOpen ? '1' : '0');

    if (isChatOpen) {
      hideProactiveBubble();
      document.getElementById('sxUnreadBadge')?.classList.remove('sx-show');
      win.classList.add('sx-open');
      loadMessages(true);
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
    localStorage.setItem(`sx_chat_open_${siteId}`, '1');
    hideProactiveBubble();
    win.classList.add('sx-open');
    if (initialMsg) {
      sendChatMessage(initialMsg, guestName, guestPhone);
    } else {
      loadMessages(true);
    }
    startPolling();
  }

  async function loadMessages(shouldScroll = true) {
    try {
      const res = await fetch(`${HUB_ORIGIN}/api/chat?action=get&siteId=${siteId}&sessionId=${sessionId}&welcome=${encodeURIComponent(welcomeText)}`);
      const data = await res.json();
      if (data.success && data.messages) {
        if (data.messages.length > lastMessageCount && lastMessageCount > 0 && !isChatOpen) {
          // New message received while closed -> show unread badge & beep
          document.getElementById('sxUnreadBadge')?.classList.add('sx-show');
          playBeep();
        }
        lastMessageCount = data.messages.length;
        renderMessages(data.messages, shouldScroll);
      }
    } catch (err) {
      console.error('SmileX Chat Load error:', err);
    }
  }

  function renderMessages(messages, shouldScroll = true) {
    const container = document.getElementById('sxChatMessages');
    if (!container) return;

    // Remove typing indicator if we got new responses
    const typingIndicator = isSending ? `
      <div class="sx-typing-indicator" id="sxTypingIndicator">
        <span>Đang soạn tin</span>
        <span class="sx-typing-dots"><span class="sx-dot"></span><span class="sx-dot"></span><span class="sx-dot"></span></span>
      </div>
    ` : '';

    container.innerHTML = messages.map(m => {
      let author = '';
      if (m.sender === 'ai') author = `👤 ${botName}`;
      else if (m.sender === 'admin') author = '👨‍💻 Quản Trị Viên';

      return `
        <div class="sx-msg ${m.sender}">
          ${author ? `<span class="sx-author-tag">${author}</span>` : ''}
          <div>${escapeHtml(m.text)}</div>
          <span class="sx-msg-time">${m.timestamp || ''}</span>
        </div>
      `;
    }).join('') + typingIndicator;

    if (shouldScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  async function handleChatSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('sxChatInput');
    const text = input.value.trim();
    if (!text || isSending) return;

    input.value = '';
    await sendChatMessage(text);
  }

  async function sendChatMessage(text, guestName = '', guestPhone = '') {
    const container = document.getElementById('sxChatMessages');
    isSending = true;

    // Immediately render user message + Typing Indicator
    if (container) {
      const userDiv = document.createElement('div');
      userDiv.className = 'sx-msg user';
      userDiv.innerHTML = `<div>${escapeHtml(text)}</div><span class="sx-msg-time">Đang gửi...</span>`;
      container.appendChild(userDiv);

      const typingDiv = document.createElement('div');
      typingDiv.className = 'sx-typing-indicator';
      typingDiv.id = 'sxTypingIndicator';
      typingDiv.innerHTML = `
        <span>Đang soạn tin</span>
        <span class="sx-typing-dots"><span class="sx-dot"></span><span class="sx-dot"></span><span class="sx-dot"></span></span>
      `;
      container.appendChild(typingDiv);
      container.scrollTop = container.scrollHeight;
    }

    try {
      // Gather customer context (Current page URL, device)
      const currentUrl = window.location.href;
      const userAgent = navigator.userAgent;

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
          currentUrl,
          userAgent,
          guestName: guestName || localStorage.getItem('sx_guest_name') || 'Khách Web',
          guestPhone: guestPhone || localStorage.getItem('sx_guest_phone') || ''
        })
      });

      const data = await res.json();
      isSending = false;
      if (data.success && data.messages) {
        lastMessageCount = data.messages.length;
        renderMessages(data.messages, true);
        playBeep();
      }
    } catch (err) {
      isSending = false;
      console.error('SmileX Chat Send error:', err);
      const typingEl = document.getElementById('sxTypingIndicator');
      if (typingEl) typingEl.remove();
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => loadMessages(false), 3500);
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

  // Aliases so existing sites seamlessly work without rewriting code:
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
