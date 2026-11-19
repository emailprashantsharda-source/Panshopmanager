'use strict';
/* staff360/index.js: the single staff360Api function routes { __op } to the handlers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { createFake } = require('./fakeFirestore');
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const db = createFake();
const stubs = {
  'firebase-functions/v2/https': { HttpsError, onCall: (opts, fn) => Object.assign(fn, { opts }), onRequest: (o, f) => f },
  'firebase-functions/v2/scheduler': { onSchedule: (o, f) => f },
  'firebase-functions/params': { defineSecret: (n) => ({ name: n, value: () => '' }) },
  'firebase-admin': { apps: [1], initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 0 } }) },
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return stubs[r] ? r : orig.call(this, r, ...a); };
for (const k of Object.keys(stubs)) require.cache[k] = { id: k, filename: k, loaded: true, exports: stubs[k] };
const fns = require('../staff360/index.js');

test('staff360Api: one warm function, routes by __op, keeps data.op for handlers', async () => {
  const api = fns.staff360Api;
  assert.equal(api.opts.minInstances, 1); assert.equal(api.opts.cpu, 1); assert.equal(api.opts.enforceAppCheck, true);
  assert.deepEqual(api.opts.secrets.map((s) => s.name), ['OPENAI_API_KEY']);
  await assert.rejects(api({ data: { __op: 'constructor' }, auth: null }), (e) => e.code === 'invalid-argument');
  await assert.rejects(api({ data: { __op: 'staff360GetState', shopId: 'A' }, auth: null }), (e) => e.code === 'unauthenticated');
  db._seed('shops/A', { ownerId: 'o1', name: 'Glow' });
  const st = await api({ data: { __op: 'staff360GetState', shopId: 'A' }, auth: { uid: 'o1', token: {} } });
  assert.equal(st.role, 'owner');
  for (const k of Object.keys(fns)) if (k.startsWith('staff360') && !/Digest|Daily|Api/.test(k)) assert.equal(typeof fns[k], 'function', k);
});
