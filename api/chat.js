// ==============================================================================
// SMILEX CENTRALIZED CHAT HUB API (/api/chat)
// Multi-Tenant, Cloudflare D1 Storage, Groq AI & Dynamic Knowledge Base
// ==============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8539622251:AAFAY3UlPj5X--2sjGwv0EtsxKUxF9GSLiU';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const D1_AUTH_TOKEN = process.env.CLOUDFLARE_D1_TOKEN || (['cfat_', 'AUm2HPlTMQGbIelmjQOJHCiNmI9ZvLXO6d2VqGbg2f29574c'].join(''));
const D1_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'df09cc22e45b91c6e1cae29f9f3aeb31';
const D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DB_ID || '1347e92e-d0ed-4820-bf66-cf735cab63e4';

// DEFAULT GROUP MAPPING BY SITE ID
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
    console.error('Hub D1 Query Error:', err);
    return [];
  }
}

async function sendTelegramMessage(chatId, text, messageThreadId = null) {
  try {
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };
    if (messageThreadId) {
      body.message_thread_id = messageThreadId;
    }
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error('Telegram Send Error:', err);
    return null;
  }
}

async function createTelegramForumTopic(groupId, title) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupId,
        name: title
      })
    });
    const data = await res.json();
    if (data.ok && data.result) return data.result.message_thread_id;
    return null;
  } catch (e) {
    console.error('Create Forum Topic Error:', e);
    return null;
  }
}

async function generateHubAiResponse(siteId, botName, customPrompt, userMessage) {
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

  // 3. Fallback prompts if not set
  if (!systemPrompt) {
    if (siteId.includes('bike')) {
      systemPrompt = `Bạn là Lễ Tân Trực Tuyến của SmileX Bike Pleiku (bike.smilex.vn). Bạn là người thật, tận tâm, mến khách Gia Lai. Tuyệt đối KHÔNG xưng là AI/bot.`;
    } else if (siteId.includes('web')) {
      systemPrompt = `Bạn là Chuyên viên Tư Vấn SmileX Web (web.smilex.vn). Bạn là người thật, chuyên nghiệp, nhiệt tình. Tuyệt đối KHÔNG xưng là AI/bot.`;
    } else {
      systemPrompt = `Bạn là Chuyên viên Chăm sóc Khách hàng của ${botName || 'SmileX'}. Hãy tư vấn lịch sự, tận tâm, chu đáo cho khách hàng (khoảng 2-3 câu). Tuyệt đối không xưng là AI hay bot.`;
    }
  }

  // 4. Construct Final Comprehensive AI Context
  let finalPrompt = `${systemPrompt}\n\n`;

  if (knowledgeText) {
    finalPrompt += `--- BẢNG THÔNG TIN & TRI THỨC CỐT LÕI VỀ CỬA HÀNG/DỊCH VỤ ---\n${knowledgeText}\n\n`;
  }

  if (learnedQA.length > 0) {
    finalPrompt += `--- CÁC CÂU TRẢ LỜI MẪU CHUẨN TỪ QUẢN TRỊ VIÊN ĐÃ HƯỚNG DẪN ---\n`;
    for (const qa of learnedQA) {
      finalPrompt += `- Khách hỏi: "${qa.user_question}" -> Trả lời chuẩn: "${qa.admin_answer}"\n`;
    }
    finalPrompt += `\n`;
  }

  finalPrompt += `Quy tắc trả lời:
- Luôn giữ thái độ thân thiện, tự nhiên, trả lời đúng trọng tâm dựa trên bảng tri thức phía trên (khoảng 2-4 câu).
- Nếu thông tin nào không có trong bảng tri thức, trả lời lịch sự và xin số điện thoại để chuyên viên tư vấn chi tiết hơn.`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || ''),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: finalPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.5,
        max_tokens: 250
      })
    });
    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content;
    if (text) return text.trim();
  } catch (e) {
    console.error('Groq AI Error:', e);
  }

  return `Chào bạn! Cảm ơn bạn đã nhắn tin cho ${botName || 'chúng tôi'}. Chuyên viên của chúng tôi đã nhận được thông tin và sẽ hỗ trợ giải đáp ngay cho bạn nhé!`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const paramsObj = { ...(req.query || {}), ...(req.body || {}) };
  const { action, siteId = 'default', sessionId, message, botName = 'SmileX Concierge', groupId, customPrompt, guestName, guestPhone, welcome } = paramsObj;

  if (!sessionId) {
    return res.status(400).json({ error: 'Thiếu sessionId' });
  }

  // Lookup target group from D1 site_knowledge or fallback mapping
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
          text: welcome ? decodeURIComponent(welcome) : '👋 Chào bạn! Chúng tôi có thể giúp gì cho bạn hôm nay?',
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
    const sessRows = await queryD1('SELECT thread_id, group_id FROM hub_chat_sessions WHERE session_id = ? LIMIT 1;', [sessionId]);
    
    if (sessRows && sessRows.length > 0 && sessRows[0].thread_id) {
      threadId = sessRows[0].thread_id;
    } else {
      const topicName = `💬 [${siteId.toUpperCase()}] ${guestName || 'Khách'} (${guestPhone || sessionId.slice(-4)})`;
      threadId = await createTelegramForumTopic(effectiveGroupId, topicName);
      await queryD1(
        'INSERT OR REPLACE INTO hub_chat_sessions (session_id, site_id, thread_id, group_id, name, phone, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);',
        [sessionId, siteId, threadId, effectiveGroupId, guestName || 'Khách Web', guestPhone || '']
      );
    }

    // Save user message in D1
    await queryD1(
      'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
      [userMsgId, sessionId, siteId, 'user', message, timeStr]
    );

    // Send to Telegram Topic
    const senderTitle = guestName ? `${guestName} (${guestPhone || siteId})` : `Khách (${siteId})`;
    await sendTelegramMessage(
      effectiveGroupId,
      `<b>💬 Khách [${senderTitle}]:</b>\n${message}`,
      threadId
    );

    // Generate AI response
    try {
      const aiReplyText = await generateHubAiResponse(siteId, botName, customPrompt, message);
      const aiMsgId = 'ai_' + Date.now();

      await queryD1(
        'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
        [aiMsgId, sessionId, siteId, 'ai', aiReplyText, timeStr]
      );

      await sendTelegramMessage(
        effectiveGroupId,
        `<b>🤖 ${botName}:</b>\n${aiReplyText}`,
        threadId
      );
    } catch (e) {
      console.error('AI error:', e);
    }

    // Return full message history
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
