// ==============================================================================
// SMILEX CHAT HUB - MASTER TELEGRAM WEBHOOK (/api/webhook)
// Routes Admin Telegram Replies to the exact Website & Customer Session
// ==============================================================================

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
    console.error('Webhook D1 Query Error:', err);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST' && req.body && req.body.update_id && typeof req.body.message === 'object') {
    const tgMsg = req.body.message;
    const threadId = tgMsg.message_thread_id;
    const text = tgMsg.text;

    if (text && !tgMsg.from?.is_bot) {
      let targetSession = null;

      // 1. Match by Topic Thread ID in hub_chat_sessions
      if (threadId) {
        const rows = await queryD1(
          'SELECT session_id, site_id FROM hub_chat_sessions WHERE thread_id = ? LIMIT 1;',
          [threadId]
        );
        if (rows && rows.length > 0) {
          targetSession = rows[0];
        }
      }

      // 2. Match in legacy web_chat_sessions if threadId exists
      if (!targetSession && threadId) {
        const legacyRows = await queryD1(
          'SELECT session_id FROM web_chat_sessions WHERE thread_id = ? LIMIT 1;',
          [threadId]
        );
        if (legacyRows && legacyRows.length > 0) {
          targetSession = { session_id: legacyRows[0].session_id, site_id: 'web' };
        }
      }

      // 3. Fallback: match most recent active session
      if (!targetSession) {
        const recent = await queryD1(
          'SELECT session_id, site_id FROM hub_chat_sessions ORDER BY updated_at DESC LIMIT 1;'
        );
        if (recent && recent.length > 0) {
          targetSession = recent[0];
        }
      }

      if (targetSession) {
        const msgId = 'admin_' + Date.now();
        const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        // Save into hub_chat_messages
        await queryD1(
          'INSERT INTO hub_chat_messages (id, session_id, site_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?);',
          [msgId, targetSession.session_id, targetSession.site_id, 'admin', text, timeStr]
        );

        // Also save to legacy web_chat_messages if site is web
        if (targetSession.site_id === 'web' || targetSession.site_id === 'web1tr') {
          await queryD1(
            'INSERT INTO web_chat_messages (id, session_id, sender, text, timestamp) VALUES (?, ?, ?, ?, ?);',
            [msgId, targetSession.session_id, 'admin', text, timeStr]
          );
        }
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true, message: 'SmileX Webhook Active' });
}
