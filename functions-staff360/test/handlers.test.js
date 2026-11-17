'use strict';
/* End-to-end handler tests: authorisation, tenant isolation, plan gating,
 * punches, requests, AI grounding and WhatsApp consent — against an
 * in-memory Firestore. These are the "denied access" tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFake } = require('./fakeFirestore');
const { createHandlers } = require('../staff360/handlers');
const { createAI } = require('../staff360/ai');

class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const T0 = Date.parse('2026-11-17T03:45:00Z'); // 09:15 IST, Tuesday
const OWNER_A = { uid: 'ownerA', token: { phone_number: '+919000000001' } };
const OWNER_B = { uid: 'ownerB', token: { phone_number: '+919000000002' } };
const EMP_A = { uid: 'empA', token: { phone_number: '+919111111111' } };
const MGR_A = { uid: 'mgrA', token: { phone_number: '+919222222222' } };
const EMP_B = { uid: 'empB', token: { phone_number: '+919333333333' } };
const ADMIN = { uid: 'platformAdmin', token: {} };
const gps = (t) => ({ lat: 28.5355, lng: 77.391, accuracy: 20, capturedAt: t - 3000 });

function setup(opts) {
  const db = createFake();
  let now = T0;
  db._seed('shops/A', { ownerId: 'ownerA', name: 'Glow Salon' });
  db._seed('shops/B', { ownerId: 'ownerB', name: 'Other Shop' });
  db._seed('shops/A/staff/amit', { name: 'Amit Kumar', role: 'Cashier', phoneE164: '+919111111111', salary: 18000 });
  db._seed('shops/A/staff/riya', { name: 'Riya Sharma', role: 'Stylist', phoneE164: '+919444444444', salary: 15000 });
  db._seed('shops/A/staff/meena', { name: 'Meena Joshi', role: 'Manager', phoneE164: '+919222222222', salary: 25000 });
  db._seed('shops/B/staff/x', { name: 'Vikas Singh', phoneE164: '+919333333333' });
  db._seed('staffPhoneIndex/+919111111111/shops/A', { shopId: 'A', ownerUid: 'ownerA', role: 'cashier', active: true });
  db._seed('staffPhoneIndex/+919222222222/shops/A', { shopId: 'A', ownerUid: 'ownerA', role: 'manager', active: true });
  db._seed('staffPhoneIndex/+919333333333/shops/B', { shopId: 'B', ownerUid: 'ownerB', role: 'cashier', active: true });
  const sentWa = [];
  const h = createHandlers({
    db, HttpsError, now: () => now,
    env: { STAFF360_ADMIN_UIDS: 'platformAdmin', STAFF360_AI_DAILY_LIMIT: '3' },
    ai: opts && opts.ai,
    wa: opts && opts.wa ? { configured: () => true, send: async (to, text) => { sentWa.push({ to, text }); return { ok: true, id: 'wamid.1' }; } } : undefined,
  });
  return { db, h, sentWa, setNow: (t) => { now = t; }, getNow: () => now };
}

async function rejects(p, code, msgRe) {
  await assert.rejects(p, (e) => {
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    if (msgRe) assert.match(e.message, msgRe);
    return true;
  });
}

async function grant(h, shopId, planId) {
  return h.adminSetPlan({ shopId, planId, months: 12 }, ADMIN);
}

test('unauthenticated and cross-shop access are denied', async () => {
  const { h } = setup();
  await rejects(h.getState({ shopId: 'A' }, null), 'unauthenticated');
  await rejects(h.getState({ shopId: 'A' }, OWNER_B), 'permission-denied');
  await rejects(h.getState({ shopId: 'A' }, EMP_B), 'permission-denied');
  await rejects(h.report({ shopId: 'A', from: '2026-11-01', to: '2026-11-17' }, OWNER_B), 'permission-denied');
  await rejects(h.getState({ shopId: '../shops/A' }, OWNER_A), 'invalid-argument');
  await rejects(h.getState({ shopId: 'nope' }, OWNER_A), 'not-found');
});

test('inactive staff membership is denied', async () => {
  const { h, db } = setup();
  db._seed('staffPhoneIndex/+919111111111/shops/A', { shopId: 'A', ownerUid: 'ownerA', role: 'cashier', active: false });
  await rejects(h.getState({ shopId: 'A' }, EMP_A), 'permission-denied');
});

test('Basic: owner gets basic, employee self check-in is blocked server-side', async () => {
  const { h } = setup();
  const s = await h.getState({ shopId: 'A' }, OWNER_A);
  assert.equal(s.plan, 'basic');
  assert.equal(s.role, 'owner');
  assert.equal(s.features.self_checkin, false);
  assert.equal(s.plans.kingpro.priceYearInr, 4999);
  assert.equal(s.plans.premium.priceYearInr, null);
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A), 'failed-precondition', /upgrade_required:premium/);
  await rejects(h.listShifts({ shopId: 'A' }, OWNER_A), 'failed-precondition', /upgrade_required:premium/);
  await rejects(h.aiDashboard({ shopId: 'A' }, OWNER_A), 'failed-precondition', /upgrade_required:kingpro/);
  const rep = await h.report({ shopId: 'A', from: '2026-11-01', to: '2026-11-17' }, OWNER_A);
  assert.equal(rep.detailed, false);
  assert.equal(rep.rows[0].workedMin, undefined, 'Basic report has no hours');
});

test('Basic: manual edit audit is server-stamped with actor', async () => {
  const { h } = setup();
  await h.logManualEdit({ shopId: 'A', staffId: 'amit', date: '2026-11-16', from: 'A', to: 'P', reason: 'Corrected after call' }, OWNER_A);
  await rejects(h.logManualEdit({ shopId: 'A', staffId: 'amit', date: '2026-11-16', from: 'A', to: 'P' }, EMP_A), 'permission-denied');
  const a = await h.listAudit({ shopId: 'A' }, OWNER_A);
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].actorUid, 'ownerA');
  assert.equal(a.items[0].from, 'A');
  assert.equal(a.items[0].to, 'P');
  assert.equal(a.items[0].reason, 'Corrected after call');
  await rejects(h.listAudit({ shopId: 'A' }, EMP_A), 'permission-denied');
});

test('plan cannot be self-granted; only platform admin', async () => {
  const { h } = setup();
  await rejects(h.adminSetPlan({ shopId: 'A', planId: 'kingpro' }, OWNER_A), 'permission-denied');
  await rejects(h.adminSetPlanConfig({ premium: { priceYearInr: 1 } }, OWNER_A), 'permission-denied');
  // Client-claimed plan in data is ignored.
  const s = await h.getState({ shopId: 'A', plan: 'kingpro', features: { ai_assistant: true } }, OWNER_A);
  assert.equal(s.plan, 'basic');
  await grant(h, 'A', 'premium');
  assert.equal((await h.getState({ shopId: 'A' }, OWNER_A)).plan, 'premium');
  assert.equal((await h.getState({ shopId: 'B' }, OWNER_B)).plan, 'basic', 'other tenant unaffected');
});

test('billing: no fake payment success', async () => {
  const { h } = setup();
  const r = await h.createOrder({ shopId: 'A', planId: 'kingpro' }, OWNER_A);
  assert.deepEqual(r, { ok: false, reason: 'billing_not_configured' });
  const p = await h.createOrder({ shopId: 'A', planId: 'premium' }, OWNER_A);
  assert.deepEqual(p, { ok: false, reason: 'price_not_configured' });
  await rejects(h.createOrder({ shopId: 'A', planId: 'kingpro' }, EMP_A), 'permission-denied');
  assert.equal((await h.getState({ shopId: 'A' }, OWNER_A)).plan, 'basic');
});

test('Premium: GPS check-in, duplicate guard, check-out, mirror to register', async () => {
  const { h, db, setNow } = setup();
  await grant(h, 'A', 'premium');
  await h.saveShift({ shopId: 'A', name: 'Morning', start: '09:00', end: '18:00', graceMin: 10, weeklyOff: [0], staffIds: ['amit'] }, OWNER_A);
  const r = await h.punch({ shopId: 'A', action: 'in', gps: gps(T0), clientTs: T0 }, EMP_A);
  assert.equal(r.punch.attendanceDate, '2026-11-17');
  assert.equal(r.punch.inHm, '09:15');
  assert.equal(r.punch.lateMinutes, 15);
  assert.equal(r.punch.checkInGpsStatus, 'captured');
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A), 'already-exists', /already_checked_in/);
  const stored = db._store.get('staff360/A/punches/amit_2026-11-17');
  assert.equal(stored.checkInGps.lat, 28.5355);
  assert.equal(stored.checkInAt, T0, 'server time, not client time');
  setNow(T0 + 8.5 * 3600e3);
  const o = await h.punch({ shopId: 'A', action: 'out', gps: gps(T0 + 8.5 * 3600e3) }, EMP_A);
  assert.equal(o.punch.workedMinutes, 510);
  await rejects(h.punch({ shopId: 'A', action: 'out', gps: gps(T0 + 8.5 * 3600e3) }, EMP_A), 'already-exists');
  const month = db._store.get('shops/A/agents/att_amit_2026-11');
  assert.deepEqual(month.days['2026-11-17'], { m: 'P', i: '09:15', o: '17:45', src: 's360' });
  const st = await h.getState({ shopId: 'A' }, EMP_A);
  assert.equal(st.role, 'employee');
  assert.equal(st.me.todayPunch.workedMinutes, 510);
  assert.equal(st.me.todayPunch.checkInGps.lat, undefined, 'raw coordinates are not echoed to the client state');
});

test('Premium: GPS denied respects business policy, never fabricates', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'premium');
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: null, gpsError: 'denied' }, EMP_A), 'failed-precondition', /gps_required:denied/);
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: { lat: 0, lng: 0, accuracy: 5, capturedAt: T0 - 3600e3 } }, EMP_A), 'failed-precondition', /gps_required/);
  await h.saveSettings({ shopId: 'A', gpsPolicy: 'allow_without' }, OWNER_A);
  const r = await h.punch({ shopId: 'A', action: 'in', gps: null, gpsError: 'denied' }, EMP_A);
  assert.equal(r.punch.checkInGpsStatus, 'denied');
  assert.equal(db._store.get('staff360/A/punches/amit_2026-11-17').checkInGps, null);
});

test('Premium: poor accuracy is recorded and flagged, not hidden', async () => {
  const { h } = setup();
  await grant(h, 'A', 'premium');
  const r = await h.punch({ shopId: 'A', action: 'in', gps: { lat: 28.5, lng: 77.3, accuracy: 900, capturedAt: T0 } }, EMP_A);
  assert.equal(r.punch.checkInGps.lowAccuracy, true);
});

test('Premium: overnight checkout attaches to yesterday', async () => {
  const { h, setNow } = setup();
  await grant(h, 'A', 'premium');
  await h.saveShift({ shopId: 'A', name: 'Night', start: '22:00', end: '06:00', graceMin: 15, staffIds: ['amit'] }, OWNER_A);
  const tin = Date.parse('2026-11-17T16:30:00Z'); // 22:00 IST
  setNow(tin);
  await h.punch({ shopId: 'A', action: 'in', gps: gps(tin) }, EMP_A);
  const tout = Date.parse('2026-11-18T00:30:00Z'); // 06:00 IST next day
  setNow(tout);
  const o = await h.punch({ shopId: 'A', action: 'out', gps: gps(tout) }, EMP_A);
  assert.equal(o.punch.attendanceDate, '2026-11-17');
  assert.equal(o.punch.workedMinutes, 480);
  assert.equal(o.punch.earlyLeaveMinutes, 0);
});

test('employee cannot reach owner/manager functions or other people', async () => {
  const { h } = setup();
  await grant(h, 'A', 'kingpro');
  for (const fn of ['register', 'listShifts', 'listRequests', 'aiDashboard', 'salaryList', 'listAudit']) {
    await rejects(h[fn]({ shopId: 'A' }, EMP_A), 'permission-denied', null);
  }
  await rejects(h.report({ shopId: 'A', from: '2026-11-01', to: '2026-11-17' }, EMP_A), 'permission-denied');
  await rejects(h.aiAsk({ shopId: 'A', question: 'Who is absent today?' }, EMP_A), 'permission-denied');
  await rejects(h.saveShift({ shopId: 'A', name: 'X', start: '09:00', end: '17:00' }, EMP_A), 'permission-denied');
  await rejects(h.whatsapp({ shopId: 'A', op: 'get' }, MGR_A), 'permission-denied', null);
  // Employee of B cannot punch into A even with a valid plan on A
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_B), 'permission-denied');
  // Own history only
  await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A);
  const mine = await h.myHistory({ shopId: 'A' }, EMP_A);
  assert.equal(mine.row.staffId, 'amit');
});

test('manager role works within assigned shop only', async () => {
  const { h } = setup();
  await grant(h, 'A', 'premium');
  const r = await h.register({ shopId: 'A', date: '2026-11-17' }, MGR_A);
  assert.equal(r.rows.length, 3);
  await rejects(h.register({ shopId: 'B', date: '2026-11-17' }, MGR_A), 'permission-denied');
  await rejects(h.saveSettings({ shopId: 'A', gpsPolicy: 'allow_without' }, MGR_A), 'permission-denied');
});

test('leave & correction requests with decision audit', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'premium');
  const { id } = await h.submitRequest({ shopId: 'A', type: 'leave', fromDate: '2026-11-20', toDate: '2026-11-21', reason: 'Family function' }, EMP_A);
  await rejects(h.decideRequest({ shopId: 'A', id, decision: 'approved' }, EMP_A), 'permission-denied');
  await rejects(h.decideRequest({ shopId: 'A', id, decision: 'rejected' }, OWNER_A), 'invalid-argument', /reason/);
  await h.decideRequest({ shopId: 'A', id, decision: 'approved', note: 'OK' }, MGR_A);
  await rejects(h.decideRequest({ shopId: 'A', id, decision: 'approved' }, OWNER_A), 'failed-precondition');
  assert.equal(db._store.get('shops/A/agents/att_amit_2026-11').days['2026-11-21'].m, 'L');
  const c = await h.submitRequest({ shopId: 'A', type: 'correction', date: '2026-11-16', status: 'P', checkIn: '09:00', reason: 'Forgot to punch' }, EMP_A);
  await h.decideRequest({ shopId: 'A', id: c.id, decision: 'approved', note: 'Seen on CCTV' }, OWNER_A);
  assert.deepEqual(db._store.get('shops/A/agents/att_amit_2026-11').days['2026-11-16'], { m: 'P', i: '09:00', src: 's360' });
  await rejects(h.submitRequest({ shopId: 'A', type: 'correction', date: '2026-12-30', status: 'P', reason: 'future' }, EMP_A), 'invalid-argument');
  const audit = await h.listAudit({ shopId: 'A' }, OWNER_A);
  assert.ok(audit.items.find((x) => x.type === 'request_approved' && x.actorRole === 'manager'));
  const mine = await h.myHistory({ shopId: 'A' }, EMP_A);
  assert.equal(mine.requests.length, 2);
});

test('Premium cannot use King PRO; King PRO inherits Premium', async () => {
  const { h } = setup();
  await grant(h, 'A', 'premium');
  await rejects(h.aiAsk({ shopId: 'A', question: 'Who is absent today?' }, OWNER_A), 'failed-precondition', /kingpro/);
  await rejects(h.salaryList({ shopId: 'A' }, OWNER_A), 'failed-precondition', /kingpro/);
  await rejects(h.whatsapp({ shopId: 'A', op: 'get' }, OWNER_A), 'failed-precondition', /kingpro/);
  await grant(h, 'A', 'kingpro');
  assert.ok((await h.listShifts({ shopId: 'A' }, OWNER_A)).shifts);
  assert.ok(await h.aiDashboard({ shopId: 'A' }, OWNER_A));
});

function seedMonth(db) {
  // Riya absent today; Amit late 4 times this month via punches.
  db._seed('shops/A/agents/att_riya_2026-11', { kind: 'hn_att', staffId: 'riya', ym: '2026-11', days: { '2026-11-17': { m: 'A' }, '2026-11-10': { m: 'A' }, '2026-11-11': { m: 'P' } } });
  db._seed('shops/A/agents/att_meena_2026-11', { kind: 'hn_att', staffId: 'meena', ym: '2026-11', days: { '2026-11-17': { m: 'P' } } });
  for (const d of ['03', '04', '05', '06']) {
    db._seed(`staff360/A/punches/amit_2026-11-${d}`, { staffId: 'amit', attendanceDate: `2026-11-${d}`, checkInAt: 1, checkOutAt: 2, inHm: '09:30', outHm: '18:00', lateMinutes: 30, workedMinutes: 510 });
  }
}

test('King PRO assistant without AI key: labelled rules mode, grounded answers', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'kingpro');
  seedMonth(db);
  const absent = await h.aiAsk({ shopId: 'A', question: 'Who is absent today?' }, OWNER_A);
  assert.equal(absent.source, 'rules');
  assert.deepEqual(absent.results[0].items.map((i) => i.name), ['Riya Sharma']);
  assert.match(absent.text, /2026-11-17/);
  const late = await h.aiAsk({ shopId: 'A', question: 'Show employees with 3+ late arrivals this month' }, OWNER_A);
  assert.deepEqual(late.results[0].items.map((i) => [i.name, i.value]), [['Amit Kumar', 4]]);
  assert.equal(late.results[0].items[0].evidence.length, 4);
  const hrs = await h.aiAsk({ shopId: 'A', question: 'How many hours did Amit work this month?' }, OWNER_A);
  assert.equal(hrs.results[0].items[0].value, '34h 0m');
  const none = await h.aiAsk({ shopId: 'A', question: 'Who has been late more than 9 times this month?' }, OWNER_A);
  assert.equal(none.results[0].items.length, 0);
  const dash = await h.aiDashboard({ shopId: 'A' }, OWNER_A);
  assert.equal(dash.narrativeSource, 'template');
  assert.equal(dash.ai.configured, false);
  assert.ok(dash.anomalies.find((a) => a.type === 'repeated_late' && a.staffId === 'amit'));
});

test('King PRO alerts: review/dismiss persisted, dismiss needs reason', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'kingpro');
  seedMonth(db);
  const dash = await h.aiDashboard({ shopId: 'A' }, OWNER_A);
  const a = dash.anomalies[0];
  await rejects(h.alertAction({ shopId: 'A', id: a.id, state: 'dismissed' }, OWNER_A), 'invalid-argument');
  await h.alertAction({ shopId: 'A', id: a.id, state: 'reviewed' }, OWNER_A);
  const again = await h.aiDashboard({ shopId: 'A' }, OWNER_A);
  assert.equal(again.anomalies.find((x) => x.id === a.id).review.state, 'reviewed');
});

test('King PRO salary: draft, owner-only approval, transparent formula', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'kingpro');
  seedMonth(db);
  const list = await h.salaryList({ shopId: 'A', ym: '2026-11' }, OWNER_A);
  const amit = list.rows.find((r) => r.staffId === 'amit');
  assert.equal(amit.result.draft, true);
  assert.equal(amit.result.basis, 'monthly');
  assert.ok(amit.result.formula.some((f) => /Payable days/.test(f)));
  await h.salarySave({ shopId: 'A', ym: '2026-11', staffId: 'amit', overrides: { overtimeRate: 120 } }, MGR_A);
  await rejects(h.salarySave({ shopId: 'A', ym: '2026-11', staffId: 'amit', approve: true }, MGR_A), 'permission-denied');
  await h.salarySave({ shopId: 'A', ym: '2026-11', staffId: 'amit', approve: true }, OWNER_A);
  const after = await h.salaryList({ shopId: 'A', ym: '2026-11' }, OWNER_A);
  assert.equal(after.rows.find((r) => r.staffId === 'amit').status, 'approved');
  assert.equal(db._store.get('staff360/A/salary/2026-11_amit').status, 'approved');
});

test('AI provider path: names pseudonymised, usage logged, rate limited', async () => {
  const bodies = [];
  const fakeFetch = async (url, init) => {
    bodies.push(init.body);
    const b = JSON.parse(init.body);
    const last = b.messages[b.messages.length - 1];
    if (typeof last.content === 'string') {
      return { ok: true, json: async () => ({ usage: { input_tokens: 50, output_tokens: 10 },
        content: [{ type: 'tool_use', id: 't1', name: 'late_at_least', input: { n: 3, period: 'this_month' } }] }) };
    }
    return { ok: true, json: async () => ({ usage: { input_tokens: 80, output_tokens: 20 },
      content: [{ type: 'text', text: 'EMP1 has 4 late arrivals this month (2026-11-01 to 2026-11-17).' }] }) };
  };
  const ai = createAI({ STAFF360_AI_PROVIDER: 'anthropic', STAFF360_AI_MODEL: 'test-model', ANTHROPIC_API_KEY: 'k' }, fakeFetch);
  const { h, db } = setup({ ai });
  await grant(h, 'A', 'kingpro');
  seedMonth(db);
  const r = await h.aiAsk({ shopId: 'A', question: 'Is Amit Kumar late a lot?' }, OWNER_A);
  assert.equal(r.source, 'ai');
  assert.equal(r.text, 'Amit Kumar has 4 late arrivals this month (2026-11-01 to 2026-11-17).');
  for (const b of bodies) assert.doesNotMatch(b, /Amit|Riya|Meena|Kumar|Sharma|\+91/);
  const usage = [...db._store.keys()].filter((k) => k.startsWith('staff360/A/aiUsageLog/'));
  assert.equal(usage.length, 1);
  assert.equal(JSON.stringify(db._store.get(usage[0])).includes('late'), false, 'no question text stored');
  await h.aiAsk({ shopId: 'A', question: 'again one' }, OWNER_A);
  await h.aiAsk({ shopId: 'A', question: 'again two' }, OWNER_A);
  await rejects(h.aiAsk({ shopId: 'A', question: 'again three' }, OWNER_A), 'resource-exhausted');
});

test('WhatsApp: needs consent, sends nothing without provider, respects plan', async () => {
  const noProv = setup();
  await grant(noProv.h, 'A', 'kingpro');
  await rejects(noProv.h.whatsapp({ shopId: 'A', op: 'save', recipient: '+919000000001', cadence: 'daily', sendTime: '09:00' }, OWNER_A), 'failed-precondition', /consent/);
  const saved = await noProv.h.whatsapp({ shopId: 'A', op: 'save', recipient: '+919000000001', cadence: 'daily', sendTime: '09:00', consent: true }, OWNER_A);
  assert.equal(saved.providerConfigured, false);
  assert.deepEqual(await noProv.h.runWhatsAppDigests(), { sent: 0, reason: 'provider_not_configured' });

  const w = setup({ wa: true });
  await grant(w.h, 'A', 'kingpro');
  assert.deepEqual(await w.h.runWhatsAppDigests(), { sent: 0 }, 'no opt-in, nothing sent');
  await w.h.whatsapp({ shopId: 'A', op: 'save', recipient: '+919000000001', cadence: 'daily', sendTime: '09:00', consent: true }, OWNER_A);
  assert.deepEqual(await w.h.runWhatsAppDigests(), { sent: 1 });
  assert.deepEqual(await w.h.runWhatsAppDigests(), { sent: 0 }, 'no duplicate on the same day');
  assert.match(w.sentWa[0].text, /Glow Salon/);
  await w.h.whatsapp({ shopId: 'A', op: 'disable' }, OWNER_A);
  w.setNow(T0 + 24 * 3600e3);
  assert.deepEqual(await w.h.runWhatsAppDigests(), { sent: 0 }, 'disabled');
});

test('expiry downgrades access but keeps data', async () => {
  const { h, db, setNow } = setup();
  await grant(h, 'A', 'premium');
  await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A);
  setNow(T0 + 400 * 24 * 3600e3);
  const s = await h.getState({ shopId: 'A' }, OWNER_A);
  assert.equal(s.plan, 'basic');
  assert.equal(s.entitlement.lapsedFrom, 'premium');
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: gps(T0 + 400 * 24 * 3600e3) }, EMP_A), 'failed-precondition');
  assert.ok(db._store.get('staff360/A/punches/amit_2026-11-17'), 'punch data kept');
});
