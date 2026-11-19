'use strict';
/* HisaabNow functions/payu.js with the Staff360 branch, run against a fake Firestore.
 * firebase-functions / firebase-admin are stubbed so the real payu.js + staff360/billing.js run. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { createFake } = require('./fakeFirestore');

const KEY = 'TESTKEY', SALT = 'TESTSALT';
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const db = createFake();
const stubs = {
  'firebase-functions/v2/https': {
    HttpsError,
    onCall: (opts, fn) => Object.assign(fn, { opts }),
    onRequest: (opts, fn) => Object.assign(fn, { opts }),
  },
  'firebase-functions/params': { defineSecret: (n) => ({ value: () => (n === 'PAYU_KEY' ? KEY : SALT) }) },
  'firebase-admin': {
    apps: [1],
    initializeApp() {},
    firestore: Object.assign(() => db, {
      FieldValue: { serverTimestamp: () => 'SERVER_TS', increment: (n) => n },
      Timestamp: { fromDate: (d) => d.getTime() },
    }),
    auth: () => ({ getUser: async (uid) => ({ uid, phoneNumber: '+919000000001', displayName: 'Prashant | Owner' }) }),
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return stubs[req] ? req : origResolve.call(this, req, ...rest); };
for (const k of Object.keys(stubs)) require.cache[k] = { id: k, filename: k, loaded: true, exports: stubs[k] };

// Lay the files out as in C:\dev\hisaabnow\functions: payu.js next to staff360/
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payu-'));
fs.copyFileSync(path.join(__dirname, '../hisaabnow-functions/payu.js'), path.join(dir, 'payu.js'));
fs.cpSync(path.join(__dirname, '../staff360'), path.join(dir, 'staff360'), { recursive: true });
fs.writeFileSync(path.join(dir, 'promo.js'), 'module.exports={evaluatePromo:async()=>({valid:false}),recordRedemption:async()=>{}};');
process.env.APP_ORIGIN = 'https://app.hisaabnow.com';
const payu = require(path.join(dir, 'payu.js'));

const sha512 = (s) => crypto.createHash('sha512').update(s, 'utf8').digest('hex');
function payuSays(order, status, over) {
  const b = Object.assign({ key: KEY, txnid: order.txnid, amount: order.amount, productinfo: order.productinfo,
    firstname: order.firstname, email: order.email, status, mihpayid: 'MIH' + order.txnid, mode: 'UPI' }, over || {});
  b.hash = sha512([SALT, b.status, '', '', '', '', '', '', '', '', '', '', b.email, b.firstname, b.productinfo, b.amount, b.txnid, b.key].join('|'));
  return b;
}
function res() { const r = { code: 0, loc: '', body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.redirect = (c, u) => { r.code = c; r.loc = u; }; return r; }

db._seed('shops/A', { ownerId: 'ownerA', name: 'Glow Salon' });
db._seed('shops/A/staff/+919111111111', { name: 'Amit', role: 'cashier', active: true });
const OWNER = { uid: 'ownerA', token: { phone_number: '+919000000001' } };
const EMP = { uid: 'empA', token: { phone_number: '+919111111111' } };

test('Staff360 checkout: server price, owner only, verified webhook grants the plan once', async () => {
  // Client tries to set its own amount: ignored.
  const out = await payu.payuCreateOrder({ auth: OWNER, data: { product: 'staff360', tier: 'premium', shopId: 'A', from: 'app', amount: 1 } });
  const p = out.params;
  assert.equal(p.amount, '999.00');
  assert.equal(p.productinfo, 'Staff360 Premium 1 month');
  assert.ok(!/\|/.test(p.firstname), 'pipe stripped from hash fields');
  assert.equal(p.hash, sha512([KEY, p.txnid, p.amount, p.productinfo, p.firstname, p.email, '', '', '', '', '', '', '', '', '', '', SALT].join('|')));
  const order = db._store.get('payuOrders/' + p.txnid);
  assert.equal(order.product, 'staff360'); assert.equal(order.shopId, 'A'); assert.equal(order.planKey, 'premium'); assert.equal(order.months, 1);
  assert.match(order.returnUrl, /^https:\/\/app\.hisaabnow\.com\/staff360\/v2\/app\.html\?t=A&n=Glow%20Salon#\/plans$/);
  assert.equal(db._store.get('users/ownerA/private/subscription'), undefined);

  await assert.rejects(payu.payuCreateOrder({ auth: EMP, data: { product: 'staff360', tier: 'premium', shopId: 'A' } }), (e) => e.code === 'permission-denied');
  await assert.rejects(payu.payuCreateOrder({ auth: OWNER, data: { product: 'staff360', tier: 'gold', shopId: 'A' } }), (e) => e.code === 'invalid-argument');

  // Forged / tampered responses change nothing.
  const forged = payuSays(Object.assign({ txnid: p.txnid }, p), 'success', { amount: '1.00' });
  let r = res(); await payu.payuWebhook({ body: forged }, r);
  assert.equal(r.body.ok, false);
  const badHash = Object.assign(payuSays(Object.assign({ txnid: p.txnid }, p), 'success'), { hash: 'ab'.repeat(64) });
  r = res(); await payu.payuWebhook({ body: badHash }, r);
  assert.equal(r.body.reason, 'bad_hash');
  assert.equal(db._store.get('staff360Entitlements/A'), undefined);

  // Real success: webhook, then the browser return (same txnid) — applied once.
  const ok = payuSays(Object.assign({ txnid: p.txnid }, p), 'success');
  r = res(); await payu.payuWebhook({ body: ok }, r);
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  const ent = db._store.get('staff360Entitlements/A');
  assert.equal(ent.planId, 'premium'); assert.equal(ent.status, 'active'); assert.equal(ent.provider, 'payu'); assert.equal(ent.providerRef, p.txnid);
  const end1 = ent.endAt;
  r = res(); await payu.payuReturn({ body: ok }, r);
  assert.equal(r.code, 303);
  assert.equal(r.loc, `https://app.hisaabnow.com/staff360/v2/app.html?t=A&n=Glow%20Salon&payu=success&txnid=${p.txnid}#/plans`);
  assert.equal(db._store.get('staff360Entitlements/A').endAt, end1, 'not applied twice');
  const logs = [...db._store.entries()].filter(([k, v]) => k.startsWith('adminLogs/') && v.product === 'staff360');
  assert.equal(logs.length, 1); assert.equal(logs[0][1].amount, 999);
  assert.ok([...db._store.keys()].some((k) => k.startsWith('staff360/A/audit/')));
});

test('Staff360 checkout: website return address, failure, King PRO renewal, no downgrade', async () => {
  const k = (await payu.payuCreateOrder({ auth: OWNER, data: { product: 'staff360', tier: 'kingpro', shopId: 'A', from: 'site' } })).params;
  assert.equal(k.amount, '4999.00');
  const fail = payuSays(Object.assign({}, k), 'failure');
  let r = res(); await payu.payuReturn({ body: fail }, r);
  assert.equal(r.loc, `https://hisaabnow.com/staff360/app/?t=A&payu=failed&txnid=${k.txnid}#/plans`);
  assert.equal(db._store.get('payuOrders/' + k.txnid).status, 'failed');
  assert.equal(db._store.get('staff360Entitlements/A').planId, 'premium', 'failed payment changes nothing');

  const k2 = (await payu.payuCreateOrder({ auth: OWNER, data: { product: 'staff360', tier: 'kingpro', shopId: 'A', from: 'site' } })).params;
  r = res(); await payu.payuWebhook({ body: payuSays(Object.assign({}, k2), 'success') }, r);
  const ent = db._store.get('staff360Entitlements/A');
  assert.equal(ent.planId, 'kingpro');
  assert.ok(ent.endAt > Date.now() + 365 * 864e5, 'a year plus the converted Premium days');
  await assert.rejects(payu.payuCreateOrder({ auth: OWNER, data: { product: 'staff360', tier: 'premium', shopId: 'A' } }), (e) => e.code === 'failed-precondition');
});

test('HisaabNow and RentalNow paths unchanged', async () => {
  const h = (await payu.payuCreateOrder({ auth: OWNER, data: { tier: 'pro', cycle: 'monthly' } })).params;
  assert.equal(h.amount, '499.00');
  let r = res(); await payu.payuWebhook({ body: payuSays(Object.assign({}, h), 'success') }, r);
  assert.equal(db._store.get('users/ownerA/private/subscription').plan, 'pro_monthly');
  r = res(); await payu.payuReturn({ body: payuSays(Object.assign({}, h), 'success') }, r);
  assert.equal(r.loc, `https://app.hisaabnow.com/?payu=success&txnid=${h.txnid}`);
});
