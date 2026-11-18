/* WhatsApp + billing adapters. Both report "not configured" until the owner
 * sets real credentials — nothing is ever sent or charged by default. */
'use strict';

/* Meta WhatsApp Cloud API. Business-initiated messages need an APPROVED
 * template; set STAFF360_WA_TEMPLATE to its name (one body variable {{1}}). */
function createWhatsApp(env, fetchImpl) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const token = env.STAFF360_WA_TOKEN || '';
  const phoneId = env.STAFF360_WA_PHONE_ID || '';
  const template = env.STAFF360_WA_TEMPLATE || '';
  const lang = env.STAFF360_WA_TEMPLATE_LANG || 'en';
  const configured = () => !!(f && token && phoneId && template);
  async function send(to, text) {
    if (!configured()) return { ok: false, error: 'not_configured' };
    const r = await f(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: String(to).replace(/^\+/, ''), type: 'template',
        template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: String(text).slice(0, 1000) }] }] },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j.error && j.error.message) || `http_${r.status}` };
    return { ok: true, id: j.messages && j.messages[0] && j.messages[0].id };
  }
  return { configured, send };
}

/* Billing: HisaabNow already runs PayU (payuCreateOrder) and Play Billing
 * (verifyPlayPurchase). Their source is not in this repo, so Staff360 does
 * NOT re-implement PayU hashing here. To go live, wire your existing PayU
 * order + verified-callback code to:
 *   createOrder({shopId, uid, planId, amountInr}) -> {id, ...payload for the checkout}
 *   and on a VERIFIED success callback: handlers.activatePlan(shopId, planId, {provider:'payu', providerRef})
 * Until then createOrder answers billing_not_configured and the UI says so. */
function createBilling(env, impl) {
  return {
    configured: () => !!(impl && env.STAFF360_BILLING_ENABLED === 'true'),
    createOrder: (o) => impl.createOrder(o),
  };
}

module.exports = { createWhatsApp, createBilling };
