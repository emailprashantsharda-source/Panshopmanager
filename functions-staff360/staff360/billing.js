/* Staff360 payments through HisaabNow's existing PayU integration (functions/payu.js).
 *
 * payu.js stays the only place that talks to PayU (one key, one salt, one webhook URL).
 * For product 'staff360' it calls:
 *   quote(data, auth)   -> who may pay, which plan, how much (from core.js PLANS only)
 *   applyPayment(...)   -> on a verified PayU success, extend staff360Entitlements/{shopId}
 *
 * Paid time is on the BUSINESS (shop or Staff360 org), not on the person who paid.
 */
'use strict';
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const C = require('./core');
const { createHandlers } = require('./handlers');

let H = null;
function handlers() {
  if (!H) {
    if (!admin.apps.length) admin.initializeApp();
    H = createHandlers({ db: admin.firestore(), HttpsError, env: process.env });
  }
  return H;
}

/* Where PayU sends the owner back to. Fixed addresses only; the client just says which one. */
function returnUrl(from, shopId, shopName) {
  const appOrigin = process.env.APP_ORIGIN || 'https://app.hisaabnow.com';
  const siteOrigin = process.env.STAFF360_SITE_ORIGIN || 'https://hisaabnow.com';
  if (from === 'app') {
    return `${appOrigin}/staff360/v2/app.html?t=${encodeURIComponent(shopId)}&n=${encodeURIComponent(shopName || '')}#/plans`;
  }
  return `${siteOrigin}/staff360/app/?t=${encodeURIComponent(shopId)}#/plans`;
}

/* -> { shopId, planId, planName, amountInr, months, productinfo, returnUrl } */
async function quote(data, auth) {
  const q = await handlers().billingQuote({ shopId: data.shopId, planId: data.planId }, auth);
  return Object.assign(q, {
    productinfo: `Staff360 ${q.planName} ${q.months === 12 ? '1 year' : q.months + ' month'}`,
    returnUrl: returnUrl(data.from === 'app' ? 'app' : 'site', q.shopId, q.shopName),
  });
}

/* Called by payu.js after the response hash has been verified.
 * Idempotent on txnid: a repeated webhook / return for a settled order does nothing. */
async function applyPayment({ db, body, order, orderRef, txnid, status }) {
  const FV = admin.firestore.FieldValue;
  const base = { txnid, uid: order.uid, shopId: order.shopId, product: 'staff360', returnUrl: order.returnUrl || null };
  if (Math.abs(parseFloat(body.amount) - parseFloat(order.amount)) > 0.01) {
    console.warn('[PayU] staff360 amount mismatch', txnid, body.amount, order.amount);
    return Object.assign(base, { ok: false, reason: 'amount_mismatch' });
  }
  const plan = C.PLANS[order.planKey];
  if (!plan || !plan.priceInr) return Object.assign(base, { ok: false, reason: 'unknown_plan' });
  const entRef = db.collection('staff360Entitlements').doc(order.shopId);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(orderRef);
    if ((fresh.data() || {}).status === 'success') return; // already applied
    if (status !== 'success') {
      tx.update(orderRef, { status: 'failed', failReason: body.error_Message || body.field9 || body.status || 'failed', processedAt: FV.serverTimestamp() });
      return;
    }
    const cur = (await tx.get(entRef)).data();
    const t = Date.now();
    const next = C.extendEntitlement(cur, order.planKey, Number(order.months) || plan.months, t);
    tx.set(entRef, {
      planId: order.planKey, status: 'active', startAt: next.startAt, endAt: next.endAt, graceUntil: next.graceUntil,
      provider: 'payu', providerRef: txnid, renewal: 'manual', updatedAt: t, updatedBy: order.uid,
    }, { merge: true });
    tx.update(orderRef, { status: 'success', mihpayid: body.mihpayid || null, mode: body.mode || null, endAt: next.endAt, processedAt: FV.serverTimestamp() });
    tx.set(db.collection('adminLogs').doc(), {
      action: 'activate_pro', product: 'staff360', uid: order.uid, shopId: order.shopId, plan: order.planKey,
      planName: 'Staff360 ' + plan.name, amount: Number(order.amount) || 0, paymentMode: 'payu', txnid, timestamp: FV.serverTimestamp(),
    });
    tx.set(db.collection(`staff360/${order.shopId}/audit`).doc(), {
      at: t, actorUid: order.uid, actorRole: 'owner', type: 'plan_paid', staffId: null, staffName: '',
      from: cur && cur.planId ? cur.planId : 'basic', to: order.planKey,
      reason: `Paid ₹${Number(order.amount).toLocaleString('en-IN')} by PayU · active till ${new Date(next.endAt).toISOString().slice(0, 10)}`,
    });
  });
  return Object.assign(base, { ok: status === 'success', status });
}

module.exports = { quote, applyPayment, returnUrl };
