/* HisaabNow Staff360 — pure logic (no Firebase imports, fully unit-testable).
 *
 * Everything that decides money, lateness, plan access or what the AI is
 * allowed to say lives here so it can be tested without an emulator.
 */
'use strict';

/* ───────────────────────── Plans & entitlements ───────────────────────── */

const PLAN_ORDER = ['basic', 'premium', 'kingpro'];

/* Approved prices and staff limits (Nov 2026). THE ONLY Staff360 price table:
 * PayU checkout (payu.js) charges from here, and the app and website show the
 * same numbers. Change a price here, on hisaabnow.com/staff360 and in the app's
 * plans page in the same commit.
 *   priceInr  charged per period;  months  length of one paid period
 *   maxStaff  null = no limit */
const PLANS = {
  basic:   { id: 'basic',   name: 'Basic',    rank: 1, priceInr: 0,    months: 0,  maxStaff: 2 },
  premium: { id: 'premium', name: 'Premium',  rank: 2, priceInr: 999,  months: 1,  maxStaff: 10 },
  kingpro: { id: 'kingpro', name: 'King PRO', rank: 3, priceInr: 4999, months: 12, maxStaff: null },
};
const MONTH_MS = 30.4375 * 24 * 3600 * 1000;
const GRACE_MS = 7 * 24 * 3600 * 1000;

/* feature -> minimum plan rank. One table; UI and server both read it. */
const FEATURES = {
  staff_manage: 1, manual_attendance: 1, daily_register: 1, history_basic: 1, report_basic: 1, audit_log: 1,
  self_checkin: 2, gps_punch: 2, late_tracking: 2, working_hours: 2, shifts: 2,
  leave_requests: 2, history_detailed: 2, report_detailed: 2, report_export: 2, settings: 2,
  ai_dashboard: 3, ai_assistant: 3, ai_anomalies: 3, ai_insights: 3, ai_summary: 3,
  ai_salary: 3, ai_availability: 3, whatsapp_reports: 3,
};

/* Admins may change staff limits in staff360Config/plans (maxStaff: a number,
 * or 0 for no limit). Prices are NOT overridable: they live only in PLANS. */
function mergePlanConfig(cfg) {
  const out = {};
  for (const id of PLAN_ORDER) {
    const base = PLANS[id];
    const o = (cfg && cfg[id]) || {};
    const max = o.maxStaff;
    out[id] = Object.assign({}, base, {
      maxStaff: max === 0 ? null : Number.isInteger(max) && max > 0 ? max : base.maxStaff,
      // Older screens read a yearly price.
      priceYearInr: base.months === 12 ? base.priceInr : null,
    });
  }
  return out;
}

/* The entitlement after paying for `months` of `planId`.
 *  - Same plan still running: the new period starts when the current one ends.
 *  - Different plan still running: what's left of it is converted to time on
 *    the new plan at the same rupee value, then the new period is added.
 *  - Nothing running: starts now. */
function extendEntitlement(cur, planId, months, nowMs) {
  const p = PLANS[planId];
  if (!p || !p.priceInr || !(months > 0)) throw new Error('bad plan');
  let start = nowMs, creditMs = 0;
  const end = cur && cur.status === 'active' ? Number(cur.endAt) || 0 : 0;
  if (end > nowMs && PLANS[cur.planId]) {
    if (cur.planId === planId) start = end;
    else {
      const q = PLANS[cur.planId];
      const perMonth = (x) => (x.priceInr && x.months ? x.priceInr / x.months : 0);
      if (perMonth(q) && perMonth(p)) creditMs = Math.round((end - nowMs) * perMonth(q) / perMonth(p));
    }
  }
  const endAt = Math.round(start + creditMs + months * MONTH_MS);
  return {
    planId, status: 'active', endAt, graceUntil: endAt + GRACE_MS, creditMs,
    startAt: cur && cur.status === 'active' && cur.planId === planId && end > nowMs && cur.startAt ? cur.startAt : nowMs,
  };
}

/* Resolve the plan a shop is entitled to RIGHT NOW from the server-owned
 * entitlement doc (staff360Entitlements/{shopId}). No doc = Basic.
 * Downgrade/expiry never deletes data; it only lowers the rank. */
function resolveEntitlement(doc, nowMs) {
  const res = { planId: 'basic', status: 'none', inGrace: false, endAt: null, lapsedFrom: null };
  if (!doc || !doc.planId || !PLANS[doc.planId]) return res;
  const end = Number(doc.endAt) || 0;
  const grace = Number(doc.graceUntil) || 0;
  const active = doc.status === 'active';
  res.endAt = end || null;
  if (active && (end === 0 || nowMs < end)) {
    return Object.assign(res, { planId: doc.planId, status: 'active' });
  }
  if (active && grace && nowMs < grace) {
    return Object.assign(res, { planId: doc.planId, status: 'grace', inGrace: true });
  }
  return Object.assign(res, { status: active ? 'expired' : (doc.status || 'inactive'), lapsedFrom: doc.planId });
}

function rankOf(planId) { return (PLANS[planId] && PLANS[planId].rank) || 1; }
function can(planId, feature) {
  const need = FEATURES[feature];
  if (!need) return false;
  return rankOf(planId) >= need;
}
function entitlementMap(planId) {
  const m = {};
  for (const f of Object.keys(FEATURES)) m[f] = can(planId, f);
  return m;
}

/* ─────────────────────────────── Time ─────────────────────────────── */

const DEFAULT_TZ = 'Asia/Kolkata';

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

/* Local calendar parts for an instant in a named zone. */
function zoned(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz(tz) ? tz : DEFAULT_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hm: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: wd,
  };
}

function hmToMin(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function dateRange(from, to, cap) {
  const out = [];
  let d = from;
  while (d <= to && out.length < (cap || 400)) { out.push(d); d = addDays(d, 1); }
  return out;
}

/* ─────────────────────────── Shift maths ─────────────────────────── */

function shiftInfo(shift) {
  if (!shift) return null;
  const s = hmToMin(shift.start), e = hmToMin(shift.end);
  if (s == null || e == null) return null;
  const overnight = e <= s;
  const length = overnight ? (1440 - s + e) : (e - s);
  return { start: s, end: e, overnight, length, grace: Math.max(0, Math.min(180, Number(shift.graceMin) || 0)) };
}

/* Minutes late for a check-in that happened at local minute `inMin` on the
 * shift's own start date. Grace is a tolerance, not a discount: a check-in
 * after start+grace counts as late by (inMin - start). */
function lateMinutes(shift, inMin) {
  const si = shiftInfo(shift);
  if (!si || inMin == null) return 0;
  let diff = inMin - si.start;
  if (diff < -720) diff += 1440; // checked in just after midnight for a late-evening start
  return diff > si.grace ? diff : 0;
}

/* Minutes left before the shift end. Overnight-aware: elapsed is measured
 * from the shift start on the attendance date. */
function earlyLeaveMinutes(shift, inMs, outMs, inMin) {
  const si = shiftInfo(shift);
  if (!si || !inMs || !outMs) return 0;
  // Minutes from check-in to scheduled end (from the check-in's local clock).
  let toEnd = si.start + si.length - inMin;
  if (inMin < si.start - 720) toEnd -= 1440;
  const worked = Math.round((outMs - inMs) / 60000);
  const early = toEnd - worked;
  return early > 0 ? early : 0;
}

function workedMinutes(inMs, outMs) {
  if (!inMs || !outMs || outMs <= inMs) return 0;
  return Math.round((outMs - inMs) / 60000);
}

/* ─────────────────────────── GPS validation ─────────────────────────── */

function cleanGps(g, nowMs) {
  if (!g || typeof g !== 'object') return null;
  const lat = Number(g.lat), lng = Number(g.lng), acc = Number(g.accuracy), at = Number(g.capturedAt);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (!Number.isFinite(acc) || acc <= 0 || acc > 100000) return null;
  if (!Number.isFinite(at) || Math.abs(nowMs - at) > 10 * 60 * 1000) return null; // stale / replayed fix
  return {
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
    accuracy: Math.round(acc), capturedAt: at,
  };
}
const GPS_ERRORS = ['denied', 'unavailable', 'timeout', 'unsupported'];

/* ─────────────────────── Register: unify data ───────────────────────
 * Two sources feed one day view per staff:
 *   marks   — Step ATT month docs: { m:"P|H|A|L|W", i:"HH:MM", o:"HH:MM" }
 *   punches — Staff360 server punches (premium)
 * A punch implies Present unless a manual mark says otherwise.
 */
function dayRecord(mark, punch) {
  const m = mark && mark.m ? mark.m : (punch && punch.checkInAt ? 'P' : '');
  return {
    status: m,
    checkInAt: punch ? punch.checkInAt || null : null,
    checkOutAt: punch ? punch.checkOutAt || null : null,
    inHm: (punch && punch.inHm) || (mark && mark.i) || '',
    outHm: (punch && punch.outHm) || (mark && mark.o) || '',
    lateMin: punch ? punch.lateMinutes || 0 : 0,
    earlyMin: punch ? punch.earlyLeaveMinutes || 0 : 0,
    workedMin: punch ? punch.workedMinutes || 0 : 0,
    incomplete: !!(punch && punch.checkInAt && !punch.checkOutAt),
    punchId: punch ? punch.id : null,
  };
}

/* Aggregate per-staff totals for a date range.
 * staff: [{id,name}], marksByStaff: {sid:{date:mark}}, punchesByStaff: {sid:{date:punch}} */
function aggregate(staff, marksByStaff, punchesByStaff, dates, opts) {
  const today = opts && opts.today;
  const rows = staff.map((s) => {
    const r = { staffId: s.id, name: s.name || 'Staff', P: 0, H: 0, A: 0, L: 0, W: 0, unmarked: 0,
      late: 0, lateMin: 0, earlyLeaves: 0, workedMin: 0, incomplete: 0, days: [] };
    for (const d of dates) {
      const rec = dayRecord(((marksByStaff[s.id] || {})[d]), ((punchesByStaff[s.id] || {})[d]));
      if (r[rec.status] != null) r[rec.status]++;
      else if (!today || d <= today) r.unmarked++;
      if (rec.lateMin > 0) { r.late++; r.lateMin += rec.lateMin; }
      if (rec.earlyMin > 0) r.earlyLeaves++;
      if (rec.incomplete && (!today || d < today)) r.incomplete++;
      r.workedMin += rec.workedMin;
      r.days.push(Object.assign({ date: d }, rec));
    }
    return r;
  });
  const total = rows.reduce((t, r) => {
    for (const k of ['P', 'H', 'A', 'L', 'W', 'unmarked', 'late', 'workedMin', 'incomplete']) t[k] += r[k];
    return t;
  }, { P: 0, H: 0, A: 0, L: 0, W: 0, unmarked: 0, late: 0, workedMin: 0, incomplete: 0 });
  return { rows, total };
}

/* ─────────────────────── King PRO: anomalies ───────────────────────
 * Rule-based, explainable, neutral. Each signal carries its evidence. */
function detectAnomalies(agg, period, opts) {
  const lateThreshold = (opts && opts.lateThreshold) || 3;
  const out = [];
  for (const r of agg.rows) {
    const lateDays = r.days.filter((d) => d.lateMin > 0);
    if (lateDays.length >= lateThreshold) {
      out.push({
        id: `late_${r.staffId}_${period.from}_${period.to}`, type: 'repeated_late', staffId: r.staffId, staffName: r.name,
        title: 'Repeated late arrivals', severity: lateDays.length >= lateThreshold * 2 ? 'high' : 'medium',
        summary: `${lateDays.length} arrivals after the grace period between ${period.from} and ${period.to}.`,
        evidence: lateDays.map((d) => ({ date: d.date, detail: `In ${d.inHm} · ${d.lateMin} min late`, punchId: d.punchId })),
        period,
      });
    }
    const missing = r.days.filter((d) => d.incomplete && (!opts || !opts.today || d.date < opts.today));
    if (missing.length) {
      out.push({
        id: `nocheckout_${r.staffId}_${period.from}_${period.to}`, type: 'missing_checkout', staffId: r.staffId, staffName: r.name,
        title: 'Missed check-outs', severity: missing.length >= 3 ? 'medium' : 'low',
        summary: `${missing.length} day(s) with a check-in but no check-out. Hours for those days are not counted.`,
        evidence: missing.map((d) => ({ date: d.date, detail: `Checked in ${d.inHm}, no check-out`, punchId: d.punchId })),
        period,
      });
    }
    // Unusual timing: check-in more than 3h away from this person's median check-in.
    const ins = r.days.filter((d) => d.inHm).map((d) => ({ d, m: hmToMin(d.inHm) })).filter((x) => x.m != null);
    if (ins.length >= 5) {
      const sorted = ins.map((x) => x.m).sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const odd = ins.filter((x) => Math.abs(x.m - med) >= 180);
      if (odd.length) {
        out.push({
          id: `timing_${r.staffId}_${period.from}_${period.to}`, type: 'unusual_timing', staffId: r.staffId, staffName: r.name,
          title: 'Unusual check-in time', severity: 'low',
          summary: `${odd.length} check-in(s) at least 3 hours away from the usual time (${minToHm(med)}).`,
          evidence: odd.map((x) => ({ date: x.d.date, detail: `In ${x.d.inHm} (usual ${minToHm(med)})`, punchId: x.d.punchId })),
          period,
        });
      }
    }
  }
  return out;
}

/* Duplicate punches are detected from the raw punch event log. */
function detectDuplicatePunches(events, period) {
  const by = {};
  for (const e of events) {
    const k = `${e.staffId}|${e.attendanceDate}|${e.action}`;
    (by[k] = by[k] || []).push(e);
  }
  const out = [];
  for (const k of Object.keys(by)) {
    const list = by[k];
    if (list.length < 2) continue;
    const [sid, date, action] = k.split('|');
    out.push({
      id: `dup_${sid}_${date}_${action}`, type: 'duplicate_punch', staffId: sid, staffName: list[0].staffName || 'Staff',
      title: 'Repeated punch attempts', severity: 'low',
      summary: `${list.length} ${action === 'in' ? 'check-in' : 'check-out'} attempts on ${date}. Only the first was recorded.`,
      evidence: list.map((e) => ({ date, detail: `${e.outcome} at ${e.hm}` })), period,
    });
  }
  return out;
}

function minToHm(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* ─────────────────────── King PRO: salary draft ───────────────────────
 * Draft only. Every input and the formula are returned so the UI can show
 * them; the owner can override inputs; approval only flips a status. */
function salaryEstimate(input) {
  const ym = input.ym;
  const dim = daysInMonth(ym);
  const basis = input.basis === 'daily' ? 'daily' : 'monthly';
  const monthly = Math.max(0, Number(input.monthlySalary) || 0);
  const daily = Math.max(0, Number(input.dailyWage) || 0);
  const divisor = Math.max(1, Math.min(31, Number(input.divisor) || dim));
  const perDay = basis === 'daily' ? daily : monthly / divisor;
  const c = input.counts || {};
  const P = +c.P || 0, H = +c.H || 0, W = +c.W || 0, L = +c.L || 0;
  const paidLeave = input.leavePaid !== false;
  const payableDays = P + W + 0.5 * H + (paidLeave ? L : 0);
  const otHours = Math.max(0, Number(input.overtimeHours) || 0);
  const otRate = Math.max(0, Number(input.overtimeRate) || 0);
  const base = perDay * payableDays;
  const ot = otHours * otRate;
  const gross = Math.round(base + ot);
  const advance = Math.max(0, Math.round(Number(input.advance) || 0));
  const missing = [];
  if (basis === 'monthly' && !monthly) missing.push('monthly salary');
  if (basis === 'daily' && !daily) missing.push('daily wage');
  return {
    ym, basis, perDay: Math.round(perDay * 100) / 100, divisor, payableDays, counts: { P, H, W, L },
    leavePaid: paidLeave, overtimeHours: otHours, overtimeRate: otRate,
    base: Math.round(base), overtime: Math.round(ot), gross, advance, net: gross - advance,
    formula: [
      basis === 'monthly' ? `Per day = ₹${monthly} ÷ ${divisor} = ₹${(Math.round(perDay * 100) / 100)}` : `Per day = ₹${daily} (daily wage)`,
      `Payable days = Present ${P} + Week off ${W} + ½ × Half-day ${H}${paidLeave ? ` + Approved leave ${L}` : ' (leave unpaid)'} = ${payableDays}`,
      `Base = ₹${Math.round(perDay * 100) / 100} × ${payableDays} = ₹${Math.round(base)}`,
      `Overtime = ${otHours} h × ₹${otRate} = ₹${Math.round(ot)}`,
      `Estimated gross = ₹${gross}${advance ? ` · Advances ₹${advance} · Net ₹${gross - advance}` : ''}`,
    ],
    missing,
    draft: true,
  };
}

/* Overtime from punches: minutes beyond shift length on days with both punches. */
function overtimeHours(days, shift) {
  const si = shiftInfo(shift);
  if (!si) return 0;
  let m = 0;
  for (const d of days) if (d.workedMin > si.length) m += d.workedMin - si.length;
  return Math.round((m / 60) * 10) / 10;
}

/* ─────────────────── King PRO: availability forecast ───────────────────
 * For a target date, look at the same weekday over the lookback window.
 * Only reports when there are >= minSamples observed same-weekdays. */
function availabilityForecast(agg, targetDate, lookbackWeeks, minSamples) {
  const wd = weekdayOf(targetDate);
  const need = minSamples || 4;
  const rows = [];
  let sufficient = 0;
  for (const r of agg.rows) {
    const same = r.days.filter((d) => weekdayOf(d.date) === wd && d.status);
    if (same.length < need) { rows.push({ staffId: r.staffId, name: r.name, samples: same.length, likely: null }); continue; }
    sufficient++;
    const avail = same.filter((d) => d.status === 'P' || d.status === 'H').length;
    rows.push({ staffId: r.staffId, name: r.name, samples: same.length, rate: avail / same.length, likely: avail / same.length >= 0.5 });
  }
  const known = rows.filter((x) => x.likely != null);
  return {
    targetDate, weekday: wd, lookbackWeeks, minSamples: need,
    sufficient: known.length > 0 && sufficient >= Math.ceil(agg.rows.length / 2),
    expected: known.filter((x) => x.likely).length,
    of: agg.rows.length,
    unknown: rows.filter((x) => x.likely == null).length,
    rows,
    limitation: `Based only on past ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]}s in the last ${lookbackWeeks} weeks. Leave requests, festivals and shift changes are not predicted.`,
  };
}

/* ─────────────────── King PRO: assistant intent router ───────────────────
 * Used when no AI provider is configured (clearly labelled), and as the tool
 * catalogue the LLM may call when one is. */
function routeQuestion(q, staffNames) {
  const s = String(q || '').toLowerCase();
  const nameHit = (staffNames || []).find((n) => {
    const first = String(n.name || '').toLowerCase().split(/\s+/)[0];
    return first && first.length > 1 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s);
  });
  const period = /last month|pichle mahine/.test(s) ? 'last_month' : /today|aaj/.test(s) ? 'today' : /week|hafte/.test(s) ? 'this_week' : 'this_month';
  const nMatch = /(\d+)\s*\+|more than (\d+)|(\d+) or more|at least (\d+)/.exec(s);
  const n = nMatch ? Number(nMatch[1] || nMatch[2] || nMatch[3] || nMatch[4]) + (nMatch[2] ? 1 : 0) : null;
  if (/absent|not (come|in)|nahi aaya|missing/.test(s)) return { tool: 'absent', args: { period: /month|week/.test(s) ? period : 'today' } };
  if (/salary|payout|payroll|tankhwah/.test(s)) return { tool: 'salary', args: { period: 'this_month' } };
  if (/(available|tomorrow|kal)/.test(s)) return { tool: 'availability', args: {} };
  if (/irregular|unusual|anomal|pattern/.test(s)) return { tool: 'anomalies', args: { period } };
  if (/hour|ghante|worked/.test(s) && nameHit) return { tool: 'hours', args: { staffId: nameHit.id, period } };
  if (/hour|ghante|worked/.test(s)) return { tool: 'hours', args: { period } };
  if (/late|der/.test(s) && n) return { tool: 'late_at_least', args: { n, period } };
  if (/late|der/.test(s)) return { tool: 'late_leaders', args: { period } };
  if (/present|aaye/.test(s)) return { tool: 'present', args: { period: 'today' } };
  return { tool: null, args: {} };
}

function periodRange(period, todayStr) {
  const ym = todayStr.slice(0, 7);
  if (period === 'today') return { from: todayStr, to: todayStr, label: 'Today' };
  if (period === 'this_week') {
    const wd = weekdayOf(todayStr);
    const from = addDays(todayStr, -((wd + 6) % 7));
    return { from, to: todayStr, label: 'This week' };
  }
  if (period === 'last_month') {
    const first = addDays(ym + '-01', -1).slice(0, 7);
    return { from: first + '-01', to: first + '-' + String(daysInMonth(first)).padStart(2, '0'), label: 'Last month' };
  }
  return { from: ym + '-01', to: todayStr, label: 'This month' };
}

/* Runs one assistant tool against already-authorised aggregates.
 * Returns { text, items:[{staffId,name,value,evidence}], period } —
 * every number comes from `agg`. */
function runTool(tool, args, ctx) {
  const period = ctx.period;
  const rows = ctx.agg.rows;
  const fmtH = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
  const pr = `${period.label} (${period.from}${period.from !== period.to ? ' to ' + period.to : ''})`;
  if (tool === 'absent' || tool === 'present') {
    const key = tool === 'absent' ? 'A' : 'P';
    const items = rows.filter((r) => r[key] > 0).map((r) => ({ staffId: r.staffId, name: r.name, value: r[key],
      evidence: r.days.filter((d) => d.status === key).map((d) => d.date) }));
    const unmarked = rows.filter((r) => r.unmarked > 0 && period.from === period.to).map((r) => r.name);
    let text = items.length
      ? `${items.length} ${items.length === 1 ? 'person' : 'people'} marked ${tool === 'absent' ? 'absent' : 'present'} · ${pr}.`
      : `No one is marked ${tool === 'absent' ? 'absent' : 'present'} · ${pr}.`;
    if (unmarked.length) text += ` Not marked yet: ${unmarked.join(', ')}.`;
    return { text, items, period };
  }
  if (tool === 'late_leaders' || tool === 'late_at_least') {
    const min = tool === 'late_at_least' ? Math.max(1, args.n || 3) : 1;
    const items = rows.filter((r) => r.late >= min).sort((a, b) => b.late - a.late)
      .map((r) => ({ staffId: r.staffId, name: r.name, value: r.late,
        evidence: r.days.filter((d) => d.lateMin > 0).map((d) => `${d.date} (${d.lateMin} min)`) }));
    const text = items.length
      ? `${items.length} ${items.length === 1 ? 'employee' : 'employees'} with ${min > 1 ? min + '+ ' : ''}late arrivals · ${pr}.`
      : `No late arrivals${min > 1 ? ` of ${min} or more` : ''} recorded · ${pr}. Late tracking needs a shift assigned and employee check-ins.`;
    return { text, items, period };
  }
  if (tool === 'hours') {
    const pick = args.staffId ? rows.filter((r) => r.staffId === args.staffId) : rows;
    const items = pick.map((r) => ({ staffId: r.staffId, name: r.name, value: fmtH(r.workedMin),
      evidence: r.days.filter((d) => d.workedMin > 0).map((d) => `${d.date}: ${fmtH(d.workedMin)}`),
      note: r.incomplete ? `${r.incomplete} day(s) without check-out not counted` : '' }));
    const text = args.staffId && !pick.length ? 'I could not find that employee.' :
      `Worked hours from check-in/check-out records · ${pr}. Days marked manually without punches have no hours.`;
    return { text, items, period };
  }
  if (tool === 'anomalies') {
    const list = ctx.anomalies || [];
    return { text: list.length ? `${list.length} pattern(s) to review · ${pr}.` : `No patterns to review · ${pr}.`,
      items: list.map((a) => ({ staffId: a.staffId, name: a.staffName, value: a.title, evidence: a.evidence.map((e) => `${e.date}: ${e.detail}`) })), period };
  }
  return { text: 'I can answer questions about attendance, late arrivals, hours worked, salary estimates and availability. Try one of the suggested questions.', items: [], period };
}

/* Pseudonymise before anything leaves for an AI provider. */
function pseudonymise(text, staff) {
  let out = String(text || '');
  const map = {};
  staff.forEach((s, i) => {
    const tok = `EMP${i + 1}`;
    map[tok] = s.name;
    const parts = String(s.name || '').split(/\s+/).filter((p) => p.length > 1);
    for (const p of [s.name].concat(parts)) {
      if (!p) continue;
      out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), tok);
    }
  });
  return { text: out, map };
}
function reidentify(text, map) {
  return String(text || '').replace(/\bEMP(\d+)\b/g, (t) => map[t] || t);
}

module.exports = {
  PLAN_ORDER, PLANS, FEATURES, mergePlanConfig, extendEntitlement, MONTH_MS, resolveEntitlement, rankOf, can, entitlementMap,
  DEFAULT_TZ, validTz, zoned, hmToMin, minToHm, addDays, weekdayOf, daysInMonth, isDate, dateRange,
  shiftInfo, lateMinutes, earlyLeaveMinutes, workedMinutes, cleanGps, GPS_ERRORS,
  dayRecord, aggregate, detectAnomalies, detectDuplicatePunches, salaryEstimate, overtimeHours,
  availabilityForecast, routeQuestion, periodRange, runTool, pseudonymise, reidentify,
};
