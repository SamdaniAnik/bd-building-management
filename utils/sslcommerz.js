// SSLCommerz payment gateway (covers bKash, Nagad, Rocket, Upay and cards in one checkout).
// Env: SSLCZ_STORE_ID, SSLCZ_STORE_PASSWD, SSLCZ_SANDBOX=true|false, PUBLIC_API_URL, FRONTEND_URL.
// Local testing without a merchant account: PAYMENT_MOCK=true (ignored when NODE_ENV=production).

const sandbox = () => String(process.env.SSLCZ_SANDBOX ?? 'true') !== 'false';
const base = () => (sandbox() ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com');

function gatewayMode() {
  if (process.env.SSLCZ_STORE_ID && process.env.SSLCZ_STORE_PASSWD) return 'SSLCOMMERZ';
  if (String(process.env.PAYMENT_MOCK) === 'true' && process.env.NODE_ENV !== 'production') return 'MOCK';
  return null;
}

const publicApiUrl = () => (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT && process.env.PORT !== '5000' ? process.env.PORT : 5050}`).replace(/\/$/, '');
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

async function initSession({ tran_id, amount, product_name, customer }) {
  const cb = `${publicApiUrl()}/api/pay/sslcommerz`;
  const body = new URLSearchParams({
    store_id: process.env.SSLCZ_STORE_ID,
    store_passwd: process.env.SSLCZ_STORE_PASSWD,
    total_amount: Number(amount).toFixed(2),
    currency: 'BDT',
    tran_id,
    success_url: `${cb}/success`,
    fail_url: `${cb}/fail`,
    cancel_url: `${cb}/cancel`,
    ipn_url: `${cb}/ipn`,
    shipping_method: 'NO',
    num_of_item: '1',
    product_name: product_name.slice(0, 255),
    product_category: 'Real Estate',
    product_profile: 'non-physical-goods',
    cus_name: customer.name || 'Flat Owner',
    cus_email: customer.email || 'noemail@example.com',
    cus_add1: customer.address || 'Dhaka',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: customer.phone || '01700000000',
  });
  const r = await fetch(`${base()}/gwprocess/v4/api.php`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== 'SUCCESS' || !j.GatewayPageURL) throw new Error(`SSLCommerz init failed: ${j.failedreason || j.status || r.status}`);
  return { url: j.GatewayPageURL, session_key: j.sessionkey };
}

// Server-to-server validation — never trust the browser POST on its own.
async function validate(val_id) {
  const url = new URL(`${base()}/validator/api/validationserverAPI.php`);
  url.search = new URLSearchParams({ val_id, store_id: process.env.SSLCZ_STORE_ID, store_passwd: process.env.SSLCZ_STORE_PASSWD, format: 'json' }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  return r.json();
}

module.exports = { gatewayMode, initSession, validate, publicApiUrl, frontendUrl, sandbox };
