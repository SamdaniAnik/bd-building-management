// WhatsApp adapter (Meta WhatsApp Business Cloud API).
//
//   WHATSAPP_PROVIDER=log   (default) — nothing is sent; messages are stored as SIMULATED
//   WHATSAPP_PROVIDER=meta  — needs WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE
//
// WhatsApp only lets a business start a conversation with a pre-approved template. Create one template in
// WhatsApp Manager whose body is just "{{1}}" (category UTILITY) and put its name in WHATSAPP_TEMPLATE;
// every notification is sent through it with the SMS text as the parameter.
// Optional: WHATSAPP_TEMPLATE_LANG (default "en"), WHATSAPP_API_VERSION (default "v21.0").

function status() {
  const provider = (process.env.WHATSAPP_PROVIDER || 'log').toLowerCase();
  const missing = provider === 'meta' ? ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE'].filter(k => !process.env[k]) : [];
  return { provider, live: provider === 'meta' && missing.length === 0, missing };
}

// Template parameters may not contain new lines, tabs or more than 4 spaces in a row.
const clean = text => String(text).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000);

// msisdn: 8801XXXXXXXXX. Returns { status: SENT | SIMULATED | FAILED, response }.
async function deliver(msisdn, message) {
  const { provider, live, missing } = status();
  if (provider === 'log') return { status: 'SIMULATED', response: 'WHATSAPP_PROVIDER=log — not sent' };
  if (!live) return { status: 'FAILED', response: `WhatsApp not configured: missing ${missing.join(', ') || `unknown provider "${provider}"`}` };
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const r = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: msisdn, type: 'template',
      template: { name: process.env.WHATSAPP_TEMPLATE, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: clean(message) }] }] },
    }),
  });
  const text = await r.text();
  let ok = r.ok;
  try { ok = ok && Array.isArray(JSON.parse(text).messages); } catch { ok = false; }
  return { status: ok ? 'SENT' : 'FAILED', response: text.slice(0, 1000) };
}

module.exports = { status, deliver };
