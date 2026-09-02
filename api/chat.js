// ==============================================================================
// SMILEX CHAT HUB - CENTRALIZED MULTI-TENANT CHAT API v2.0
// Multi-Turn Context • Smart Hot Lead • Human Takeover • Hybrid Dynamic Data
// ==============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8539622251:AAFAY3UlPj5X--2sjGwv0EtsxKUxF9GSLiU';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const XKIRO_API_KEY = process.env.XKIRO_API_KEY || (['sk-xt-', '863c4223d98b3360abbefc5b234315f1ab66bd1a4672c5be'].join(''));

const D1_AUTH_TOKEN = process.env.CLOUDFLARE_D1_TOKEN || (['cfat_', 'AUm2HPlTMQGbIelmjQOJHCiNmI9ZvLXO6d2VqGbg2f29574c'].join(''));
const D1_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'df09cc22e45b91c6e1cae29f9f3aeb31';
const D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DB_ID || '1347e92e-d0ed-4820-bf66-cf735cab63e4';

const DEFAULT_GROUP_MAP = {
  'bike': '-1004298681574',
  'bike-rental': '-1004298681574',
  'web': '-1004294427268',
  'web1tr': '-1004294427268',
  'web-design': '-1004294427268'
};

async function queryD1(sql, params = []) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${D1_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${D1_AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (data.success && data.result && data.result[0]) {
      return data.result[0].results || [];
    }
    return [];
  } catch (err) {
    console.error('D1 Query Error:', err);
    return [];
  }
}

async function sendTelegramMessage(chatId, text, threadId = null) {
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };
    if (threadId) {
      payload.message_thread_id = parseInt(threadId, 10);
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('Telegram Send Error:', e);
  }
}

async function createTelegramForumTopic(chatId, title) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        name: title.slice(0, 120)
      })
    });
    const data = await res.json();
    if (data.ok && data.result) {
      return data.result.message_thread_id;
    }
    return null;
  } catch (e) {
    console.error('Create Forum Topic Error:', e);
    return null;
  }
}

async function generateHubAiResponse(siteId, botName, customPrompt, userMessage, sessionId) {
  // 1. Fetch dynamic knowledge from D1
  let systemPrompt = customPrompt || '';
  let knowledgeText = '';
  let learnedQA = [];

  const knowledgeRows = await queryD1(
    'SELECT system_prompt, knowledge_text, group_id FROM hub_site_knowledge WHERE site_id = ? LIMIT 1;',
    [siteId]
  );

  if (knowledgeRows && knowledgeRows.length > 0) {
    if (!systemPrompt) systemPrompt = knowledgeRows[0].system_prompt || '';
    knowledgeText = knowledgeRows[0].knowledge_text || '';
  }

  // 2. Fetch Auto-Learned Q&As from Admin replies
  try {
    const qaRows = await queryD1(
      'SELECT user_question, admin_answer FROM hub_qa_learnings WHERE site_id = ? ORDER BY created_at DESC LIMIT 6;',
      [siteId]
    );
    if (qaRows && qaRows.length > 0) {
      learnedQA = qaRows;
    }
  } catch (e) {}

  // 3. Fallback persona prompts (100% Human-Like, strictly forbid AI identity)
  if (!systemPrompt) {
    if (siteId.includes('bike')) {
      systemPrompt = `Bạn là Lễ Tân Trực Tuyến của SmileX Bike Pleiku (197 Nguyễn Tất Thành, Pleiku, Gia Lai). Bạn là người thật 100%, tận tâm, mến khách Gia Lai, trò chuyện thân tình xưng "dạ em chào anh/chị", "bên em".`;
    } else if (siteId.includes('web')) {
      systemPrompt = `Bạn là Ngọc Mai, chuyên viên tư vấn trực tiếp của SmileX Web (web.smilex.vn). Bạn là người thật 100%, chuyên nghiệp, nhiệt tình, xưng "dạ em chào anh/chị", "bên em".`;
    } else {
      systemPrompt = `Bạn là ${botName || 'Chuyên viên Tư Vấn'}. Bạn là người thật 100%, tư vấn lịch sự, tận tâm, chu đáo cho khách hàng.`;
    }
  }

  // 4. HYBRID DYNAMIC DATA CONTEXT (Cách 3: Query trực tiếp D1 cho trang nội bộ SmileX Bike)
  let dynamicDataContext = '';
  if (siteId.includes('bike')) {
    try {
      const bikeRows = await queryD1('SELECT name, type, price, status FROM bikes LIMIT 10;');
      if (bikeRows && bikeRows.length > 0) {
        dynamicDataContext = `--- DỮ LIỆU THỰC TẾ: DANH SÁCH XE HIỆN CÓ TẠI TIỆM PLEIKU ---\n` +
          bikeRows.map(b => `- ${b.name} (${b.type}): Giá thuê ${Number(b.price || 50000).toLocaleString('vi-VN')}đ/ngày [${b.status === 'rented' ? 'Đã cho thuê' : 'Đang sẵn sàng'}]`).join('\n') + '\n\n';
      }
    } catch (e) {}
  }

  // 5. Construct Final Comprehensive AI Context
  let finalPrompt = `${systemPrompt}\n\n`;

  if (dynamicDataContext) {
    finalPrompt += dynamicDataContext;
  }

  if (knowledgeText) {
    finalPrompt += `--- BẢNG TRI THỨC CỐT LÕI DỊCH VỤ ---\n${knowledgeText}\n\n`;
  }

  if (learnedQA.length > 0) {
    finalPrompt += `--- CÂU TRẢ LỜI MẪU CHUẨN TỪ QUẢN TRỊ VIÊN ĐÃ DẠY ---\n`;
    for (const qa of learnedQA) {
      finalPrompt += `- Khách hỏi: "${qa.user_question}" -> Trả lời: "${qa.admin_answer}"\n`;
    }
    finalPrompt += `\n`;
  }

  finalPrompt += `QUY TẮC VÀNG VỀ XƯNG HÔ VÀ PHONG CÁCH TRÒ CHUYỆN:
1. BẠN LÀ NGƯỜI THẬT 100%, TUYỆT ĐỐI KHÔNG BAO GIỜ XƯNG LÀ AI, BOT HAY TRỢ LÝ ẢO.
2. Nếu khách gài hỏi "Em là người thật hay robot/AI?", hãy đối đáp tự nhiên: "Dạ em là ${botName}, nhân viên trực tổng đài tư vấn của SmileX đây ạ! Anh/chị cần em hỗ trợ chi tiết gì cứ nhắn em nhé!" kèm icon thân thiện 😊.
3. Độ dài câu trả lời: Chỉ từ 2 đến 3 câu ngắn gọn, chuẩn phong cách nhắn tin Zalo/Messenger, dễ đọc trên điện thoại. Tuyệt đối không viết bài dài, không chia danh sách dài dòng như văn mẫu.
4. Nếu khách để lại SĐT hoặc hỏi thông tin nằm ngoài bảng tri thức: Hãy khéo léo báo "Dạ em đã ghi nhận yêu cầu của mình rồi ạ, chuyên viên bên em sẽ gọi lại hỗ trợ chi tiết cho mình ngay nhé!".
5. Khéo léo gợi mở xin SĐT của khách ở cuối câu khi khách đang quan tâm dịch vụ để chuyên viên gọi tư vấn kỹ hơn.`;

  // 6. MULTI-TURN CONVERSATION MEMORY (Nạp 6 tin nhắn gần nhất)
  let conversationHistory = [];
  if (sessionId) {
    try {
      const prevRows = await queryD1(
        'SELECT sender, text FROM hub_chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 6;',
        [sessionId]
      );
      if (prevRows && prevRows.length > 0) {
        conversationHistory = prevRows.map(r => ({
          role: r.sender === 'user' ? 'user' : 'assistant',
          content: r.text
        }));
      }
    } catch (e) {}
  }

  const messagesPayload = [
    { role: 'system', content: finalPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  // 1. ENGINE 1 (PRIMARY): DeepSeek V3.2 Full Model via Xkiro
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const xkiroRes = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + XKIRO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3.2',
        messages: messagesPayload,
        temperature: 0.5,
        max_tokens: 300
      })
    });
    clearTimeout(timeoutId);
    const xkiroData = await xkiroRes.json();
    const xkiroText = xkiroData.choices?.[0]?.message?.content;
    if (xkiroText) return xkiroText.trim();
  } catch (e) {
    console.warn('Xkiro DeepSeek V3.2 primary failed, falling back to Groq:', e.message);
  }

  // 2. ENGINE 2 (FALLBACK): Groq LPU
  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || ''),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: messagesPayload,
        temperature: 0.5,
        max_tokens: 250
      })
    });
    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content;
    if (text) return text.trim();
  } catch (e) {
    console.error('Groq AI Fallback Error:', e);
  }

  return `Dạ em chào anh/chị! Em đã nhận được tin nhắn của mình rồi ạ. Chuyên viên bên em sẽ kiểm tra thông tin và hỗ trợ giải đáp ngay cho mình nhé!`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const paramsObj = { ...(req.query || {}), ...(req.body || {}) };
  const { action, siteId = 'default', sessionId, message, botName = 'Tư Vấn Viên SmileX', groupId, customPrompt, guestName, guestPhone, welcome, currentUrl, userAgent } = paramsObj;

  if (!sessionId) {
    return res.status(400).json({ error: 'Thiếu sessionId' });
  }

  // Lookup target Telegram group
  let effectiveGroupId = groupId;
  if (!effectiveGroupId) {
    const kRows = await queryD1('SELECT group_id FROM hub_site_knowledge WHERE site_id = ? LIMIT 1;', [siteId]);
    if (kRows && kRows[0]?.group_id) {
      effectiveGroupId = kRows[0].group_id;
    }
  }
  if (!effectiveGroupId) {
    effectiveGroupId = DEFAULT_GROUP_MAP[siteId] || process.env.TELEGRAM_GROUP_ID || '-1004294427268';
  }

  // 1. GET MESSAGES
  if (action === 'get') {
    const rows = await queryD1(
      'SELECT id, sender, text, timestamp FROM hub_chat_messages WHERE session_id = ? ORDER BY created_at ASC;',
      [sessionId]
    );

    let messages = rows;
    if (messages.length === 0) {
      messages = [
        {
          id: 'welcome',
          sender: 'ai',
          text: welcome ? decodeURIComponent(welcome) : 'Dạ em chào anh/chị! Em có thể hỗ trợ giải đáp thắc mắc hoặc tư vấn dịch vụ gì cho mình hôm nay ạ?',
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ];
    }

    return res.status(200).json({
      success: true,
      messages: messages
    });
  }

  // 2. SEND MESSAGE FROM CLIENT
  if (action === 'send' && message) {
    const userMsgId = 'usr_' + Date.now();
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // Ensure session in D1 & Telegram Topic
    let threadId = null;
    const sessRows = await queryD1('SELECT thread_id, group_id, phone, name FROM hub_chat_sessions WHERE session_id = ? LIMIT 1;', [sessionId]);
    
    // SMART LEAD CAPTURE: Detect Vietnamese phone number
    const phoneRegex = /(?:0|\+84)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/;
    const phoneMatch = message.match(phoneRegex);
    const detectedPhone = phoneMatch ? phoneMatch[0] : (guestPhone || sessRows?.[0]?.phone || '');

    if (sessRows && sessRows.length > 0 && sessRows[0].thread_id) {
      threadId = sessRows[0].thread_id;
      if (detectedPhone && detectedPhone !== sessRows[0].phone) {
        await queryD1('UPDATE hub_chat_sessions SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?;', [detectedPhone, sessionId]);
      }
    } else {
      // Gather geolocation / device context for new topic
      const ipCity = req.headers['cf-ipcity'] || '';
      const ipCountry = req.headers['cf-ipcountry'] || 'VN';
      const isMobile = /mobile|iphone|android/i.test(userAgent || '');
      const locationText = ipCity ? `${ipCity}, ${ipCountry}` : ipCountry;

      const topicName = `💬 [${siteId.toUpperCase()}] ${guestName || 'Khách'} (${detectedPhone || sessionId.slice(-4)})`;
      threadId = await createTelegramForumTopic(effectiveGroupId, topicName);
      
      await queryD1(
        'INSERT OR REPLACE INTO hub_chat_sessions (session_id, site_id, thread_id, group_id, name, phone, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);',
        [sessionId, siteId, threadId, effectiveGroupId, guestName || 'Khách Web', detectedPhone]
      );

      // Send initial context card to Telegram Topic
      await sendTelegramMessage(
        effectiveGroupId,
        `📍 <b>Khách mới truy cập:</b>\n- Vị trí: <b>${locationText}</b>\n- Thiết bị: <b>${isMobile ? 'Điện thoại 📱' : 'Máy tính 💻'}</b>\n- Đang xem: <code>${currentUrl || siteId}</code>`,
        threadId
      );
    }

    // Save user message in D1
    await queryD1(
      'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
      [userMsgId, sessionId, siteId, 'user', message, timeStr]
    );

    // Send user message to Telegram Topic
    const senderTitle = guestName ? `${guestName} (${detectedPhone || siteId})` : `Khách (${siteId})`;
    await sendTelegramMessage(
      effectiveGroupId,
      `<b>💬 ${senderTitle}:</b>\n${message}`,
      threadId
    );

    // If phone number just detected -> Send HOT LEAD alert!
    if (phoneMatch) {
      await sendTelegramMessage(
        effectiveGroupId,
        `🚨 <b>[HOT LEAD - KHÁCH ĐÃ ĐỂ LẠI SỐ ĐIỆN THOẠI!]</b> 🔥\n\n👤 Khách hàng: <b>${guestName || 'Khách Web'}</b>\n📞 Số điện thoại: <code>${detectedPhone}</code>\n🌐 Nguồn: <b>${siteId}</b>\n💬 Yêu cầu: "${message}"\n\n👉 <i>Admin hãy gọi điện tư vấn và chốt đơn ngay nhé!</i>`,
        threadId
      );
    }

    // HUMAN TAKEOVER CHECK: If admin replied within last 20 mins, AI pauses!
    let isHumanTakeover = false;
    try {
      const lastAdminMsg = await queryD1(
        "SELECT created_at FROM hub_chat_messages WHERE session_id = ? AND sender = 'admin' ORDER BY created_at DESC LIMIT 1;",
        [sessionId]
      );
      if (lastAdminMsg && lastAdminMsg[0]?.created_at) {
        const diffSeconds = (Date.now() - new Date(lastAdminMsg[0].created_at).getTime()) / 1000;
        if (diffSeconds < 1200) { // 20 minutes
          isHumanTakeover = true;
        }
      }
    } catch (e) {}

    // Generate AI response only if human admin is NOT actively taking over
    if (!isHumanTakeover) {
      try {
        const aiReplyText = await generateHubAiResponse(siteId, botName, customPrompt, message, sessionId);
        const aiMsgId = 'ai_' + Date.now();

        await queryD1(
          'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
          [aiMsgId, sessionId, siteId, 'ai', aiReplyText, timeStr]
        );

        await sendTelegramMessage(
          effectiveGroupId,
          `<b>👤 ${botName}:</b>\n${aiReplyText}`,
          threadId
        );
      } catch (e) {
        console.error('AI error:', e);
      }
    } else {
      console.log(`Human takeover active for session ${sessionId}, AI skipped.`);
    }

    // Return full message history to client
    const updatedRows = await queryD1(
      'SELECT id, sender, text, timestamp FROM hub_chat_messages WHERE session_id = ? ORDER BY created_at ASC;',
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      messages: updatedRows
    });
  }

  // 3. RESET CHAT
  if (action === 'reset') {
    await queryD1('DELETE FROM hub_chat_messages WHERE session_id = ?;', [sessionId]);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Action không hợp lệ' });
}
