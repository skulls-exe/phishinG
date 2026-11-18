// api/send-photo.js
// Receives multipart/form-data with a photo + caption from the browser
// and forwards it to Telegram's sendPhoto endpoint.
//
// Uses raw body streaming so we can pass the multipart form through
// without buffering the whole image into memory twice.

export const config = {
    api: {
        bodyParser: false
    }
};

// Minimal multipart parser — avoids extra deps.
// Returns { fields: {name:value}, files: [{name, filename, contentType, data:Buffer}] }
async function parseMultipart(req) {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(.+)$/);
    if (!match) throw new Error('Missing multipart boundary');
    const boundary = '--' + match[1];

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const boundaryBuf = Buffer.from(boundary);
    const parts = [];
    let start = buffer.indexOf(boundaryBuf);
    if (start === -1) throw new Error('Boundary not found');

    start += boundaryBuf.length;

    while (true) {
        // Each part starts after boundary + CRLF
        if (buffer.slice(start, start + 2).toString() === '--') break; // final boundary
        start += 2; // skip CRLF

        const end = buffer.indexOf(boundaryBuf, start);
        if (end === -1) break;

        const part = buffer.slice(start, end - 2); // strip trailing CRLF
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) { start = end; continue; }

        const headerText = part.slice(0, headerEnd).toString();
        const body = part.slice(headerEnd + 4);

        const nameMatch = headerText.match(/name="([^"]+)"/);
        const filenameMatch = headerText.match(/filename="([^"]+)"/);
        const ctMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

        if (filenameMatch) {
            parts.push({
                name: nameMatch ? nameMatch[1] : 'file',
                filename: filenameMatch[1],
                contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
                data: body
            });
        } else if (nameMatch) {
            parts.push({
                name: nameMatch[1],
                value: body.toString('utf8')
            });
        }

        start = end + boundaryBuf.length;
    }

    const fields = {};
    const files = [];
    for (const p of parts) {
        if (p.filename !== undefined) files.push(p);
        else fields[p.name] = p.value;
    }
    return { fields, files };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
        return res.status(500).json({ ok: false, error: 'Server misconfigured' });
    }

    let parsed;
    try {
        parsed = await parseMultipart(req);
    } catch (err) {
        console.error('Multipart parse failed:', err);
        return res.status(400).json({ ok: false, error: 'Invalid form data' });
    }

    const { fields, files } = parsed;
    const caption = typeof fields.caption === 'string' ? fields.caption : '';
    const photo = files.find(f => f.name === 'photo');

    if (!photo) {
        return res.status(400).json({ ok: false, error: 'Missing photo' });
    }
    if (photo.data.length > 9 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Photo too large' });
    }

    // ---- Build outgoing FormData for Telegram ----
    const tgForm = new FormData();
    tgForm.append('chat_id', CHAT_ID);
    tgForm.append('caption', caption.slice(0, 1024)); // Telegram caption limit
    tgForm.append('parse_mode', 'HTML');
    tgForm.append(
        'photo',
        new Blob([photo.data], { type: photo.contentType || 'image/jpeg' }),
        photo.filename || 'selfie.jpg'
    );

    try {
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: tgForm
        });
        const tgData = await tgRes.json();
        if (!tgData.ok) {
            console.warn('Telegram error:', tgData);
            return res.status(502).json({ ok: false, error: 'Telegram rejected the photo' });
        }
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Telegram photo send failed:', err);
        return res.status(500).json({ ok: false, error: 'Internal error' });
    }
}
  
