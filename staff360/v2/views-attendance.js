/* Staff360 v2 — Attendance: day view (mark), month calendar, mark/correct sheet, bulk mark. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var F = U.state;
  F.adate = F.adate || ''; F.aemp = F.aemp || ''; F.adesig = F.adesig || ''; F.astatus = F.astatus || ''; F.aview = F.aview || 'list';
  F.amonth = F.amonth || ''; // set on first view, once today's date is known
  var sel = {}; // selected staff ids for bulk marking

  var STATUS_OPTS = [['present', 'Present'], ['late', 'Late'], ['halfday', 'Half day'], ['absent', 'Absent'], ['leave', 'On leave'], ['weeklyoff', 'Weekly off']];

  U.views.attendance = function (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.adate || '') || F.adate > St.today || F.adate < U.addDays(St.today, -366)) F.adate = St.today;
    if (!/^\d{4}-\d{2}$/.test(F.amonth || '') || F.amonth > St.today.slice(0, 7) || F.amonth < St.today.slice(0, 4) - 1 + St.today.slice(4, 7)) F.amonth = St.today.slice(0, 7);
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) { F.adate = arg > St.today ? St.today : arg; F.aview = 'list'; }
    else if (arg === 'calendar') F.aview = 'calendar';
    if (F.aview === 'list') return markScreen();
    var h = U.pageHead('Attendance', 'Month view. Tap a day to open it.', '<button class="btn" data-a="att-view:list">' + ic('list') + 'Day view</button>');
    h += '<section class="card"><div class="toolbar">' +
      '<div class="date-nav"><button class="icon-btn sm" data-a="att-month:-1" aria-label="Previous month">' + ic('left') + '</button><b class="mlabel">' + U.monthLabel(F.amonth) + '</b><button class="icon-btn sm" data-a="att-month:1" aria-label="Next month"' + (F.amonth >= St.today.slice(0, 7) ? ' disabled' : '') + '>' + ic('right') + '</button></div>' +
      '<label class="sr" for="f-aemp">Employee</label><select id="f-aemp" data-f="aemp">' + U.options([['', 'Whole team']].concat(St.staff().map(function (s) { return [s.id, s.name]; })), F.aemp) + '</select></div>';
    return h + calendar() + '</section>';
  };

  /* ---------- Day view: mark a day (Nov 2026 redesign) ----------
   * One card per person with four big buttons (P, ½, L, A); tap again to undo. Tap a
   * name to add times or fix a day. "Mark remaining as Present" replaces Bulk mark. */
  F.atab = F.atab || 'all'; F.aq = F.aq || '';
  var BTN = [['present', 'P', 'Present'], ['halfday', '½', 'Half day'], ['leave', 'L', 'Leave'], ['absent', 'A', 'Absent']];
  function pressedKey(r) { if (!r || r.status === 'notin') return ''; return r.status === 'late' ? 'present' : r.status; }
  function markScreen() {
    var d = F.adate, isToday = d === St.today, all = St.staff();
    var rows = all.map(function (p) { return { p: p, r: St.record(p.id, d) }; });
    var c = { present: 0, halfday: 0, leave: 0, absent: 0, weeklyoff: 0 }, marked = 0;
    rows.forEach(function (x) { var k = pressedKey(x.r); if (k) { marked++; if (c[k] != null) c[k]++; } });
    var total = rows.length, left = total - marked;
    var q = String(F.aq || '').trim().toLowerCase();
    var shown = rows.filter(function (x) {
      var done = !!pressedKey(x.r);
      if (F.atab === 'todo' && done) return false;
      if (F.atab === 'done' && !done) return false;
      return !q || x.p.name.toLowerCase().indexOf(q) >= 0 || String(x.p.designation || '').toLowerCase().indexOf(q) >= 0;
    });
    var dayName = isToday ? 'Today' : d === U.addDays(St.today, -1) ? 'Yesterday' : U.dLabel(d);
    var h = '<div class="mk">';
    h += '<div class="mk-top"><h1 class="mk-title">Attendance</h1><button class="btn sm" data-a="att-view:calendar">' + ic('grid') + 'Month</button></div>';
    h += '<div class="mk-date"><button class="icon-btn" data-a="att-day:-1" aria-label="Previous day">' + ic('left') + '</button>' +
      '<label class="mk-dl"><b>' + dayName + '</b><small>' + U.dLabel(d, true) + '</small>' +
      '<input type="date" data-f="adate" value="' + d + '" max="' + St.today + '" aria-label="Pick a date"></label>' +
      '<button class="icon-btn" data-a="att-day:1" aria-label="Next day"' + (d >= St.today ? ' disabled' : '') + '>' + ic('right') + '</button></div>';
    if (!total) {
      return h + '<section class="card"><div class="empty big">' + ic('users') + '<b>No staff yet</b><span>' + (St.editable ? 'Add your team first.' : 'Staff you add in the HisaabNow app appear here.') + '</span>' +
        (St.editable ? '<button class="btn pri" data-a="staff-add">' + ic('plus') + 'Add employee</button>' : '') + '</div></section></div>';
    }
    var pct = function (n) { return (n / total * 100).toFixed(2) + '%'; };
    h += '<section class="card mk-prog"><div class="mk-pl"><b>' + marked + ' of ' + total + ' marked</b><span>' + (left ? left + ' left' : 'All done') + '</span></div>' +
      '<div class="mk-bar" aria-hidden="true"><i style="width:' + pct(c.present) + ';background:#078C45"></i><i style="width:' + pct(c.halfday) + ';background:#E0A100"></i><i style="width:' + pct(c.leave) + ';background:#6E4BE8"></i><i style="width:' + pct(c.absent) + ';background:#D92D20"></i><i style="width:' + pct(c.weeklyoff) + ';background:#98A2B3"></i></div>' +
      '<div class="mk-leg"><span><i style="background:#078C45"></i>Present <b>' + c.present + '</b></span><span><i style="background:#E0A100"></i>Half day <b>' + c.halfday + '</b></span><span><i style="background:#6E4BE8"></i>Leave <b>' + c.leave + '</b></span><span><i style="background:#D92D20"></i>Absent <b>' + c.absent + '</b></span>' +
      (c.weeklyoff ? '<span><i style="background:#98A2B3"></i>Weekly off <b>' + c.weeklyoff + '</b></span>' : '') + '</div></section>';
    h += '<div class="mk-tabs" role="tablist">' + [['all', 'All', total], ['todo', 'To mark', left], ['done', 'Marked', marked]].map(function (t) {
      return '<button role="tab" aria-selected="' + (F.atab === t[0]) + '" class="' + (F.atab === t[0] ? 'on' : '') + '" data-a="att-tab:' + t[0] + '">' + t[1] + ' ' + t[2] + '</button>';
    }).join('') + '</div>';
    if (total > 10) h += '<label class="sr" for="f-aq">Search staff</label><input id="f-aq" class="mk-q" type="search" data-f="aq" value="' + esc(F.aq) + '" placeholder="Search by name or role">';
    h += '<div class="mk-list">' + (shown.length ? shown.map(row).join('') : '<p class="mk-empty">' + (F.atab === 'todo' ? 'Everyone is marked for ' + (isToday ? 'today' : U.dLabel(d)) + '.' : q ? 'No one matches “' + esc(F.aq) + '”.' : 'Nobody marked yet.') + '</p>') + '</div>';
    h += '<p class="mk-help">P Present · ½ Half day · L Leave · A Absent. Tap again to undo. Tap a name to add times or fix a day.' +
      (St.can('employee_login') ? '<br><button class="link" data-a="att-noshow">Mark phone no-shows absent</button>' : '') + '</p>';
    if (left) h += '<div class="mk-bulk"><button class="btn pri" data-a="att-rest">' + ic('check') + 'Mark remaining ' + left + ' as Present</button></div>';
    return h + '</div>';
  }
  function row(x) {
    var p = x.p, r = x.r, k = pressedKey(r), sub, cls = '';
    if (r && r.in) {
      sub = 'In ' + U.hm12(r.in) + (r.out ? ' · Out ' + U.hm12(r.out) : '') + (r.status === 'late' ? ' · <span class="mk-late">Late +' + U.lateMin(r) + 'm</span>' : '');
      if (r.gps && r.gps.outside) sub += ' · <span class="mk-late">' + (r.gps.dist >= 1000 ? (Math.round(r.gps.dist / 100) / 10) + ' km' : r.gps.dist + ' m') + ' away</span>';
      cls = 'ok';
    } else if (k === 'weeklyoff') sub = 'Weekly off';
    else if (k) sub = St.LABEL[r.status] + ' · marked';
    else { sub = esc(p.designation || 'Staff') + ' · not marked'; cls = 'todo'; }
    if (r && r.remark) sub += ' · ' + esc(r.remark);
    return '<div class="mk-row"><button class="mk-who" data-a="att-edit:' + p.id + ':' + F.adate + '" aria-label="Add times or fix ' + esc(p.name) + '">' + U.avatar(p, 40) +
      '<span><b>' + esc(p.name) + '</b><small class="' + cls + '">' + sub + '</small></span></button>' +
      '<div class="mk-btns" role="group" aria-label="Mark ' + esc(p.name) + '">' + BTN.map(function (b) {
        var on = k === b[0];
        return '<button class="' + b[0] + (on ? ' on' : '') + '" aria-pressed="' + on + '" aria-label="' + b[2] + ' for ' + esc(p.name) + '" data-a="att-set:' + p.id + ':' + b[0] + '">' + b[1] + '</button>';
      }).join('') + '</div></div>';
  }
  U.actions['att-tab'] = function (p) { F.atab = p[0]; U.render(); };
  U.actions['att-set'] = function (p) {
    var who = St.person(p[0]), d = F.adate, r = St.record(p[0], d), cur = pressedKey(r), want = p[1];
    if (!who || d > St.today) return;
    if (cur === want) {
      // Tap again = undo, unless they checked in from their phone (change that from the name).
      if (r && r.in) { U.toast(who.name + ' checked in at ' + U.hm12(r.in) + '. Tap the name to change it.'); return; }
      St.markOne(p[0], d, { status: 'notin', in: null, out: null, remark: '' }, 'Undo');
      U.toast(who.name + ': mark removed'); return;
    }
    var keep = r && r.in && (want === 'present' || want === 'halfday');
    St.markOne(p[0], d, { status: want === 'present' && r && r.status === 'late' ? 'late' : want, in: keep ? r.in : null, out: keep ? r.out : null, remark: '' }, '');
    U.toast(who.name + ': ' + St.LABEL[want]);
  };
  U.actions['att-rest'] = function () {
    var d = F.adate, ids = St.staff().filter(function (p) { return !pressedKey(St.record(p.id, d)); }).map(function (p) { return p.id; });
    if (!ids.length) return;
    St.markMany(ids, d, 'present', 'Marked remaining as Present', true);
    U.toast(ids.length + ' marked Present for ' + U.dLabel(d));
  };

  function people() {
    return St.staff().filter(function (s) { return (!F.aemp || s.id === F.aemp) && (!F.adesig || s.designation === F.adesig); });
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
  function editModal(sid, date, fixed) {
    var staffList = St.staff();
    sid = sid || (staffList[0] || {}).id;
    var p = St.person(sid), r = St.record(sid, date), sh = St.shift(p.shift);
    var cur = r && r.status !== 'notin' ? r.status : 'present';
    var head = fixed
      ? '<div class="mk-sheet-who">' + U.avatar(p, 44) + '<span><b>' + esc(p.name) + '</b><small>' + esc(p.designation || 'Staff') + ' · ' + U.dLabel(date, true) + '</small></span></div>' +
        '<input type="hidden" name="staff" value="' + esc(sid) + '"><input type="hidden" name="date" value="' + date + '">' +
        (r && r.in ? '<p class="ok-note" style="margin:0 0 12px">' + ic('pin') + 'Checked in at ' + U.hm12(r.in) + (r.out ? ', out at ' + U.hm12(r.out) : '') + (r.gps ? (r.gps.outside ? ' · ' + r.gps.dist + ' m from the shop' : ' · location captured') : '') + (sh ? '. Shift starts ' + U.hm12(sh.start) + ' (' + sh.graceMin + ' min grace).' : '.') + '</p>' : '')
      : '<div class="grid2">' +
        U.field('Employee', '<select id="m-emp" name="staff">' + U.options(staffList.map(function (s) { return [s.id, s.name + ' · ' + s.id]; }), sid) + '</select>', { for: 'staff' }) +
        U.field('Date', '<input id="m-date" name="date" type="date" value="' + date + '" max="' + St.today + '">', { for: 'date' }) + '</div>';
    var body = head +
      '<div class="fld"><span class="lbl-like">Status</span><div class="radio-chips" role="radiogroup" aria-label="Status">' + STATUS_OPTS.map(function (o) {
        return '<label class="rc"><input type="radio" name="status" value="' + o[0] + '"' + (cur === o[0] ? ' checked' : '') + '><span><i style="background:' + U.STATUS[o[0]][1] + '"></i>' + o[1] + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="grid2 times">' + U.field('Check-in (optional)', '<input id="m-in" name="in" type="time" value="' + ((r && r.in) || '') + '">', { for: 'in', hint: sh ? 'Shift starts ' + U.hm12(sh.start) + ' · ' + sh.graceMin + ' min grace' : '' }) +
      U.field('Check-out (optional)', '<input id="m-out" name="out" type="time" value="' + ((r && r.out) || '') + '">', { for: 'out', hint: sh ? 'Shift ends ' + U.hm12(sh.end) : '' }) + '</div>' +
      U.field(r && r.status !== 'notin' ? 'Reason for change' : 'Remark', '<textarea id="m-remark" name="remark" rows="2" maxlength="200" placeholder="' + (r && r.status !== 'notin' ? 'Required — e.g. forgot to check out' : 'Optional') + '">' + '</textarea>', { for: 'remark', req: !!(r && r.status !== 'notin') }) +
      (r && r.status !== 'notin' ? '<p class="note">' + ic('shield') + '<span>Currently: <b>' + St.LABEL[r.status] + (r.in ? ' ' + U.hm12(r.in) + (r.out ? '–' + U.hm12(r.out) : '') : '') + '</b>. The old value and your reason are saved in the activity log.</span></p>' : '');
    var form = U.modal({
      title: fixed ? 'Attendance' : 'Mark attendance', body: body, submit: 'Save', wide: !fixed,
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
    editModal(p[0] || F.aemp || '', d, !!p[0]);
  };
  U.actions['att-quick'] = function (p) {
    var who = St.person(p[0]), sh = St.shift(who.shift);
    St.markOne(p[0], F.adate, { status: p[1], in: p[1] === 'present' && sh ? sh.start : null, out: null, remark: '' }, '');
    U.toast(who.name + ' marked ' + St.LABEL[p[1]]);
  };
  U.actions['att-bulk'] = bulkModal;
  U.actions['att-noshow'] = function () {
    var d = F.adate, list = St.noShows(d), late = d === St.today && St.nowMin < 20 * 60;
    if (!list.length) { U.toast('Nobody to mark — everyone who checks in on their phone has a record for ' + U.dLabel(d)); return; }
    U.confirm('Mark ' + list.length + ' no-show' + (list.length > 1 ? 's' : '') + ' absent for ' + U.dLabel(d, true) + '?',
      esc(list.map(function (p) { return p.name; }).join(', ')) + ' have no check-in or mark. Weekly offs and approved leave are skipped.' + (late ? '<br><br><b>It’s still early today</b> — some staff may not have arrived yet.' : '') + '<br><br>You can change any of them afterwards; each change is logged.',
      'Mark absent', function () { St.markNoShows(d).then(function (n) { U.toast(n + ' marked absent for ' + U.dLabel(d)); }, function () {}); }, true);
  };
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
