/* Staff360 v2 — Attendance Register: list view, calendar view, mark/correct, bulk mark. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var F = U.state;
  F.adate = F.adate || St.today; F.aemp = F.aemp || ''; F.adesig = F.adesig || ''; F.astatus = F.astatus || ''; F.aview = F.aview || 'list';
  F.amonth = F.amonth || St.today.slice(0, 7);
  var sel = {}; // selected staff ids for bulk marking

  var STATUS_OPTS = [['present', 'Present'], ['late', 'Late'], ['halfday', 'Half day'], ['absent', 'Absent'], ['leave', 'On leave'], ['weeklyoff', 'Weekly off']];

  U.views.attendance = function (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.adate || '') || F.adate > St.today) F.adate = St.today;
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) { F.adate = arg > St.today ? St.today : arg; F.aview = 'list'; }
    else if (arg === 'calendar') F.aview = 'calendar';
    var h = U.pageHead('Attendance Register', 'View, mark and correct daily attendance for your team.',
      '<button class="btn" data-a="att-bulk">' + ic('users') + 'Bulk mark</button><button class="btn pri" data-a="att-edit::' + F.adate + '">' + ic('plus') + 'Add / correct attendance</button>');
    h += '<section class="card"><div class="toolbar">' +
      (F.aview === 'list' ? '<div class="date-nav"><button class="icon-btn sm" data-a="att-day:-1" aria-label="Previous day">' + ic('left') + '</button><label class="sr" for="f-adate">Date</label><input id="f-adate" type="date" data-f="adate" value="' + F.adate + '" max="' + St.today + '"><button class="icon-btn sm" data-a="att-day:1" aria-label="Next day"' + (F.adate >= St.today ? ' disabled' : '') + '>' + ic('right') + '</button></div>'
        : '<div class="date-nav"><button class="icon-btn sm" data-a="att-month:-1" aria-label="Previous month">' + ic('left') + '</button><b class="mlabel">' + U.monthLabel(F.amonth) + '</b><button class="icon-btn sm" data-a="att-month:1" aria-label="Next month"' + (F.amonth >= St.today.slice(0, 7) ? ' disabled' : '') + '>' + ic('right') + '</button></div>') +
      '<label class="sr" for="f-aemp">Employee</label><select id="f-aemp" data-f="aemp">' + U.options([['', 'All employees']].concat(St.staff().map(function (s) { return [s.id, s.name]; })), F.aemp) + '</select>' +
      '<label class="sr" for="f-adesig">Designation</label><select id="f-adesig" data-f="adesig">' + U.options([['', 'All designations']].concat(St.designations()), F.adesig) + '</select>' +
      (F.aview === 'list' ? '<label class="sr" for="f-astatus">Status</label><select id="f-astatus" data-f="astatus">' + U.options([['', 'All status']].concat(STATUS_OPTS).concat([['notin', 'Not marked']]), F.astatus) + '</select>' : '') +
      '<div class="seg" role="group" aria-label="View"><button class="' + (F.aview === 'list' ? 'on' : '') + '" data-a="att-view:list" aria-pressed="' + (F.aview === 'list') + '">' + ic('list') + 'List</button><button class="' + (F.aview === 'calendar' ? 'on' : '') + '" data-a="att-view:calendar" aria-pressed="' + (F.aview === 'calendar') + '">' + ic('grid') + 'Calendar</button></div></div>';
    h += F.aview === 'list' ? list() : calendar();
    return h + '</section>';
  };

  function people() {
    return St.staff().filter(function (s) { return (!F.aemp || s.id === F.aemp) && (!F.adesig || s.designation === F.adesig); });
  }

  function list() {
    var rows = people().map(function (s) { return { p: s, r: St.record(s.id, F.adate) }; });
    var c = { present: 0, late: 0, halfday: 0, absent: 0, leave: 0, weeklyoff: 0, notin: 0 };
    rows.forEach(function (x) { c[x.r ? x.r.status : 'notin']++; });
    rows = rows.filter(function (x) { return !F.astatus || (x.r ? x.r.status : 'notin') === F.astatus; });
    var nSel = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
    var h = '<div class="chips">' + [['present', c.present], ['late', c.late], ['halfday', c.halfday], ['absent', c.absent], ['leave', c.leave], ['weeklyoff', c.weeklyoff], ['notin', c.notin]].map(function (k) {
      return '<button class="chip' + (F.astatus === k[0] ? ' on' : '') + '" data-a="att-chip:' + k[0] + '"><i style="background:' + U.STATUS[k[0]][1] + '"></i>' + U.STATUS[k[0]][0] + ' <b>' + k[1] + '</b></button>';
    }).join('') + '<span class="muted" style="margin-left:auto">' + U.dLabel(F.adate, true) + (F.adate === St.today ? ' · today' : '') + '</span></div>';
    if (nSel) h += '<div class="bulkbar" role="region" aria-label="Bulk actions"><b>' + nSel + ' selected</b>' + STATUS_OPTS.map(function (o) { return '<button class="btn sm" data-a="att-bulkset:' + o[0] + '">' + o[1] + '</button>'; }).join('') + '<button class="btn sm ghost" data-a="att-unsel">Clear</button></div>';
    if (!rows.length) return h + '<div class="empty big">' + ic('calc') + '<b>No staff match these filters</b><button class="btn" data-a="att-clear">Clear filters</button></div>';
    var allSel = rows.every(function (x) { return sel[x.p.id]; });
    h += '<div class="tbl-wrap"><table class="t"><thead><tr><th class="cb"><input type="checkbox" aria-label="Select all" data-a="att-selall"' + (allSel ? ' checked' : '') + '></th><th>Employee</th><th>Shift</th><th>Check-in</th><th>Check-out</th><th>Working hours</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>' +
      rows.map(function (x) {
        var sh = St.shift(x.p.shift), r = x.r;
        return '<tr' + (sel[x.p.id] ? ' class="sel"' : '') + '><td class="cb"><input type="checkbox" aria-label="Select ' + esc(x.p.name) + '" data-a="att-sel:' + x.p.id + '"' + (sel[x.p.id] ? ' checked' : '') + '></td>' +
          '<td><a class="who" href="#/staff/' + x.p.id + '">' + U.avatar(x.p) + '<span><b>' + esc(x.p.name) + '</b><small>' + esc(x.p.designation) + '</small></span></a></td>' +
          '<td>' + (sh ? esc(sh.name) + ' <small class="muted">(' + U.hm12(sh.start) + '–' + U.hm12(sh.end) + ')</small>' : '—') + '</td>' +
          '<td>' + U.hm12(r && r.in) + (r && r.status === 'late' ? ' <small class="late">+' + U.lateMin(r) + 'm</small>' : '') + (r && r.gps ? ' <span title="GPS ±' + r.gps.acc + ' m" class="gps">' + ic('pin') + '</span>' : '') + '</td>' +
          '<td>' + U.hm12(r && r.out) + '</td><td>' + U.dur(U.worked(r)) + '</td>' +
          '<td>' + U.badge(r ? r.status : null) + (r && r.remark ? '<br><small class="muted wrap">' + esc(r.remark) + '</small>' : '') + '</td>' +
          '<td class="r"><span class="row-act">' + (!r || r.status === 'notin' ? '<button class="btn sm" data-a="att-quick:' + x.p.id + ':present">Present</button><button class="btn sm" data-a="att-quick:' + x.p.id + ':absent">Absent</button>' : '') +
          '<button class="icon-btn sm" data-a="att-edit:' + x.p.id + ':' + F.adate + '" aria-label="Edit attendance for ' + esc(x.p.name) + '" title="Edit">' + ic('edit') + '</button></span></td></tr>';
      }).join('') + '</tbody></table></div>';
    return h;
  }

  function calendar() {
    var ym = F.amonth, y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1, first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    var ppl = people(), one = F.aemp ? St.person(F.aemp) : null;
    var h = '<p class="muted cal-help">' + (one ? 'Showing ' + esc(one.name) + '. Click a day to edit it.' : 'Team view: present staff out of scheduled for each day. Click a day to open it, or pick one employee to see their calendar.') + '</p>';
    h += '<div class="cal" role="grid" aria-label="' + U.monthLabel(ym) + '">' + U.DOW.map(function (d) { return '<div class="cal-h" role="columnheader">' + d + '</div>'; }).join('');
    for (var i = 0; i < first.getDay(); i++) h += '<div class="cal-d empty-d" aria-hidden="true"></div>';
    for (var d = 1; d <= days; d++) {
      var iso = ym + '-' + U.pad(d), future = iso > St.today, inner = '', cls = '';
      if (!future) {
        if (one) {
          var r = St.record(one.id, iso), s = r ? U.STATUS[r.status] : null;
          inner = s ? '<span class="cal-s" style="background:' + s[1] + '">' + s[0] + '</span>' + (U.isIn(r) ? '<small>' + U.hm12(r.in) + '</small>' : '') : '<small class="muted">—</small>';
        } else {
          var recs = ppl.map(function (p) { return St.record(p.id, iso); }).filter(Boolean);
          var ins = recs.filter(U.isIn).length, sched = recs.filter(function (r) { return r.status !== 'weeklyoff' && r.status !== 'leave'; }).length, pct = sched ? ins / sched : 0;
          cls = recs.length && iso !== St.today ? (pct >= 0.9 ? ' good' : pct >= 0.75 ? ' mid' : ' low') : '';
          inner = recs.length ? '<b>' + ins + '/' + sched + '</b><small>' + (iso === St.today ? 'in so far' : 'present') + '</small>' : '<small class="muted">No data</small>';
        }
      }
      h += '<button class="cal-d' + cls + (iso === St.today ? ' today' : '') + (future ? ' future' : '') + '" role="gridcell"' + (future ? ' disabled' : '') + ' data-a="' + (one ? 'att-edit:' + one.id + ':' + iso : 'att-open:' + iso) + '" aria-label="' + U.dLabel(iso, true) + '"><span class="dn">' + d + '</span>' + inner + '</button>';
    }
    h += '</div>';
    if (!one) h += '<div class="legend" style="margin-top:12px"><span><i style="background:var(--success)"></i>90%+ present</span><span><i style="background:var(--warning)"></i>75–89%</span><span><i style="background:var(--danger)"></i>Below 75%</span></div>';
    return h;
  }

  // ---------- mark / correct ----------
  function editModal(sid, date) {
    var staffList = St.staff();
    sid = sid || (staffList[0] || {}).id;
    var p = St.person(sid), r = St.record(sid, date), sh = St.shift(p.shift);
    var cur = r && r.status !== 'notin' ? r.status : 'present';
    var body = '<div class="grid2">' +
      U.field('Employee', '<select id="m-emp" name="staff">' + U.options(staffList.map(function (s) { return [s.id, s.name + ' · ' + s.id]; }), sid) + '</select>', { for: 'staff' }) +
      U.field('Date', '<input id="m-date" name="date" type="date" value="' + date + '" max="' + St.today + '">', { for: 'date' }) + '</div>' +
      '<div class="fld"><span class="lbl-like">Status</span><div class="radio-chips" role="radiogroup" aria-label="Status">' + STATUS_OPTS.map(function (o) {
        return '<label class="rc"><input type="radio" name="status" value="' + o[0] + '"' + (cur === o[0] ? ' checked' : '') + '><span><i style="background:' + U.STATUS[o[0]][1] + '"></i>' + o[1] + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="grid2 times">' + U.field('Check-in (optional)', '<input id="m-in" name="in" type="time" value="' + ((r && r.in) || (sh ? sh.start : '')) + '">', { for: 'in', hint: sh ? 'Shift starts ' + U.hm12(sh.start) + ' · ' + sh.graceMin + ' min grace' : '' }) +
      U.field('Check-out (optional)', '<input id="m-out" name="out" type="time" value="' + ((r && r.out) || '') + '">', { for: 'out', hint: sh ? 'Shift ends ' + U.hm12(sh.end) : '' }) + '</div>' +
      U.field(r && r.status !== 'notin' ? 'Reason for change' : 'Remark', '<textarea id="m-remark" name="remark" rows="2" maxlength="200" placeholder="' + (r && r.status !== 'notin' ? 'Required — e.g. forgot to check out' : 'Optional') + '">' + '</textarea>', { for: 'remark', req: !!(r && r.status !== 'notin') }) +
      (r && r.status !== 'notin' ? '<p class="note">' + ic('shield') + '<span>Currently: <b>' + St.LABEL[r.status] + (r.in ? ' ' + U.hm12(r.in) + (r.out ? '–' + U.hm12(r.out) : '') : '') + '</b>. The old value and your reason are saved in the activity log.</span></p>' : '');
    var form = U.modal({
      title: 'Mark attendance', body: body, submit: 'Save attendance', wide: true,
      onChange: function (e, f) {
        if (e.target.name === 'staff' || e.target.name === 'date') { var s = U.val(f, 'staff'), d = U.val(f, 'date') || date; if (d > St.today) d = St.today; editModal(s, d); return; }
        toggleTimes(f);
      },
      onSubmit: function (f) {
        var st = (f.querySelector('input[name=status]:checked') || {}).value, tin = U.val(f, 'in'), tout = U.val(f, 'out'), remark = U.val(f, 'remark');
        var d = U.val(f, 'date'), ok = true, needT = st === 'present' || st === 'late' || st === 'halfday';
        var existing = St.record(U.val(f, 'staff'), d), correcting = existing && existing.status !== 'notin';
        ok = U.setErr(f, 'date', !d ? 'Pick a date' : d > St.today ? 'You can’t mark a future date' : '') && ok;
        ok = U.setErr(f, 'out', needT && tout && !tin ? 'Add the check-in time too' : '') && ok;
        ok = U.setErr(f, 'out', needT && tout && tin && tout <= tin ? 'Check-out must be after check-in' : '') && ok;
        ok = U.setErr(f, 'remark', correcting && remark.length < 3 ? 'Add a short reason for this change' : '') && ok;
        if (!ok) return;
        var pp = St.person(U.val(f, 'staff')), s2 = St.shift(pp.shift), note = '';
        if (st === 'present' && tin && s2 && St.settings().rules.autoLate && U.toMin(tin) > U.toMin(s2.start) + s2.graceMin) { st = 'late'; note = ' · marked Late (after grace)'; }
        St.markOne(pp.id, d, { status: st, in: needT ? tin : null, out: needT ? tout : null, remark: correcting ? (existing.remark || '') : remark }, correcting ? remark : '');
        U.closeModal(); U.toast(pp.name + ': ' + St.LABEL[st] + ' on ' + U.dLabel(d) + note);
      },
    });
    toggleTimes(form);
  }
  function toggleTimes(f) {
    var st = (f.querySelector('input[name=status]:checked') || {}).value, on = st === 'present' || st === 'late' || st === 'halfday';
    f.querySelectorAll('.times input').forEach(function (i) { i.disabled = !on; });
    var t = f.querySelector('.times'); if (t) t.style.opacity = on ? 1 : 0.5;
  }

  function bulkModal() {
    var ppl = St.staff(), body = '<div class="grid2">' +
      U.field('Date', '<input id="m-bdate" name="date" type="date" value="' + F.adate + '" max="' + St.today + '">', { for: 'date' }) +
      U.field('Mark as', '<select id="m-bstatus" name="status">' + U.options(STATUS_OPTS, 'present') + '</select>', { for: 'status', hint: 'Present uses each person’s shift start time.' }) + '</div>' + '<p class="muted small" style="margin:-4px 0 10px">Unmarked staff are pre-selected.</p>' +
      '<div class="fld"><span class="lbl-like">Employees</span><div class="checklist"><label class="all"><input type="checkbox" data-m="all"' + (ppl.every(function (p) { var r = St.record(p.id, F.adate); return !r || r.status === 'notin'; }) ? ' checked' : '') + '> Select all</label>' +
      ppl.map(function (p) {
        var r = St.record(p.id, F.adate), marked = r && r.status !== 'notin';
        return '<label><input type="checkbox" name="sid" value="' + p.id + '"' + (marked ? '' : ' checked') + '>' + esc(p.name) + ' <small class="muted">' + (marked ? St.LABEL[r.status] : 'Not marked') + '</small></label>';
      }).join('') + '</div><small class="err" data-err="sid"></small></div>';
    U.modal({
      title: 'Bulk mark attendance', body: body, submit: 'Mark selected', wide: true,
      onChange: function (e, f) {
        if (e.target.getAttribute('data-m') === 'all') f.querySelectorAll('input[name=sid]').forEach(function (i) { i.checked = e.target.checked; });
      },
      onSubmit: function (f) {
        var ids = [].slice.call(f.querySelectorAll('input[name=sid]:checked')).map(function (i) { return i.value; }), d = U.val(f, 'date'), st = U.val(f, 'status');
        if (!U.setErr(f, 'sid', ids.length ? '' : 'Select at least one employee')) return;
        if (!d || d > St.today) { U.setErr(f, 'date', 'Pick today or a past date'); return; }
        St.markMany(ids, d, st, 'Bulk mark'); U.closeModal(); U.toast(ids.length + ' employee' + (ids.length > 1 ? 's' : '') + ' marked ' + St.LABEL[st] + ' for ' + U.dLabel(d));
      },
    });
  }

  U.actions['att-edit'] = function (p) {
    var d = p[1] || F.adate;
    if (d > St.today) { U.toast('You can’t mark a future date'); return; }
    editModal(p[0] || F.aemp || '', d);
  };
  U.actions['att-quick'] = function (p) {
    var who = St.person(p[0]), sh = St.shift(who.shift);
    St.markOne(p[0], F.adate, { status: p[1], in: p[1] === 'present' && sh ? sh.start : null, out: null, remark: '' }, '');
    U.toast(who.name + ' marked ' + St.LABEL[p[1]]);
  };
  U.actions['att-bulk'] = bulkModal;
  U.actions['att-day'] = function (p) { var d = U.addDays(F.adate, +p[0]); if (d <= St.today) { F.adate = d; sel = {}; U.render(); } };
  U.actions['att-month'] = function (p) {
    var y = +F.amonth.slice(0, 4), m = +F.amonth.slice(5, 7) - 1 + (+p[0]); var d = new Date(y, m, 1);
    var ym = d.getFullYear() + '-' + U.pad(d.getMonth() + 1); if (ym <= St.today.slice(0, 7)) { F.amonth = ym; U.render(); }
  };
  U.actions['att-view'] = function (p) { F.aview = p[0]; if (location.hash !== '#/attendance') location.hash = '#/attendance'; else U.render(); };
  U.actions['att-calendar'] = function () { F.aview = 'calendar'; location.hash = '#/attendance'; };
  U.actions['att-open'] = function (p) { F.adate = p[0]; F.aview = 'list'; U.render(); };
  U.actions['att-chip'] = function (p) { F.astatus = F.astatus === p[0] ? '' : p[0]; U.render(); };
  U.actions['att-clear'] = function () { F.aemp = ''; F.adesig = ''; F.astatus = ''; U.render(); };
  U.actions['att-sel'] = function (p, el) { sel[p[0]] = !sel[p[0]]; U.render(); };
  U.actions['att-selall'] = function (p, el) {
    var ids = people().map(function (s) { return s.id; }).filter(function (id) { var r = St.record(id, F.adate); return !F.astatus || (r ? r.status : 'notin') === F.astatus; });
    var all = ids.every(function (id) { return sel[id]; }); ids.forEach(function (id) { sel[id] = !all; }); U.render();
  };
  U.actions['att-unsel'] = function () { sel = {}; U.render(); };
  U.actions['att-bulkset'] = function (p) {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    St.markMany(ids, F.adate, p[0], 'Bulk mark'); sel = {}; U.toast(ids.length + ' marked ' + St.LABEL[p[0]]);
  };
  // date input filter → keep within range
  var prev = U.afterRender;
  U.afterRender = function () { if (prev) prev(); if (F.adate > St.today) { F.adate = St.today; } };
})();
