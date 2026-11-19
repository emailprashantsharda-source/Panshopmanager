/* Staff360 v2 — live adapter. Loads the business from the staff360* Cloud Functions,
 * maps it into the shape the screens use, and sends every change back to the server.
 * The server enforces roles and plans; this file never decides what someone may do.
 */
(function () {
  'use strict';
  var St = window.S360Store;
  var O = null;           // { call, tenant, tenants, user, signOut, switchTenant, newBusiness }
  var STATE = null;       // last getState
  var reloadTimer = null;
  var DAYS = 62;          // history kept in the browser (server limit is 92)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(iso, n) { var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return isoOf(d); }
  function dow(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getDay(); }
  function toMin(t) { if (!t) return null; var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }
  function stamp(ms) { if (!ms) return ''; var d = new Date(ms); return isoOf(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var CODE = { present: 'P', late: 'P', halfday: 'H', absent: 'A', leave: 'L', weeklyoff: 'W', notin: '' };

  function call(name, data) {
    return O.call(name, Object.assign({ shopId: O.tenant.id }, data || {})).catch(function (e) { throw friendly(e); });
  }
  function friendly(e) {
    var code = String((e && e.code) || '').replace('functions/', ''), msg = String((e && e.message) || '');
    var m = /upgrade_required:(\w+)/.exec(msg);
    if (m) e.userMessage = 'This needs the ' + (m[1] === 'kingpro' ? 'King PRO' : 'Premium') + ' plan.';
    else if (code === 'unauthenticated') e.userMessage = 'Your session expired. Please log in again.';
    else if (code === 'permission-denied') e.userMessage = msg || 'You don’t have permission to do that.';
    else if (navigator.onLine === false) e.userMessage = 'You’re offline. Connect to the internet and try again.';
    else e.userMessage = msg || 'Something went wrong. Please try again.';
    return e;
  }
  function can(feature) { return !!(STATE && STATE.features && STATE.features[feature]); }

  // ---------------- owner / manager ----------------
  function mapStaff(roster, shifts) {
    return roster.map(function (x) {
      var sh = shifts.filter(function (s) { return (s.staffIds || []).indexOf(x.id) >= 0; })[0];
      var off = Number.isInteger(x.weeklyOff) ? x.weeklyOff : sh && sh.weeklyOff && sh.weeklyOff.length ? sh.weeklyOff[0] : null;
      return {
        id: x.id, code: x.empCode || '', name: x.name || 'Staff', mobile: x.phone ? String(x.phone).replace(/^\+91/, '') : '',
        designation: x.role || 'Staff', joined: x.joinedDate || '', type: x.empType || 'Full-time', shift: sh ? sh.id : '',
        weeklyOff: off, salary: x.salary || '', login: !!(x.canLogin || x.hisaabnowLogin), hnLogin: !!x.hisaabnowLogin,
        status: x.active === false ? 'Inactive' : 'Active',
      };
    });
  }
  function mapShift(s, i) {
    return { id: s.id, name: s.name, start: s.start, end: s.end, graceMin: s.graceMin || 0, breakMin: s.breakMin != null ? s.breakMin : 60,
      color: s.color || ['blue', 'purple', 'green', 'orange'][i % 4], staffIds: s.staffIds || [], weeklyOffArr: s.weeklyOff || [] };
  }
  function mapStatus(d, person, shift) {
    var s = d.status;
    if (s === 'P' || (!s && d.inHm)) {
      var late = d.lateMin != null ? d.lateMin > 0 : !!(shift && d.inHm && toMin(d.inHm) > toMin(shift.start) + (shift.graceMin || 0));
      return late ? 'late' : 'present';
    }
    return { H: 'halfday', A: 'absent', L: 'leave', W: 'weeklyoff' }[s] || 'notin';
  }
  function mapRecords(rows, staff, shifts, from, to) {
    var out = [], byId = {}, shById = {};
    staff.forEach(function (p) { byId[p.id] = p; });
    shifts.forEach(function (s) { shById[s.id] = s; });
    rows.forEach(function (row) {
      var p = byId[row.staffId]; if (!p) return;
      var seen = {};
      row.days.forEach(function (d) {
        var st = mapStatus(d, p, shById[p.shift]);
        seen[d.date] = 1;
        out.push({ date: d.date, staff: p.id, status: st, in: d.inHm || null, out: d.outHm || null, remark: '',
          lateMin: d.lateMin, workedMin: d.workedMin, gps: d.gps ? { acc: d.gps.accuracy, low: d.gps.low, dist: d.gps.distanceM, outside: !!d.gps.outside } : d.gps === false ? false : undefined });
      });
      // Their regular weekly off counts as a weekly off unless something else was recorded.
      if (p.weeklyOff != null) for (var d = from; d <= to; d = addDays(d, 1)) if (!seen[d] && dow(d) === p.weeklyOff) out.push({ date: d, staff: p.id, status: 'weeklyoff', in: null, out: null, remark: '', virtual: true });
    });
    return out;
  }
  function mapLeaves(items, staff) {
    var ids = {}; staff.forEach(function (p) { ids[p.id] = 1; });
    return items.filter(function (r) { return r.type === 'leave' && ids[r.staffId]; }).map(function (r) {
      var days = 1; for (var d = r.fromDate; d < r.toDate; d = addDays(d, 1)) days++;
      return { id: r.id, staff: r.staffId, type: r.leaveType || 'Other', from: r.fromDate, to: r.toDate || r.fromDate, days: days, reason: r.reason || '',
        status: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[r.status] || 'Pending', applied: r.createdAt ? isoOf(new Date(r.createdAt)) : '', note: r.decisionNote || '' };
    });
  }
  var FROM_CODE = { P: 'present', H: 'halfday', A: 'absent', L: 'leave', W: 'weeklyoff' };
  var CAP = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
  function mapCorrections(items, ids) {
    return items.filter(function (r) { return r.type === 'correction' && (!ids || ids[r.staffId]); }).map(function (r) {
      var c = r.correction || {};
      return { id: r.id, staff: r.staffId, date: r.date, want: { status: c.status ? FROM_CODE[c.status] : '', in: c.checkIn || '', out: c.checkOut || '' },
        reason: r.reason || '', status: CAP[r.status] || 'Pending', note: r.decisionNote || '', applied: r.createdAt ? isoOf(new Date(r.createdAt)) : '' };
    });
  }
  var AUDIT = { manual_mark: 'Marked attendance', punch_in: 'Checked in', punch_out: 'Checked out', staff_created: 'Added employee', staff_updated: 'Edited employee',
    staff_removed: 'Removed employee', shift_created: 'Created shift', shift_updated: 'Edited shift', shift_deleted: 'Deleted shift', settings_updated: 'Updated settings',
    request_created: 'Request sent', auto_mark: 'Marked automatically', request_approved: 'Approved leave', request_rejected: 'Rejected leave', salary_approved: 'Approved salary estimate', salary_inputs_edited: 'Edited salary inputs' };
  var MARK = { P: 'Present', H: 'Half day', A: 'Absent', L: 'On leave', W: 'Weekly off', '': 'Not marked' };
  function mapAudit(items) {
    return items.map(function (a) {
      var from = a.type === 'manual_mark' ? MARK[a.from || ''] : a.from, to = a.type === 'manual_mark' ? MARK[a.to || ''] : a.to;
      var detail = (a.date ? a.date + ': ' : '') + (from || to ? (from || '—') + ' → ' + (to || '—') : '') + (a.reason ? ' · Reason: ' + a.reason : '');
      return { at: stamp(a.at), by: a.actorRole === 'owner' ? 'Owner' : a.actorRole === 'manager' ? 'Manager' : (a.staffName || 'Employee'), action: AUDIT[a.type] || a.type, target: a.staffId || '', detail: detail.trim() };
    });
  }

  function loadOwner() {
    var today = isoOf(new Date()), from = addDays(today, -(DAYS - 1));
    return Promise.all([
      call('staff360StaffRoster'),
      call('staff360Records', { from: from, to: today }),
      can('shifts') ? call('staff360ListShifts') : Promise.resolve({ shifts: [] }),
      can('leave_requests') ? call('staff360ListRequests') : Promise.resolve({ items: [] }),
      can('audit_log') ? call('staff360ListAudit', { limit: 200 }).catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] }),
    ]).then(function (r) {
      var shifts = r[2].shifts.map(mapShift), staff = mapStaff(r[0].staff, shifts), rec = r[1];
      var leaves = mapLeaves(r[3].items, staff), st = STATE.settings || {};
      var ids = {}; staff.forEach(function (p) { ids[p.id] = 1; });
      var corr = mapCorrections(r[3].items, ids);
      var pend = leaves.filter(function (l) { return l.status === 'Pending'; }).length, pc = corr.filter(function (c) { return c.status === 'Pending'; }).length;
      var u = O.user || {};
      return {
        day: rec.today, nowMin: new Date().getHours() * 60 + new Date().getMinutes(),
        plan: STATE.plan, role: STATE.role, kind: STATE.tenant.kind, editable: r[0].editable, extra: { maxStaff: r[0].maxStaff, ai: STATE.ai, detailed: rec.detailed, plans: STATE.plans, ent: STATE.entitlement },
        staff: staff, shifts: shifts, attendance: mapRecords(rec.rows, staff, shifts, rec.from, rec.to), leaves: leaves, audit: mapAudit(r[4].items), approvals: [],
        businesses: (O.tenants || [O.tenant]).map(function (t) { return { id: t.id, name: t.name, city: t.kind === 'shop' ? 'HisaabNow shop' : 'Staff360 business', role: t.role }; }),
        corrections: corr,
        notifications: (pend ? [{ id: 'np', text: pend + ' leave request' + (pend > 1 ? 's are' : ' is') + ' waiting for approval', at: 'now', go: '#/leave' }] : [])
          .concat(pc ? [{ id: 'nc', text: pc + ' attendance correction' + (pc > 1 ? 's' : '') + ' to review', at: 'now', go: '#/leave/corrections' }] : []),
        settings: {
          business: { name: STATE.tenant.name || O.tenant.name || 'My business', city: STATE.tenant.kind === 'shop' ? 'HisaabNow shop' : '', phone: '', owner: u.displayName || '' },
          rules: { graceMin: st.defaultGraceMin != null ? st.defaultGraceMin : 10, hoursPerDay: st.hoursPerDay || 8, halfDayBelowHours: st.halfDayBelowHours || 5,
            gpsRequired: true, allowNoGps: st.gpsPolicy === 'allow_without', autoLate: st.autoLate !== false, autoHalfDay: !!st.autoHalfDay, autoAbsent: !!st.autoAbsent },
          fence: st.geofence || { lat: null, lng: null, radiusM: 200, mode: 'off' },
          whatsapp: { loaded: false },
          defaultWeeklyOff: 0, perms: st.perms || {}, notify: st.notify || {},
        },
      };
    });
  }

  function reload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      call('staff360GetState').then(function (s) { STATE = s; return STATE.role === 'employee' ? loadEmployee() : loadOwner(); })
        .then(function (snap) { St.init(snap); }).catch(function (e) { if (window.S360UI) window.S360UI.toast(e.userMessage || 'Couldn’t refresh'); });
    }, 250);
  }

  function personPayload(p) {
    return { id: p.id, name: p.name, role: p.designation, phone: p.mobile || '', salary: +p.salary || 0, canLogin: !!p.login && !p.hnLogin,
      active: p.status !== 'Inactive', joinedDate: p.joined || null, empType: p.type, empCode: p.code || '', weeklyOff: p.weeklyOff == null ? null : +p.weeklyOff };
  }
  function shiftPayload(sh, staffIds) {
    return { id: sh.id || null, name: sh.name, start: sh.start, end: sh.end, graceMin: sh.graceMin, breakMin: sh.breakMin,
      color: sh.color, weeklyOff: sh.weeklyOffArr || [], staffIds: staffIds };
  }
  function onShift(id) { return St.staff({ all: true }).filter(function (p) { return p.shift === id; }).map(function (p) { return p.id; }); }

  // Pay with PayU (HisaabNow's payuCreateOrder). The server sets the price; we only post its form.
  function checkout(planId) {
    return call('payuCreateOrder', { product: 'staff360', tier: planId, from: window.S360_BACK ? 'app' : 'site' }).then(function (r) {
      var f = document.createElement('form');
      f.method = 'POST'; f.action = r.paymentUrl; f.target = '_top'; f.style.display = 'none';
      Object.keys(r.params).forEach(function (k) {
        var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = r.params[k]; f.appendChild(i);
      });
      document.body.appendChild(f); f.submit();
    });
  }
  function payuReturned() {
    var q = new URLSearchParams(location.search), r = q.get('payu');
    // Came from a "Choose Premium / King PRO" button on the website: open Subscription.
    if (q.get('plan') && STATE.role === 'owner' && (!location.hash || location.hash === '#/' || location.hash === '#/dashboard')) {
      q.delete('plan');
      try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + '#/plans'); } catch (e) {}
    }
    if (!r) return;
    q.delete('payu'); q.delete('txnid');
    try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash); } catch (e) {}
    setTimeout(function () {
      if (!window.S360UI) return;
      window.S360UI.toast(r === 'success' ? 'Payment received. Your ' + (St.PLAN_LABEL[St.plan] || '') + ' plan is on.' : 'The payment didn’t go through, so your plan hasn’t changed. If money left your account, message us on WhatsApp.');
    }, 700);
  }

  var backend = {
    checkout: checkout,
    reload: reload,
    after: function () { reload(); },
    saveStaff: function (p, isNew, before) {
      var body = personPayload(p);
      if (isNew) delete body.id;
      return call('staff360StaffSave', body).then(function (r) {
        var id = r.id, sh = p.shift && St.shift(p.shift);
        if (sh && can('shifts') && (isNew || !before || before.shift !== p.shift)) {
          var ids = onShift(sh.id).filter(function (x) { return x !== p.id; }).concat([id]);
          return call('staff360SaveShift', shiftPayload(sh, ids)).then(function () { return id; });
        }
        return id;
      });
    },
    setStaffStatus: function (id, status) {
      var p = St.person(id), body = personPayload(p); body.active = status === 'Active'; if (!body.active) body.canLogin = false;
      return call('staff360StaffSave', body);
    },
    mark: function (entries, reason) {
      return call('staff360Mark', { reason: reason || '', entries: entries.map(function (e) {
        return { staffId: e.staffId, date: e.date, status: CODE[e.status] != null ? CODE[e.status] : '', in: e.in || '', out: e.out || '' };
      }) });
    },
    saveShift: function (sh, isNew) { var b = shiftPayload(sh, isNew ? [] : onShift(sh.id)); if (isNew) b.id = null; return call('staff360SaveShift', b); },
    deleteShift: function (id) { return call('staff360DeleteShift', { id: id }); },
    assign: function (sid, shiftId, weeklyOff) {
      var sh = St.shift(shiftId), p = St.person(sid);
      var a = sh ? call('staff360SaveShift', shiftPayload(sh, onShift(shiftId))) : Promise.resolve();
      return a.then(function () { return p.hnLogin && /^\+/.test(p.id) ? null : call('staff360StaffSave', personPayload(p)); });
    },
    decideLeave: function (id, status, note) { return call('staff360DecideRequest', { id: id, decision: status.toLowerCase(), note: note || '' }); },
    addLeave: function (l) { return call('staff360SubmitRequest', { type: 'leave', staffId: STATE.role === 'employee' ? undefined : l.staff, fromDate: l.from, toDate: l.to, reason: l.reason, leaveType: l.type }); },
    saveSettings: function (part, v) {
      if (part === 'business') return call('staff360SaveSettings', { businessName: v.name });
      if (part === 'rules') return call('staff360SaveSettings', { defaultGraceMin: v.graceMin, hoursPerDay: v.hoursPerDay, halfDayBelowHours: v.halfDayBelowHours, autoLate: !!v.autoLate, autoHalfDay: !!v.autoHalfDay, autoAbsent: !!v.autoAbsent, gpsPolicy: v.allowNoGps ? 'allow_without' : 'require' });
      if (part === 'fence') return call('staff360SaveSettings', { geofence: { lat: v.lat, lng: v.lng, radiusM: v.radiusM, mode: v.mode } });
      if (part === 'perms' || part === 'notify') { var b = {}; b[part] = v; return call('staff360SaveSettings', b); }
      return Promise.resolve(null);
    },
    addCorrection: function (c) {
      var w = c.want || {};
      return call('staff360SubmitRequest', { type: 'correction', date: c.date, reason: c.reason, status: w.status ? CODE[w.status] : undefined, checkIn: w.in || undefined, checkOut: w.out || undefined });
    },
    decideCorrection: function (id, status, note) { return call('staff360DecideRequest', { id: id, decision: status.toLowerCase(), note: note || '' }); },
    autoAbsent: function (date) { return call('staff360AutoAbsent', { date: date }); },
    whatsapp: function (body) { return call('staff360WhatsApp', body); },
    approveSalary: function (sid, ym) { return call('staff360SalarySave', { staffId: sid, ym: ym, approve: true }); },
    // used directly by screens
    aiAsk: function (q) { return call('staff360AIAsk', { question: q }); },
    salaryList: function (ym) { return call('staff360SalaryList', { ym: ym }); },
    salarySave: function (sid, ym, overrides) { return call('staff360SalarySave', { staffId: sid, ym: ym, overrides: overrides }); },
    punch: function (action, gps, gpsError) { return call('staff360Punch', { action: action, gps: gps || null, gpsError: gpsError || null, clientTs: Date.now() }); },
    signOut: function () { return O.signOut(); },
    switchTenant: function (id) { return O.switchTenant(id); },
    newBusiness: function () { return O.newBusiness && O.newBusiness(); },
    user: function () { return O.user || {}; },
  };

  // ---------------- employee ----------------
  function loadEmployee() {
    var me = STATE.me;
    if (!me || me.error) return Promise.reject(friendly({ message: (me && me.error) || 'No staff profile found for your number. Ask your employer to add you.' }));
    var featuresOk = can('self_checkin');
    return (featuresOk ? call('staff360MyHistory', { days: 60 }) : Promise.resolve({ row: { days: [] }, requests: [], from: me.today, to: me.today })).then(function (h) {
      var sh = me.shift ? { id: 'mine', name: me.shift.name, start: me.shift.start, end: me.shift.end, graceMin: me.shift.graceMin || 0, breakMin: 0, color: 'green' } : null;
      var off = me.weeklyOff != null ? me.weeklyOff : me.shift && me.shift.weeklyOff && me.shift.weeklyOff.length ? me.shift.weeklyOff[0] : null;
      var person = { id: me.staffId, code: '', name: me.name, designation: me.role || 'Staff', mobile: String((O.user && O.user.phoneNumber) || '').replace(/^\+91/, ''),
        joined: me.joinedDate || '', type: '', shift: sh ? 'mine' : '', weeklyOff: off, status: 'Active', login: true };
      var tp = me.todayPunch, days = (h.row && h.row.days) || [];
      var att = mapRecords([{ staffId: me.staffId, days: days.filter(function (d) { return d.status || d.inHm; }) }], [person], sh ? [sh] : [], h.from || me.today, h.to || me.today)
        .filter(function (r) { return r.date !== me.today; });
      if (tp && tp.checkInAt) att.push({ date: me.today, staff: me.staffId, status: tp.lateMinutes > 0 ? 'late' : 'present', in: tp.inHm, out: tp.outHm || null,
        lateMin: tp.lateMinutes, workedMin: tp.workedMinutes, gps: tp.checkInGps ? { acc: tp.checkInGps.accuracy, low: tp.checkInGps.lowAccuracy, outside: !!tp.checkInGps.outside, dist: tp.checkInGps.distanceM } : false });
      else { var td = days.filter(function (d) { return d.date === me.today; })[0]; if (td) att = att.concat(mapRecords([{ staffId: me.staffId, days: [td] }], [person], sh ? [sh] : [], me.today, me.today)); }
      return {
        day: me.today, plan: STATE.plan, role: 'employee', kind: STATE.tenant.kind, staff: [person], shifts: sh ? [sh] : [], attendance: att,
        leaves: (h.requests || []).filter(function (r) { return r.type === 'leave'; }).map(function (r) {
          var n = 1; for (var d = r.fromDate; d < r.toDate; d = addDays(d, 1)) n++;
          return { id: r.id, staff: me.staffId, type: r.leaveType || 'Other', from: r.fromDate, to: r.toDate || r.fromDate, days: n, reason: r.reason, status: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[r.status] || 'Pending', applied: '' };
        }),
        corrections: mapCorrections(h.requests || [], null),
        extra: { me: me, openYesterday: me.openYesterday, fence: me.fence || null },
        settings: { business: { name: STATE.tenant.name || O.tenant.name, city: '', phone: '', owner: '' }, rules: { gpsRequired: true, allowNoGps: me.gpsPolicy === 'allow_without', minAccuracyM: me.minAccuracyM, autoLate: true },
          defaultWeeklyOff: 0, perms: { requestLeave: true, seeShift: true }, notify: {} },
      };
    });
  }

  window.S360Live = {
    backend: backend,
    // opts: { call(name, data) → Promise<data>, tenant, tenants, user, signOut(), switchTenant(id), newBusiness() }
    boot: function (opts) {
      O = opts;
      return call('staff360GetState').then(function (s) {
        STATE = s;
        var emp = s.role === 'employee';
        return (emp ? loadEmployee() : loadOwner()).then(function (snap) { St.init(snap, backend); payuReturned(); return emp ? 'employee' : 'owner'; });
      });
    },
  };
})();
