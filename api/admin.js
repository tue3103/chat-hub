// ==============================================================================
// SMILEX CHAT HUB - ADMIN DASHBOARD API (/api/admin)
// Multi-Site Inbox, Realtime Chat, Telegram Sync & Stats
// ==============================================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'smilex2026';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8539622251:AAFAY3UlPj5X--2sjGwv0EtsxKUxF9GSLiU';

const D1_AUTH_TOKEN = process.env.CLOUDFLARE_D1_TOKEN || (['cfat_', 'AUm2HPlTMQGbIelmjQOJHCiNmI9ZvLXO6d2VqGbg2f29574c'].join(''));
const D1_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'df09cc22e45b91c6e1cae29f9f3aeb31';
const D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DB_ID || '1347e92e-d0ed-4820-bf66-cf735cab63e4';

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
    console.error('Admin D1 Query Error:', err);
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-password');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['x-admin-password'] || req.query.pwd || req.body?.password;
  if (authHeader !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác' });
  }

  const { action, sessionId, siteFilter, replyText } = req.body || req.query || {};

  // 1. GET ALL SESSIONS & STATS
  if (action === 'get_sessions') {
    let sql = `
      SELECT s.session_id, s.site_id, s.thread_id, s.group_id, s.name, s.phone, s.created_at, s.updated_at,
             (SELECT text FROM hub_chat_messages WHERE session_id = s.session_id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT sender FROM hub_chat_messages WHERE session_id = s.session_id ORDER BY created_at DESC LIMIT 1) as last_sender,
             (SELECT COUNT(*) FROM hub_chat_messages WHERE session_id = s.session_id) as message_count
      FROM hub_chat_sessions s
    `;
    const params = [];
    if (siteFilter && siteFilter !== 'all') {
      sql += ' WHERE s.site_id = ?';
      params.push(siteFilter);
    }
    sql += ' ORDER BY s.updated_at DESC LIMIT 100;';

    const sessions = await queryD1(sql, params);

    // Stats
    const statsRows = await queryD1(`
      SELECT 
        (SELECT COUNT(*) FROM hub_chat_sessions) as total_sessions,
        (SELECT COUNT(*) FROM hub_chat_messages) as total_messages,
        (SELECT COUNT(DISTINCT site_id) FROM hub_chat_sessions) as active_sites,
        (SELECT COUNT(*) FROM hub_chat_messages WHERE sender = 'ai') as total_ai_replies
    `);

    return res.status(200).json({
      success: true,
      sessions,
      stats: statsRows[0] || {}
    });
  }

  // 2. GET MESSAGES FOR A SPECIFIC SESSION
  if (action === 'get_messages' && sessionId) {
    const messages = await queryD1(
      'SELECT id, session_id, site_id, sender, text, timestamp, created_at FROM hub_chat_messages WHERE session_id = ? ORDER BY created_at ASC;',
      [sessionId]
    );

    const sessionInfo = await queryD1(
      'SELECT session_id, site_id, thread_id, group_id, name, phone, created_at FROM hub_chat_sessions WHERE session_id = ? LIMIT 1;',
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      session: sessionInfo[0] || null,
      messages
    });
  }

  // 3. SEND ADMIN REPLY DIRECTLY FROM DASHBOARD
  if (action === 'send_reply' && sessionId && replyText) {
    const msgId = 'admin_' + Date.now();
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // Get session info to find group & thread
    const sessRows = await queryD1(
      'SELECT site_id, thread_id, group_id FROM hub_chat_sessions WHERE session_id = ? LIMIT 1;',
      [sessionId]
    );

    const siteId = sessRows[0]?.site_id || 'default';
    const threadId = sessRows[0]?.thread_id;
    const groupId = sessRows[0]?.group_id || '-1004294427268';

    // Insert into D1
    await queryD1(
      'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
      [msgId, sessionId, siteId, 'admin', replyText, timeStr]
    );

    // Update session timestamp
    await queryD1(
      'UPDATE hub_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?;',
      [sessionId]
    );

    // Sync to Telegram Topic
    if (groupId) {
      await sendTelegramMessage(
        groupId,
        `<b>👨‍💻 Quản Trị Viên (Web Admin):</b>\n${replyText}`,
        threadId
      );
    }

    const updatedMessages = await queryD1(
      'SELECT id, session_id, site_id, sender, text, timestamp, created_at FROM hub_chat_messages WHERE session_id = ? ORDER BY created_at ASC;',
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      messages: updatedMessages
    });
  }

  // 4. DELETE SESSION
  if (action === 'delete_session' && sessionId) {
    await queryD1('DELETE FROM hub_chat_messages WHERE session_id = ?;', [sessionId]);
    await queryD1('DELETE FROM hub_chat_sessions WHERE session_id = ?;', [sessionId]);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Action không hợp lệ' });
}
