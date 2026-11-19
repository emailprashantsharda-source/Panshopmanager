/* Staff360 v2 — Shifts & Schedules, Leave Management, Reports & Analytics. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var F = U.state;
  var COLORS = { blue: ['var(--blue-light)', 'var(--blue)'], purple: ['var(--purple-light)', 'var(--purple)'], green: ['var(--primary-light)', 'var(--primary)'], orange: ['var(--orange-light)', 'var(--orange)'] };

  // =================== SHIFTS ===================
  F.wk = F.wk || 0; // week offset
  U.views.shifts = function () {
    if (!St.can('shifts')) return U.locked('shifts', 'Shifts & Schedules', 'Create morning, evening and overnight shifts with a grace period, set weekly offs and see the week at a glance.');
    var shifts = St.shifts(), staff = St.staff();
    var h = U.pageHead('Shifts & Schedules', 'Create shifts, assign staff and set weekly offs.', '<button class="btn pri" data-a="shift-new">' + ic('plus') + 'New shift</button>');
    h += '<div class="shift-cards">' + shifts.map(function (s) {
      var n = staff.filter(function (p) { return p.shift === s.id; }), col = COLORS[s.color] || COLORS.green;
      return '<section class="card shift-c"><div class="card-h"><h2><span class="sw" style="background:' + col[1] + '"></span>' + esc(s.name) + '</h2><span class="row-act">' +
        '<button class="icon-btn sm" data-a="shift-edit:' + s.id + '" aria-label="Edit ' + esc(s.name) + ' shift">' + ic('edit') + '</button><button class="icon-btn sm" data-a="shift-del:' + s.id + '" aria-label="Delete ' + esc(s.name) + ' shift">' + ic('trash') + '</button></span></div>' +
        '<p class="shift-t">' + U.hm12(s.start) + ' – ' + U.hm12(s.end) + (s.end < s.start ? ' <span class="badge b-purple">Overnight</span>' : '') + '</p>' +
        '<div class="facts"><span>' + ic('clock') + s.graceMin + ' min grace</span><span>' + ic('cal') + s.breakMin + ' min break</span><span>' + ic('users') + n.length + ' staff</span></div>' +
        '<div class="avs">' + n.slice(0, 6).map(function (p) { return U.avatar(p, 28); }).join('') + (n.length > 6 ? '<span class="more">+' + (n.length - 6) + '</span>' : '') + '</div></section>';
    }).join('') + '</div>';

    // weekly calendar
    var today = U.parse(St.today), monday = U.addDays(St.today, -((today.getDay() + 6) % 7) + F.wk * 7);
    var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return U.addDays(monday, i); });
    h += '<section class="card"><div class="card-h"><h2>Weekly schedule</h2><div class="date-nav"><button class="icon-btn sm" data-a="wk:-1" aria-label="Previous week">' + ic('left') + '</button><b class="mlabel">' + U.dLabel(days[0]) + ' – ' + U.dLabel(days[6]) + '</b><button class="icon-btn sm" data-a="wk:1" aria-label="Next week">' + ic('right') + '</button></div></div>' +
      '<p class="muted" style="margin:-6px 0 12px">Click a cell to change someone’s shift or weekly off.</p>' +
      '<div class="tbl-wrap"><table class="t sched"><thead><tr><th>Employee</th>' + days.map(function (d) { return '<th class="c' + (d === St.today ? ' today' : '') + '">' + U.DOW[U.parse(d).getDay()] + '<br><small>' + U.parse(d).getDate() + '</small></th>'; }).join('') + '</tr></thead><tbody>' +
      staff.map(function (p) {
        var s = St.shift(p.shift), col = COLORS[(s || {}).color] || COLORS.green;
        return '<tr><td><span class="who">' + U.avatar(p, 28) + '<span><b>' + esc(p.name) + '</b><small>' + esc(p.designation) + '</small></span></span></td>' + days.map(function (d) {
          var off = U.parse(d).getDay() === p.weeklyOff, lv = St.leaves().some(function (l) { return l.staff === p.id && l.status === 'Approved' && d >= l.from && d <= l.to; });
          return '<td class="c"><button class="slot' + (off ? ' off' : lv ? ' lv' : '') + '" style="' + (off || lv ? '' : 'background:' + col[0] + ';color:' + col[1]) + '" data-a="shift-assign:' + p.id + '" aria-label="' + esc(p.name) + ', ' + U.dLabel(d, true) + ': ' + (off ? 'Weekly off' : lv ? 'On leave' : (s ? s.name : 'No shift')) + '">' + (off ? 'Off' : lv ? 'Leave' : s ? esc(s.name) : '—') + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
    return h;
  };
  function shiftModal(s) {
    var isNew = !s; s = s || { id: '', name: '', start: '09:00', end: '18:00', graceMin: 10, breakMin: 60, color: 'blue' };
    U.modal({
      title: isNew ? 'New shift' : 'Edit ' + esc(s.name) + ' shift', submit: isNew ? 'Create shift' : 'Save shift',
      body: '<div class="grid2">' + U.field('Shift name', '<input name="name" id="m-sn" value="' + esc(s.name) + '" maxlength="24" placeholder="e.g. Morning">', { for: 'name', req: true }) +
        U.field('Colour', '<select name="color" id="m-sc">' + U.options([['blue', 'Blue'], ['purple', 'Purple'], ['green', 'Green'], ['orange', 'Orange']], s.color) + '</select>', { for: 'color' }) +
        U.field('Start time', '<input name="start" id="m-ss" type="time" value="' + s.start + '">', { for: 'start', req: true }) +
        U.field('End time', '<input name="end" id="m-se" type="time" value="' + s.end + '">', { for: 'end', req: true, hint: 'Earlier than start = overnight shift' }) +
        U.field('Grace period (min)', '<input name="graceMin" id="m-sg" type="number" min="0" max="120" value="' + s.graceMin + '">', { for: 'graceMin', hint: 'Check-in after this is Late' }) +
        U.field('Break (min)', '<input name="breakMin" id="m-sb" type="number" min="0" max="240" value="' + s.breakMin + '">', { for: 'breakMin' }) + '</div>',
      onSubmit: function (f) {
        var v = { id: s.id || 'sh' + Date.now().toString(36), name: U.val(f, 'name'), start: U.val(f, 'start'), end: U.val(f, 'end'), graceMin: +U.val(f, 'graceMin') || 0, breakMin: +U.val(f, 'breakMin') || 0, color: U.val(f, 'color') };
        var dup = St.shifts().filter(function (x) { return x.name.toLowerCase() === v.name.toLowerCase() && x.id !== s.id; })[0], ok = true;
        ok = U.setErr(f, 'name', !v.name ? 'Name the shift' : dup ? 'A shift with this name exists' : '') && ok;
        ok = U.setErr(f, 'start', !v.start ? 'Pick a start time' : '') && ok;
        ok = U.setErr(f, 'end', !v.end ? 'Pick an end time' : v.end === v.start ? 'End must differ from start' : '') && ok;
        ok = U.setErr(f, 'graceMin', v.graceMin < 0 || v.graceMin > 120 ? '0–120 minutes' : '') && ok;
        if (!ok) return;
        St.saveShift(v); U.closeModal(); U.toast((isNew ? 'Created ' : 'Saved ') + v.name + ' shift');
      },
    });
  }
  U.actions['shift-new'] = function () { shiftModal(null); };
  U.actions['shift-edit'] = function (p) { shiftModal(St.shift(p[0])); };
  U.actions['shift-del'] = function (p) {
    var s = St.shift(p[0]), n = St.staff().filter(function (x) { return x.shift === s.id; }).length;
    if (n) { U.toast(n + ' staff are on ' + s.name + '. Move them to another shift first.'); return; }
    U.confirm('Delete ' + esc(s.name) + ' shift?', 'No one is assigned to it. This can’t be undone.', 'Delete', function () { St.deleteShift(s.id); U.toast('Deleted ' + s.name + ' shift'); }, true);
  };
  U.actions.wk = function (p) { F.wk += +p[0]; U.render(); };
  U.actions['shift-assign'] = function (p) {
    if (!St.can('shifts')) { U.toast('Shifts are on Premium'); return; }
    var e = St.person(p[0]);
    U.modal({
      title: 'Shift for ' + esc(e.name), submit: 'Save',
      body: U.field('Shift', '<select name="shift" id="m-as">' + U.options(St.shifts().map(function (s) { return [s.id, s.name + ' (' + U.hm12(s.start) + '–' + U.hm12(s.end) + ')']; }), e.shift) + '</select>', { for: 'shift' }) +
        U.field('Weekly off', '<select name="off" id="m-ao">' + U.options([['', 'No weekly off']].concat(U.DOW_LONG.map(function (d, i) { return [i, d]; })), e.weeklyOff == null ? '' : e.weeklyOff) + '</select>', { for: 'off' }),
      onSubmit: function (f) { St.assign(e.id, U.val(f, 'shift'), U.val(f, 'off')); U.closeModal(); U.toast('Updated ' + e.name + '’s schedule'); },
    });
  };

  // =================== LEAVE ===================
  F.lq = F.lq || ''; F.ltype = F.ltype || ''; F.lstatus = F.lstatus || ''; F.lmonth = F.lmonth || '';
  function reqTabs(cur) {
    var pc = St.corrections().filter(function (c) { return c.status === 'Pending'; }).length, pl = St.leaves().filter(function (l) { return l.status === 'Pending'; }).length;
    return '<div class="tabs" role="tablist"><a role="tab" aria-selected="' + (cur === 'leave') + '" class="' + (cur === 'leave' ? 'on' : '') + '" href="#/leave">Leave' + (pl ? ' <span class="badge b-amber">' + pl + '</span>' : '') + '</a>' +
      '<a role="tab" aria-selected="' + (cur === 'corr') + '" class="' + (cur === 'corr' ? 'on' : '') + '" href="#/leave/corrections">Attendance corrections' + (pc ? ' <span class="badge b-amber">' + pc + '</span>' : '') + '</a></div>';
  }
  function corrections() {
    var list = St.corrections().slice().sort(function (a, b) { return (a.status === 'Pending' ? 0 : 1) - (b.status === 'Pending' ? 0 : 1) || (a.date < b.date ? 1 : -1); });
    var h = U.pageHead('Leave Management', 'Staff ask to fix a missed or wrong check-in; you approve or reject it.') + reqTabs('corr');
    if (!list.length) return h + '<section class="card"><div class="empty big">' + ic('check') + '<b>No correction requests</b><span>When staff forget to check in or out, they can ask for a fix from their phone.</span></div></section>';
    return h + '<section class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Date</th><th>Recorded</th><th>Asked for</th><th>Reason</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>' +
      list.map(function (c) {
        var p = St.person(c.staff) || { id: c.staff, name: 'Staff', designation: '' }, r = St.record(c.staff, c.date), w = c.want || {};
        var now = r ? St.LABEL[r.status] + (r.in ? ' · ' + U.hm12(r.in) + (r.out ? '–' + U.hm12(r.out) : '') : '') : 'Nothing recorded';
        var want = [w.status ? St.LABEL[w.status] : '', w.in ? 'In ' + U.hm12(w.in) : '', w.out ? 'Out ' + U.hm12(w.out) : ''].filter(Boolean).join(' · ');
        return '<tr><td><span class="who">' + U.avatar(p) + '<span><b>' + esc(p.name) + '</b><small>' + esc(p.designation) + '</small></span></span></td><td>' + U.dLabel(c.date, true) + '</td><td>' + esc(now) + '</td><td><b>' + esc(want) + '</b></td><td class="wrap">' + esc(c.reason) + (c.note ? '<br><small class="muted">You: ' + esc(c.note) + '</small>' : '') + '</td><td>' + U.leaveBadge(c.status) + '</td>' +
          '<td class="r">' + (c.status === 'Pending' ? '<span class="act"><button class="ok" data-a="corr-decide:' + c.id + ':Approved" aria-label="Approve correction for ' + esc(p.name) + '">' + ic('check') + '</button><button class="no" data-a="corr-decide:' + c.id + ':Rejected" aria-label="Reject correction for ' + esc(p.name) + '">' + ic('x') + '</button></span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  U.actions['corr-decide'] = function (p) {
    var c = St.corrections().filter(function (x) { return x.id === p[0]; })[0], who = St.person(c.staff) || { name: 'Staff' };
    if (p[1] === 'Approved') { St.decideCorrection(c.id, 'Approved'); U.toast('Approved — ' + U.dLabel(c.date) + ' updated for ' + who.name); return; }
    U.modal({ title: 'Reject correction for ' + esc(who.name) + '?', submit: 'Reject',
      body: U.field('Reason (shared with ' + esc(who.name.split(' ')[0]) + ')', '<textarea name="note" id="m-cn" rows="2" maxlength="200"></textarea>', { for: 'note', req: true }),
      foot: '<button type="button" class="btn" data-m="close">Cancel</button><button type="submit" class="btn danger">Reject</button>',
      onSubmit: function (f) { var n = U.val(f, 'note'); if (!U.setErr(f, 'note', n.length < 3 ? 'Add a short reason' : '')) return; U.closeModal(); St.decideCorrection(c.id, 'Rejected', n); U.toast('Rejected'); } });
  };
  U.views.leave = function (arg) {
    if (!St.can('leave')) return U.locked('leave', 'Leave Management', 'Staff request leave from their phone; you approve or reject it, and approved leave shows on the register automatically.');
    if (arg === 'corrections') return corrections();
    var all = St.leaves(), c = { Pending: 0, Approved: 0, Rejected: 0 };
    all.forEach(function (l) { c[l.status]++; });
    var q = F.lq.toLowerCase();
    var list = all.filter(function (l) {
      var p = St.person(l.staff) || { name: '' };
      return (!F.ltype || l.type === F.ltype) && (!F.lstatus || l.status === F.lstatus) && (!F.lmonth || l.from.slice(0, 7) === F.lmonth || l.to.slice(0, 7) === F.lmonth) && (!q || p.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return (a.status === 'Pending' ? 0 : 1) - (b.status === 'Pending' ? 0 : 1) || (a.from < b.from ? 1 : -1); });
    var months = {}; all.forEach(function (l) { months[l.from.slice(0, 7)] = 1; });
    var h = U.pageHead('Leave Management', 'Review and manage employee leave requests.', '<button class="btn pri" data-a="leave-new">' + ic('plus') + 'New leave request</button>') + reqTabs('leave');
    h += '<div class="kpis">' + U.kpi('report', 'Total Requests', all.length, '', 'var(--blue-light)', 'var(--blue)') +
      U.kpi('hourglass', 'Pending Approval', c.Pending, '', 'var(--warning-light)', '#B7791F') +
      U.kpi('check', 'Approved', c.Approved, '', 'var(--success-light)', 'var(--success)') +
      U.kpi('x', 'Rejected', c.Rejected, '', 'var(--danger-light)', 'var(--danger)') + '</div>';
    h += '<section class="card"><div class="toolbar"><div class="tb-search">' + ic('search') + '<label class="sr" for="f-lq">Search</label><input id="f-lq" type="search" data-f="lq" placeholder="Search by employee name" value="' + esc(F.lq) + '"></div>' +
      '<label class="sr" for="f-ltype">Leave type</label><select id="f-ltype" data-f="ltype">' + U.options([['', 'All leave types'], 'Casual', 'Sick', 'Unpaid', 'Other'], F.ltype) + '</select>' +
      '<label class="sr" for="f-lstatus">Status</label><select id="f-lstatus" data-f="lstatus">' + U.options([['', 'All status'], 'Pending', 'Approved', 'Rejected'], F.lstatus) + '</select>' +
      '<label class="sr" for="f-lmonth">Month</label><select id="f-lmonth" data-f="lmonth">' + U.options([['', 'All months']].concat(Object.keys(months).sort().reverse().map(function (m) { return [m, U.monthLabel(m)]; })), F.lmonth) + '</select></div>';
    if (!list.length) return h + '<div class="empty big">' + ic('leave') + '<b>No leave requests match</b><span>Change the filters to see more.</span></div></section>';
    h += '<div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Leave type</th><th>From</th><th>To</th><th>Total days</th><th>Reason</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>' +
      list.map(function (l) {
        var p = St.person(l.staff);
        return '<tr><td><span class="who">' + U.avatar(p) + '<span><b>' + esc(p.name) + '</b><small>' + esc(p.designation) + '</small></span></span></td><td>' + l.type + '</td><td>' + U.dLabel(l.from, true) + '</td><td>' + U.dLabel(l.to, true) + '</td><td>' + l.days + '</td><td class="wrap">' + esc(l.reason) + '</td><td>' + U.leaveBadge(l.status) + '</td>' +
          '<td class="r"><span class="row-act">' + (l.status === 'Pending' ? '<span class="act"><button class="ok" data-a="leave-decide:' + l.id + ':Approved" aria-label="Approve ' + esc(p.name) + '">' + ic('check') + '</button><button class="no" data-a="leave-decide:' + l.id + ':Rejected" aria-label="Reject ' + esc(p.name) + '">' + ic('x') + '</button></span>' : '') +
          '<button class="icon-btn sm" data-a="leave-view:' + l.id + '" aria-label="View request from ' + esc(p.name) + '">' + ic('eye') + '</button></span></td></tr>';
      }).join('') + '</tbody></table></div><div class="tbl-foot">' + list.length + ' request' + (list.length > 1 ? 's' : '') + '</div></section>';
    return h;
  };
  U.actions['leave-view'] = function (p) {
    var l = St.leaves().filter(function (x) { return x.id === p[0]; })[0], e = St.person(l.staff);
    var hist = St.leaves().filter(function (x) { return x.staff === l.staff && x.id !== l.id; });
    U.modal({
      title: 'Leave request', foot: l.status === 'Pending' ? '<button type="button" class="btn danger-o" data-m="reject">Reject</button><button type="button" class="btn pri" data-m="approve">Approve</button>' : '<button type="button" class="btn" data-m="close">Close</button>',
      body: '<div class="who" style="margin-bottom:14px">' + U.avatar(e, 44) + '<span><b>' + esc(e.name) + '</b><small>' + esc(e.designation) + ' · ' + e.id + '</small></span></div>' +
        '<dl class="dl"><dt>Type</dt><dd>' + l.type + ' leave</dd><dt>Dates</dt><dd>' + U.dLabel(l.from, true) + (l.to !== l.from ? ' – ' + U.dLabel(l.to, true) : '') + '</dd><dt>Total</dt><dd>' + l.days + ' day(s)</dd><dt>Reason</dt><dd>' + esc(l.reason) + '</dd><dt>Applied</dt><dd>' + U.dLabel(l.applied, true) + '</dd><dt>Status</dt><dd>' + U.leaveBadge(l.status) + '</dd></dl>' +
        '<h3 class="sub-h">Leave history</h3>' + (hist.length ? '<ul class="list">' + hist.map(function (x) { return '<li><span class="grow"><b>' + x.type + ' · ' + x.days + ' day(s)</b><small>' + U.dLabel(x.from) + (x.to !== x.from ? ' – ' + U.dLabel(x.to) : '') + ' · ' + esc(x.reason) + '</small></span>' + U.leaveBadge(x.status) + '</li>'; }).join('') + '</ul>' : '<p class="muted">No other requests.</p>'),
      onClick: function (ev) {
        var b = ev.target.closest('[data-m]'); if (!b) return;
        var m = b.getAttribute('data-m');
        if (m === 'approve') { U.closeModal(); St.decideLeave(l.id, 'Approved'); U.toast('Approved leave for ' + e.name); }
        if (m === 'reject') { U.closeModal(); U.rejectLeave(l); }
      },
    });
  };
  U.leaveForm = function (o) {
    // o: { staff (fixed id or null), by, onDone }
    var staff = St.staff();
    U.modal({
      title: o.title || 'New leave request', submit: 'Submit request',
      body: (o.staff ? '' : U.field('Employee', '<select name="staff" id="m-ls">' + U.options(staff.map(function (s) { return [s.id, s.name]; }), '') + '</select>', { for: 'staff', req: true })) +
        '<div class="grid2">' + U.field('Leave type', '<select name="type" id="m-lt">' + U.options(['Casual', 'Sick', 'Unpaid', 'Other'], 'Casual') + '</select>', { for: 'type' }) + '<span></span>' +
        U.field('From', '<input name="from" id="m-lf" type="date" value="' + U.addDays(St.today, 1) + '">', { for: 'from', req: true }) +
        U.field('To', '<input name="to" id="m-lto" type="date" value="' + U.addDays(St.today, 1) + '">', { for: 'to', req: true }) + '</div>' +
        U.field('Reason', '<textarea name="reason" id="m-lr" rows="2" maxlength="200" placeholder="e.g. Family function"></textarea>', { for: 'reason', req: true }),
      onSubmit: function (f) {
        var v = { staff: o.staff || U.val(f, 'staff'), type: U.val(f, 'type'), from: U.val(f, 'from'), to: U.val(f, 'to'), reason: U.val(f, 'reason') }, ok = true;
        ok = U.setErr(f, 'from', !v.from ? 'Pick a start date' : v.from < U.addDays(St.today, -30) ? 'Too far in the past' : '') && ok;
        ok = U.setErr(f, 'to', !v.to ? 'Pick an end date' : v.to < v.from ? 'End date is before start date' : '') && ok;
        ok = U.setErr(f, 'reason', v.reason.length < 3 ? 'Add a short reason' : '') && ok;
        if (!ok) return;
        v.days = Math.round((U.parse(v.to) - U.parse(v.from)) / 864e5) + 1;
        if (v.days > 30) { U.setErr(f, 'to', 'Leave can be at most 30 days'); return; }
        var l = St.addLeave(v, o.by); U.closeModal(); U.toast('Leave request submitted (' + v.days + ' day' + (v.days > 1 ? 's' : '') + ')');
        if (o.onDone) o.onDone(l);
      },
    });
  };
  U.actions['leave-new'] = function (p) { U.leaveForm({ staff: p[0] || null }); };

  // =================== REPORTS ===================
  F.rrange = F.rrange || 'month'; F.remp = F.remp || ''; F.rdesig = F.rdesig || ''; F.rstatus = F.rstatus || '';
  function range() {
    var t = St.today;
    if (F.rrange === '7') return [U.addDays(t, -6), t, 'Last 7 days'];
    if (F.rrange === '30') return [U.addDays(t, -29), t, 'Last 30 days'];
    if (F.rrange === 'last') { var d = U.parse(U.monthStart(t)); d.setDate(0); var e = U.iso(d); return [U.monthStart(e), e, U.monthLabel(e.slice(0, 7))]; }
    if (F.rrange === 'custom' && F.rfrom && F.rto && F.rfrom <= F.rto) return [F.rfrom, F.rto > t ? t : F.rto, U.dLabel(F.rfrom) + ' – ' + U.dLabel(F.rto)];
    return [U.monthStart(t), t, U.monthLabel(t.slice(0, 7)) + ' (to date)'];
  }
  function reportData() {
    var rg = range(), ppl = St.staff().filter(function (p) { return (!F.remp || p.id === F.remp) && (!F.rdesig || p.designation === F.rdesig); });
    var ids = {}; ppl.forEach(function (p) { ids[p.id] = 1; });
    var recs = St.range(rg[0], rg[1]).filter(function (r) { return ids[r.staff] && (!F.rstatus || r.status === F.rstatus); });
    return { rg: rg, ppl: ppl, recs: recs };
  }
  U.views.reports = function () {
    var D = reportData(), c = U.count(D.recs), adv = St.can('reports_advanced');
    var hrs = U.avg(D.recs.filter(function (r) { return r.date < St.today; }).map(U.worked));
    var h = U.pageHead('Reports & Analytics', D.rg[2] + ' · ' + D.ppl.length + ' employee' + (D.ppl.length === 1 ? '' : 's'),
      (St.live ? '' : '<span class="sample">' + ic('alert') + 'Sample data</span>') + '<button class="btn" data-a="rep-csv:summary">' + ic('download') + 'Summary CSV</button><button class="btn pri" data-a="rep-csv:daily">' + ic('download') + 'Daily CSV</button>');
    h += '<section class="card" style="margin-bottom:16px"><div class="toolbar" style="margin:0">' +
      '<label class="sr" for="f-rrange">Date range</label><select id="f-rrange" data-f="rrange">' + U.options([['month', 'This month'], ['last', 'Last month'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Custom range']], F.rrange) + '</select>' +
      (F.rrange === 'custom' ? '<label class="sr" for="f-rfrom">From</label><input id="f-rfrom" type="date" data-f="rfrom" value="' + (F.rfrom || U.monthStart(St.today)) + '" max="' + St.today + '"><label class="sr" for="f-rto">To</label><input id="f-rto" type="date" data-f="rto" value="' + (F.rto || St.today) + '" max="' + St.today + '">' : '') +
      '<label class="sr" for="f-remp">Employee</label><select id="f-remp" data-f="remp">' + U.options([['', 'All employees']].concat(St.staff().map(function (s) { return [s.id, s.name]; })), F.remp) + '</select>' +
      '<label class="sr" for="f-rdesig">Designation</label><select id="f-rdesig" data-f="rdesig">' + U.options([['', 'All designations']].concat(St.designations()), F.rdesig) + '</select>' +
      '<label class="sr" for="f-rstatus">Status</label><select id="f-rstatus" data-f="rstatus">' + U.options([['', 'All status'], ['present', 'Present'], ['late', 'Late'], ['halfday', 'Half day'], ['absent', 'Absent'], ['leave', 'On leave']], F.rstatus) + '</select></div></section>';
    var lateRate = (c.present + c.late) ? c.late / (c.present + c.late) : null;
    h += '<div class="kpis">' + U.kpi('target', 'Attendance rate', c.rate == null ? '—' : Math.round(c.rate * 1000) / 10 + '%', c.workdays + ' staff-days', 'var(--success-light)', 'var(--success)') +
      U.kpi('x', 'Absenteeism', c.workdays ? Math.round(c.absent / c.workdays * 1000) / 10 + '%' : '—', c.absent + ' absent days', 'var(--danger-light)', 'var(--danger)') +
      U.kpi('clock', 'Late arrival rate', !adv ? '<span class="lock-note">' + ic('lock') + 'Premium</span>' : lateRate == null ? '—' : Math.round(lateRate * 1000) / 10 + '%', adv ? c.late + ' late check-ins' : 'Needs staff check-in', 'var(--warning-light)', '#B7791F') +
      U.kpi('hourglass', 'Avg working hours', !adv ? '<span class="lock-note">' + ic('lock') + 'Premium</span>' : U.dur(hrs), adv ? 'per present day' : 'Needs staff check-in', 'var(--blue-light)', 'var(--blue)') + '</div>';

    if (!D.recs.length) return h + '<section class="card"><div class="empty big">' + ic('bars') + '<b>No attendance in this range</b><span>Try a wider date range or clear the filters.</span></div></section>';

    // Daily trend
    var days = [], d = D.rg[0];
    while (d <= D.rg[1] && days.length < 62) { days.push(d); d = U.addDays(d, 1); }
    var pts = days.map(function (x) {
      var rs = D.recs.filter(function (r) { return r.date === x; }), cc = U.count(rs);
      return { label: String(U.parse(x).getDate()), value: cc.rate == null ? 0 : cc.rate, tip: U.dLabel(x, true) + ': ' + (cc.rate == null ? 'no working staff' : Math.round(cc.rate * 100) + '% (' + (cc.present + cc.late + cc.halfday) + '/' + cc.workdays + ')') };
    });
    h += '<div class="row r-2"><section class="card"><div class="card-h"><h2>Daily attendance trend</h2><span class="muted">% of scheduled staff present</span></div>' + U.trend(pts, { label: 'Daily attendance rate', line: true }) + '</section>';

    // Monthly trend (last 6 months)
    var months = [];
    for (var i = 5; i >= 0; i--) { var md = U.parse(U.monthStart(St.today)); md.setMonth(md.getMonth() - i); months.push(U.iso(md).slice(0, 7)); }
    months = months.filter(function (m) { return St.range(m + '-01', m + '-31').length; });
    var mpts = months.map(function (m) {
      var rs = St.range(m + '-01', m + '-31').filter(function (r) { return D.ppl.some(function (p) { return p.id === r.staff; }); }), cc = U.count(rs);
      return { label: U.MON[+m.slice(5) - 1], value: cc.rate || 0, tip: U.monthLabel(m) + ': ' + (cc.rate == null ? 'no data' : Math.round(cc.rate * 100) + '%'), color: cc.rate == null ? '#EEF2F6' : null };
    });
    h += '<section class="card"><div class="card-h"><h2>Monthly trend</h2><span class="muted">Months with records</span></div>' + U.trend(mpts, { label: 'Monthly attendance rate' }) + '</section></div>';

    if (!adv) {
      h += '<section class="card placeholder sm">' + ic('lock') + '<h2>Designation, late-arrival and employee comparison charts are on Premium</h2><p>They need staff check-in times.</p><a class="btn pri" href="#/plans">See Premium</a></section>';
    } else {
      var desig = {}; D.recs.forEach(function (r) { var p = St.person(r.staff); (desig[p.designation] = desig[p.designation] || []).push(r); });
      var drows = Object.keys(desig).map(function (k) { var cc = U.count(desig[k]); return { label: k, value: cc.rate || 0, max: 1, text: cc.rate == null ? '—' : Math.round(cc.rate * 100) + '%', color: (cc.rate || 0) >= 0.9 ? 'var(--success)' : (cc.rate || 0) >= 0.75 ? 'var(--warning)' : 'var(--danger)' }; }).sort(function (a, b) { return b.value - a.value; });
      var per = D.ppl.map(function (p) { var rs = D.recs.filter(function (r) { return r.staff === p.id; }), cc = U.count(rs); return { p: p, c: cc, hrs: U.avg(rs.filter(function (r) { return r.date < St.today; }).map(U.worked)), lateAvg: U.avg(rs.filter(function (r) { return r.status === 'late'; }).map(U.lateMin)) }; });
      var lmax = Math.max.apply(null, per.map(function (x) { return x.c.late; }).concat([1]));
      var lrows = per.filter(function (x) { return x.c.late; }).sort(function (a, b) { return b.c.late - a.c.late; }).slice(0, 8).map(function (x) { return { label: x.p.name, value: x.c.late, max: lmax, text: x.c.late + '× · avg ' + Math.round(x.lateAvg || 0) + 'm', color: 'var(--warning)' }; });
      h += '<div class="row r-2"><section class="card"><div class="card-h"><h2>Designation-wise attendance</h2></div>' + U.hbars(drows) + '</section>' +
        '<section class="card"><div class="card-h"><h2>Late arrivals by employee</h2></div>' + U.hbars(lrows) + '</section></div>';
      h += '<section class="card"><div class="card-h"><h2>Employee comparison</h2><button class="btn sm" data-a="rep-csv:summary">' + ic('download') + 'CSV</button></div><div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Present</th><th>Late</th><th>Half day</th><th>Absent</th><th>Leave</th><th>Avg hours</th><th>Attendance</th></tr></thead><tbody>' +
        per.sort(function (a, b) { return (b.c.rate || 0) - (a.c.rate || 0); }).map(function (x) {
          var rt = x.c.rate || 0;
          return '<tr><td><a class="who" href="#/staff/' + x.p.id + '">' + U.avatar(x.p, 28) + '<span><b>' + esc(x.p.name) + '</b><small>' + esc(x.p.designation) + '</small></span></a></td><td>' + x.c.present + '</td><td>' + x.c.late + '</td><td>' + x.c.halfday + '</td><td>' + x.c.absent + '</td><td>' + x.c.leave + '</td><td>' + U.dur(x.hrs) + '</td>' +
            '<td><span class="meter"><i style="width:' + rt * 100 + '%;background:' + (rt >= 0.9 ? 'var(--success)' : rt >= 0.75 ? 'var(--warning)' : 'var(--danger)') + '"></i></span> ' + (x.c.rate == null ? '—' : Math.round(rt * 100) + '%') + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    return h;
  };
  U.actions['rep-csv'] = function (p) {
    var D = reportData(), tag = D.rg[0] + '_to_' + D.rg[1];
    if (p[0] === 'daily') {
      U.csv('attendance-daily-' + tag + '.csv', [['Date', 'Employee ID', 'Name', 'Designation', 'Status', 'Check-in', 'Check-out', 'Worked (h:mm)', 'Remark']].concat(
        D.recs.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.staff < b.staff ? -1 : 1; }).map(function (r) {
          var x = St.person(r.staff), w = U.worked(r); return [r.date, r.staff, x.name, x.designation, St.LABEL[r.status], r.in || '', r.out || '', w == null ? '' : Math.floor(w / 60) + ':' + U.pad(w % 60), r.remark || ''];
        })));
    } else {
      U.csv('attendance-summary-' + tag + '.csv', [['Employee ID', 'Name', 'Designation', 'Present', 'Late', 'Half day', 'Absent', 'On leave', 'Weekly off', 'Attendance %']].concat(
        D.ppl.map(function (x) { var cc = U.count(D.recs.filter(function (r) { return r.staff === x.id; })); return [x.id, x.name, x.designation, cc.present, cc.late, cc.halfday, cc.absent, cc.leave, cc.weeklyoff, cc.rate == null ? '' : Math.round(cc.rate * 1000) / 10]; })));
    }
  };
})();
