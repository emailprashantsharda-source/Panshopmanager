/* Staff360 v2 — data store, selectors, actions and plan gating.
 * The UI only talks to S360Store. In this preview it is backed by S360_MOCK and kept in
 * localStorage so the owner screens and the employee portal see the same demo data.
 * In the live build these actions map to the existing staff360* Cloud Functions
 * (staffSave, staffRemove, mark, saveShift, deleteShift, decideRequest, submitRequest, punch…).
 */
(function () {
  'use strict';
  var M = window.S360_MOCK || { today: '1970-01-01', nowMin: 0, business: { name: '', city: '', owner: '' }, businesses: [], staff: [], attendance: [], leaves: [], shifts: [], notifications: [] };
  var backend = null; // live mode: methods that call the staff360* Cloud Functions
  var KEY = 's360v2.data.v1';
  var subs = [];
  var PLANS = ['basic', 'premium', 'kingpro'];
  var PLAN_LABEL = { basic: 'Basic', premium: 'Premium', kingpro: 'King PRO' };
  // Feature → minimum plan. Mirrors functions-staff360/staff360/core.js FEATURES.
  var FEATURE = {
    dashboard: 'basic', staff: 'basic', attendance: 'basic', history: 'basic', reports: 'basic',
    checkin_metrics: 'premium', settings: 'premium', employee_portal: 'premium', gps: 'premium', shifts: 'premium',
    leave: 'premium', reports_advanced: 'premium', employee_login: 'premium',
    ai: 'kingpro', insights: 'kingpro', salary: 'kingpro', anomalies: 'kingpro', whatsapp: 'kingpro',
  };
  var DEFAULT_SETTINGS = {
    business: { name: M.business.name, city: M.business.city, phone: M.business.owner ? '9811000000' : '', owner: M.business.owner },
    rules: { graceMin: 10, hoursPerDay: 8, halfDayBelowHours: 5, gpsRequired: true, allowNoGps: true, autoLate: true, autoHalfDay: false, autoAbsent: false },
    fence: { lat: null, lng: null, radiusM: 200, mode: 'off' },
    whatsapp: { enabled: false, recipient: '', cadence: 'daily', sendTime: '20:00', weekday: 1, providerConfigured: false, log: [] },
    defaultWeeklyOff: 0,
    perms: { requestLeave: true, seeShift: true, managerEdit: true, managerSalary: false },
    notify: { dailySummary: false, lateAlert: false, leaveAlert: true },
  };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function fresh() {
    return { day: M.today, staff: clone(M.staff), attendance: clone(M.attendance), leaves: clone(M.leaves), shifts: clone(M.shifts),
             notifications: clone(M.notifications), settings: clone(DEFAULT_SETTINGS), audit: [], approvals: [], corrections: clone(M.corrections || []) };
  }
  var S = (function () {
    if (!window.S360_MOCK) return fresh();
    try {
      var d = JSON.parse(lsGet(KEY, 'null'));
      if (d && d.day === M.today && d.staff && d.attendance) return d; // demo data refreshes each day
    } catch (e) { /* corrupt → fresh */ }
    return fresh();
  })();
  // Older saved demo data: fill in newer fields.
  (function () {
    S.corrections = S.corrections || clone(M.corrections || []);
    ['fence', 'whatsapp'].forEach(function (k) { if (!S.settings[k]) S.settings[k] = clone(DEFAULT_SETTINGS[k]); });
    Object.keys(DEFAULT_SETTINGS.rules).forEach(function (k) { if (S.settings.rules[k] === undefined) S.settings.rules[k] = DEFAULT_SETTINGS.rules[k]; });
  })();
  var plan = PLANS.indexOf(lsGet('s360v2.plan', 'kingpro')) >= 0 ? lsGet('s360v2.plan', 'kingpro') : 'kingpro';

  function save() { if (!backend) lsSet(KEY, JSON.stringify(S)); }
  // Live mode: run the server call after the optimistic local change; on any error, show it and reload the truth.
  function push(method) {
    var args = [].slice.call(arguments, 1);
    if (!backend) return Promise.resolve(null);
    if (!backend[method]) return Promise.resolve(null);
    return backend[method].apply(null, args).then(function (r) { if (backend.after) backend.after(method, r); return r; }, function (e) {
      if (window.S360UI && window.S360UI.toast) window.S360UI.toast((e && e.userMessage) || 'Couldn’t save: ' + ((e && e.message) || 'network error') + '. Showing the latest saved data.');
      if (backend.reload) backend.reload();
      throw e;
    });
  }
  function quiet(p) { p.catch(function () { /* already reported */ }); return p; }
  function emit() { save(); subs.forEach(function (f) { f(); }); }
  function rank(p) { return PLANS.indexOf(p); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function stamp() { var d = new Date(); return M.today + ' ' + nowHM(); }
  function rec(sid, date) { return S.attendance.filter(function (a) { return a.staff === sid && a.date === date; })[0] || null; }
  function person(id) { return S.staff.filter(function (s) { return s.id === id; })[0]; }
  function log(action, target, detail, by) { S.audit.unshift({ at: stamp(), by: by || S.settings.business.owner + ' (owner)', action: action, target: target, detail: detail || '' }); }
  function eachDate(from, to, f) {
    var d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    while (d <= end) { f(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); d.setDate(d.getDate() + 1); }
  }
  var LABEL = { present: 'Present', late: 'Late', halfday: 'Half day', absent: 'Absent', leave: 'On leave', weeklyoff: 'Weekly off', notin: 'Not marked' };

  var api = {
    sample: !!M.sample, PLAN_LABEL: PLAN_LABEL, LABEL: LABEL,
    get businesses() { return S.businesses || M.businesses; },
    get today() { return S.day; },
    get nowMin() { return S.nowMin != null ? S.nowMin : M.nowMin; },
    get live() { return !!backend; },
    get role() { return S.role || 'owner'; },
    get kind() { return S.kind || 'org'; },
    get editable() { return S.editable !== false; },
    get extra() { return S.extra || {}; },
    // Live mode: replace all data with a server snapshot.
    init: function (snap, be) {
      backend = be || backend;
      Object.keys(snap).forEach(function (k) { S[k] = snap[k]; });
      if (snap.plan) plan = snap.plan;
      S.audit = S.audit || []; S.approvals = S.approvals || []; S.notifications = S.notifications || []; S.corrections = S.corrections || [];
      S.settings.fence = S.settings.fence || clone(DEFAULT_SETTINGS.fence); S.settings.whatsapp = S.settings.whatsapp || clone(DEFAULT_SETTINGS.whatsapp);
      emit();
    },
    backend: function () { return backend; },
    get business() { var b = S.settings.business; return { name: b.name, city: b.city || '', owner: b.owner || '', ownerFirst: (b.owner || '').split(' ')[0], phone: b.phone || '' }; },
    subscribe: function (f) { subs.push(f); },
    get plan() { return plan; },
    setPlan: function (p) { if (rank(p) < 0 || backend) return; plan = p; lsSet('s360v2.plan', p); emit(); },
    can: function (feature) { return rank(plan) >= rank(FEATURE[feature] || 'kingpro'); },
    needs: function (feature) { return PLAN_LABEL[FEATURE[feature] || 'kingpro']; },
    reset: function () { S = fresh(); emit(); },

    // ---- selectors ----
    staff: function (opts) { opts = opts || {}; return S.staff.filter(function (s) { return opts.all || s.status === 'Active'; }); },
    person: person,
    byMobile: function (m) { m = String(m).replace(/\D/g, '').slice(-10); return S.staff.filter(function (s) { return s.mobile === m; })[0]; },
    designations: function () { var o = {}; S.staff.forEach(function (s) { o[s.designation] = 1; }); return Object.keys(o).sort(); },
    shift: function (id) { return S.shifts.filter(function (s) { return s.id === id; })[0]; },
    shifts: function () { return S.shifts; },
    notifications: function () { return S.notifications; },
    leaves: function () { return S.leaves; },
    settings: function () { return S.settings; },
    audit: function (target) { return S.audit.filter(function (a) { return !target || a.target === target; }); },
    record: rec,
    day: function (date) { return api.staff().map(function (s) { return { person: s, rec: rec(s.id, date) }; }); },
    range: function (from, to) { return S.attendance.filter(function (a) { return a.date >= from && a.date <= to; }); },
    approvals: function () { return S.approvals; },
    corrections: function () { return S.corrections || []; },

    // ---- staff ----
    nextId: function () {
      var n = S.staff.reduce(function (m, s) { var k = parseInt(s.id.replace(/\D/g, ''), 10) || 0; return Math.max(m, k); }, 0) + 1;
      return 'HN' + (n < 10 ? '00' : n < 100 ? '0' : '') + n;
    },
    saveStaff: function (data, isNew) {
      var before = isNew ? null : JSON.parse(JSON.stringify(person(data.id)));
      if (isNew) {
        S.staff.push(data);
        log('Added employee', data.id, data.name + ' · ' + data.designation);
      } else {
        var p = person(data.id), changed = [];
        Object.keys(data).forEach(function (k) { if (String(p[k]) !== String(data[k])) changed.push(k); p[k] = data[k]; });
        log('Edited employee', data.id, changed.length ? 'Changed: ' + changed.join(', ') : 'No changes');
      }
      emit();
      if (!backend) return Promise.resolve(data.id);
      return push('saveStaff', data, isNew, before);
    },
    setStaffStatus: function (id, status) { var p = person(id); p.status = status; log(status === 'Active' ? 'Reactivated employee' : 'Deactivated employee', id, p.name); emit(); return quiet(push('setStaffStatus', id, status)); },

    // ---- attendance ----
    // Owner/manager marks or corrects a day. The previous value is kept in the activity log.
    mark: function (sid, date, v, reason, by) {
      var r = rec(sid, date), before = r ? LABEL[r.status] + (r.in ? ' ' + r.in + (r.out ? '–' + r.out : '') : '') : 'Not marked';
      if (!r) { r = { date: date, staff: sid }; S.attendance.push(r); }
      r.status = v.status; r.in = v.in || null; r.out = v.out || null; r.remark = v.remark || '';
      if (v.gps !== undefined) r.gps = v.gps;
      var after = LABEL[r.status] + (r.in ? ' ' + r.in + (r.out ? '–' + r.out : '') : '');
      log(by ? 'Self check-in/out' : 'Marked attendance', sid, date + ': ' + before + ' → ' + after + (reason ? ' · Reason: ' + reason : ''), by);
    },
    markOne: function (sid, date, v, reason) { api.mark(sid, date, v, reason); emit(); return quiet(push('mark', [{ staffId: sid, date: date, status: v.status, in: v.in || '', out: v.out || '' }], reason || v.remark || '')); },
    markMany: function (sids, date, status, reason) {
      var entries = [];
      sids.forEach(function (sid) {
        var sh = api.shift(person(sid).shift), r = rec(sid, date);
        var keep = r && (r.status === 'present' || r.status === 'late') && (status === 'present' || status === 'late');
        var tin = keep ? r.in : (status === 'present' || status === 'halfday') && sh ? sh.start : null;
        api.mark(sid, date, { status: status, in: tin, out: keep ? r.out : null, remark: r ? r.remark : '' }, reason || 'Bulk mark');
        entries.push({ staffId: sid, date: date, status: status, in: tin || '' });
      });
      emit();
      return quiet(push('mark', entries, reason || 'Bulk mark'));
    },
    // Employee self check-in / check-out (employee portal). Time comes from the server in the live build.
    punch: function (sid, kind, gps) {
      var p = person(sid), sh = api.shift(p.shift), r = rec(sid, M.today) || {}, t = nowHM();
      if (kind === 'in') {
        var late = sh && toMin(t) > toMin(sh.start) + (sh.graceMin || 0);
        api.mark(sid, M.today, { status: late ? 'late' : 'present', in: t, out: null, remark: r.remark || '', gps: gps }, null, p.name + ' (employee)');
      } else {
        api.mark(sid, M.today, { status: r.status, in: r.in, out: t, remark: r.remark || '', gps: r.gps }, null, p.name + ' (employee)');
      }
      emit(); return t;
    },
    // Live employee portal: the server records the time; this only refreshes the view.
    setOwnRecord: function (r) {
      S.attendance = S.attendance.filter(function (a) { return !(a.staff === r.staff && a.date === r.date); }).concat([r]); emit();
    },

    // ---- shifts ----
    saveShift: function (sh) {
      var i = S.shifts.map(function (x) { return x.id; }).indexOf(sh.id);
      var isNew = i < 0;
      if (i >= 0) { S.shifts[i] = sh; log('Edited shift', sh.name, sh.start + '–' + sh.end); }
      else { S.shifts.push(sh); log('Created shift', sh.name, sh.start + '–' + sh.end); }
      emit();
      return quiet(push('saveShift', sh, isNew));
    },
    deleteShift: function (id) {
      var sh = api.shift(id);
      if (S.staff.some(function (s) { return s.shift === id && s.status === 'Active'; })) return false;
      S.shifts = S.shifts.filter(function (x) { return x.id !== id; }); log('Deleted shift', sh.name, ''); emit(); quiet(push('deleteShift', id)); return true;
    },
    assign: function (sid, shiftId, weeklyOff) {
      var p = person(sid), prevShift = p.shift; p.shift = shiftId; p.weeklyOff = weeklyOff === '' || weeklyOff == null ? null : +weeklyOff;
      log('Assigned shift', sid, (api.shift(shiftId) || {}).name + ' · weekly off ' + (p.weeklyOff == null ? 'none' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weeklyOff])); emit();
      return quiet(push('assign', sid, shiftId, p.weeklyOff, prevShift));
    },

    // ---- leave ----
    decideLeave: function (id, status, by, note) {
      var l = S.leaves.filter(function (x) { return x.id === id; })[0];
      l.status = status; l.decided = stamp();
      if (status === 'Approved') eachDate(l.from, l.to, function (d) {
        if (d <= M.today) { var r = rec(l.staff, d); if (!r || r.status === 'absent' || r.status === 'notin') api.mark(l.staff, d, { status: 'leave', remark: l.type + ' leave' }, 'Leave approved'); }
      });
      log(status + ' leave', l.staff, l.type + ' · ' + l.from + (l.to !== l.from ? ' to ' + l.to : '') + ' · ' + l.days + ' day(s)' + (note ? ' · ' + note : ''), by);
      emit();
      return quiet(push('decideLeave', id, status, note || ''));
    },
    addLeave: function (l, by) {
      l.id = 'L' + (Date.now() % 1e7); l.status = 'Pending'; l.applied = M.today;
      S.leaves.unshift(l); log('Leave requested', l.staff, l.type + ' · ' + l.from + ' to ' + l.to, by);
      S.notifications.unshift({ id: 'n' + l.id, text: (person(l.staff) || {}).name + ' requested ' + l.type.toLowerCase() + ' leave', at: 'just now', go: '#/leave' });
      emit(); quiet(push('addLeave', l)); return l;
    },

    // ---- correction requests (employee asks, owner/manager decides) ----
    addCorrection: function (c, by) {
      c.id = 'C' + (Date.now() % 1e7); c.status = 'Pending'; c.applied = S.day;
      S.corrections = (S.corrections || []); S.corrections.unshift(c);
      log('Correction requested', c.staff, c.date + ' · ' + c.reason, by);
      S.notifications.unshift({ id: 'n' + c.id, text: (person(c.staff) || {}).name + ' asked to correct ' + c.date, at: 'just now', go: '#/leave/corrections' });
      emit(); return quiet(push('addCorrection', c));
    },
    decideCorrection: function (id, status, note) {
      var c = (S.corrections || []).filter(function (x) { return x.id === id; })[0];
      c.status = status; c.note = note || '';
      if (status === 'Approved' && !backend) {
        var r = rec(c.staff, c.date) || {}, w = c.want || {};
        api.mark(c.staff, c.date, { status: w.status || r.status || 'present', in: w.in || r.in, out: w.out || r.out, remark: r.remark || '' }, 'Correction approved');
      }
      log(status + ' correction', c.staff, c.date + (note ? ' · ' + note : ''));
      emit(); return quiet(push('decideCorrection', id, status, note || ''));
    },
    // Mark staff who check in on their phone, were expected, and have nothing for the day.
    noShows: function (date) {
      return api.staff().filter(function (p) {
        if (!p.login) return false;
        if (p.weeklyOff != null && new Date(date + 'T00:00:00').getDay() === +p.weeklyOff) return false;
        if (S.leaves.some(function (l) { return l.staff === p.id && l.status === 'Approved' && date >= l.from && date <= l.to; })) return false;
        var r = rec(p.id, date); return !r || r.status === 'notin';
      });
    },
    markNoShows: function (date) {
      if (backend) return backend.autoAbsent(date).then(function (r) { backend.reload(); return r.marked; });
      var ids = api.noShows(date).map(function (p) { return p.id; });
      ids.forEach(function (id) { api.mark(id, date, { status: 'absent', in: null, out: null, remark: 'No check-in' }, 'Auto: no check-in'); });
      emit(); return Promise.resolve(ids.length);
    },

    // ---- settings / salary ----
    saveSettings: function (part, v) { S.settings[part] = v; log('Updated settings', part, ''); emit(); return quiet(push('saveSettings', part, v)); },
    updateProfile: function (sid, fields) { var p = person(sid); Object.keys(fields).forEach(function (k) { p[k] = fields[k]; }); log('Updated own profile', sid, Object.keys(fields).join(', '), p.name + ' (employee)'); emit(); },
    approveSalary: function (sid, month, amount, breakdown) {
      S.approvals.unshift({ staff: sid, month: month, amount: amount, breakdown: breakdown, at: stamp() });
      log('Approved salary estimate', sid, month + ' · ₹' + amount.toLocaleString('en-IN') + ' (no payment made)'); emit();
      return quiet(push('approveSalary', sid, month));
    },
  };
  function toMin(t) { var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }
  window.S360Store = api;
})();
