/* Staff360 v2 — Staff Directory, Employee Profile, Add/Edit employee. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var F = U.state;
  F.sq = F.sq || ''; F.sstatus = F.sstatus || 'Active'; F.sdesig = F.sdesig || ''; F.ssort = F.ssort || 'id';

  function sortStaff(list) {
    var k = F.ssort, dir = 1;
    if (k.charAt(0) === '-') { dir = -1; k = k.slice(1); }
    return list.slice().sort(function (a, b) { var x = String(a[k] || ''), y = String(b[k] || ''); return x < y ? -dir : x > y ? dir : 0; });
  }
  function th(label, key) {
    var on = F.ssort.replace('-', '') === key, desc = F.ssort === '-' + key;
    return '<th aria-sort="' + (on ? (desc ? 'descending' : 'ascending') : 'none') + '"><button class="th-sort" data-a="staff-sort:' + key + '">' + label + (on ? (desc ? ' ↓' : ' ↑') : '') + '</button></th>';
  }

  // ---------- directory ----------
  U.views.staff = function (arg) {
    if (arg) return profile(arg);
    var all = St.staff({ all: true }), active = all.filter(function (s) { return s.status === 'Active'; });
    var ym = St.today.slice(0, 7), newMonth = all.filter(function (s) { return (s.joined || '').slice(0, 7) === ym; }).length;
    var q = F.sq.toLowerCase();
    var list = sortStaff(all.filter(function (s) {
      return (!F.sstatus || s.status === F.sstatus) && (!F.sdesig || s.designation === F.sdesig) &&
        (!q || (s.name + ' ' + s.id + ' ' + s.mobile).toLowerCase().indexOf(q) >= 0);
    }));
    var h = U.pageHead('Staff Management', 'Manage your employees, roles and employment details.',
      '<button class="btn" data-a="staff-export">' + ic('download') + 'Export</button><button class="btn pri" data-a="staff-add">' + ic('plus') + 'Add Employee</button>');
    h += '<div class="kpis">' +
      U.kpi('users', 'Total Employees', all.length, '', 'var(--blue-light)', 'var(--blue)') +
      U.kpi('check', 'Active Employees', active.length, '', 'var(--success-light)', 'var(--success)') +
      U.kpi('x', 'Inactive Employees', all.length - active.length, '', 'var(--danger-light)', 'var(--danger)') +
      U.kpi('userplus', 'New This Month', newMonth, '', 'var(--purple-light)', 'var(--purple)') + '</div>';
    h += '<section class="card"><div class="toolbar">' +
      '<div class="tb-search">' + ic('search') + '<label class="sr" for="f-sq">Search staff</label><input id="f-sq" type="search" data-f="sq" placeholder="Search by name, mobile or ID" value="' + esc(F.sq) + '"></div>' +
      '<label class="sr" for="f-sstatus">Status</label><select id="f-sstatus" data-f="sstatus">' + U.options([['', 'All status'], ['Active', 'Active'], ['Inactive', 'Inactive']], F.sstatus) + '</select>' +
      '<label class="sr" for="f-sdesig">Designation</label><select id="f-sdesig" data-f="sdesig">' + U.options([['', 'All designations']].concat(St.designations()), F.sdesig) + '</select>' +
      '<label class="sr" for="f-ssort">Sort</label><select id="f-ssort" data-f="ssort">' + U.options([['id', 'Sort: Employee ID'], ['name', 'Sort: Name A–Z'], ['-name', 'Sort: Name Z–A'], ['-joined', 'Sort: Newest joiner'], ['joined', 'Sort: Oldest joiner']], F.ssort) + '</select></div>';
    if (!list.length) {
      h += '<div class="empty big">' + ic('users') + '<b>No employees match these filters</b><span>Try clearing the search or changing the status filter.</span><button class="btn" data-a="staff-clear">Clear filters</button></div></section>';
      return h;
    }
    h += '<div class="tbl-wrap"><table class="t"><thead><tr>' + th('Emp. ID', 'id') + th('Name', 'name') + '<th>Mobile</th>' + th('Designation', 'designation') + th('Joining Date', 'joined') + '<th>Status</th><th>Today</th><th class="r">Actions</th></tr></thead><tbody>' +
      list.map(function (s) {
        var r = St.record(s.id, St.today);
        return '<tr><td class="mono">' + esc(U.code(s)) + '</td><td><a class="who" href="#/staff/' + s.id + '">' + U.avatar(s) + '<span><b>' + esc(s.name) + '</b><small>' + esc(s.type) + '</small></span></a></td>' +
          '<td>' + U.mobile(s.mobile) + '</td><td>' + esc(s.designation) + '</td><td>' + U.joinLabel(s) + '</td>' +
          '<td><span class="badge ' + (s.status === 'Active' ? 'b-green' : 'b-grey') + '">' + s.status + '</span></td>' +
          '<td>' + (s.status === 'Active' ? U.badge(r ? r.status : null) : '<span class="muted">—</span>') + '</td>' +
          '<td class="r"><span class="row-act"><a class="icon-btn sm" href="#/staff/' + s.id + '" aria-label="View ' + esc(s.name) + '" title="View">' + ic('eye') + '</a>' +
          '<button class="icon-btn sm" data-a="staff-edit:' + s.id + '" aria-label="Edit ' + esc(s.name) + '" title="Edit">' + ic('edit') + '</button>' +
          '<button class="icon-btn sm" data-a="staff-toggle:' + s.id + '" aria-label="' + (s.status === 'Active' ? 'Deactivate ' : 'Reactivate ') + esc(s.name) + '" title="' + (s.status === 'Active' ? 'Deactivate' : 'Reactivate') + '">' + ic(s.status === 'Active' ? 'x' : 'refresh') + '</button></span></td></tr>';
      }).join('') + '</tbody></table></div><div class="tbl-foot">Showing ' + list.length + ' of ' + all.length + ' employees</div></section>';
    return h;
  };

  // ---------- profile ----------
  F.ptab = F.ptab || 'overview';
  function profile(id) {
    var p = St.person(id);
    if (!p) return '<div class="card placeholder"><h1>Employee not found</h1><p>No employee has the ID ' + esc(id) + '.</p><a class="btn" href="#/staff">Back to staff</a></div>';
    var sh = St.shift(p.shift), today = St.today, r = St.record(id, today);
    var monthRecs = St.range(U.monthStart(today), today).filter(function (x) { return x.staff === id; }), c = U.count(monthRecs);
    var h = '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/staff">Staff</a> › <span>' + esc(p.name) + '</span></nav>';
    h += '<section class="card prof-h">' + U.avatar(p, 64) + '<div class="grow"><h1>' + esc(p.name) + ' <span class="badge ' + (p.status === 'Active' ? 'b-green' : 'b-grey') + '">' + p.status + '</span></h1>' +
      '<p>' + esc(p.designation) + ' · ' + esc(U.code(p)) + (p.type ? ' · ' + esc(p.type) : '') + (p.hnLogin ? ' · HisaabNow app login' : '') + '</p>' +
      '<div class="facts"><span>' + ic('phone') + U.mobile(p.mobile) + '</span>' + (p.joined ? '<span>' + ic('cal') + 'Joined ' + U.joinLabel(p, true) + '</span>' : '') + '<span>' + ic('clock') + (sh ? esc(sh.name) + ' · ' + U.hm12(sh.start) + '–' + U.hm12(sh.end) : 'No shift') + '</span><span>' + ic('leave') + 'Weekly off: ' + U.offLabel(p) + '</span></div></div>' +
      '<div class="ph-act">' + (p.status === 'Active' ? '<button class="btn" data-a="att-edit:' + id + ':' + today + '">' + ic('calc') + 'Mark today</button>' : '') +
      '<button class="btn" data-a="staff-edit:' + id + '">' + ic('edit') + 'Edit</button><button class="btn ' + (p.status === 'Active' ? 'danger-o' : '') + '" data-a="staff-toggle:' + id + '">' + (p.status === 'Active' ? 'Deactivate' : 'Reactivate') + '</button></div></section>';

    var tabs = [['overview', 'Overview'], ['history', 'Attendance history'], ['leave', 'Leave history'], ['shift', 'Shift details'], ['activity', 'Activity log']];
    h += '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button role="tab" aria-selected="' + (F.ptab === t[0]) + '" class="' + (F.ptab === t[0] ? 'on' : '') + '" data-a="ptab:' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';

    if (F.ptab === 'overview') {
      var leaves = St.leaves().filter(function (l) { return l.staff === id; });
      h += '<div class="row r-3"><section class="card"><div class="card-h"><h2>This month</h2><span class="muted">' + U.monthLabel(today.slice(0, 7)) + '</span></div><div class="donut-wrap"><ul>' +
        [['Present', c.present, 'var(--success)'], ['Late', c.late, 'var(--warning)'], ['Half day', c.halfday, 'var(--orange)'], ['Absent', c.absent, 'var(--danger)'], ['On leave', c.leave, 'var(--purple)'], ['Weekly off', c.weeklyoff, '#98A2B3']]
          .map(function (s) { return '<li><span><i class="dot-s" style="background:' + s[2] + '"></i>' + s[0] + '</span><b>' + s[1] + '</b></li>'; }).join('') + '</ul>' +
        U.ring([[c.present + c.late, 'var(--success)'], [c.halfday, 'var(--orange)'], [c.absent, 'var(--danger)'], [c.leave, 'var(--purple)']], 120, 12, '<b>' + (c.rate == null ? '—' : Math.round(c.rate * 100) + '%') + '</b><small>attendance</small>') + '</div></section>' +
        '<section class="card"><div class="card-h"><h2>Today</h2>' + U.badge(r ? r.status : null) + '</div><dl class="dl">' +
        '<dt>Check-in</dt><dd>' + U.hm12(r && r.in) + (r && r.gps ? ' <span class="badge b-green">' + ic('pin') + 'GPS ±' + r.gps.acc + ' m</span>' : r && r.gps === false ? ' <span class="badge b-grey">No GPS</span>' : '') + '</dd><dt>Check-out</dt><dd>' + U.hm12(r && r.out) + '</dd>' +
        '<dt>Worked</dt><dd>' + U.dur(U.worked(r)) + '</dd><dt>Remark</dt><dd>' + esc((r && r.remark) || '—') + '</dd></dl></section>' +
        '<section class="card"><div class="card-h"><h2>Employment</h2></div><dl class="dl"><dt>Employee login</dt><dd>' + (St.can('employee_login') ? (p.login ? '<span class="badge b-green">Enabled</span>' : '<span class="badge b-grey">Off</span>') : U.lockNote('employee_login')) + '</dd>' +
        '<dt>Monthly salary</dt><dd>' + (p.salary ? U.inr(p.salary) : '—') + ' <small class="muted">· owner only</small></dd>' +
        '<dt>Leave this year</dt><dd>' + leaves.filter(function (l) { return l.status === 'Approved'; }).reduce(function (s, l) { return s + l.days; }, 0) + ' day(s) approved</dd>' +
        '<dt>Emergency contact</dt><dd>' + esc(p.emergency || '—') + '</dd></dl></section></div>';
      h += '<section class="card"><div class="card-h"><h2>Last 14 days</h2><a href="#" data-a="ptab:history">Full history</a></div><div class="strip14">' +
        [].concat.apply([], Array.apply(null, Array(14)).map(function (_, i) { return [U.addDays(today, -13 + i)]; })).map(function (d) {
          var x = St.record(id, d), s = x ? U.STATUS[x.status] : null;
          return '<div class="d14" title="' + U.dLabel(d, true) + ': ' + (s ? s[0] : 'No record') + '"><small>' + U.DOW[U.parse(d).getDay()].charAt(0) + '</small><i style="background:' + (s ? s[1] : '#EEF2F6') + '"></i><span>' + U.parse(d).getDate() + '</span></div>';
        }).join('') + '</div></section>';
    }
    if (F.ptab === 'history') {
      var recs = St.range(U.addDays(today, -30), today).filter(function (x) { return x.staff === id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      h += '<section class="card"><div class="card-h"><h2>Attendance history · last 30 days</h2><button class="btn sm" data-a="staff-hist-csv:' + id + '">' + ic('download') + 'CSV</button></div>' +
        (recs.length ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Worked</th><th>Remark</th><th class="r">Edit</th></tr></thead><tbody>' +
        recs.map(function (x) {
          return '<tr><td><b>' + U.dLabel(x.date) + '</b> <small class="muted">' + U.DOW[U.parse(x.date).getDay()] + '</small></td><td>' + U.badge(x.status) + '</td><td>' + U.hm12(x.in) + '</td><td>' + U.hm12(x.out) + '</td><td>' + U.dur(U.worked(x)) + '</td><td class="wrap">' + esc(x.remark || '') + '</td>' +
            '<td class="r"><button class="icon-btn sm" data-a="att-edit:' + id + ':' + x.date + '" aria-label="Edit ' + U.dLabel(x.date) + '">' + ic('edit') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">No attendance recorded yet.</div>') + '</section>';
    }
    if (F.ptab === 'leave') {
      var ls = St.leaves().filter(function (l) { return l.staff === id; });
      h += '<section class="card"><div class="card-h"><h2>Leave history</h2>' + (St.can('leave') ? '<button class="btn sm" data-a="leave-new:' + id + '">' + ic('plus') + 'Add leave</button>' : U.lockNote('leave')) + '</div>' +
        (ls.length ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th></tr></thead><tbody>' +
        ls.map(function (l) { return '<tr><td>' + l.type + '</td><td>' + U.dLabel(l.from) + '</td><td>' + U.dLabel(l.to) + '</td><td>' + l.days + '</td><td class="wrap">' + esc(l.reason) + '</td><td>' + leaveBadge(l.status) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="empty">No leave requests.</div>') + '</section>';
    }
    if (F.ptab === 'shift') {
      h += '<section class="card"><div class="card-h"><h2>Shift details</h2>' + (St.can('shifts') ? '<button class="btn sm" data-a="shift-assign:' + id + '">' + ic('edit') + 'Change shift</button>' : U.lockNote('shifts')) + '</div>' +
        (sh ? '<dl class="dl"><dt>Shift</dt><dd>' + esc(sh.name) + '</dd><dt>Timing</dt><dd>' + U.hm12(sh.start) + ' – ' + U.hm12(sh.end) + '</dd><dt>Grace period</dt><dd>' + sh.graceMin + ' min</dd><dt>Break</dt><dd>' + sh.breakMin + ' min</dd><dt>Weekly off</dt><dd>' + U.offLabel(p) + '</dd></dl>' : '<div class="empty">No shift assigned.</div>') + '</section>';
    }
    if (F.ptab === 'activity') {
      var log = St.audit(id);
      h += '<section class="card"><div class="card-h"><h2>Activity log</h2><span class="muted">Every change keeps the old and new value</span></div>' +
        (log.length ? '<ul class="timeline">' + log.map(function (a) { return '<li><b>' + esc(a.action) + '</b><span>' + esc(a.detail) + '</span><small>' + esc(a.at) + ' · ' + esc(a.by) + '</small></li>'; }).join('') + '</ul>'
          : '<div class="empty">No changes yet in this session. Edits to attendance, shifts and details will appear here.</div>') + '</section>';
    }
    return h;
  }
  function leaveBadge(s) { return '<span class="badge ' + { Pending: 'b-amber', Approved: 'b-green', Rejected: 'b-red' }[s] + '">' + s + '</span>'; }
  U.leaveBadge = leaveBadge;

  // ---------- add / edit ----------
  function staffForm(p) {
    var isNew = !p; p = p || { id: '', code: '', name: '', mobile: '', designation: '', joined: St.today, type: 'Full-time', shift: (St.shifts()[0] || {}).id || '', weeklyOff: St.settings().defaultWeeklyOff, salary: '', login: false };
    var canLogin = St.can('employee_login'), shop = St.live && St.kind === 'shop', fixed = shop ? ' disabled' : '';
    var codeVal = St.live ? (p.code || '') : p.id;
    var body = '<div class="grid2">' +
      (shop ? '<p class="note" style="grid-column:1/-1;margin:0 0 12px">' + ic('store') + '<span>Name, role and salary come from your HisaabNow app. Here you can set the phone, Staff360 login, ID, shift and weekly off.</span></p>' : '') +
      U.field('Full name', '<input id="m-name" name="name" value="' + esc(p.name) + '" autocomplete="off" maxlength="60"' + fixed + '>', { for: 'name', req: true }) +
      U.field('Mobile number', '<input id="m-mobile" name="mobile" value="' + esc(p.mobile) + '" inputmode="numeric" maxlength="10" placeholder="10-digit mobile">', { for: 'mobile', req: !St.live }) +
      U.field('Employee ID', '<input id="m-id" name="id" value="' + esc(codeVal) + '" ' + (isNew || St.live ? 'placeholder="' + (St.live ? 'Optional, e.g. EMP-01' : 'Auto: ' + St.nextId()) + '"' : 'disabled') + ' maxlength="12">', { for: 'id', hint: St.live ? 'Your own code for this person (optional)' : isNew ? 'Leave blank to generate one' : 'IDs can’t be changed' }) +
      U.field('Designation', '<input id="m-desig" name="designation" list="m-desigs" value="' + esc(p.designation) + '" maxlength="40"' + fixed + '><datalist id="m-desigs">' + St.designations().map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>', { for: 'designation', req: true }) +
      U.field('Joining date', '<input id="m-joined" name="joined" type="date" value="' + p.joined + '" max="' + St.today + '">', { for: 'joined', req: true }) +
      U.field('Employment type', '<select id="m-type" name="type">' + U.options(['Full-time', 'Part-time', 'Contract', 'Temporary'], p.type) + '</select>', { for: 'type' }) +
      U.field('Assigned shift', '<select id="m-shift" name="shift"' + (St.can('shifts') ? '' : ' disabled') + '>' + U.options([['', 'No shift']].concat(St.shifts().map(function (s) { return [s.id, s.name + ' (' + U.hm12(s.start) + '–' + U.hm12(s.end) + ')']; })), p.shift || '') + '</select>', { for: 'shift', hint: St.can('shifts') ? '' : 'Shifts are on Premium' }) +
      U.field('Weekly off', '<select id="m-off" name="weeklyOff">' + U.options([['', 'No weekly off']].concat(U.DOW_LONG.map(function (d, i) { return [i, d]; })), p.weeklyOff == null ? '' : p.weeklyOff) + '</select>', { for: 'weeklyOff' }) +
      U.field('Monthly salary (₹)', '<input id="m-salary" name="salary" type="number" inputmode="numeric" min="0" step="100" value="' + esc(p.salary) + '" placeholder="Optional"' + fixed + '>', { for: 'salary', hint: shop ? 'Set in the HisaabNow app' : 'Visible to the owner only. Managers and employees can’t see it.' }) +
      '<div class="fld"><span class="lbl-like">Employee login</span><label class="switch' + (canLogin ? '' : ' dis') + '"><input type="checkbox" name="login"' + (p.login && canLogin ? ' checked' : '') + (canLogin ? '' : ' disabled') + '><span></span>' + (canLogin ? 'Can check in from their phone' : 'Premium feature') + '</label>' +
      (canLogin ? '<small class="hint">They log in with this mobile number and an OTP.</small>' : '<small class="hint">' + ic('lock') + ' <a href="#/plans" data-m="close">Upgrade to Premium</a> for staff check-in.</small>') + '</div></div>';
    U.modal({
      title: isNew ? 'Add employee' : 'Edit ' + esc(p.name), body: body, submit: isNew ? 'Add employee' : 'Save changes', wide: true,
      onSubmit: function (f) {
        var code = U.val(f, 'id').toUpperCase(), off = U.val(f, 'weeklyOff');
        var v = { name: shop ? p.name : U.val(f, 'name'), mobile: U.val(f, 'mobile').replace(/\D/g, ''),
          id: St.live ? (isNew ? 'new_' + Date.now() : p.id) : (isNew ? (code || St.nextId()) : p.id), code: St.live ? code : undefined,
          designation: shop ? p.designation : U.val(f, 'designation'), joined: U.val(f, 'joined'), type: U.val(f, 'type'), shift: St.can('shifts') ? U.val(f, 'shift') : p.shift || '', weeklyOff: off === '' ? null : +off,
          salary: shop ? p.salary : U.val(f, 'salary') ? +U.val(f, 'salary') : '', login: canLogin ? U.val(f, 'login') : !!p.login, status: isNew ? 'Active' : p.status, hnLogin: p.hnLogin };
        if (!St.live) delete v.code;
        var ok = true;
        ok = U.setErr(f, 'name', v.name.length < 2 ? 'Enter the employee’s full name' : '') && ok;
        var dupM = St.staff({ all: true }).filter(function (s) { return s.mobile === v.mobile && s.id !== p.id; })[0];
        var needMobile = !St.live || v.login;
        ok = U.setErr(f, 'mobile', v.mobile && !/^[6-9]\d{9}$/.test(v.mobile) ? 'Enter a valid 10-digit Indian mobile number' : !v.mobile && needMobile ? (St.live ? 'A mobile number is needed for login' : 'Enter a valid 10-digit Indian mobile number') : dupM && v.mobile ? 'Already used by ' + dupM.name : '') && ok;
        var idv = St.live ? code : v.id, dupId = St.live ? (code && St.staff({ all: true }).filter(function (s) { return s.code === code && s.id !== p.id; })[0]) : isNew && St.person(v.id);
        ok = U.setErr(f, 'id', idv && (isNew || St.live) && !/^[A-Z0-9-]{2,12}$/.test(idv) ? 'Use letters, numbers or “-” (2–12)' : dupId ? 'This ID is already taken' : '') && ok;
        ok = U.setErr(f, 'designation', !v.designation ? 'Enter a designation, e.g. Cashier' : '') && ok;
        ok = U.setErr(f, 'joined', !v.joined ? 'Pick the joining date' : v.joined > St.today ? 'Joining date can’t be in the future' : '') && ok;
        ok = U.setErr(f, 'salary', v.salary !== '' && (v.salary < 0 || v.salary > 1000000) ? 'Enter a salary between ₹0 and ₹10,00,000' : '') && ok;
        if (!ok) { var bad = f.querySelector('[aria-invalid="true"]'); if (bad) bad.focus(); return; }
        var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
        St.saveStaff(v, isNew).then(function (id) {
          U.closeModal(); U.toast(isNew ? v.name + ' added' + (St.live ? '' : ' as ' + v.id) : 'Saved changes for ' + v.name);
          if (isNew) location.hash = '#/staff/' + id;
        }, function () { btn.disabled = false; btn.textContent = isNew ? 'Add employee' : 'Save changes'; U.closeModal(); });
      },
    });
  }

  U.actions['staff-add'] = function () {
    if (St.live && !St.editable) {
      U.modal({ title: 'Add staff in the HisaabNow app', foot: '<button type="button" class="btn" data-m="close">Close</button><a class="btn pri" href="https://app.hisaabnow.com/" target="_blank" rel="noopener">Open HisaabNow app</a>',
        body: '<p>This is your HisaabNow shop, so its staff list comes from the HisaabNow app. Add the person there; they appear here automatically. Then come back to give them a Staff360 login, a shift and a weekly off.</p>' +
          '<p class="muted" style="margin-top:10px">Want a separate staff list just for Staff360? <a href="#" data-m="close" onclick="S360Store.backend().newBusiness();return false">Set up a separate Staff360 business</a>.</p>' });
      return;
    }
    var max = St.extra.maxStaff;
    if (St.live && max && St.staff().length >= max) { U.toast('Your plan allows ' + max + ' staff. Upgrade to add more.'); return; }
    staffForm(null);
  };
  U.actions['staff-edit'] = function (p) { staffForm(St.person(p[0])); };
  U.actions['staff-toggle'] = function (p) {
    var s = St.person(p[0]);
    if (St.live && St.kind === 'shop') { U.toast('Remove or deactivate staff in the HisaabNow app. Here you can turn off their Staff360 login.'); return; }
    if (St.live && St.role !== 'owner') { U.toast('Only the owner can deactivate staff.'); return; }
    if (s.status === 'Active') U.confirm('Deactivate ' + esc(s.name) + '?', 'They will be hidden from attendance and can’t log in. Their history is kept, and you can reactivate them any time.', 'Deactivate', function () { St.setStaffStatus(s.id, 'Inactive'); U.toast(s.name + ' deactivated'); }, true);
    else { St.setStaffStatus(s.id, 'Active'); U.toast(s.name + ' reactivated'); }
  };
  U.actions['staff-sort'] = function (p) { F.ssort = F.ssort === p[0] ? '-' + p[0] : p[0]; U.render(); };
  U.actions['staff-clear'] = function () { F.sq = ''; F.sstatus = ''; F.sdesig = ''; U.render(); };
  U.actions.ptab = function (p) { F.ptab = p[0]; U.render(); };
  U.actions['staff-export'] = function () {
    U.csv('staff-' + St.today + '.csv', [['Employee ID', 'Name', 'Mobile', 'Designation', 'Joining date', 'Employment type', 'Shift', 'Weekly off', 'Status']].concat(
      St.staff({ all: true }).map(function (s) { return [U.code(s), s.name, s.mobile, s.designation, s.joined, s.type, (St.shift(s.shift) || {}).name || '', U.offLabel(s), s.status]; })));
  };
  U.actions['staff-hist-csv'] = function (p) {
    var recs = St.range(U.addDays(St.today, -30), St.today).filter(function (x) { return x.staff === p[0]; });
    U.csv(p[0] + '-attendance.csv', [['Date', 'Status', 'Check-in', 'Check-out', 'Worked (min)', 'Remark']].concat(recs.map(function (x) { return [x.date, St.LABEL[x.status], x.in || '', x.out || '', U.worked(x) || '', x.remark || '']; })));
  };
})();
