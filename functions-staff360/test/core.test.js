'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../staff360/core');

const IST = 'Asia/Kolkata';
const at = (iso) => Date.parse(iso);

test('plans: approved prices and staff limits; prices cannot be overridden', () => {
  const p = C.mergePlanConfig({});
  assert.deepEqual([p.basic.priceInr, p.premium.priceInr, p.kingpro.priceInr], [0, 999, 4999]);
  assert.deepEqual([p.basic.months, p.premium.months, p.kingpro.months], [0, 1, 12]);
  assert.deepEqual([p.basic.maxStaff, p.premium.maxStaff, p.kingpro.maxStaff], [2, 10, null]);
  assert.equal(p.kingpro.priceYearInr, 4999);
  const q = C.mergePlanConfig({ premium: { priceInr: 1, priceYearInr: 1, maxStaff: 15 }, basic: { maxStaff: 0 } });
  assert.equal(q.premium.priceInr, 999, 'price comes only from core.js');
  assert.equal(q.premium.maxStaff, 15);
  assert.equal(q.basic.maxStaff, null, '0 = no limit');
});

test('extendEntitlement: new, renew early, upgrade with credit, lapsed', () => {
  const t = at('2026-11-19T00:00:00Z'), M = C.MONTH_MS;
  const a = C.extendEntitlement(null, 'premium', 1, t);
  assert.equal(a.endAt, Math.round(t + M)); assert.equal(a.graceUntil, a.endAt + 7 * 864e5); assert.equal(a.startAt, t);
  // Renewing early stacks on the current end date.
  const b = C.extendEntitlement(Object.assign({ status: 'active' }, a), 'premium', 1, t + 10 * 864e5);
  assert.equal(b.endAt, Math.round(a.endAt + M)); assert.equal(b.startAt, t);
  // Premium -> King PRO with half a month left: ₹499.5 of value becomes ~1.2 months of King PRO.
  const half = { planId: 'premium', status: 'active', endAt: t + M / 2 };
  const c = C.extendEntitlement(half, 'kingpro', 12, t);
  const credit = (M / 2) * 999 / (4999 / 12);
  assert.ok(Math.abs(c.endAt - (t + credit + 12 * M)) < 2);
  // Lapsed plan: starts now.
  const d = C.extendEntitlement({ planId: 'premium', status: 'active', endAt: t - 864e5 }, 'premium', 1, t);
  assert.equal(d.endAt, Math.round(t + M));
  assert.throws(() => C.extendEntitlement(null, 'basic', 1, t));
});

test('entitlements: inheritance and gating', () => {
  assert.equal(C.can('basic', 'manual_attendance'), true);
  assert.equal(C.can('basic', 'self_checkin'), false);
  assert.equal(C.can('premium', 'gps_punch'), true);
  assert.equal(C.can('premium', 'ai_assistant'), false);
  assert.equal(C.can('kingpro', 'shifts'), true, 'King PRO inherits Premium');
  assert.equal(C.can('kingpro', 'whatsapp_reports'), true);
  assert.equal(C.can('kingpro', 'face_recognition'), false, 'unknown features are never granted');
});

test('entitlement resolver: active, grace, expired, missing', () => {
  const now = at('2026-11-17T00:00:00Z');
  assert.equal(C.resolveEntitlement(null, now).planId, 'basic');
  assert.equal(C.resolveEntitlement({ planId: 'kingpro', status: 'active', endAt: now + 1 }, now).planId, 'kingpro');
  const g = C.resolveEntitlement({ planId: 'premium', status: 'active', endAt: now - 1, graceUntil: now + 1000 }, now);
  assert.equal(g.planId, 'premium'); assert.equal(g.inGrace, true);
  const e = C.resolveEntitlement({ planId: 'premium', status: 'active', endAt: now - 2000, graceUntil: now - 1000 }, now);
  assert.equal(e.planId, 'basic'); assert.equal(e.lapsedFrom, 'premium');
  assert.equal(C.resolveEntitlement({ planId: 'hacker', status: 'active' }, now).planId, 'basic');
  assert.equal(C.resolveEntitlement({ planId: 'kingpro', status: 'cancelled', endAt: now + 99 }, now).planId, 'basic');
});

test('business timezone decides the attendance date, not UTC', () => {
  // 2026-11-16 20:00 UTC = 2026-11-17 01:30 IST
  const z = C.zoned(at('2026-11-16T20:00:00Z'), IST);
  assert.equal(z.date, '2026-11-17');
  assert.equal(z.hm, '01:30');
  assert.equal(C.zoned(at('2026-11-16T20:00:00Z'), 'Asia/Dubai').date, '2026-11-17');
  assert.equal(C.zoned(at('2026-11-16T20:00:00Z'), 'America/New_York').date, '2026-11-16');
  assert.equal(C.zoned(at('2026-11-16T20:00:00Z'), 'Not/AZone').date, '2026-11-17', 'invalid tz falls back to IST');
});

test('late uses start + grace; on-time inside grace', () => {
  const s = { start: '09:00', end: '18:00', graceMin: 10 };
  assert.equal(C.lateMinutes(s, C.hmToMin('09:10')), 0);
  assert.equal(C.lateMinutes(s, C.hmToMin('09:11')), 11);
  assert.equal(C.lateMinutes(s, C.hmToMin('08:50')), 0);
});

test('overnight shift: length, late after midnight, early leave', () => {
  const s = { start: '22:00', end: '06:00', graceMin: 15 };
  assert.equal(C.shiftInfo(s).overnight, true);
  assert.equal(C.shiftInfo(s).length, 480);
  assert.equal(C.lateMinutes(s, C.hmToMin('22:10')), 0);
  assert.equal(C.lateMinutes(s, C.hmToMin('00:30')), 150, 'check-in after midnight is late, not 21h early');
  const inMs = at('2026-11-17T16:30:00Z'); // 22:00 IST
  const outMs = at('2026-11-18T00:00:00Z'); // 05:30 IST
  assert.equal(C.workedMinutes(inMs, outMs), 450);
  assert.equal(C.earlyLeaveMinutes(s, inMs, outMs, C.hmToMin('22:00')), 30);
});

test('worked minutes never negative; missing checkout = 0', () => {
  assert.equal(C.workedMinutes(1000, null), 0);
  assert.equal(C.workedMinutes(2000, 1000), 0);
});

test('GPS: rejects fake/invalid/stale fixes, never invents coordinates', () => {
  const now = at('2026-11-17T04:00:00Z');
  assert.equal(C.cleanGps(null, now), null);
  assert.equal(C.cleanGps({ lat: 999, lng: 77, accuracy: 10, capturedAt: now }, now), null);
  assert.equal(C.cleanGps({ lat: 28.5, lng: 77.3, accuracy: 0, capturedAt: now }, now), null);
  assert.equal(C.cleanGps({ lat: 28.5, lng: 77.3, accuracy: 20, capturedAt: now - 11 * 60000 }, now), null, 'replayed old fix');
  const g = C.cleanGps({ lat: 28.5355161, lng: 77.3910265, accuracy: 18.4, capturedAt: now - 5000 }, now);
  assert.deepEqual(g, { lat: 28.535516, lng: 77.391027, accuracy: 18, capturedAt: now - 5000 });
});

test('salary estimate shows every input and formula', () => {
  const r = C.salaryEstimate({ ym: '2026-11', basis: 'monthly', monthlySalary: 18000, divisor: 30,
    counts: { P: 22, H: 2, W: 4, L: 1 }, overtimeHours: 4, overtimeRate: 100, advance: 2000 });
  assert.equal(r.payableDays, 22 + 4 + 1 + 1);
  assert.equal(r.perDay, 600);
  assert.equal(r.base, 600 * 28);
  assert.equal(r.overtime, 400);
  assert.equal(r.gross, 17200);
  assert.equal(r.net, 15200);
  assert.equal(r.draft, true);
  assert.ok(r.formula.length >= 4);
  const unpaid = C.salaryEstimate({ ym: '2026-11', basis: 'daily', dailyWage: 500, counts: { P: 10, L: 2 }, leavePaid: false });
  assert.equal(unpaid.gross, 5000);
  assert.deepEqual(C.salaryEstimate({ ym: '2026-11', counts: {} }).missing, ['monthly salary']);
});

function aggFixture() {
  const staff = [{ id: 'a', name: 'Amit Kumar' }, { id: 'r', name: 'Riya Sharma' }];
  const dates = C.dateRange('2026-11-01', '2026-11-10');
  const punches = { a: {}, r: {} };
  const marks = { a: {}, r: {} };
  dates.forEach((d, i) => {
    punches.a[d] = { id: 'a_' + d, checkInAt: 1, checkOutAt: i === 9 ? null : 2, inHm: i < 5 ? '09:25' : '09:05', outHm: '18:00', lateMinutes: i < 5 ? 25 : 0, workedMinutes: 515 };
    if (i % 2) marks.r[d] = { m: 'A' }; else marks.r[d] = { m: 'P' };
  });
  return { staff, marks, punches, dates };
}

test('aggregate + anomalies: evidence-backed, neutral wording', () => {
  const f = aggFixture();
  const agg = C.aggregate(f.staff, f.marks, f.punches, f.dates, { today: '2026-11-11' });
  const a = agg.rows[0];
  assert.equal(a.P, 10); assert.equal(a.late, 5); assert.equal(a.incomplete, 1);
  assert.equal(agg.rows[1].A, 5);
  const list = C.detectAnomalies(agg, { from: '2026-11-01', to: '2026-11-10' }, { lateThreshold: 3, today: '2026-11-11' });
  const late = list.find((x) => x.type === 'repeated_late');
  assert.equal(late.staffId, 'a');
  assert.equal(late.evidence.length, 5);
  assert.ok(list.find((x) => x.type === 'missing_checkout'));
  for (const x of list) assert.doesNotMatch(JSON.stringify(x), /fraud|dishonest|cheat|lazy/i);
});

test('assistant router + tools return only recorded data', () => {
  const f = aggFixture();
  const agg = C.aggregate(f.staff, f.marks, f.punches, f.dates, { today: '2026-11-11' });
  const names = f.staff;
  assert.equal(C.routeQuestion('Who is absent today?', names).tool, 'absent');
  assert.deepEqual(C.routeQuestion('Who has been late more than 3 times this month?', names), { tool: 'late_at_least', args: { n: 4, period: 'this_month' } });
  assert.equal(C.routeQuestion('Show employees with 3+ late arrivals', names).args.n, 3);
  assert.deepEqual(C.routeQuestion('How many hours did Amit work this month?', names), { tool: 'hours', args: { staffId: 'a', period: 'this_month' } });
  assert.equal(C.routeQuestion('What is my estimated salary payout?', names).tool, 'salary');
  assert.equal(C.routeQuestion('How many employees are likely available tomorrow?', names).tool, 'availability');
  assert.equal(C.routeQuestion('Which employees have irregular attendance?', names).tool, 'anomalies');
  const period = { from: '2026-11-01', to: '2026-11-10', label: 'This month' };
  const r = C.runTool('late_at_least', { n: 3 }, { agg, period });
  assert.deepEqual(r.items.map((x) => [x.name, x.value]), [['Amit Kumar', 5]]);
  assert.match(r.text, /2026-11-01 to 2026-11-10/);
  const none = C.runTool('late_at_least', { n: 9 }, { agg, period });
  assert.equal(none.items.length, 0);
  assert.match(none.text, /No late arrivals/);
});

test('availability forecast refuses without enough history', () => {
  const staff = [{ id: 'a', name: 'A' }];
  const dates = C.dateRange('2026-11-01', '2026-11-14');
  const marks = { a: {} };
  dates.forEach((d) => { marks.a[d] = { m: 'P' }; });
  const agg = C.aggregate(staff, marks, {}, dates, {});
  const f = C.availabilityForecast(agg, '2026-11-15', 8, 4);
  assert.equal(f.sufficient, false);
  assert.match(f.limitation, /last 8 weeks/);
});

test('pseudonymise removes names before any AI call', () => {
  const staff = [{ name: 'Amit Kumar' }, { name: 'Riya Sharma' }];
  const p = C.pseudonymise('How many hours did Amit work vs Riya Sharma?', staff);
  assert.doesNotMatch(p.text, /Amit|Riya|Sharma/);
  assert.equal(C.reidentify('EMP1 worked 10h, EMP2 8h', p.map), 'Amit Kumar worked 10h, Riya Sharma 8h');
});
