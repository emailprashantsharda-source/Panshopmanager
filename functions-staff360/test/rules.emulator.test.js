/* Run on YOUR machine (needs Java + firebase-tools; the build sandbox cannot
 * download the emulator):
 *
 *   cd C:\dev\hisaabnow
 *   npm i -D @firebase/rules-unit-testing
 *   firebase emulators:exec --only firestore --project hisaabnow-staging ^
 *     "node --test functions/staff360/test/rules.emulator.test.js"
 *
 * It loads your REAL merged firestore.rules (FIRESTORE_RULES env or
 * ./firestore.rules) and proves clients cannot touch Staff360 data. */
'use strict';
const fs = require('fs');
const test = require('node:test');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');

test('clients have no direct access to Staff360 data', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'hisaabnow-staging',
    firestore: { rules: fs.readFileSync(process.env.FIRESTORE_RULES || 'firestore.rules', 'utf8') },
  });
  const owner = env.authenticatedContext('ownerA', { phone_number: '+919000000001' }).firestore();
  const other = env.authenticatedContext('ownerB').firestore();
  const anon = env.unauthenticatedContext().firestore();
  for (const db of [owner, other, anon]) {
    await assertFails(db.doc('staff360Entitlements/A').set({ planId: 'kingpro', status: 'active' }));
    await assertFails(db.doc('staff360Entitlements/A').get());
    await assertFails(db.doc('staff360/A/punches/amit_2026-11-17').set({ checkInAt: 1 }));
    await assertFails(db.doc('staff360/A/punches/amit_2026-11-17').get());
    await assertFails(db.collection('staff360/A/audit').get());
    await assertFails(db.doc('staff360Config/plans').set({ kingpro: { priceYearInr: 1 } }));
    await assertFails(db.doc('staff360WaSchedule/A').set({ enabled: true }));
  }
  await env.cleanup();
});
