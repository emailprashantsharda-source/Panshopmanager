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
  // Owner's roster (what the app sends via syncRoster) — ids are Step ATT ids.
  db._seed('staff360/A/roster/amit', { name: 'Amit Kumar', role: 'Cashier', phoneE164: '+919111111111', salary: 18000 });
  db._seed('staff360/A/roster/riya', { name: 'Riya Sharma', role: 'Stylist', phoneE164: '+919444444444', salary: 15000 });
  db._seed('staff360/A/roster/meena', { name: 'Meena Joshi', role: 'Manager', phoneE164: '+919222222222', salary: 25000 });
  db._seed('staff360/B/roster/x', { name: 'Vikas Singh', phoneE164: '+919333333333' });
  // Login records written by addStaffMember CF, keyed by phone (same as rules' isStaffOf).
  db._seed('shops/A/staff/+919111111111', { name: 'Amit Kumar', role: 'cashier', active: true });
  db._seed('shops/A/staff/+919222222222', { name: 'Meena Joshi', role: 'manager', active: true });
  db._seed('shops/B/staff/+919333333333', { name: 'Vikas Singh', role: 'cashier', active: true });
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
  db._seed('shops/A/staff/+919111111111', { name: 'Amit Kumar', role: 'cashier', active: false });
  await rejects(h.getState({ shopId: 'A' }, EMP_A), 'permission-denied');
});

test('Basic: owner gets basic, employee self check-in is blocked server-side', async () => {
  const { h } = setup();
  const s = await h.getState({ shopId: 'A' }, OWNER_A);
  assert.equal(s.plan, 'basic');
  assert.equal(s.role, 'owner');
  assert.equal(s.features.self_checkin, false);
  assert.equal(s.plans.kingpro.priceInr, 4999);
  assert.equal(s.plans.premium.priceInr, 999);
  assert.equal(s.plans.basic.maxStaff, 2);
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

test('billing: quote is server-priced, owner-only, no downgrade while a higher plan runs', async () => {
  const { h } = setup();
  assert.deepEqual(await h.createOrder({ shopId: 'A', planId: 'kingpro' }, OWNER_A), { ok: false, reason: 'use_payu' });
  const q = await h.billingQuote({ shopId: 'A', planId: 'premium', amountInr: 1 }, OWNER_A);
  assert.equal(q.amountInr, 999); assert.equal(q.months, 1); assert.equal(q.shopId, 'A');
  assert.equal((await h.billingQuote({ shopId: 'A', planId: 'kingpro' }, OWNER_A)).amountInr, 4999);
  await rejects(h.billingQuote({ shopId: 'A', planId: 'kingpro' }, EMP_A), 'permission-denied');
  await rejects(h.billingQuote({ shopId: 'A', planId: 'kingpro' }, MGR_A), 'permission-denied');
  await rejects(h.billingQuote({ shopId: 'A', planId: 'kingpro' }, OWNER_B), 'permission-denied');
  await rejects(h.billingQuote({ shopId: 'A', planId: 'basic' }, OWNER_A), 'invalid-argument');
  assert.equal((await h.getState({ shopId: 'A' }, OWNER_A)).plan, 'basic', 'a quote grants nothing');
  await grant(h, 'A', 'kingpro');
  await rejects(h.billingQuote({ shopId: 'A', planId: 'premium' }, OWNER_A), 'failed-precondition', /King PRO/);
  assert.ok((await h.billingQuote({ shopId: 'A', planId: 'kingpro' }, OWNER_A)).endAt > Date.now() + 300 * 864e5, 'renewal stacks');
});

test('staff limits: Basic org 2 staff; HisaabNow shop counts phone logins (Premium 10)', async () => {
  const { h, db } = setup();
  const { id } = await h.createOrg({ name: 'Tiny Shop' }, NEW_OWNER);
  await h.staffSave({ shopId: id, name: 'One' }, NEW_OWNER); await h.staffSave({ shopId: id, name: 'Two' }, NEW_OWNER);
  await rejects(h.staffSave({ shopId: id, name: 'Three' }, NEW_OWNER), 'resource-exhausted', /allows 2/);
  await grant(h, id, 'premium');
  await h.staffSave({ shopId: id, name: 'Three' }, NEW_OWNER);
  // Shop A: app staff are free; Staff360 logins are limited.
  await grant(h, 'A', 'premium');
  await h.adminSetPlanConfig({ premium: { maxStaff: 1 } }, ADMIN);
  await h.staffSave({ shopId: 'A', id: 'riya', canLogin: true }, OWNER_A);
  await h.syncRoster({ shopId: 'A', staff: [{ id: 'amit', name: 'Amit Kumar', phone: '9111111111' }, { id: 'riya', name: 'Riya Sharma', phone: '9444444444' }, { id: 'zoya', name: 'Zoya', phone: '9555555555' }] }, OWNER_A);
  await rejects(h.staffSave({ shopId: 'A', id: 'zoya', canLogin: true }, OWNER_A), 'resource-exhausted', /1 staff logins/);
  await h.staffSave({ shopId: 'A', id: 'riya', canLogin: true }, OWNER_A); // editing an existing login is fine
  assert.ok(db._store.get('staff360/A/roster/zoya'), 'sync is never blocked');
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

test('roster sync: local-only staff appear; removed staff kept but hidden; login-only staff use phone id', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'premium');
  await rejects(h.syncRoster({ shopId: 'A', staff: [] }, EMP_A), 'permission-denied');
  await h.syncRoster({ shopId: 'A', staff: [
    { id: 'amit', name: 'Amit Kumar', role: 'Cashier', phone: '9111111111', salary: 18000 },
    { id: 'riya', name: 'Riya Sharma', role: 'Stylist' },
    { id: 'local_77', name: 'Sunil (no login)', role: 'Helper', salary: 9000 },
  ] }, OWNER_A);
  assert.equal(db._store.get('staff360/A/roster/amit').phoneE164, '+919111111111');
  assert.equal(db._store.get('staff360/A/roster/meena').removed, true, 'missing from list = removed, not deleted');
  const reg = await h.register({ shopId: 'A', date: '2026-11-17' }, OWNER_A);
  const names = reg.rows.map((r) => r.name).sort();
  assert.deepEqual(names, ['Amit Kumar', 'Meena Joshi', 'Riya Sharma', 'Sunil (no login)'],
    'Meena still shows via her login record (phone id) once off the roster');
  assert.ok(reg.rows.find((r) => r.name === 'Meena Joshi').staffId === '+919222222222');
  // Manager whose roster entry is gone still punches under her login id.
  const r = await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, MGR_A);
  assert.equal(r.ok, true);
  assert.ok(db._store.get('staff360/A/punches/+919222222222_2026-11-17'));
});

/* ───────────── Standalone Staff360 (orgs) ───────────── */
const NEW_OWNER = { uid: 'newOwner', token: { phone_number: '+919800000001' } };
const ORG_EMP = { uid: 'orgEmp', token: { phone_number: '+919800000002' } };

test('standalone: sign up, add staff, mark attendance on Basic (server-side audit)', async () => {
  const { h, db } = setup();
  assert.deepEqual((await h.myTenants({}, NEW_OWNER)).tenants, []);
  const { id } = await h.createOrg({ name: 'Sharma Clinic', businessType: 'clinic' }, NEW_OWNER);
  assert.match(id, /^s360_/);
  const st = await h.getState({ shopId: id }, NEW_OWNER);
  assert.equal(st.role, 'owner'); assert.equal(st.plan, 'basic'); assert.equal(st.tenant.kind, 'org'); assert.equal(st.tenant.name, 'Sharma Clinic');
  const a = await h.staffSave({ shopId: id, name: 'Ravi Kumar', role: 'Receptionist', phone: '98000 00002', salary: 14000, canLogin: true }, NEW_OWNER);
  await rejects(h.staffSave({ shopId: id, name: 'Dup', phone: '9800000002' }, NEW_OWNER), 'already-exists');
  const b = await h.staffSave({ shopId: id, name: 'Neha Gupta', role: 'Nurse', salary: 16000 }, NEW_OWNER);
  await rejects(h.staffSave({ shopId: id, name: 'X', canLogin: true }, NEW_OWNER), 'invalid-argument', /mobile/);
  const roster = await h.staffRoster({ shopId: id }, NEW_OWNER);
  assert.equal(roster.editable, true);
  assert.deepEqual(roster.staff.map((x) => [x.name, x.phone, x.canLogin]).sort(), [['Neha Gupta', null, false], ['Ravi Kumar', '+919800000002', true]]);
  await h.mark({ shopId: id, entries: [{ staffId: a.id, date: '2026-11-17', status: 'P' }, { staffId: b.id, date: '2026-11-17', status: 'A' }] }, NEW_OWNER);
  await h.mark({ shopId: id, entries: [{ staffId: b.id, date: '2026-11-17', status: 'H' }], reason: 'Came after lunch' }, NEW_OWNER);
  await rejects(h.mark({ shopId: id, entries: [{ staffId: b.id, date: '2026-12-30', status: 'P' }] }, NEW_OWNER), 'invalid-argument');
  assert.equal(db._store.get(`staff360/${id}/marks/att_${b.id}_2026-11`).days['2026-11-17'].m, 'H');
  const reg = await h.register({ shopId: id, date: '2026-11-17' }, NEW_OWNER);
  assert.equal(reg.detailed, false);
  assert.deepEqual(reg.rows.map((r) => [r.name, r.status]).sort(), [['Neha Gupta', 'H'], ['Ravi Kumar', 'P']]);
  assert.equal(reg.rows[0].checkInGps, undefined, 'Basic register has no GPS detail');
  const audit = (await h.listAudit({ shopId: id }, NEW_OWNER)).items.filter((x) => x.type === 'manual_mark');
  const change = audit.find((x) => x.from === 'A' && x.to === 'H');
  assert.ok(change && change.server === true && change.reason === 'Came after lunch' && change.actorUid === 'newOwner');
  const rep = await h.report({ shopId: id, from: '2026-11-01', to: '2026-11-17' }, NEW_OWNER);
  assert.equal(rep.total.P, 1); assert.equal(rep.total.H, 1);
});

test('standalone: employee logs in by phone, sees only own business, punches on Premium', async () => {
  const { h, db } = setup();
  const { id } = await h.createOrg({ name: 'Sharma Clinic' }, NEW_OWNER);
  const a = await h.staffSave({ shopId: id, name: 'Ravi Kumar', role: 'Receptionist', phone: '9800000002', canLogin: true }, NEW_OWNER);
  const t = await h.myTenants({}, ORG_EMP);
  assert.deepEqual(t.tenants, [{ id, name: 'Sharma Clinic', kind: 'org', role: 'employee' }]);
  await rejects(h.punch({ shopId: id, action: 'in', gps: gps(T0) }, ORG_EMP), 'failed-precondition', /premium/);
  await grant(h, id, 'premium');
  const p = await h.punch({ shopId: id, action: 'in', gps: gps(T0) }, ORG_EMP);
  assert.equal(p.punch.inHm, '09:15');
  assert.equal(db._store.get(`staff360/${id}/marks/att_${a.id}_2026-11`).days['2026-11-17'].m, 'P', 'mirrored into the org register');
  for (const fn of ['staffRoster', 'register', 'mark', 'listAudit']) await rejects(h[fn]({ shopId: id, entries: [{}] }, ORG_EMP), 'permission-denied');
  await rejects(h.getState({ shopId: id }, OWNER_A), 'permission-denied');
  await rejects(h.staffSave({ shopId: id, name: 'Hack' }, OWNER_A), 'permission-denied');
  // Turning the login off locks them out immediately.
  await h.staffSave({ shopId: id, id: a.id, name: 'Ravi Kumar', role: 'Receptionist', canLogin: false }, NEW_OWNER);
  await rejects(h.getState({ shopId: id }, ORG_EMP), 'permission-denied');
  assert.deepEqual((await h.myTenants({}, ORG_EMP)).tenants, []);
});

test('standalone: limits and guards', async () => {
  const { h } = setup();
  for (let i = 0; i < 3; i++) await h.createOrg({ name: 'Biz ' + i }, NEW_OWNER);
  await rejects(h.createOrg({ name: 'Biz 4' }, NEW_OWNER), 'resource-exhausted');
  await rejects(h.createOrg({ name: 'x' }, OWNER_A), 'invalid-argument');
  await rejects(h.getState({ shopId: 's360_doesnotexist0' }, NEW_OWNER), 'not-found');
  const { id } = await h.createOrg({ name: 'Other Biz' }, OWNER_A);
  const m = await h.staffSave({ shopId: id, name: 'Asha', role: 'Staff', phone: '9800000002', canLogin: true }, OWNER_A);
  assert.ok(m.id);
  await h.adminSetPlanConfig({ basic: { maxStaff: 1 } }, ADMIN);
  await rejects(h.staffSave({ shopId: id, name: 'Second' }, OWNER_A), 'resource-exhausted', /allows 1/);
});

test('HisaabNow shop on the website: same data, stylist without app login gets a Staff360 login', async () => {
  const { h, db } = setup();
  await grant(h, 'A', 'premium');
  const t = await h.myTenants({}, OWNER_A);
  assert.ok(t.tenants.find((x) => x.id === 'A' && x.kind === 'shop' && x.role === 'owner'));
  await rejects(h.staffSave({ shopId: 'A', name: 'New person' }, OWNER_A), 'failed-precondition', /HisaabNow app/);
  await rejects(h.staffSave({ shopId: 'A', id: '+919111111111', canLogin: true }, OWNER_A), 'invalid-argument');
  await h.staffSave({ shopId: 'A', id: 'riya', canLogin: true }, OWNER_A);
  const RIYA = { uid: 'riyaUid', token: { phone_number: '+919444444444' } };
  assert.equal((await h.getState({ shopId: 'A' }, RIYA)).role, 'employee');
  const p = await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, RIYA);
  assert.ok(p.ok);
  assert.equal(db._store.get('shops/A/agents/att_riya_2026-11').days['2026-11-17'].m, 'P', 'shop tenant marks stay where the app reads them');
  await h.mark({ shopId: 'A', entries: [{ staffId: 'amit', date: '2026-11-16', status: 'L' }] }, MGR_A);
  assert.equal(db._store.get('shops/A/agents/att_amit_2026-11').days['2026-11-16'].m, 'L');
  // App roster sync keeps the website's login flag.
  await h.syncRoster({ shopId: 'A', staff: [{ id: 'amit', name: 'Amit Kumar', phone: '9111111111' }, { id: 'riya', name: 'Riya Sharma', phone: '9444444444' }] }, OWNER_A);
  assert.equal(db._store.get('staff360/A/roster/riya').canLogin, true);
});

test('v2 UI: records range, staff details, shift break/colour, leave type and on-behalf leave, settings', async () => {
  const { h, setNow } = setup();
  await rejects(h.records({ shopId: 'A' }, OWNER_B), 'permission-denied');
  await rejects(h.records({ shopId: 'A' }, EMP_A), 'permission-denied');
  await h.mark({ shopId: 'A', entries: [{ staffId: 'riya', date: '2026-11-16', status: 'P', in: '10:05' }] }, OWNER_A);
  let r = await h.records({ shopId: 'A', from: '2026-11-10', to: '2026-11-30' }, OWNER_A);
  assert.equal(r.to, '2026-11-17'); assert.equal(r.detailed, false);
  const riya = r.rows.find((x) => x.staffId === 'riya');
  assert.deepEqual(riya.days, [{ date: '2026-11-16', status: 'P', inHm: '10:05', outHm: '' }]);
  await rejects(h.records({ shopId: 'A', from: '2026-01-01', to: '2026-11-17' }, OWNER_A), 'invalid-argument');

  await grant(h, 'A', 'premium');
  await h.saveShift({ shopId: 'A', name: 'Morning', start: '09:00', end: '18:00', graceMin: 10, breakMin: 45, color: 'blue', staffIds: ['amit'] }, OWNER_A);
  const sh = (await h.listShifts({ shopId: 'A' }, OWNER_A)).shifts[0];
  assert.equal(sh.breakMin, 45); assert.equal(sh.color, 'blue');
  await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A); // 09:15: past the 10 min grace, late counted from 09:00
  r = await h.records({ shopId: 'A', from: '2026-11-17', to: '2026-11-17' }, OWNER_A);
  const amit = r.rows.find((x) => x.staffId === 'amit').days[0];
  assert.equal(amit.lateMin, 15); assert.equal(amit.gps.accuracy, 20); assert.equal(r.detailed, true);

  // HisaabNow shop: Staff360-only details can be set, empCode unique
  await h.staffSave({ shopId: 'A', id: 'riya', weeklyOff: 1, empType: 'Part-time', empCode: 'st-01', joinedDate: '2025-02-01' }, OWNER_A);
  await rejects(h.staffSave({ shopId: 'A', id: 'meena', empCode: 'ST-01' }, OWNER_A), 'already-exists');
  const ro = (await h.staffRoster({ shopId: 'A' }, OWNER_A)).staff.find((x) => x.id === 'riya');
  assert.equal(ro.weeklyOff, 1); assert.equal(ro.empType, 'Part-time'); assert.equal(ro.empCode, 'ST-01'); assert.equal(ro.joinedDate, '2025-02-01');

  // Leave type; owner files on behalf of a staff member; employee cannot file for someone else
  await h.submitRequest({ shopId: 'A', type: 'leave', fromDate: '2026-11-20', toDate: '2026-11-21', reason: 'Wedding', leaveType: 'Casual', staffId: 'riya' }, OWNER_A);
  await h.submitRequest({ shopId: 'A', type: 'leave', fromDate: '2026-11-22', reason: 'Fever', leaveType: 'Sick', staffId: 'riya' }, EMP_A);
  const items = (await h.listRequests({ shopId: 'A' }, OWNER_A)).items;
  assert.ok(items.some((i) => i.staffId === 'riya' && i.leaveType === 'Casual'));
  assert.ok(items.some((i) => i.staffId === 'amit' && i.leaveType === 'Sick'), 'employee request is always for themselves');

  // Settings extras; shops cannot rename here
  const s = await h.saveSettings({ shopId: 'A', hoursPerDay: 9, defaultGraceMin: 15, autoLate: false, perms: { managerSalary: true }, gpsPolicy: 'allow_without' }, OWNER_A);
  assert.equal(s.settings.hoursPerDay, 9); assert.equal(s.settings.perms.managerSalary, true); assert.equal(s.settings.autoLate, false);
  await rejects(h.saveSettings({ shopId: 'A', businessName: 'New' }, OWNER_A), 'failed-precondition');
  await rejects(h.saveSettings({ shopId: 'A', hoursPerDay: 40 }, OWNER_A), 'invalid-argument');
  setNow(T0);
});

test('round 2: shop-distance check, auto half-day, auto absent', async () => {
  const { h, setNow, db } = setup();
  await grant(h, 'A', 'premium');
  await h.saveShift({ shopId: 'A', name: 'Morning', start: '09:00', end: '18:00', graceMin: 10, staffIds: ['amit'] }, OWNER_A);
  await rejects(h.saveSettings({ shopId: 'A', geofence: { mode: 'block' } }, OWNER_A), 'invalid-argument');
  // Shop ~1.1 km north of where Amit stands; 200 m radius, block.
  await h.saveSettings({ shopId: 'A', geofence: { mode: 'block', lat: 28.5455, lng: 77.391, radiusM: 200 }, autoHalfDay: true, halfDayBelowHours: 5 }, OWNER_A);
  await rejects(h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A), 'failed-precondition', /outside_radius:11\d\d/);
  // Flag mode: allowed, but recorded as outside with the distance.
  await h.saveSettings({ shopId: 'A', geofence: { mode: 'flag', lat: 28.5455, lng: 77.391, radiusM: 200 } }, OWNER_A);
  const r = await h.punch({ shopId: 'A', action: 'in', gps: gps(T0) }, EMP_A);
  assert.equal(r.punch.checkInGps.outside, true); assert.ok(r.punch.checkInGps.distanceM > 1000);
  const rec = (await h.records({ shopId: 'A', from: '2026-11-17', to: '2026-11-17' }, OWNER_A)).rows.find((x) => x.staffId === 'amit').days[0];
  assert.equal(rec.gps.outside, true);
  // Inside the radius (accuracy is taken into account)
  await h.saveSettings({ shopId: 'A', geofence: { mode: 'block', lat: 28.5365, lng: 77.391, radiusM: 100 } }, OWNER_A);
  const st = await h.getState({ shopId: 'A' }, EMP_A);
  assert.equal(st.me.fence.mode, 'block'); assert.equal(st.me.fence.lat, undefined, 'shop coordinates are not sent to staff');

  // Auto half-day: check out after 3 hours → H, with an audit entry
  setNow(T0 + 3 * 3600e3);
  await h.punch({ shopId: 'A', action: 'out', gps: gps(T0 + 3 * 3600e3) }, EMP_A);
  let day = (await h.records({ shopId: 'A', from: '2026-11-17', to: '2026-11-17' }, OWNER_A)).rows.find((x) => x.staffId === 'amit').days[0];
  assert.equal(day.status, 'H');
  assert.ok((await h.listAudit({ shopId: 'A' }, OWNER_A)).items.some((a) => a.type === 'auto_mark' && a.to === 'H'));

  // Auto absent: only staff who check in on their phone and were expected
  await h.staffSave({ shopId: 'A', id: 'riya', phone: '9444444444', canLogin: true }, OWNER_A);
  await h.staffSave({ shopId: 'A', id: 'meena', canLogin: true, phone: '9222222222', weeklyOff: 2 }, OWNER_A); // Tuesday off
  await rejects(h.autoAbsent({ shopId: 'A', date: '2026-11-17' }, EMP_A), 'permission-denied');
  const out = await h.autoAbsent({ shopId: 'A', date: '2026-11-17' }, OWNER_A);
  day = (await h.records({ shopId: 'A', from: '2026-11-17', to: '2026-11-17' }, OWNER_A)).rows;
  assert.equal(day.find((x) => x.staffId === 'riya').days[0].status, 'A');
  assert.equal(day.find((x) => x.staffId === 'amit').days[0].status, 'H', 'checked-in staff untouched');
  assert.equal(day.find((x) => x.staffId === 'meena').days.length, 0, 'weekly off untouched');
  assert.equal(out.marked, 1);
  // Scheduled run: only after 23:00, once per day, only when switched on
  await h.saveSettings({ shopId: 'A', autoAbsent: true }, OWNER_A);
  setNow(Date.parse('2026-11-17T17:40:00Z')); // 23:10 IST
  assert.equal((await h.runAutoAbsent()).marked, 0, 'already marked');
  assert.equal(db._store.get('staff360/A').lastAutoAbsent, '2026-11-17');
  setNow(T0);
});

test('AI: provider error falls back to the fixed-rule answer', async () => {
  const ai = { configured: () => true, answer: async () => { throw new Error('ai_http_404'); }, summarise: async () => { throw new Error('x'); } };
  const { h } = setup({ ai });
  await grant(h, 'A', 'kingpro');
  const r = await h.aiAsk({ shopId: 'A', question: 'Who was absent this month?' }, OWNER_A);
  assert.equal(r.source, 'rules');
  const d = await h.aiDashboard({ shopId: 'A' }, OWNER_A);
  assert.equal(d.narrativeSource, 'template');
});

test('AI adapter: OpenAI request uses max_completion_tokens and the configured model', async () => {
  let sent = null;
  const f = async (url, o) => { sent = { url, body: JSON.parse(o.body), auth: o.headers.authorization }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'Two absences.' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }) }; };
  const ai = createAI({ STAFF360_AI_PROVIDER: 'openai', STAFF360_AI_MODEL: 'gpt-5.6-terra', OPENAI_API_KEY: 'sk-test' }, f);
  assert.equal(ai.configured(), true);
  const r = await ai.summarise('{}');
  assert.equal(r.text, 'Two absences.');
  assert.equal(sent.body.model, 'gpt-5.6-terra'); assert.equal(sent.body.max_completion_tokens, 2000); assert.equal(sent.body.max_tokens, undefined);
  assert.equal(sent.auth, 'Bearer sk-test');
  assert.equal(createAI({ STAFF360_AI_PROVIDER: 'openai', STAFF360_AI_MODEL: 'm' }, f).configured(), false, 'no key = rules');
});
