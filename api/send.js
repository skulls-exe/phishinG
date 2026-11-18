export default async function handler(req, res) {
    // ---- CORS / method guard ----
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars');
        return res.status(500).json({ ok: false, error: 'Server misconfigured' });
    }

    // ---- Parse body (Vercel auto-parses JSON when content-type is json) ----
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const message = typeof body.message === 'string' ? body.message : '';

    if (!message) {
        return res.status(400).json({ ok: false, error: 'Missing message' });
    }

    // Basic length cap so nobody can spam-megabyte the bot
    if (message.length > 8000) {
        return res.status(413).json({ ok: false, error: 'Message too long' });
    }

    // ---- Forward to Telegram ----
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    try {
        const tgRes = await fetch(TELEGRAM_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });

        const tgData = await tgRes.json();

        if (!tgData.ok) {
            console.warn('Telegram API error:', tgData);
            return res.status(502).json({ ok: false, error: 'Telegram rejected the message' });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Telegram send failed:', err);
        return res.status(500).json({ ok: false, error: 'Internal error' });
    }
}
  
