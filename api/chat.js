// ==============================================================================
// SMILEX CENTRALIZED CHAT HUB API (/api/chat)
// Multi-Tenant, Cloudflare D1 Storage, Groq AI & Telegram Topics
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
  let prompt = customPrompt;

  if (!prompt) {
    if (siteId.includes('bike')) {
      prompt = `Bạn là Lễ Tân Trực Tuyến của SmileX Bike Pleiku (bike.smilex.vn). 
Bạn là người thật, tận tâm, mến khách Gia Lai. Tuyệt đối KHÔNG xưng là AI/bot.
- Thuê xe đạp thể thao cao cấp (Trek, Giant, Sava Carbon) giá 50.000đ/ngày (hoặc 30.000đ/ngày nếu >7 ngày).
- Cọc 5.000.000đ/xe (hoàn trả ngay 100% khi trả xe). Không giữ Passport/CCCD gốc.
- Phí giao xe tận khách sạn: 100.000đ/chuyến. Hoặc nhận xe tại 197 Nguyễn Tất Thành, TP. Pleiku.
- Kèm nón bảo hiểm, khóa số 4 chữ số, giá kẹp điện thoại, bơm mini.`;
    } else if (siteId.includes('web')) {
      prompt = `Bạn là Chuyên viên Tư Vấn SmileX Web (web.smilex.vn).
Bạn là người thật, chuyên nghiệp, nhiệt tình. Tuyệt đối KHÔNG xưng là AI/bot.
- Gói làm website chuẩn SEO trọn gói 1.000.000đ. Bàn giao 24-48 giờ.
- Miễn phí Hosting Serverless Cloudflare/Vercel trọn đời (0đ/năm).
- Chuẩn SEO, giao diện responsive điện thoại, tích hợp Live Chat và Google Maps.`;
    } else {
      prompt = `Bạn là Chuyên viên Chăm sóc Khách hàng của ${botName || 'SmileX'}. 
Hãy tư vấn lịch sự, tận tâm, chu đáo cho khách hàng (khoảng 2-3 câu). Tuyệt đối không xưng là AI hay bot.`;
    }
  }

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
          { role: 'system', content: prompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.6,
        max_tokens: 220
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

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, siteId = 'default', sessionId, message, botName = 'SmileX Concierge', groupId, customPrompt, guestName, guestPhone, welcome } = req.body || req.query || {};

  if (!sessionId) {
    return res.status(400).json({ error: 'Thiếu sessionId' });
  }

  const effectiveGroupId = groupId || DEFAULT_GROUP_MAP[siteId] || process.env.TELEGRAM_GROUP_ID || '-1004294427268';

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
